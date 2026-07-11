/**
 * The meet reader (item 14's human-access half; maintainer requirement
 * 2026-07-10 18:57: "as a human observer, i would need to access that
 * conversation ... in read only, as something that happened").
 *
 * v0 composes from ALREADY-SERVED endpoints (replay stream + record
 * verbatim over HTTP — never home files): every home carrying the meet's
 * correlation key contributes its OWN leg, and the conversation renders
 * as PERSPECTIVE COLUMNS — what A lived beside what B lived, each leg's
 * lossless verbatims under its own entity's header. Perspectives
 * correlate as data; streams never merge (the item-14 contract, as
 * pixels).
 *
 * Honesty rules:
 * - Diary is structurally ABSENT (memory's pinned boundary: redacted
 *   blocks never carry visit_id) — the transcript is episodes only, and
 *   the view never tries to "complete" it.
 * - Line-level speaker attribution is UNCLAIMED in v0: verbatims render
 *   under the entity that LIVED them, but "who said which line" inside a
 *   verbatim waits for the door's stamp-attributed transcript surface
 *   (v1) — attribution is never parsed from prose.
 */

import React, { useEffect, useState } from "react";

import { Markdown } from "@abstractframework/panel-chat";

import { foldEnvelopes, type NodeState } from "./stream_fold";
import { fetchRecordVerbatim, fetchReplay, listEntities } from "./stream_source";

export interface MeetReaderProps {
  baseUrl: string;
  visitId: string;
  onClose(): void;
  onOpenEntity?(slug: string): void;
}

interface LegMoment {
  node: NodeState;
  text: string | null; // verbatim (null while loading / when absent)
  bornDigest: boolean;
}

interface Leg {
  slug: string;
  name: string;
  moments: LegMoment[];
}

type ReaderState =
  | { phase: "loading"; note: string }
  | { phase: "ready"; legs: Leg[] }
  | { phase: "error"; message: string };

async function loadLeg(baseUrl: string, slug: string, name: string, visitId: string): Promise<Leg | null> {
  let envelopes;
  try {
    envelopes = await fetchReplay(baseUrl, slug);
  } catch {
    // A home we cannot read contributes no leg (locked/unreachable homes
    // surface on the fleet wall; the reader shows what is readable).
    return null;
  }
  const fold = foldEnvelopes(envelopes);
  const nodes = [...fold.nodes.values()]
    .filter((n) => n.visit_id === visitId)
    .sort((a, b) => String(a.born_at).localeCompare(String(b.born_at)));
  if (nodes.length === 0) return null;
  const moments: LegMoment[] = await Promise.all(
    nodes.map(async (node) => {
      try {
        const v = await fetchRecordVerbatim(baseUrl, slug, node.graph_id ?? node.id);
        return { node, text: v.text, bornDigest: Boolean(v.born_digest) };
      } catch {
        return { node, text: null, bornDigest: false };
      }
    }),
  );
  return { slug, name, moments };
}

export function MeetReader({ baseUrl, visitId, onClose, onOpenEntity }: MeetReaderProps): React.ReactElement {
  const [state, setState] = useState<ReaderState>({ phase: "loading", note: "finding the participating lives…" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading", note: "finding the participating lives…" });
    listEntities(baseUrl)
      .then(async (entities) => {
        if (cancelled) return;
        setState({ phase: "loading", note: `reading ${entities.length} home stream(s)…` });
        const legs = (
          await Promise.all(entities.map((e) => loadLeg(baseUrl, e.slug, e.name || e.slug, visitId)))
        ).filter((l): l is Leg => l !== null);
        if (cancelled) return;
        if (legs.length === 0) {
          setState({ phase: "error", message: "No readable home carries this moment — the conversation may live on another door, or its homes are not granted to you." });
        } else {
          setState({ phase: "ready", legs });
        }
      })
      .catch((e: Error) => !cancelled && setState({ phase: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [baseUrl, visitId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ev_backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ev_panel mr_panel">
        <div className="ev_head">
          <div className="ev_title">
            <span className="ei_kind ei_kind_beat">shared moment</span>
            <span>{visitId}</span>
          </div>
          <button className="ev_close" onClick={onClose}>
            close
          </button>
        </div>
        <div className="mr_contract">
          One conversation, {state.phase === "ready" ? state.legs.length : "…"} perspective{state.phase === "ready" && state.legs.length === 1 ? "" : "s"} — each
          life remembers the moment its own way; the streams never merge. Private diary thoughts about it are theirs and absent by
          construction. Who-said-which-line arrives with the door's stamped transcript (v1) — never guessed from prose.
        </div>
        <div className="ev_body mr_body">
          {state.phase === "loading" ? <div className="ev_status">{state.note}</div> : null}
          {state.phase === "error" ? <div className="ev_status ev_status_error">{state.message}</div> : null}
          {state.phase === "ready" ? (
            <div className="mr_columns">
              {state.legs.map((leg) => (
                <div key={leg.slug} className="mr_leg">
                  <div className="mr_leg_head">
                    <span className="mr_leg_name">{leg.name.charAt(0).toUpperCase() + leg.name.slice(1)}</span>
                    <span className="mr_leg_sub">how this life remembers it</span>
                    {onOpenEntity ? (
                      <button className="ei_link" onClick={() => onOpenEntity(leg.slug)} title="Open this entity's full view">
                        open life →
                      </button>
                    ) : null}
                  </div>
                  {leg.moments.map((m) => (
                    <div key={m.node.id} className={`mr_moment ${m.node.kind === "summary" ? "mr_moment_summary" : ""}`}>
                      <div className="mr_moment_head">
                        <span className={`ei_kind ei_kind_${m.node.kind === "summary" ? "beat" : "memory"}`}>
                          {m.node.kind === "summary" ? "their reflection" : "lived moment"}
                        </span>
                        {m.node.born_at ? <span className="mr_moment_at">{String(m.node.born_at).slice(0, 19)}</span> : null}
                      </div>
                      {m.node.title ? <div className="mr_moment_title">{m.node.title}</div> : null}
                      {m.text ? (
                        <Markdown text={m.text} className="ev_markdown" />
                      ) : (
                        <div className="mr_moment_none">no verbatim served — the digest above is the honest summary</div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
