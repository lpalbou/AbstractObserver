import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_WINDOW_MS,
  BUDGET_CHOICES,
  INITIAL_BUDGET,
  SKELETON_CARDS,
  SkeletonCards,
  BoardCardView,
  CODE_INSTALL_HINT,
  CancelControlView,
  CardInfo,
  MissionControlPage,
  DEFAULT_DONE_WINDOW,
  DONE_WINDOW_LABEL,
  DONE_WINDOW_MS,
  LANE_EMPTY,
  LANE_HINT,
  LANE_LABEL,
  LANE_ORDER,
  STALL_AFTER_OPTIONS,
  STALL_STORAGE_KEY,
  TILE_HINTS_BOUND,
  board_card,
  build_board,
  automation_card_controls,
  automation_facts_words,
  budget_changes,
  budget_reducer,
  cancel_reducer,
  card_info_sections,
  card_metrics,
  context_budget_view,
  parse_budget,
  save_budget,
  send_automation_command,
  shown_budget,
  code_href,
  derive_phase_graph,
  entity_activity_age,
  entity_phase,
  extract_dreams_brief,
  extract_open_briefs,
  filter_done_window,
  format_age,
  format_tokens,
  format_utc,
  format_when,
  known_phase_keys,
  needs_you_line,
  person_of,
  read_stall_after_ms,
  send_cancel,
  split_board_rows,
  tools_words,
  type BoardCard,
  type BoardInput,
  type CancelState,
  type CardHandlers,
} from "./mission_control";
import { automation_facts, fold_automation_record } from "./board_data";
import { normalize_run_summary } from "./automations";
import { run_status_class, type RunSummary } from "./run_status";
import { fold_automation_brief, fold_pulse, make_context, state_line, type AutomationBrief } from "./state_line";

// The board's promise (backlog 0003): lanes group by BLOCKER from wire truth
// (status + wait object + automation record + ledger pulse, folded by
// state_line.ts), never from prose; every card states its object and actor.
function run(partial: Partial<RunSummary>): RunSummary {
  return { run_id: "run_x", status: "running", ...partial } as RunSummary;
}

const NOW = Date.parse("2026-10-13T23:50:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const UUID = "6defd6b2-e7a1-4915-8cb9-ec01e3e1321a";

/** A live-shaped row (gateway 0.13.1: `waiting` reduced to {reason, until}). */
function row(p: Partial<RunSummary> & { run_id: string }): RunSummary {
  return { workflow_id: "basic-agent@0.0.5:81795ea9", status: "running", created_at: ago(30), updated_at: ago(10), ledger_len: 4, ...p } as RunSummary;
}

const board = (active: RunSummary[], extra?: Partial<BoardInput>) => build_board({ active, done: [], now_ms: NOW, ...(extra || {}) });
const ids = (cards: BoardCard[]) => cards.map((c) => c.run_id);
const all_ids = (lanes: ReturnType<typeof build_board>) => LANE_ORDER.flatMap((l) => ids(lanes[l]));

const noop = () => {};
const HANDLERS: CardHandlers = { now_ms: NOW, stall_after_ms: 5 * 60_000, busy: false, on_open_run: noop, on_act: noop };
const markup = (card: BoardCard, h?: Partial<CardHandlers>) => renderToStaticMarkup(React.createElement(BoardCardView, { card, ...HANDLERS, ...(h || {}) }));
/** The card's visible text (tags stripped, entities decoded). */
const text_of = (card: BoardCard, h?: Partial<CardHandlers>) =>
  markup(card, h)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const DIGEST_BODY = {
  active_revision: 1,
  summary: {
    automation_id: "auto1",
    title: "Nightly digest",
    status: "active",
    trigger: { source_id: "schedule", config: { every: "24h" } },
    context_mode: "growing",
    growing_max_tokens: 100000,
    next_fire_at: new Date(NOW + 72 * 60_000).toISOString(),
    occurrence_count: 5,
    last_occurrence: { index: 4, status: "completed", fired_at: ago(60), finished_at: ago(51) },
    capabilities: ["revise", "pause"],
    workspace_root: "/ws/digest",
  },
  definition: {
    target: { input_data: { prompt: "Write the nightly digest of political and economic news.", tools: ["web_search", "fetch_url"], model: "Qwen3.8-27B", provider: "mlx", max_iterations: 20 } },
    policy: { tool_approval: "auto", retry: { max_attempts: 3, backoff: { initial: "30s", factor: 2, max: "10m" } } },
    notify: { channels: ["console", "email"] },
  },
};
const DIGEST: AutomationBrief = fold_automation_brief(DIGEST_BODY)!;
const DIGEST_FACTS = automation_facts(fold_automation_record(DIGEST_BODY)!.raw);

describe("five lanes — one case per wait kind × lane (rows of gateway 0.13.1)", () => {
  it("row-only reason=user → Needs you, unresolved (rows cannot tell question / approval / pause)", () => {
    const r = row({ run_id: "u1", status: "waiting", waiting: { reason: "user" } });
    const lanes = board([r]);
    expect(ids(lanes.needs_you)).toEqual(["u1"]);
    const c = lanes.needs_you[0];
    expect(c.line.unresolved).toBe(true);
    expect(c.line.actor).toBe("you");
    expect(c.line.text).toMatch(/^needs you: question, approval or pause · 10m$/);
    const html = markup(c);
    expect(html).toContain("Open the run →");
    expect(html).not.toContain(">Approve<");
  });

  it("a detail with tool_calls → approval: tool names + the detail's wait_key drive Approve / Reject", () => {
    const r = row({ run_id: "a1", status: "waiting", waiting: { reason: "user" } });
    const details = new Map([["a1", { waiting: { reason: "user", wait_key: "wk_9", details: { tool_calls: [{ name: "web_search" }, { name: "send_email" }] } } }]]);
    const c = board([r], { details }).needs_you[0];
    expect(c.line.action).toBe("approve");
    expect(c.wait_key).toBe("wk_9");
    expect(c.tool_names).toEqual(["web_search", "send_email"]);
    expect(c.line.text).toMatch(/^needs your approval: web_search, send_email/);
    const html = markup(c);
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
    // No wait key yet: the ONE working move is opening the run.
    const no_key = board([r], { details: new Map([["a1", { waiting: { reason: "user", details: { tool_calls: [{ name: "x" }] } } }]]) }).needs_you[0];
    expect(markup(no_key)).toContain("wait key not published yet");
    expect(markup(no_key)).not.toContain(">Approve<");
  });

  it("a prompt → a question: the ask is shown in place and Answer opens the run's context", () => {
    const r = row({ run_id: "q1", status: "waiting", waiting: { reason: "user" } });
    const details = new Map([["q1", { waiting: { reason: "user", wait_key: "wk_q", prompt: "Which account should I use?" } }]]);
    const c = board([r], { details }).needs_you[0];
    expect(c.line.action).toBe("answer");
    expect(c.prompt).toBe("Which account should I use?");
    expect(text_of(c)).toContain("asks since");
    expect(text_of(c)).toContain("Which account should I use?");
    expect(text_of(c)).toContain("Review & answer →");
  });

  it("a pause (wait_key pause: / details.kind) → Needs you with Resume, never a question", () => {
    const by_key = row({ run_id: "p1", status: "waiting", waiting: { reason: "user", wait_key: "pause:p1" } });
    const by_kind = row({ run_id: "p2", status: "waiting", waiting: { reason: "user" } });
    const details = new Map([["p2", { paused: true, waiting: { reason: "user", wait_key: "k", details: { kind: "pause" } } }]]);
    const lanes = board([by_key, by_kind], { details });
    expect(ids(lanes.needs_you).sort()).toEqual(["p1", "p2"]);
    for (const c of lanes.needs_you) {
      expect(c.line.action).toBe("resume");
      expect(c.line.verb).toBe("paused");
    }
    // The detail's paused flag reaches the pill (rows hard-code paused=false).
    expect(lanes.needs_you.find((c) => c.run_id === "p2")!.status_word).toBe("paused");
    const c = lanes.needs_you[0];
    expect(text_of(c, { on_resume: noop })).toContain("Resume");
    // A host that cannot resume offers the run instead of a dead button.
    expect(text_of(c)).not.toMatch(/\bResume\b/);
    expect(text_of(c)).toContain("Open the run →");
  });

  it("subworkflow with a RUNNING child → Working with the child's open step, stalled when the pulse is old; the child is not carded twice", () => {
    const parent = row({ run_id: "occ", status: "waiting", role: "occurrence", occurrence_index: 5, automation_id: "auto1", parent_run_id: "auto1", session_kind: "automation", waiting: { reason: "subworkflow" }, updated_at: ago(38) });
    const child = row({ run_id: UUID, parent_run_id: "occ", role: "descendant", automation_id: "auto1", workflow_id: "visual_react_agent_x_node-2", updated_at: ago(38), ledger_len: 1 });
    const pulses = new Map([[UUID, fold_pulse(UUID, 1, { node_id: "reason", status: "started", effect: { type: "llm_call" }, started_at: ago(38), ended_at: null })!]]);
    const lanes = board([parent, child], { pulses });
    expect(ids(lanes.working)).toEqual(["occ"]);
    expect(all_ids(lanes)).not.toContain(UUID);
    const c = lanes.working[0];
    expect(c.line.text).toBe("running subrun visual_react_agent_x_node-2 · llm_call open 38m · no progress");
    expect(c.line.stalled).toBe(true);
    expect(c.line.actor_run_id).toBe(UUID);
    expect(c.actor_run_label).toBe("visual_react_agent_x_node-2");
    // The actor badge opens the child; the stall mark is shown.
    const html = markup(c);
    expect(html).toContain("run visual_react_agent_x_node-2");
    expect(html).toContain("mc_stall");
    // A fresh pulse is progress: no mark, and a 1 h threshold clears the old one too.
    const fresh = new Map([[UUID, fold_pulse(UUID, 1, { node_id: "reason", status: "started", effect: { type: "llm_call" }, started_at: ago(1), ended_at: null })!]]);
    expect(board([parent, child], { pulses: fresh }).working[0].line.stalled).toBe(false);
    expect(board([parent, child], { pulses, stall_after_ms: 60 * 60_000 }).working[0].line.stalled).toBe(false);
  });

  it("subworkflow with a WAITING child → Waiting on, with the child's own sentence (the child is carried, not carded)", () => {
    const parent = row({ run_id: "root", status: "waiting", waiting: { reason: "subworkflow" } });
    const child = row({ run_id: "kid", parent_run_id: "root", status: "waiting", waiting: { reason: "event", details: { event: "inbox.message" } } });
    const lanes = board([parent, child]);
    expect(ids(lanes.waiting_on)).toEqual(["root"]);
    expect(lanes.waiting_on[0].line.text).toBe("waiting for subrun basic-agent 0.0.5: waiting for event inbox.message · 10m");
    expect(lanes.waiting_on[0].line.actor).toBe("run");
    expect(all_ids(lanes)).not.toContain("kid");
  });

  it("until → Waiting on, the clock", () => {
    const r = row({ run_id: "s1", status: "waiting", waiting: { reason: "until", until: new Date(NOW + 72 * 60_000).toISOString() } });
    const c = board([r]).waiting_on[0];
    expect(c.line.actor).toBe("clock");
    expect(c.line.text).toMatch(/^sleeps until \d\d:\d\d UTC \(in 1h 12m\)$/);
    // The sentence says when; a "clock" badge carried nothing (operator 2026-10-14).
    expect(markup(c)).not.toContain("mc_actor_clock");
    expect(text_of(c)).not.toMatch(/\bclock\b/);
  });

  it("event → Waiting on, external", () => {
    const c = board([row({ run_id: "e1", status: "waiting", waiting: { reason: "event" } })]).waiting_on[0];
    expect(c.line.actor).toBe("external");
    expect(c.line.text).toBe("waiting for an event · 10m");
  });

  it("job → Waiting on, the runtime", () => {
    const c = board([row({ run_id: "j1", status: "waiting", waiting: { reason: "job" } })]).waiting_on[0];
    expect(c.line.actor).toBe("runtime");
    expect(c.line.text).toBe("waiting for a delegated tool job · 10m");
  });

  it("an unknown wait → Waiting on, says so and offers Inspect", () => {
    const c = board([row({ run_id: "x1", status: "waiting", waiting: { reason: "weird", wait_key: "k9" } })]).waiting_on[0];
    expect(c.line.actor).toBe("unknown");
    expect(c.line.action).toBe("inspect");
    expect(text_of(c)).toContain("waiting, reason unknown (k9) · 10m · inspect");
    expect(text_of(c)).toContain("Inspect →");
  });

  it("a controller → Scheduled: ONE automation card with next / last / turns from the brief, ordered by next fire", () => {
    const c1 = row({ run_id: "auto1", role: "controller", session_kind: "automation", automation_id: "auto1", status: "waiting", waiting: { reason: "event", until: new Date(NOW + 20 * 3_600_000).toISOString() } });
    const c2 = row({ run_id: "auto2", role: "controller", session_kind: "automation", automation_id: "auto2", status: "waiting", waiting: { reason: "event", until: new Date(NOW + 2 * 3_600_000).toISOString() } });
    const automations = new Map([["auto1", DIGEST]]);
    const lanes = board([c1, c2, { ...c1 }], { automations });
    // auto1 fires in 1h12m (the brief wins over the wake wait's until), auto2 in 2h.
    expect(ids(lanes.scheduled)).toEqual(["auto1", "auto2"]);
    const card = lanes.scheduled[0];
    expect(card.line.text).toBe("next run in 1h 12m · last #4 completed · 5 turns");
    // The automation card's pill is never the bare "waiting" of its wake wait.
    expect(card.status_word).toBe("scheduled");
    expect(board([c1], { automations: new Map([["auto1", { ...DIGEST, status: "paused" }]]) }).scheduled[0].status_word).toBe("paused");
    // The automation card's pill is never the bare "waiting" of its wake wait.
    expect(card.status_word).toBe("scheduled");
    expect(board([c1], { automations: new Map([["auto1", { ...DIGEST, status: "paused" }]]) }).scheduled[0].status_word).toBe("paused");
    expect(card.title).toEqual({ text: "Nightly digest", source: "automation", untitled: false });
    const text = text_of(card);
    // 2026-10-15: the cadence and the next run are the schedule fact; the context mode is
    // the bar, not a subject line (the subject label equals the title, so it is not repeated).
    expect(text).toContain("every 24h · next in 1h 12m");
    expect(text).toContain("context · 100k budget");
    expect(text).not.toContain("growing context (100k)");
    expect(markup(card)).not.toContain("mc_trigger");
    expect(text.match(/Nightly digest/g)?.length).toBe(1);
    // Without the brief yet: the wake wait still says when.
    expect(lanes.scheduled[1].line.text).toBe("next run in 2h 0m");
  });

  it("a legacy schedule asleep on the clock is Scheduled (it starts by itself), not Waiting on", () => {
    const legacy = row({ run_id: "legacy-1", status: "waiting", is_scheduled: true, waiting: { reason: "until", until: new Date(NOW + 3_600_000).toISOString() } });
    expect(ids(board([legacy]).scheduled)).toEqual(["legacy-1"]);
  });

  it("terminal rows → Done: failures first, then newest; a terminal child of a listed parent is not carded", () => {
    const done = [
      row({ run_id: "ok_old", status: "completed", updated_at: ago(300) }),
      row({ run_id: "bad", status: "failed", error: "provider timeout", updated_at: ago(500) }),
      row({ run_id: "ok_new", status: "completed", updated_at: ago(5) }),
      row({ run_id: "kid_done", status: "completed", parent_run_id: "ok_new" }),
    ];
    const lanes = build_board({ active: [], done, now_ms: NOW });
    expect(ids(lanes.done)).toEqual(["bad", "ok_new", "ok_old"]);
    expect(lanes.done[0].line.text).toBe("failed: provider timeout");
    expect(lanes.done[1].line.text).toBe("completed in 25m");
    // A non-terminal row in the Done source is a stale copy: never carded.
    expect(all_ids(build_board({ active: [], done: [row({ run_id: "stale", status: "running" })], now_ms: NOW }))).toEqual([]);
  });
});

describe("two truths, one run (P5)", () => {
  it("an occurrence parked on its running child reads running EVERYWHERE on its card — the word 'waiting' appears nowhere", () => {
    const occ = row({ run_id: "occ5", status: "waiting", role: "occurrence", occurrence_index: 5, automation_id: "auto1", parent_run_id: "auto1", session_kind: "automation", waiting: { reason: "subworkflow" } });
    const kid = row({ run_id: "kid5", parent_run_id: "occ5", role: "descendant", automation_id: "auto1", workflow_id: "visual_react_agent_basic-agent_0_0_5_81795ea9_node-2", updated_at: ago(1) });
    const c = board([occ, kid], { automations: new Map([["auto1", DIGEST]]) }).working[0];
    expect(c.run_id).toBe("occ5");
    expect(c.status_word).toBe("running");
    const html = markup(c);
    expect(text_of(c)).not.toMatch(/waiting/i);
    // Attributes too (titles, aria labels): no surface of this card says waiting.
    expect(html).not.toMatch(/waiting/i);
    // The Automations page reads the same occurrence as running (gateway _live_status):
    // the board's lane and pill agree with it.
    expect(c.lane).toBe("working");
  });

  it("a child that needs you gets its own Needs-you card; its parent, blocked by nothing else, rides that card (no duplicate in Waiting on…)", () => {
    const parent = row({ run_id: "root", status: "waiting", waiting: { reason: "subworkflow" } });
    const child = row({ run_id: "kid", parent_run_id: "root", workflow_id: "visual_react_agent_x_node-2", status: "waiting", waiting: { reason: "user" }, updated_at: ago(3) });
    const lanes = board([parent, child]);
    expect(ids(lanes.needs_you)).toEqual(["kid"]);
    expect(ids(lanes.waiting_on)).toEqual([]);
    expect(lanes.needs_you[0].blocks.map((b) => b.run_id)).toEqual(["root"]);
    // The parent's own sentence is still the truth the (i) and the Agent view show.
    const parent_line = state_line(parent, make_context([parent, child], { now_ms: NOW }));
    expect(parent_line.text).toBe("waiting for subrun visual_react_agent_x_node-2: needs you: question, approval or pause · 3m");
    expect(parent_line.actor_run_id).toBe("kid");
  });

  it("a child its parent's sentence does not carry is carded: a sibling the parent is not parked on, or an orphan", () => {
    const parent = row({ run_id: "root", status: "waiting", waiting: { reason: "subworkflow" } });
    const newer = row({ run_id: "newer", parent_run_id: "root", updated_at: ago(1) });
    const older = row({ run_id: "older", parent_run_id: "root", updated_at: ago(9) });
    const orphan = row({ run_id: "orphan", parent_run_id: "session_memory_gateway_console_sandbox_default_admin" });
    const lanes = board([parent, newer, older, orphan]);
    expect(ids(lanes.working).sort()).toEqual(["older", "orphan", "root"]);
    expect(all_ids(lanes)).not.toContain("newer");
  });
});

describe("live shape: the 2026-10-13 23:50 UTC listing (occurrence #5 parked on its running child)", () => {
  // Gateway 0.13.1 rows captured while the operator's two cards read a bare
  // "waiting" (design §Current code reality rows 3–5). Shared fixture
  // (src/ui/__fixtures__/runs_while_waiting.json); read loudly — a missing
  // file fails here, it never skips.
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));
  const rows: RunSummary[] = fixture("runs_while_waiting.json").items.map(normalize_run_summary);
  const brief = fold_automation_brief(fixture("automation_while_waiting.json"))!;
  const split = split_board_rows([], rows);
  const lanes = build_board({ active: split.active, done: split.done, automations: new Map([[brief.automation_id, brief]]), now_ms: NOW });
  const OCC5 = "02c4a311-4e44-508d-96fb-98a205928054";
  const CHILD = "6defd6b2-e7a1-4915-8cb9-ec01e3e1321a";

  it("the occurrence is Working on its child (the Automations page's reading), titled by its automation, and the child is not carded twice", () => {
    const occ = lanes.working.find((c) => c.run_id === OCC5)!;
    expect(occ).toBeTruthy();
    expect(occ.status_word).toBe("running");
    expect(occ.line.text).toMatch(/^running subrun visual_react_agent_basic-agent_0_0_5_81795ea9_node-2 · last step \d+m ago · no progress$/);
    expect(occ.line.actor_run_id).toBe(CHILD);
    expect(occ.title.source).toBe("automation");
    expect(occ.subject.secondary).toBe("occurrence #5 · basic-agent 0.0.5");
    expect(all_ids(lanes)).not.toContain(CHILD);
  });

  it("the controller is the automation card in Scheduled, saying a run is in progress", () => {
    const ctl = lanes.scheduled.find((c) => c.run_id === brief.automation_id)!;
    expect(ctl.line.text).toMatch(/^run #5 in progress · next run in /);
  });

  it("no card anywhere says 'waiting' without its object, and no uuid renders as text", () => {
    for (const lane of LANE_ORDER) {
      for (const c of lanes[lane]) {
        const t = text_of(c);
        expect(t, `${lane} ${c.run_id}`).not.toMatch(/\bwaiting\b(?! for)/);
        expect(t).not.toContain(c.run_id);
      }
    }
    expect(lanes.done.length).toBeGreaterThan(0);
  });
});

