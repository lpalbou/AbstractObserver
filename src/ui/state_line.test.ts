import { describe, expect, it } from "vitest";

import type { RunSummary } from "./run_status";
import {
  DEFAULT_STALL_AFTER_MS,
  card_title,
  fold_automation_brief,
  fold_pulse,
  make_context,
  pill_word,
  state_line,
  subject_of,
  workflow_short,
} from "./state_line";

const NOW = Date.parse("2026-10-13T23:50:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function run(p: Partial<RunSummary> & { run_id: string }): RunSummary {
  return { workflow_id: "basic-agent@0.0.5:81795ea9", status: "running", created_at: ago(30), updated_at: ago(10), ...p } as RunSummary;
}

const ctx = (runs: RunSummary[], extra?: any) => make_context(runs, { now_ms: NOW, ...(extra || {}) });

describe("state_line — the bare word 'waiting' never ships alone", () => {
  it("row-only reason=user is 'needs you' and marked unresolved", () => {
    const r = run({ run_id: "u1", status: "waiting", waiting: { reason: "user" } });
    const line = state_line(r, ctx([r]));
    expect(line.lane).toBe("needs_you");
    expect(line.unresolved).toBe(true);
    expect(line.actor).toBe("you");
    expect(line.text).toMatch(/^needs you: question, approval or pause · 10m/);
  });

  it("a detail with tool calls resolves to an approval with the tool names", () => {
    const r = run({ run_id: "a1", status: "waiting", waiting: { reason: "user" } });
    const details = new Map([["a1", { waiting: { reason: "user", wait_key: "k", details: { tool_calls: [{ name: "web_search" }, { name: "send_email" }] } } }]]);
    const line = state_line(r, ctx([r], { details }));
    expect(line.action).toBe("approve");
    expect(line.text).toMatch(/^needs your approval: web_search, send_email/);
    expect(line.unresolved).toBe(false);
  });

  it("a question carries its prompt", () => {
    const r = run({ run_id: "q1", status: "waiting", waiting: { reason: "user", prompt: "Which account should I use?" } });
    const line = state_line(r, ctx([r]));
    expect(line.action).toBe("answer");
    expect(line.text).toMatch(/^asks: Which account should I use\?/);
  });

  it("a pause is yours to resume, never a question", () => {
    const r = run({ run_id: "p1", status: "waiting", waiting: { reason: "user", wait_key: "pause:p1", details: { kind: "pause" } } });
    const line = state_line(r, ctx([r]));
    expect(line.verb).toBe("paused");
    expect(line.lane).toBe("needs_you");
    expect(line.action).toBe("resume");
    const row_paused = run({ run_id: "p2", status: "waiting", paused: true, waiting: { reason: "user" } });
    expect(state_line(row_paused, ctx([row_paused])).verb).toBe("paused");
  });

  it("a parent parked on a RUNNING child is working and inherits the child's open step and staleness", () => {
    const parent = run({ run_id: "occ", status: "waiting", role: "occurrence", occurrence_index: 5, waiting: { reason: "subworkflow" }, updated_at: ago(38) });
    const child = run({ run_id: "kid", parent_run_id: "occ", role: "descendant", workflow_id: "visual_react_agent_x_node-2", status: "running", updated_at: ago(38), ledger_len: 1 });
    const pulses = new Map([["kid", fold_pulse("kid", 1, { node_id: "reason", status: "started", effect: { type: "llm_call" }, started_at: ago(38), ended_at: null })!]]);
    const line = state_line(parent, ctx([parent, child], { pulses }));
    expect(line.verb).toBe("running");
    expect(line.lane).toBe("working");
    expect(line.actor).toBe("run");
    expect(line.actor_run_id).toBe("kid");
    expect(line.stalled).toBe(true);
    expect(line.text).toBe("running subrun visual_react_agent_x_node-2 · llm_call open 38m · no progress");
  });

  it("the pill says running when the sentence says running subrun (P5)", () => {
    const parent = run({ run_id: "occ", status: "waiting", waiting: { reason: "subworkflow" } });
    const child = run({ run_id: "kid", parent_run_id: "occ", status: "running", updated_at: ago(1) });
    const line = state_line(parent, ctx([parent, child]));
    expect(pill_word(parent, line)).toBe("running");
    const parked = run({ run_id: "p", status: "waiting", waiting: { reason: "until", until: new Date(NOW + 60_000).toISOString() } });
    expect(pill_word(parked, state_line(parked, ctx([parked])))).toBe("waiting");
    // A controller's wake wait is the automation sleeping, never a bare "waiting" pill.
    const ctl = run({ run_id: "c", role: "controller", status: "waiting", waiting: { reason: "event", until: new Date(NOW + 60_000).toISOString() } });
    expect(pill_word(ctl, state_line(ctl, ctx([ctl])))).toBe("scheduled");
    expect(pill_word(ctl, state_line(ctl, ctx([ctl])), null, { status: "paused" } as any)).toBe("paused");
    // A pause read from the detail (rows say paused=false) still reads paused on the pill.
    const paused = run({ run_id: "pp", status: "waiting", waiting: { reason: "user", wait_key: "pause:pp" } });
    expect(pill_word(paused, state_line(paused, ctx([paused])))).toBe("paused");
    // A legacy schedule asleep on the clock is Scheduled.
    const legacy = run({ run_id: "ls", status: "waiting", is_scheduled: true, waiting: { reason: "until", until: new Date(NOW + 3_600_000).toISOString() } });
    expect(state_line(legacy, ctx([legacy])).lane).toBe("scheduled");
  });

  it("a parent whose child is itself parked waits on what the child waits on", () => {
    const parent = run({ run_id: "occ", status: "waiting", waiting: { reason: "subworkflow" } });
    const child = run({ run_id: "kid", parent_run_id: "occ", status: "waiting", waiting: { reason: "user", prompt: "Approve the draft?" } });
    const line = state_line(parent, ctx([parent, child]));
    expect(line.lane).toBe("waiting_on");
    // The nested child sentence is the child's BRIEF: the prompt is never quoted twice over.
    expect(line.text).toBe("waiting for subrun basic-agent 0.0.5: asks a question · 10m");
    expect(state_line(child, ctx([parent, child])).brief).toBe("asks a question · 10m");
    expect(state_line(child, ctx([parent, child])).text).toBe("asks: Approve the draft? · 10m");
    expect(line.actor_run_id).toBe("kid");
  });

  it("a parent with no visible child says so without inventing one", () => {
    const parent = run({ run_id: "occ", status: "waiting", waiting: { reason: "subworkflow" } });
    const line = state_line(parent, ctx([parent]));
    expect(line.text).toBe("waiting for a subrun to finish · 10m");
    expect(line.actor).toBe("run");
  });

  it("a running run shows its last-touch age and stalls past the threshold", () => {
    const fresh = run({ run_id: "r1", status: "running", updated_at: ago(1) });
    const fresh_line = state_line(fresh, ctx([fresh]));
    expect(fresh_line.text).toBe("running · last step 1m ago");
    expect(fresh_line.stalled).toBe(false);
    const stale = run({ run_id: "r2", status: "running", updated_at: ago(6) });
    const stale_line = state_line(stale, ctx([stale]));
    expect(stale_line.stalled).toBe(true);
    expect(stale_line.text).toBe("running · last step 6m ago · no progress");
    expect(DEFAULT_STALL_AFTER_MS).toBe(5 * 60_000);
    const custom = state_line(stale, ctx([stale], { stall_after_ms: 10 * 60_000 }));
    expect(custom.stalled).toBe(false);
  });

  it("a finished pulse is a touch, not an open step", () => {
    const r = run({ run_id: "r3", status: "running", updated_at: ago(8) });
    const pulses = new Map([["r3", fold_pulse("r3", 4, { node_id: "n", status: "completed", effect: { type: "tool_calls" }, started_at: ago(3), ended_at: ago(2) })!]]);
    const line = state_line(r, ctx([r], { pulses }));
    expect(line.open_step).toBe("");
    expect(line.stalled).toBe(false);
    expect(line.text).toBe("running · last step 2m ago");
  });

  it("clock and event waits name the clock and the event", () => {
    const until = new Date(NOW + 72 * 60_000).toISOString();
    const sleeping = run({ run_id: "s1", status: "waiting", waiting: { reason: "until", until } });
    const s = state_line(sleeping, ctx([sleeping]));
    expect(s.actor).toBe("clock");
    expect(s.lane).toBe("waiting_on");
    expect(s.text).toMatch(/^sleeps until \d\d:\d\d UTC \(in 1h 12m\)$/);
    const ev = run({ run_id: "e1", status: "waiting", waiting: { reason: "event", details: { event: "inbox.message" } } });
    const e = state_line(ev, ctx([ev]));
    expect(e.actor).toBe("external");
    expect(e.text).toBe("waiting for event inbox.message · 10m");
    const job = run({ run_id: "j1", status: "waiting", waiting: { reason: "job" } });
    expect(state_line(job, ctx([job])).text).toBe("waiting for a delegated tool job · 10m");
  });

  it("an event wait that carries a prompt is a question for you (runtime WAIT_EVENT with a human prompt; GATE-1 M11 pin)", () => {
    const r = run({ run_id: "ep", status: "waiting", waiting: { reason: "event", prompt: "Reply to continue", wait_key: "evt:1" } });
    const line = state_line(r, ctx([r]));
    expect(line.lane).toBe("needs_you");
    expect(line.action).toBe("answer");
    expect(line.text).toBe("asks: Reply to continue · 10m");
    expect(line.brief).toBe("asks a question · 10m");
  });

  it("an unknown wait says so and asks to be inspected", () => {
    const r = run({ run_id: "x1", status: "waiting", waiting: { reason: "weird", wait_key: "k9" } });
    const line = state_line(r, ctx([r]));
    expect(line.actor).toBe("unknown");
    expect(line.action).toBe("inspect");
    expect(line.text).toBe("waiting, reason unknown (k9) · 10m · inspect");
  });

  it("a controller is the automation's card: Scheduled, with next/last/turns when the brief is known", () => {
    const until = new Date(NOW + 20 * 3_600_000).toISOString();
    const c = run({ run_id: "auto1", role: "controller", session_kind: "automation", automation_id: "auto1", status: "waiting", waiting: { reason: "event", until } });
    const bare = state_line(c, ctx([c]));
    expect(bare.lane).toBe("scheduled");
    expect(bare.text).toBe("next run in 20h 0m");
    const brief = fold_automation_brief({
      summary: { automation_id: "auto1", title: "Nightly digest", status: "active", trigger: { source_id: "schedule", config: { every: "24h" } }, next_fire_at: until, occurrence_count: 5, last_occurrence: { index: 4, status: "completed", fired_at: ago(60) }, capabilities: ["revise"] },
      definition: { target: { input_data: { prompt: "do x", tools: ["web_search"], model: "m", provider: "mlx", max_iterations: 20 } }, policy: { tool_approval: "auto" }, notify: { channels: ["console"] }, context: { mode: "growing" } },
    })!;
    const line = state_line(c, ctx([c], { automations: new Map([["auto1", brief]]) }));
    expect(line.text).toBe("next run in 20h 0m · last #4 completed · 5 turns");
    const busy = { ...brief, current: { index: 5, run_id: "occ5", status: "running" } };
    expect(state_line(c, ctx([c], { automations: new Map([["auto1", busy]]) })).text).toBe("run #5 in progress · next run in 20h 0m · last #4 completed · 5 turns");
    const paused = { ...brief, status: "paused" };
    expect(state_line(c, ctx([c], { automations: new Map([["auto1", paused]]) })).text).toMatch(/^paused: scheduled runs are skipped/);
  });

  it("terminal runs read their outcome", () => {
    const ok = run({ run_id: "d1", status: "completed", created_at: ago(20), updated_at: ago(11) });
    expect(state_line(ok, ctx([ok])).text).toBe("completed in 9m");
    const bad = run({ run_id: "d2", status: "failed", error: "provider timeout" });
    const b = state_line(bad, ctx([bad]));
    expect(b.lane).toBe("done");
    expect(b.text).toBe("failed: provider timeout");
    const stopped = run({ run_id: "d3", status: "completed", stop_reason: { finished: false } } as any);
    expect(state_line(stopped, ctx([stopped])).text).toBe("stopped before the turn finished");
    expect(state_line(run({ run_id: "d4", status: "cancelled" }), ctx([])).text).toBe("cancelled");
  });
});

