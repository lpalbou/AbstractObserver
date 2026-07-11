/**
 * The fleet wall (item 13, O-C): many lives at once — one tile per entity,
 * each a PURE READ of that home's stream (bounded history + SSE live
 * tail). Streams never merge: every tile owns its own fold; the wall is
 * presentation over N independent folds (the 0005 "fleet views multiplex
 * client-side" contract — zero new serving machinery).
 *
 * Render honesty rules carried from the single view + the 0017 pins:
 * - REFUSED is not ABSENT: a 403 tail renders as a LOCKED tile quoting
 *   the door's detail (the grant path included) — "a quiet life is a lie
 *   when the truth is no access".
 * - Staleness per tile is wall-time since the last envelope (EventSource
 *   connection state says nothing).
 * - Tiles show stream-derived facts only (counts + the last human-language
 *   ledger lines); controls stay on the roster — watching is not driving.
 */

import React, { useEffect, useRef, useState } from "react";

import { ledgerLine, type LedgerLine } from "./ledger_lines";
import { applyEnvelope, createFoldState, type FoldState } from "./stream_fold";
import { fetchReplay, listEntities, openLiveTail, type EntitySummary, type LiveTailHandle } from "./stream_source";
import type { ReplayEnvelope } from "./stream_types";

const RECENT_LINES = 3;

interface TileState {
  status: "loading" | "live" | "locked" | "error";
  /** Door detail for locked/error tiles (the grant path rides it). */
  detail: string;
  fold: FoldState;
  recent: LedgerLine[];
  lastEnvelopeAt: number | null;
  liveStatus: "open" | "reconnecting" | null;
}

function freshTile(): TileState {
  return { status: "loading", detail: "", fold: createFoldState(), recent: [], lastEnvelopeAt: null, liveStatus: null };
}

/** Tile facts from one home's fold (exported for the contract test):
 * memories exclude diary + bookkeeping (engine acts are not his memories);
 * sessions use the same honest-boundary rule as the single view's header. */
export function summarize(fold: FoldState): { memories: number; sessions: number; feelings: number; diary: number } {
  let diary = 0;
  let memories = 0;
  for (const n of fold.nodes.values()) {
    if (n.diary) diary += 1;
    else if (!n.bookkeeping) memories += 1;
  }
  const summons = fold.sessions.filter((s) => s.kind === "summon").length;
  return {
    memories,
    sessions: Math.max(summons, fold.inferred_sessions.length),
    feelings: fold.standings.size,
    diary,
  };
}

