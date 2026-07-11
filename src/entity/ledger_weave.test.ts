/**
 * Pair-trail collapse contract (maintainer, 2026-07-10 20:09: a wall of
 * "Used together" lines "doesn't seem very informative"): consecutive
 * co_selected lines from ONE recall collapse to a single weave row; the
 * grouping never swallows non-pair lines and never merges ACROSS recalls.
 */

import { describe, expect, it } from "vitest";

import { ledgerLine, type LedgerLine } from "./ledger_lines";
import type { ReplayEnvelope } from "./stream_types";

function coSelectedEnv(seq: number, traceId: string, a: string, b: string): ReplayEnvelope {
  return {
    stream: "abstractmemory.replay",
    stream_version: 1,
    seq,
    family: "event",
    observed_at: "2026-07-10T00:00:00+00:00",
    scope: "life",
    owner_id: "entity:test",
    trace_id: traceId,
    turn_id: null,
    run_id: null,
    payload: { kind: "co_selected", scope: "life", owner_id: "entity:test", record_id: null, pair_ids: [`row-${a}`, `row-${b}`], weight: 1, event_id: `e-${seq}`, seq },
    display: { pair: [{ record_id: `row-${a}`, title: `memory ${a}` }, { record_id: `row-${b}`, title: `memory ${b}` }] },
  } as ReplayEnvelope;
}

describe("pair-trail ledger lines", () => {
  it("co_selected lines carry their member names + pair group for collapsing", () => {
    const line: LedgerLine = ledgerLine(coSelectedEnv(10, "t1", "a", "b"));
    expect(line.title).toBe("Used together");
    expect(line.members).toEqual(["memory a", "memory b"]);
    expect(line.groupKind).toBe("pair");
    expect(line.trace_id).toBe("t1");
  });

  it("selected lines carry their name + use group (the 'Used' burst folds too)", () => {
    const line = ledgerLine({
      stream: "abstractmemory.replay",
      stream_version: 1,
      seq: 11,
      family: "event",
      observed_at: "2026-07-10T00:00:00+00:00",
      scope: "life",
      owner_id: "entity:test",
      trace_id: "t1",
      turn_id: null,
      run_id: null,
      payload: { kind: "selected", scope: "life", owner_id: "entity:test", record_id: "row-a", pair_ids: null, weight: 8, event_id: "e-11", seq: 11 },
      display: { record_id: "row-a", title: "memory a" },
    } as ReplayEnvelope);
    expect(line.title).toBe("Used");
    expect(line.members).toEqual(["memory a"]);
    expect(line.groupKind).toBe("use");
  });

  it("lines outside the two burst families never group", () => {
    const line = ledgerLine({
      stream: "abstractmemory.replay",
      stream_version: 1,
      seq: 12,
      family: "event",
      observed_at: "2026-07-10T00:00:00+00:00",
      scope: "life",
      owner_id: "entity:test",
      trace_id: "t1",
      turn_id: null,
      run_id: null,
      payload: { kind: "pinned", scope: "life", owner_id: "entity:test", record_id: "row-a", pair_ids: null, weight: 0, event_id: "e-12", seq: 12 },
      display: { record_id: "row-a", title: "memory a" },
    } as ReplayEnvelope);
    expect(line.groupKind).toBeUndefined();
    expect(line.members).toBeUndefined();
  });
});
