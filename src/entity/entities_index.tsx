/**
 * The entities roster — Layer 1 of the entity manager (work order,
 * castors-first-steps 92; maintainer: "an entity manager where we can
 * summon them, give them own time or put them to sleep or stop/resume,
 * and simply ask 'what have you been up to'").
 *
 * A card grid, one card per life: state + own-time as pushed-state
 * toggles (the same one-question-one-toggle pattern as the focus view),
 * and a "what have you been up to?" summary composed from the card
 * compositor (interests, capabilities, sleep rhythm, key-moment count).
 * Clicking a card opens Layer 2 (the graph view). Layer 3
 * (correspondence between entities) gets room in the layout but no build
 * yet — the entity-visit stamp has not landed.
 *
 * Scale honesty (adversarial review, commons 66): per-card /card reads
 * are fine at operator scale (a handful of homes) and WRONG at N=100 —
 * the batched roster endpoint is filed with the gateway lane; this grid
 * fetches cards lazily with bounded concurrency until it exists.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

import { CreateEntityForm } from "./create_entity_form";
import { deriveLifeState } from "./entity_state";
import {
  fetchEntityState,
  gatewayReadHeaders,
  getLoopStatus,
  getServerLifeState,
  listEntities,
  postEntityState,
  startLoop,
  stopLoop,
  type EntityStateInfo,
  type EntitySummary,
  type LoopStatus,
  type ServerLifeState,
} from "./stream_source";

export interface EntitiesIndexProps {
  baseUrl: string;
  token: string | null;
  onOpen(slug: string): void;
  /** Open the gateway sign-in modal — the index PROMPTS when the gateway
   * answers 401/403 instead of rendering an empty page (maintainer
   * incident 2026-07-09: "empty space" = silent-unauthenticated). */
  onConnect?(): void;
}

/** The slice of the card compositor the roster reads (kept minimal —
 * the full shape belongs to the identity card drawer). */
interface RosterCard {
  age_days?: number;
  mind_substrate?: { provider?: string; model?: string };
  discoveries?: unknown[] | { interests?: unknown[] };
  capabilities?: { tools?: unknown[]; workspace_files?: number };
  sleep_stats?: { sleeps?: number; self_elected?: number; operator?: number; sleep_share?: number };
  key_moments?: { total?: number };
  moments?: Array<Record<string, unknown>>;
  likes_dislikes?: { likes?: Array<{ target?: string }> };
}

interface EntityRow {
  summary: EntitySummary;
  state: EntityStateInfo | null;
  loop: LoopStatus | null;
  /** Gateway-computed composite phase; null on older gateways (#FALLBACK
   * to client derivation). */
  serverLife: ServerLifeState | null;
  card: RosterCard | null;
}

function gistOf(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return String(o["gist"] ?? o["title"] ?? o["statement"] ?? o["text"] ?? o["digest"] ?? "");
  }
  return "";
}

function interestsOf(card: RosterCard | null): string[] {
  if (!card) return [];
  const d = card.discoveries;
  const list = Array.isArray(d) ? d : (d?.interests ?? []);
  return list
    .map(gistOf)
    .filter(Boolean)
    .slice(0, 3);
}

