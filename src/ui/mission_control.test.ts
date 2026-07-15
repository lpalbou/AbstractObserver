import { describe, expect, it } from "vitest";

import {
  ACTIVE_WINDOW_MS,
  COLUMN_EMPTY,
  COLUMN_HINT,
  COLUMN_LABEL,
  DEFAULT_DONE_WINDOW,
  DONE_WINDOW_LABEL,
  DONE_WINDOW_MS,
  board_card,
  board_column,
  board_columns,
  entity_activity_age,
  entity_phase,
  filter_done_window,
  format_age,
  format_tokens,
} from "./mission_control";
import type { RunSummary } from "./run_status";

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

  it("maps the cognition wire's composite chain (c1454) onto the ruled four", () => {
    expect(entity_phase("visiting")).toBe("visit");
    expect(entity_phase("asleep")).toBe("sleep");
    expect(entity_phase("personal")).toBe("personal");
    expect(entity_phase("paused")).toBe("paused");
    expect(entity_phase("resting")).toBe("resting");
    expect(entity_phase("working")).toBe("work");
    expect(entity_phase("own time")).toBe("personal");
  });

  it("STOP (liveness axis, c1523) is not a phase — it renders as the emergency state", () => {
    expect(entity_phase("stop")).toBe("stopped");
    expect(entity_phase("stopped")).toBe("stopped");
  });

  it("unlisted server words pass through VERBATIM — never coerced into a ruled phase", () => {
    // Documents the honest-passthrough posture (fable5 adversary, c1475):
    // a future "helpful" coercion of unknown words must fail this test.
    expect(entity_phase("hibernating")).toBe("hibernating");
  });

  it("pins the normalizer against THE canonical phase-graph artifact (entity-owned, c1492)", async () => {
    // One source, N pins: the artifact's phase keys — not a copy of them —
    // are the enum this board renders. Skips (visibly) when the sibling
    // repo is absent (standalone CI); in the workspace, drift fails here.
    const fs = await import("node:fs");
    const path = new URL("../../../abstractentity/spec/entity_phases.json", import.meta.url).pathname;
    if (!fs.existsSync(path)) {
      console.warn("#FALLBACK phase-graph artifact absent (standalone checkout) — cross-repo pin skipped");
      return;
    }
    const spec = JSON.parse(fs.readFileSync(path, "utf8"));
    const keys = Object.keys(spec.phases).sort();
    expect(keys).toEqual(["personal", "sleep", "visit", "work"]);
    for (const key of keys) expect(entity_phase(key)).toBe(key);
    expect(spec.initial_phase).toBe("sleep");
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

describe("entity_activity_age (B3 tile freshness — never fabricate liveness)", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");

  it("recent moments read as ages within the active window", () => {
    const age = entity_activity_age("2026-07-13T11:59:30Z", now);
    expect(age).toBe(30_000);
    expect(age! <= ACTIVE_WINDOW_MS).toBe(true);
  });

  it("older moments fall outside the active window", () => {
    const age = entity_activity_age("2026-07-13T11:00:00Z", now);
    expect(age).toBe(3_600_000);
    expect(age! > ACTIVE_WINDOW_MS).toBe(true);
  });

  it("missing or unparseable timestamps yield null — the tile renders NOTHING", () => {
    expect(entity_activity_age("", now)).toBeNull();
    expect(entity_activity_age("not-a-date", now)).toBeNull();
  });

  it("clock skew (future timestamps) clamps to zero, never negative", () => {
    expect(entity_activity_age("2026-07-13T12:05:00Z", now)).toBe(0);
  });
});

describe("format_tokens (B3 spend chip — compact, never fabricated)", () => {
  it("renders honest magnitudes", () => {
    expect(format_tokens(812)).toBe("812");
    expect(format_tokens(12_340)).toBe("12k");
    expect(format_tokens(4_230)).toBe("4.2k");
    expect(format_tokens(4_200_000)).toBe("4.2M");
  });

  it("null/invalid renders NOTHING", () => {
    expect(format_tokens(null)).toBe("");
    expect(format_tokens(Number.NaN)).toBe("");
    expect(format_tokens(-5)).toBe("");
  });
});

describe("Done window (operator 2026-07-14: terminal runs must not explode the column)", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");
  const card = (id: string, since: string | null) =>
    board_card(run({ run_id: id, status: "completed", updated_at: since ?? undefined }), now);

  it("keeps runs inside the window, counts the older ones hidden", () => {
    const fresh = card("fresh", "2026-07-14T02:00:00Z"); // 10h ago
    const old = card("old", "2026-07-10T12:00:00Z"); // 4d ago
    const { visible, hidden_count } = filter_done_window([fresh, old], "48h", now);
    expect(visible.map((c) => c.run_id)).toEqual(["fresh"]);
    expect(hidden_count).toBe(1);
  });

  it("'all' disables the window entirely", () => {
    const old = card("ancient", "2025-01-01T00:00:00Z");
    const { visible, hidden_count } = filter_done_window([old], "all", now);
    expect(visible.length).toBe(1);
    expect(hidden_count).toBe(0);
  });

  it("cards with NO timestamp stay visible — hiding what we cannot date loses runs silently", () => {
    const undated = card("undated", null);
    expect(undated.since_ms).toBeNull();
    const { visible, hidden_count } = filter_done_window([undated], "12h", now);
    expect(visible.map((c) => c.run_id)).toEqual(["undated"]);
    expect(hidden_count).toBe(0);
  });

  it("preset maps stay in sync and the default is the ruled 48h", () => {
    expect(Object.keys(DONE_WINDOW_MS).sort()).toEqual(Object.keys(DONE_WINDOW_LABEL).sort());
    expect(DEFAULT_DONE_WINDOW).toBe("48h");
    // Windows are strictly increasing where defined ("all" = null cap).
    expect(DONE_WINDOW_MS["12h"]!).toBeLessThan(DONE_WINDOW_MS["24h"]!);
    expect(DONE_WINDOW_MS["14d"]!).toBeLessThan(DONE_WINDOW_MS["1m"]!);
    expect(DONE_WINDOW_MS.all).toBeNull();
  });
});

describe("board column contract (adversary 2 pin)", () => {
  it("renders Review FIRST — the action column leads, and the three key maps stay in sync", () => {
    // Column render order IS Object.keys(COLUMN_LABEL) insertion order
    // (mission_control.tsx render loop); Review-first was a deliberate
    // layout ruling and is one careless key-reorder from regressing.
    expect(Object.keys(COLUMN_LABEL)).toEqual(["review", "working", "pending", "done"]);
    expect(Object.keys(COLUMN_EMPTY).sort()).toEqual(Object.keys(COLUMN_LABEL).sort());
    expect(Object.keys(COLUMN_HINT).sort()).toEqual(Object.keys(COLUMN_LABEL).sort());
  });
});
