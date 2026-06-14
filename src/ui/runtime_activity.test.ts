import { describe, expect, it } from "vitest";

import {
  build_runtime_activity_views,
  count_runtime_activity_queues,
  filter_runtime_activity_views,
  runtime_activity_view,
  runtime_expected_action,
  runtime_wait_kind,
  sort_runtime_activity_views,
} from "./runtime_activity";

describe("runtime activity view model", () => {
  const now = Date.parse("2026-06-06T12:00:00Z");

  it("prioritizes terminal failed status over stale waiting payloads", () => {
    const view = runtime_activity_view(
      {
        run_id: "run-failed-after-reject",
        status: "failed",
        workflow_id: "wf",
        created_at: "2026-06-06T10:00:00Z",
        updated_at: "2026-06-06T10:05:00Z",
        waiting: { reason: "user", prompt: "approve?" },
        error: "tool rejected",
      },
      { now_ms: now }
    );

    expect(runtime_wait_kind(view.run)).toBe("none");
    expect(view.queue).toBe("failed");
    expect(view.needs_user_action).toBe(false);
    expect(view.reason).toContain("tool rejected");
  });

  it("keeps only answer/tool waits in user-action queues", () => {
    const views = build_runtime_activity_views(
      [
        { run_id: "answer", status: "waiting", waiting: { reason: "user", prompt: "What should I do?" }, created_at: "2026-06-06T11:00:00Z" },
        {
          run_id: "tool",
          status: "waiting",
          waiting: { reason: "user", details: { tool_calls: [{ name: "execute_command", arguments: { command: "ls" } }] } },
          created_at: "2026-06-06T11:00:00Z",
        },
        { run_id: "schedule", status: "waiting", waiting: { reason: "until", until: "2026-06-07T00:00:00Z" }, created_at: "2026-06-06T11:00:00Z" },
        { run_id: "child", status: "waiting", waiting: { reason: "subworkflow", details: { sub_run_id: "child-run" } }, created_at: "2026-06-06T11:00:00Z" },
      ],
      { now_ms: now }
    );
    const counts = count_runtime_activity_queues(views);

    expect(counts.user_wait).toBe(1);
    expect(counts.tool_approval).toBe(1);
    expect(counts.scheduled).toBe(2);
    expect(counts.attention).toBe(2);
    expect(filter_runtime_activity_views(views, { queue: "user_wait" }).map((v) => v.run_id)).toEqual(["answer"]);
  });

  it("explains unknown waits without encouraging blind responses", () => {
    const run = { run_id: "unknown", status: "waiting", waiting: { reason: "event" }, created_at: "2026-06-06T11:00:00Z" };
    expect(runtime_wait_kind(run)).toBe("external_event");
    expect(runtime_expected_action(run)).toContain("Inspect the ledger");
  });

  it("sorts attention before running and terminal rows", () => {
    const views = build_runtime_activity_views(
      [
        { run_id: "done", status: "completed", created_at: "2026-06-06T09:00:00Z", updated_at: "2026-06-06T09:01:00Z" },
        { run_id: "running", status: "running", created_at: "2026-06-06T11:30:00Z", updated_at: "2026-06-06T11:35:00Z" },
        { run_id: "tool", status: "waiting", waiting: { details: { tool_calls: [{ name: "write_file" }] } }, created_at: "2026-06-06T11:10:00Z" },
        { run_id: "failed", status: "failed", error: "boom", created_at: "2026-06-06T11:20:00Z" },
      ],
      { now_ms: now }
    );

    expect(sort_runtime_activity_views(views, "attention").map((v) => v.run_id)).toEqual(["tool", "failed", "running", "done"]);
  });
});
