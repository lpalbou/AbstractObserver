/**
 * STATE LINES — the one vocabulary every Observer surface uses to say what a
 * run IS DOING (backlog 0003, operator 2026-10-14: "waiting with no object is
 * not actionable, neither by a human nor by an AI").
 *
 * Rules carried in (design P3/P5/P6):
 * - A state is a SENTENCE with an OBJECT and an ACTOR: `waiting for <object>`
 *   plus who ends it (you · another run · the clock · an external system ·
 *   unknown) plus the one action that follows. The bare word "waiting" is
 *   never emitted by this module.
 * - One truth per run: a parent parked on its OWN child is working when the
 *   child is working (the gateway's `_live_status` reading), and inherits
 *   the child's staleness.
 * - Progress is data, shown always: a running line carries the age of the
 *   run's last ledger touch and, when a pulse is known, the open step and
 *   how long it has been open. "Stalled" is the age crossing a VISIBLE
 *   threshold, never an inference from prose.
 * - Row-only inputs are honest about what rows lack: a `reason=user` row
 *   cannot tell a question from an approval from a pause (the index keeps
 *   only reason/until), so the line says so (`unresolved`) until a detail
 *   resolves it.
 *
 * Pure functions, no React, no fetch: the board, the Agent page and the tree
 * all fold the same wire rows through here.
 */
import { extract_tool_calls_from_wait } from "../lib/runtime_extractors";
import type { WaitState } from "../lib/types";
import { format_time_until_from_ms, parse_iso_ms, terminal_run_status } from "./format";
import { run_status_word, type RunSummary, type StopReason } from "./run_status";

export type SubjectKind = "automation" | "agent" | "entity" | "run";
export type Actor = "you" | "run" | "clock" | "external" | "runtime" | "unknown" | "none";
export type Verb = "running" | "needs_you" | "paused" | "waiting" | "scheduled" | "done";
export type StateAction = "approve" | "answer" | "resume" | "open_run" | "open_subrun" | "inspect" | "none";
export type BoardLane = "needs_you" | "working" | "waiting_on" | "scheduled" | "done";

/** The last ledger record of a run (one bounded read per running run). */
export type RunPulse = {
  run_id: string;
  ledger_len: number;
  node_id: string;
  effect: string;
  status: string;
  started_ms: number | null;
  ended_ms: number | null;
};

/** What ONE `GET /automations/{id}` call carries that cards and popovers need. */
export type AutomationBrief = {
  automation_id: string;
  title: string;
  status: string;
  /** "every 24h" / "manual" / "on email" — the trigger as words. */
  cadence: string;
  next_fire_ms: number | null;
  last: { index: number; status: string; fired_ms: number | null; finished_ms: number | null } | null;
  occurrence_count: number;
  current: { index: number; run_id: string; status: string } | null;
  context_mode: string;
  growing_max_tokens: number | null;
  model: string;
  provider: string;
  tools: string[];
  max_iterations: number | null;
  tool_approval: string;
  /** `definition.target.input_data._runtime.allowed_tools` (null = not on the wire). */
  allowed_tools: string[] | null;
  /** `definition.policy.untrusted_input_tools` / `email_allowed_recipients` (null = not on the wire). */
  untrusted_input_tools: string[] | null;
  email_allowed_recipients: string[] | null;
  /** `definition.target.input_data.workspace_access_mode`. */
  workspace_access_mode: string;
  notify_channels: string[];
  task: string;
  workspace_root: string;
  /** `revise` in the summary's capabilities — the "Name it" affordance. */
  can_revise: boolean;
  /** The summary's `capabilities` verbatim (the card's footer gates on them like the Automations page). */
  capabilities: string[];
  /** `legacy: true` rows are managed with their own controls. */
  legacy: boolean;
  /** The gateway's served schedule words (`schedule_rule_text`: "Every 24 hours (UTC)"); "" when not served. */
  schedule_rule_text: string;
  /** The served next run in the owner's zone (`next_run_local`, ISO); "" when none. */
  next_run_local: string;
  /** Why the gateway paused it (`paused_reason`), "" otherwise. */
  paused_reason: string;
  /** The token size of the session history the last occurrence was handed
   * (`context_used_tokens`, read from that run's history-window receipt); null when unrecorded. */
  context_used_tokens: number | null;
  /** The last occurrence's run id, and the first words of its answer / the last notification line. */
  last_run_id: string;
  last_excerpt: string;
  last_notification_text: string;
};

/** The task excerpt of a plain run (from `GET /runs/{id}/input_data`). */
export type RunBrief = { run_id: string; excerpt: string };