export function EntitiesIndex({ baseUrl, token, onOpen, onConnect }: EntitiesIndexProps): React.ReactElement {
  const [rows, setRows] = useState<EntityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cardCacheRef = useRef<Map<string, RosterCard>>(new Map());

  const fetchCard = useCallback(
    async (slug: string): Promise<RosterCard | null> => {
      const cached = cardCacheRef.current.get(slug);
      if (cached) return cached;
      try {
        const res = await fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(slug)}/card`, {
          headers: gatewayReadHeaders({ Accept: "application/json" }),
        });
        if (!res.ok) return null;
        const card = (await res.json()) as RosterCard;
        cardCacheRef.current.set(slug, card);
        return card;
      } catch {
        return null;
      }
    },
    [baseUrl],
  );

  const refresh = useCallback(
    (opts: { cards?: boolean } = {}) => {
      listEntities(baseUrl)
        .then(async (entities) => {
          // State + loop are cheap per row; cards are the heavy compositor —
          // fetched SEQUENTIALLY (bounded concurrency 1) and cached, so a
          // grid of N homes never storms the gateway (scale review P0).
          const enriched: EntityRow[] = await Promise.all(
            entities.map(async (summary) => {
              const [state, loop, serverLife] = await Promise.all([
                fetchEntityState(baseUrl, summary.slug).catch(() => null),
                getLoopStatus(baseUrl, summary.slug).catch(() => null),
                // The gateway-computed composite phase (commons seq 96);
                // null on older gateways -> client-derived fallback.
                getServerLifeState(baseUrl, summary.slug).catch(() => null),
              ]);
              return { summary, state, loop, serverLife, card: cardCacheRef.current.get(summary.slug) ?? null };
            }),
          );
          setRows(enriched);
          setError(null);
          setAuthNeeded(false);
          if (opts.cards !== false) {
            for (const row of enriched) {
              if (cardCacheRef.current.has(row.summary.slug)) continue;
              const card = await fetchCard(row.summary.slug);
              if (card) {
                setRows((prev) =>
                  prev ? prev.map((r) => (r.summary.slug === row.summary.slug ? { ...r, card } : r)) : prev,
                );
              }
            }
          }
        })
        .catch((e: Error & { status?: number }) => {
          // 401/403 = the gateway wants a sign-in: prompt, never a blank
          // page (the maintainer's "empty space", 2026-07-09 06:1x).
          if (e.status === 401 || e.status === 403) {
            setAuthNeeded(true);
            setError(null);
          } else {
            setError(`Could not list entities: ${e.message}`);
          }
        });
    },
    [baseUrl, fetchCard],
  );

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => refresh({ cards: false }), 20000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const rowFor = (slug: string) => rows?.find((r) => r.summary.slug === slug) ?? null;

  const toggleOwnTime = useCallback(
    async (slug: string) => {
      if (busySlug) return;
      const row = rowFor(slug);
      setBusySlug(slug);
      setNote(null);
      try {
        if (row?.loop?.running) {
          await stopLoop(baseUrl, slug, token);
        } else {
          // ONE substrate per entity (2026-07-09 06:32): the gateway
          // resolves his persisted choice; if none exists anywhere its
          // refusal names the fix (set it once with 🧠 on his page).
          if (row?.state?.state === "paused" || row?.state?.state === "asleep") {
            await postEntityState(baseUrl, slug, "awake", "operator started his own time (roster)", token);
          }
          await startLoop(baseUrl, slug, token, {});
        }
        window.setTimeout(() => refresh({ cards: false }), 1200);
      } catch (e) {
        setNote(`${slug}: ${(e as Error).message}`);
      } finally {
        setBusySlug(null);
        refresh({ cards: false });
      }
    },
    [baseUrl, token, busySlug, rows, refresh],
  );

  const toggleSleep = useCallback(
    async (slug: string) => {
      if (busySlug) return;
      const row = rowFor(slug);
      setBusySlug(slug);
      setNote(null);
      const target = row?.state?.state === "asleep" ? "awake" : "asleep";
      try {
        await postEntityState(baseUrl, slug, target, "by the operator (roster)", token);
        window.setTimeout(() => refresh({ cards: false }), 800);
      } catch (e) {
        setNote(`${slug}: ${(e as Error).message}`);
      } finally {
        setBusySlug(null);
        refresh({ cards: false });
      }
    },
    [baseUrl, token, busySlug, rows, refresh],
  );

  return (
    <div className="entities_index">
      <div className="eix_head">
        <h2>Summoned entities</h2>
        <div className="eix_head_actions">
          <button className="eix_refresh" onClick={() => refresh()} title="Refresh the roster">
            ↻
          </button>
          <button className="eix_create_btn" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "✕ close" : "+ new entity"}
          </button>
        </div>
      </div>

      {showCreate ? (
        <CreateEntityForm
          baseUrl={baseUrl}
          token={token}
          onCreated={(slug) => {
            setShowCreate(false);
            refresh();
            onOpen(slug);
          }}
        />
      ) : null}

      {authNeeded ? (
        <div className="eix_signin">
          <p>This gateway requires a sign-in to list its entities.</p>
          <button className="eix_create_btn" onClick={() => onConnect?.()}>
            🔑 connect to the gateway
          </button>
        </div>
      ) : null}
      {error ? <p className="eix_error">{error}</p> : null}
      {note ? <p className="eix_error">{note}</p> : null}
      {rows === null && !error && !authNeeded ? <p className="eix_note">reading the homes…</p> : null}
      {rows !== null && rows.length === 0 && !authNeeded ? (
        <p className="eix_note">No entity homes on this gateway yet — create the first one above.</p>
      ) : null}

      <div className="eix_grid">
        {(rows ?? []).map(({ summary, state, loop, serverLife, card }) => {
          // ONE derived state per card (maintainer 2026-07-09): the same
          // mutually-exclusive machine as the focus view — no card shows
          // "visiting" beside a lit own-time badge. Server phase wins.
          const life = deriveLifeState(state, loop, null, serverLife);
          const ownTimeOn = life.ownTimeActive;
          const stopping = Boolean(loop?.running && loop.stop_requested);
          const asleep = life.sleeping;
          const interests = interestsOf(card);
          const sleep = card?.sleep_stats;
          const momentsTotal = card?.key_moments?.total ?? card?.moments?.length;
          const busy = busySlug === summary.slug;
          return (
            <div key={summary.slug} className="eix_card">
              <button className="eix_card_head" onClick={() => onOpen(summary.slug)} title={`Watch ${summary.name}'s mind`}>
                <span className="eix_name">{summary.name}</span>
                {summary.handle ? (
                  <span className="eix_handle" title="handle (declared address) — reachability, not identity">
                    {summary.handle}
                  </span>
                ) : null}
                <span className={`eix_badge eix_life_${life.accent}`} title={life.detail}>
                  {life.label}
                </span>
                {stopping ? <span className="eix_badge eix_loop_stopping">stopping…</span> : null}
                {loop?.inbox_warning ? (
                  <span className="eix_badge eix_loop_warning" title={loop.inbox_warning}>
                    ⚠ inbox
                  </span>
                ) : null}
                {!loop?.running && loop?.stopped_by === "failures" ? (
                  <span className="eix_badge eix_loop_warning" title="Three consecutive ticks failed (usually LLM timeouts under load) and his own time stopped itself. Memory intact — restart when the substrate is healthy.">
                    ⚠ stopped: failures
                  </span>
                ) : null}
                <span className="eix_open">watch →</span>
              </button>

              <div className="eix_card_body">
                {card?.age_days !== undefined || card?.mind_substrate?.model ? (
                  <div className="eix_meta">
                    {card?.age_days !== undefined ? <span>{card.age_days}d old</span> : null}
                    {card?.mind_substrate?.model ? <span title="mind substrate">{card.mind_substrate.model}</span> : null}
                  </div>
                ) : null}
                {interests.length > 0 ? (
                  <div className="eix_upto">
                    <span className="eix_upto_label">into lately</span>
                    {interests.map((g, i) => (
                      <span key={i} className="eix_interest">
                        {g}
                      </span>
                    ))}
                  </div>
                ) : card ? (
                  <p className="eix_note">no interests recorded yet</p>
                ) : (
                  <p className="eix_note">reading his card…</p>
                )}
                {sleep && (sleep.sleeps ?? 0) > 0 ? (
                  <div className="eix_meta">
                    <span title="sleeps (self-elected / operator)">
                      🌙 {sleep.sleeps} sleep{(sleep.sleeps ?? 0) === 1 ? "" : "s"}
                      {sleep.self_elected ? ` · ${sleep.self_elected} his own choice` : ""}
                    </span>
                    {momentsTotal ? <span>{momentsTotal} key moments</span> : null}
                  </div>
                ) : momentsTotal ? (
                  <div className="eix_meta">
                    <span>{momentsTotal} key moments</span>
                  </div>
                ) : null}
              </div>

              <div className="eix_card_actions">
                <button
                  className={`ec_btn ec_toggle ${ownTimeOn ? "ec_toggle_on" : ""} ${stopping ? "ec_toggle_stopping" : ""}`}
                  aria-pressed={ownTimeOn}
                  disabled={busy || life.visiting}
                  onClick={() => void toggleOwnTime(summary.slug)}
                  title={life.visiting ? "In a visit — own time is yielded" : ownTimeOn ? "Living by himself — click to stop at the next tick boundary" : "Start his own time"}
                >
                  ⏻ own time
                </button>
                <button
                  className={`ec_btn ec_toggle ${asleep ? "ec_sleep_on" : ""}`}
                  aria-pressed={asleep}
                  disabled={busy || life.visiting}
                  onClick={() => void toggleSleep(summary.slug)}
                  title={life.visiting ? "In a visit — cannot sleep with a visitor in the room" : asleep ? "Asleep — click to wake him" : "Put him to sleep (rest / consolidation)"}
                >
                  🌙 sleep
                </button>
                <span className="eix_id">{summary.entity_id ?? ""}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="eix_footer">
        Reads are pure (list, state, own-time, card) — watching never writes. Controls go through the gateway door and land as
        visible moments in each life.
      </p>
    </div>
  );
}
