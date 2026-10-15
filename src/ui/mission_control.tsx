// THE BOARD — "Now" (backlog 0003 wave 1, 2026-10-14; supersedes the
// 2026-07-12 four-column Mission Control).
//
// Five lanes grouped by BLOCKER, never by status word: Needs you · Working ·
// Waiting on… · Scheduled · Done. Cards still move THEMSELVES (state-driven,
// no drag); the operator acts in Needs you, where waits carry inline
// Approve / Reject / Answer / Resume. Every card answers WHAT (title) · WHO
// (automation or session) · WHY-NOW (a state sentence with an object and an
// actor) · metrics, in that order; the run id never renders as text (⧉
// copies it, its tooltip shows it).
//
// Honesty rules carried in:
// - Lanes and sentences come from state_line.ts (the one vocabulary) over
//   wire truth — status, the wait object, the automation record, the last
//   ledger record — never from prose.
// - One truth per run (P5): a parent parked on its OWN running child is
//   Working and inherits the child's staleness; the child is not carded
//   twice. A child that needs you is carded in Needs you.
// - Progress is data (P6): a running card always carries the age of its
//   last ledger touch; the "no progress" mark is that age past the VISIBLE
//   threshold chosen in the board header.
// - Row-only `reason=user` waits say they are unresolved until one bounded,
//   cached detail call resolves them (board_data.ts).
// - The entities strip reads the CHEAP card endpoint (gateway c1038:
//   card + as_of_seq), never whole-life replay folds.
// - Staleness is visible (data age chip + loading count) because the board
//   is only as live as its poll.
import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./board.css";

import { AfChip, AfMemoryHintChip, Icon, automationControls, type AutomationChanges, type AutomationSummary, type ControlState } from "@abstractframework/ui-kit";
import { Markdown } from "@abstractframework/panel-chat";

import { extract_tool_calls_from_wait } from "../lib/runtime_extractors";
import { clipboardWrite } from "../lib/secure-context";
import { run_session_tag, run_session_tag_label, to_api_error, type RunSessionTag } from "./automations";
import {
  automation_facts,
  rows_in_viewport,
  useAutomationBriefs,
  useRunBriefs,
  useRunOutcomes,
  useRunPulses,
  useVisibleCards,
  useWaitDetails,
  type AutomationFacts,
  type BoardDataClient,
  type RunOutcome,
} from "./board_data";
import { parse_iso_ms, run_duration_ms, terminal_run_status } from "./format";
import { Modal } from "./modal";
import { run_status_class, stop_reason_of, type RunSummary } from "./run_status";
import {
  DEFAULT_STALL_AFTER_MS,
  card_title,
  compact_duration,
  make_context,
  pill_word,
  state_line,
  subject_of,
  workflow_short,
  type AutomationBrief,
  type BoardLane,
  type CardTitle,
  type RunBrief,
  type RunPulse,
  type StateContext,
  type StateLine,
  type Subject,
} from "./state_line";

// --- lanes ------------------------------------------------------------------------

/* NEEDS YOU FIRST: the lane where a human is the blocker renders leftmost —
 * this order IS render order, and at narrow widths later lanes fall below
 * the fold (fable5 layout P1-5, kept from the four-column board). */
export const LANE_ORDER: BoardLane[] = ["needs_you", "working", "waiting_on", "scheduled", "done"];

export const LANE_LABEL: Record<BoardLane, string> = {
  needs_you: "Needs you",
  working: "Working",
  waiting_on: "Waiting on…",
  scheduled: "Scheduled",
  done: "Done",
};

/** Lane subtitles are BLOCKER sentences (design D2): who moves these cards. */
export const LANE_HINT: Record<BoardLane, string> = {
  needs_you: "only you can move these",
  working: "an agent is on it",
  waiting_on: "something else must happen first",
  scheduled: "will start by itself",
  done: "read the outcome",
};

/* Empty lanes say what empty MEANS — a bare "—" reads as a load failure
 * (fable5 layout P1-12). */
export const LANE_EMPTY: Record<BoardLane, string> = {
  needs_you: "nothing needs you",
  working: "no agent is working",
  waiting_on: "nothing is blocked",
  scheduled: "nothing scheduled",
  done: "no recent runs",
};


export type BoardCard = {
  run_id: string;
  lane: BoardLane;
  /** The state sentence with its object, actor and action (state_line.ts). */
  line: StateLine;
  title: CardTitle;
  subject: Subject;
  /** The one-word pill: "running" whenever the sentence says running (P5). */
  status_word: string;
  workflow_id: string;
  role: string;
  /** Resume identity for the inline controls: the detail's wait when read, else the row's. */
  wait_key: string;
  tool_names: string[];
  /** The tool calls awaiting approval, with their arguments (the detail's wait). */
  pending_calls: Array<{ name: string; arguments: any }>;
  prompt: string;
  allow_free_text: boolean;
  /** When the current state began (the wait's `since`, else the row's last update). */
  since_ms: number | null;
  duration_ms: number;
  tokens_total: number | null;
  llm_calls: number | null;
  tool_calls: number | null;
  failed: boolean;
  error: string;
  paused: boolean;
  /** The run's conversation is archived (still shown here: Observer is the audit view). */
  archived: boolean;
  /** The automation this run belongs to ("" otherwise). */
  automation_id: string;
  /** Automation tag from the gateway's attribution (never a workflow-id prefix). */
  tag: RunSessionTag | null;
  tag_label: string;
  /** The subrun the `run` actor badge opens, by its workflow's short name (never its uuid). */
  actor_run_label: string;
  /** Scheduled order: the automation's next fire, else the wake wait's `until`. */
  next_fire_ms: number | null;
  /** The cached automation record behind the (i), when known. */
  automation: AutomationBrief | null;
  /** Parents this Needs-you run blocks (nearest first): they are NOT carded in Waiting on
   * (operator 2026-10-15: "what is it waiting on also on the right? bad duplicates?") —
   * the one blocker is this card. */
  blocks: Array<{ run_id: string; title: string }>;
  /** Full task text for the (i): the automation's task, else the plain run's prompt. */
  task: string;
  row: RunSummary;
};

export type BoardLanes = Record<BoardLane, BoardCard[]>;

function empty_lanes(): BoardLanes {
  return { needs_you: [], working: [], waiting_on: [], scheduled: [], done: [] };
}

function id_of(r: RunSummary | null | undefined): string {
  return String(r?.run_id || "").trim();
}

/** A board root: a parent-less run, an automation occurrence (its parent is
 * the controller, which is carded separately), or a controller. */
export function is_board_root(run: RunSummary): boolean {
  const role = String(run?.role || "").trim();
  return !String(run?.parent_run_id || "").trim() || role === "occurrence" || role === "controller";
}

/** The pill: ONE word, ONE colour map — the shared `pill_word` (state_line.ts),
 * so the board and the Agent page never disagree. The detail's `paused` and
 * `stop_reason` are wire truth the row lacks (rows hard-code paused=false),
 * so they are handed over when read. */
export function card_status_word(run: RunSummary, line: StateLine, detail?: any, automation?: AutomationBrief | null): string {
  const paused = run?.paused === true || detail?.paused === true;
  return pill_word({ ...run, paused }, line, stop_reason_of(detail), automation ?? null);
}

function clamp_text(s: string, n: number): string {
  const t = String(s || "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function make_card(run: RunSummary, ctx: StateContext, line: StateLine, run_brief: RunBrief | null | undefined): BoardCard {
  const rid = id_of(run);
  const detail = ctx.details?.get(rid);
  const raw_wait = detail?.waiting ?? run?.waiting;
  const wait = raw_wait && typeof raw_wait === "object" ? (raw_wait as any) : null;
  const tool_calls = extract_tool_calls_from_wait(wait);
  const status = String(run?.status || "").trim().toLowerCase();
  const automation_id = String(run?.automation_id || "").trim();
  const automation = automation_id ? ctx.automations?.get(automation_id) ?? null : null;
  const child = line.actor_run_id ? ctx.by_id.get(line.actor_run_id) : undefined;
  const until_ms = parse_iso_ms(wait?.until || "");
  return {
    run_id: rid,
    lane: line.lane,
    line,
    title: card_title(run, ctx, run_brief),
    subject: subject_of(run, ctx),
    status_word: card_status_word(run, line, detail, automation),
    workflow_id: String(run?.workflow_id || "").trim(),
    role: String(run?.role || "").trim(),
    wait_key: String(wait?.wait_key || "").trim(),
    tool_names: tool_calls.map((tc: any) => String(tc?.name || "tool")).filter(Boolean),
    pending_calls: tool_calls.map((tc: any) => ({ name: String(tc?.name || "tool"), arguments: tc?.arguments ?? null })),
    prompt: String(wait?.prompt || "").trim(),
    allow_free_text: wait?.allow_free_text !== false,
    since_ms: parse_iso_ms(wait?.since || run?.updated_at || run?.created_at || ""),
    duration_ms: run_duration_ms(run as any, ctx.now_ms),
    tokens_total: typeof run?.tokens_total === "number" ? run.tokens_total : null,
    llm_calls: typeof run?.llm_calls === "number" ? run.llm_calls : null,
    tool_calls: typeof run?.tool_calls === "number" ? run.tool_calls : null,
    failed: status === "failed",
    error: String(run?.error || detail?.error || "").trim(),
    paused: line.verb === "paused",
    archived: (run as any)?.archived === true,
    automation_id,
    tag: run_session_tag(run),
    tag_label: run_session_tag_label(run),
    actor_run_label: child ? workflow_short(String(child.workflow_id || "")) || "subrun" : "",
    blocks: [],
    next_fire_ms: String(run?.role || "").trim() === "controller" ? automation?.next_fire_ms ?? until_ms : until_ms,
    automation,
    task: automation?.task || String(run_brief?.excerpt || "").trim(),
    row: run,
  };
}

/** One run's card, read through `ctx` (default: the run alone). */
export function board_card(run: RunSummary, ctx?: StateContext, run_brief?: RunBrief | null): BoardCard {
  const c = ctx || make_context([run]);
  return make_card(run, c, state_line(run, c), run_brief);
}

export type BoardInput = {
  /** Non-terminal rows from the active listings (running + waiting, every depth). */
  active: RunSummary[];
  /** Terminal rows (the 60 s sweep's roots). Non-terminal rows here are not fresh and are ignored. */
  done: RunSummary[];
  details?: Map<string, any>;
  pulses?: Map<string, RunPulse>;
  automations?: Map<string, AutomationBrief>;
  run_briefs?: Map<string, RunBrief>;
  now_ms: number;
  stall_after_ms?: number;
};

const num_asc = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b);
const num_desc = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);

/** Lane orders (design §Now): Needs you oldest wait first · Working stalled
 * first, then the stalest · Waiting on oldest first · Scheduled by next fire ·
 * Done failures first, then newest. */
export function sort_lanes(lanes: BoardLanes): BoardLanes {
  lanes.needs_you.sort((a, b) => num_asc(a.since_ms, b.since_ms));
  lanes.working.sort((a, b) => Number(b.line.stalled) - Number(a.line.stalled) || num_desc(a.line.stale_ms, b.line.stale_ms) || num_asc(a.since_ms, b.since_ms));
  lanes.waiting_on.sort((a, b) => num_asc(a.since_ms, b.since_ms));
  lanes.scheduled.sort((a, b) => num_asc(a.next_fire_ms, b.next_fire_ms));
  lanes.done.sort((a, b) => Number(b.failed) - Number(a.failed) || num_desc(a.since_ms, b.since_ms));
  return lanes;
}

/**
 * The five lanes. Membership:
 * - every active board root is carded (controllers once per automation, in
 *   Scheduled — they ARE the automation cards);
 * - an active child is carded only when it needs you, or when its parent's
 *   sentence does not carry it (parent not on the board, or parked on a
 *   different child): a parent reading "running subrun X" never duplicates X;
 * - terminal roots (and terminal orphans) are Done.
 */
export function build_board(input: BoardInput): BoardLanes {
  const out = empty_lanes();
  const active: RunSummary[] = [];
  const done: RunSummary[] = [];
  const seen = new Set<string>();
  for (const r of input.active || []) {
    const id = id_of(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    (terminal_run_status(r?.status) ? done : active).push(r);
  }
  for (const r of input.done || []) {
    const id = id_of(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (terminal_run_status(r?.status)) done.push(r);
  }
  const ctx = make_context([...active, ...done], {
    details: input.details,
    pulses: input.pulses,
    automations: input.automations,
    now_ms: input.now_ms,
    stall_after_ms: input.stall_after_ms,
  });
  const active_by_id = new Map(active.map((r) => [id_of(r), r]));
  const lines = new Map<string, StateLine>();
  const line_of = (r: RunSummary): StateLine => {
    const id = id_of(r);
    let l = lines.get(id);
    if (!l) {
      l = state_line(r, ctx);
      lines.set(id, l);
    }
    return l;
  };
  const carried_by_parent = (r: RunSummary): boolean => {
    if (is_board_root(r)) return false;
    const parent = active_by_id.get(String(r?.parent_run_id || "").trim());
    return Boolean(parent) && line_of(parent!).actor_run_id === id_of(r);
  };
  // A parent whose wait chain ends at a run that NEEDS YOU is blocked by nothing else:
  // it rides that run's Needs-you card ("blocks <parent>") instead of a duplicate card
  // in Waiting on… (operator 2026-10-15).
  const needs_you_terminus = (r: RunSummary): string => {
    let cur: RunSummary | undefined = r;
    for (let depth = 0; cur && depth < 6; depth += 1) {
      const l = line_of(cur);
      if (l.lane === "needs_you") return depth === 0 ? "" : id_of(cur);
      if (l.lane !== "waiting_on" || l.actor !== "run" || !l.actor_run_id) return "";
      cur = active_by_id.get(l.actor_run_id);
    }
    return "";
  };
  const blocked_parents = new Map<string, RunSummary[]>();
  const folded = new Set<string>();
  for (const r of active) {
    const terminus = needs_you_terminus(r);
    if (!terminus) continue;
    folded.add(id_of(r));
    const list = blocked_parents.get(terminus) || [];
    list.push(r);
    blocked_parents.set(terminus, list);
  }
  const seen_automation = new Set<string>();
  for (const r of active) {
    const line = line_of(r);
    if (line.lane !== "needs_you" && carried_by_parent(r)) continue;
    if (folded.has(id_of(r))) continue;
    if (String(r?.role || "").trim() === "controller") {
      const aid = String(r?.automation_id || "").trim() || id_of(r);
      if (seen_automation.has(aid)) continue;
      seen_automation.add(aid);
    }
    const card = make_card(r, ctx, line, input.run_briefs?.get(id_of(r)));
    const parents = blocked_parents.get(id_of(r));
    if (parents && parents.length) {
      // Nearest parent first: walk up from the child along parent_run_id.
      const chain: RunSummary[] = [];
      let cur = active_by_id.get(String(r?.parent_run_id || "").trim());
      while (cur && chain.length < 6 && parents.includes(cur)) {
        chain.push(cur);
        cur = active_by_id.get(String(cur?.parent_run_id || "").trim());
      }
      for (const p of parents) if (!chain.includes(p)) chain.push(p);
      card.blocks = chain.map((p) => ({ run_id: id_of(p), title: card_title(p, ctx, input.run_briefs?.get(id_of(p))).text }));
      // A generated child id is no title: the nearest TITLED ancestor names the card,
      // and the child's own workflow becomes the secondary line.
      if (card.title.untitled) {
        const named = chain.map((p) => card_title(p, ctx, input.run_briefs?.get(id_of(p)))).find((t) => !t.untitled);
        if (named) {
          card.title = { ...named };
          card.subject = { ...card.subject, secondary: `subrun · ${workflow_short(card.workflow_id) || "run"}` };
        }
      }
    }
    out[card.lane].push(card);
  }
  for (const r of done) {
    if (!is_board_root(r) && ctx.by_id.has(String(r?.parent_run_id || "").trim())) continue;
    const card = make_card(r, ctx, line_of(r), input.run_briefs?.get(id_of(r)));
    out.done.push(card);
  }
  return sort_lanes(out);
}

/** The board's rows from the app's two listings: `all_runs` (every row seen;
 * its non-terminal rows are the fresh active set) and `runs` (listing roots,
 * which may hold a stale non-terminal copy — only their terminal rows count). */
export function split_board_rows(runs: RunSummary[], all_runs?: RunSummary[]): { active: RunSummary[]; done: RunSummary[] } {
  const source = all_runs && all_runs.length ? all_runs : runs || [];
  const active = source.filter((r) => id_of(r) && !terminal_run_status(r?.status));
  const done = [...(all_runs || []), ...(runs || [])].filter((r) => id_of(r) && terminal_run_status(r?.status));
  return { active, done };
}


// --- the "no progress after" threshold (P6: a visible user setting) --------------

export const STALL_STORAGE_KEY = "board_stall_after_ms";

export const STALL_AFTER_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 5 * 60_000, label: "5m" },
  { ms: 15 * 60_000, label: "15m" },
  { ms: 60 * 60_000, label: "1h" },
];