export type StateContext = {
  by_id: Map<string, RunSummary>;
  children_of: Map<string, RunSummary[]>;
  /** `GET /runs/{id}` bodies when known (full `waiting`, `paused`, `current_node`). */
  details?: Map<string, any>;
  /** The fates of subruns a parent waits for that the listing no longer has (board_data.useSubrunFates). */
  fates?: Map<string, { run_id: string; status: string; updated_at: string; workflow_id: string; error: string }>;
  pulses?: Map<string, RunPulse>;
  automations?: Map<string, AutomationBrief>;
  now_ms: number;
  /** A running run whose last touch is older than this is marked stalled. Default 5 min. */
  stall_after_ms?: number;
};

export type StateLine = {
  verb: Verb;
  lane: BoardLane;
  /** The object of the verb ("approval: web_search", "subrun X", "an event"). */
  object: string;
  actor: Actor;
  /** The run that ends the wait when actor === "run". */
  actor_run_id: string;
  action: StateAction;
  /** When this state began (the park/update write), epoch ms. */
  since_ms: number | null;
  /** Age of the last ledger touch for running states (inherited from the child when running a subrun). */
  stale_ms: number | null;
  stalled: boolean;
  /** "llm_call open 38m" when a pulse is known, else "". */
  open_step: string;
  /** Row-only `reason=user`: question, approval or pause — unknown until the detail is read. */
  unresolved: boolean;
  /** The run waits on a subrun that already ended and was never resumed (only you can move it). */
  stuck?: boolean;
  /** The facts behind `stuck`, for the card's attention block: the subrun's name (the step that
   * waited on it), how it ended, and how long ago. */
  stuck_facts?: { subrun: string; status: string; ended_ms: number | null };
  /** The rendered sentence. */
  text: string;
  /** The sentence without the quoted prompt ("asks a question · 23m") — for a
   * card whose body shows the prompt in full, so it is never printed twice. */
  brief: string;
};

export const DEFAULT_STALL_AFTER_MS = 5 * 60_000;

// --- indexing ----------------------------------------------------------------------

export function index_runs(runs: RunSummary[]): { by_id: Map<string, RunSummary>; children_of: Map<string, RunSummary[]> } {
  const by_id = new Map<string, RunSummary>();
  const children_of = new Map<string, RunSummary[]>();
  for (const r of runs || []) {
    const rid = String(r?.run_id || "").trim();
    if (!rid) continue;
    by_id.set(rid, r);
  }
  for (const r of by_id.values()) {
    const pid = String(r?.parent_run_id || "").trim();
    if (!pid) continue;
    const list = children_of.get(pid) || [];
    list.push(r);
    children_of.set(pid, list);
  }
  return { by_id, children_of };
}

export function make_context(runs: RunSummary[], extra?: Partial<Omit<StateContext, "by_id" | "children_of">>): StateContext {
  const { by_id, children_of } = index_runs(runs);
  return { by_id, children_of, now_ms: Date.now(), ...(extra || {}) };
}

// --- helpers -----------------------------------------------------------------------

function wait_of(run: RunSummary, ctx: StateContext): WaitState | null {
  const detail = ctx.details?.get(String(run?.run_id || ""));
  const w = (detail?.waiting ?? run?.waiting) as any;
  return w && typeof w === "object" ? (w as WaitState) : null;
}

function reason_of(run: RunSummary, wait: WaitState | null): string {
  return String(wait?.reason || run?.waiting_reason || "").trim().toLowerCase();
}

function is_paused(run: RunSummary, ctx: StateContext, wait: WaitState | null): boolean {
  const detail = ctx.details?.get(String(run?.run_id || ""));
  if (run?.paused === true || detail?.paused === true) return true;
  if (String(wait?.wait_key || "").startsWith("pause:")) return true;
  const kind = String((wait?.details as any)?.kind || "").trim().toLowerCase();
  return kind === "pause";
}

function has_human_prompt(wait: WaitState | null): boolean {
  if (!wait) return false;
  if (String(wait.prompt || "").trim()) return true;
  return Array.isArray(wait.choices) && wait.choices.length > 0;
}

function updated_ms(run: RunSummary): number | null {
  return parse_iso_ms(run?.updated_at || run?.created_at || "");
}

/** Compact age/duration for cards: "42s", "10m", "1h 12m", "2d 3h" (format_duration_ms keeps seconds). */
export function compact_duration(ms: number): string {
  const total_s = Math.max(0, Math.floor(ms / 1000));
  const total_m = Math.floor(total_s / 60);
  const total_h = Math.floor(total_m / 60);
  const d = Math.floor(total_h / 24);
  if (d > 0) return `${d}d ${total_h % 24}h`;
  if (total_h > 0) return `${total_h}h ${total_m % 60}m`;
  if (total_m > 0) return `${total_m}m`;
  return `${total_s}s`;
}