function FleetTile({ baseUrl, entity, onOpen }: { baseUrl: string; entity: EntitySummary; onOpen(slug: string): void }): React.ReactElement {
  const [tile, setTile] = useState<TileState>(freshTile);
  const [, setClock] = useState(0); // staleness re-render tick
  const tailRef = useRef<LiveTailHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    const state = freshTile();

    const apply = (env: ReplayEnvelope) => {
      applyEnvelope(state.fold, env);
      const line = ledgerLine(env);
      if (line.tone !== "quiet") {
        state.recent = [...state.recent, line].slice(-RECENT_LINES);
      }
      state.lastEnvelopeAt = Date.now();
    };

    fetchReplay(baseUrl, entity.slug)
      .then((envelopes) => {
        if (cancelled) return;
        for (const env of envelopes) apply(env);
        state.status = "live";
        setTile({ ...state });
        tailRef.current = openLiveTail(
          baseUrl,
          entity.slug,
          state.fold.seq,
          (env) => {
            if (cancelled) return;
            apply(env);
            setTile({ ...state });
          },
          (status) => {
            if (cancelled) return;
            state.liveStatus = status;
            setTile({ ...state });
          },
        );
      })
      .catch((e: Error & { status?: number; detail?: string }) => {
        if (cancelled) return;
        // REFUSED ≠ ABSENT (0017 pin 3): the locked tile quotes the door.
        state.status = e.status === 403 ? "locked" : "error";
        state.detail = e.detail || e.message;
        setTile({ ...state });
      });

    const interval = window.setInterval(() => setClock((c) => c + 1), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      tailRef.current?.close();
      tailRef.current = null;
    };
  }, [baseUrl, entity.slug]);

  const name = entity.name.charAt(0).toUpperCase() + entity.name.slice(1);
  if (tile.status === "locked") {
    return (
      <div className="ft_tile ft_tile_locked">
        <div className="ft_head">
          <span className="ft_name">{name}</span>
          <span className="ft_badge ft_badge_locked">🔒 not yours to watch</span>
        </div>
        <p className="ft_detail">{tile.detail || "The door refused this tail — an observation grant is required."}</p>
      </div>
    );
  }
  if (tile.status === "error") {
    return (
      <div className="ft_tile ft_tile_error">
        <div className="ft_head">
          <span className="ft_name">{name}</span>
          <span className="ft_badge ft_badge_error">unreachable</span>
        </div>
        <p className="ft_detail">{tile.detail}</p>
      </div>
    );
  }

  const s = summarize(tile.fold);
  const ageS = tile.lastEnvelopeAt ? Math.floor((Date.now() - tile.lastEnvelopeAt) / 1000) : null;
  return (
    <button className="ft_tile" onClick={() => onOpen(entity.slug)} title={`Open ${name}'s full view`}>
      <div className="ft_head">
        <span className="ft_name">{name}</span>
        {entity.handle ? <span className="ft_handle">{entity.handle}</span> : null}
        {tile.status === "loading" ? (
          <span className="ft_badge">loading…</span>
        ) : (
          <span
            className={`ft_badge ${ageS !== null && ageS > 300 ? "ft_badge_quiet" : "ft_badge_live"}`}
            title="Wall time since the last envelope — quiet is not dead, but past 5 minutes it is worth a look."
          >
            {ageS === null ? "no events yet" : ageS < 60 ? `${ageS}s ago` : `${Math.floor(ageS / 60)}m ago`}
            {tile.liveStatus === "reconnecting" ? " · reconnecting…" : ""}
          </span>
        )}
      </div>
      <div className="ft_counts">
        <span>{s.memories} memories</span>
        <span>{s.diary} diary</span>
        <span>{s.feelings} feelings</span>
        <span>{s.sessions} sessions</span>
      </div>
      <div className="ft_lines">
        {tile.recent.length === 0 ? (
          <span className="ft_line ft_line_empty">a quiet life — nothing recent</span>
        ) : (
          tile.recent.map((l) => (
            <span key={`${l.seq}-${l.title}`} className="ft_line">
              <strong>{l.title}</strong>
              {l.detail ? ` — ${l.detail}` : ""}
            </span>
          ))
        )}
      </div>
    </button>
  );
}

export function FleetView({ baseUrl, onOpen, onBack }: { baseUrl: string; onOpen(slug: string): void; onBack(): void }): React.ReactElement {
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // GW-G pin 1 note (phase 4): when the per-principal index becomes
    // grant-filtered, the payload carries filtered_by_grants — surface it
    // here then, so a narrowed wall never implies completeness.
    listEntities(baseUrl)
      .then((list) => !cancelled && setEntities(list))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return (
    <div className="fleet_view">
      <div className="fleet_head">
        <h2>The fleet — every life at once</h2>
        <div className="fleet_actions">
          <button className="eix_refresh" onClick={onBack} title="Back to the roster">
            ⌂ roster
          </button>
        </div>
      </div>
      {error ? <p className="eix_error">Could not list entities: {error}</p> : null}
      {entities === null && !error ? <p className="eix_note">reading the homes…</p> : null}
      {entities !== null && entities.length === 0 ? <p className="eix_note">No entity homes on this gateway.</p> : null}
      <div className="fleet_grid">
        {(entities ?? []).map((e) => (
          <FleetTile key={e.slug} baseUrl={baseUrl} entity={e} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
