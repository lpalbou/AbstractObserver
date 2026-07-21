import { extract_tool_calls_from_wait } from "../lib/runtime_extractors";
import type { ToolCall, WaitState } from "../lib/types";

export type RuntimeActivityQueue =
  | "attention"
  | "user_wait"
  | "tool_approval"
  | "running"
  | "failed"
  | "scheduled"
  | "finished"
  | "all";

export type RuntimeActivitySort = "attention" | "recent" | "oldest" | "duration" | "tokens" | "workflow";

export type RuntimeActivityRun = {
  run_id?: string | null;
  workflow_id?: string | null;
  status?: string | null;
  current_node?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  session_id?: string | null;
  parent_run_id?: string | null;
  waiting_reason?: string | null;
  waiting?: WaitState | Record<string, any> | null;
  error?: any;
  llm_calls?: number | null;
  tool_calls?: number | null;
  tokens_total?: number | null;
};

export type RuntimeWaitKind =
  | "none"
  | "user_response"
  | "tool_approval"
  | "scheduled"
  | "subworkflow"
  | "external_event"
  | "unknown_wait";

export type RuntimeActivityView = {
  run: RuntimeActivityRun;
  run_id: string;
  status: string;
  wait_kind: RuntimeWaitKind;
  queue: RuntimeActivityQueue;
  attention_rank: number;
  reason: string;
  expected_action: string;
  action_label: string;
  search_text: string;
  is_terminal: boolean;
  needs_user_action: boolean;
  is_stale: boolean;
  duration_ms: number;
  updated_ms: number;
};

export type RuntimeActivityCounts = Record<RuntimeActivityQueue, number>;

// Run-clock + time parsing live in format.ts now (ui-rethink P1 step 1):
// this module's private copies had DRIFTED from app.tsx's — its
// parse_iso_ms lacked the microsecond clamp (`.123456Z` backends), so a
// waiting run's age could read "—" here and a real age there. Re-exported
// so existing consumers (mission_control, tests) keep their import path.
import { parse_iso_ms, run_duration_ms, run_finished_at, run_started_at, terminal_run_status } from "./format";

export { parse_iso_ms, run_duration_ms, run_finished_at, run_started_at, terminal_run_status };

function wait_object(run: RuntimeActivityRun | null | undefined): WaitState | null {
  const wait = run?.waiting;
  return wait && typeof wait === "object" ? (wait as WaitState) : null;
}

function wait_reason(run: RuntimeActivityRun | null | undefined): string {
  const wait = wait_object(run);
  return String(wait?.reason || run?.waiting_reason || "").trim().toLowerCase();
}

function wait_has_human_prompt(wait: WaitState | null): boolean {
  if (!wait) return false;
  if (String(wait.prompt || "").trim()) return true;
  if (Array.isArray(wait.choices) && wait.choices.length > 0) return true;
  return wait.allow_free_text !== false && String(wait.reason || "").trim().toLowerCase() === "user";
}