function age(ms: number | null, now_ms: number): string {
  if (ms === null) return "";
  return compact_duration(now_ms - ms);
}

function clock_text(until_ms: number | null, now_ms: number): string {
  if (until_ms === null) return "";
  const when = new Date(until_ms).toISOString().slice(11, 16);
  const delta = until_ms - now_ms;
  return delta > 0 ? `${when} UTC (in ${format_time_until_from_ms(delta)})` : `${when} UTC (due)`;
}

function clamp(text: string, n: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** How long after a subrun's end its parent may still be waiting before the board calls it
 * stuck: the gateway runner's repair pass resumes such parents every poll, and its apply
 * latency reached 41 s under load (2026-10-15 cancel wave). */
export const STUCK_GRACE_MS = 60_000;

/** The most recently updated non-terminal child of a run (rows carry no `details.sub_run_id`). */
export function live_child_of(run: RunSummary, ctx: StateContext): RunSummary | null {
  const wait = wait_of(run, ctx);
  const sub = String((wait?.details as any)?.sub_run_id || "").trim();
  if (sub && ctx.by_id.has(sub)) return ctx.by_id.get(sub) || null;
  const kids = ctx.children_of.get(String(run?.run_id || "")) || [];
  const live = kids.filter((k) => !terminal_run_status(String(k?.status || "")));
  if (!live.length) return null;
  live.sort((a, b) => (updated_ms(b) ?? 0) - (updated_ms(a) ?? 0));
  return live[0];
}

/** The READABLE name of a run's workflow (operator 2026-10-16 02:36: "multiagent-coding 0.0.13
 * waits for ↓ └ multiagent-coding 0.0.13 … is absolutely not readable; at least use the label of
 * the step"): a bundle flow reads by its FLOW name ("multiagent-coder", "multiagent-coding"), a
 * generated subworkflow id by the NODE it was spawned from ("builder" out of
 * `visual_react_agent_<bundle>_<v>_<v>_<v>_<flow>_<node>`); the version and the raw id stay in
 * `run_display_title` for the tooltip. */
export function run_display_name(workflow_id: string): string {
  const wf = String(workflow_id || "").trim();
  if (!wf) return "";
  const gen = wf.match(/^visual_react_agent_(.+)$/);
  if (gen) {
    const rest = gen[1];
    const m = rest.match(/^(.+?)_(\d+)_(\d+)_(\d+)_(.+)$/);
    if (m) {
      const bundle = m[1];
      let tail = m[5];
      if (tail.startsWith(`${bundle}_`)) tail = tail.slice(bundle.length + 1);
      else tail = tail.replace(/^[^_]+_/, "");
      return tail || rest;
    }
    return rest;
  }
  const at = wf.indexOf("@");
  const colon = wf.indexOf(":", at < 0 ? 0 : at);
  const bundle = at >= 0 ? wf.slice(0, at) : colon >= 0 ? wf.slice(0, colon) : wf;
  const flow = colon >= 0 ? wf.slice(colon + 1) : "";
  // A hash-like flow id names nothing: the bundle does.
  if (flow && !/^[0-9a-f]{8,}$/i.test(flow)) return flow;
  return bundle || workflow_short(wf);
}

/** The tooltip behind a display name: the whole id, with the version spelled out. */
export function run_display_title(workflow_id: string): string {
  const wf = String(workflow_id || "").trim();
  const short = workflow_short(wf);
  return short && short !== wf ? `${short} — ${wf}` : wf;
}

/** The step of a parked parent that waits on its subrun: the detail's `current_node`
 * (the row's is cleared while parked), else "". */
export function waiting_step_of(run: RunSummary, ctx: StateContext): string {
  const rid = String(run?.run_id || "");
  return String(ctx.details?.get(rid)?.current_node || run?.current_node || "").trim();
}

/** Mechanical shortening of a workflow id: "basic-agent@0.0.5:81795ea9" → "basic-agent 0.0.5". Not prose. */
export function workflow_short(workflow_id: string): string {
  const raw = String(workflow_id || "").trim();
  if (!raw) return "";
  const no_flow = raw.includes("@") ? raw.split(":")[0] : raw;
  const [name, version] = no_flow.split("@");
  const base = String(name || "").split(".").pop() || name || "";
  return version ? `${base} ${version}` : base;
}

export function short_run_id(run_id: string): string {
  const s = String(run_id || "").trim();
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

// --- the line ------------------------------------------------------------------------

export function state_line(run: RunSummary, ctx: StateContext, depth = 0): StateLine {
  const line = state_line_raw(run, ctx, depth);
  return { ...line, brief: line.brief || line.text };
}

function state_line_raw(run: RunSummary, ctx: StateContext, depth = 0): StateLine {
  const now_ms = ctx.now_ms;
  const stall_after = typeof ctx.stall_after_ms === "number" ? ctx.stall_after_ms : DEFAULT_STALL_AFTER_MS;
  const rid = String(run?.run_id || "").trim();
  const status = String(run?.status || "").trim().toLowerCase();
  const wait = wait_of(run, ctx);
  const reason = reason_of(run, wait);
  const since = updated_ms(run);
  const role = String(run?.role || "").trim();
  const base: StateLine = {
    verb: "waiting",
    lane: "waiting_on",
    object: "",
    actor: "unknown",
    actor_run_id: "",
    action: "inspect",
    since_ms: since,
    stale_ms: null,
    stalled: false,
    open_step: "",
    unresolved: false,
    text: "",
    brief: "",
  };
  const ago = age(since, now_ms);
  const tail = ago ? ` · ${ago}` : "";

  // Terminal first: the outcome is the sentence.
  if (terminal_run_status(status)) {
    const word = run_status_word(run as any);
    const err = String((run as any)?.error || "").trim();
    const detail = ctx.details?.get(rid);
    const started = parse_iso_ms(run?.created_at || "");
    const ended = parse_iso_ms(run?.updated_at || "");
    const took = started !== null && ended !== null && ended >= started ? compact_duration(ended - started) : "";
    let text = word;
    if (word === "failed") text = err ? `failed: ${clamp(err, 120)}` : "failed";
    else if (word === "completed") text = took ? `completed in ${took}` : "completed";
    else if (word === "stopped") text = "stopped before the turn finished";
    else if (word === "cancelled") text = "cancelled";
    const detail_err = String(detail?.error || "").trim();
    if (word === "failed" && !err && detail_err) text = `failed: ${clamp(detail_err, 120)}`;
    return { ...base, verb: "done", lane: "done", object: text, actor: "none", action: "open_run", text };
  }

  // Automation controllers are the automation's own card: always Scheduled.
  if (role === "controller") {
    const brief = ctx.automations?.get(String(run?.automation_id || rid));
    const until_ms = parse_iso_ms(wait?.until || "");
    const next_ms = brief?.next_fire_ms ?? until_ms;
    const parts: string[] = [];
    if (brief?.current && !terminal_run_status(brief.current.status)) parts.push(`run #${brief.current.index} in progress`);
    else if (reason === "subworkflow") parts.push("a run is in progress");
    if (brief?.status === "paused") parts.push("paused: scheduled runs are skipped");
    else if (next_ms !== null) parts.push(`next run in ${format_time_until_from_ms(Math.max(0, next_ms - now_ms))}`);
    else if (brief?.status === "completed" || brief?.status === "failed") parts.push(`${brief.status}: no next run`);
    else parts.push("next run not scheduled");
    if (brief?.last) parts.push(`last #${brief.last.index} ${brief.last.status}`);
    if (brief) parts.push(`${brief.occurrence_count} turn${brief.occurrence_count === 1 ? "" : "s"}`);
    const text = parts.join(" · ");
    return { ...base, verb: "scheduled", lane: "scheduled", object: text, actor: "clock", action: "open_run", text };
  }

  if ((run as any)?.is_draft === true) {
    const text = "draft · not started";
    return { ...base, verb: "scheduled", lane: "scheduled", object: text, actor: "none", action: "open_run", text };
  }

  if (status === "running") {
    const pulse = ctx.pulses?.get(rid) || null;
    const open = pulse && pulse.ended_ms === null && pulse.started_ms !== null ? pulse : null;
    const last_touch = Math.max(since ?? 0, pulse?.ended_ms ?? 0, pulse?.started_ms ?? 0) || null;
    const stale_ms = last_touch ? Math.max(0, now_ms - last_touch) : null;
    const stalled = stale_ms !== null && stale_ms > stall_after;
    const open_step = open ? `${open.effect || open.node_id || "step"} open ${compact_duration(now_ms - (open.started_ms as number))}` : "";
    const node = String(ctx.details?.get(rid)?.current_node || run?.current_node || "").trim();
    const parts = ["running"];
    if (node) parts.push(`step ${node}`);
    if (open_step) parts.push(open_step);
    else if (stale_ms !== null) parts.push(`last step ${compact_duration(stale_ms)} ago`);
    if (stalled) parts.push("no progress");
    return {
      ...base,
      verb: "running",
      lane: "working",
      object: open_step || node || "",
      actor: "runtime",
      action: "open_run",
      stale_ms,
      stalled,
      open_step,
      text: parts.join(" · "),
    };
  }

  if (status !== "waiting") {
    // Legacy schedules and unknown statuses: say the word the wire gave, never invent.
    if (run?.is_scheduled === true) {
      const text = run?.schedule_interval ? `scheduled · every ${run.schedule_interval}` : "scheduled";
      return { ...base, verb: "scheduled", lane: "scheduled", object: text, actor: "clock", action: "open_run", text };
    }
    const text = status ? `${status}${tail}` : "state unknown";
    return { ...base, object: text, text, action: "inspect" };
  }

  // --- waiting: the object decides the lane ---
  if (is_paused(run, ctx, wait)) {
    const text = `paused${tail} · resume when ready`;
    return { ...base, verb: "paused", lane: "needs_you", object: "paused", actor: "you", action: "resume", text };
  }

  const tool_calls = extract_tool_calls_from_wait(wait);
  if (tool_calls.length) {
    const names = tool_calls.map((tc: any) => String(tc?.name || "tool").trim()).filter(Boolean);
    const shown = `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
    const text = `needs your approval: ${shown || "tool call"}${tail}`;
    return { ...base, verb: "needs_you", lane: "needs_you", object: `approval: ${shown}`, actor: "you", action: "approve", text };
  }

  if (reason === "user") {
    if (has_human_prompt(wait)) {
      const q = clamp(String(wait?.prompt || ""), 80);
      const text = q ? `asks: ${q}${tail}` : `asks a question${tail}`;
      return { ...base, verb: "needs_you", lane: "needs_you", object: q || "a question", actor: "you", action: "answer", text, brief: `asks a question${tail}` };
    }
    const resolved = ctx.details?.has(rid) === true;
    if (resolved) {
      // The detail carries no tool calls, no prompt, no pause: a free-text answer is wanted.
      const text = `waits for your answer${tail}`;
      return { ...base, verb: "needs_you", lane: "needs_you", object: "your answer", actor: "you", action: "answer", text };
    }
    const text = `needs you: question, approval or pause${tail}`;
    return { ...base, verb: "needs_you", lane: "needs_you", object: "question, approval or pause", actor: "you", action: "open_run", unresolved: true, text };
  }

  if (reason === "subworkflow") {
    const child = depth < 4 ? live_child_of(run, ctx) : null;
    if (!child) {
      // No live child in the listing: the detail names the subrun, and its fate says whether
      // this run is STUCK — the subrun ended and this run was never resumed (the gateway
      // resumes a parent when a child ends through its own tick; a cancelled child, or a
      // parent whose workflow version is gone, leaves the parent parked for good).
      const sub = String((wait?.details as any)?.sub_run_id || "").trim();
      const fate = sub ? ctx.fates?.get(sub) : undefined;
      // The subrun's name is the STEP of this run that waits on it ("builder"), else the
      // subrun's own readable name, else its id.
      const step = waiting_step_of(run, ctx);
      const sub_name = step || (fate && run_display_name(fate.workflow_id)) || short_run_id(sub);
      if (fate && fate.status === "missing") {
        // The gateway has no such run any more: nothing can end this wait but a cancel.
        const text = `stuck: subrun ${sub_name} no longer exists${tail}`;
        return { ...base, verb: "needs_you", lane: "needs_you", object: `subrun ${sub_name} (missing)`, actor: "you", action: "open_run", stuck: true, stuck_facts: { subrun: sub_name, status: "missing", ended_ms: null }, text };
      }
      if (fate && terminal_run_status(fate.status)) {
        const ended = parse_iso_ms(fate.updated_at);
        const since_ms = ended !== null ? Math.max(0, ctx.now_ms - ended) : null;
        // The runner repairs such waits every poll: give it STUCK_GRACE_MS before calling the
        // run stuck (design adversary P0-2: apply latency reached 41 s during the cancel wave).
        if (since_ms !== null && since_ms <= STUCK_GRACE_MS) {
          const text = `its subrun ${sub_name} ${fate.status} ${compact_duration(since_ms)} ago · resuming${tail}`;
          return { ...base, verb: "running", lane: "working", object: `subrun ${sub_name}`, actor: "runtime", action: "open_run", text };
        }
        const ago = since_ms !== null ? ` ${compact_duration(since_ms)} ago` : "";
        const was = fate.status === "cancelled" ? "was cancelled" : fate.status === "failed" ? "failed" : `ended ${fate.status}`;
        const text = `stuck: subrun ${sub_name} ${was}${ago}, this run was not resumed${tail}`;
        return { ...base, verb: "needs_you", lane: "needs_you", object: `subrun ${sub_name} (${fate.status})`, actor: "you", action: "open_run", stuck: true, stuck_facts: { subrun: sub_name, status: fate.status, ended_ms: since_ms }, text };
      }
      if (sub) {
        const text = `waiting for its subrun ${sub_name} to finish${tail}`;
        return { ...base, object: `subrun ${sub_name}`, actor: "run", actor_run_id: sub, action: "open_subrun", text };
      }
      const text = `waiting for a subrun to finish${tail}`;
      return { ...base, object: "a subrun", actor: "run", action: "open_run", text };
    }
    const child_line = state_line(child, ctx, depth + 1);
    const child_name = workflow_short(String(child.workflow_id || "")) || short_run_id(String(child.run_id || ""));
    if (child_line.verb === "running") {
      const parts = [`running subrun ${child_name}`];
      if (child_line.open_step) parts.push(child_line.open_step);
      else if (child_line.stale_ms !== null) parts.push(`last step ${compact_duration(child_line.stale_ms)} ago`);
      if (child_line.stalled) parts.push("no progress");
      return {
        ...base,
        verb: "running",
        lane: "working",
        object: `subrun ${child_name}`,
        actor: "run",
        actor_run_id: String(child.run_id || ""),
        action: "open_subrun",
        stale_ms: child_line.stale_ms,
        stalled: child_line.stalled,
        open_step: child_line.open_step,
        text: parts.join(" · "),
      };
    }
    // The child is itself parked: the parent waits on whatever the child waits on.
    const text = `waiting for subrun ${child_name}: ${child_line.brief || child_line.text}`;
    return {
      ...base,
      verb: "waiting",
      lane: "waiting_on",
      object: `subrun ${child_name}`,
      actor: "run",
      actor_run_id: String(child.run_id || ""),
      action: "open_subrun",
      unresolved: child_line.unresolved,
      text,
    };
  }

  if (reason === "until") {
    const until_ms = parse_iso_ms(wait?.until || "");
    const text = until_ms !== null ? `sleeps until ${clock_text(until_ms, now_ms)}` : `sleeps until an unknown time${tail}`;
    // A legacy schedule asleep on the clock starts by itself: Scheduled, not Waiting on.
    const scheduled = run?.is_scheduled === true;
    return { ...base, ...(scheduled ? { verb: "scheduled" as const, lane: "scheduled" as const } : {}), object: "the clock", actor: "clock", action: "open_run", text };
  }

  if (reason === "event") {
    if (has_human_prompt(wait)) {
      const q = clamp(String(wait?.prompt || ""), 80);
      const text = q ? `asks: ${q}${tail}` : `asks a question${tail}`;
      return { ...base, verb: "needs_you", lane: "needs_you", object: q || "a question", actor: "you", action: "answer", text, brief: `asks a question${tail}` };
    }
    const until_ms = parse_iso_ms(wait?.until || "");
    const name = String((wait?.details as any)?.event || (wait?.details as any)?.name || "").trim();
    const what = name ? `event ${name}` : "an event";
    const text = until_ms !== null ? `waiting for ${what} until ${clock_text(until_ms, now_ms)}` : `waiting for ${what}${tail}`;
    return { ...base, object: what, actor: "external", action: "open_run", text };
  }

  if (reason === "job") {
    const text = `waiting for a delegated tool job${tail}`;
    return { ...base, object: "a delegated tool job", actor: "runtime", action: "open_run", text };
  }

  const key = String(wait?.wait_key || "").trim();
  const text = `waiting, reason unknown${key ? ` (${key})` : ""}${tail} · inspect`;
  return { ...base, object: "unknown", actor: "unknown", action: "inspect", text };
}

export function board_lane(run: RunSummary, ctx: StateContext): BoardLane {
  return state_line(run, ctx).lane;
}

/** The pill word (design §card anatomy, P3/P5): "running subrun …" reads running; a run whose
 * line is paused reads paused (rows hard-code paused=false); an automation controller reads
 * scheduled — its row is parked on the wake wait, and a bare "waiting" pill on the
 * automation's own card is the word P3 forbids. */
export function pill_word(run: RunSummary, line: StateLine, stop_reason?: StopReason | null, automation?: AutomationBrief | null): string {
  if (String(run?.role || "").trim() === "controller") return automation?.status === "paused" ? "paused" : "scheduled";
  if (line.stuck) return "stuck";
  const word = run_status_word({ status: run?.status, paused: run?.paused === true || line.verb === "paused", stop_reason: stop_reason ?? null });
  return line.verb === "running" && word === "waiting" ? "running" : word;
}

// --- subject and title -----------------------------------------------------------

export type Subject = {
  kind: SubjectKind;
  glyph: string;
  /** "Nightly digest" (automation title) / "session 3f2a…" / "". */
  label: string;
  /** "occurrence #5 · basic-agent 0.0.5" — the secondary line. */
  secondary: string;
  automation_id: string;
  /** The session id behind an agent subject — for a title/copy affordance, never as text. */
  id_hint: string;
};

export const SUBJECT_GLYPH: Record<SubjectKind, string> = { automation: "⟳", agent: "◉", entity: "☗", run: "▭" };

export function subject_of(run: RunSummary, ctx: StateContext): Subject {
  const role = String(run?.role || "").trim();
  const kind_tag = String(run?.session_kind || "").trim();
  const automation_id = String(run?.automation_id || "").trim();
  const brief = automation_id ? ctx.automations?.get(automation_id) : undefined;
  const wf = workflow_short(String(run?.workflow_id || ""));
  if (role === "controller" || role === "occurrence" || role === "descendant" || role === "discussion" || kind_tag === "automation") {
    const bits: string[] = [];
    if (role === "occurrence" && typeof run?.occurrence_index === "number") bits.push(`occurrence #${run.occurrence_index}`);
    else if (role === "descendant" && typeof run?.occurrence_index === "number") bits.push(`occurrence #${run.occurrence_index} · subrun`);
    else if (role === "discussion") bits.push("discussion");
    if (wf && role !== "controller") bits.push(wf);
    if (role === "controller" && brief) bits.push(brief.cadence);
    return { kind: "automation", glyph: SUBJECT_GLYPH.automation, label: brief?.title || "", secondary: bits.join(" · "), automation_id, id_hint: automation_id };
  }
  const session = String(run?.session_id || "").trim();
  if (session) {
    const bits = [wf, String(run?.parent_run_id || "").trim() ? "subrun" : ""].filter(Boolean);
    return { kind: "agent", glyph: SUBJECT_GLYPH.agent, label: "session", secondary: bits.join(" · "), automation_id: "", id_hint: session };
  }
  return { kind: "run", glyph: SUBJECT_GLYPH.run, label: "", secondary: wf, automation_id: "", id_hint: "" };
}

export type CardTitle = { text: string; source: "automation" | "brief" | "excerpt" | "workflow"; untitled: boolean };

/** Title source order (design §card anatomy): automation title → wire brief →
 * task excerpt (plain runs only; occurrence prompts carry a `[Trigger …]`
 * framing header and are never excerpted) → workflow id, marked untitled. */
export function card_title(run: RunSummary, ctx: StateContext, brief?: RunBrief | null): CardTitle {
  const automation_id = String(run?.automation_id || "").trim();
  const auto = automation_id ? ctx.automations?.get(automation_id) : undefined;
  if (auto?.title) return { text: auto.title, source: "automation", untitled: false };
  const wire_title = String((run as any)?.brief?.title || "").trim();
  if (wire_title) return { text: wire_title, source: "brief", untitled: false };
  const wire_excerpt = String((run as any)?.brief?.task_excerpt || "").trim();
  if (wire_excerpt) return { text: clamp(wire_excerpt, 80), source: "brief", untitled: false };
  const tag = String(run?.session_kind || "").trim();
  const role = String(run?.role || "").trim();
  const is_automation_run = Boolean(automation_id) || tag === "automation" || role === "occurrence" || role === "descendant" || role === "controller";
  if (!is_automation_run && brief?.excerpt) return { text: clamp(brief.excerpt, 80), source: "excerpt", untitled: false };
  const wf = workflow_short(String(run?.workflow_id || "")) || "(workflow?)";
  return { text: wf, source: "workflow", untitled: true };
}

// --- automation brief fold ---------------------------------------------------------

function trigger_words(trigger: any): string {
  const source = String(trigger?.source_id || "").trim();
  const every = String(trigger?.config?.every || "").trim();
  if (source === "schedule") return every ? `every ${every}` : "scheduled";
  if (source === "manual") return "manual";
  if (source === "email_received") return "on email";
  return source || "";
}

/** Fold `GET /automations/{id}` (`{definition, summary, active_revision}`) into the brief. */
export function fold_automation_brief(body: any): AutomationBrief | null {
  const summary = body?.summary && typeof body.summary === "object" ? body.summary : null;
  const definition = body?.definition && typeof body.definition === "object" ? body.definition : null;
  const automation_id = String(summary?.automation_id || body?.automation_id || "").trim();
  if (!automation_id) return null;
  const input = definition?.target?.input_data && typeof definition.target.input_data === "object" ? definition.target.input_data : {};
  const last = summary?.last_occurrence && typeof summary.last_occurrence === "object" ? summary.last_occurrence : null;
  const cur = summary?.current_occurrence && typeof summary.current_occurrence === "object" ? summary.current_occurrence : null;
  const tools = Array.isArray(input?.tools) ? input.tools.map((t: any) => String(t)).filter(Boolean) : [];
  const channels = Array.isArray(definition?.notify?.channels) ? definition.notify.channels.map((c: any) => String(c)) : [];
  const caps = Array.isArray(summary?.capabilities) ? summary.capabilities.map((c: any) => String(c)) : [];
  const runtime_ns = input?._runtime && typeof input._runtime === "object" ? input._runtime : {};
  const list_or_null = (v: any): string[] | null => (Array.isArray(v) ? v.map((x: any) => String(x)).filter(Boolean) : null);
  return {
    automation_id,
    title: String(summary?.title || definition?.title || "").trim(),
    status: String(summary?.status || "").trim(),
    cadence: trigger_words(summary?.trigger || definition?.trigger),
    // The gateway's served `next_run_at` (round 16) is the one truth; a 0.13.x gateway serves only the
    // runtime's `next_fire_at` (the same fallback `served_summary.ts` makes on the Automations page).
    next_fire_ms: parse_iso_ms(summary?.next_run_at || summary?.next_fire_at || ""),
    last: last
      ? {
          index: Number(last.index || 0),
          status: String(last.status || ""),
          fired_ms: parse_iso_ms(last.fired_at || ""),
          finished_ms: parse_iso_ms(last.finished_at || ""),
        }
      : null,
    occurrence_count: typeof summary?.occurrence_count === "number" ? summary.occurrence_count : 0,
    current: cur ? { index: Number(cur.index || 0), run_id: String(cur.run_id || ""), status: String(cur.status || "") } : null,
    context_mode: String(summary?.context_mode || definition?.context?.mode || "").trim(),
    growing_max_tokens: typeof summary?.growing_max_tokens === "number" ? summary.growing_max_tokens : null,
    model: String(input?.model || "").trim(),
    provider: String(input?.provider || "").trim(),
    tools,
    max_iterations: typeof input?.max_iterations === "number" ? input.max_iterations : null,
    tool_approval: String(definition?.policy?.tool_approval || "").trim(),
    allowed_tools: list_or_null(runtime_ns.allowed_tools),
    untrusted_input_tools: list_or_null(definition?.policy?.untrusted_input_tools),
    email_allowed_recipients: list_or_null(definition?.policy?.email_allowed_recipients),
    workspace_access_mode: String(input?.workspace_access_mode || "").trim(),
    notify_channels: channels,
    task: String(input?.prompt || input?.context?.task || "").trim(),
    workspace_root: String(summary?.workspace_root || definition?.workspace_root || "").trim(),
    can_revise: caps.includes("revise"),
    capabilities: caps,
    legacy: summary?.legacy === true,
    schedule_rule_text: String(summary?.schedule_rule_text || "").trim(),
    next_run_local: String(summary?.next_run_local || "").trim(),
    paused_reason: String(summary?.paused_reason || "").trim(),
    context_used_tokens: typeof summary?.context_used_tokens === "number" && Number.isFinite(summary.context_used_tokens) && summary.context_used_tokens >= 0 ? summary.context_used_tokens : null,
    last_run_id: String(last?.run_id || "").trim(),
    last_excerpt: String(last?.excerpt || "").trim(),
    last_notification_text: String(summary?.last_notification?.text || "").trim(),
  };
}

/** Fold the last ledger record of a run into a pulse. `ledger_len` is the row's count at read time. */
export function fold_pulse(run_id: string, ledger_len: number, record: any): RunPulse | null {
  const rec = record?.record && typeof record.record === "object" ? record.record : record;
  if (!rec || typeof rec !== "object") return null;
  return {
    run_id: String(run_id || "").trim(),
    ledger_len: Number(ledger_len || 0),
    node_id: String(rec.node_id || "").trim(),
    effect: String(rec?.effect?.type || "").trim(),
    status: String(rec.status || "").trim(),
    started_ms: parse_iso_ms(rec.started_at || ""),
    ended_ms: parse_iso_ms(rec.ended_at || ""),
  };
}
