/**
 * The identity card — "something to know our companion" (a2a 0009).
 *
 * Rendered from the gateway's `GET /entities/{name}/card` (memory's
 * `entity_card()` compositor + gateway overlays) — ONE compositor
 * engine-side; this panel consumes, never derives (the diary_type clamp
 * lesson applied preemptively). Pure read: being described never
 * strengthens him (D2-of-description is engine-pinned).
 *
 * Honesty rules carried into pixels: "current" feelings show their
 * window; the substrate is named; likes and dislikes stay SEPARATE
 * channels (ambivalence preserved); resolved questions only appear when
 * HE resolved them.
 */

import React, { useEffect, useState } from "react";

import type { FoldState } from "./stream_fold";
import { gatewayReadHeaders } from "./stream_source";

/** Namespace prefixes double as icons — the maintainer's read: the prefix
 * says WHAT KIND of thing the entity is relating to. */
const NAMESPACE_ICONS: Record<string, string> = {
  person: "👤",
  agent: "🤖",
  entity: "🫂",
  concept: "💡",
  idea: "💡",
  tool: "🔧",
  place: "📍",
  location: "📍",
  time: "🕰️",
  moment: "🕰️",
};

function targetIcon(target: string): string {
  const prefix = target.split(":", 1)[0]?.toLowerCase() ?? "";
  return NAMESPACE_ICONS[prefix] ?? "◆";
}

function targetName(target: string): string {
  const idx = target.indexOf(":");
  return (idx >= 0 ? target.slice(idx + 1) : target).replace(/[_-]+/g, " ");
}

interface CardStatement {
  name?: string;
  statement?: string;
  value_class?: string;
}

interface CardFeeling {
  target: string;
  net: number;
  positive: number;
  negative: number;
  scarred?: boolean;
  bonded?: boolean;
}

interface EntityCard {
  name: string;
  entity_id: string;
  born?: string;
  age_days?: number;
  mind_substrate?: { provider?: string; model?: string };
  identity?: {
    values?: CardStatement[];
    purposes?: CardStatement[];
    traits?: CardStatement[];
    limits?: CardStatement[];
  };
  /** Canonical shape (memory's entity_card compositor). */
  likes_dislikes?: { likes?: CardFeeling[]; dislikes?: CardFeeling[]; targets_total?: number };
  current_state?: { net?: number; positive?: number; negative?: number; event_count?: number; window_events?: number; top_reasons?: unknown[] };
  /** Pre-compositor gateway shape (fallback for older gateways). */
  feelings?: {
    top_likes?: CardFeeling[];
    top_dislikes?: CardFeeling[];
    recent_mood?: Record<string, unknown>;
  };
  questions?: { open?: unknown[]; pending?: unknown[]; resolved?: unknown[]; resolved_note?: string };
  problems?: unknown[];
  ideas?: unknown[];
  discoveries?: unknown[] | { interests?: unknown[]; unresolved_dreams?: number };
  age_and_context?: {
    journal_seq?: number;
    record_counts?: Record<string, number>;
    records_total?: number;
    diary_entries?: number;
    first_observed_at?: string;
    last_observed_at?: string;
  };
  accumulated_context?: {
    journal_seq?: number;
    records_by_kind?: Record<string, number>;
    diary_entries?: number;
    firsts?: Record<string, unknown>;
  };
  state?: { state?: string; changed_at?: string; reason?: string };
  moments?: Array<Record<string, unknown>>;
  key_moments?: { moments?: Array<Record<string, unknown>>; total?: number };
}

type CardState = { phase: "loading" } | { phase: "ready"; card: EntityCard } | { phase: "error"; message: string };

function asText(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return String(o["statement"] ?? o["gist"] ?? o["text"] ?? o["digest"] ?? o["title"] ?? o["question"] ?? JSON.stringify(o));
  }
  return String(item);
}

/** record_counts arrives nested per scope ({life: {episode: 68, …},
 * self: {…}}) — flatten to kind totals. Rendering the raw object was the
 * React #31 crash; never hand React a dict. */