describe("subject and title", () => {
  it("an occurrence belongs to its automation; the title is the automation's", () => {
    const brief = fold_automation_brief({ summary: { automation_id: "a", title: "Nightly digest", trigger: { source_id: "schedule", config: { every: "24h" } } }, definition: {} })!;
    const r = run({ run_id: "o", role: "occurrence", occurrence_index: 5, automation_id: "a", session_kind: "automation" });
    const c = ctx([r], { automations: new Map([["a", brief]]) });
    const s = subject_of(r, c);
    expect(s.kind).toBe("automation");
    expect(s.glyph).toBe("⟳");
    expect(s.label).toBe("Nightly digest");
    expect(s.secondary).toBe("run #5");
    expect(card_title(r, c)).toEqual({ text: "Nightly digest", source: "automation", untitled: false });
  });

  it("a plain run takes its task excerpt, never an occurrence's framed prompt; untitled is said", () => {
    const plain = run({ run_id: "p", session_id: "s-1" });
    expect(card_title(plain, ctx([plain]), { run_id: "p", excerpt: "Summarise the inbox and draft replies" })).toEqual({ text: "Summarise the inbox and draft replies", source: "excerpt", untitled: false });
    expect(card_title(plain, ctx([plain]), null)).toEqual({ text: "basic-agent 0.0.5", source: "workflow", untitled: true });
    const occ = run({ run_id: "o", role: "occurrence", automation_id: "a", session_kind: "automation" });
    expect(card_title(occ, ctx([occ]), { run_id: "o", excerpt: "[Trigger schedule@1 · occurrence 5] do x" }).source).toBe("workflow");
    const wired = run({ run_id: "w", brief: { title: "From the wire" } } as any);
    expect(card_title(wired, ctx([wired])).source).toBe("brief");
  });

  it("session runs are agents; workflow ids shorten mechanically", () => {
    const r = run({ run_id: "p", session_id: "3f2a9b8c-1234-5678-9abc-def012345678" });
    const s = subject_of(r, ctx([r]));
    expect(s.kind).toBe("agent");
    // Ids never as text (GATE-1 finding 8): the word, the id behind a hint.
    expect(s.label).toBe("session");
    expect(s.id_hint).toBe("3f2a9b8c-1234-5678-9abc-def012345678");
    expect(workflow_short("basic-agent@0.0.5:81795ea9")).toBe("basic-agent 0.0.5");
    expect(workflow_short("abstractframework.automation-controller@1.0.0:controller")).toBe("automation-controller 1.0.0");
    expect(workflow_short("visual_react_agent_basic-agent_0_0_5_81795ea9_node-2")).toBe("visual_react_agent_basic-agent_0_0_5_81795ea9_node-2");
  });
});

