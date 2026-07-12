import { describe, expect, it } from "vitest";

import { RecordBuffer } from "./record_buffer";

// The batched appender exists to kill the per-event array-copy pattern
// (O(N²) cumulative at resident scale). These tests pin the contract the run
// view relies on: many pushes → one flush; reset() invalidates an already
// scheduled flush so a run switch can never leak stale records into the new
// run; the buffer keeps working after a reset.
describe("RecordBuffer", () => {
  function manual() {
    const flushes: number[][] = [];
    let scheduled: (() => void) | null = null;
    const buffer = new RecordBuffer<number>(
      (flush) => {
        scheduled = flush;
      },
      (items) => {
        flushes.push(items);
      },
    );
    return { buffer, flushes, fire: () => scheduled?.() };
  }

  it("batches many pushes into a single flush", () => {
    const { buffer, flushes, fire } = manual();
    for (let i = 0; i < 200; i++) buffer.push(i);
    expect(flushes.length).toBe(0);
    expect(buffer.pending_count()).toBe(200);
    fire();
    expect(flushes.length).toBe(1);
    expect(flushes[0].length).toBe(200);
    expect(flushes[0][0]).toBe(0);
    expect(flushes[0][199]).toBe(199);
    expect(buffer.pending_count()).toBe(0);
  });

  it("schedules once per batch, not once per push", () => {
    let schedule_calls = 0;
    let scheduled: (() => void) | null = null;
    const flushes: string[][] = [];
    const buffer = new RecordBuffer<string>(
      (flush) => {
        schedule_calls += 1;
        scheduled = flush;
      },
      (items) => flushes.push(items),
    );
    buffer.push("a");
    buffer.push("b");
    buffer.push("c");
    expect(schedule_calls).toBe(1);
    scheduled?.();
    expect(flushes).toEqual([["a", "b", "c"]]);
    // The next push after a flush schedules again.
    buffer.push("d");
    expect(schedule_calls).toBe(2);
  });

  it("reset() drops pending items and invalidates the scheduled flush", () => {
    const { buffer, flushes, fire } = manual();
    buffer.push(1);
    buffer.push(2);
    buffer.reset();
    expect(buffer.pending_count()).toBe(0);
    // The stale flush fires after the reset (a run switch mid-window):
    // it must deliver nothing.
    fire();
    expect(flushes.length).toBe(0);
  });

  it("keeps working after reset (new generation flushes normally)", () => {
    const { buffer, flushes, fire } = manual();
    buffer.push(1);
    buffer.reset();
    fire(); // stale flush, no-op
    buffer.push(7);
    buffer.push(8);
    fire(); // the new generation's flush
    expect(flushes).toEqual([[7, 8]]);
  });

  it("a stale flush must not clear the new generation's scheduled flag", () => {
    const scheduled: Array<() => void> = [];
    const flushes: number[][] = [];
    const buffer = new RecordBuffer<number>(
      (flush) => scheduled.push(flush),
      (items) => flushes.push(items),
    );
    buffer.push(1); // schedules flush A
    buffer.reset();
    buffer.push(2); // schedules flush B (new generation)
    scheduled[0]?.(); // stale A fires: must not touch pending or the flag
    expect(buffer.pending_count()).toBe(1);
    scheduled[1]?.(); // B delivers the live item
    expect(flushes).toEqual([[2]]);
  });

  it("an empty flush delivers nothing", () => {
    const { buffer, flushes, fire } = manual();
    buffer.push(1);
    fire();
    expect(flushes.length).toBe(1);
    // Firing the same scheduled callback again (defensive) delivers nothing.
    fire();
    expect(flushes.length).toBe(1);
  });
});
