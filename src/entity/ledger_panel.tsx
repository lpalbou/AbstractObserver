/**
 * The memory ledger beside the graph (the fork monitor's right panel,
 * with the WHY visible): one human line per envelope up to the scrub
 * position. Clicking a line scrubs to it; lines about a node select it.
 */

import React, { useEffect, useMemo, useRef } from "react";

import { boundaryLines, ledgerLine, type LedgerLine } from "./ledger_lines";
import type { ReplayEnvelope } from "./stream_types";

export interface LedgerPanelProps {
  envelopes: ReplayEnvelope[];
  scrubIndex: number;
  onJump(index: number): void;
  onSelectSubject(id: string | null): void;
  /** Hide quiet lines (considered/audit) by default. */
  showQuiet: boolean;
  onToggleQuiet(): void;
  /** Progressive-load status ("loading his life… 42,000 events · 60 MB").
   * A half-loaded ledger must SAY so — mid-flight it otherwise reads as
   * amnesia (maintainer, 2026-07-09 morning: "40k -> <1000"). */
  loadingNote?: string | null;
}

/** Rows drawn at once. A 24/7 life accumulates tens of thousands of
 * envelopes; unbounded DOM rows jank the browser long before the fold
 * does (adversarial scale review 2.2). The window slides with the scrub. */
const RENDER_WINDOW = 600;

interface IndexedLine {
  line: LedgerLine;
  /** Envelope index this line belongs to (boundaries share their envelope's). */
  index: number;
}

export function LedgerPanel(props: LedgerPanelProps): React.ReactElement {
  const { envelopes, scrubIndex, showQuiet } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  // Incremental line cache: envelopes only append (or get replaced
  // wholesale on source switch); lines are pure per (prev, envelope).
  // Derived day/tick BOUNDARY rows ride between envelopes, so the cache
  // is a flattened list with per-envelope indices (jump targets).
  const lineCacheRef = useRef<{ lines: IndexedLine[]; firstSeq: number | null; count: number }>({
    lines: [],
    firstSeq: null,
    count: 0,
  });

  const lines: IndexedLine[] = useMemo(() => {
    const cache = lineCacheRef.current;
    const firstSeq = envelopes.length > 0 ? envelopes[0].seq : null;
    const append = (from: number) => {
      for (let i = from; i < envelopes.length; i++) {
        const prev = i > 0 ? envelopes[i - 1] : null;
        for (const b of boundaryLines(envelopes[i], prev)) cache.lines.push({ line: b, index: i });
        cache.lines.push({ line: ledgerLine(envelopes[i]), index: i });
      }
      cache.count = envelopes.length;
    };
    if (cache.firstSeq !== firstSeq || cache.count > envelopes.length) {
      cache.lines = [];
      cache.firstSeq = firstSeq;
      append(0);
    } else {
      append(cache.count);
    }
    return cache.lines;
  }, [envelopes]);

  const visible = useMemo(() => {
    const out: IndexedLine[] = [];
    for (const item of lines) {
      if (!showQuiet && item.line.tone === "quiet") continue;
      out.push(item);
    }
    return out;
  }, [lines, showQuiet]);

  // Honest emptiness (night-watch finding, 0010 2026-07-08): a stream tail
  // of pure recall bookkeeping (listed/selected/co_selected) rendered as
  // SILENCE with audit lines off — and a tired human read "corrupted".
  // Count what the filter hid at the tail and SAY it.
  const hiddenQuietTail = useMemo(() => {
    if (showQuiet) return 0;
    const lastShownIdx = visible.length > 0 ? lines.lastIndexOf(visible[visible.length - 1]) : -1;
    let count = 0;
    for (let i = lastShownIdx + 1; i < lines.length; i++) {
      if (lines[i].line.tone === "quiet") count++;
    }
    return count;
  }, [lines, visible, showQuiet]);

  // Sliding render window centered on the scrub position.
  const windowed = useMemo(() => {
    if (visible.length <= RENDER_WINDOW) return { rows: visible, hiddenBefore: 0, hiddenAfter: 0 };
    let anchor = visible.length - 1;
    for (let i = 0; i < visible.length; i++) {
      if (visible[i].index > scrubIndex) {
        anchor = Math.max(0, i - 1);
        break;
      }
    }
    const start = Math.max(0, Math.min(anchor - Math.floor(RENDER_WINDOW * 0.75), visible.length - RENDER_WINDOW));
    const rows = visible.slice(start, start + RENDER_WINDOW);
    return { rows, hiddenBefore: start, hiddenAfter: visible.length - (start + rows.length) };
  }, [visible, scrubIndex]);

  useEffect(() => {
    const el = listRef.current?.querySelector(".el_row_current");
    el?.scrollIntoView({ block: "nearest" });
  }, [scrubIndex]);

  return (
    <div className="entity_ledger">
      {props.loadingNote ? (
        <div className="el_loading_note" title="His life is still streaming in — this ledger is a partial view until the counter disappears.">
          ⏳ {props.loadingNote} — partial view while his life streams in
        </div>
      ) : null}
      <div className="el_list" ref={listRef}>
        {windowed.hiddenBefore > 0 ? (
          <div className="el_window_note">{windowed.hiddenBefore} earlier lines — scrub the timeline to bring them into view</div>
        ) : null}
        {windowed.rows.map(({ line, index }, rowIdx) => {
          const reached = index <= scrubIndex;
          const isCurrent = index === scrubIndex && line.family !== "boundary";
          if (line.family === "boundary") {
            // Day/tick rhythm rows: centered, no meta column — the shape
            // of his own time, readable at a glance.
            return (
              <div
                key={`b-${line.seq}-${rowIdx}`}
                className={`el_row el_boundary ${reached ? "" : "el_row_future"}`}
                onClick={() => props.onJump(index)}
              >
                <div className="el_boundary_title">{line.title}</div>
                {line.detail ? <div className="el_boundary_detail">{line.detail}</div> : null}
              </div>
            );
          }
          return (
            <div
              key={`${line.seq}-${rowIdx}`}
              className={`el_row el_tone_${line.tone} ${reached ? "" : "el_row_future"} ${isCurrent ? "el_row_current" : ""}`}
              onClick={() => {
                props.onJump(index);
                if (line.subject_id) props.onSelectSubject(line.subject_id);
              }}
            >
              <div className="el_row_meta">
                <span className="el_seq">{line.seq}</span>
                {line.turn_id ? <span className="el_turn">{line.turn_id}</span> : null}
              </div>
              <div className="el_row_body">
                <div className="el_title">{line.title}</div>
                {line.detail ? <div className="el_detail">{line.detail}</div> : null}
              </div>
            </div>
          );
        })}
        {windowed.hiddenAfter > 0 ? <div className="el_window_note">{windowed.hiddenAfter} later lines</div> : null}
        {hiddenQuietTail > 0 ? (
          <button className="el_window_note el_quiet_note" onClick={props.onToggleQuiet}>
            {hiddenQuietTail} recall-audit event{hiddenQuietTail === 1 ? "" : "s"} after the last shown line — the memory is
            working, not silent. Click to show audit lines.
          </button>
        ) : null}
        {visible.length === 0 ? (
          lines.length > 0 ? (
            <button className="el_empty el_quiet_note" onClick={props.onToggleQuiet}>
              All {lines.length} events here are recall audit (considered/selected/co-used) — hidden by the audit-lines
              filter. Click to show them.
            </button>
          ) : (
            <div className="el_empty">No events yet.</div>
          )
        ) : null}
      </div>
    </div>
  );
}