describe("fold_automation_brief", () => {
  it("reads the live shape and marks revise", () => {
    const b = fold_automation_brief({
      active_revision: 1,
      summary: { automation_id: "e307", title: "you are an expert…", status: "active", trigger: { source_id: "schedule", config: { every: "24h" } }, context_mode: "growing", growing_max_tokens: 100000, next_fire_at: "2026-10-14T23:06:22Z", current_occurrence: { index: 5, run_id: "02c4", attempt: 1, status: "running" }, occurrence_count: 5, last_occurrence: { run_id: "02c4", index: 5, status: "running", attempts: 1, fired_at: "2026-10-13T23:06:22Z" }, capabilities: ["pause", "revise"], workspace_root: "/ws" },
      definition: { title: "you are an expert…", target: { input_data: { prompt: "you are an expert at…", model: "Qwen", provider: "mlx", tools: ["web_search", "fetch_url"], max_iterations: 20 } }, policy: { tool_approval: "auto" }, notify: { channels: ["console", "email"] } },
    })!;
    expect(b.cadence).toBe("every 24h");
    expect(b.tools).toEqual(["web_search", "fetch_url"]);
    expect(b.can_revise).toBe(true);
    expect(b.current?.index).toBe(5);
    expect(b.last?.index).toBe(5);
    expect(b.task).toBe("you are an expert at…");
    expect(b.allowed_tools).toBeNull();
    expect(b.workspace_access_mode).toBe("");
    expect(fold_automation_brief({})).toBeNull();
    const full = fold_automation_brief({
      summary: { automation_id: "x" },
      definition: { target: { input_data: { workspace_access_mode: "workspace_only", _runtime: { allowed_tools: ["web_search"] } } }, policy: { untrusted_input_tools: [], email_allowed_recipients: ["self"] } },
    })!;
    expect(full.allowed_tools).toEqual(["web_search"]);
    expect(full.untrusted_input_tools).toEqual([]);
    expect(full.email_allowed_recipients).toEqual(["self"]);
    expect(full.workspace_access_mode).toBe("workspace_only");
  });
});

