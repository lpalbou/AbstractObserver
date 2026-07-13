import { describe, expect, it } from "vitest";

import { board_card, board_column, board_columns, entity_phase, format_age } from "./mission_control";
import type { RunSummary } from "./run_picker";

// The board's promise: column = STATE TRUTH, never prose. Review means a
// HUMAN is the blocker; parked residents are Working; scheduled waits are
// Pending; terminal runs are Done with failures floated first.
function run(partial: Partial<RunSummary>): RunSummary {
  return { run_id: "run_x", status: "running", ...partial } as RunSummary;
}

describe("board_column", () => {
  it("running goes to Working", () => {
    expect(board_column(run({ status: "running" }))).toBe("working");
  });

  it("a parked resident (event wait, no human prompt) is Working, not Review", () => {
    expect(
      board_column(run({ status: "waiting", waiting: { reason: "event", wait_key: "evt:global:global:inbox", allow_free_text: false } })),
    ).toBe("working");
  });

  it("a tool approval is Review", () => {
    expect(
      board_column(
        run({
          status: "waiting",
          waiting: { reason: "user", wait_key: "w1", details: { tool_calls: [{ name: "execute_command", arguments: {} }] } },
        }),
      ),
    ).toBe("review");
  });

  it("a user question is Review", () => {
    expect(board_column(run({ status: "waiting", waiting: { reason: "user", wait_key: "w2", prompt: "Confirm the cap?" } }))).toBe("review");
  });

  it("a scheduled wait is Pending", () => {
    expect(board_column(run({ status: "waiting", waiting: { reason: "until", wait_key: "w3" }, is_scheduled: true }))).toBe("pending");
  });

  it("a subworkflow wait is Working (the child is progressing)", () => {
    expect(board_column(run({ status: "waiting", waiting: { reason: "subworkflow", wait_key: "w4" } }))).toBe("working");
  });

  it("completed and failed and cancelled are Done", () => {
    expect(board_column(run({ status: "completed" }))).toBe("done");
    expect(board_column(run({ status: "failed" }))).toBe("done");
    expect(board_column(run({ status: "cancelled" }))).toBe("done");
  });
});

describe("board_card + board_columns", () => {
  it("carries the wait identity the inline actions need (run_id + wait_key)", () => {
    const card = board_card(
      run({
        run_id: "run_appr",
        status: "waiting",
        waiting: { reason: "user", wait_key: "wk_9", details: { tool_calls: [{ name: "write_file", arguments: {} }] } },
      }),
    );
    expect(card.column).toBe("review");
    expect(card.wait_key).toBe("wk_9");
    expect(card.tool_names).toEqual(["write_file"]);
  });

  it("a SUBRUN tool approval reaches Review while its parked root stays Working (the agent-workflow case)", () => {
    const roots = [run({ run_id: "root1", status: "waiting", waiting: { reason: "subworkflow", wait_key: "sub" } })];
    const all = [
      ...roots,
      run({
        run_id: "child1",
        parent_run_id: "root1",
        status: "waiting",
        waiting: { reason: "user", wait_key: "wk_c", details: { tool_calls: [{ name: "execute_command", arguments: {} }] } },
      }),
    ];
    const cols = board_columns(roots, all);
    expect(cols.review.map((c) => c.run_id)).toEqual(["child1"]);
    expect(cols.review[0].is_subrun).toBe(true);
    expect(cols.review[0].wait_key).toBe("wk_c");
    expect(cols.working.map((c) => c.run_id)).toEqual(["root1"]);
  });

  it("a root in review is not duplicated when it appears in both lists", () => {
    const r = run({ run_id: "rootrev", status: "waiting", waiting: { reason: "user", wait_key: "k", prompt: "?" } });
    const cols = board_columns([r], [r]);
    expect(cols.review.map((c) => c.run_id)).toEqual(["rootrev"]);
    expect(cols.working.length + cols.pending.length + cols.done.length).toBe(0);
  });

  it("a review-classified root still lands in Review when the all-runs page missed it", () => {
    const r = run({ run_id: "missed", status: "waiting", waiting: { reason: "user", wait_key: "k2", prompt: "?" } });
    // all_runs provided but does NOT contain the root (page bounds).
    const cols = board_columns([r], [run({ run_id: "other", status: "running" })]);
    expect(cols.review.map((c) => c.run_id)).toEqual(["missed"]);
  });

  it("failures float to the top of Done", () => {
    const cols = board_columns([
      run({ run_id: "ok1", status: "completed", updated_at: "2026-07-12T10:00:00Z" }),
      run({ run_id: "bad", status: "failed", updated_at: "2026-07-12T09:00:00Z" }),
      run({ run_id: "ok2", status: "completed", updated_at: "2026-07-12T11:00:00Z" }),
    ]);
    expect(cols.done[0].run_id).toBe("bad");
  });

  it("Review sorts oldest wait first (longest-blocked = most urgent)", () => {
    const cols = board_columns([
      run({ run_id: "young", status: "waiting", waiting: { reason: "user", wait_key: "a", prompt: "?", since: "2026-07-12T11:00:00Z" } }),
      run({ run_id: "old", status: "waiting", waiting: { reason: "user", wait_key: "b", prompt: "?", since: "2026-07-12T08:00:00Z" } }),
    ]);
    expect(cols.review.map((c) => c.run_id)).toEqual(["old", "young"]);
  });

  it("runs without an id are dropped, never rendered as ghosts", () => {
    const cols = board_columns([run({ run_id: "" }), run({ run_id: "real" })]);
    const total = cols.pending.length + cols.working.length + cols.review.length + cols.done.length;
    expect(total).toBe(1);
  });
});

describe("entity_phase", () => {
  it("maps the ruled vocabulary and its legacy spellings", () => {
    expect(entity_phase("awake:visiting")).toBe("visit");
    expect(entity_phase("asleep(dream)")).toBe("sleep");
    expect(entity_phase("awake:personal")).toBe("personal");
    expect(entity_phase("own_time")).toBe("personal");
    expect(entity_phase("awake:working")).toBe("work");
    expect(entity_phase("tasked")).toBe("work");
    expect(entity_phase("awake")).toBe("awake");
    expect(entity_phase("")).toBe("unknown");
  });
});

describe("format_age", () => {
  it("renders honest magnitudes and never NaN", () => {
    const now = Date.parse("2026-07-12T12:00:00Z");
    expect(format_age(now - 30_000, now)).toBe("30s");
    expect(format_age(now - 5 * 60_000, now)).toBe("5m");
    expect(format_age(now - 2 * 3_600_000, now)).toBe("2.0h");
    expect(format_age(null, now)).toBe("");
  });
});
