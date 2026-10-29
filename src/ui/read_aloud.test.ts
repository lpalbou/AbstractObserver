import { describe, expect, it } from "vitest";
import { READ_ALOUD_INITIAL, readAloudPhase, readAloudStep, type ReadAloudPhase } from "./read_aloud";

/** The operator's case (2026-10-29) as Observer's chats feed the rule. */
function play(steps: Array<[string, ReadAloudPhase, string | null]>): string[] {
  let state = READ_ALOUD_INITIAL;
  const spoken: string[] = [];
  for (const [scope, phase, reply] of steps) {
    const out = readAloudStep(state, { scope, phase, reply: reply ? { id: reply, text: `text ${reply}` } : null });
    state = out.state;
    if (out.speak) spoken.push(out.speak.id);
  }
  return spoken;
}

describe("read aloud (Observer)", () => {
  it("opening a discussion with replies never speaks them", () => {
    expect(play([["d:s1", readAloudPhase("loading"), null], ["d:s1", readAloudPhase("completed"), "a2"]])).toEqual([]);
  });
  it("a failed run-chat ask disarms: a saved thread loaded next is silent", () => {
    expect(play([["chat:r1", "live", null], ["chat:r1", "ended", null], ["chat:r1", "completed", "thread:t1:3"]])).toEqual([]);
  });
  it("an answer produced here is spoken once", () => {
    expect(play([["chat:r1", "completed", "a1"], ["chat:r1", "live", "a1"], ["chat:r1", "completed", "a2"], ["chat:r1", "completed", "a2"]])).toEqual(["a2"]);
  });
  it("a discussion turn started here that went loading → completed still speaks", () => {
    expect(play([["d:s1", readAloudPhase("completed"), "a1"], ["d:s1", readAloudPhase("loading", true), "a1"], ["d:s1", readAloudPhase("completed"), "a2"]])).toEqual(["a2"]);
  });
});