describe("a parent parked on a subrun the listing no longer has (operator 2026-10-16 01:31: 'waiting on what? from what?')", () => {
  const NOW = Date.parse("2026-10-16T00:00:00Z");
  const parent = { run_id: "p1", workflow_id: "multiagent-coding@0.0.13:abc", status: "waiting", waiting: { reason: "subworkflow" }, created_at: "2026-07-30T07:54:00Z", updated_at: "2026-07-30T07:54:00Z" } as any;
  const detail = { waiting: { reason: "subworkflow", wait_key: "subworkflow:sub1", details: { sub_run_id: "sub1", sub_workflow_id: "coding-agent@0.2.4:x" } } };

  it("without the detail it can only say a subrun; with it, the subrun; with the subrun's fate, STUCK in Needs you", () => {
    const bare = state_line(parent, make_context([parent], { now_ms: NOW }));
    expect(bare.text).toMatch(/^waiting for a subrun to finish/);
    expect(bare.lane).toBe("waiting_on");
    const named = state_line(parent, make_context([parent], { now_ms: NOW, details: new Map([["p1", detail]]) }));
    expect(named.text).toMatch(/^waiting for its subrun sub1 to finish/);
    expect(named.actor_run_id).toBe("sub1");
    expect(named.action).toBe("open_subrun");
    const fates = new Map([["sub1", { run_id: "sub1", status: "cancelled", updated_at: "2026-10-15T22:52:45Z", workflow_id: "coding-agent@0.2.4:x", error: "Cancelled" }]]);
    const stuck = state_line(parent, make_context([parent], { now_ms: NOW, details: new Map([["p1", detail]]), fates }));
    expect(stuck.text).toBe("stuck: subrun x was cancelled 1h 7m ago, this run was not resumed · 77d 16h");
    expect(stuck.stuck_facts).toMatchObject({ subrun: "x", status: "cancelled" });
    expect(stuck.stuck_facts?.ended_ms).toBeGreaterThan(60 * 60_000);
    // With the detail's current_node, the subrun is named by the STEP that waits on it.
    const with_step = state_line(parent, make_context([parent], { now_ms: NOW, details: new Map([["p1", { ...detail, current_node: "builder" }]]), fates }));
    expect(with_step.text).toBe("stuck: subrun builder was cancelled 1h 7m ago, this run was not resumed · 77d 16h");
    expect(stuck.lane).toBe("needs_you");
    expect(stuck.verb).toBe("needs_you");
    expect(stuck.actor).toBe("you");
    expect(stuck.stuck).toBe(true);
    // Within the grace window the runner is still expected to resume it: Working, the runtime's move.
    const fresh = new Map([["sub1", { run_id: "sub1", status: "completed", updated_at: new Date(NOW - 12_000).toISOString(), workflow_id: "coding-agent@0.2.4:x", error: "" }]]);
    const resuming = state_line(parent, make_context([parent], { now_ms: NOW, details: new Map([["p1", detail]]), fates: fresh }));
    expect(resuming.text).toMatch(/^its subrun x completed 12s ago · resuming/);
    expect(resuming.lane).toBe("working");
    expect(resuming.actor).toBe("runtime");
    expect(resuming.stuck).toBeUndefined();
    // A subrun the gateway no longer has (404 → fate "missing") is stuck too, and says so.
    const missing = new Map([["sub1", { run_id: "sub1", status: "missing", updated_at: "", workflow_id: "", error: "not found" }]]);
    const gone = state_line(parent, make_context([parent], { now_ms: NOW, details: new Map([["p1", detail]]), fates: missing }));
    expect(gone.text).toMatch(/^stuck: subrun sub1 no longer exists/);
    expect(gone.stuck_facts).toEqual({ subrun: "sub1", status: "missing", ended_ms: null });
    expect(gone.lane).toBe("needs_you");
    // A fate that is not terminal (the subrun is alive beyond the listing's cap) is not stuck.
    const alive = new Map([["sub1", { run_id: "sub1", status: "running", updated_at: "2026-10-15T23:59:00Z", workflow_id: "coding-agent@0.2.4:x", error: "" }]]);
    expect(state_line(parent, make_context([parent], { now_ms: NOW, details: new Map([["p1", detail]]), fates: alive })).text).toMatch(/^waiting for its subrun x to finish/);
    // A live child in the listing wins over the detail (the child's own sentence).
    const child = { run_id: "sub1", parent_run_id: "p1", workflow_id: "coding-agent@0.2.4:x", status: "running", updated_at: "2026-10-15T23:59:30Z" } as any;
    expect(state_line(parent, make_context([parent, child], { now_ms: NOW, details: new Map([["p1", detail]]), fates })).lane).toBe("working");
  });
});