describe("lane orders", () => {
  it("Needs you: oldest wait first · Working: stalled first, then the stalest · Waiting on: oldest first", () => {
    const lanes = board([
      row({ run_id: "young", status: "waiting", waiting: { reason: "user" }, updated_at: ago(2) }),
      row({ run_id: "old", status: "waiting", waiting: { reason: "user" }, updated_at: ago(90) }),
      row({ run_id: "busy", updated_at: ago(1) }),
      row({ run_id: "stuck", updated_at: ago(40) }),
      row({ run_id: "slow", updated_at: ago(4) }),
      row({ run_id: "ev_new", status: "waiting", waiting: { reason: "event" }, updated_at: ago(1) }),
      row({ run_id: "ev_old", status: "waiting", waiting: { reason: "event" }, updated_at: ago(60) }),
    ]);
    expect(ids(lanes.needs_you)).toEqual(["old", "young"]);
    expect(ids(lanes.working)).toEqual(["stuck", "slow", "busy"]);
    expect(lanes.working[0].line.stalled).toBe(true);
    expect(ids(lanes.waiting_on)).toEqual(["ev_old", "ev_new"]);
  });

  it("the old 'Review oldest-first by wait since' rule holds in Needs you", () => {
    const lanes = board([
      row({ run_id: "y", status: "waiting", waiting: { reason: "user", prompt: "?", since: "2026-10-13T23:00:00Z" } }),
      row({ run_id: "o", status: "waiting", waiting: { reason: "user", prompt: "?", since: "2026-10-13T20:00:00Z" } }),
    ]);
    expect(ids(lanes.needs_you)).toEqual(["o", "y"]);
  });

  it("runs without an id are dropped, never rendered as ghosts", () => {
    expect(all_ids(board([row({ run_id: "" }), row({ run_id: "real" })]))).toEqual(["real"]);
  });
});