/** The remembered threshold (per viewer); anything not offered reads as the default. */
export function read_stall_after_ms(storage: Pick<Storage, "getItem"> | null | undefined): number {
  try {
    const raw = Number(storage?.getItem(STALL_STORAGE_KEY));
    return STALL_AFTER_OPTIONS.some((o) => o.ms === raw) ? raw : DEFAULT_STALL_AFTER_MS;
  } catch {
    return DEFAULT_STALL_AFTER_MS;
  }
}

function stall_label(ms: number): string {
  return STALL_AFTER_OPTIONS.find((o) => o.ms === ms)?.label || compact_duration(ms);
}

function viewer_storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// --- people, times, sentences and glimpses (pure: the card, the popover and the tests read them) ---

/** The person behind a run: its `actor_id` when it names one. On today's wire the
 * listing's actor of every chat run is the gateway principal ("gateway"), not the
 * user: that is never shown as a person, and nothing ever says "you". */
export function person_of(run: Pick<RunSummary, "actor_id"> | null | undefined): string {
  const a = String(run?.actor_id || "").trim();
  return a && a.toLowerCase() !== "gateway" ? a : "";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Oct 1, 09:14" in the viewer's time ("Oct 1 2025, 09:14" outside this year). */
export function format_when(ms: number, now_ms = Date.now()): string {
  const d = new Date(ms);
  const year = d.getFullYear() === new Date(now_ms).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "Oct 14, 23:06 UTC" — schedule times, which the automation itself keeps in UTC. */
export function format_utc(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** "13d 4h ago" / "in 11h 2m". */
export function format_relative(ms: number, now_ms = Date.now()): string {
  const delta = ms - now_ms;
  return delta > 0 ? `in ${compact_duration(delta)}` : `${compact_duration(-delta)} ago`;
}

/** "web_search, send_email" · "read_file ×2, edit_file" · "a, b, c and 2 more" (names in call order). */
export function tools_words(names: string[]): string {
  if (!names.length) return "a tool call";
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  const words = Array.from(counts, ([n, k]) => (k > 1 ? `${n} ×${k}` : n));
  return `${words.slice(0, 3).join(", ")}${words.length > 3 ? ` and ${words.length - 3} more` : ""}`;
}

/** Glue a phrase into one unbreakable unit ("Oct 1, 09:14", "(13d 4h)"): a wrap never splits it. */
const glued = (s: string) => s.split(" ").join("\u00a0");

/** A Needs-you card's WHY-NOW: WHO (a person, or nothing) and what is asked since when.
 * `<who> · asks since Oct 1, 09:14 (13d 4h)` · `needs approval for web_search since …` ·
 * `paused since …`. */
export function needs_you_line(card: BoardCard, now_ms: number): { who: string; text: string } {
  const since = card.since_ms !== null ? ` since ${glued(format_when(card.since_ms, now_ms))} ${glued(`(${compact_duration(Math.max(0, now_ms - card.since_ms))})`)}` : "";
  const action = card.line.action;
  if (card.line.verb === "paused") return { who: "", text: `paused${since}` };
  const who = person_of(card.row);
  if (action === "approve") return { who, text: `needs approval for ${tools_words(card.tool_names)}${since}` };
  if (action === "answer") return { who, text: `${card.prompt ? "asks" : "waits for an answer"}${since}` };
  if (card.line.unresolved) return { who, text: `needs you${since} · question, approval or pause` };
  return { who, text: `needs you${since}` };
}

function value_words(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return String(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** One tool call as words: `name(key: value, …)`; `cap` bounds each value (0 = whole). */
export function tool_call_words(call: { name: string; arguments?: any }, cap = 0): string {
  const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? Object.entries(call.arguments) : [];
  const shown = args.map(([k, v]) => `${k}: ${cap > 0 ? clamp_text(value_words(v), cap) : value_words(v)}`);
  return `${call.name}(${shown.join(", ")})`;
}

/** The arguments of one tool call, one `key: value` per line, values whole (the (i));
 * a list of plain values is one item per line under its key. */
export function tool_args_text(call: { arguments?: any }): string {
  const a = call.arguments;
  if (a === undefined || a === null) return "";
  if (typeof a !== "object" || Array.isArray(a)) return value_words(a);
  return Object.entries(a)
    .map(([k, v]) =>
      Array.isArray(v) && v.length && v.every((x) => x === null || typeof x !== "object") ? `${k}:\n${v.map((x) => value_words(x)).join("\n")}` : `${k}: ${value_words(v)}`,
    )
    .join("\n");
}

const GLIMPSE_CHARS = 600;
const GLIMPSE_TITLE_CHARS = 4000;

/** What a Needs-you card quotes under its line: the question, the tool calls with their
 * arguments, or the pause reason (rows hard-code nothing of it: the detail carries it).
 * `text` is the card's (bounded; the CSS clamps it to 3 lines), `full` its tooltip. */
export function request_glimpse(card: BoardCard, detail?: any): { text: string; full: string } | null {
  if (card.lane !== "needs_you") return null;
  if (card.line.verb === "paused") {
    const reason = String(detail?.pause_reason || card.row?.pause_reason || "").trim();
    return reason ? { text: clamp_text(reason, GLIMPSE_CHARS), full: clamp_text(reason, GLIMPSE_TITLE_CHARS) } : null;
  }
  if (card.line.action === "approve" && card.pending_calls.length) {
    const text = card.pending_calls.map((c) => tool_call_words(c, 120)).join("  ·  ");
    const full = card.pending_calls.map((c) => tool_call_words(c)).join("\n");
    return { text: clamp_text(text, GLIMPSE_CHARS), full: clamp_text(full, GLIMPSE_TITLE_CHARS) };
  }
  if (card.prompt) return { text: clamp_text(card.prompt, GLIMPSE_CHARS), full: clamp_text(card.prompt, GLIMPSE_TITLE_CHARS) };
  return null;
}

/** What a Done card shows as its WHY-NOW: a glimpse of the answer (empty until read, or
 * when the run answered nothing). */
export function outcome_glimpse(card: BoardCard, outcome?: RunOutcome | null): { text: string; full: string } | null {
  if (card.lane !== "done" || card.failed) return null;
  const answer = String(outcome?.answer || "").trim();
  return answer ? { text: clamp_text(answer, GLIMPSE_CHARS), full: clamp_text(answer, GLIMPSE_TITLE_CHARS) } : null;
}

/** "24m · 99,921 tk · 11 tools · 3 artifacts" — the card's metrics, as facts. An
 * automation card (controller) has none: its "duration" was the controller run's
 * age since the automation was created — the unexplained "12d 18h" of the
 * 2026-10-15 screenshot — and its facts rows say what matters instead. */
export function card_metrics(card: BoardCard, outcome?: RunOutcome | null): string[] {
  const out: string[] = [];
  if (card.role === "controller") return out;
  if (card.duration_ms >= 0) out.push(compact_duration(card.duration_ms));
  if (card.tokens_total !== null) out.push(`${card.tokens_total.toLocaleString("en-US")} tk`);
  if (card.tool_calls !== null) out.push(`${card.tool_calls} tool${card.tool_calls === 1 ? "" : "s"}`);
  if (card.lane === "done" && typeof outcome?.artifacts === "number") out.push(`${outcome.artifacts} artifact${outcome.artifacts === 1 ? "" : "s"}`);
  return out;
}

/** The conversation behind a card AbstractCode can open: a session that is not an automation's. */
export function code_session_of(card: BoardCard): string {
  const session = String(card.row?.session_id || "").trim();
  if (!session || card.automation_id || card.subject.kind === "automation" || session.startsWith("automation:")) return "";
  return session;
}

/** AbstractCode's own hash route: `<app url>#session=<session_id>&run=<run_id>`. */
export function code_href(app_url: string, session_id: string, run_id: string): string {
  const base = String(app_url || "").split("#")[0];
  return `${base}#session=${encodeURIComponent(session_id)}&run=${encodeURIComponent(run_id)}`;
}

export const CODE_INSTALL_HINT = "Install the AbstractCode web app (npx @abstractframework/code) to open this conversation";

/** Cancel is offered on a run that can still stop — never on an automation's own card
 * (pausing or archiving an automation lives on the Automations page). */
export function can_cancel(card: BoardCard): boolean {
  return card.lane !== "done" && card.role !== "controller";
}

// --- the (i): sections of facts (pure, so the popover and its tests read one list) ---

/** Where a title came from, as a source tag (never a parenthetical). */
export const TITLE_SOURCE_TAG: Record<CardTitle["source"], string> = {
  automation: "automation",
  brief: "run brief",
  excerpt: "prompt",
  workflow: "untitled",
};

/** The card's FULL title: excerpt and brief titles are clamped on the card. */
export function full_title(card: BoardCard): string {
  if (card.title.source === "excerpt" && card.task) return card.task;
  if (card.title.source === "brief") {
    const b = (card.row as any)?.brief;
    return String(b?.title || b?.task_excerpt || card.title.text).trim();
  }
  return card.title.text;
}

/** "growing context (100k)" / "independent context" — the automation's context mode (card subject line). */
export function context_words(a: AutomationBrief): string {
  const mode = String(a?.context_mode || "").trim();
  if (!mode) return "";
  if (mode === "growing" && typeof a.growing_max_tokens === "number" && a.growing_max_tokens > 0) return `growing context (${format_tokens(a.growing_max_tokens)})`;
  return `${mode} context`;
}

// --- the automation card (Scheduled lane; operator 2026-10-15) -----------------------

/** The budgets the context bar offers in one click; anything else is the custom field. */
export const BUDGET_CHOICES: readonly number[] = [25_000, 50_000, 100_000, 200_000];

export type AutomationFactsWords = {
  /** "every 24h · next in 5h 57m": the gateway's schedule words + the relative next run. */
  schedule: { text: string; title: string };
  /** "last run 12d ago · completed · 14 turns"; a failed last run reads "✗ failed — <first words>". */
  last: { text: string; title: string; failed: boolean };
};

/** The two facts of an automation card, from the brief alone (pure). Relative times carry the
 * absolute time in `title`. */
export function automation_facts_words(a: AutomationBrief, now_ms: number): AutomationFactsWords {
  const rule = a.schedule_rule_text || a.cadence || "";
  const in_progress = a.current && !terminal_run_status(a.current.status) ? a.current : null;
  let when = "";
  let when_title = "";
  if (a.status === "paused") {
    when = "paused";
    when_title = a.paused_reason || "scheduled runs are skipped while paused";
  } else if (in_progress) {
    when = `run #${in_progress.index} in progress`;
    when_title = a.next_fire_ms !== null ? `next run ${format_when(a.next_fire_ms, now_ms)}` : "";
  } else if (a.next_fire_ms !== null) {
    when = `next ${format_relative(a.next_fire_ms, now_ms)}`;
    when_title = `next run ${format_when(a.next_fire_ms, now_ms)}${a.next_run_local ? ` · ${a.next_run_local} (owner's zone)` : ""}`;
  } else if (a.status === "completed" || a.status === "failed") {
    when = `${a.status}: no next run`;
  } else if (a.cadence !== "manual") {
    when = "no next run";
  }
  const schedule = { text: [rule, when].filter(Boolean).join(" · "), title: [rule, when_title].filter(Boolean).join(" · ") };
  const turns = `${a.occurrence_count} turn${a.occurrence_count === 1 ? "" : "s"}`;
  if (!a.last) return { schedule, last: { text: `no run yet · ${turns}`, title: "this automation has not run", failed: false } };
  const l = a.last;
  const failed = l.status === "failed";
  const ago = l.fired_ms !== null ? format_relative(l.fired_ms, now_ms) : "";
  const words = failed ? clamp_text(a.last_notification_text || a.last_excerpt, 60) : "";
  const status = failed ? `✗ failed${words ? ` — ${words}` : ""}` : l.status;
  const took = l.fired_ms !== null && l.finished_ms !== null && l.finished_ms >= l.fired_ms ? compact_duration(l.finished_ms - l.fired_ms) : "";
  const text = [ago ? `last run ${ago}` : "last run", status, turns].filter(Boolean).join(" · ");
  const title = [`#${l.index} ${l.status}`, l.fired_ms !== null ? `fired ${format_when(l.fired_ms, now_ms)}` : "", took ? `took ${took}` : "", failed && (a.last_notification_text || a.last_excerpt) ? a.last_notification_text || a.last_excerpt : ""]
    .filter(Boolean)
    .join(" · ");
  return { schedule, last: { text, title, failed } };
}

export type ContextBudgetView = {
  mode: string;
  used: number | null;
  budget: number | null;
  /** "context 31k / 50k" · "context · 50k budget" (used unrecorded) · "independent context". */
  label: string;
  /** used / budget, clamped to 1; null when either is unknown. */
  ratio: number | null;
};

/** The context row of an automation card (pure). `used` is the gateway's served
 * `context_used_tokens` (the history the last occurrence was handed); null shows the budget alone. */
export function context_budget_view(a: Pick<AutomationBrief, "context_mode" | "growing_max_tokens" | "context_used_tokens">): ContextBudgetView {
  const mode = String(a.context_mode || "").trim();
  if (mode !== "growing") return { mode, used: null, budget: null, label: mode ? `${mode} context` : "", ratio: null };
  const budget = typeof a.growing_max_tokens === "number" && a.growing_max_tokens > 0 ? a.growing_max_tokens : null;
  const used = typeof a.context_used_tokens === "number" && a.context_used_tokens >= 0 ? a.context_used_tokens : null;
  const label = budget === null ? "context" : used === null ? `context · ${format_tokens(budget)} budget` : `context ${format_tokens(used)} / ${format_tokens(budget)}`;
  return { mode, used, budget, label, ratio: used !== null && budget !== null ? Math.min(1, used / budget) : null };
}

/** The revision the chooser sends: the Automations page's Edit box sends the same `context` block. */
export function budget_changes(max_tokens: number): AutomationChanges {
  return { context: { mode: "growing", growing: { max_tokens } } } as AutomationChanges;
}

/** A custom budget: a positive whole number of tokens, else null. */
export function parse_budget(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The chooser's state machine: open → pick or type → saving (optimistic) → idle; a failure
 * undoes the optimistic value and keeps the gateway's sentence under the bar. */
export type BudgetState = { phase: "idle" | "choose" | "saving"; custom: string; error: string; optimistic: { value: number; base: number | null } | null };
export type BudgetEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "custom"; value: string }
  | { type: "save"; value: number; base: number | null }
  | { type: "saved" }
  | { type: "failed"; error: string };

export const INITIAL_BUDGET: BudgetState = { phase: "idle", custom: "", error: "", optimistic: null };

export function budget_reducer(state: BudgetState, ev: BudgetEvent): BudgetState {
  switch (ev.type) {
    case "open":
      return state.phase === "idle" ? { ...state, phase: "choose", error: "" } : state;
    case "close":
      return state.phase === "choose" ? { ...state, phase: "idle", custom: "" } : state;
    case "custom":
      return { ...state, custom: ev.value };
    case "save":
      return state.phase === "choose" ? { phase: "saving", custom: "", error: "", optimistic: { value: ev.value, base: ev.base } } : state;
    case "saved":
      return state.phase === "saving" ? { ...state, phase: "idle" } : state;
    case "failed":
      return state.phase === "saving" ? { phase: "idle", custom: "", error: ev.error || "the change was not saved", optimistic: null } : state;
  }
}

/** The budget the card shows: the optimistic value until the brief re-read moves off the base it
 * was chosen over (then the wire wins). */
export function shown_budget(a: Pick<AutomationBrief, "growing_max_tokens">, state: Pick<BudgetState, "optimistic">): number | null {
  const o = state.optimistic;
  return o && o.base === a.growing_max_tokens ? o.value : a.growing_max_tokens;
}

export type ReviseHandler = (automation_id: string, changes: AutomationChanges, expected_revision: number | null) => Promise<unknown>;

/** Save a budget through the host's revise: `saved`, or `failed` with the gateway's sentence. */
export async function save_budget(on_revise: ReviseHandler, automation_id: string, revision: number | null, value: number): Promise<BudgetEvent> {
  try {
    await on_revise(automation_id, budget_changes(value), revision);
    return { type: "saved" };
  } catch (e) {
    return { type: "failed", error: to_api_error(e).message || "the change was not saved" };
  }
}

export type AutomationCardCommand = "automation.run_now" | "automation.pause" | "automation.resume";
export type CommandHandler = (automation_id: string, type: AutomationCardCommand) => Promise<unknown>;

export type AutomationCardControls = {
  run_now: ControlState;
  /** ONE of Pause schedule / Resume schedule, by the automation's status. */
  toggle: { command: "automation.pause" | "automation.resume"; label: string; state: ControlState };
};

/** The footer's gates: the kit's rule (`automationControls`, the same the Automations page
 * applies to the served `capabilities`), so a greyed button says the same reason there and here. */
export function automation_card_controls(a: AutomationBrief | null, busy: boolean): AutomationCardControls {
  if (!a) {
    const off: ControlState = { enabled: false, reason: "automation details are loading" };
    return { run_now: off, toggle: { command: "automation.pause", label: "Pause schedule", state: off } };
  }
  const in_progress = a.current && !terminal_run_status(a.current.status) ? a.current : null;
  const summary = {
    automation_id: a.automation_id,
    title: a.title,
    status: a.status,
    capabilities: a.capabilities,
    legacy: a.legacy,
    current_occurrence: in_progress ? { index: in_progress.index, run_id: in_progress.run_id, attempt: 1, status: in_progress.status } : null,
    occurrence_count: a.occurrence_count,
  } as unknown as AutomationSummary;
  const c = automationControls(summary, [], busy);
  const paused = a.status === "paused";
  const resume: ControlState = paused && a.paused_reason && c.resume.enabled ? { enabled: true, reason: `paused by the gateway: ${a.paused_reason}` } : c.resume;
  return {
    run_now: c.run_now,
    toggle: paused ? { command: "automation.resume", label: "Resume schedule", state: resume } : { command: "automation.pause", label: "Pause schedule", state: c.pause },
  };
}

/** Send a footer command: `null` on success, else the gateway's sentence. */
export async function send_automation_command(on_command: CommandHandler, automation_id: string, type: AutomationCardCommand): Promise<string | null> {
  try {
    await on_command(automation_id, type);
    return null;
  } catch (e) {
    return to_api_error(e).message || "the command was not sent";
  }
}

export type InfoRow = {
  id: string;
  label: string;
  /** The value as words; ⧉ copies `copy` when given, else this. */
  value: string;
  /** A second, muted fact after the value ("in 11h 2m", the workflow id). */
  aside?: string;
  /** Identifiers and paths only — never prose. */
  mono?: boolean;
  aside_mono?: boolean;
  /** Prose that may be long: folded by size, "show all (N chars)". */
  long?: boolean;
  /** Names shown as chips (tools, channels). */
  chips?: string[];
  /** Where the value comes from, as a small tag. */
  source?: string;
  copy?: string;
};

export type InfoSectionId = "run" | "spend" | "automation" | "schedule" | "policy" | "after" | "where";
export type InfoSection = { id: InfoSectionId; title: string; rows: InfoRow[] };

export type InfoInput = {
  now_ms: number;
  stall_after_ms: number;
  /** The run's `GET /runs/{id}` when read (wait details), for the workspace and pause reason. */
  detail?: any;
  outcome?: RunOutcome | null;
  /** The raw automation record's extra facts (trigger source, stop, retry, target workflow). */
  facts?: AutomationFacts | null;
  revision?: number | null;
};

const SECTION_TITLE: Record<InfoSectionId, string> = {
  run: "Run",
  spend: "Spend",
  automation: "Automation",
  schedule: "Schedule",
  policy: "Policy",
  after: "After each run",
  where: "Where",
};

function plural(n: number, one: string): string {
  return `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;
}

function time_row(id: string, label: string, ms: number | null, now_ms: number, utc = false): InfoRow | null {
  if (ms === null) return null;
  return { id, label, value: utc ? format_utc(ms) : format_when(ms, now_ms), aside: format_relative(ms, now_ms), copy: new Date(ms).toISOString() };
}

function wait_kind_words(card: BoardCard): string {
  const l = card.line;
  if (l.verb === "paused") return "you, to resume it";
  if (l.action === "approve") return `your approval of ${plural(card.pending_calls.length || card.tool_names.length || 1, "tool call")}`;
  if (l.action === "answer") return card.prompt ? "your answer to a question" : "your answer";
  if (l.unresolved) return "you: a question, an approval or a resume";
  if (l.actor === "clock") return "the clock";
  if (l.actor === "external") return l.object || "an external event";
  if (l.actor === "run") return l.object || "a subrun";
  return l.object || "unknown";
}

function workflow_row(id: string, workflow_id: string): InfoRow | null {
  if (!workflow_id) return null;
  const short = workflow_short(workflow_id);
  return { id, label: "Workflow", value: short || workflow_id, aside: short && short !== workflow_id ? workflow_id : "", aside_mono: true, copy: workflow_id };
}

const push = (rows: InfoRow[], r: InfoRow | null | undefined | false) => {
  if (r) rows.push(r);
};

/** The (i) as sections: Run · Spend · (Automation · Schedule · Policy · After each run) · Where. */
export function card_info_sections(card: BoardCard, input: InfoInput): InfoSection[] {
  const { now_ms } = input;
  const a = card.automation;
  const facts = input.facts ?? null;
  const row = card.row;
  const is_controller = card.role === "controller";
  const out: InfoSection[] = [];

  if (!is_controller) {
    const rows: InfoRow[] = [];
    if (!card.automation_id) {
      const title = full_title(card);
      push(rows, { id: "title", label: "Title", value: title, long: true, source: TITLE_SOURCE_TAG[card.title.source] });
      if (card.task && card.task !== title) push(rows, { id: "task", label: "Task", value: card.task, long: true, source: "prompt" });
    }
    push(rows, workflow_row("workflow", card.workflow_id));
    push(rows, { id: "run_id", label: "Run id", value: card.run_id, mono: true });
    const session = String(row?.session_id || "").trim();
    if (session) push(rows, { id: "session", label: "Session", value: session, mono: true });
    push(rows, time_row("started", "Started", parse_iso_ms(row?.created_at || ""), now_ms));
    push(rows, time_row("last_activity", "Last activity", parse_iso_ms(row?.updated_at || ""), now_ms));
    const actor = String(row?.actor_id || "").trim();
    push(rows, actor ? { id: "started_by", label: "Started by", value: actor, source: person_of(row) ? "" : "not a person" } : { id: "started_by", label: "Started by", value: "not on this row" });
    // The card's own sentence quotes a clamped ask; the (i) gives the whole of it below.
    push(rows, { id: "state", label: "State", value: card.failed && card.error ? `failed: ${card.error}` : card.lane === "needs_you" ? card.line.brief : card.line.text, long: true });
    if (card.lane === "needs_you" || card.lane === "waiting_on") {
      push(rows, { id: "wait_kind", label: "Waiting for", value: wait_kind_words(card) });
      push(rows, time_row("wait_since", "Since", card.since_ms, now_ms));
      if (card.line.verb === "paused") {
        const reason = String(input.detail?.pause_reason || row?.pause_reason || "").trim();
        if (reason) push(rows, { id: "pause_reason", label: "Reason", value: reason, long: true });
      } else if (card.pending_calls.length) {
        card.pending_calls.forEach((c, i) => push(rows, { id: `tool_call_${i}`, label: i === 0 ? "Tool calls" : "", value: tool_args_text(c), chips: [c.name], long: true, copy: tool_call_words(c) }));
      } else if (card.prompt) {
        push(rows, { id: "question", label: "Question", value: card.prompt, long: true });
      }
    }
    if (card.lane === "working") push(rows, { id: "no_progress", label: "No progress", value: `marked after ${stall_label(input.stall_after_ms)} without a ledger step`, source: "board header" });
    out.push({ id: "run", title: SECTION_TITLE.run, rows });

    const spend: InfoRow[] = [];
    const active = card.lane !== "done";
    if (card.duration_ms >= 0) push(spend, { id: "duration", label: "Duration", value: compact_duration(card.duration_ms), aside: active ? "so far" : "" });
    if (card.tokens_total !== null) push(spend, { id: "tokens", label: "Tokens", value: card.tokens_total.toLocaleString("en-US"), source: "whole run tree" });
    if (card.llm_calls !== null) push(spend, { id: "llm_calls", label: "LLM calls", value: card.llm_calls.toLocaleString("en-US") });
    if (card.tool_calls !== null) push(spend, { id: "tool_calls", label: "Tool calls", value: card.tool_calls.toLocaleString("en-US") });
    if (typeof input.outcome?.artifacts === "number") push(spend, { id: "artifacts", label: "Artifacts", value: input.outcome.artifacts.toLocaleString("en-US") });
    if (card.tokens_total === null && card.llm_calls === null && card.tool_calls === null) push(spend, { id: "metrics", label: "Metrics", value: "not measured yet: the 60 s metrics sweep fills them" });
    out.push({ id: "spend", title: SECTION_TITLE.spend, rows: spend });
  }

  if (a) {
    const rows: InfoRow[] = [];
    push(rows, { id: "title", label: "Title", value: a.title || "untitled", long: true, source: a.title ? "automation" : "" });
    if (a.task) push(rows, { id: "task", label: "Task", value: a.task, long: true });
    push(rows, { id: "automation_id", label: "Automation id", value: a.automation_id, mono: true });
    push(rows, workflow_row("target_workflow", facts?.workflow_id || (is_controller ? "" : card.workflow_id)));
    if (typeof input.revision === "number") push(rows, { id: "revision", label: "Revision", value: String(input.revision) });
    if (a.status) push(rows, { id: "status", label: "Status", value: a.status });
    out.push({ id: "automation", title: SECTION_TITLE.automation, rows });

    const sched: InfoRow[] = [];
    push(sched, { id: "trigger", label: "Trigger", value: a.cadence || "not on the record", source: facts?.trigger_source || "" });
    if (a.status === "paused") push(sched, { id: "next", label: "Next run", value: "none while paused: scheduled runs are skipped" });
    else push(sched, time_row("next", "Next run", a.next_fire_ms, now_ms, true) || { id: "next", label: "Next run", value: "none scheduled" });
    const in_progress = a.current && !terminal_run_status(a.current.status) ? a.current : null;
    if (in_progress) push(sched, { id: "current", label: "In progress", value: `#${in_progress.index} ${in_progress.status}` });
    if (a.last && !(in_progress && in_progress.index === a.last.index)) {
      const took = a.last.fired_ms !== null && a.last.finished_ms !== null && a.last.finished_ms >= a.last.fired_ms ? compact_duration(a.last.finished_ms - a.last.fired_ms) : "";
      const when = a.last.fired_ms !== null ? format_when(a.last.fired_ms, now_ms) : "";
      push(sched, { id: "last", label: "Last run", value: `#${a.last.index} ${a.last.status}`, aside: [took, when].filter(Boolean).join(" · ") });
    }
    push(sched, { id: "turns", label: "Turns", value: String(a.occurrence_count) });
    if (facts?.stop_after !== null && facts?.stop_after !== undefined) push(sched, { id: "stop_after", label: "Stop after", value: plural(facts.stop_after, "run") });
    if (facts?.stop_at_ms !== null && facts?.stop_at_ms !== undefined) push(sched, time_row("stop_at", "Stop at", facts.stop_at_ms, now_ms, true));
    out.push({ id: "schedule", title: SECTION_TITLE.schedule, rows: sched });

    const pol: InfoRow[] = [];
    if (a.context_mode) {
      const cap = a.context_mode === "growing" && typeof a.growing_max_tokens === "number" && a.growing_max_tokens > 0 ? `capped at ${format_tokens(a.growing_max_tokens)} tokens` : "";
      push(pol, { id: "context", label: "Context", value: a.context_mode, aside: cap });
    }
    push(pol, a.tools.length ? { id: "tools", label: "Tools", value: a.tools.join(", "), chips: a.tools } : { id: "tools", label: "Tools", value: "flow default", source: "flow" });
    const model = [a.model, a.provider].filter(Boolean).join(" · ");
    if (model) push(pol, { id: "model", label: "Model", value: model });
    if (a.max_iterations !== null) push(pol, { id: "max_iterations", label: "Max iterations", value: String(a.max_iterations) });
    if (a.tool_approval) push(pol, { id: "tool_approval", label: "Tool approval", value: a.tool_approval });
    if (a.untrusted_input_tools) push(pol, a.untrusted_input_tools.length ? { id: "untrusted", label: "Untrusted input", value: a.untrusted_input_tools.join(", "), chips: a.untrusted_input_tools } : { id: "untrusted", label: "Untrusted input", value: "no tool marked" });
    if (a.email_allowed_recipients) push(pol, { id: "recipients", label: "Email to", value: a.email_allowed_recipients.length ? a.email_allowed_recipients.join(", ") : "nobody" });
    if (facts?.retry) {
      const r = facts.retry;
      const backoff = [r.initial ? `backoff ${r.initial}` : "", r.factor !== null ? `× ${r.factor}` : "", r.max ? `up to ${r.max}` : ""].filter(Boolean).join(" ");
      push(pol, { id: "retry", label: "Retry", value: r.max_attempts !== null ? plural(r.max_attempts, "attempt") : "on failure", aside: backoff });
    }
    out.push({ id: "policy", title: SECTION_TITLE.policy, rows: pol });

    out.push({
      id: "after",
      title: SECTION_TITLE.after,
      rows: [a.notify_channels.length ? { id: "notify", label: "Notify", value: a.notify_channels.join(", "), chips: a.notify_channels } : { id: "notify", label: "Notify", value: "nobody" }],
    });
  }

  const root = String(input.detail?.workspace_root || a?.workspace_root || "").trim();
  if (root) out.push({ id: "where", title: SECTION_TITLE.where, rows: [{ id: "workspace", label: "Workspace", value: root, mono: true, source: a?.workspace_access_mode ? a.workspace_access_mode.split("_").join(" ") : "" }] });
  return out.filter((s) => s.rows.length > 0);
}

/* ── Done window (operator, 2026-07-14): terminal runs accumulate without
 * bound — a fleet's Done column would explode. The column shows a TIME
 * WINDOW (default 48h) with quick presets; active columns are never
 * windowed (a run waiting three days still needs you). ── */
export type DoneWindowKey = "12h" | "24h" | "48h" | "72h" | "7d" | "14d" | "1m" | "all";

export const DONE_WINDOW_MS: Record<DoneWindowKey, number | null> = {
  "12h": 12 * 3_600_000,
  "24h": 24 * 3_600_000,
  "48h": 48 * 3_600_000,
  "72h": 72 * 3_600_000,
  "7d": 7 * 86_400_000,
  "14d": 14 * 86_400_000,
  "1m": 30 * 86_400_000,
  all: null,
};

export const DONE_WINDOW_LABEL: Record<DoneWindowKey, string> = {
  "12h": "last 12h",
  "24h": "last 24h",
  "48h": "last 48h",
  "72h": "last 72h",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "1m": "last month",
  all: "all loaded",
};

export const DEFAULT_DONE_WINDOW: DoneWindowKey = "48h";

/** Split Done cards into the window's visible set + the hidden-older count.
 * Cards without a parseable timestamp stay VISIBLE (hiding what we cannot
 * date would silently lose runs — the honesty rule). */
export function filter_done_window(
  cards: BoardCard[],
  window: DoneWindowKey,
  now_ms = Date.now(),
): { visible: BoardCard[]; hidden_count: number } {
  const span = DONE_WINDOW_MS[window] ?? null;
  if (span === null) return { visible: cards, hidden_count: 0 };
  const cutoff = now_ms - span;
  const visible: BoardCard[] = [];
  let hidden = 0;
  for (const card of cards) {
    if (card.since_ms === null || card.since_ms >= cutoff) visible.push(card);
    else hidden += 1;
  }
  return { visible, hidden_count: hidden };
}

// --- entities strip -------------------------------------------------------------

export type EntityTile = {
  name: string;
  state: string;
  age_days: number | null;
  last_moment: string;
  /** ISO timestamp of the last recorded moment — drives the tile's
   * "active Xs ago" freshness (B3: the operator must see whether a life is
   * doing something without opening it). Empty = unknown. */
  last_moment_at: string;
  /** AUTHORITATIVE working truth from the cognition wire (gateway c1390:
   * store-read loop/visit state, never fabricated). null = wire absent
   * (pre-wire gateway) — the tile falls back to the moment-age heuristic. */
  working: boolean | null;
  /** Lifetime billed tokens from the home run ledger (spend.lifetime).
   * null = wire absent. */
  tokens_total: number | null;
  /** Billed tokens of the OPEN visit's run tree (spend.live_visit);
   * null when no visit is open or wire absent. */
  live_visit_tokens: number | null;
  /** Labeled spend gaps from the wire (e.g. loop-spend #FALLBACK) — ride
   * the tooltip so a partial number is never read as total. */
  spend_warning: string;
  /** COMPOSITE phase from the cognition wire (one-active-phase ruling,
   * c1455: the board renders THE active phase from the SAME source as the
   * apps). Empty = wire absent — fall back to the card-state mapping. */
  live_phase: string;
  /** Open diary questions/problems from the /card (bounded briefs; the
   * access-hint render commitment, plan improving-entity-capabilities
   * §observer 2). Empty = section absent or nothing open — no chip. */
  open_questions: EntityCardBrief[];
  open_questions_total: number;
  open_problems: EntityCardBrief[];
  open_problems_total: number;
  /** Lessons from the card's build-5 section (newest-first briefs + true
   * total). Distilled knowledge, only accumulates — a count, never a
   * ratio (the card's own provenance rule). */
  lessons: EntityCardBrief[];
  lessons_total: number;
  /** Wave-5 night signals: standing dreams carrying signal streams
   * (null = section absent — pre-signal store or pre-brief gateway). */
  dreams_brief: DreamSignalsBrief | null;
  error: string;
};

/** One open question/problem brief off the entity card. The card's row
 * briefs carry `entry_id` only when the projection quotes the book key
 * (memory's M-A mint) — absent keys render as plain text, never a dead
 * button (the chip's honesty rule). */
export type EntityCardBrief = {
  record_id: string;
  title: string;
  statement: string;
  entry_id: string | null;
};

/** Tile bound: enough to see what an entity carries open without turning
 * the strip into the entity app (the deep view stays there). */
export const TILE_HINTS_BOUND = 4;

/** The card's dreams-signals brief (wave-5 lane (a), memory c3725):
 * {count, kinds, felt_tones} folded over STANDING signal-carrying dreams.
 * COUNT COUNTS SIGNALS, not dreams (engine-verified: entity_card.py
 * increments per signal entry; live wire served 24 = 12+12 across two
 * standing dreams). Absent = no standing dream carries signals
 * (pre-signal dreams self-identify by absence — zero migration). */
export type DreamSignalsBrief = {
  count: number;
  kinds: string[];
  felt_tones: string[];
  /** Signal-carrying dream count (memory c3810's unit fix — additive;
   * null on pre-fix briefs). */
  dreams: number | null;
};

export function extract_dreams_brief(card: any): DreamSignalsBrief | null {
  const b = (card as any)?.discoveries?.dreams_signals_brief;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  // Count must be a positive integer — "2.7 dreams" is the same junk
  // class as a stringly count, and both drop rather than render.
  const count = typeof b.count === "number" && Number.isInteger(b.count) && b.count > 0 ? b.count : 0;
  if (!count) return null;
  // Entries must already be words: a version-skewed gateway serving
  // richer rows ({kind, count}) must drop, never render [object Object].
  const words = (v: any): string[] =>
    Array.isArray(v) ? v.filter((x: any) => typeof x === "string").map((x: string) => x.trim()).filter(Boolean) : [];
  const dreams = typeof b.dreams === "number" && Number.isInteger(b.dreams) && b.dreams > 0 ? b.dreams : null;
  return { count, kinds: words(b.kinds), felt_tones: words(b.felt_tones), dreams };
}

function card_brief(row: any): EntityCardBrief | null {
  if (!row || typeof row !== "object") return null;
  const title = String(row.title || "").trim();
  const statement = String(row.statement || "").trim();
  if (!title && !statement) return null;
  const entry_id = typeof row.entry_id === "string" && row.entry_id.trim() ? row.entry_id.trim() : null;
  return { record_id: String(row.record_id || "").trim(), title, statement, entry_id };
}

/** Pure read of the /card questions/problems/lessons sections into tile
 * briefs. Layer contract (chip ruling c2623/c2626): /card items carry
 * entry_id TOP-LEVEL — this composer reads exactly that layer, never a
 * grep. Lessons (build 5, c3182) have no open/resolved split — the card
 * serves { lessons: [briefs newest-first], total } because lessons only
 * accumulate; absent section = pre-build-5 gateway, renders nothing. */
export function extract_open_briefs(card: any): {
  questions: EntityCardBrief[];
  questions_total: number;
  problems: EntityCardBrief[];
  problems_total: number;
  lessons: EntityCardBrief[];
  lessons_total: number;
} {
  const section = (name: string): EntityCardBrief[] => {
    const open = (card as any)?.[name]?.open;
    if (!Array.isArray(open)) return [];
    return open.map(card_brief).filter((b): b is EntityCardBrief => b !== null);
  };
  const questions = section("questions");
  const problems = section("problems");
  const lessons_raw = (card as any)?.lessons?.lessons;
  const lessons = Array.isArray(lessons_raw)
    ? lessons_raw.map(card_brief).filter((b): b is EntityCardBrief => b !== null)
    : [];
  const lessons_total =
    typeof (card as any)?.lessons?.total === "number" ? (card as any).lessons.total : lessons.length;
  return {
    questions: questions.slice(0, TILE_HINTS_BOUND),
    questions_total: questions.length,
    problems: problems.slice(0, TILE_HINTS_BOUND),
    problems_total: problems.length,
    lessons: lessons.slice(0, TILE_HINTS_BOUND),
    lessons_total,
  };
}

/** Compact token count for tile chips: 812 -> "812", 12_340 -> "12.3k",
 * 4_200_000 -> "4.2M". Null-safe (null renders nothing — never fabricate). */
export function format_tokens(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Milliseconds since an entity's last recorded moment; null when the card
 * carried no parseable timestamp (render nothing — never fabricate). */
export function entity_activity_age(last_moment_at: string, now_ms = Date.now()): number | null {
  const raw = String(last_moment_at || "").trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, now_ms - ts);
}

/** "● active" window for entity tiles: one board-poll generation. */
export const ACTIVE_WINDOW_MS = 60_000;

export function format_age(ms: number | null, now_ms = Date.now()): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  const delta = Math.max(0, now_ms - ms);
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${(delta / 3_600_000).toFixed(1)}h`;
  return `${(delta / 86_400_000).toFixed(1)}d`;
}

/** Chip label fallback when a brief has no title: the statement, clamped
 * for the strip (the full statement rides the tooltip untruncated). */
function clamp_brief(s: string): string {
  const t = String(s || "").trim();
  return t.length > 72 ? `${t.slice(0, 70)}…` : t;
}

/** The wire-derived phase graph (one-graph mechanism, laurent dm#79 /
 * c3563 consumer contract): phase words + synonym map derived FROM the
 * gateway-served artifact, never a second hand-written copy. */
export type PhaseGraph = {
  /** Ruled phase words (graph keys, e.g. visit/work/personal/sleep). */
  phases: string[];
  /** Substring → phase word, from each phase's key + spoken_synonyms. */
  synonyms: Array<{ needle: string; phase: string }>;
  /** Mode-axis words from the v8 machine-readable state_mode_axis block
   * (word → target phase, role-validated) — absent on v6/v7 artifacts,
   * where the local residue tables apply. */
  modes: Array<{ needle: string; phase: string }>;
  /** The no-signal settling default (spec.initial_phase — sleep). */
  initial: string;
  /** Artifact identity for drift honesty (version + byte sha). */
  version: number | null;
  sha256: string;
};

/** Pure derivation of the render vocabulary from the served spec payload
 * ({spec, sha256, ...}). Returns null when the payload carries no usable
 * graph — the caller keeps the labeled pre-wire fallback, never a blank
 * board. */
/** Separator normalization for needle matching: the wire carries
 * own_time / own-time / "own time" for one spoken synonym — fold [_-] to
 * spaces on BOTH sides so the graph path never diverges from the fallback
 * on a separator (adversary F1: own_time rendered raw under the graph). */
function _norm(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ");
}

export function derive_phase_graph(payload: any): PhaseGraph | null {
  const spec = payload?.spec && typeof payload.spec === "object" ? payload.spec : null;
  const phases_obj = spec?.phases && typeof spec.phases === "object" && !Array.isArray(spec.phases) ? spec.phases : null;
  if (!phases_obj) return null;
  const phases = Object.keys(phases_obj).filter((k) => k && typeof k === "string");
  if (!phases.length) return null;
  const synonyms: Array<{ needle: string; phase: string }> = [];
  for (const p of phases) {
    synonyms.push({ needle: _norm(p), phase: p });
    const spoken = (phases_obj as any)[p]?.spoken_synonyms;
    if (Array.isArray(spoken)) {
      for (const s of spoken) {
        const n = _norm(String(s || "").trim());
        if (n) synonyms.push({ needle: n, phase: p });
      }
    }
  }
  // AWAKE-NEVER-RENDERS names the no-signal default as SLEEP specifically —
  // a last-key fallback could fabricate an ACTIVITY claim on a reordered
  // artifact (adversary F2). Absent/invalid initial_phase: prefer sleep;
  // a graph without sleep is unusable for settling — labeled fallback.
  const declared = typeof spec.initial_phase === "string" && phases.includes(spec.initial_phase) ? spec.initial_phase : null;
  const initial = declared ?? (phases.includes("sleep") ? "sleep" : null);
  if (!initial) return null;
  // v8 machine-readable mode axis (my own consumer ask, banked at the
  // bump): each word maps to its declared phase, target-validated against
  // the graph — the local residue tables die where this block exists.
  const modes: Array<{ needle: string; phase: string }> = [];
  const mode_words = (spec as any)?.state_mode_axis?.words;
  if (mode_words && typeof mode_words === "object" && !Array.isArray(mode_words)) {
    for (const [word, decl] of Object.entries(mode_words)) {
      const target = String((decl as any)?.phase || "").trim();
      const n = _norm(String(word || "").trim());
      if (n && phases.includes(target)) modes.push({ needle: n, phase: target });
    }
  }
  return {
    phases,
    synonyms,
    modes,
    initial,
    version: typeof spec.version === "number" ? spec.version : null,
    sha256: String(payload?.sha256 || "").trim(),
  };
}

/** STATE/MODE-AXIS fold: machine vocabulary that is never a phase (the
 * graph's axes_note: awake|asleep|paused are wire truth, never display
 * truth). Targets land on graph words only. v7 mode roles (axes_note,
 * documented on entity's c3610 bump): visiting DECIDES visit (rides the
 * synonym match), dreaming DECORATES asleep, RESTING = loop-alive
 * between days INSIDE PERSONAL — my v6-era rest→sleep fold was wrong
 * and is corrected here (owned at c3613). These lists are the residual
 * hand copy until the artifact gains a machine-readable state_mode
 * block (proposed on the bump thread); pinned in tests meanwhile. */
const STATE_AXIS_SLEEP_WORDS = ["asleep", "sleep", "dream"];
const STATE_AXIS_PERSONAL_WORDS = ["rest"];
const STATE_AXIS_SETTLING_WORDS = ["awake", "idle"];

// Entity life_state → the ruled phase words. Graph-derived when the wire
// spec is present (one-graph mechanism); the hardcoded map below is the
// LABELED PRE-WIRE FALLBACK only (byte-compatible with the pre-mechanism
// behavior; deleted the day pre-wire gateways stop existing).
// AWAKE IS NOT A DWELLING (laurent c203/c3548): the state-axis word maps
// to the settling default (sleep), never a phase chip of its own.
export function entity_phase(state: string, graph?: PhaseGraph | null): string {
  const s = String(state || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (graph) {
    const n = _norm(s);
    // Phase words + spoken synonyms from THE artifact (longest needle
    // first so "own time" beats a hypothetical shorter overlap; sort
    // stability makes equal-length ties deterministic by artifact order).
    const hits = graph.synonyms
      .filter((m) => n.includes(m.needle))
      .sort((a, b) => b.needle.length - a.needle.length);
    if (hits.length) return hits[0]!.phase;
    // v8 machine-readable mode words (artifact-declared, target-validated)
    // take precedence over the local residue tables — the artifact's word
    // wins wherever it is declared.
    const mode_hits = graph.modes
      .filter((m) => n.includes(m.needle))
      .sort((a, b) => b.needle.length - a.needle.length);
    if (mode_hits.length) return mode_hits[0]!.phase;
    // Legacy composite spelling: awake:working / tasked — the task word
    // is work's entry vocabulary (graph: work entered_by a task given).
    // no_task is a transition CAUSE meaning the opposite (adversary F8's
    // inversion catch) — it settles, never claims work.
    if (s.includes("task") && !s.includes("no_task") && graph.phases.includes("work")) return "work";
    // State/mode-axis RESIDUE tables (pre-v8 artifacts without the
    // machine-readable block; also the bare-word forms the block does not
    // carry, e.g. "asleep"/"rest" vs the block's "dreaming"/"resting").
    if (STATE_AXIS_SLEEP_WORDS.some((w) => s.includes(w))) return graph.initial;
    if (STATE_AXIS_PERSONAL_WORDS.some((w) => s.includes(w)) && graph.phases.includes("personal")) return "personal";
    if (STATE_AXIS_SETTLING_WORDS.some((w) => s.includes(w))) return graph.initial;
    // Liveness axis (above the machine, distinct render contract).
    if (s.includes("stop")) return "stopped";
    if (s.includes("pause")) return "paused";
    return s;
  }
  // ---- labeled pre-wire fallback (no served graph): byte-compatible
  // with the pre-mechanism behavior (one bug excepted: the no_task
  // inversion is fixed on BOTH paths — a cause word never claims work),
  // deleted when pre-wire gateways die.
  if (s.includes("visit")) return "visit";
  if (s.includes("sleep") || s.includes("dream")) return "sleep";
  if (s.includes("personal") || s.includes("own_time") || s.includes("own time")) return "personal";
  if ((s.includes("task") && !s.includes("no_task")) || s.includes("work")) return "work";
  if (s.includes("awake") || s.includes("idle")) return "sleep";
  if (s.includes("stop")) return "stopped";
  if (s.includes("pause")) return "paused";
  if (s.includes("rest")) return "resting";
  return s;
}

/** Phase keys with a dedicated mc_phase_* style. Graph-derived when the
 * wire spec is present (known_phase_keys below); this static set is the
 * pre-wire fallback. "awake" left the set with the c203 fold (it maps to
 * sleep — the chip can never carry it). Under the WIRE graph, "resting"
 * folds to sleep (rest is a sleep-mode word); the fallback keeps it for
 * byte-compatibility. Liveness words (stopped/paused) stay — the kill
 * switch renders distinctly per the graph's own render contract. */
export const KNOWN_PHASE_KEYS = new Set(["visit", "work", "personal", "sleep", "paused", "resting", "stopped", "unknown"]);

/** Keys that actually have an mc_phase_* rule in styles.css. A graph word
 * WITHOUT a style must wear the bounded "other" class, not an unstyled
 * class name (adversary F5: a bumped artifact adding "meditate" would
 * otherwise mint mc_phase_meditate matching no rule — neither ruled color
 * nor the dashed "other" boundary). Adding the style + this entry is the
 * deliberate two-line act a new phase word costs this app. */
const STYLED_PHASE_KEYS = new Set(["visit", "work", "personal", "sleep", "paused", "resting", "stopped", "unknown"]);

export function known_phase_keys(graph?: PhaseGraph | null): Set<string> {
  if (!graph) return KNOWN_PHASE_KEYS;
  const styled_graph_words = graph.phases.filter((p) => STYLED_PHASE_KEYS.has(p));
  return new Set([...styled_graph_words, "paused", "stopped", "unknown"]);
}

export type MissionControlProps = {
  gateway_connected: boolean;
  /** Listing roots (the navigator's rows) — the board reads their terminal rows for Done. */
  runs: RunSummary[];
  /** Every row seen: the active listings (running + waiting, every depth) and the 60 s sweep. */
  all_runs: RunSummary[];
  runs_refreshed_at: number | null;
  entities: EntityTile[];
  entities_total: number;
  entities_error: string;
  refreshing: boolean;
  on_refresh: () => void;
  on_open_run: (run_id: string) => void;
  on_resume_wait: (run_id: string, wait_key: string, payload: any) => Promise<void>;
  /** Open an automation on the Automations page (the (i) popover's action). */
  on_open_automation: (automation_id: string) => void;
  entity_app_href: string;
  /** Operator diary door transport (kit renders, app owns transport). The
   * read is MARKER-FIRST gateway-side — every click lands a diary_read
   * event in the entity's stream, which is why the chip's click-only rule
   * is load-bearing here. Absent = chips render as plain text. */
  on_read_diary?: (name: string, entry_id: string) => Promise<any>;
  /** The wire-derived phase graph (one-graph mechanism). null/absent =
   * pre-wire gateway — the labeled fallback vocabulary applies. */
  phase_graph?: PhaseGraph | null;
  /** The gateway client the lazy caches read through (automation briefs,
   * excerpts, pulses, wait details). Absent = the board renders rows only. */
  client?: BoardDataClient | null;
  /** "Name it" in the (i): `PATCH /automations/{id}` with `{changes: {title}}`.
   * Absent = the form renders disabled and says why. */
  on_rename_automation?: (automation_id: string, title: string, expected_revision?: number | null) => Promise<unknown>;
  /** Resume a PAUSED run (run control `resume`); resolves to an error
   * sentence or null. Absent = Resume opens the run instead. */
  on_resume_run?: (run_id: string) => Promise<string | null | void>;
  /** False until the first terminal-row sweep has landed (Done says loading). */
  done_loaded?: boolean;
  /** Cancel a run (run control `cancel`): a Needs-you card's inline two-step confirm and
   * the (i)'s action row. May resolve to an error sentence. Absent = no Cancel anywhere. */
  on_cancel_run?: (run_id: string) => Promise<string | null | void>;
  /** The AbstractCode web app from the gateway's app registry (`GET /api/gateway/apps`,
   * entry "code", installed + running, its `url`). null/absent = "Open in Code" renders
   * disabled with the install hint. */
  code_app?: { url: string } | null;
  /** An automation card's footer: `POST /automations/{id}/commands` (run now · pause · resume).
   * Absent = the buttons render disabled and say so. */
  on_automation_command?: CommandHandler;
  /** The context bar's chooser: `PATCH /automations/{id}` with `expected_revision` — the same
   * revision-based edit the Automations page's Edit box sends. Absent = the bar is read-only. */
  on_revise_automation?: ReviseHandler;
};

/** Skeleton cards per lane before the first runs poll lands (operator 2026-10-15: the
 * lanes said "nothing is blocked" while still loading). */
export const SKELETON_CARDS: Record<BoardLane, number> = { needs_you: 3, working: 3, waiting_on: 2, scheduled: 2, done: 3 };

function SkeletonLine(props: { width?: string; className?: string }): React.ReactElement {
  return <span className={`mc_sk${props.className ? ` ${props.className}` : ""}`} style={props.width ? { width: props.width } : undefined} aria-hidden="true" />;
}

/** A card-sized shimmering block: title + pill, two lines. */
export function SkeletonCards(props: { n: number }): React.ReactElement {
  return (
    <>
      {Array.from({ length: props.n }, (_, i) => (
        <div key={i} className="mc_card mc_card_skeleton" aria-hidden="true">
          <div className="mc_card_head">
            <SkeletonLine className="mc_sk_title" width={i % 2 ? "72%" : "58%"} />
            <SkeletonLine className="mc_sk_pill" />
          </div>
          <SkeletonLine width="88%" />
          <SkeletonLine width="46%" />
        </div>
      ))}
    </>
  );
}

/** The inline line a card shows where its own detail (brief, wait, outcome) is still loading. */
function InlineSkeleton(props: { what: string; width?: string }): React.ReactElement {
  return (
    <div className="mc_sk_row" role="status" aria-busy="true" aria-label={`loading ${props.what}`} title={`loading ${props.what}…`}>
      <SkeletonLine width={props.width || "84%"} />
    </div>
  );
}

/** One Board lane, always open (operator 2026-10-14: the fold chevron was always shown
 * and never useful). The count is a readable pill; a zero count is muted. */
function BoardColumn(props: { col: BoardLane; title: string; count: number | null; count_title?: string; tools?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  const title_id = `mc_column_title_${props.col}`;
  // A count is a claim: before the first poll the pill says "…", never 0.
  const count_class = props.count === null ? " is_loading" : props.count ? "" : " is_zero";
  return (
    <section className={`mc_column mc_column_${props.col}`} aria-labelledby={title_id}>
      <header className="mc_column_head">
        <h2 className="mc_column_title" id={title_id}>
          {props.title}
        </h2>
        {props.tools}
        <span className={`mc_column_count${count_class}`} title={props.count === null ? "loading" : props.count_title} aria-busy={props.count === null || undefined}>
          {props.count === null ? "…" : props.count}
        </span>
      </header>
      {props.children}
    </section>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Layout effects only where there is a layout (the static/SSR render the
 * tests and the phone-layout check use has none). */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Who ends the wait — shown only where it is information: `run <child>` (a link to
 * the child), `external`, `unknown`. "you" (the lane says it), the clock (the sentence
 * says when) and the runtime (the sentence says running) are not. */
function ActorBadge(props: { card: BoardCard; on_open_run: (run_id: string) => void }): React.ReactElement | null {
  const { line } = props.card;
  if (line.actor === "run") {
    const label = clamp_text(props.card.actor_run_label || "subrun", 28);
    return line.actor_run_id ? (
      <button
        type="button"
        className="mc_actor mc_actor_run"
        title={`Open the subrun ${props.card.actor_run_label || ""}`.trim()}
        onClick={(e) => {
          e.stopPropagation();
          props.on_open_run(line.actor_run_id);
        }}
        onKeyDown={stop}
      >
        run {label}
      </button>
    ) : (
      <span className="mc_actor mc_actor_run" title="Another run ends this wait; it is not listed yet">
        run
      </span>
    );
  }
  if (line.actor === "external") {
    return (
      <span className="mc_actor mc_actor_external" title={`An external system ends this wait: ${line.object || "an event"}`}>
        external
      </span>
    );
  }
  if (line.actor === "unknown") {
    return (
      <span className="mc_actor mc_actor_unknown" title="Nothing on the wire says what ends this wait">
        unknown
      </span>
    );
  }
  return null;
}

function CopyIcon(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.6" />
      <path d="M10.5 3.6V3.1a1.6 1.6 0 0 0-1.6-1.6H3.1a1.6 1.6 0 0 0-1.6 1.6v5.8a1.6 1.6 0 0 0 1.6 1.6h.5" />
    </svg>
  );
}

/** ⧉ copy, shown on hover / focus-within of its card or row (board.css), with the
 * 1.5 s "copied" / "copy failed" state. */
export function CopyButton(props: { text: string; label: string; title?: string }): React.ReactElement {
  const [state, set_state] = useState<"" | "copied" | "failed">("");
  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => set_state(""), 1500);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={`mc_copy${state ? ` is_${state}` : ""}`}
      title={props.title ?? `Copy ${props.label}`}
      aria-label={`Copy ${props.label}`}
      onClick={async (e) => {
        e.stopPropagation();
        set_state((await clipboardWrite(props.text)) ? "copied" : "failed");
      }}
      onKeyDown={stop}
    >
      {state === "copied" ? "copied" : state === "failed" ? "copy failed" : <CopyIcon />}
    </button>
  );
}

/** Prose that may be long: folded by SIZE (never cut: no "…"), "show all (N chars)". */
export const LONG_TEXT_CHARS = 320;
export const LONG_TEXT_LINES = 6;

function LongText(props: { text: string }): React.ReactElement {
  const [open, set_open] = useState(false);
  const text = props.text;
  const foldable = text.length > LONG_TEXT_CHARS || text.split("\n").length > LONG_TEXT_LINES;
  return (
    <div className={`mc_long${foldable && !open ? " is_folded" : ""}`}>
      <div className="mc_long_text">{text}</div>
      {foldable ? (
        <button type="button" className="mc_long_toggle" aria-expanded={open} onClick={() => set_open(!open)}>
          {open ? "show less" : `show all (${text.length.toLocaleString("en-US")} chars)`}
        </button>
      ) : null}
    </div>
  );
}

function InfoRowView(props: { row: InfoRow }): React.ReactElement {
  const r = props.row;
  const chips_only = Boolean(r.chips?.length) && !r.long;
  return (
    <div className="mc_info_row" data-row={r.id}>
      <dt className="mc_info_label">
        {r.label}
        {r.source ? <span className="mc_source">{r.source}</span> : null}
      </dt>
      <dd className="mc_info_value">
        {r.chips?.length ? (
          <span className="mc_tags">
            {r.chips.map((c, i) => (
              <code key={`${c}:${i}`} className="mc_tag">
                {c}
              </code>
            ))}
          </span>
        ) : null}
        {chips_only || !r.value ? null : r.long ? <LongText text={r.value} /> : <span className={`mc_info_text${r.mono ? " mono" : ""}`}>{r.value}</span>}
        {r.aside ? <span className={`mc_info_aside${r.aside_mono ? " mono" : ""}`}>{r.aside}</span> : null}
      </dd>
      <dd className="mc_info_copy">{r.value || r.copy ? <CopyButton text={r.copy ?? r.value} label={(r.label || "value").toLowerCase()} /> : null}</dd>
    </div>
  );
}

export type RenameHandler = (automation_id: string, title: string, expected_revision?: number | null) => Promise<unknown>;
export type CancelHandler = (run_id: string) => Promise<string | null | void>;
export type CodeApp = { url: string };

/** "Name it": the automation's title, revised in place (`revise` capability) — one compact row. */
function NameItRow(props: { automation_id: string; current: string; revision: number | null; on_rename?: RenameHandler; on_renamed?: (automation_id: string) => void }): React.ReactElement {
  const [value, set_value] = useState(props.current);
  const [busy, set_busy] = useState(false);
  const [msg, set_msg] = useState("");
  const wired = Boolean(props.on_rename);
  const next = value.trim();
  return (
    <div className="mc_info_row mc_name_it_row" data-row="name_it">
      <dt className="mc_info_label">Name it</dt>
      <dd className="mc_info_value">
        <form
          className="mc_name_it"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!props.on_rename || !next) return;
            set_busy(true);
            set_msg("");
            try {
              await props.on_rename(props.automation_id, next, props.revision);
              set_msg("renamed");
              props.on_renamed?.(props.automation_id);
            } catch (err: any) {
              set_msg(String(err?.message || err?.code || err || "rename failed"));
            } finally {
              set_busy(false);
            }
          }}
        >
          <input
            className="mc_name_it_input"
            aria-label="The automation's title"
            value={value}
            maxLength={200}
            disabled={!wired || busy}
            title={wired ? "The automation's title (the Automations page shows the same)" : "Renaming is not available here"}
            onChange={(e) => set_value(e.target.value)}
          />
          <button
            type="submit"
            className="btn mc_btn_sm"
            disabled={!wired || busy || !next || next === props.current}
            title={wired ? "Save the automation's title" : "Renaming is not available here: this host does not wire automation revisions"}
          >
            {busy ? "Saving" : "Save"}
          </button>
        </form>
        {msg ? <span className="mc_name_it_msg">{msg}</span> : null}
      </dd>
      <dd className="mc_info_copy" />
    </div>
  );
}

/** "Open in Code": the conversation in the AbstractCode web app (its own hash route), or
 * — when the gateway's registry has no running Code app — disabled with the install hint. */
function OpenInCode(props: { card: BoardCard; code_app?: CodeApp | null; variant?: "text" | "icon" }): React.ReactElement | null {
  const session = code_session_of(props.card);
  if (!session) return null;
  const url = String(props.code_app?.url || "").trim();
  const icon = props.variant === "icon";
  if (!url) {
    return (
      <span className="mc_btn_wrap" title={CODE_INSTALL_HINT}>
        <button type="button" className={icon ? "btn mc_icon_btn" : "btn mc_btn_sm mc_btn_quiet"} disabled title={CODE_INSTALL_HINT} aria-label="Open in Code">
          {icon ? <Icon name="terminal" size={14} /> : "Open in Code"}
        </button>
      </span>
    );
  }
  return (
    <a
      className={icon ? "btn mc_icon_btn mc_open_code" : "btn mc_btn_sm mc_btn_quiet mc_open_code"}
      href={code_href(url, session, props.card.run_id)}
      target="_blank"
      rel="noreferrer"
      title="Open this conversation in the AbstractCode web app (new tab)"
      aria-label="Open in Code"
      onClick={stop}
      onKeyDown={stop}
    >
      {icon ? <Icon name="terminal" size={14} /> : "Open in Code"}
    </a>
  );
}

/** Cancel's two steps, as a state machine: `ask` turns the button into the
 * question in place, `keep` backs out, `send` is in flight until the host
 * answers — `sent`, or back to the button with the error under it. No browser
 * dialog anywhere. */
export type CancelState = { phase: "idle" | "confirm" | "busy" | "sent"; error: string };
export type CancelEvent = { type: "ask" } | { type: "keep" } | { type: "send" } | { type: "done" } | { type: "failed"; error: string };

export function cancel_reducer(state: CancelState, ev: CancelEvent): CancelState {
  switch (ev.type) {
    case "ask":
      return state.phase === "idle" ? { phase: "confirm", error: "" } : state;
    case "keep":
      return state.phase === "confirm" ? { phase: "idle", error: "" } : state;
    case "send":
      return state.phase === "confirm" ? { phase: "busy", error: "" } : state;
    case "done":
      return state.phase === "busy" ? { phase: "sent", error: "" } : state;
    case "failed":
      return state.phase === "busy" ? { phase: "idle", error: ev.error || "cancel failed" } : state;
  }
}

/** Run the host's cancel: an error sentence or a throw is a failure, anything else is sent. */
export async function send_cancel(on_cancel_run: CancelHandler, run_id: string): Promise<CancelEvent> {
  try {
    const err = await on_cancel_run(run_id);
    return typeof err === "string" && err ? { type: "failed", error: err } : { type: "done" };
  } catch (e: any) {
    return { type: "failed", error: String(e?.message || e || "cancel failed") };
  }
}

/** The view of one state (hook-free, so it renders and wires the same everywhere). */
export function CancelControlView(props: { state: CancelState; on_event: (ev: CancelEvent) => void; on_send: () => void; variant?: "text" | "icon" }): React.ReactElement {
  const { phase, error } = props.state;
  return (
    <>
      {phase === "confirm" || phase === "busy" ? (
        <span className="mc_confirm" role="group" aria-label="Cancel this run?">
          <span className="mc_confirm_q">Cancel this run?</span>
          <button type="button" className="btn danger mc_btn_sm" disabled={phase === "busy"} onClick={props.on_send}>
            {phase === "busy" ? "Cancelling" : "Cancel run"}
          </button>
          <button type="button" className="btn mc_btn_sm" disabled={phase === "busy"} onClick={() => props.on_event({ type: "keep" })}>
            Keep
          </button>
        </span>
      ) : phase === "sent" ? (
        <span className="mc_cancel_sent">cancel requested</span>
      ) : (
        <button
          type="button"
          className={props.variant === "icon" ? "btn mc_icon_btn mc_cancel" : "btn mc_btn_sm mc_btn_quiet mc_cancel"}
          title="Cancel this run"
          aria-label="Cancel this run"
          onClick={() => props.on_event({ type: "ask" })}
        >
          {props.variant === "icon" ? <Icon name="x" size={14} /> : "Cancel"}
        </button>
      )}
      {error ? (
        <div className="mc_act_error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

/** Cancel with an inline two-step confirm: "Cancel this run? [Cancel run] [Keep]" in place;
 * busy while the command is in flight; an error stays under it. */
function CancelControl(props: { run_id: string; on_cancel_run: CancelHandler; variant?: "text" | "icon" }): React.ReactElement {
  const [state, dispatch] = useReducer(cancel_reducer, { phase: "idle", error: "" });
  const send = async () => {
    dispatch({ type: "send" });
    dispatch(await send_cancel(props.on_cancel_run, props.run_id));
  };
  return <CancelControlView state={state} on_event={dispatch} on_send={() => void send()} variant={props.variant} />;
}

export type CardInfoProps = {
  card: BoardCard;
  now_ms: number;
  stall_after_ms: number;
  revision?: number | null;
  detail?: any;
  outcome?: RunOutcome | null;
  facts?: AutomationFacts | null;
  code_app?: CodeApp | null;
  on_open_run?: (run_id: string) => void;
  on_open_automation?: (automation_id: string) => void;
  on_rename_automation?: RenameHandler;
  on_renamed?: (automation_id: string) => void;
  on_cancel_run?: CancelHandler;
};

/** The (i) popover's body: sections of facts the card has no room for, then the actions. */
export function CardInfo(props: CardInfoProps): React.ReactElement {
  const { card } = props;
  const a = card.automation;
  const sections = card_info_sections(card, {
    now_ms: props.now_ms,
    stall_after_ms: props.stall_after_ms,
    detail: props.detail,
    outcome: props.outcome,
    facts: props.facts,
    revision: props.revision,
  });
  const is_controller = card.role === "controller";
  const open_automation = card.automation_id && props.on_open_automation ? props.on_open_automation : null;
  const has_actions = Boolean(open_automation || (!is_controller && props.on_open_run) || code_session_of(card) || (can_cancel(card) && props.on_cancel_run));
  return (
    <div className="mc_info_body">
      {sections.map((s) => (
        <section key={s.id} className="mc_info_section" data-section={s.id}>
          <h3 className="mc_info_section_title">{s.title}</h3>
          <dl className="mc_info_rows">
            {s.rows.map((r) => (
              <React.Fragment key={r.id}>
                <InfoRowView row={r} />
                {s.id === "automation" && r.id === "title" && a?.can_revise ? (
                  <NameItRow
                    key={`${card.automation_id}:${a.title}`}
                    automation_id={card.automation_id}
                    current={a.title}
                    revision={props.revision ?? null}
                    on_rename={props.on_rename_automation}
                    on_renamed={props.on_renamed}
                  />
                ) : null}
              </React.Fragment>
            ))}
          </dl>
        </section>
      ))}
      {card.automation_id && !a ? <p className="mc_info_note">automation details are loading</p> : null}
      {has_actions ? (
        <div className="mc_info_actions">
          {open_automation ? (
            <button type="button" className="btn mc_btn_sm" onClick={() => open_automation(card.automation_id)}>
              Open automation
            </button>
          ) : null}
          {!is_controller && props.on_open_run ? (
            <button type="button" className="btn mc_btn_sm" onClick={() => props.on_open_run!(card.run_id)}>
              Open run
            </button>
          ) : null}
          <OpenInCode card={card} code_app={props.code_app} />
          {can_cancel(card) && props.on_cancel_run ? <CancelControl run_id={card.run_id} on_cancel_run={props.on_cancel_run} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The popover's width: 500 px, the viewport minus its gutters on phones. */
export const INFO_POP_WIDTH = 500;

/** (i): hover or focus shows the brief; a click pins it (so "Name it" can be
 * typed into). Rendered in a portal: the lanes clip, and nothing may cut the popover. */
function InfoButton(props: CardInfoProps): React.ReactElement {
  const [open, set_open] = useState<"" | "hover" | "pinned">("");
  const [pos, set_pos] = useState<{ top: number; left: number; width: number; side: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const clear_timer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const place = () => {
    const b = btn.current;
    const r = b?.getBoundingClientRect();
    if (!b || !r) return;
    const vw = window.innerWidth;
    const width = Math.min(INFO_POP_WIDTH, vw - 16);
    // Beside the card when the viewport has room (the card stays readable),
    // else under (or over) the (i).
    const card = b.closest(".mc_card")?.getBoundingClientRect();
    if (card && card.right + 8 + width <= vw - 8) return set_pos({ top: Math.max(8, card.top), left: card.right + 8, width, side: true });
    if (card && card.left - 8 - width >= 8) return set_pos({ top: Math.max(8, card.top), left: card.left - 8 - width, width, side: true });
    const left = Math.min(Math.max(8, r.right - width), vw - width - 8);
    set_pos({ top: r.bottom + 6, left, width, side: false });
  };
  const show = (mode: "hover" | "pinned") => {
    clear_timer();
    place();
    set_open(mode);
  };
  const hide_soon = () => {
    clear_timer();
    timer.current = window.setTimeout(() => set_open((m) => (m === "hover" ? "" : m)), 200);
  };
  useEffect(() => () => clear_timer(), []);
  useBrowserLayoutEffect(() => {
    // Keep the brief on screen: below the (i) when it fits, else above it,
    // else pinned to the viewport bottom (its max-height is 70 % of the viewport).
    const el = pop.current;
    const r = btn.current?.getBoundingClientRect();
    if (!open || !el || !r || !pos) return;
    const h = el.offsetHeight;
    const vh = window.innerHeight;
    if (pos.top + h <= vh - 8) return;
    const above = r.top - 6 - h;
    const top = pos.side ? Math.max(8, vh - 8 - h) : above >= 8 ? above : Math.max(8, vh - 8 - h);
    if (top !== pos.top) set_pos({ ...pos, top });
  }, [open, pos?.left, pos?.width, pos?.top, pos?.side]);
  useEffect(() => {
    if (!open) return;
    const on_key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      set_open("");
      btn.current?.focus();
    };
    const on_down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (btn.current?.contains(t) || pop.current?.contains(t))) return;
      set_open("");
    };
    const on_move = () => place();
    // Capture phase: the popover stops its own key events from bubbling (they
    // must never reach the card), and Escape must still close it.
    document.addEventListener("keydown", on_key, true);
    document.addEventListener("pointerdown", on_down, true);
    window.addEventListener("resize", on_move);
    window.addEventListener("scroll", on_move, true);
    return () => {
      document.removeEventListener("keydown", on_key, true);
      document.removeEventListener("pointerdown", on_down, true);
      window.removeEventListener("resize", on_move);
      window.removeEventListener("scroll", on_move, true);
    };
  }, [open]);
  const about = props.card.role === "controller" ? "About this automation" : "About this run";
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="mc_info_btn"
        aria-label={about}
        title={about}
        aria-haspopup="dialog"
        aria-expanded={open !== ""}
        onClick={(e) => {
          e.stopPropagation();
          if (open === "pinned") set_open("");
          else show("pinned");
        }}
        onKeyDown={stop}
        onMouseEnter={() => {
          if (open) return clear_timer();
          clear_timer();
          timer.current = window.setTimeout(() => show("hover"), 150);
        }}
        onMouseLeave={() => (open === "hover" ? hide_soon() : clear_timer())}
      >
        i
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={pop}
              className="mc_info_pop"
              role="dialog"
              aria-label={`About ${props.card.title.text}`}
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              onMouseEnter={clear_timer}
              onMouseLeave={() => (open === "hover" ? hide_soon() : undefined)}
              // A portal still bubbles through the React tree: never let a click here open the run.
              onClick={stop}
              onKeyDown={stop}
            >
              <CardInfo {...props} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export type CardHandlers = {
  now_ms: number;
  stall_after_ms: number;
  busy: boolean;
  on_open_run: (run_id: string) => void;
  on_act: (card: BoardCard, payload: any) => void;
  on_resume?: (card: BoardCard) => void;
  on_open_automation?: (automation_id: string) => void;
  on_rename_automation?: RenameHandler;
  on_renamed?: (automation_id: string) => void;
  revision?: number | null;
  /** The run's `GET /runs/{id}` when the board read it (wait details). */
  detail?: any;
  /** A Done card's answer + artifact count (board_data.useRunOutcomes). */
  outcome?: RunOutcome | null;
  /** The automation record's extra facts (trigger source, stop, retry). */
  facts?: AutomationFacts | null;
  code_app?: CodeApp | null;
  on_cancel_run?: CancelHandler;
  on_automation_command?: CommandHandler;
  on_revise_automation?: ReviseHandler;
  /** Which of the card's own details are still loading (board_data `loading` sets): the
   * card shows an inline skeleton there, never a blank. */
  detail_loading?: boolean;
  brief_loading?: boolean;
  outcome_loading?: boolean;
  automation_loading?: boolean;
};

/** The card's subject line: the automation (when it is not already the title) and its
 * secondary facts. A plain run's "session" says nothing (operator 2026-10-14): only its
 * workflow, and nothing when the title already is the workflow. A controller's cadence
 * lives in its trigger chip. */
export function card_subject_words(card: BoardCard): { label: string; secondary: string } {
  const title = card.title.text;
  if (card.subject.kind === "agent" || card.subject.kind === "run") {
    const wf = workflow_short(card.workflow_id);
    return { label: "", secondary: wf && wf !== title ? wf : "" };
  }
  const label = card.subject.label && card.subject.label !== title ? card.subject.label : "";
  // A controller's context mode is its context row (the bar), not a subject fact.
  if (card.role === "controller") return { label, secondary: "" };
  return { label, secondary: card.subject.secondary !== title ? card.subject.secondary : "" };
}

/** The Needs-you act zone: the ONE move that follows (Open in Code and Cancel sit on the
 * footer of every ongoing card, operator 2026-10-15: one line, icons, any phase). */
function NeedsYouActions(props: { card: BoardCard } & CardHandlers): React.ReactElement {
  const { card, busy } = props;
  const action = card.line.action;
  const open = () => props.on_open_run(card.run_id);
  return (
    <div className="mc_card_review_body" onClick={stop} onKeyDown={stop}>
      {action === "approve" && !card.wait_key ? (
        <div className="mc_card_line" title="The wait has not registered a wait_key yet — open the run to inspect.">
          wait key not published yet — open the run
        </div>
      ) : null}
      <div className="mc_card_actions">
        {action === "approve" && card.wait_key ? (
          <>
            <button type="button" className="btn success mc_btn_sm" disabled={busy} onClick={() => props.on_act(card, { approved: true })}>
              {busy ? "Resuming…" : "Approve"}
            </button>
            <button type="button" className="btn danger mc_btn_sm" disabled={busy} onClick={() => props.on_act(card, { approved: false })}>
              Reject
            </button>
          </>
        ) : action === "resume" && props.on_resume ? (
          <button type="button" className="btn primary mc_btn_sm" disabled={busy} onClick={() => props.on_resume!(card)}>
            {busy ? "Resuming…" : "Resume"}
          </button>
        ) : action === "answer" ? (
          /* USER-RESPONSE waits never take a blind inline answer (operator,
           * 2026-07-14: "to answer, I would require to understand the
           * context"). The button opens the run's full context view. */
          <button type="button" className="btn primary mc_btn_sm" onClick={open}>
            Review &amp; answer →
          </button>
        ) : (
          /* No wait key, an unresolved row-only wait, or a pause this host
           * cannot resume: the ONE working move is opening the run. */
          <button type="button" className="btn mc_btn_sm" onClick={open}>
            Open the run →
          </button>
        )}
      </div>
    </div>
  );
}

/** A disabled control keeps its reason (disabled buttons swallow hover): the wrapper carries it. */
function GatedButton(props: { state: ControlState; label: string; busy?: boolean; className?: string; onClick: () => void }): React.ReactElement {
  const title = props.state.enabled ? props.state.reason || props.label : props.state.reason || "not available";
  const btn = (
    <button type="button" className={props.className || "btn mc_btn_sm mc_btn_quiet"} disabled={!props.state.enabled || props.busy} title={title} aria-label={props.label} onClick={props.onClick}>
      {props.busy ? `${props.label}…` : props.label}
    </button>
  );
  return props.state.enabled ? btn : <span className="mc_btn_wrap" title={title}>{btn}</span>;
}

/** The automation card's body (Scheduled lane, operator 2026-10-15): two facts, the context
 * row (a bar with a one-click budget chooser, or the independent chip), and a footer of
 * actions revealed on hover (always on touch). The brief's absence shows skeleton lines while
 * it loads and the wake wait's sentence otherwise. */
function AutomationCardBody(props: { card: BoardCard } & CardHandlers): React.ReactElement {
  const { card } = props;
  const a = card.automation;
  const [budget, dispatch] = useReducer(budget_reducer, INITIAL_BUDGET);
  const [cmd, set_cmd] = useState<{ busy: AutomationCardCommand | ""; error: string }>({ busy: "", error: "" });
  const facts = a ? automation_facts_words(a, props.now_ms) : null;
  const budget_now = a ? shown_budget(a, budget) : null;
  const ctx = a ? context_budget_view({ ...a, growing_max_tokens: budget_now }) : null;
  const can_revise = Boolean(a?.can_revise && props.on_revise_automation);
  const controls = automation_card_controls(a, cmd.busy !== "");
  const custom = parse_budget(budget.custom);
  const choose = (value: number) => {
    if (!a || !props.on_revise_automation || budget.phase !== "choose") return;
    const on_revise = props.on_revise_automation;
    dispatch({ type: "save", value, base: a.growing_max_tokens });
    void save_budget(on_revise, a.automation_id, props.revision ?? null, value).then((ev) => {
      dispatch(ev);
      if (ev.type === "saved") props.on_renamed?.(a.automation_id);
    });
  };
  const command = (type: AutomationCardCommand) => {
    if (!props.on_automation_command || cmd.busy) return;
    set_cmd({ busy: type, error: "" });
    void send_automation_command(props.on_automation_command, card.automation_id, type).then((error) => {
      set_cmd({ busy: "", error: error || "" });
      if (!error) props.on_renamed?.(card.automation_id);
    });
  };
  const info = (
    <InfoButton
      card={card}
      now_ms={props.now_ms}
      stall_after_ms={props.stall_after_ms}
      revision={props.revision}
      detail={props.detail}
      outcome={props.outcome}
      facts={props.facts}
      code_app={props.code_app}
      on_open_run={props.on_open_run}
      on_open_automation={props.on_open_automation}
      on_rename_automation={props.on_rename_automation}
      on_renamed={props.on_renamed}
      on_cancel_run={props.on_cancel_run}
    />
  );
  return (
    <>
      {facts ? (
        <div className="mc_facts">
          <span className="mc_fact_cell mc_fact_schedule" title={facts.schedule.title || undefined}>
            {facts.schedule.text}
          </span>
          <span className={`mc_fact_cell mc_fact_last${facts.last.failed ? " is_failed" : ""}`} title={facts.last.title || undefined}>
            {facts.last.text}
          </span>
        </div>
      ) : props.automation_loading ? (
        <div className="mc_facts" aria-busy="true">
          <InlineSkeleton what="the schedule" width="90%" />
          <InlineSkeleton what="the last run" width="80%" />
        </div>
      ) : (
        <div className="mc_card_state">
          <span className="mc_state_text" title={card.line.text}>
            {card.line.text}
          </span>
        </div>
      )}
      {ctx && ctx.mode === "growing" ? (
        <div className="mc_ctx" onClick={stop} onKeyDown={stop}>
          <button
            type="button"
            className={`mc_ctx_bar${budget.phase === "saving" ? " is_saving" : ""}`}
            aria-expanded={budget.phase !== "idle"}
            aria-label={`${ctx.label}: change the budget`}
            disabled={!can_revise || budget.phase === "saving"}
            title={
              can_revise
                ? `${ctx.used !== null ? `${ctx.used.toLocaleString("en-US")} tokens of history were replayed into the last run` : "the last run recorded no history size"} · budget ${budget_now?.toLocaleString("en-US") ?? "unset"} tokens · click to change`
                : `${ctx.label} · the budget is changed on the Automations page`
            }
            onClick={() => dispatch({ type: budget.phase === "idle" ? "open" : "close" })}
          >
            <span className="mc_ctx_track" aria-hidden="true">
              <span className="mc_ctx_fill" style={{ width: `${Math.round((ctx.ratio ?? 0) * 100)}%` }} />
            </span>
            <span className="mc_ctx_label">{ctx.label}</span>
          </button>
          {budget.phase === "choose" ? (
            <div className="mc_ctx_chooser" role="group" aria-label="Context budget">
              {BUDGET_CHOICES.map((n) => (
                <button key={n} type="button" className={`btn mc_btn_sm${n === budget_now ? " is_current" : " mc_btn_quiet"}`} aria-pressed={n === budget_now} title={`${n.toLocaleString("en-US")} tokens`} onClick={() => choose(n)}>
                  {format_tokens(n)}
                </button>
              ))}
              <form
                className="mc_ctx_custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom !== null) choose(custom);
                }}
              >
                <input type="number" className="mc_ctx_input" min={1} step={1000} placeholder="custom" aria-label="Custom context budget, in tokens" value={budget.custom} onChange={(e) => dispatch({ type: "custom", value: e.target.value })} />
                <button type="submit" className="btn mc_btn_sm" disabled={custom === null} title={custom === null ? "a whole number of tokens" : `set the budget to ${custom.toLocaleString("en-US")} tokens`}>
                  Set
                </button>
              </form>
              <button type="button" className="btn mc_btn_sm mc_btn_quiet mc_ctx_close" aria-label="Close" title="Close" onClick={() => dispatch({ type: "close" })}>
                ×
              </button>
            </div>
          ) : null}
          {budget.error ? (
            <div className="mc_act_error" role="alert">
              {budget.error}
            </div>
          ) : null}
        </div>
      ) : ctx && ctx.label ? (
        <span className="mc_ctx_chip" title={`${ctx.mode} context: every run starts from the task alone`}>
          {ctx.label}
        </span>
      ) : null}
      <div className="mc_card_foot mc_auto_foot" onClick={stop} onKeyDown={stop}>
        <button type="button" className="btn mc_btn_sm mc_btn_quiet" disabled={!props.on_open_automation} title={props.on_open_automation ? "Open this automation on the Automations page" : "not available here"} onClick={() => props.on_open_automation?.(card.automation_id)}>
          Open
        </button>
        <GatedButton state={props.on_automation_command ? controls.run_now : { enabled: false, reason: "commands are not wired on this host" }} label="Run now" busy={cmd.busy === "automation.run_now"} onClick={() => command("automation.run_now")} />
        <GatedButton
          state={props.on_automation_command ? controls.toggle.state : { enabled: false, reason: "commands are not wired on this host" }}
          label={controls.toggle.label}
          busy={cmd.busy === controls.toggle.command}
          onClick={() => command(controls.toggle.command)}
        />
        <span className="mc_spacer" />
        {info}
      </div>
      {cmd.error ? (
        <div className="mc_act_error" role="alert">
          {cmd.error}
        </div>
      ) : null}
    </>
  );
}

/** One card — the same skeleton in every lane (design §Card anatomy):
 * title + pill · subject · WHY-NOW (a sentence, or a Done card's answer) · the ask ·
 * metrics + ⧉ + (i) · the Needs-you actions. */
export function BoardCardView(props: { card: BoardCard } & CardHandlers): React.ReactElement {
  const { card } = props;
  const status_word = card.status_word;
  const subject = card_subject_words(card);
  const needs = card.lane === "needs_you";
  const is_automation = card.role === "controller";
  // Observability: any ongoing card opens in Code and can be cancelled, whatever its lane.
  const ongoing = card.lane === "needs_you" || card.lane === "working" || card.lane === "waiting_on";
  const request = needs ? request_glimpse(card, props.detail) : null;
  const answer = outcome_glimpse(card, props.outcome);
  const metrics = card_metrics(card, props.outcome);
  const who_line = needs ? needs_you_line(card, props.now_ms) : null;
  // Where a detail is still loading the card shows a skeleton line, never a blank
  // (operator 2026-10-15): the ask of a Needs-you card, the answer of a Done card.
  const request_loading = needs && !request && props.detail_loading === true;
  const answer_loading = card.lane === "done" && !answer && !card.failed && props.outcome_loading === true;
  const title_loading = card.title.untitled && props.brief_loading === true;
  return (
    <div
      className={`mc_card mc_card_${card.lane}${card.failed ? " mc_card_failed" : ""}${card.line.stalled ? " mc_card_stalled" : ""}${is_automation ? " mc_card_automation" : ""}`}
      data-lane={card.lane}
      data-run-id={card.run_id}
      onClick={() => props.on_open_run(card.run_id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Only the card ITSELF answers Enter — keydown from the controls
        // must never navigate (adversary P0: Enter in a textarea destroyed
        // the typed answer).
        if (e.key === "Enter" && e.target === e.currentTarget) props.on_open_run(card.run_id);
      }}
    >
      <div className="mc_card_head">
        <span className={`mc_card_glyph mc_glyph_${card.subject.kind}`} aria-hidden="true">
          {card.subject.glyph}
        </span>
        {title_loading ? (
          <span className="mc_card_title" title="loading the title…">
            <SkeletonLine className="mc_sk_title" width="64%" />
          </span>
        ) : (
          <span className="mc_card_title" title={full_title(card)}>
            {card.title.text}
            {card.title.untitled ? (
              <>
                {" "}
                <AfChip tone="muted" size="sm" className="mc_untitled" title="No title on the wire yet: the workflow id stands in">
                  untitled
                </AfChip>
              </>
            ) : null}
          </span>
        )}
        {/* ONE word, ONE color map (adversary 3 P0-1). */}
        <span className={`mc_status ${run_status_class(status_word)}`}>{status_word === "unknown" ? "?" : status_word}</span>
      </div>
      {subject.label || subject.secondary || card.archived ? (
        <div className="mc_card_subject">
          {subject.label ? (
            <span className="mc_subject_label" title={subject.label}>
              {subject.label}
            </span>
          ) : null}
          {subject.secondary ? (
            <span className="mc_subject_secondary" title={subject.secondary}>
              {subject.secondary}
            </span>
          ) : null}
          {card.archived ? <span className="mc_pill" data-tag="archived" title="This conversation is archived: hidden from chat lists, kept here and in the ledger">Archived</span> : null}
        </div>
      ) : null}
      {is_automation ? (
        <AutomationCardBody {...props} />
      ) : answer_loading ? (
        <InlineSkeleton what="the answer" />
      ) : answer ? (
        /* A Done card's WHY-NOW is its outcome: a glimpse of the answer. */
        <div className="mc_glimpse mc_glimpse_answer" title={answer.full}>
          {/* Answers are markdown: rendered, then flattened to one quiet run of text
            * (board.css) — "# Digest **Date**" never shows its syntax. Remote images
            * stay links; nothing in a glimpse is a control. */}
          <Markdown text={answer.text} images="link" className="mc_glimpse_md" />
        </div>
      ) : (
        <div className="mc_card_state">
          <ActorBadge card={card} on_open_run={props.on_open_run} />
          {who_line ? (
            <span className="mc_state_text" title={card.line.text}>
              {who_line.who ? (
                <>
                  <span className="mc_who" title={`Started by ${who_line.who}`}>
                    {who_line.who}
                  </span>
                  {" · "}
                </>
              ) : null}
              {who_line.text}
            </span>
          ) : (
            <span className="mc_state_text" title={card.failed && card.error ? card.error : card.line.text !== card.line.brief ? card.line.text : undefined}>
              {card.line.text}
            </span>
          )}
          {card.line.stalled ? (
            <span
              className="mc_stall"
              role="img"
              aria-label="no progress"
              title={`No ledger step for ${compact_duration(card.line.stale_ms ?? 0)}: past the ${stall_label(props.stall_after_ms)} threshold set in the board header`}
            >
              {"\u00a0⚠"}
            </span>
          ) : null}
          {card.line.action === "inspect" ? (
            <>
              {" "}
              <button
                type="button"
                className="mc_inspect"
                onClick={(e) => {
                  e.stopPropagation();
                  props.on_open_run(card.run_id);
                }}
                onKeyDown={stop}
              >
                Inspect →
              </button>
            </>
          ) : null}
        </div>
      )}
      {request_loading ? (
        <InlineSkeleton what="the request" />
      ) : request ? (
        /* THE ASK, in place: a card that hides what the run wants forces the
         * open-the-run detour the lane exists to remove. */
        <div className="mc_glimpse mc_glimpse_request" title={request.full}>
          {request.text}
        </div>
      ) : null}
      {card.blocks.length ? (
        <div className="mc_card_blocks" title="These parents wait on this run and on nothing else: answering here unblocks them">
          <span className="mc_blocks_word">blocks</span>{" "}
          {card.blocks.slice(0, 2).map((b, i) => (
            <React.Fragment key={b.run_id}>
              {i > 0 ? ", " : ""}
              <button
                type="button"
                className="mc_link_btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.on_open_run(b.run_id);
                }}
                onKeyDown={stop}
              >
                {clamp_text(b.title, 40)}
              </button>
            </React.Fragment>
          ))}
          {card.blocks.length > 2 ? ` +${card.blocks.length - 2} more` : ""}
        </div>
      ) : null}
      {is_automation ? null : (
      <div className="mc_card_foot">
        <span className="mc_card_metrics" title={card.lane === "done" ? "run time · tokens of the run tree · tool calls · artifacts" : "time since the run started · tokens of the run tree · tool calls"}>
          {metrics.map((m, i) => (
            <React.Fragment key={m}>
              <span className="mc_fact">
                {m}
                {i < metrics.length - 1 ? <span className="mc_sep"> ·</span> : null}
              </span>{" "}
            </React.Fragment>
          ))}
        </span>
        <CopyButton text={card.run_id} label="the run id" title={card.run_id} />
        {ongoing ? <OpenInCode card={card} code_app={props.code_app} variant="icon" /> : null}
        {ongoing && props.on_cancel_run ? <CancelControl run_id={card.run_id} on_cancel_run={props.on_cancel_run} variant="icon" /> : null}
        <InfoButton
          card={card}
          now_ms={props.now_ms}
          stall_after_ms={props.stall_after_ms}
          revision={props.revision}
          detail={props.detail}
          outcome={props.outcome}
          facts={props.facts}
          code_app={props.code_app}
          on_open_run={props.on_open_run}
          on_open_automation={props.on_open_automation}
          on_rename_automation={props.on_rename_automation}
          on_renamed={props.on_renamed}
          on_cancel_run={props.on_cancel_run}
        />
      </div>
      )}
      {needs ? <NeedsYouActions {...props} /> : null}
    </div>
  );
}

const DONE_SHOWN = 8;

export function MissionControlPage(props: MissionControlProps): React.ReactElement {
  const now_ms = Date.now();
  const [stall_after_ms, set_stall_after_ms] = useState<number>(() => read_stall_after_ms(viewer_storage()));
  const rows = useMemo(() => split_board_rows(props.runs, props.all_runs), [props.runs, props.all_runs]);
  const all_rows = useMemo(() => [...rows.active, ...rows.done], [rows]);
  // Global caches: a brief titles every card of its automation; a pulse of an
  // off-screen child decides a Working parent's staleness and the lane's order.
  const automations = useAutomationBriefs(props.client, all_rows);
  const pulses = useRunPulses(props.client, rows.active);
  // Per-card caches are bounded by the viewport: the lanes' visible scroll range
  // plus one screen (IntersectionObserver), the first N per lane without one.
  const vis = useVisibleCards();
  const lane_refs = useMemo(
    () => Object.fromEntries(LANE_ORDER.map((l) => [l, (el: HTMLElement | null) => vis.attach(l, el)])) as Record<BoardLane, (el: HTMLElement | null) => void>,
    [vis.attach],
  );
  const [busy_wait, set_busy_wait] = useState<string>("");
  const [act_error, set_act_error] = useState<string>("");
  const [show_done, set_show_done] = useState(false);
  // Done window: persisted operator preference (survives reloads).
  const [done_window, set_done_window] = useState<DoneWindowKey>(() => {
    try {
      const saved = localStorage.getItem("abstractobserver_done_window_v1") as DoneWindowKey | null;
      return saved && saved in DONE_WINDOW_MS ? saved : DEFAULT_DONE_WINDOW;
    } catch {
      return DEFAULT_DONE_WINDOW;
    }
  });
  // First pass without details or excerpts decides which cards are carded where
  // (neither a wait detail nor an excerpt moves a card between lanes); the
  // per-card reads are planned for the ones in view, and re-title / re-classify them.
  const base = useMemo(
    () => build_board({ active: rows.active, done: rows.done, pulses: pulses.map, automations: automations.map, now_ms: Date.now(), stall_after_ms }),
    [rows, pulses.map, automations.map, stall_after_ms],
  );
  const base_done = useMemo(() => filter_done_window(base.done, done_window, Date.now()).visible, [base, done_window]);
  const done_shown = useMemo(() => (show_done ? base_done : base_done.slice(0, DONE_SHOWN)).map((c) => c.row), [base_done, show_done]);
  const in_view = useMemo(
    () =>
      rows_in_viewport(
        LANE_ORDER.map((l) => (l === "done" ? done_shown : base[l].map((c) => c.row))),
        vis.visible,
      ),
    [base, done_shown, vis.visible],
  );
  const waits = useWaitDetails(props.client, in_view);
  const briefs = useRunBriefs(props.client, in_view);
  // The Done cards in view read their outcome once (answer glimpse + artifact count).
  const done_in_view = useMemo(() => rows_in_viewport([done_shown], vis.visible), [done_shown, vis.visible]);
  const outcomes = useRunOutcomes(props.client, done_in_view);
  const facts_by_automation = useMemo(() => {
    const out = new Map<string, AutomationFacts>();
    for (const [id, rec] of automations.records) out.set(id, automation_facts(rec.raw));
    return out;
  }, [automations.records]);
  const lanes = useMemo(
    () =>
      briefs.map.size || waits.map.size
        ? build_board({ active: rows.active, done: rows.done, details: waits.map, pulses: pulses.map, automations: automations.map, run_briefs: briefs.map, now_ms: Date.now(), stall_after_ms })
        : base,
    [base, briefs.map, rows, waits.map, pulses.map, automations.map, stall_after_ms],
  );
  const done_view = useMemo(
    () => filter_done_window(lanes.done, done_window, now_ms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lanes.done, done_window],
  );

  const data_age = format_age(props.runs_refreshed_at, now_ms);
  const loading = automations.pending + waits.pending + pulses.pending + briefs.pending + outcomes.pending;
  // Re-observe the lanes' cards whenever the carded set changes (the observer only
  // knows the elements it was handed).
  const card_ids_sig = LANE_ORDER.map((l) => lanes[l].map((c) => c.run_id).join(",")).join("|") + `|${show_done}|${done_window}`;
  useEffect(() => {
    vis.refresh();
  }, [card_ids_sig, vis.refresh]);
  const needs_count = lanes.needs_you.length;
  // The failed stat matches what the Done lane SHOWS (the window) — a
  // two-week-old failure alarming forever is noise, not signal.
  const failed_count = done_view.visible.filter((c) => c.failed).length;

  // Access-hint lane (§observer 2): which tile's open questions/problems
  // are expanded, and the diary entry an operator click resolved. The
  // diary READ happens only inside the chip's onOpen (rule zero: render
  // never touches memory state; the gateway marks every read).
  const [hints_open, set_hints_open] = useState<string>("");
  const [diary_view, set_diary_view] = useState<{ entity: string; entry: any; seq: number | null } | null>(null);

  /** Busy identity includes the wait's APPEARANCE (since_ms): runtime wait
   * keys are deterministic per run+node, so a recurring ask at the same
   * node carries the IDENTICAL run_id:wait_key — keying busy on that alone
   * locked every repeat of the wait on "Resuming…" forever (fable5 code
   * adversary P1). A re-asked wait has a new `since`, so it never matches
   * the consumed one's busy key. */
  const busy_key = (card: BoardCard) => `${card.run_id}:${card.wait_key}:${card.since_ms ?? ""}`;

  // Belt for the same finding: when the busy card is no longer in Needs you
  // (the resume landed and the poll moved it), release the lock.
  useEffect(() => {
    if (!busy_wait) return;
    if (!lanes.needs_you.some((c) => busy_key(c) === busy_wait)) set_busy_wait("");
  }, [lanes, busy_wait]);

  async function act(card: BoardCard, payload: any): Promise<void> {
    set_busy_wait(busy_key(card));
    set_act_error("");
    try {
      await props.on_resume_wait(card.run_id, card.wait_key, payload);
      // Deliberately KEEP busy until the poll moves the card out of Needs
      // you: "command accepted" is not "run resumed", and re-enabling the
      // buttons in that window invited a double-approve (adversary P2).
    } catch (e: any) {
      set_act_error(`${card.title.text}: ${String(e?.message || e || "resume failed")}`);
      set_busy_wait("");
    }
  }

  async function resume(card: BoardCard): Promise<void> {
    if (!props.on_resume_run) return;
    set_busy_wait(busy_key(card));
    set_act_error("");
    try {
      const err = await props.on_resume_run(card.run_id);
      if (typeof err === "string" && err) throw new Error(err);
    } catch (e: any) {
      set_act_error(`${card.title.text}: ${String(e?.message || e || "resume failed")}`);
      set_busy_wait("");
    }
  }

  const handlers = (card: BoardCard): CardHandlers => ({
    now_ms,
    stall_after_ms,
    busy: busy_wait === busy_key(card),
    on_open_run: props.on_open_run,
    on_act: (c, payload) => void act(c, payload),
    on_resume: props.on_resume_run ? (c) => void resume(c) : undefined,
    on_open_automation: props.on_open_automation,
    on_rename_automation: props.on_rename_automation,
    // The PATCH is a queued command the controller applies moments later:
    // re-read now and once more after it has had time to land.
    on_renamed: (automation_id) => {
      automations.invalidate(automation_id);
      window.setTimeout(() => automations.invalidate(automation_id), 2000);
    },
    revision: card.automation_id ? automations.revisions.get(card.automation_id) ?? null : null,
    detail: waits.map.get(card.run_id),
    outcome: outcomes.map.get(card.run_id) ?? null,
    facts: card.automation_id ? facts_by_automation.get(card.automation_id) ?? null : null,
    code_app: props.code_app ?? null,
    on_cancel_run: props.on_cancel_run,
    on_automation_command: props.on_automation_command,
    on_revise_automation: props.on_revise_automation,
    detail_loading: waits.loading.has(card.run_id),
    brief_loading: briefs.loading.has(card.run_id),
    outcome_loading: outcomes.loading.has(card.run_id),
    automation_loading: card.automation_id ? automations.loading.has(card.automation_id) : false,
  });

  return (
    <div className="page page_scroll mc_page">
      <div className="mc_health">
        {/* The LED + stat cards carry the answer; the words only appear when
          * something is WRONG (adversary 2 board #5). */}
        <span className={`mc_led ${props.gateway_connected ? "ok" : "bad"}`} title={props.gateway_connected ? "Gateway connected" : "Gateway unreachable"} />
        {!props.gateway_connected ? <span className="mc_health_text">gateway unreachable</span> : null}
        {/* HONEST FIRST PAINT (connected-first fix, 2026-07-13): before the
          * first runs payload lands there are no counts to claim. */}
        {props.runs_refreshed_at === null ? (
          <span className="mc_health_text muted mc_loading">loading runs…</span>
        ) : (
          <div className="mc_stats">
            <div className={`mc_stat ${needs_count ? "is_hot" : ""}`} title="runs only you can move (Needs you lane)">
              <span className="mc_stat_value">{needs_count}</span>
              <span className="mc_stat_label">need you</span>
            </div>
            <div className={`mc_stat ${failed_count ? "is_bad" : ""}`} title="failed runs in the Done lane's window">
              <span className="mc_stat_value">{failed_count}</span>
              <span className="mc_stat_label">failed</span>
            </div>
            <div className="mc_stat" title="runs an agent is on (Working lane)">
              <span className="mc_stat_value">{lanes.working.length}</span>
              <span className="mc_stat_label">working</span>
            </div>
          </div>
        )}
        <span className="mc_spacer" />
        <div className="mc_health_side">
          <label className="mc_stall_control" title="A running card whose last ledger step is older than this gets the no-progress mark and floats to the top of Working">
            <span>no progress after</span>
            <select
              className="mc_window_select mc_stall_select"
              value={String(stall_after_ms)}
              onChange={(e) => {
                const v = Number(e.target.value);
                set_stall_after_ms(v);
                try {
                  localStorage.setItem(STALL_STORAGE_KEY, String(v));
                } catch {}
              }}
            >
              {STALL_AFTER_OPTIONS.map((o) => (
                <option key={o.ms} value={String(o.ms)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {data_age ? (
            <span className="mc_health_text muted" title="age of the last runs poll — the board is only as live as this; 'loading' counts the card details still being read">
              data {data_age} old{loading ? ` · ${loading} loading` : ""}
            </span>
          ) : null}
          <button className="btn" onClick={props.on_refresh} disabled={props.refreshing}>
            {props.refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {act_error ? <div className="mc_error">{act_error}</div> : null}
      {props.entities.length || props.entities_error ? (
        <div className="mc_entities">
          <div className="mc_entities_head">
            <span>
              Entities
              {props.entities_total > props.entities.length ? ` (${props.entities.length} of ${props.entities_total} — open the entity app for all)` : ""}
            </span>
            <a className="mc_entity_link" href={props.entity_app_href} target="_blank" rel="noreferrer">
              open the entity app →
            </a>
          </div>
          {props.entities_error ? <div className="muted">{props.entities_error}</div> : null}
          <div className="mc_entities_row">
            {props.entities.map((e) => (
              <div key={e.name} className="mc_entity_cell">
              <a
                className="mc_entity"
                href={`${props.entity_app_href}${props.entity_app_href.includes("?") ? "&" : "?"}entity=${encodeURIComponent(e.name)}&live=1`}
                target="_blank"
                rel="noreferrer"
                title={[e.error, e.age_days !== null ? `${e.age_days.toFixed(0)} days old` : "", e.last_moment].filter(Boolean).join(" — ") || e.name}
              >
                <span className="mc_entity_name">{e.name}</span>
                {/* ONE ACTIVE PHASE (c1455 ruling): prefer the cognition
                  * wire's composite phase — the same source both apps
                  * render — over the card-state heuristic. The chip's
                  * tooltip names the SOURCE so a degraded read is never
                  * mistaken for the wire's truth. */}
                {(() => {
                  const raw = String(e.live_phase || e.state || "").trim();
                  const phase_word = entity_phase(raw, props.phase_graph);
                  const phase_cls = known_phase_keys(props.phase_graph).has(phase_word) ? phase_word : "other";
                  // Wire-word honesty, generalized (adversary F7): whenever
                  // the fold changed the word, the tooltip carries the raw
                  // wire word verbatim — settling gets its badge from the
                  // graph's own initial, never a hardcoded destination.
                  const settled_word = props.phase_graph?.initial ?? "sleep";
                  const is_settling = /awake|idle/i.test(raw) && phase_word === settled_word;
                  const wire_note = raw && raw.toLowerCase() !== phase_word ? ` — wire word: ${raw}${is_settling ? " (settling)" : ""}` : "";
                  return (
                    <span
                      className={`mc_entity_phase mc_phase_${phase_cls}`}
                      title={(e.live_phase ? "phase (cognition wire)" : "phase from card state — cognition wire unavailable") + wire_note}
                    >
                      {phase_word}
                    </span>
                  );
                })()}
                {/* Moment kinds arrive as snake_case event names — display
                  * de-snakes for reading; the tooltip keeps the verbatim. */}
                {e.last_moment ? <span className="mc_entity_moment" title={e.last_moment}>{e.last_moment.replace(/_/g, " ")}</span> : null}
                {/* WORKING / FRESHNESS (B3, 2026-07-13): the cognition wire's
                  * store-read `working` is authoritative when present
                  * (gateway c1390); pre-wire gateways fall back to the
                  * moment-age heuristic. Unknown shows nothing — never
                  * fabricate liveness. */}
                {(() => {
                  // "busy", never "working" — WORK is a ruled PHASE word;
                  // execution liveness must not wear it (fable5 P1,
                  // c1475 wave).
                  if (e.working === true) {
                    return (
                      <span className="mc_entity_live" title="busy now (loop mid-day or live visit — store-read, never fabricated)">
                        ● busy
                      </span>
                    );
                  }
                  const age = entity_activity_age(e.last_moment_at, now_ms);
                  if (e.working === false) {
                    return (
                      <span className="mc_entity_live muted" title="idle (cognition wire)">
                        idle{age !== null ? ` · ${format_age(now_ms - age, now_ms)} ago` : ""}
                      </span>
                    );
                  }
                  if (age === null) return null;
                  return age <= ACTIVE_WINDOW_MS ? (
                    <span className="mc_entity_live" title={`last moment ${format_age(now_ms - age, now_ms)} ago`}>
                      ● active
                    </span>
                  ) : (
                    <span className="mc_entity_live muted" title="time since the last recorded moment">
                      {format_age(now_ms - age, now_ms)} ago
                    </span>
                  );
                })()}
                {/* SPEND (B3 second half): lifetime billed tokens from the
                  * home run ledger + the open visit's live spend. Warnings
                  * from the wire ride the tooltip so a partial number is
                  * never read as total. */}
                {e.tokens_total !== null ? (
                  <span
                    className="muted mc_entity_spend"
                    title={`lifetime billed tokens (home run ledger)${e.live_visit_tokens !== null ? `; open visit: ${format_tokens(e.live_visit_tokens)} tk` : ""}${e.spend_warning ? `; ${e.spend_warning}` : ""}`}
                  >
                    {format_tokens(e.tokens_total)} tk{e.live_visit_tokens !== null ? ` (+${format_tokens(e.live_visit_tokens)})` : ""}
                    {e.spend_warning ? "*" : ""}
                  </span>
                ) : null}
              </a>
              {/* Access-hint lane (§observer 2 + build-5 twin): what this
                * entity carries OPEN plus what it has DISTILLED, rendered
                * from the card's briefs. A count badge — the deep view
                * stays the entity app. */}
              {e.open_questions_total || e.open_problems_total || e.lessons_total || e.dreams_brief ? (
                <button
                  type="button"
                  className="mc_entity_hints_btn"
                  aria-expanded={hints_open === e.name}
                  title="open questions / problems + distilled lessons + night signals from the entity card — click to expand"
                  onClick={() => set_hints_open(hints_open === e.name ? "" : e.name)}
                >
                  {[
                    e.open_questions_total ? `${e.open_questions_total} question${e.open_questions_total > 1 ? "s" : ""}` : "",
                    e.open_problems_total ? `${e.open_problems_total} problem${e.open_problems_total > 1 ? "s" : ""}` : "",
                    e.lessons_total ? `${e.lessons_total} lesson${e.lessons_total > 1 ? "s" : ""}` : "",
                    // "night:" prefix — the count is SIGNALS across standing
                    // dreams (engine fold verified live: 24 = 12+12 over two
                    // dreams); "dreams" here would have been a lie by unit.
                    e.dreams_brief ? `night: ${e.dreams_brief.count} signal${e.dreams_brief.count > 1 ? "s" : ""}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </button>
              ) : null}
              </div>
            ))}
          </div>
          {(() => {
            if (!hints_open) return null;
            const e = props.entities.find((t) => t.name === hints_open);
            if (!e || (!e.open_questions.length && !e.open_problems.length && !e.lessons.length && !e.dreams_brief)) return null;
            // Transport wrapper: the chip calls it on a DELIBERATE click;
            // the gateway marks the read in the entity's stream before the
            // words return — the modal says so (visibility is truth-keeping).
            const open_entry = props.on_read_diary
              ? async (entry_id: string) => {
                  const payload = await props.on_read_diary!(e.name, entry_id);
                  set_diary_view({
                    entity: e.name,
                    entry: payload?.entry ?? payload,
                    seq: typeof payload?.read_recorded_at_seq === "number" ? payload.read_recorded_at_seq : null,
                  });
                }
              : undefined;
            const hidden =
              e.open_questions_total - e.open_questions.length +
              (e.open_problems_total - e.open_problems.length) +
              (e.lessons_total - e.lessons.length);
            return (
              <div className="mc_entity_hints_panel">
                {e.open_questions.map((b, i) => (
                  <AfMemoryHintChip
                    key={`q_${b.record_id || i}`}
                    kind="question"
                    label={b.title || clamp_brief(b.statement)}
                    entryId={b.entry_id}
                    onOpen={open_entry}
                    title={b.statement || b.title}
                  />
                ))}
                {e.open_problems.map((b, i) => (
                  <AfMemoryHintChip
                    key={`p_${b.record_id || i}`}
                    kind="problem"
                    label={b.title || clamp_brief(b.statement)}
                    entryId={b.entry_id}
                    onOpen={open_entry}
                    title={b.statement || b.title}
                  />
                ))}
                {/* Lessons: machine-formed ones carry no entry_id and render
                  * as plain text (chip honesty rule); elected ones with a
                  * book key open through the same diary door. */}
                {e.lessons.map((b, i) => (
                  <AfMemoryHintChip
                    key={`l_${b.record_id || i}`}
                    kind="lesson"
                    label={b.title || clamp_brief(b.statement)}
                    entryId={b.entry_id}
                    onOpen={open_entry}
                    title={b.statement || b.title}
                  />
                ))}
                {/* Night signals (wave-5): a compact factual line — count,
                  * kinds, felt tones as WORDS. Structure decided the
                  * signals; feelings only color — no meter, no weight,
                  * nothing clickable here (the experience layer is the
                  * entity app's inspector). */}
                {e.dreams_brief ? (
                  <span
                    className="mc_entity_dreams muted"
                    title="night signals carried by STANDING dreams (the sleep pass's maintenance stream; count = signals, not dreams); felt tones color the content, they never rank it — the entity app renders the full stream"
                  >
                    night signals: {e.dreams_brief.count}
                    {e.dreams_brief.dreams ? ` across ${e.dreams_brief.dreams} dream${e.dreams_brief.dreams > 1 ? "s" : ""}` : ""}
                    {/* kinds is a UNION across standing dreams (unbounded by
                      * the per-dream <=12 contract) — bound the strip line,
                      * overflow stays a count (law-clean). */}
                    {e.dreams_brief.kinds.length
                      ? ` — ${e.dreams_brief.kinds.slice(0, 6).join(", ")}${e.dreams_brief.kinds.length > 6 ? ` +${e.dreams_brief.kinds.length - 6} more` : ""}`
                      : ""}
                    {e.dreams_brief.felt_tones.length ? ` · felt: ${e.dreams_brief.felt_tones.slice(0, 6).join(", ")}` : ""}
                  </span>
                ) : null}
                {hidden > 0 ? (
                  <span className="muted mc_entity_hints_more">+{hidden} more — open the entity app</span>
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : null}

      {diary_view ? (
        <Modal
          open
          title={`${diary_view.entity} — diary entry`}
          onClose={() => set_diary_view(null)}
        >
          <div className="mc_diary_entry">
            <div className="mc_diary_meta muted">
              {[
                diary_view.entry?.kind ? `kind: ${diary_view.entry.kind}` : "",
                diary_view.entry?.visibility ? `visibility: ${diary_view.entry.visibility}` : "",
                diary_view.entry?.written_at ? `written: ${diary_view.entry.written_at}` : "",
                diary_view.entry?.entry_id ? `id: ${diary_view.entry.entry_id}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {/* Reads disclose: the gateway marked this read in the entity's
              * replay stream before serving the words — say so, always. */}
            <div className="mc_diary_recorded muted">
              this read was recorded in {diary_view.entity}’s stream{diary_view.seq !== null ? ` (seq ${diary_view.seq})` : ""}
            </div>
            {diary_view.entry?.gist ? <div className="mc_diary_gist">{String(diary_view.entry.gist)}</div> : null}
            <pre className="mc_diary_text">{String(diary_view.entry?.text || "(entry carries no text)")}</pre>
          </div>
        </Modal>
      ) : null}

      <div className="mc_board">
        {LANE_ORDER.map((lane) => {
          // Done is WINDOWED (operator 2026-07-14): terminal runs grow
          // without bound; active lanes never hide anything.
          const windowed = lane === "done" ? done_view.visible : lanes[lane];
          const visible = lane === "done" && !show_done ? windowed.slice(0, DONE_SHOWN) : windowed;
          const loading_lane = props.runs_refreshed_at === null || (lane === "done" && props.done_loaded === false);
          return (
            <BoardColumn
              key={lane}
              col={lane}
              title={LANE_LABEL[lane]}
              count={loading_lane ? null : windowed.length}
              count_title={lane === "done" && done_view.hidden_count ? `${done_view.hidden_count} older run(s) outside this window` : undefined}
              tools={
                lane === "done" ? (
                    <select
                      className="mc_window_select"
                      value={done_window}
                      title="Show terminal runs from this time window"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const v = e.target.value as DoneWindowKey;
                        set_done_window(v);
                        set_show_done(false);
                        try {
                          localStorage.setItem("abstractobserver_done_window_v1", v);
                        } catch {}
                      }}
                    >
                      {(Object.keys(DONE_WINDOW_MS) as DoneWindowKey[]).map((k) => (
                        <option key={k} value={k}>
                          {DONE_WINDOW_LABEL[k]}
                        </option>
                      ))}
                    </select>
                ) : null
              }
            >
              <div className="mc_column_hint muted">{LANE_HINT[lane]}</div>
              <div className="mc_column_cards" ref={lane_refs[lane]} aria-busy={loading_lane || undefined}>
                {/* Before the first poll a lane shows card-shaped skeletons, never an
                  * empty sentence (operator 2026-10-15: "nothing is blocked" while loading). */}
                {loading_lane && !visible.length ? <SkeletonCards n={SKELETON_CARDS[lane]} /> : null}
                {visible.map((card) => (
                  <BoardCardView key={card.run_id} card={card} {...handlers(card)} />
                ))}
                {!windowed.length && !loading_lane ? (
                  <div className="mc_empty muted">
                    {lane === "done" && done_view.hidden_count ? `none in the ${DONE_WINDOW_LABEL[done_window]} — ${done_view.hidden_count} older` : LANE_EMPTY[lane]}
                  </div>
                ) : null}
                {lane === "done" && windowed.length > DONE_SHOWN && !show_done ? (
                  <button className="btn mc_more" onClick={() => set_show_done(true)}>
                    show all {windowed.length}
                  </button>
                ) : null}
                {lane === "done" && done_view.hidden_count && windowed.length ? (
                  <div className="mc_window_note muted" title="Widen the window above to see older terminal runs">
                    +{done_view.hidden_count} older outside {DONE_WINDOW_LABEL[done_window]}
                  </div>
                ) : null}
              </div>
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
}