describe("readable run names (operator 2026-10-16 02:36: 'at least use the label of the step')", () => {
  it("a bundle flow reads by its flow, a hash-id flow by its bundle, a generated subworkflow by its node; the title keeps the whole id", async () => {
    const { run_display_name, run_display_title } = await import("./state_line");
    expect(run_display_name("multiagent-coding@0.0.13:multiagent-coder")).toBe("multiagent-coder");
    expect(run_display_name("multiagent-coding@0.0.13:multiagent-coding")).toBe("multiagent-coding");
    expect(run_display_name("basic-agent@0.0.5:81795ea9")).toBe("basic-agent");
    expect(run_display_name("visual_react_agent_multiagent-coding_0_0_13_multiagent-coding_scout_code")).toBe("scout_code");
    expect(run_display_name("visual_react_agent_multiagent-coding_0_0_14_multiagent-coding_builder")).toBe("builder");
    expect(run_display_name("visual_react_agent_basic-agent_0_0_5_81795ea9_node-2")).toBe("node-2");
    expect(run_display_name("visual_react_agent_x_node-2")).toBe("x_node-2");
    expect(run_display_name("")).toBe("");
    expect(run_display_title("basic-agent@0.0.5:81795ea9")).toBe("basic-agent 0.0.5 — basic-agent@0.0.5:81795ea9");
  });
});