describe("card anatomy (design §Card anatomy)", () => {
  it("the run id never renders as text: ⧉ copies it and its tooltip shows it", () => {
    const c = board([row({ run_id: UUID })]).working[0];
    expect(text_of(c)).not.toContain(UUID);
    expect(text_of(c)).not.toContain(UUID.slice(0, 6));
    expect(markup(c)).toMatch(new RegExp(`class="mc_copy"[^>]*title="${UUID}"[^>]*aria-label="Copy the run id"`));
    // The icon is drawn (15 px), not a glyph that depends on the font.
    expect(markup(c)).toMatch(/class="mc_copy"[^>]*>\s*<svg width="15" height="15"/);
  });

  it("a run with no title on the wire says untitled (the chip says why); a clamped title's tooltip is the whole title", () => {
    const c = board([row({ run_id: "p", session_id: "3f2a9b8c-1234-5678-9abc-def012345678" })]).working[0];
    expect(c.title.untitled).toBe(true);
    expect(text_of(c)).toContain("untitled");
    expect(markup(c)).toContain('title="No title on the wire yet: the workflow id stands in"');
    const long = "Summarise the inbox and draft replies for every thread that waits on me, newest first, in my usual tone of voice";
    const titled = build_board({ active: [row({ run_id: "p", session_id: "s" })], done: [], now_ms: NOW, run_briefs: new Map([["p", { run_id: "p", excerpt: long }]]) }).working[0];
    expect(titled.title.source).toBe("excerpt");
    expect(text_of(titled)).not.toContain("untitled");
    // The card clamps the title to 2 lines; its tooltip is the WHOLE title, the source lives in the (i).
    expect(markup(titled)).toContain(`class="mc_card_title" title="${long}"`);
  });

  it("the old 'subrun' meta word and the generic Automation button are gone; the archived pill stays", () => {
    const c = board([row({ run_id: "o", role: "occurrence", occurrence_index: 3, automation_id: "auto1", archived: true } as any)], { automations: new Map([["auto1", DIGEST]]) }).working[0];
    const html = markup(c);
    expect(html).not.toContain(">Automation<");
    expect(html).not.toContain(">subrun<");
    expect(html).toContain('data-tag="archived"');
    expect(text_of(c)).toContain("occurrence #3 · basic-agent 0.0.5");
  });

  it("metrics render when the sweep knows them (tokens / tools / duration)", () => {
    const c = board([row({ run_id: "m", tokens_total: 54_205, tool_calls: 14, created_at: ago(24) })]).working[0];
    expect(text_of(c)).toContain("54,205 tk");
    expect(text_of(c)).toContain("14 tools");
    expect(text_of(c)).toContain("24m");
  });

  it("the (i) of an automation run: Name it is disabled (and says why) without a host, wired with one, absent without `revise`", () => {
    const occ = row({ run_id: "o5", role: "occurrence", occurrence_index: 5, automation_id: "auto1" });
    const c = board([occ], { automations: new Map([["auto1", DIGEST]]) }).working[0];
    const info = (extra: any) => renderToStaticMarkup(React.createElement(CardInfo, { card: c, now_ms: NOW, stall_after_ms: 5 * 60_000, ...extra }));
    const bare = info({});
    expect(bare).toContain("Name it");
    expect(bare).toMatch(/<button type="submit"[^>]*disabled=""[^>]*title="Renaming is not available here/);
    expect(bare).not.toContain("Open automation");
    const wired = info({ on_rename_automation: async () => undefined, on_open_automation: noop });
    expect(wired).not.toMatch(/<input[^>]*disabled=""/);
    expect(wired).toContain("Open automation");
    // No `revise` capability → no Name it at all.
    const fixed = board([occ], { automations: new Map([["auto1", { ...DIGEST, can_revise: false }]]) }).working[0];
    expect(renderToStaticMarkup(React.createElement(CardInfo, { card: fixed, now_ms: NOW, stall_after_ms: 5 * 60_000 }))).not.toContain("Name it");
  });
});

describe("the no-progress threshold (P6: a visible per-viewer setting)", () => {
  it("offers 5m / 15m / 1h, remembers the viewer's pick, and reads junk as the 5m default", () => {
    expect(STALL_AFTER_OPTIONS.map((o) => o.label)).toEqual(["5m", "15m", "1h"]);
    expect(STALL_STORAGE_KEY).toBe("board_stall_after_ms");
    const store = (v: string | null) => ({ getItem: (k: string) => (k === STALL_STORAGE_KEY ? v : null) });
    expect(read_stall_after_ms(store(null))).toBe(5 * 60_000);
    expect(read_stall_after_ms(store(String(15 * 60_000)))).toBe(15 * 60_000);
    expect(read_stall_after_ms(store("123"))).toBe(5 * 60_000);
    expect(read_stall_after_ms({ getItem: () => { throw new Error("blocked"); } })).toBe(5 * 60_000);
    expect(read_stall_after_ms(null)).toBe(5 * 60_000);
  });
});

describe("rows → board", () => {
  it("split_board_rows: active rows come from the fresh listing; terminal rows are Done; a stale non-terminal copy is never active", () => {
    const fresh = run({ run_id: "live", status: "running" });
    const done = run({ run_id: "done", status: "completed" });
    const stale = run({ run_id: "stale", status: "waiting", waiting: { reason: "event" } });
    const split = split_board_rows([stale], [fresh, done]);
    expect(split.active.map((r) => r.run_id)).toEqual(["live"]);
    expect(split.done.map((r) => r.run_id)).toEqual(["done"]);
    expect(split.active.map((r) => r.run_id)).not.toContain("stale");
  });
});

describe("lane contract", () => {
  it("renders Needs you FIRST, names lanes by blocker, and the label / hint / empty maps stay in sync", () => {
    expect(LANE_ORDER).toEqual(["needs_you", "working", "waiting_on", "scheduled", "done"]);
    expect(LANE_LABEL).toEqual({ needs_you: "Needs you", working: "Working", waiting_on: "Waiting on…", scheduled: "Scheduled", done: "Done" });
    expect(LANE_HINT).toEqual({
      needs_you: "only you can move these",
      working: "an agent is on it",
      waiting_on: "something else must happen first",
      scheduled: "will start by itself",
      done: "read the outcome",
    });
    for (const map of [LANE_LABEL, LANE_HINT, LANE_EMPTY]) expect(Object.keys(map).sort()).toEqual([...LANE_ORDER].sort());
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
    // AWAKE IS NOT A DWELLING (laurent c203, entity sweep c3548): the bare
    // state-axis word maps to sleep — no operator surface paints AWAKE as
    // a phase chip. The composite awake:* spellings above keep their
    // phase-suffix mapping.
    expect(entity_phase("awake")).toBe("sleep");
    expect(entity_phase("idle")).toBe("sleep");
    expect(entity_phase("")).toBe("unknown");
  });
});

describe("one-graph consumer contract (laurent dm#79, c3563)", () => {
  // A wire-shaped payload mirroring the served artifact's load-bearing
  // fields — asserting SEMANTICS (keys, synonyms, initial), never the
  // full spec bytes (the artifact evolves under entity's pen).
  const payload = {
    sha256: "abc123",
    vendored: true,
    spec: {
      version: 6,
      initial_phase: "sleep",
      phases: {
        visit: { spoken_synonyms: [] },
        work: { spoken_synonyms: [] },
        personal: { spoken_synonyms: ["own-time", "own time"] },
        sleep: { spoken_synonyms: [] },
      },
    },
  };

  it("derives phase words + synonyms + initial from the served artifact", () => {
    const g = derive_phase_graph(payload)!;
    expect(g.phases).toEqual(["visit", "work", "personal", "sleep"]);
    expect(g.initial).toBe("sleep");
    expect(g.version).toBe(6);
    expect(g.sha256).toBe("abc123");
    expect(g.synonyms.some((m) => m.needle === "own time" && m.phase === "personal")).toBe(true);
  });

  it("junk payloads derive nothing — the labeled fallback applies, never a blank board", () => {
    expect(derive_phase_graph(null)).toBeNull();
    expect(derive_phase_graph({})).toBeNull();
    expect(derive_phase_graph({ spec: { phases: {} } })).toBeNull();
  });

  it("graph-driven mapping: exact wire->word table, BOTH paths (adversary F4 — a vacuous loop pinned nothing)", () => {
    const g = derive_phase_graph(payload)!;
    // v7 mode roles (axes_note, entity c3610): visiting DECIDES visit;
    // dreaming DECORATES asleep; RESTING lives INSIDE PERSONAL (the
    // v6-era rest->sleep fold was wrong — owned at c3613).
    const graph_expected: Array<[string, string]> = [
      ["visit", "visit"],
      ["visiting", "visit"],
      ["awake:visiting", "visit"],
      ["asleep", "sleep"],
      ["asleep(dream)", "sleep"],
      ["dreaming", "sleep"],
      ["own_time", "personal"], // separator-normalized synonym (adversary F1)
      ["own time", "personal"],
      ["own-time", "personal"],
      ["awake:personal", "personal"],
      ["awake:working", "work"],
      ["tasked", "work"],
      // A transition CAUSE leaking onto the state channel must never claim
      // WORK (adversary F8 inversion); it passes through under "other" —
      // an honest raw render beats a fabricated phase.
      ["no_task", "no_task"],
      ["awake", "sleep"],
      ["idle", "sleep"],
      ["resting", "personal"], // v7 role: loop-alive between days inside personal
      ["yielded:rest", "personal"],
      ["paused", "paused"],
      ["stopped", "stopped"],
      ["", "unknown"],
    ];
    for (const [wire, expected] of graph_expected) {
      expect(entity_phase(wire, g), `graph path: ${JSON.stringify(wire)}`).toBe(expected);
    }
    // Unlisted server words pass through verbatim under the bounded
    // "other" class — never a ruled style, never a blank.
    expect(entity_phase("mystery_state", g)).toBe("mystery_state");
    expect(known_phase_keys(g).has("mystery_state")).toBe(false);
    expect(known_phase_keys(g).has("awake")).toBe(false); // AWAKE-NEVER-RENDERS holds under the graph too
    // Fallback path parity on the words both paths can meet. Deliberate
    // divergences, each labeled: resting/yielded:rest (fallback stays
    // byte-compatible with the pre-mechanism "resting" chip) and
    // "own-time" (the dash spelling is a graph-path improvement the old
    // map never had — pre-wire gateways never served it either).
    for (const [wire, expected] of graph_expected) {
      if (wire === "resting" || wire === "yielded:rest" || wire === "own-time") continue;
      expect(entity_phase(wire), `fallback path: ${JSON.stringify(wire)}`).toBe(expected);
    }
  });

  it("a graph word WITHOUT an mc_phase_* style wears the bounded other class (adversary F5)", () => {
    const bumped = derive_phase_graph({
      sha256: "x",
      spec: { version: 8, initial_phase: "sleep", phases: { visit: {}, work: {}, personal: {}, sleep: {}, meditate: {} } },
    })!;
    // meditate maps (it is a graph word) but has no style — the known set
    // excludes it so the chip renders under "other", never an unstyled
    // mc_phase_meditate class.
    expect(entity_phase("meditate", bumped)).toBe("meditate");
    expect(known_phase_keys(bumped).has("meditate")).toBe(false);
    expect(known_phase_keys(bumped).has("sleep")).toBe(true);
  });

  it("v8 machine-readable mode axis: artifact-declared words win over the local residue tables", () => {
    const v8 = derive_phase_graph({
      sha256: "v8",
      spec: {
        version: 8,
        initial_phase: "sleep",
        phases: { visit: {}, work: {}, personal: { spoken_synonyms: ["own-time", "own time", "own_time"] }, sleep: {} },
        state_mode_axis: {
          words: {
            visiting: { role: "decides", phase: "visit" },
            dreaming: { role: "decorates", phase: "sleep" },
            resting: { role: "between-days", phase: "personal" },
          },
        },
      },
    })!;
    expect(v8.modes.length).toBe(3);
    // The block's declarations map exactly (roles documented in the
    // artifact; targets validated against the graph at derive time).
    expect(entity_phase("resting", v8)).toBe("personal");
    expect(entity_phase("dreaming", v8)).toBe("sleep");
    expect(entity_phase("visiting", v8)).toBe("visit");
    // A block word with an off-graph target is dropped at derive time —
    // never a chip word the graph does not rule.
    const bad = derive_phase_graph({
      sha256: "v8b",
      spec: { version: 8, initial_phase: "sleep", phases: { visit: {}, sleep: {} }, state_mode_axis: { words: { levitating: { role: "decides", phase: "astral" } } } },
    })!;
    expect(bad.modes).toEqual([]);
  });

  it("initial_phase honesty (adversary F2): absent initial prefers sleep; a graph without sleep is unusable", () => {
    // Alphabetical key order with no initial_phase: last-key would have
    // fabricated work as the settling target — the derive prefers sleep.
    const no_initial = derive_phase_graph({
      sha256: "y",
      spec: { version: 9, phases: { personal: {}, sleep: {}, visit: {}, work: {} } },
    })!;
    expect(no_initial.initial).toBe("sleep");
    expect(entity_phase("awake", no_initial)).toBe("sleep");
    // No sleep phase at all: settling has no honest target — fallback.
    expect(derive_phase_graph({ sha256: "z", spec: { version: 9, phases: { alpha: {}, beta: {} } } })).toBeNull();
    // An ARRAY phases object is junk, not a graph (Object.keys(["a"]) trap).
    expect(derive_phase_graph({ spec: { initial_phase: "sleep", phases: ["visit", "sleep"] } })).toBeNull();
  });

  it("a graph bump that renames a phase fails loudly at the chip axis, never silently restyles", () => {
    // Simulate a future artifact where "personal" is renamed: the derived
    // set no longer contains it, so a stale wire word renders under
    // "other" instead of wearing the retired ruled style.
    const bumped = derive_phase_graph({
      sha256: "def456",
      spec: { version: 7, initial_phase: "sleep", phases: { visit: {}, work: {}, self_time: { spoken_synonyms: ["personal"] }, sleep: {} } },
    })!;
    expect(known_phase_keys(bumped).has("personal")).toBe(false);
    // The synonym mechanism carries the old spelling to the new word —
    // one pen, the consumers follow.
    expect(entity_phase("personal", bumped)).toBe("self_time");
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
    board_card(run({ run_id: id, status: "completed", updated_at: since ?? undefined }));

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

describe("extract_open_briefs (access-hint lane, plan §observer 2)", () => {
  // Layer contract (chip ruling c2623/c2626): /card items carry entry_id
  // TOP-LEVEL on the row brief — the composer reads exactly that layer.
  const row = (partial: any) => ({ record_id: "ex:r1", kind: "diary", title: "t", statement: "s", observed_at: "2026-07-17", ...partial });

  it("reads questions.open and problems.open, entry_id verbatim when present", () => {
    const out = extract_open_briefs({
      questions: { open: [row({ record_id: "ex:q1", title: "why persistence?", entry_id: "diary_ab12cd34" })], resolved: [row({ record_id: "ex:q9" })] },
      problems: { open: [row({ record_id: "ex:p1", title: "door refused", entry_id: null })] },
    });
    expect(out.questions).toEqual([{ record_id: "ex:q1", title: "why persistence?", statement: "s", entry_id: "diary_ab12cd34" }]);
    expect(out.questions_total).toBe(1);
    // Absent/blank entry_id normalizes to null — the chip renders TEXT,
    // never a dead button (honesty rule pinned kit-side).
    expect(out.problems[0]!.entry_id).toBeNull();
  });

  it("resolved rows never surface — only .open is a debt the operator should see", () => {
    const out = extract_open_briefs({ questions: { open: [], resolved: [row({})] }, problems: {} });
    expect(out.questions).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  it("tolerates absent sections, non-object cards, and junk rows (render-when-present)", () => {
    expect(extract_open_briefs(null).questions).toEqual([]);
    expect(extract_open_briefs({}).problems_total).toBe(0);
    expect(extract_open_briefs({ questions: { open: "nope" } }).questions).toEqual([]);
    // A row with neither title nor statement carries nothing to render.
    expect(extract_open_briefs({ questions: { open: [{}, null, row({ title: "", statement: "" })] } }).questions).toEqual([]);
  });

  it("bounds the tile briefs but reports the TRUE total (never hide the count)", () => {
    const many = Array.from({ length: TILE_HINTS_BOUND + 3 }, (_, i) => row({ record_id: `ex:q${i}`, title: `q${i}` }));
    const out = extract_open_briefs({ questions: { open: many } });
    expect(out.questions.length).toBe(TILE_HINTS_BOUND);
    expect(out.questions_total).toBe(TILE_HINTS_BOUND + 3);
  });

  it("reads the wave-5 dreams brief (discoveries.dreams_signals_brief) render-when-present", () => {
    // The shipped shape (memory c3725): {count, kinds, felt_tones} over
    // STANDING signal-carrying dreams; absent = pre-signal store.
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 2, kinds: ["changed_understanding", "unresolved_tension"], felt_tones: ["warm"] } } }),
    ).toEqual({ count: 2, kinds: ["changed_understanding", "unresolved_tension"], felt_tones: ["warm"], dreams: null });
    // c3810 unit fix: dreams:N rides when present (integer > 0), null otherwise.
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 24, unit: "signals", dreams: 2, kinds: [], felt_tones: [] } } }),
    ).toEqual({ count: 24, kinds: [], felt_tones: [], dreams: 2 });
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 5, dreams: "2" } } }),
    ).toEqual({ count: 5, kinds: [], felt_tones: [], dreams: null });
    // Absent / zero / junk shapes render NOTHING — never a fabricated line.
    expect(extract_dreams_brief({})).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 0, kinds: [], felt_tones: [] } } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: "nope" } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: "3" } } })).toBeNull();
    // Tones/kinds are WORDS (feelings color, never rank): junk entries drop.
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 1, kinds: [null, "changed_navigation"], felt_tones: [""] } } }),
    ).toEqual({ count: 1, kinds: ["changed_navigation"], felt_tones: [], dreams: null });
    // Adversary pins: float counts are the stringly-count junk class;
    // richer skewed rows must never render [object Object]; non-array
    // kinds and an array-shaped brief drop wholesale.
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 2.7 } } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: -3 } } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: [{ count: 1 }] } })).toBeNull();
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 1, kinds: [{ kind: "x", count: 2 }, 5, true, "real_word"], felt_tones: "warm" } } }),
    ).toEqual({ count: 1, kinds: ["real_word"], felt_tones: [], dreams: null });
  });

  it("reads the build-5 lessons section (lessons.lessons + total; no open/resolved split)", () => {
    // The card bounds shown lessons itself (20 of N) — the tile trusts the
    // served TOTAL over the array length (a count, never a ratio).
    const out = extract_open_briefs({
      lessons: { lessons: [row({ record_id: "ex:l1", kind: "lesson", title: "describing is not doing" })], total: 21 },
    });
    expect(out.lessons).toEqual([{ record_id: "ex:l1", title: "describing is not doing", statement: "s", entry_id: null }]);
    expect(out.lessons_total).toBe(21);
    // Pre-build-5 card: absent section renders nothing, never fabricates.
    expect(extract_open_briefs({}).lessons).toEqual([]);
    expect(extract_open_briefs({ lessons: { lessons: "nope" } }).lessons_total).toBe(0);
  });
});

