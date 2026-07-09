/**
 * The inspector: click a memory, a standing target, or nothing (the
 * current recall beat) and see the truth at the scrub position — including
 * WHY each memory entered the context (present by right / continuity /
 * matched), the never-decaying use counts, standing feelings with their
 * scars and bonds, and belief revisions.
 */

import React, { useMemo, useState } from "react";

import type { BeatState, FeelingEvent, FoldState, NodeState, StandingState } from "./stream_fold";
import { ADMISSION_LABELS } from "./stream_types";
import { VerbatimModal, type VerbatimSource } from "./verbatim_modal";

export interface InspectorProps {
  fold: FoldState;
  scrubSeq: number;
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** Present when the life is served by a gateway (verbatim reads possible). */
  verbatimSource: VerbatimSource | null;
}

function admissionBadge(admission: string | null): React.ReactElement | null {
  if (!admission) return null;
  return <span className={`ei_badge ei_adm_${admission}`}>{ADMISSION_LABELS[admission] ?? admission}</span>;
}

/** The full feeling history (maintainer round 2 item 2): every valence
 * event with sign, magnitude, reason, and time — expandable, collapsed by
 * default to the summary chips. */
function FeelingEvents({ events }: { events: FeelingEvent[] }): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <div className="ei_feelings">
      <button className="ei_link" onClick={() => setOpen((v) => !v)}>
        {open ? "hide" : "show"} all {events.length} feeling event{events.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <div className="ei_feeling_list">
          {[...events].reverse().map((ev, i) => (
            <div key={`${ev.seq}-${i}`} className="ei_feeling_row">
              <span className={`ei_feeling_sign ${ev.sign >= 0 ? "ei_feeling_pos" : "ei_feeling_neg"}`}>
                {ev.kind === "appraisal" ? `${ev.sign >= 0 ? "+" : "−"}${ev.magnitude}` : ev.kind}
              </span>
              <span className="ei_feeling_body">
                {ev.reason || "no reason recorded"}
                <span className="ei_feeling_when">
                  seq {ev.seq}
                  {ev.observed_at ? ` · ${ev.observed_at.slice(5, 16).replace("T", " ")}` : ""}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NodeCard({
  fold,
  node,
  onSelect,
  verbatimSource,
  onReadVerbatim,
}: {
  fold: FoldState;
  node: NodeState;
  onSelect(id: string): void;
  verbatimSource: VerbatimSource | null;
  onReadVerbatim(node: NodeState): void;
}): React.ReactElement {
  const partners = useMemo(() => {
    const rows: Array<{ id: string; title: string; count: number }> = [];
    for (const e of fold.edges.values()) {
      const other = e.a === node.id ? e.b : e.b === node.id ? e.a : null;
      if (!other) continue;
      const otherNode = fold.nodes.get(other);
      rows.push({ id: other, title: otherNode?.title || other.slice(0, 18), count: e.count });
    }
    rows.sort((a, b) => b.count - a.count);
    return rows.slice(0, 8);
  }, [fold, node]);

  // Feelings ABOUT this record (valence targets may be record ids).
  const feeling = useMemo(() => {
    const byGraph = node.graph_id ? fold.standings.get(node.graph_id) : undefined;
    return byGraph ?? fold.standings.get(node.id);
  }, [fold, node]);

  return (
    <div className="ei_card">
      <div className="ei_kind_row">
        <span className={`ei_kind ei_kind_${node.diary ? "diary" : node.kind}`}>{node.diary ? "diary" : node.kind}</span>
        {admissionBadge(node.last_admission)}
      </div>
      <h3 className="ei_title">{node.title || node.id.slice(0, 24)}</h3>
      {node.diary && node.entry_id && verbatimSource ? (
        <button className="ei_verbatim_btn" onClick={() => onReadVerbatim(node)}>
          Read the entry
        </button>
      ) : null}
      {!node.diary && node.kind !== "relation" ? (
        verbatimSource ? (
          <button className="ei_verbatim_btn" onClick={() => onReadVerbatim(node)}>
            Read the verbatim
          </button>
        ) : (
          <p className="ei_note">Verbatim reads need a connected gateway (this is an exported file).</p>
        )
      ) : null}
      {node.closed ? (
        <div className="ei_closed">
          <strong>{node.closed.kind === "supersede" ? "Superseded" : "Retracted"}</strong> — {node.closed.reason}
          {node.closed.replacement_ids.length > 0 ? (
            <div className="ei_replacements">
              replaced by{" "}
              {node.closed.replacement_ids.map((rid) => {
                const row = fold.graph_to_row.get(rid) ?? rid;
                const target = fold.nodes.get(row);
                return (
                  <button key={rid} className="ei_link" onClick={() => onSelect(row)}>
                    {target?.title || rid.slice(0, 22)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <dl className="ei_facts">
        <dt>used</dt>
        <dd>
          {node.selected_count} time{node.selected_count === 1 ? "" : "s"} (lifetime count — never decays)
        </dd>
        <dt>scope</dt>
        <dd>
          {node.scope || "—"}
        </dd>
        <dt>visibility</dt>
        <dd>
          {node.search_state} / {node.prompt_state}
        </dd>
        <dt>born</dt>
        <dd>seq {node.first_seq}</dd>
        {node.token_estimate ? (
          <>
            <dt>size</dt>
            <dd>~{node.token_estimate} tokens</dd>
          </>
        ) : null}
      </dl>
      {feeling ? (
        <div className="ei_section">
          <h4>How it feels about this</h4>
          <div className="ei_channels">
            <div className="ei_channel ei_channel_pos">
              <span className="ei_channel_value">+{feeling.positive}</span>
              <span className="ei_channel_label">{feeling.positive_count} positive</span>
            </div>
            <div className="ei_channel ei_channel_neg">
              <span className="ei_channel_value">−{feeling.negative}</span>
              <span className="ei_channel_label">{feeling.negative_count} negative</span>
            </div>
          </div>
          {feeling.bonds.map((b) => (
            <div key={b.event_id} className="ei_peak ei_peak_bond">
              <strong>Bond</strong> (magnitude {b.magnitude}) — {b.reason || "no reason recorded"}
            </div>
          ))}
          {feeling.scars.map((s) => (
            <div key={s.event_id} className="ei_peak ei_peak_scar">
              <strong>Scar</strong> (magnitude {s.magnitude}) — {s.reason || "no reason recorded"}
            </div>
          ))}
          <FeelingEvents events={feeling.events} />
        </div>
      ) : null}
      {partners.length > 0 ? (
        <div className="ei_section">
          <h4>Used together with</h4>
          {partners.map((p) => (
            <button key={p.id} className="ei_link ei_partner" onClick={() => onSelect(p.id)}>
              <span>{p.title}</span>
              <span className="ei_count">×{p.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StandingCard({ standing }: { standing: StandingState }): React.ReactElement {
  const net = standing.positive - standing.negative;
  return (
    <div className="ei_card">
      <div className="ei_kind_row">
        <span className="ei_kind ei_kind_standing">standing</span>
      </div>
      <h3 className="ei_title">{standing.target_id}</h3>
      <div className="ei_channels">
        <div className="ei_channel ei_channel_pos">
          <span className="ei_channel_value">+{standing.positive}</span>
          <span className="ei_channel_label">{standing.positive_count} positive</span>
        </div>
        <div className="ei_channel ei_channel_neg">
          <span className="ei_channel_value">−{standing.negative}</span>
          <span className="ei_channel_label">{standing.negative_count} negative</span>
        </div>
        <div className="ei_channel">
          <span className="ei_channel_value">{net >= 0 ? `+${net}` : `${net}`}</span>
          <span className="ei_channel_label">net</span>
        </div>
      </div>
      <p className="ei_note">Both channels stay visible: a hundred small joys and one deep wound are both true.</p>
      {standing.bonds.map((b) => (
        <div key={b.event_id} className="ei_peak ei_peak_bond">
          <strong>Bond</strong> (magnitude {b.magnitude}) — {b.reason || "no reason recorded"}
        </div>
      ))}
      {standing.scars.map((s) => (
        <div key={s.event_id} className="ei_peak ei_peak_scar">
          <strong>Scar</strong> (magnitude {s.magnitude}) — {s.reason || "no reason recorded"}
        </div>
      ))}
      {standing.healed_count > 0 ? (
        <div className="ei_peak ei_peak_healed">
          {standing.healed_count} scar{standing.healed_count === 1 ? "" : "s"} healed — the wound became a lesson.
        </div>
      ) : null}
      {standing.broken_count > 0 ? (
        <div className="ei_peak ei_peak_scar">{standing.broken_count} bond{standing.broken_count === 1 ? "" : "s"} broken.</div>
      ) : null}
      <FeelingEvents events={standing.events} />
    </div>
  );
}

function BeatCard({ fold, beat, onSelect }: { fold: FoldState; beat: BeatState; onSelect(id: string): void }): React.ReactElement {
  const groups = useMemo(() => {
    const byLabel: Record<string, string[]> = {};
    for (const [rid, label] of Object.entries(beat.admissions)) {
      (byLabel[label] ??= []).push(rid);
    }
    return byLabel;
  }, [beat]);

  const order = ["self", "stm", "both", "stimulus"];
  return (
    <div className="ei_card">
      <div className="ei_kind_row">
        <span className="ei_kind ei_kind_beat">recall</span>
        {beat.turn_id ? <span className="ei_badge">{beat.turn_id}</span> : null}
      </div>
      <h3 className="ei_title">{beat.cue_text ? `“${beat.cue_text}”` : "The self read (no cue)"}</h3>
      <dl className="ei_facts">
        <dt>considered</dt>
        <dd>{beat.candidate_count}</dd>
        <dt>on the shelf</dt>
        <dd>{beat.selected.length}</dd>
        <dt>entered context</dt>
        <dd>{beat.committed ? `${beat.used_record_ids.length}${beat.prompt_token_estimate ? ` (~${beat.prompt_token_estimate} tokens)` : ""}` : "not committed"}</dd>
      </dl>
      {order.map((label) => {
        const ids = groups[label];
        if (!ids || ids.length === 0) return null;
        return (
          <div key={label} className="ei_section">
            <h4 className={`ei_adm_head ei_adm_${label}`}>{ADMISSION_LABELS[label] ?? label}</h4>
            {ids.map((rid) => {
              const node = fold.nodes.get(rid);
              return (
                <button key={rid} className="ei_link" onClick={() => onSelect(rid)}>
                  {node?.redacted ? "a diary entry (private)" : node?.title || rid.slice(0, 22)}
                </button>
              );
            })}
          </div>
        );
      })}
      {beat.dropped.length > 0 ? (
        <div className="ei_section">
          <h4>Considered but dropped</h4>
          {beat.dropped.slice(0, 10).map((d, i) => {
            const node = fold.nodes.get(d.record_id);
            return (
              <div key={`${d.record_id}-${i}`} className="ei_dropped">
                <span>{node?.redacted ? "a diary entry" : node?.title || d.record_id.slice(0, 18)}</span>
                <span className="ei_reason">{d.reason ?? ""}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Inspector({ fold, scrubSeq, selectedId, onSelect, verbatimSource }: InspectorProps): React.ReactElement {
  // The modal lives HERE, not in NodeCard: cards remount when the fold
  // recomputes (every live envelope), which would close an open reader.
  const [verbatimNode, setVerbatimNode] = useState<NodeState | null>(null);

  // Maintainer ruling (2026-07-08 00:59): the operator reads without
  // ceremony. No reason prompt, no confirmation — one click, the words.
  // Diary reads still land as visible diary_read moments in the stream
  // (server-side truth), with a standard reason attached.
  const openReader = (node: NodeState) => {
    setVerbatimNode(node);
  };

  const content = useMemo(() => {
    if (selectedId?.startsWith("standing:")) {
      const standing = fold.standings.get(selectedId.slice("standing:".length));
      if (standing) return <StandingCard standing={standing} />;
    } else if (selectedId) {
      const node = fold.nodes.get(selectedId) ?? fold.nodes.get(fold.graph_to_row.get(selectedId) ?? "");
      if (node) return <NodeCard fold={fold} node={node} onSelect={onSelect} verbatimSource={verbatimSource} onReadVerbatim={openReader} />;
      const standing = fold.standings.get(selectedId);
      if (standing) return <StandingCard standing={standing} />;
    }
    // No selection: show the beat active at the scrub position.
    let active: BeatState | null = null;
    for (const tid of fold.beat_order) {
      const beat = fold.beats.get(tid);
      if (beat && beat.first_seq <= scrubSeq) active = beat;
    }
    if (active) return <BeatCard fold={fold} beat={active} onSelect={onSelect} />;
    return <div className="ei_empty">Click a memory in the graph, or scrub to a recall.</div>;
  }, [fold, scrubSeq, selectedId, onSelect, verbatimSource]);

  return (
    <div className="entity_inspector">
      {selectedId ? (
        <div className="ei_head">
          <button className="ei_clear" onClick={() => onSelect(null)}>
            ← current recall
          </button>
        </div>
      ) : null}
      {content}
      {verbatimNode && verbatimSource ? (
        <VerbatimModal node={verbatimNode} source={verbatimSource} diaryReason="operator review" onClose={() => setVerbatimNode(null)} />
      ) : null}
    </div>
  );
}
