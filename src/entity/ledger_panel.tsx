/**
 * The memory ledger beside the graph (the fork monitor's right panel,
 * with the WHY visible): one human line per envelope up to the scrub
 * position. Clicking a line scrubs to it; lines about a node select it.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

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

/** A render item: one line, or a collapsed BURST of same-kind lines.
 * ONE recall deposits one `selected` event per shelf record AND one
 * `co_selected` event per pair; a line per event reads as a wall of
 * "Used"/"Used together" sameness (maintainer, 2026-07-10 20:09+20:50).
 * Consecutive lines of the same groupKind from the SAME recall
 * (trace_id) collapse into one row naming the distinct memories; the
 * individual events stay reachable by expanding the row. */
type RenderItem = { kind: "line"; item: IndexedLine } | { kind: "weave"; key: string; group: "use" | "pair"; items: IndexedLine[] };

function groupPairRuns(visible: IndexedLine[]): RenderItem[] {
  const out: RenderItem[] = [];
  let run: IndexedLine[] = [];
  const flush = () => {
    if (run.length >= 2) {
      out.push({ kind: "weave", key: `w-${run[0].line.seq}`, group: run[0].line.groupKind as "use" | "pair", items: run });
    } else {
      for (const item of run) out.push({ kind: "line", item });
    }
    run = [];
  };
  for (const item of visible) {
    const g = item.line.groupKind;
    const sameRun =
      g !== undefined &&
      run.length > 0 &&
      run[run.length - 1].line.groupKind === g &&
      run[run.length - 1].line.trace_id === item.line.trace_id;
    if (g !== undefined && (run.length === 0 || sameRun)) {
      run.push(item);
    } else {
      flush();
      if (g !== undefined) run.push(item);
      else out.push({ kind: "line", item });
    }
  }
  flush();
  return out;
}

function weaveSummary(group: "use" | "pair", items: IndexedLine[]): { title: string; detail: string } {
  const members: string[] = [];
  for (const it of items) {
    for (const m of it.line.members ?? []) {
      if (!members.includes(m)) members.push(m);
    }
  }
  const shown = members.slice(0, 5);
  const more = members.length - shown.length;
  const list = `${shown.join(" · ")}${more > 0 ? ` · and ${more} more` : ""}`;
  if (group === "pair") {
    return {
      title: `🕸 Woven together — ${items.length} association${items.length === 1 ? "" : "s"} deepened`,
      detail: `${members.length} memories served this moment side by side: ${list}`,
    };
  }
  return {
    title: `🔦 Used — ${members.length} memor${members.length === 1 ? "y" : "ies"} served this moment`,
    detail: list,
  };
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

  // Collapse consecutive pair-trail lines (same recall) into weave rows;
  // expansion is per-row, remembered while the panel lives.
  const [expandedWeaves, setExpandedWeaves] = useState<Set<string>>(() => new Set());
  const renderItems = useMemo(() => groupPairRuns(visible), [visible]);

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

  // Sliding render window centered on the scrub position (over render
  // items — a collapsed weave counts as ONE row, which is the point).
  const windowed = useMemo(() => {
    const indexOf = (it: RenderItem) => (it.kind === "line" ? it.item.index : it.items[0].index);
    if (renderItems.length <= RENDER_WINDOW) return { rows: renderItems, hiddenBefore: 0, hiddenAfter: 0 };
    let anchor = renderItems.length - 1;
    for (let i = 0; i < renderItems.length; i++) {
      if (indexOf(renderItems[i]) > scrubIndex) {
        anchor = Math.max(0, i - 1);
        break;
      }
    }
    const start = Math.max(0, Math.min(anchor - Math.floor(RENDER_WINDOW * 0.75), renderItems.length - RENDER_WINDOW));
    const rows = renderItems.slice(start, start + RENDER_WINDOW);
    return { rows, hiddenBefore: start, hiddenAfter: renderItems.length - (start + rows.length) };
  }, [renderItems, scrubIndex]);

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
        {windowed.rows.map((renderItem, rowIdx) => {
          if (renderItem.kind === "weave") {
            const { key, group, items } = renderItem;
            const expanded = expandedWeaves.has(key);
            const first = items[0];
            const last = items[items.length - 1];
            const reached = first.index <= scrubIndex;
            const summary = weaveSummary(group, items);
            return (
              <React.Fragment key={key}>
                <div
                  className={`el_row el_tone_usage el_weave ${reached ? "" : "el_row_future"}`}
                  onClick={() => {
                    setExpandedWeaves((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  title={expanded ? "Collapse the pairings" : "Expand to see each pairing"}
                >
                  <div className="el_row_meta">
                    <span className="el_seq">
                      {first.line.seq}–{last.line.seq}
                    </span>
                  </div>
                  <div className="el_row_body">
                    <div className="el_title">
                      {summary.title} {expanded ? "▾" : "▸"}
                    </div>
                    <div className="el_detail">{summary.detail}</div>
                  </div>
                </div>
                {expanded
                  ? items.map(({ line, index }, i) => (
                      <div
                        key={`${key}-${i}`}
                        className={`el_row el_tone_usage el_weave_member ${index <= scrubIndex ? "" : "el_row_future"}`}
                        onClick={() => {
                          props.onJump(index);
                          if (line.subject_id) props.onSelectSubject(line.subject_id);
                        }}
                      >
                        <div className="el_row_meta">
                          <span className="el_seq">{line.seq}</span>
                        </div>
                        <div className="el_row_body">
                          <div className="el_detail">{line.detail}</div>
                        </div>
                      </div>
                    ))
                  : null}
              </React.Fragment>
            );
          }
          const { line, index } = renderItem.item;
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