describe("GATE-1 pins", () => {
  const NOW_MS = Date.parse("2026-10-13T23:50:00Z");
  const at = (min: number) => new Date(NOW_MS - min * 60_000).toISOString();

  it("controller → occurrence → child → grandchild: the occurrence's sentence reaches the grandchild (M10)", () => {
    const ctl = row({ run_id: "ctl", role: "controller", session_kind: "automation", automation_id: "ctl", status: "waiting", waiting: { reason: "subworkflow" }, updated_at: at(30) });
    const occ = row({ run_id: "occ", role: "occurrence", occurrence_index: 2, automation_id: "ctl", parent_run_id: "ctl", session_kind: "automation", status: "waiting", waiting: { reason: "subworkflow" }, updated_at: at(20) });
    const child = row({ run_id: "kid", role: "descendant", parent_run_id: "occ", automation_id: "ctl", session_kind: "automation", workflow_id: "react@1:a", status: "waiting", waiting: { reason: "subworkflow" }, updated_at: at(10) });
    const grand = row({ run_id: "grand", role: "descendant", parent_run_id: "kid", automation_id: "ctl", session_kind: "automation", workflow_id: "delegate@1:b", status: "waiting", waiting: { reason: "user", prompt: "Which file?" }, updated_at: at(5) });
    const split = split_board_rows([], [ctl, occ, child, grand]);
    const lanes = build_board({ active: split.active, done: split.done, now_ms: NOW_MS });
    // The occurrence and its child are blocked by the grandchild alone: they ride its card.
    expect(lanes.waiting_on.map((c) => c.run_id)).toEqual([]);
    const grand_card = lanes.needs_you.find((c) => c.run_id === "grand")!;
    expect(grand_card.blocks.map((b) => b.run_id)).toEqual(["kid", "occ"]);
    const occ_line = state_line(occ, make_context([ctl, occ, child, grand], { now_ms: NOW_MS }));
    expect(occ_line.text).toBe("waiting for subrun react 1: waiting for subrun delegate 1: asks a question · 5m");
    expect(lanes.scheduled.map((c) => c.run_id)).toEqual(["ctl"]);
  });

  it("two truths: the board's word equals the gateway's occurrence word (automations.py:246-253 _live_status rule)", () => {
    // The gateway reads an occurrence as "waiting" only when a PERSON is waited on
    // (ask_user / tool approval), else "running" — the rule the board adopted (P5).
    const gateway_live_status = (occ_wait_reason: string, child_status: string): string =>
      occ_wait_reason === "user" ? "waiting" : child_status === "waiting_user" ? "waiting" : "running";
    const occ = row({ run_id: "occ", role: "occurrence", occurrence_index: 5, automation_id: "a", session_kind: "automation", status: "waiting", waiting: { reason: "subworkflow" }, updated_at: at(30) });
    const kid = row({ run_id: "kid", role: "descendant", parent_run_id: "occ", automation_id: "a", session_kind: "automation", status: "running", updated_at: at(1) });
    const lanes = build_board({ active: [occ, kid], done: [], now_ms: NOW_MS });
    const card = lanes.working.find((c) => c.run_id === "occ")!;
    expect(card.status_word).toBe(gateway_live_status("subworkflow", "running"));
    expect(card.status_word).toBe("running");
    const asking = row({ run_id: "occ2", role: "occurrence", occurrence_index: 6, automation_id: "a", session_kind: "automation", status: "waiting", waiting: { reason: "user", prompt: "Go on?" }, updated_at: at(3) });
    const lanes2 = build_board({ active: [asking], done: [], now_ms: NOW_MS });
    expect(lanes2.needs_you[0].status_word).toBe(gateway_live_status("user", ""));
  });

  it("a Needs-you card says what is asked since when, and quotes the ask ONCE, under the line; no actor badge", () => {
    const asking = row({ run_id: "q", status: "waiting", waiting: { reason: "user", prompt: "Which account should I use?", wait_key: "k" }, updated_at: at(3) });
    const card = build_board({ active: [asking], done: [], now_ms: NOW_MS }).needs_you[0];
    const html = markup(card);
    const state_text = html.slice(html.indexOf('class="mc_state_text"'), html.indexOf("</span>", html.indexOf('class="mc_state_text"')));
    expect(state_text.slice(state_text.indexOf(">"))).not.toContain("Which account should I use?");
    expect(html.slice(html.indexOf('class="mc_glimpse mc_glimpse_request"'))).toContain("Which account should I use?");
    expect(html).not.toContain("mc_actor");
  });
});

