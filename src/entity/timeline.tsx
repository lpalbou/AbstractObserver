/**
 * The scrub timeline: position = envelope index (even pacing across the
 * life), display = journal seq (the truth axis). Session markers (summons)
 * are drawn as ticks. Play advances the index; Live snaps to the head as
 * new envelopes arrive.
 */

import React, { useMemo } from "react";

import type { ReplayEnvelope } from "./stream_types";

export interface TimelineProps {
  envelopes: ReplayEnvelope[];
  scrubIndex: number; // -1 .. envelopes.length - 1
  playing: boolean;
  speed: number;
  live: boolean;
  liveAvailable: boolean;
  /** Session boundaries inferred from run_id changes (home-direct lives
   * carry no host summon markers). Values are envelope SEQs. */
  inferredSessionSeqs: number[];
  onScrub(index: number): void;
  onTogglePlay(): void;
  onSpeed(speed: number): void;
  onToggleLive(): void;
}

const SPEEDS = [1, 2, 5, 10, 25, 50];

export function Timeline(props: TimelineProps): React.ReactElement {
  const { envelopes, scrubIndex, playing, speed, live, liveAvailable } = props;
  const max = envelopes.length - 1;
  const current = envelopes[scrubIndex];

  const sessionTicks = useMemo(() => {
    const ticks: Array<{ index: number; kind: string }> = [];
    const seqToIndex = new Map<number, number>();
    envelopes.forEach((env, i) => {
      seqToIndex.set(env.seq, i);
      if (env.family === "host") {
        const kind = String((env.payload as { kind?: string }).kind ?? "");
        if (kind === "summon" || kind === "prelude_refused") ticks.push({ index: i, kind });
        // Maintenance acts (reembed): retrieval geometry changed HERE —
        // the scrub bar must show the boundary (plan item 3, observer half).
        if (kind === "reembed") ticks.push({ index: i, kind: "maintenance" });
      }
    });
    for (const seq of props.inferredSessionSeqs) {
      const index = seqToIndex.get(seq);
      if (index !== undefined) ticks.push({ index, kind: "session" });
    }
    return ticks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envelopes, props.inferredSessionSeqs]);

  return (
    <div className="entity_timeline">
      <button
        className={`et_btn ${live ? "" : "et_btn_accent"}`}
        onClick={props.onTogglePlay}
        disabled={live}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button className="et_btn" onClick={() => props.onScrub(-1)} disabled={live} title="To the beginning">
        ⏮
      </button>
      <div className="et_track_wrap">
        <div className="et_ticks">
          {sessionTicks.map((t) => (
            <div
              key={`${t.kind}-${t.index}`}
              className={`et_tick ${t.kind === "summon" ? "et_tick_summon" : t.kind === "session" ? "et_tick_session" : t.kind === "maintenance" ? "et_tick_maintenance" : "et_tick_refused"}`}
              style={{ left: `${max > 0 ? (t.index / max) * 100 : 0}%` }}
              title={`${t.kind} @ seq ${envelopes[t.index]?.seq}`}
            />
          ))}
        </div>
        <input
          type="range"
          className="et_track"
          min={-1}
          max={Math.max(-1, max)}
          value={live ? max : scrubIndex}
          disabled={live}
          onChange={(e) => props.onScrub(Number(e.target.value))}
        />
      </div>
      <button className="et_btn" onClick={() => props.onScrub(max)} disabled={live} title="To the end">
        ⏭
      </button>
      <select className="et_speed" value={speed} disabled={live} onChange={(e) => props.onSpeed(Number(e.target.value))}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <button
        className={`et_btn et_live ${live ? "et_live_on" : ""}`}
        onClick={props.onToggleLive}
        disabled={!liveAvailable}
        title={liveAvailable ? "Follow the live journal" : "Live tail needs a gateway source"}
      >
        ● Live
      </button>
      <span className="et_pos">
        {scrubIndex >= 0 && current ? `seq ${current.seq}` : "—"} · {scrubIndex + 1}/{envelopes.length}
      </span>
    </div>
  );
}