function tool_call_names(tool_calls: ToolCall[]): string {
  const names = tool_calls.map((tc: any) => String(tc?.name || "tool").trim()).filter(Boolean);
  if (!names.length) return "";
  return `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
}

export function runtime_wait_kind(run: RuntimeActivityRun | null | undefined): RuntimeWaitKind {
  const st = String(run?.status || "").trim().toLowerCase();
  if (terminal_run_status(st) || st !== "waiting") return "none";
  const wait = wait_object(run);
  const reason = wait_reason(run);
  const tool_calls = extract_tool_calls_from_wait(wait);
  if (tool_calls.length) return "tool_approval";
  if (reason === "until") return "scheduled";
  if (reason === "subworkflow") return "subworkflow";
  if (reason === "event") return wait_has_human_prompt(wait) ? "user_response" : "external_event";
  if (reason === "user") return "user_response";
  if (wait_has_human_prompt(wait)) return "user_response";
  return "unknown_wait";
}

export function runtime_wait_reason_label(run: RuntimeActivityRun | null | undefined): string {
  const wait = wait_object(run);
  const tool_calls = extract_tool_calls_from_wait(wait);
  const kind = runtime_wait_kind(run);
  if (kind === "tool_approval") return `Tool approval: ${tool_call_names(tool_calls) || "tool call"}`;
  if (kind === "user_response") {
    if (Array.isArray(wait?.choices) && wait.choices.length > 0) return "Choice required";
    return "User response needed";
  }
  if (kind === "scheduled") return "Scheduled wait";
  if (kind === "subworkflow") return "Waiting for subworkflow";
  if (kind === "external_event") return "Waiting for external event";
  if (kind === "unknown_wait") return "Waiting, context unclear";
  return "";
}

export function runtime_expected_action(run: RuntimeActivityRun | null | undefined): string {
  const kind = runtime_wait_kind(run);
  if (kind === "tool_approval") return "Review the tool request, then approve, reject, or cancel the whole run.";
  if (kind === "user_response") return "Answer the workflow request. Submit resumes only this wait.";
  if (kind === "scheduled") return "No response is needed. The run resumes when the scheduled time arrives or it is manually resumed.";
  if (kind === "subworkflow") return "No direct response is needed. Inspect the child workflow or cancel the parent run.";
  if (kind === "external_event") return "No direct response is available here. Inspect the ledger or the event source.";
  if (kind === "unknown_wait") return "No clear prompt was provided. Review the input and recent ledger before taking action.";
  const st = String(run?.status || "").trim().toLowerCase();
  if (st === "failed") return "Open the ledger, artifacts, or logs to inspect the failure.";
  if (st === "running") return "Watch the ledger/provider traces or cancel the workflow if it should stop.";
  if (terminal_run_status(st)) return "Open the ledger and artifacts for the final outcome.";
  return "Open the run to inspect current activity.";
}

function error_label(run: RuntimeActivityRun | null | undefined): string {
  const err = run?.error;
  if (!err) return "";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function runtime_activity_view(
  run: RuntimeActivityRun,
  options: {
    now_ms?: number;
    workflow_label?: string;
  } = {},
): RuntimeActivityView {
  const now_ms = options.now_ms ?? Date.now();
  const workflow_label = options.workflow_label ?? "";
  const status = String(run.status || "unknown").trim().toLowerCase() || "unknown";
  const wait_kind = runtime_wait_kind(run);
  const is_terminal = terminal_run_status(status);
  const duration_ms = run_duration_ms(run, now_ms);
  const updated_ms = parse_iso_ms(run.updated_at || run.created_at) ?? 0;
  const is_stale = status === "running" && duration_ms >= 4 * 60 * 60 * 1000;
  const reason =
    runtime_wait_reason_label(run) ||
    error_label(run) ||
    (run.current_node ? `Current node: ${run.current_node}` : status === "running" ? "Running" : is_terminal ? "Terminal" : "No current activity reported");

  let queue: RuntimeActivityQueue = "all";
  if (wait_kind === "tool_approval") queue = "tool_approval";
  else if (wait_kind === "user_response") queue = "user_wait";
  else if (wait_kind === "scheduled" || wait_kind === "subworkflow" || wait_kind === "external_event") queue = "scheduled";
  else if (status === "failed") queue = "failed";
  else if (status === "running") queue = "running";
  else if (is_terminal) queue = "finished";

  const attention_rank =
    wait_kind === "tool_approval"
      ? 0
      : wait_kind === "user_response"
        ? 1
        : wait_kind === "unknown_wait"
          ? 2
          : status === "failed"
            ? 3
            : is_stale
              ? 4
              : status === "running"
                ? 5
                : wait_kind !== "none"
                  ? 6
                  : is_terminal
                    ? 8
                    : 7;

  const needs_user_action = wait_kind === "tool_approval" || wait_kind === "user_response";
  const action_label = wait_kind === "tool_approval" ? "Open approval" : wait_kind === "user_response" ? "Open wait" : "Open Observe";
  const search_text = [
    run.run_id,
    run.workflow_id,
    workflow_label,
    run.session_id,
    run.parent_run_id,
    run.status,
    run.current_node,
    wait_reason(run),
    reason,
    error_label(run),
  ]
    .join(" ")
    .toLowerCase();

  return {
    run,
    run_id: String(run.run_id || "").trim(),
    status,
    wait_kind,
    queue,
    attention_rank,
    reason,
    expected_action: runtime_expected_action(run),
    action_label,
    search_text,
    is_terminal,
    needs_user_action,
    is_stale,
    duration_ms,
    updated_ms,
  };
}

export function build_runtime_activity_views(
  runs: RuntimeActivityRun[],
  options: {
    now_ms?: number;
    workflow_label_by_id?: Record<string, string>;
  } = {},
): RuntimeActivityView[] {
  const now_ms = options.now_ms ?? Date.now();
  const workflow_label_by_id = options.workflow_label_by_id ?? {};
  return runs.map((run) =>
    runtime_activity_view(run, {
      now_ms,
      workflow_label: workflow_label_by_id[String(run.workflow_id || "")] || String(run.workflow_id || ""),
    })
  );
}

export function count_runtime_activity_queues(views: RuntimeActivityView[]): RuntimeActivityCounts {
  const counts: RuntimeActivityCounts = {
    attention: 0,
    user_wait: 0,
    tool_approval: 0,
    running: 0,
    failed: 0,
    scheduled: 0,
    finished: 0,
    all: views.length,
  };
  for (const view of views) {
    counts[view.queue] += 1;
    if (view.queue !== "finished" && (view.needs_user_action || view.status === "failed" || view.is_stale || view.wait_kind === "unknown_wait")) {
      counts.attention += 1;
    }
  }
  return counts;
}

export function filter_runtime_activity_views(
  views: RuntimeActivityView[],
  options: {
    queue: RuntimeActivityQueue;
    query?: string;
  },
): RuntimeActivityView[] {
  const queue = options.queue;
  const query = options.query ?? "";
  const q = query.trim().toLowerCase();
  return views.filter((view) => {
    if (queue === "attention") {
      if (!(view.needs_user_action || view.status === "failed" || view.is_stale || view.wait_kind === "unknown_wait")) return false;
    } else if (queue !== "all" && view.queue !== queue) {
      return false;
    }
    return !q || view.search_text.includes(q);
  });
}

export function sort_runtime_activity_views(views: RuntimeActivityView[], sort: RuntimeActivitySort): RuntimeActivityView[] {
  const out = [...views];
  out.sort((a, b) => {
    if (sort === "recent") return b.updated_ms - a.updated_ms;
    if (sort === "oldest") return a.updated_ms - b.updated_ms;
    if (sort === "duration") return b.duration_ms - a.duration_ms;
    if (sort === "tokens") return (Number(b.run.tokens_total || 0) || 0) - (Number(a.run.tokens_total || 0) || 0);
    if (sort === "workflow") return String(a.run.workflow_id || "").localeCompare(String(b.run.workflow_id || ""));
    const rank = a.attention_rank - b.attention_rank;
    if (rank !== 0) return rank;
    return b.updated_ms - a.updated_ms;
  });
  return out;
}