describe("operator round 2026-10-14 (lane E): heads, copy, Needs you, actions, triggers, (i), Done", () => {
  const NOW_MS = Date.parse("2026-10-13T23:50:00Z");
  const at = (min: number) => new Date(NOW_MS - min * 60_000).toISOString();
  const H: CardHandlers = { ...HANDLERS, now_ms: NOW_MS };
  const html_of = (card: BoardCard, h?: Partial<CardHandlers>) => renderToStaticMarkup(React.createElement(BoardCardView, { card, ...H, ...(h || {}) }));
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const css = readFileSync(new URL("./board.css", import.meta.url), "utf8");
  /** The declarations of the first rule whose selector list is exactly `sel` (comments stripped). */
  const rule = (sel: string) => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const m = flat.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`no rule ${sel}`);
    return m[1];
  };

  const question = (p: Partial<RunSummary> = {}) => {
    const r = row({ run_id: "q1", status: "waiting", waiting: { reason: "user" }, session_id: "acode-e1e4f8901acf", updated_at: at(3), ...p });
    const details = new Map([["q1", { waiting: { reason: "user", wait_key: "user:q1:gate", since: at(3), prompt: "The coding agent believes the task is done after 5 cycles. Reply 'accept' to finish." } }]]);
    return build_board({ active: [r], done: [], details, now_ms: NOW_MS }).needs_you[0];
  };
  const approval = (p: Partial<RunSummary> = {}) => {
    const r = row({ run_id: "a1", status: "waiting", waiting: { reason: "user" }, session_id: "acode-1", updated_at: at(9), ...p });
    const calls = [
      { name: "web_search", arguments: { query: "AI news October 2026" } },
      { name: "send_email", arguments: { to: ["ops@example.org"], subject: "digest" } },
    ];
    const details = new Map([["a1", { waiting: { reason: "user", wait_key: "wk_a1", details: { tool_calls: calls } } }]]);
    return build_board({ active: [r], done: [], details, now_ms: NOW_MS }).needs_you[0];
  };

  it("lane heads: no fold chevron and no per-viewer open state; the count is a pill, a zero muted", () => {
    const page = renderToStaticMarkup(
      React.createElement(MissionControlPage, {
        gateway_connected: true,
        runs: [],
        all_runs: [row({ run_id: "w1", updated_at: at(1) })],
        runs_refreshed_at: NOW_MS,
        entities: [],
        entities_total: 0,
        entities_error: "",
        refreshing: false,
        on_refresh: noop,
        on_open_run: noop,
        on_resume_wait: async () => {},
        on_open_automation: noop,
        entity_app_href: "",
      }),
    );
    const heads = page.match(/<header class="mc_column_head">[\s\S]*?<\/header>/g) || [];
    expect(heads.length).toBe(5);
    for (const h of heads) {
      expect(h).not.toContain("list_disclosure");
      expect(h).not.toContain("aria-expanded");
      expect(h).not.toContain("<svg");
    }
    expect(page).not.toContain("list_collapsed");
    expect(page).not.toMatch(/hidden=""/);
    // Working holds one card; every other lane is empty and its pill is muted.
    expect(page).toMatch(/id="mc_column_title_working">Working<\/h2><span class="mc_column_count">1<\/span>/);
    expect(page).toMatch(/id="mc_column_title_needs_you">Needs you<\/h2><span class="mc_column_count is_zero">0<\/span>/);
    expect((page.match(/class="mc_column_count is_zero"/g) || []).length).toBe(4);
    // The pill: tabular figures, primary text on a raised surface, 13 px, right-aligned; zero muted.
    const pill = rule(".mc_column_head .mc_column_count");
    expect(pill).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(pill).toMatch(/color:\s*var\(--text-primary\)/);
    expect(pill).toMatch(/font-size:\s*calc\(13px \* var\(--font-scale, 1\)\)/);
    expect(pill).toMatch(/margin-left:\s*auto/);
    expect(rule(".mc_column_head .mc_column_count.is_zero")).toMatch(/color:\s*var\(--text-muted\)/);
  });

  it("copy affordances are hidden until their card / row is hovered or holds focus, then clearly visible (24 px hit area, 15 px icon)", () => {
    const base = rule(".mc_copy");
    expect(base).toMatch(/opacity:\s*0;/);
    expect(base).toMatch(/min-width:\s*24px/);
    expect(base).toMatch(/height:\s*24px/);
    expect(base).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(rule(".mc_copy svg")).toMatch(/width:\s*15px/);
    const reveal = rule(".mc_card:hover .mc_copy, .mc_card:focus-within .mc_copy, .mc_info_row:hover .mc_copy, .mc_info_row:focus-within .mc_copy, .mc_copy:focus-visible, .mc_copy.is_copied, .mc_copy.is_failed");
    expect(reveal).toMatch(/opacity:\s*1/);
    expect(rule(".mc_copy:hover")).toMatch(/color:\s*var\(--text-primary\)/);
    // Nothing else moves on hover: a card never lifts.
    expect(css).not.toMatch(/\.mc_card:hover\s*\{[^}]*transform/);
    // The card's copy and every (i) row's copy carry the button; the (i) has one per fact row.
    const c = question();
    expect(html_of(c)).toMatch(/class="mc_copy"[^>]*title="q1"/);
    const info = renderToStaticMarkup(React.createElement(CardInfo, { card: c, now_ms: NOW_MS, stall_after_ms: 5 * 60_000 }));
    const rows = (info.match(/class="mc_info_row"/g) || []).length;
    expect(rows).toBeGreaterThan(8);
    expect((info.match(/class="mc_copy"/g) || []).length).toBe(rows);
  });

  it("WHO · asks since <when> (<age>): a person when actor_id names one; nothing (never 'you', never 'gateway') otherwise", () => {
    expect(format_when(Date.parse("2026-10-01T09:14:00Z"), NOW_MS)).toMatch(/^Oct \d{1,2}, \d\d:\d\d$/);
    expect(format_when(Date.parse("2025-10-01T09:14:00Z"), NOW_MS)).toMatch(/^Oct \d{1,2} 2025, \d\d:\d\d$/);
    const since = `${format_when(Date.parse(at(3)), NOW_MS)} (3m)`;
    const anon = question({ actor_id: "gateway" });
    expect(person_of(anon.row)).toBe("");
    const line = needs_you_line(anon, NOW_MS);
    expect(line.who).toBe("");
    expect(line.text.split("\u00a0").join(" ")).toBe(`asks since ${since}`);
    // The date and the age are glued: a narrow lane never splits "(3m)" or "Oct 13, 23:47".
    expect(line.text).toBe(`asks since ${format_when(Date.parse(at(3)), NOW_MS).split(" ").join("\u00a0")} (3m)`);
    const t = text_of(anon);
    expect(t).toContain(`asks since ${since}`);
    expect(t).not.toMatch(/\byou\b/);
    expect(t).not.toContain("gateway");
    const person = question({ actor_id: "laurent" });
    expect(text_of(person)).toContain(`laurent · asks since ${since}`);
    expect(html_of(person)).toContain('<span class="mc_who" title="Started by laurent">laurent</span>');
    // Approvals name the tools; pauses say paused.
    const a = approval({ actor_id: "ops-team" });
    expect(text_of(a)).toContain(`ops-team · needs approval for web_search, send_email since ${format_when(Date.parse(at(9)), NOW_MS)} (9m)`);
    expect(tools_words(["read_file", "read_file", "edit_file", "a", "b"])).toBe("read_file ×2, edit_file, a and 1 more");
    const paused = build_board({ active: [row({ run_id: "p1", status: "waiting", actor_id: "laurent", waiting: { reason: "user", wait_key: "pause:p1" }, updated_at: at(20) })], done: [], now_ms: NOW_MS }).needs_you[0];
    expect(text_of(paused)).toContain(`paused since ${format_when(Date.parse(at(20)), NOW_MS)} (20m)`);
    expect(text_of(paused)).not.toContain("laurent ·");
  });

  it("the request is quoted ONCE, under the line, in the same muted glimpse as a Done answer; tool calls show their arguments", () => {
    const q = question();
    const t = text_of(q);
    expect(t.split("The coding agent believes").length - 1).toBe(1);
    expect(html_of(q)).toMatch(/<div class="mc_glimpse mc_glimpse_request" title="The coding agent believes the task is done after 5 cycles\. Reply &#x27;accept&#x27; to finish\.">/);
    // Same class, same look as the answer glimpse: one rule, a 3-line clamp, muted.
    const g = rule(".mc_glimpse");
    expect(g).toMatch(/-webkit-line-clamp:\s*3/);
    expect(g).toMatch(/color:\s*var\(--text-secondary\)/);
    const a = html_of(approval());
    expect(a).toContain("web_search(query: AI news October 2026)");
    expect(a).toContain("send_email(to: [&quot;ops@example.org&quot;], subject: digest)");
    // The ask sits under the state line, before the metrics.
    expect(a.indexOf("mc_card_state")).toBeLessThan(a.indexOf("mc_glimpse_request"));
    expect(a.indexOf("mc_glimpse_request")).toBeLessThan(a.indexOf("mc_card_foot"));
    // The `you` actor badge is gone from Needs-you cards.
    expect(a).not.toContain("mc_actor_you");
  });

  it("a plain run's card never says 'session': the subject line is the workflow, or nothing when the title is the workflow", () => {
    const titled = build_board({ active: [row({ run_id: "s1", session_id: "acode-1" })], done: [], now_ms: NOW_MS, run_briefs: new Map([["s1", { run_id: "s1", excerpt: "Fix the failing test" }]]) }).working[0];
    expect(text_of(titled)).not.toMatch(/\bsession\b/);
    expect(html_of(titled)).not.toContain("mc_subject_label");
    expect(html_of(titled)).toMatch(/<span class="mc_subject_secondary" title="basic-agent 0.0.5">basic-agent 0.0.5<\/span>/);
    const untitled = build_board({ active: [row({ run_id: "s2", session_id: "acode-2" })], done: [], now_ms: NOW_MS }).working[0];
    expect(untitled.title.text).toBe("basic-agent 0.0.5");
    expect(html_of(untitled)).not.toContain("mc_card_subject");
    expect(text_of(untitled)).not.toMatch(/\bsession\b/);
  });

  it("Cancel: a two-step confirm in place (no browser dialog) that calls on_cancel_run with the run id; absent prop → no Cancel", async () => {
    expect(html_of(question())).not.toContain('aria-label="Cancel this run"');
    const with_cancel = html_of(question(), { on_cancel_run: async () => null });
    // On the card it is a kit icon button on the footer row (operator 2026-10-15: one line, icons).
    expect(with_cancel).toMatch(/<button type="button" class="btn mc_icon_btn mc_cancel" title="Cancel this run" aria-label="Cancel this run"><svg/);
    // …and on EVERY ongoing lane, not only Needs you.
    const working_card = build_board({ active: [row({ run_id: "w1", status: "running", session_id: "acode-w1", updated_at: at(1) })], done: [], now_ms: NOW_MS }).working[0];
    expect(html_of(working_card, { on_cancel_run: async () => null })).toContain('aria-label="Cancel this run"');
    // The steps.
    const idle: CancelState = { phase: "idle", error: "" };
    const asked = cancel_reducer(idle, { type: "ask" });
    expect(asked).toEqual({ phase: "confirm", error: "" });
    expect(cancel_reducer(asked, { type: "keep" })).toEqual(idle);
    expect(cancel_reducer(idle, { type: "send" })).toEqual(idle); // never straight from the button
    const busy = cancel_reducer(asked, { type: "send" });
    expect(busy.phase).toBe("busy");
    expect(cancel_reducer(busy, { type: "done" }).phase).toBe("sent");
    expect(cancel_reducer(busy, { type: "failed", error: "not cancellable" })).toEqual({ phase: "idle", error: "not cancellable" });
    // The host call: the run id, an error sentence or a throw is a failure.
    const calls: string[] = [];
    expect(await send_cancel(async (id) => void calls.push(id), "q1")).toEqual({ type: "done" });
    expect(calls).toEqual(["q1"]);
    expect(await send_cancel(async () => "run is terminal", "q1")).toEqual({ type: "failed", error: "run is terminal" });
    expect(await send_cancel(async () => { throw new Error("HTTP 409"); }, "q1")).toEqual({ type: "failed", error: "HTTP 409" });
    // The views: the question and its two answers in place; busy disables both; the error stays under it.
    const view = (state: CancelState, on_event = (_: any) => {}, on_send = () => {}) => React.createElement(CancelControlView, { state, on_event, on_send });
    const confirm_html = renderToStaticMarkup(view(asked));
    expect(plain(confirm_html)).toBe("Cancel this run? Cancel run Keep");
    expect(renderToStaticMarkup(view(busy))).toMatch(/<button type="button" class="btn danger mc_btn_sm" disabled="">Cancelling<\/button><button type="button" class="btn mc_btn_sm" disabled="">Keep<\/button>/);
    expect(renderToStaticMarkup(view({ phase: "idle", error: "not cancellable" }))).toMatch(/<div class="mc_act_error" role="alert">not cancellable<\/div>/);
    // The wiring: "Cancel" asks, "Cancel run" sends, "Keep" keeps (the view is hook-free: its tree is inspectable).
    const events: any[] = [];
    let sent = 0;
    const buttons = (el: any): any[] => (!el || typeof el !== "object" ? [] : [...(el.type === "button" ? [el] : []), ...React.Children.toArray(el.props?.children).flatMap(buttons)]);
    const by_text = (el: any, t: string) => buttons(el).find((b) => plain(renderToStaticMarkup(b)) === t);
    by_text(CancelControlView({ state: idle, on_event: (e) => events.push(e), on_send: () => sent++ }), "Cancel").props.onClick();
    by_text(CancelControlView({ state: asked, on_event: (e) => events.push(e), on_send: () => sent++ }), "Keep").props.onClick();
    by_text(CancelControlView({ state: asked, on_event: (e) => events.push(e), on_send: () => sent++ }), "Cancel run").props.onClick();
    expect(events).toEqual([{ type: "ask" }, { type: "keep" }]);
    expect(sent).toBe(1);
    const src = readFileSync(new URL("./mission_control.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/\b(window\.)?confirm\(/);
  });

  it("Open in Code: AbstractCode's hash route in a new tab when the app is installed; disabled with the install hint otherwise; never on automation runs", () => {
    expect(code_href("http://127.0.0.1:3003/", "acode-e1e4f8901acf", "q1")).toBe("http://127.0.0.1:3003/#session=acode-e1e4f8901acf&run=q1");
    expect(code_href("http://127.0.0.1:3003/#old", "s 1", "r/1")).toBe("http://127.0.0.1:3003/#session=s%201&run=r%2F1");
    const on = html_of(question(), { code_app: { url: "http://127.0.0.1:3003/" } });
    expect(on).toContain('href="http://127.0.0.1:3003/#session=acode-e1e4f8901acf&amp;run=q1" target="_blank" rel="noreferrer"');
    // The card's control is a kit icon with its name as the accessible label (one footer row).
    expect(on).toContain('aria-label="Open in Code"');
    expect(on).toMatch(/class="btn mc_icon_btn mc_open_code"[^>]*><svg/);
    for (const off of [html_of(question()), html_of(question(), { code_app: null })]) {
      expect(off).toContain(`<span class="mc_btn_wrap" title="${CODE_INSTALL_HINT}"><button type="button" class="btn mc_icon_btn" disabled="" title="${CODE_INSTALL_HINT}" aria-label="Open in Code">`);
      expect(off).not.toContain("#session=");
    }
    // Any ONGOING card opens in Code, whatever its lane (observability, operator 2026-10-15).
    const waiting_card = build_board({ active: [row({ run_id: "w2", status: "waiting", session_id: "acode-w2", waiting: { reason: "event" }, updated_at: at(2) })], done: [], now_ms: NOW_MS }).waiting_on[0];
    expect(html_of(waiting_card, { code_app: { url: "http://127.0.0.1:3003/" } })).toContain("#session=acode-w2&amp;run=w2");
    const done_card = build_board({ active: [], done: [row({ run_id: "d1", status: "completed", session_id: "acode-d1", updated_at: at(3) })], now_ms: NOW_MS }).done[0];
    expect(html_of(done_card, { code_app: { url: "http://127.0.0.1:3003/" } })).not.toContain('aria-label="Open in Code"');
    expect(CODE_INSTALL_HINT).toBe("Install the AbstractCode web app (npx @abstractframework/code) to open this conversation");
    // An automation occurrence has no conversation to open in Code ("Open automation" lives in the (i)).
    const occ = build_board({
      active: [row({ run_id: "o1", role: "occurrence", automation_id: "auto1", session_id: "automation:auto1", status: "waiting", waiting: { reason: "user" } })],
      done: [],
      details: new Map([["o1", { waiting: { reason: "user", wait_key: "k", prompt: "Go on?" } }]]),
      automations: new Map([["auto1", DIGEST]]),
      now_ms: NOW_MS,
    }).needs_you[0];
    expect(html_of(occ, { code_app: { url: "http://127.0.0.1:3003/" } })).not.toContain("Open in Code");
    const occ_info = renderToStaticMarkup(React.createElement(CardInfo, { card: occ, now_ms: NOW_MS, stall_after_ms: 5 * 60_000, on_open_automation: noop, code_app: { url: "http://127.0.0.1:3003/" } }));
    expect(occ_info).toContain("Open automation");
    expect(occ_info).not.toContain("Open in Code");
  });

  it("automation cards carry their cadence as the schedule fact (the gateway's words when served), not 'clock'; no trigger chip, no context subject line", () => {
    const ctl = row({ run_id: "auto1", role: "controller", session_kind: "automation", automation_id: "auto1", status: "waiting", waiting: { reason: "event", until: at(-72) } });
    const card = build_board({ active: [ctl], done: [], automations: new Map([["auto1", DIGEST]]), now_ms: NOW_MS }).scheduled[0];
    const html = html_of(card, { facts: DIGEST_FACTS });
    const next_abs = format_when(NOW_MS + 72 * 60_000, NOW_MS);
    expect(html).toContain(`<span class="mc_fact_cell mc_fact_schedule" title="every 24h · next run ${next_abs}">every 24h · next in 1h 12m</span>`);
    expect(html).not.toContain("mc_trigger");
    expect(html).not.toContain("mc_actor_clock");
    expect(plain(html)).not.toMatch(/\bclock\b/);
    expect(html).not.toContain("mc_subject_secondary");
    // A sentence card's chip still sits inline with its sentence (text flow, never a lone line).
    expect(rule(".mc_card_state")).toMatch(/display:\s*block/);
    expect(rule(".mc_card_state .mc_actor")).toMatch(/display:\s*inline-block/);
    for (const [source, words] of [["email_received", "on email"], ["manual", "manual"]] as const) {
      const b = fold_automation_brief({ ...DIGEST_BODY, summary: { ...DIGEST_BODY.summary, trigger: { source_id: source, config: {} } } })!;
      const c2 = build_board({ active: [ctl], done: [], automations: new Map([["auto1", b]]), now_ms: NOW_MS }).scheduled[0];
      expect(plain(html_of(c2))).toContain(`${words} · next in 1h 12m`);
    }
    // Served words win over the client fold.
    const served = fold_automation_brief({ ...DIGEST_BODY, summary: { ...DIGEST_BODY.summary, schedule_rule_text: "Every 24 hours (UTC)", next_run_local: "2026-10-14T03:02:00+02:00" } })!;
    const c3 = build_board({ active: [ctl], done: [], automations: new Map([["auto1", served]]), now_ms: NOW_MS }).scheduled[0];
    expect(html_of(c3)).toContain(`title="Every 24 hours (UTC) · next run ${next_abs} · 2026-10-14T03:02:00+02:00 (owner&#x27;s zone)">Every 24 hours (UTC) · next in 1h 12m</span>`);
  });

  it("the (i) of a RUN: Run · Spend · Where sections; sources as tags, never parentheticals; long text folds by size; no '…'", () => {
    const task = "Summarise every unread thread in the shared inbox, group them by customer, flag what needs a reply today, draft the replies in my usual tone, and list anything that looks like a contract change. ".repeat(3).trim();
    const r = row({ run_id: "s1", session_id: "acode-1", actor_id: "gateway", status: "waiting", waiting: { reason: "user" }, tokens_total: 99_921, llm_calls: 7, tool_calls: 11, created_at: at(40), updated_at: at(3) });
    const details = new Map([["s1", { workspace_root: "/ws/acode-1", waiting: { reason: "user", wait_key: "k", since: at(3), prompt: "Which customer first?" } }]]);
    const card = build_board({ active: [r], done: [], details, run_briefs: new Map([["s1", { run_id: "s1", excerpt: task }]]), now_ms: NOW_MS }).needs_you[0];
    const sections = card_info_sections(card, { now_ms: NOW_MS, stall_after_ms: 5 * 60_000, detail: details.get("s1") });
    expect(sections.map((s) => s.id)).toEqual(["run", "spend", "where"]);
    const run_rows = Object.fromEntries(sections[0].rows.map((x) => [x.id, x]));
    expect(run_rows.title).toMatchObject({ value: task, source: "prompt", long: true });
    expect(run_rows.workflow).toMatchObject({ value: "basic-agent 0.0.5", aside: "basic-agent@0.0.5:81795ea9", aside_mono: true });
    expect(run_rows.run_id).toMatchObject({ value: "s1", mono: true });
    expect(run_rows.session).toMatchObject({ value: "acode-1", mono: true });
    expect(run_rows.started).toMatchObject({ value: format_when(Date.parse(at(40)), NOW_MS), aside: "40m ago" });
    expect(run_rows.started_by).toMatchObject({ value: "gateway", source: "not a person" });
    expect(run_rows.wait_kind.value).toBe("your answer to a question");
    expect(run_rows.question.value).toBe("Which customer first?");
    expect(Object.fromEntries(sections[1].rows.map((x) => [x.id, x.value]))).toEqual({ duration: "40m", tokens: "99,921", llm_calls: "7", tool_calls: "11" });
    expect(sections[2].rows[0]).toMatchObject({ value: "/ws/acode-1", mono: true });
    const info = renderToStaticMarkup(React.createElement(CardInfo, { card, now_ms: NOW_MS, stall_after_ms: 5 * 60_000, detail: details.get("s1"), on_open_run: noop, on_cancel_run: async () => null, code_app: { url: "http://x/" } }));
    const text = plain(info);
    expect(text).not.toContain("…");
    expect(text).not.toMatch(/\(title from|\(untitled/);
    // The only parenthesis left is the fold's own "(N chars)" — every other fact is a row or a tag.
    expect(text.replace(/show all \([\d,]+ chars\)/g, "")).not.toContain("(");
    expect(info).toContain(`show all (${task.length.toLocaleString("en-US")} chars)`);
    expect(info).toContain('<span class="mc_source">prompt</span>');
    // Mono only for ids and paths.
    expect(info.match(/class="mc_info_text mono">([^<]*)</g)!.map((m) => m.replace(/.*>/, "").replace(/<$/, ""))).toEqual(["s1", "acode-1", "/ws/acode-1"]);
    for (const title of ["Run", "Spend", "Where"]) expect(info).toContain(`<h3 class="mc_info_section_title">${title}</h3>`);
    expect(plain(info.slice(info.indexOf('class="mc_info_actions">') + 'class="mc_info_actions">'.length))).toBe("Open run Open in Code Cancel");
  });

  it("the (i) of an AUTOMATION: Automation · Schedule · Policy · After each run · Where, from the brief and the raw record", () => {
    const ctl = row({ run_id: "auto1", role: "controller", session_kind: "automation", automation_id: "auto1", status: "waiting", waiting: { reason: "event" } });
    const card = build_board({ active: [ctl], done: [], automations: new Map([["auto1", DIGEST]]), now_ms: NOW_MS }).scheduled[0];
    const facts = automation_facts({ ...DIGEST_BODY, summary: { ...DIGEST_BODY.summary, trigger: { source_id: "schedule", config: { every: "24h", count: 30, until: "2026-12-31T00:00:00Z" } } }, definition: { ...DIGEST_BODY.definition, target: { ...DIGEST_BODY.definition.target, workflow_id: "basic-agent@0.0.5:81795ea9" } } });
    const sections = card_info_sections(card, { now_ms: NOW_MS, stall_after_ms: 5 * 60_000, facts, revision: 1 });
    expect(sections.map((s) => s.id)).toEqual(["automation", "schedule", "policy", "after", "where"]);
    const v = (id: string) => Object.fromEntries(sections.find((s) => s.id === id)!.rows.map((x) => [x.id, x]));
    expect(v("automation").title).toMatchObject({ value: "Nightly digest", source: "automation" });
    expect(v("automation").task.value).toBe("Write the nightly digest of political and economic news.");
    expect(v("automation").automation_id).toMatchObject({ value: "auto1", mono: true });
    expect(v("automation").target_workflow).toMatchObject({ value: "basic-agent 0.0.5", aside: "basic-agent@0.0.5:81795ea9" });
    expect(v("automation").revision.value).toBe("1");
    expect(v("schedule").trigger).toMatchObject({ value: "every 24h", source: "schedule" });
    expect(v("schedule").next).toMatchObject({ value: format_utc(NOW_MS + 72 * 60_000), aside: "in 1h 12m" });
    expect(v("schedule").last).toMatchObject({ value: "#4 completed", aside: `9m · ${format_when(Date.parse(ago(60)), NOW_MS)}` });
    expect(v("schedule").turns.value).toBe("5");
    expect(v("schedule").stop_after.value).toBe("30 runs");
    expect(v("schedule").stop_at.value).toBe("Dec 31, 00:00 UTC");
    expect(v("policy").context).toMatchObject({ value: "growing", aside: "capped at 100k tokens" });
    expect(v("policy").tools).toMatchObject({ chips: ["web_search", "fetch_url"] });
    expect(v("policy").model.value).toBe("Qwen3.8-27B · mlx");
    expect(v("policy").max_iterations.value).toBe("20");
    expect(v("policy").tool_approval.value).toBe("auto");
    expect(v("policy").retry).toMatchObject({ value: "3 attempts", aside: "backoff 30s × 2 up to 10m" });
    expect(v("after").notify).toMatchObject({ chips: ["console", "email"] });
    expect(v("where").workspace).toMatchObject({ value: "/ws/digest", mono: true });
    // No tools on the definition: the flow's default, said as such.
    const no_tools = build_board({ active: [ctl], done: [], automations: new Map([["auto1", { ...DIGEST, tools: [] }]]), now_ms: NOW_MS }).scheduled[0];
    expect(card_info_sections(no_tools, { now_ms: NOW_MS, stall_after_ms: 1 }).find((s) => s.id === "policy")!.rows.find((x) => x.id === "tools")).toMatchObject({ value: "flow default", source: "flow" });
    const info = renderToStaticMarkup(React.createElement(CardInfo, { card, now_ms: NOW_MS, stall_after_ms: 5 * 60_000, facts, revision: 1, on_open_automation: noop, on_open_run: noop, on_cancel_run: async () => null }));
    expect(plain(info)).not.toContain("…");
    // An automation card offers its automation; never Cancel (that is the Automations page's pause/archive), nor Open run.
    expect(plain(info.slice(info.indexOf('class="mc_info_actions">') + 'class="mc_info_actions">'.length))).toBe("Open automation");
    // Name it is a compact row right under the title.
    expect(info.indexOf('data-row="name_it"')).toBeGreaterThan(info.indexOf('data-row="title"'));
    expect(info.indexOf('data-row="name_it"')).toBeLessThan(info.indexOf('data-row="task"'));
  });

  it("Done: the WHY-NOW is a glimpse of the answer (markdown flattened), and the metrics read time · tokens · tools · artifacts", () => {
    const done = row({ run_id: "d1", status: "completed", created_at: at(30), updated_at: at(6), tokens_total: 99_921, tool_calls: 11 });
    const card = build_board({ active: [], done: [done], now_ms: NOW_MS }).done[0];
    const outcome = { answer: "# International Digest\n**Date: 14 October 2026** · the week in review", artifacts: 3 };
    expect(card_metrics(card, outcome)).toEqual(["24m", "99,921 tk", "11 tools", "3 artifacts"]);
    const html = html_of(card, { outcome });
    expect(text_of(card, { ...H, outcome })).toContain("24m · 99,921 tk · 11 tools · 3 artifacts");
    expect(html).toContain('class="mc_glimpse mc_glimpse_answer"');
    const glimpse = plain(html.match(/class="mc_glimpse mc_glimpse_answer"[^>]*>([\s\S]*?)<div class="mc_card_foot"/)![1]);
    expect(glimpse).toContain("International Digest");
    expect(glimpse).toContain("Date: 14 October 2026");
    expect(glimpse).not.toMatch(/#|\*\*/);
    // The sentence ("completed in 24m") gives way to the answer; before the outcome is read it stays.
    expect(html).not.toContain("mc_state_text");
    expect(html_of(card)).toContain("completed in 24m");
    expect(card_metrics(card, null)).toEqual(["24m", "99,921 tk", "11 tools"]);
    // A failure keeps its error as the line.
    const failed = build_board({ active: [], done: [row({ run_id: "f1", status: "failed", error: "provider timeout" })], now_ms: NOW_MS }).done[0];
    expect(html_of(failed, { outcome })).not.toContain("mc_glimpse_answer");
    expect(text_of(failed, { ...H, outcome })).toContain("failed: provider timeout");
  });
});

describe("a parent blocked only by a run that needs you rides that run's card (operator 2026-10-15)", () => {
  const NOW = Date.parse("2026-10-13T23:50:00Z");
  const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
  it("the parent is not carded in Waiting on…; the Needs-you card says 'blocks <parent>' and takes the parent's title when its own is a generated id", () => {
    const parent = row({ run_id: "root", status: "waiting", session_id: "s-1", workflow_id: "multiagent-coding@0.0.1:main", waiting: { reason: "subworkflow" }, updated_at: at(30) });
    const child = row({ run_id: "kid", parent_run_id: "root", session_id: "s-1", workflow_id: "visual_react_agent_multiagent-coding_0_0_1_builder", status: "waiting", waiting: { reason: "user" }, updated_at: at(10) });
    const details = new Map([["kid", { waiting: { reason: "user", wait_key: "k", details: { tool_calls: [{ name: "execute_command" }] } } }]]);
    const lanes = build_board({ active: [parent, child], done: [], details, now_ms: NOW, run_briefs: new Map([["root", { run_id: "root", excerpt: "Write solution.py with factorial(n)" }]]) });
    expect(lanes.waiting_on.map((c) => c.run_id)).toEqual([]);
    const card = lanes.needs_you.find((c) => c.run_id === "kid")!;
    expect(card.blocks).toEqual([{ run_id: "root", title: "Write solution.py with factorial(n)" }]);
    expect(card.title.text).toBe("Write solution.py with factorial(n)");
    expect(card.subject.secondary).toBe("subrun · visual_react_agent_multiagent-coding_0_0_1_builder");
    const html = renderToStaticMarkup(React.createElement(BoardCardView, { card, ...HANDLERS }));
    expect(html).toContain("blocks");
    expect(html).toContain("Write solution.py with factorial(n)");
  });
  it("a parent whose child waits on something ELSE stays in Waiting on…", () => {
    const parent = row({ run_id: "root2", status: "waiting", waiting: { reason: "subworkflow" }, updated_at: at(30) });
    const child = row({ run_id: "kid2", parent_run_id: "root2", status: "waiting", waiting: { reason: "event" }, updated_at: at(10) });
    const lanes = build_board({ active: [parent, child], done: [], now_ms: NOW });
    expect(lanes.waiting_on.map((c) => c.run_id)).toEqual(["root2"]);
    expect(lanes.needs_you).toEqual([]);
  });
});


describe("operator round 2026-10-15: loading state, automation cards, spacing", () => {
  const NOW_MS = Date.parse("2026-10-13T23:50:00Z");
  const at = (min: number) => new Date(NOW_MS - min * 60_000).toISOString();
  const H: CardHandlers = { ...HANDLERS, now_ms: NOW_MS };
  const html_of = (card: BoardCard, h?: Partial<CardHandlers>) => renderToStaticMarkup(React.createElement(BoardCardView, { card, ...H, ...(h || {}) }));
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const css = readFileSync(new URL("./board.css", import.meta.url), "utf8");
  const page = (extra: Partial<Parameters<typeof MissionControlPage>[0]>) =>
    renderToStaticMarkup(
      React.createElement(MissionControlPage, {
        gateway_connected: true,
        runs: [],
        all_runs: [],
        runs_refreshed_at: NOW_MS,
        entities: [],
        entities_total: 0,
        entities_error: "",
        refreshing: false,
        on_refresh: noop,
        on_open_run: noop,
        on_resume_wait: async () => {},
        on_open_automation: noop,
        entity_app_href: "",
        ...extra,
      }),
    );
  const ctl = row({ run_id: "auto1", role: "controller", session_kind: "automation", automation_id: "auto1", status: "waiting", waiting: { reason: "event", until: at(-72) } });
  const auto_card = (brief: AutomationBrief = DIGEST) => build_board({ active: [ctl], done: [], automations: new Map([["auto1", brief]]), now_ms: NOW_MS }).scheduled[0];
  const CTX_BODY = { ...DIGEST_BODY, summary: { ...DIGEST_BODY.summary, growing_max_tokens: 50_000, context_used_tokens: 31_000, occurrence_count: 14, last_occurrence: { run_id: "occ14", index: 14, status: "completed", fired_at: new Date(NOW_MS - 12 * 86_400_000 - 3_600_000).toISOString(), finished_at: new Date(NOW_MS - 12 * 86_400_000).toISOString() } } };
  const CTX: AutomationBrief = fold_automation_brief(CTX_BODY)!;

  it("A. before the first poll every lane holds skeleton cards and a '…' count — never an empty sentence; after it, the sentences", () => {
    const loading = page({ runs_refreshed_at: null });
    for (const lane of LANE_ORDER) {
      const col = loading.match(new RegExp(`<section class="mc_column mc_column_${lane}"[\\s\\S]*?</section>`))![0];
      expect((col.match(/class="mc_card mc_card_skeleton"/g) || []).length).toBe(SKELETON_CARDS[lane]);
      expect(col).toContain(`<span class="mc_column_count is_loading" title="loading" aria-busy="true">…</span>`);
      expect(col).not.toContain("mc_empty");
      expect(col).not.toContain(LANE_EMPTY[lane]);
    }
    expect(loading).toContain("loading runs…");
    expect(loading).not.toContain("loading…</div>");
    expect(SKELETON_CARDS).toEqual({ needs_you: 3, working: 3, waiting_on: 2, scheduled: 2, done: 3 });
    const polled = page({ runs_refreshed_at: NOW_MS, done_loaded: true });
    for (const lane of LANE_ORDER) {
      expect(polled).toContain(`<div class="mc_empty muted">${LANE_EMPTY[lane]}</div>`);
    }
    expect(polled).not.toContain("mc_card_skeleton");
    // Done keeps its skeletons until the first sweep lands, even after the active poll.
    const no_sweep = page({ runs_refreshed_at: NOW_MS, done_loaded: false });
    expect((no_sweep.match(/class="mc_card mc_card_skeleton"/g) || []).length).toBe(SKELETON_CARDS.done);
    expect(no_sweep).not.toContain(LANE_EMPTY.done);
    // The skeleton card: title + pill, two lines; shimmer in CSS, none under reduced motion.
    const sk = renderToStaticMarkup(React.createElement(SkeletonCards, { n: 2 }));
    expect((sk.match(/mc_sk_title/g) || []).length).toBe(2);
    expect(sk).toContain("mc_sk_pill");
    expect(css).toMatch(/\.mc_sk\s*\{[^}]*animation:\s*mc_shimmer/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.mc_sk\s*\{\s*animation:\s*none/);
    expect(css).toMatch(/\.mc_loading::before\s*\{[^}]*animation:\s*mc_spin/);
  });

  it("A. a card whose own detail is loading shows an inline skeleton line where it will land, not a blank", () => {
    const q = build_board({ active: [row({ run_id: "q1", status: "waiting", waiting: { reason: "user" }, session_id: "acode-1", updated_at: at(3) })], done: [], now_ms: NOW_MS }).needs_you[0];
    const loading = html_of(q, { detail_loading: true, brief_loading: true });
    expect(loading).toContain('<div class="mc_sk_row" role="status" aria-busy="true" aria-label="loading the request" title="loading the request…">');
    expect(loading).toMatch(/<span class="mc_card_title" title="loading the title…"><span class="mc_sk mc_sk_title"/);
    expect(loading).not.toContain("untitled");
    const settled = html_of(q);
    expect(settled).not.toContain("mc_sk_row");
    expect(settled).toContain("untitled");
    const d = build_board({ active: [], done: [row({ run_id: "d1", status: "completed", created_at: at(30), updated_at: at(6) })], now_ms: NOW_MS }).done[0];
    expect(html_of(d, { outcome_loading: true })).toContain('aria-label="loading the answer"');
    expect(html_of(d, { outcome_loading: true })).not.toContain("mc_state_text");
    expect(html_of(d)).toContain("completed in 24m");
    expect(html_of(d, { outcome_loading: true, outcome: { answer: "Done.", artifacts: 0 } })).toContain("mc_glimpse_answer");
    // An automation card without its brief yet: skeleton facts while loading, the wake sentence otherwise.
    const bare = build_board({ active: [ctl], done: [], now_ms: NOW_MS }).scheduled[0];
    expect(html_of(bare, { automation_loading: true })).toContain('aria-label="loading the schedule"');
    expect(plain(html_of(bare))).toContain("next run in 1h 12m");
  });

  it("C. the automation card: facts (schedule · next, last run · status · turns), a context bar, a footer of actions; no run metrics (the '12d 18h' was the controller's age)", () => {
    const card = auto_card(CTX);
    expect(card_metrics(card, null)).toEqual([]);
    expect(card.duration_ms).toBeGreaterThan(0);
    const html = html_of(card, { on_open_automation: noop, on_automation_command: async () => undefined, on_revise_automation: async () => undefined, revision: 3 });
    const words = plain(html);
    expect(words).not.toMatch(/\b\d+d \d+h\b(?! ago)/);
    expect(html).not.toContain("mc_card_metrics");
    expect(html).not.toContain("mc_copy");
    expect(html).toContain('class="mc_card mc_card_scheduled mc_card_automation"');
    // Row 2: two facts, absolute times in the tooltips.
    const facts = automation_facts_words(CTX, NOW_MS);
    const fired_abs = format_when(NOW_MS - 12 * 86_400_000 - 3_600_000, NOW_MS);
    expect(facts.schedule).toEqual({ text: "every 24h · next in 1h 12m", title: `every 24h · next run ${format_when(NOW_MS + 72 * 60_000, NOW_MS)}` });
    expect(facts.last).toEqual({ text: "last run 12d 1h ago · completed · 14 turns", title: `#14 completed · fired ${fired_abs} · took 1h 0m`, failed: false });
    expect(html).toContain(`<span class="mc_fact_cell mc_fact_last" title="#14 completed · fired ${fired_abs} · took 1h 0m">last run 12d 1h ago · completed · 14 turns</span>`);
    // Row 3: the bar reads used / budget from the served numbers; the chooser is closed.
    expect(html).toContain('<span class="mc_ctx_label">context 31k / 50k</span>');
    expect(html).toMatch(/<span class="mc_ctx_fill" style="width:62%"><\/span>/);
    expect(html).toMatch(/<button type="button" class="mc_ctx_bar" aria-expanded="false" aria-label="context 31k \/ 50k: change the budget" title="31,000 tokens of history were replayed into the last run · budget 50,000 tokens · click to change">/);
    expect(html).not.toContain("mc_ctx_chooser");
    // Row 4: Open · Run now · Pause schedule · (i), in that order, enabled by the served capabilities (revise, pause).
    const foot = html.match(/<div class="mc_card_foot mc_auto_foot">[\s\S]*$/)![0];
    expect(plain(foot).replace(/\s+/g, " ")).toMatch(/^Open Run now Pause schedule i$/);
    expect(foot).toMatch(/<button type="button" class="btn mc_btn_sm mc_btn_quiet" title="Open this automation on the Automations page">Open<\/button>/);
    expect(foot).toContain('aria-label="Pause schedule">Pause schedule</button>');
    expect(foot).toMatch(/<span class="mc_btn_wrap" title="Not permitted for this automation\."><button type="button" class="btn mc_btn_sm mc_btn_quiet" disabled="" title="Not permitted for this automation\." aria-label="Run now">Run now<\/button><\/span>/);
    expect(foot).toContain('class="mc_info_btn"');
    // Hover reveal with its space kept; always shown on touch.
    expect(css).toMatch(/\.mc_auto_foot > \.btn,\s*\.mc_auto_foot > \.mc_btn_wrap\s*\{\s*opacity:\s*0;/);
    expect(css).toMatch(/\.mc_card:hover \.mc_auto_foot > \.btn,[\s\S]*?opacity:\s*1/);
    expect(css).toMatch(/@media \(hover: none\)\s*\{\s*\.mc_auto_foot > \.btn,\s*\.mc_auto_foot > \.mc_btn_wrap\s*\{\s*opacity:\s*1/);
  });

  it("C. facts: paused / in progress / failed last run (✗ + the first words of the notification or answer) / no run yet / manual", () => {
    const paused = automation_facts_words({ ...CTX, status: "paused", paused_reason: "its workflow was made unavailable" }, NOW_MS);
    expect(paused.schedule).toEqual({ text: "every 24h · paused", title: "every 24h · its workflow was made unavailable" });
    const running = automation_facts_words({ ...CTX, current: { index: 15, run_id: "occ15", status: "running" } }, NOW_MS);
    expect(running.schedule.text).toBe("every 24h · run #15 in progress");
    const failed = automation_facts_words({ ...CTX, last: { ...CTX.last!, status: "failed" }, last_notification_text: "Email result failed — the mailbox refused the message because the recipient is not on the allowed list of this automation" }, NOW_MS);
    expect(failed.last.failed).toBe(true);
    expect(failed.last.text).toBe("last run 12d 1h ago · ✗ failed — Email result failed — the mailbox refused the message becau… · 14 turns");
    expect(failed.last.title).toContain("Email result failed — the mailbox refused the message because the recipient is not on the allowed list of this automation");
    const failed_excerpt = automation_facts_words({ ...CTX, last: { ...CTX.last!, status: "failed" }, last_excerpt: "provider timeout" }, NOW_MS);
    expect(failed_excerpt.last.text).toBe("last run 12d 1h ago · ✗ failed — provider timeout · 14 turns");
    expect(html_of(auto_card({ ...CTX, last: { ...CTX.last!, status: "failed" } }))).toContain('class="mc_fact_cell mc_fact_last is_failed"');
    const never = automation_facts_words({ ...CTX, last: null, occurrence_count: 0 }, NOW_MS);
    expect(never.last).toEqual({ text: "no run yet · 0 turns", title: "this automation has not run", failed: false });
    const manual = automation_facts_words({ ...CTX, cadence: "manual", next_fire_ms: null }, NOW_MS);
    expect(manual.schedule.text).toBe("manual");
    const ended = automation_facts_words({ ...CTX, status: "completed", next_fire_ms: null }, NOW_MS);
    expect(ended.schedule.text).toBe("every 24h · completed: no next run");
  });

  it("C. the context row: used over budget when served; the budget alone when the run recorded none; a chip for independent", () => {
    expect(context_budget_view(CTX)).toEqual({ mode: "growing", used: 31_000, budget: 50_000, label: "context 31k / 50k", ratio: 0.62 });
    expect(context_budget_view({ ...CTX, context_used_tokens: null })).toEqual({ mode: "growing", used: null, budget: 50_000, label: "context · 50k budget", ratio: null });
    expect(context_budget_view({ ...CTX, context_used_tokens: 80_000 }).ratio).toBe(1);
    expect(context_budget_view({ ...CTX, growing_max_tokens: null })).toMatchObject({ budget: null, label: "context", ratio: null });
    expect(context_budget_view({ ...CTX, context_mode: "independent" })).toEqual({ mode: "independent", used: null, budget: null, label: "independent context", ratio: null });
    const html = html_of(auto_card({ ...CTX, context_mode: "independent" }));
    expect(html).toContain('<span class="mc_ctx_chip" title="independent context: every run starts from the task alone">independent context</span>');
    expect(html).not.toContain("mc_ctx_bar");
    // The served number: fold_automation_brief reads summary.context_used_tokens (null when absent or not a count).
    expect(fold_automation_brief({ ...CTX_BODY, summary: { ...CTX_BODY.summary, context_used_tokens: "31000" } })!.context_used_tokens).toBeNull();
    expect(fold_automation_brief({ ...CTX_BODY, summary: { ...CTX_BODY.summary, context_used_tokens: -1 } })!.context_used_tokens).toBeNull();
    expect(DIGEST.context_used_tokens).toBeNull();
    // Without the revise capability or a host the bar is read-only and says where to change it.
    const ro = html_of(auto_card({ ...CTX, can_revise: false }), { on_revise_automation: async () => undefined });
    expect(ro).toMatch(/<button type="button" class="mc_ctx_bar" aria-expanded="false"[^>]*disabled=""[^>]*title="context 31k \/ 50k · the budget is changed on the Automations page"/);
  });

  it("C. the chooser: 25k · 50k · 100k · 200k · custom; saving is optimistic through the revision-based edit; a failure undoes it with the gateway's sentence", async () => {
    expect([...BUDGET_CHOICES]).toEqual([25_000, 50_000, 100_000, 200_000]);
    expect(budget_changes(100_000)).toEqual({ context: { mode: "growing", growing: { max_tokens: 100_000 } } });
    expect(parse_budget("75000")).toBe(75_000);
    for (const bad of ["", "0", "-5", "1.5", "75k", "abc"]) expect(parse_budget(bad)).toBeNull();
    let st = budget_reducer(INITIAL_BUDGET, { type: "open" });
    expect(st.phase).toBe("choose");
    st = budget_reducer(st, { type: "custom", value: "75000" });
    expect(st.custom).toBe("75000");
    st = budget_reducer(st, { type: "save", value: 100_000, base: 50_000 });
    expect(st).toEqual({ phase: "saving", custom: "", error: "", optimistic: { value: 100_000, base: 50_000 } });
    // Optimistic: the card shows 100k while the wire still says 50k; once the re-read moves, the wire wins.
    expect(shown_budget({ growing_max_tokens: 50_000 }, st)).toBe(100_000);
    expect(shown_budget({ growing_max_tokens: 100_000 }, st)).toBe(100_000);
    expect(shown_budget({ growing_max_tokens: 60_000 }, st)).toBe(60_000);
    const saved = budget_reducer(st, { type: "saved" });
    expect(saved).toMatchObject({ phase: "idle", optimistic: { value: 100_000, base: 50_000 } });
    const failed = budget_reducer(st, { type: "failed", error: "Automation is at revision 1, not 7." });
    expect(failed).toEqual({ phase: "idle", custom: "", error: "Automation is at revision 1, not 7.", optimistic: null });
    expect(shown_budget({ growing_max_tokens: 50_000 }, failed)).toBe(50_000);
    expect(budget_reducer(INITIAL_BUDGET, { type: "close" })).toEqual(INITIAL_BUDGET);
    expect(budget_reducer(INITIAL_BUDGET, { type: "save", value: 1, base: null })).toEqual(INITIAL_BUDGET);
    // save_budget sends THE change with the revision; the gateway's sentence comes back on failure.
    const calls: any[] = [];
    const ok = await save_budget(async (...a) => void calls.push(a), "auto1", 3, 200_000);
    expect(ok).toEqual({ type: "saved" });
    expect(calls).toEqual([["auto1", { context: { mode: "growing", growing: { max_tokens: 200_000 } } }, 3]]);
    const conflict = await save_budget(async () => {
      throw { status: 409, code: "revision_conflict", message: "Automation is at revision 1, not 7." };
    }, "auto1", 7, 25_000);
    expect(conflict).toEqual({ type: "failed", error: "Automation is at revision 1, not 7." });
    const plain_err = await save_budget(async () => {
      throw new Error("network down");
    }, "auto1", null, 25_000);
    expect(plain_err).toEqual({ type: "failed", error: "network down" });
  });

  it("C. the footer gates follow the served capabilities like the Automations page, and a command's failure is the gateway's sentence", async () => {
    const c = automation_card_controls(CTX, false);
    expect(c.run_now).toEqual({ enabled: false, reason: "Not permitted for this automation." });
    expect(c.toggle).toEqual({ command: "automation.pause", label: "Pause schedule", state: { enabled: true } });
    const full = automation_card_controls({ ...CTX, capabilities: ["revise", "pause", "resume", "run_now"] }, false);
    expect(full.run_now).toEqual({ enabled: true });
    const running = automation_card_controls({ ...CTX, capabilities: ["run_now", "pause"], current: { index: 15, run_id: "o", status: "running" } }, false);
    expect(running.run_now).toEqual({ enabled: false, reason: "An occurrence is in progress." });
    const paused = automation_card_controls({ ...CTX, status: "paused", capabilities: ["resume", "run_now"], paused_reason: "its workflow was made unavailable" }, false);
    expect(paused.toggle).toEqual({ command: "automation.resume", label: "Resume schedule", state: { enabled: true, reason: "paused by the gateway: its workflow was made unavailable" } });
    // Run now while paused is allowed (the Automations page says "it stays paused"); after the end it is not.
    expect(paused.run_now).toEqual({ enabled: true });
    expect(automation_card_controls({ ...CTX, status: "completed", capabilities: ["run_now", "pause"] }, false).run_now).toEqual({ enabled: false, reason: "The automation has ended." });
    expect(automation_card_controls({ ...CTX, legacy: true }, false).toggle.state.reason).toBe("Legacy schedule: managed with its existing controls.");
    expect(automation_card_controls(CTX, true).run_now).toEqual({ enabled: false, reason: "Working…" });
    expect(automation_card_controls(null, false).run_now).toEqual({ enabled: false, reason: "automation details are loading" });
    const sent: any[] = [];
    expect(await send_automation_command(async (...a) => void sent.push(a), "auto1", "automation.run_now")).toBeNull();
    expect(sent).toEqual([["auto1", "automation.run_now"]]);
    expect(await send_automation_command(async () => {
      throw { status: 409, code: "invalid_state", message: "An occurrence is in progress." };
    }, "auto1", "automation.run_now")).toBe("An occurrence is in progress.");
    // Without a host the buttons say so.
    const html = html_of(auto_card({ ...CTX, capabilities: ["run_now", "pause"] }));
    expect(html).toContain('title="commands are not wired on this host" aria-label="Run now"');
    expect(html).toMatch(/<button type="button" class="btn mc_btn_sm mc_btn_quiet" disabled="" title="not available here">Open<\/button>/);
  });

  it("D. spacing: cards are tighter, facts a two-column grid, no empty rows, relative times carry the absolute time; status colours unchanged", () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const last = (sel: string) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
      const all = [...flat.matchAll(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))];
      if (!all.length) throw new Error(`no rule ${sel}`);
      return all[all.length - 1][1];
    };
    expect(last(".mc_card")).toMatch(/gap:\s*5px/);
    expect(last(".mc_card")).toMatch(/padding:\s*9px 11px 8px/);
    expect(last(".mc_facts")).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
    expect(last(".mc_fact_cell")).toMatch(/text-overflow:\s*ellipsis/);
    expect(last(".mc_card > :empty:not(.mc_sk)")).toMatch(/display:\s*none/);
    expect(last(".mc_card_metrics")).toMatch(/line-height:\s*1\.4/);
    // Status dots keep their colour map (one word, one class).
    for (const [word, cls] of [["running", "info"], ["failed", "danger"], ["waiting", "warn"], ["completed", "ok"], ["scheduled", "info"]]) {
      expect(run_status_class(word)).toBe(cls);
    }
    expect(html_of(auto_card(CTX))).toContain('<span class="mc_status info">scheduled</span>');
    // Needs-you: the title and the pill share the head row; the since-time is absolute already.
    const q = build_board({ active: [row({ run_id: "q1", status: "waiting", waiting: { reason: "user" }, session_id: "acode-1", updated_at: at(3) })], done: [], now_ms: NOW_MS }).needs_you[0];
    const head = html_of(q).match(/<div class="mc_card_head">[\s\S]*?<\/div>/)![0];
    expect(head).toContain("mc_card_title");
    expect(head).toContain('class="mc_status warn"');
    expect(plain(html_of(q))).toContain(`since ${format_when(NOW_MS - 3 * 60_000, NOW_MS)} (3m)`);
  });
});
