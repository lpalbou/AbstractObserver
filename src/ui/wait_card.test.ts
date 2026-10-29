import { describe, expect, it } from "vitest";
import { wait_card_text } from "./wait_card";

const NOW = Date.parse("2026-10-29T01:22:00Z");
const SINCE = Date.parse("2026-10-28T18:00:00Z");

describe("wait_card_text (ADR 0043: no reason code, no raw wait key)", () => {
  it("a tool approval says how many tools and since when", () => {
    const out = wait_card_text({ reason: "user", tool_calls: 4, since_ms: SINCE, now_ms: NOW, session_id: "automation:7734" });
    expect(out.text).toBe("Waiting for your approval of 4 tools since 7h 22m");
    expect(out.hint).toContain("set them to Auto in the automation's Tools");
    expect(out.text).not.toMatch(/user|tool_approval|wait_key/);
  });
  it("one tool, in a chat (no automation hint)", () => {
    expect(wait_card_text({ reason: "user", tool_calls: 1, since_ms: SINCE, now_ms: NOW, session_id: "sess-1" })).toEqual({
      text: "Waiting for your approval of 1 tool since 7h 22m",
      hint: "",
    });
  });
  it("the other waits read as words", () => {
    expect(wait_card_text({ reason: "user", tool_calls: 0, since_ms: SINCE, now_ms: NOW }).text).toBe("Waiting for your answer since 7h 22m");
    expect(wait_card_text({ reason: "event", tool_calls: 0, event_name: "email.received", since_ms: null, now_ms: NOW }).text).toBe("Waiting for the event email.received");
    expect(wait_card_text({ reason: "subworkflow", tool_calls: 0, since_ms: null, now_ms: NOW }).text).toBe("Waiting for a child run to finish");
    expect(wait_card_text({ reason: "weird_code", tool_calls: 0, since_ms: null, now_ms: NOW }).text).toBe("Waiting");
  });
});
