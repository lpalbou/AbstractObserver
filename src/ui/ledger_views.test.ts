import { describe, expect, it } from "vitest";

import { build_provider_activities_from_ledger, extract_response_text_from_record } from "./ledger_views";

/** Slice-3 adversary P1 pins: the token math and the response-text
 * priority ladder are user-facing numbers/words — a silent reorder
 * would swap or blank previews with every test green. */
describe("ledger_views.ts — provider fold + response ladder (ui-rethink P1 slice 3)", () => {
  it("build_provider_activities_from_ledger folds tokens, duration, and sort", () => {
    const rec = (over: any) => ({
      run_id: "r1",
      node_id: "n1",
      status: "completed",
      started_at: "2026-07-21T00:00:00Z",
      ended_at: "2026-07-21T00:00:02Z",
      effect: { type: "llm_call", payload: { provider: "p", model: "m", prompt: "hi" } },
      result: { content: "yo", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ...over,
    });
    const acts = build_provider_activities_from_ledger([
      { run_id: "r1", cursor: 1, record: rec({}) as any },
      { run_id: "r1", cursor: 2, record: rec({ started_at: "2026-07-21T01:00:00Z", ended_at: "2026-07-21T01:00:01Z" }) as any },
      // Non-llm records never leak in.
      { run_id: "r1", cursor: 3, record: rec({ effect: { type: "tool_calls" } }) as any },
    ]);
    expect(acts).toHaveLength(2);
    // Newest first by timestamp.
    expect(acts[0].cursor).toBe(2);
    // total = prompt + completion when usage.total_tokens absent.
    expect(acts[1].tokens).toEqual({ prompt: 10, completion: 5, total: 15 });
    expect(acts[1].duration_ms).toBe(2000);
    expect(acts[1].missing_response).toBe(false);

    // gen_time fallback (seconds -> ms) when timestamps are absent.
    const no_ts = build_provider_activities_from_ledger([
      { run_id: "r1", cursor: 4, record: rec({ started_at: "", ended_at: "", result: { content: "", gen_time: 1.5 } }) as any },
    ]);
    expect(no_ts[0].duration_ms).toBe(1500);
    // Empty content is reported, never hidden.
    expect(no_ts[0].missing_response).toBe(true);
  });

  it("extract_response_text_from_record walks the field-priority ladder", () => {
    // The verbatim ladder is response > answer > message > text > content —
    // pinned as-is so a reorder is a visible decision, not a drive-by.
    expect(extract_response_text_from_record({ result: { content: "A", response: "B" } })).toBe("B");
    expect(extract_response_text_from_record({ result: { answer: "C", content: "A" } })).toBe("C");
    expect(extract_response_text_from_record({ result: { content: "A" } })).toBe("A");
    // junk shapes degrade to empty, never throw.
    expect(extract_response_text_from_record(null)).toBe("");
    expect(extract_response_text_from_record({ result: 42 })).toBe("");
  });
});