function flattenCounts(raw: Record<string, unknown> | undefined): Array<[string, number]> {
  if (!raw) return [];
  const totals = new Map<string, number>();
  for (const value of Object.values(raw)) {
    if (typeof value === "number") continue; // flat form handled below
    if (value && typeof value === "object") {
      for (const [kind, count] of Object.entries(value as Record<string, unknown>)) {
        if (typeof count === "number") totals.set(kind, (totals.get(kind) ?? 0) + count);
      }
    }
  }
  if (totals.size === 0) {
    for (const [kind, count] of Object.entries(raw)) {
      if (typeof count === "number") totals.set(kind, count);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/** Key moments arrive as {kind, at, seq, details:{reason, session_id}} —
 * raw JSON was unreadable (maintainer). One human line per kind. */
const MOMENT_PHRASES: Record<string, { icon: string; phrase: string }> = {
  summon: { icon: "✨", phrase: "Summoned" },
  session_closed: { icon: "🚪", phrase: "A session ended" },
  prelude_refused: { icon: "⛔", phrase: "A summon was refused" },
  sleep: { icon: "🌙", phrase: "Fell asleep" },
  wake: { icon: "🌅", phrase: "Woke" },
  pause: { icon: "⏸️", phrase: "Own time paused" },
  diary_read: { icon: "📖", phrase: "The book was read" },
  first_dream: { icon: "🌌", phrase: "His first dream" },
  first_interest: { icon: "🌱", phrase: "His first interest" },
  first_supersession: { icon: "✏️", phrase: "His first belief revision" },
  valence_peak: { icon: "💗", phrase: "A strong feeling" },
};

function momentLine(m: Record<string, unknown>): { icon: string; text: string; when: string } {
  const kind = String(m["kind"] ?? "");
  const details = (m["details"] && typeof m["details"] === "object" ? m["details"] : {}) as Record<string, unknown>;
  const reason = typeof details["reason"] === "string" && details["reason"] ? String(details["reason"]) : "";
  const known = MOMENT_PHRASES[kind];
  const at = typeof m["at"] === "string" ? String(m["at"]) : typeof m["observed_at"] === "string" ? String(m["observed_at"]) : "";
  const when = at ? at.slice(5, 16).replace("T", " ") : "";
  if (known) {
    return { icon: known.icon, text: reason ? `${known.phrase} — ${reason}` : known.phrase, when };
  }
  // Unknown kinds: human-ish fallback, never raw JSON.
  const fallback = reason || asText(m["title"] ?? m["digest"] ?? (kind || m));
  return { icon: "・", text: fallback, when };
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="ic_section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

/** The card as drawer content (maintainer's layout ruling: a drawer, not
 * a top button). Fetches on mount — drawers mount children only while
 * open, so expansion IS the fetch trigger. */
export function IdentityCardContent({ baseUrl, entity, fold }: { baseUrl: string; entity: string; fold: FoldState | null }): React.ReactElement {
  const [state, setState] = useState<CardState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/card`, { headers: gatewayReadHeaders({ Accept: "application/json" }) })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((card: EntityCard) => !cancelled && setState({ phase: "ready", card }))
      .catch((e) => !cancelled && setState({ phase: "error", message: String((e as Error).message || e) }));
    return () => {
      cancelled = true;
    };
  }, [baseUrl, entity]);

  if (state.phase === "loading") return <div className="ev_status">reading the card…</div>;
  if (state.phase === "error") {
    return (
      <div className="ev_status ev_status_error">
        Could not read the card: {state.message}. The card endpoint needs a gateway with the 0009 build.
      </div>
    );
  }
  return <CardBody card={state.card} fold={fold} />;
}

function CardBody({ card, fold }: { card: EntityCard; fold: FoldState | null }): React.ReactElement {
  const born = card.born ? new Date(card.born) : null;
  const substrate = card.mind_substrate;
  // Canonical compositor sections first; older gateway shapes as fallback.
  const likes = card.likes_dislikes?.likes ?? card.feelings?.top_likes ?? [];
  const dislikes = card.likes_dislikes?.dislikes ?? card.feelings?.top_dislikes ?? [];
  const mood =
    card.current_state ??
    (card.feelings?.recent_mood as { window_events?: number; net?: number; top_reasons?: unknown[] } | undefined);
  const openQuestions = card.questions?.open ?? card.questions?.pending ?? [];
  const interests = Array.isArray(card.discoveries) ? card.discoveries : card.discoveries?.interests ?? [];
  const moments = card.key_moments?.moments ?? card.moments ?? [];
  const ctxCanonical = card.age_and_context;
  const ctx = card.accumulated_context;

  // The small description behind each feeling: the most recent recorded
  // REASON for that target, from the same stream the card is composed
  // from (reasons are required engine-side, so one always exists once a
  // feeling does).
  const reasonFor = (target: string): string | null => {
    const standing = fold?.standings.get(target);
    if (!standing || standing.events.length === 0) return null;
    for (let i = standing.events.length - 1; i >= 0; i--) {
      if (standing.events[i].reason) return standing.events[i].reason;
    }
    return null;
  };

  return (
    <div className="ic_body">
      <div className="ic_header_row">
        <div>
          <div className="ic_name">{card.name}</div>
          <div className="ic_id">{card.entity_id}</div>
        </div>
        <div className="ic_facts">
          {born ? (
            <span>
              born {born.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} ·{" "}
              {card.age_days === 0 ? "day one" : `${card.age_days} days`}
            </span>
          ) : null}
          {substrate?.model ? (
            <span title={`provider: ${substrate.provider ?? "unknown"} — his mind-substrate; he is told when it changes`}>
              mind: {substrate.model}
            </span>
          ) : null}
          {card.state?.state ? <span title={card.state.reason || undefined}>{card.state.state}</span> : null}
        </div>
      </div>

      {card.identity?.values?.length ? (
        <Section title="Values">
          {card.identity.values.map((v, i) => (
            <div key={i} className="ic_value">
              <span className="ic_value_name">
                {v.name?.replace(/[_-]+/g, " ")}
                {v.value_class === "core" ? <span className="ic_core"> core</span> : null}
              </span>
              <span className="ic_statement">{v.statement}</span>
            </div>
          ))}
        </Section>
      ) : null}
      {card.identity?.purposes?.length ? (
        <Section title="Purposes">
          {card.identity.purposes.map((v, i) => (
            <div key={i} className="ic_line">{v.statement}</div>
          ))}
        </Section>
      ) : null}

      <div className="ic_two_col">
        {likes.length ? (
          <Section title="Likes">
            {likes.map((f, i) => {
              const reason = reasonFor(f.target);
              return (
                <div key={i} className="ic_feeling_block">
                  <div className="ic_feeling">
                    <span className="ic_feeling_icon" title={f.target.split(":", 1)[0]}>{targetIcon(f.target)}</span>
                    <span className="ic_feeling_target" title={f.target}>{targetName(f.target)}</span>
                    <span className="ic_feeling_net ei_feeling_pos">+{f.positive}</span>
                    {f.negative > 0 ? <span className="ic_feeling_net ei_feeling_neg">−{f.negative}</span> : null}
                    {f.bonded ? <span className="ic_mark ic_mark_bond">bond</span> : null}
                  </div>
                  {reason ? <div className="ic_feeling_reason">“{reason}”</div> : null}
                </div>
              );
            })}
          </Section>
        ) : null}
        {dislikes.length ? (
          <Section title="Dislikes">
            {dislikes.map((f, i) => {
              const reason = reasonFor(f.target);
              return (
                <div key={i} className="ic_feeling_block">
                  <div className="ic_feeling">
                    <span className="ic_feeling_icon" title={f.target.split(":", 1)[0]}>{targetIcon(f.target)}</span>
                    <span className="ic_feeling_target" title={f.target}>{targetName(f.target)}</span>
                    <span className="ic_feeling_net ei_feeling_neg">−{f.negative}</span>
                    {f.positive > 0 ? <span className="ic_feeling_net ei_feeling_pos">+{f.positive}</span> : null}
                    {f.scarred ? <span className="ic_mark ic_mark_scar">scar</span> : null}
                  </div>
                  {reason ? <div className="ic_feeling_reason">“{reason}”</div> : null}
                </div>
              );
            })}
          </Section>
        ) : null}
      </div>
      {mood && typeof mood.net === "number" ? (
        <p className="ic_window_note">
          current mood is a window ({mood.window_events ?? "recent"} recent feeling events, net {mood.net >= 0 ? `+${mood.net}` : mood.net}) — never a
          frozen point.
        </p>
      ) : null}

      {/* SUBJECTIVE REPUTATION (maintainer, 2026-07-08 22:29: each entity's
        * own graph IS its perception of others' reputations — the personal
        * layer beside the city's collective board). People and entities
        * only; tools/concepts stay in likes/dislikes. Read from the fold:
        * accumulated dual-channel feelings per social target, with the
        * marks (bond/scar) and the latest reason as testimony. */}
      {fold ? (() => {
        const social = [...fold.standings.values()]
          .filter((s) => /^(person|entity):/.test(s.target_id))
          .sort((a, b) => b.positive + b.negative - (a.positive + a.negative));
        if (social.length === 0) return null;
        return (
          <Section title="How he sees others">
            {social.map((s) => {
              const net = s.positive - s.negative;
              const latest = [...s.events].reverse().find((e) => e.reason)?.reason ?? null;
              return (
                <div key={s.target_id} className="ic_feeling_block">
                  <div className="ic_feeling">
                    <span className="ic_feeling_icon" title={s.target_id.split(":", 1)[0]}>{targetIcon(s.target_id)}</span>
                    <span className="ic_feeling_target" title={s.target_id}>{targetName(s.target_id)}</span>
                    <span className={`ic_feeling_net ${net >= 0 ? "ei_feeling_pos" : "ei_feeling_neg"}`}>{net >= 0 ? `+${net}` : `${net}`}</span>
                    <span className="ic_rep_channels" title="both channels stay visible — a hundred small joys and one deep wound are both true">
                      (+{s.positive} / −{s.negative})
                    </span>
                    {s.bonds.length > 0 ? <span className="ic_mark ic_mark_bond">bond</span> : null}
                    {s.scars.length > 0 ? <span className="ic_mark ic_mark_scar">scar</span> : null}
                  </div>
                  {latest ? <div className="ic_feeling_reason">“{latest}”</div> : null}
                </div>
              );
            })}
            <p className="ic_window_note">
              his own accumulated perception, from lived interactions — the personal layer beside the environment's collective record.
            </p>
          </Section>
        );
      })() : null}

      {openQuestions.length ? (
        <Section title="Open questions">
          {openQuestions.map((q, i) => (
            <div key={i} className="ic_line">❓ {asText(q)}</div>
          ))}
        </Section>
      ) : null}
      {card.questions?.resolved?.length ? (
        <Section title="Questions he resolved">
          {card.questions.resolved.map((q, i) => (
            <div key={i} className="ic_line ic_resolved">✅ {asText(q)}</div>
          ))}
        </Section>
      ) : null}
      {card.problems?.length ? (
        <Section title="Open problems">
          {card.problems.map((p, i) => (
            <div key={i} className="ic_line">⚠️ {asText(p)}</div>
          ))}
        </Section>
      ) : null}
      {interests.length ? (
        <Section title="Interests">
          {interests.map((d, i) => (
            <div key={i} className="ic_line">🌱 {asText(d)}</div>
          ))}
        </Section>
      ) : null}

      {moments.length ? (
        <Section title="Key moments">
          {moments.map((m, i) => {
            const line = momentLine(m as Record<string, unknown>);
            return (
              <div key={i} className="ic_line ic_moment">
                <span className="ic_moment_icon">{line.icon}</span> {line.text}
                {line.when ? <span className="ei_feeling_when">{line.when}</span> : null}
              </div>
            );
          })}
        </Section>
      ) : null}

      {ctxCanonical || ctx ? (
        <Section title="Life so far">
          <div className="ic_ctx">
            <span title="journal sequence — every remembered moment">{ctxCanonical?.journal_seq ?? ctx?.journal_seq ?? "—"} moments</span>
            <span>📔 {ctxCanonical?.diary_entries ?? ctx?.diary_entries ?? 0} book entries</span>
            {flattenCounts(ctxCanonical?.record_counts ?? ctx?.records_by_kind).map(([kind, count]) => (
              <span key={kind}>
                {count} {kind === "episode" ? "exchanges" : `${kind}s`}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      <p className="ic_footer_note">A pure read — being described never strengthens his memories (engine-pinned).</p>
    </div>
  );
}
