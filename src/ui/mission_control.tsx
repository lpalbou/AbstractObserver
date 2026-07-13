// MISSION CONTROL — the board (maintainer-directed, 2026-07-12 sign-off).
//
// One screen that answers "is everything healthy, and what needs me?" across
// runs AND entities. The organizing metaphor is the maintainer's ask: kanban
// columns Pending / Working / Review / Done — but cards move THEMSELVES
// (state-driven, no drag): the operator watches flow and acts only in the
// Review column, where waits carry inline Approve / Deny / Answer.
//
// Honesty rules carried in:
// - Cards derive from run-state truth (status + wait classification via
//   runtime_activity.ts) — never from prose.
// - The entities strip reads the CHEAP card endpoint (gateway c1038:
//   card + as_of_seq), never whole-life replay folds.
// - Staleness is visible (data age chip) because the board is only as live
//   as its poll — pretending otherwise is the old dashboard lie.
import { useMemo, useState } from "react";

import { extract_tool_calls_from_wait } from "../lib/runtime_extractors";
import type { WaitState } from "../lib/types";
import type { RunSummary } from "./run_picker";
import {
  parse_iso_ms,
  run_duration_ms,
  runtime_wait_kind,
  runtime_wait_reason_label,
  terminal_run_status,
} from "./runtime_activity";

export type BoardColumnId = "pending" | "working" | "review" | "done";

export type BoardCard = {
  run_id: string;
  column: BoardColumnId;
  workflow: string;
  status: string;
  wait_kind: string;
  reason: string;
  tool_names: string[];
  wait_key: string;
  allow_free_text: boolean;
  prompt: string;
  since_ms: number | null;
  duration_ms: number;
  tokens_total: number | null;
  llm_calls: number | null;
  tool_calls: number | null;
  is_scheduled: boolean;
  schedule_interval: string;
  failed: boolean;
  paused: boolean;
  is_subrun: boolean;
};

export type EntityTile = {
  name: string;
  state: string;
  age_days: number | null;
  last_moment: string;
  error: string;
};

const COLUMN_LABEL: Record<BoardColumnId, string> = {
  pending: "Pending",
  working: "Working",
  review: "Review",
  done: "Done",
};

const COLUMN_HINT: Record<BoardColumnId, string> = {
  pending: "scheduled or queued — will run without you",
  working: "running or parked listening — no action needed",
  review: "needs a human decision — act here",
  done: "terminal — read the outcome",
};

/** Column assignment is pure state truth (exported for the contract tests).
 * Review = a HUMAN is the blocker; parked event waits are Working (a
 * resident listening is progress, not a request). */
export function board_column(run: RunSummary): BoardColumnId {
  const status = String(run?.status || "").trim().toLowerCase();
  if (terminal_run_status(status)) return "done";
  const kind = runtime_wait_kind(run as any);
  if (kind === "tool_approval" || kind === "user_response") return "review";
  if (kind === "scheduled") return "pending";
  if (status === "pending" || status === "queued" || status === "created") return "pending";
  // running / subworkflow / external_event / unknown waits: the system is
  // working or parked; unknown waits stay visible in Working rather than
  // fabricating a human request out of missing context.
  return "working";
}

/** True when a human is this run's blocker RIGHT NOW. */
export function needs_human(run: RunSummary): boolean {
  const kind = runtime_wait_kind(run as any);
  return kind === "tool_approval" || kind === "user_response";
}

export function board_card(run: RunSummary, now_ms = Date.now()): BoardCard {
  const column = board_column(run);
  const wait = run?.waiting && typeof run.waiting === "object" ? (run.waiting as WaitState) : null;
  const tool_calls = extract_tool_calls_from_wait(wait);
  const since_raw = parse_iso_ms((wait as any)?.since || run?.updated_at || run?.created_at || "");
  return {
    run_id: String(run?.run_id || ""),
    column,
    workflow: String(run?.workflow_id || "").trim() || "(workflow?)",
    status: String(run?.status || "").trim().toLowerCase(),
    wait_kind: runtime_wait_kind(run as any),
    reason: runtime_wait_reason_label(run as any),
    tool_names: tool_calls.map((tc: any) => String(tc?.name || "tool")).filter(Boolean),
    wait_key: String((wait as any)?.wait_key || "").trim(),
    allow_free_text: (wait as any)?.allow_free_text !== false,
    prompt: String((wait as any)?.prompt || "").trim(),
    since_ms: since_raw,
    duration_ms: run_duration_ms(run as any, now_ms),
    tokens_total: typeof run?.tokens_total === "number" ? run.tokens_total : null,
    llm_calls: typeof run?.llm_calls === "number" ? run.llm_calls : null,
    tool_calls: typeof run?.tool_calls === "number" ? run.tool_calls : null,
    is_scheduled: Boolean(run?.is_scheduled),
    schedule_interval: String(run?.schedule_interval || "").trim(),
    failed: String(run?.status || "").trim().toLowerCase() === "failed",
    paused: Boolean(run?.paused),
    is_subrun: Boolean(String(run?.parent_run_id || "").trim()),
  };
}

/** Build the four columns.
 *
 * `roots` drives Pending/Working/Done (one card per top-level run).
 * `all_runs` — when provided — drives the REVIEW column instead of the
 * roots: agent workflows execute tool calls in CHILD runs (the parent
 * parks on reason=subworkflow), so a roots-only Review is blind to the
 * single most common approval shape (adversary P0, echoing the
 * 2026-02-21 "approvals must surface while the parent step is running"
 * lesson). A child's review card resumes against the CHILD's
 * run_id + wait_key. */
export function board_columns(
  roots: RunSummary[],
  all_runs?: RunSummary[],
  now_ms = Date.now(),
): Record<BoardColumnId, BoardCard[]> {
  const out: Record<BoardColumnId, BoardCard[]> = { pending: [], working: [], review: [], done: [] };
  const review_source = all_runs && all_runs.length ? all_runs : roots;
  const seen_review = new Set<string>();
  for (const run of review_source || []) {
    const rid = String(run?.run_id || "").trim();
    if (!run || !rid || seen_review.has(rid)) continue;
    if (!needs_human(run)) continue;
    seen_review.add(rid);
    out.review.push(board_card(run, now_ms));
  }
  for (const run of roots || []) {
    const rid = String(run?.run_id || "").trim();
    if (!run || !rid) continue;
    if (seen_review.has(rid)) continue; // already carded in Review
    const card = board_card(run, now_ms);
    // A root whose own wait classified review but which the review source
    // missed (all_runs page bounds) still lands in Review, never dropped.
    out[card.column].push(card);
  }
  // Review: oldest wait first (the longest-blocked run is the most urgent).
  out.review.sort((a, b) => (a.since_ms ?? 0) - (b.since_ms ?? 0));
  // Working/pending: most recently updated first.
  out.working.sort((a, b) => (b.since_ms ?? 0) - (a.since_ms ?? 0));
  out.pending.sort((a, b) => (b.since_ms ?? 0) - (a.since_ms ?? 0));
  // Done: newest first, failures float to the top.
  out.done.sort((a, b) => Number(b.failed) - Number(a.failed) || (b.since_ms ?? 0) - (a.since_ms ?? 0));
  return out;
}

export function format_age(ms: number | null, now_ms = Date.now()): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  const delta = Math.max(0, now_ms - ms);
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${(delta / 3_600_000).toFixed(1)}h`;
  return `${(delta / 86_400_000).toFixed(1)}d`;
}

function format_duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function short_run_id(run_id: string): string {
  const s = String(run_id || "");
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function workflow_short(workflow: string): string {
  const s = String(workflow || "");
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s;
  return tail.length > 34 ? `${tail.slice(0, 32)}…` : tail;
}

// Entity life_state → the four ruled phases (visit / work / personal /
// sleep) plus awake-idle; legacy spellings map per the phase-vocabulary
// ruling (c786).
export function entity_phase(state: string): string {
  const s = String(state || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("visit")) return "visit";
  if (s.includes("sleep") || s.includes("dream")) return "sleep";
  if (s.includes("personal") || s.includes("own_time") || s.includes("own time")) return "personal";
  if (s.includes("task") || s.includes("work")) return "work";
  if (s.includes("awake") || s.includes("idle")) return "awake";
  if (s.includes("pause")) return "paused";
  return s;
}

export type MissionControlProps = {
  gateway_connected: boolean;
  runs: RunSummary[];
  /** Full run listing (subruns included) — powers the Review column. */
  all_runs: RunSummary[];
  runs_refreshed_at: number | null;
  entities: EntityTile[];
  entities_total: number;
  entities_error: string;
  refreshing: boolean;
  on_refresh: () => void;
  on_open_run: (run_id: string) => void;
  on_resume_wait: (run_id: string, wait_key: string, payload: any) => Promise<void>;
  entity_app_href: string;
};

export function MissionControlPage(props: MissionControlProps): React.ReactElement {
  const now_ms = Date.now();
  const columns = useMemo(
    () => board_columns(props.runs, props.all_runs, Date.now()),
    [props.runs, props.all_runs],
  );
  const [busy_wait, set_busy_wait] = useState<string>("");
  const [answer_for, set_answer_for] = useState<string>("");
  const [answer_text, set_answer_text] = useState<string>("");
  const [act_error, set_act_error] = useState<string>("");
  const [show_done, set_show_done] = useState(false);

  const data_age = format_age(props.runs_refreshed_at, now_ms);
  const review_count = columns.review.length;
  const failed_count = columns.done.filter((c) => c.failed).length;

  async function act(card: BoardCard, payload: any): Promise<void> {
    const key = `${card.run_id}:${card.wait_key}`;
    set_busy_wait(key);
    set_act_error("");
    try {
      await props.on_resume_wait(card.run_id, card.wait_key, payload);
      set_answer_for("");
      set_answer_text("");
      // Deliberately KEEP busy until the poll moves the card out of Review:
      // "command accepted" is not "run resumed", and re-enabling the buttons
      // in that window invited a double-approve (adversary P2).
    } catch (e: any) {
      set_act_error(`${card.run_id}: ${String(e?.message || e || "resume failed")}`);
      set_busy_wait("");
    }
  }

  function render_card(card: BoardCard): React.ReactElement {
    const busy = busy_wait === `${card.run_id}:${card.wait_key}`;
    const is_review = card.column === "review";
    const no_wait_key = is_review && !card.wait_key;
    return (
      <div
        key={card.run_id}
        className={`mc_card ${is_review ? "mc_card_review" : ""} ${card.failed ? "mc_card_failed" : ""}`}
        onClick={() => props.on_open_run(card.run_id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          // Only the card ITSELF answers Enter — keydown from the answer
          // textarea / action buttons must never navigate (adversary P0:
          // Enter in the textarea destroyed the typed answer).
          if (e.key === "Enter" && e.target === e.currentTarget) props.on_open_run(card.run_id);
        }}
      >
        <div className="mc_card_head">
          <span className="mc_card_title" title={card.workflow}>
            {workflow_short(card.workflow)}
          </span>
          <span className={`mc_status mc_status_${card.failed ? "failed" : card.status || "unknown"}`}>
            {card.paused ? "paused" : card.failed ? "failed" : card.status || "?"}
          </span>
        </div>
        <div className="mc_card_meta mono">
          <span title={card.run_id}>{short_run_id(card.run_id)}</span>
          {card.is_subrun ? <span title="This wait lives in a child run of an agent workflow">subrun</span> : null}
          {card.duration_ms >= 0 ? <span>{format_duration(card.duration_ms)}</span> : null}
          {card.tokens_total !== null ? <span>{card.tokens_total.toLocaleString()} tk</span> : null}
          {card.tool_calls !== null && card.tool_calls > 0 ? <span>{card.tool_calls} tools</span> : null}
        </div>
        {card.is_scheduled && card.schedule_interval ? (
          <div className="mc_card_line mono">every {card.schedule_interval}</div>
        ) : null}
        {is_review ? (
          <div
            className="mc_card_review_body"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="mc_card_reason">{card.reason || "Needs a decision"}</div>
            {card.since_ms !== null ? <div className="mc_card_waiting mono">waiting {format_age(card.since_ms, now_ms)}</div> : null}
            {no_wait_key ? (
              <div className="mc_card_line" title="The wait has not registered a wait_key yet — open the run to inspect.">
                wait key not published yet — open the run
              </div>
            ) : null}
            {card.wait_kind === "tool_approval" ? (
              <div className="mc_card_actions">
                <button className="btn primary" disabled={busy || no_wait_key} onClick={() => void act(card, { approved: true })}>
                  {busy ? "Resuming…" : "Approve"}
                </button>
                <button className="btn danger" disabled={busy || no_wait_key} onClick={() => void act(card, { approved: false })}>
                  Deny
                </button>
              </div>
            ) : !card.allow_free_text ? (
              // Choice waits render a select in the run view — the board
              // never fakes a free-text answer onto a choices contract.
              <div className="mc_card_actions">
                <button className="btn primary" onClick={() => props.on_open_run(card.run_id)}>
                  Open to answer (choices)
                </button>
              </div>
            ) : (
              <div className="mc_card_actions">
                {answer_for === card.run_id ? (
                  <>
                    <textarea
                      className="mc_answer"
                      rows={2}
                      autoFocus
                      value={answer_text}
                      placeholder={card.prompt ? card.prompt.slice(0, 120) : "Your answer…"}
                      onChange={(e) => set_answer_text(e.target.value)}
                    />
                    <button
                      className="btn primary"
                      disabled={busy || no_wait_key || !answer_text.trim()}
                      onClick={() => void act(card, { response: answer_text.trim() })}
                    >
                      {busy ? "Resuming…" : "Send"}
                    </button>
                    <button className="btn" disabled={busy} onClick={() => set_answer_for("")}>
                      Keep waiting
                    </button>
                  </>
                ) : (
                  <button
                    className="btn primary"
                    disabled={no_wait_key}
                    onClick={() => {
                      set_answer_for(card.run_id);
                      set_answer_text("");
                    }}
                  >
                    Answer
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page page_scroll mc_page">
      <div className="mc_health">
        <span className={`mc_led ${props.gateway_connected ? "ok" : "bad"}`} />
        <span className="mono">{props.gateway_connected ? "gateway connected" : "gateway unreachable"}</span>
        {data_age ? <span className="mono muted">data {data_age} old</span> : null}
        {/* HONEST FIRST PAINT (connected-first fix, 2026-07-13): before the
          * first runs payload lands there are no counts to claim — "0 need
          * you" over a still-loading list is a false empty. */}
        {props.runs_refreshed_at === null ? (
          <span className="mono muted">loading runs…</span>
        ) : (
          <>
            <span className={`mc_pill ${review_count ? "mc_pill_hot" : ""}`}>{review_count} need you</span>
            <span className={`mc_pill ${failed_count ? "mc_pill_bad" : ""}`}>{failed_count} failed</span>
            <span className="mc_pill">{columns.working.length} working</span>
          </>
        )}
        <span className="mc_spacer" />
        <button className="btn" onClick={props.on_refresh} disabled={props.refreshing}>
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {act_error ? <div className="mc_error mono">{act_error}</div> : null}

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
          {props.entities_error ? <div className="mono muted">{props.entities_error}</div> : null}
          <div className="mc_entities_row">
            {props.entities.map((e) => (
              <a
                key={e.name}
                className="mc_entity"
                href={`${props.entity_app_href}${props.entity_app_href.includes("?") ? "&" : "?"}entity=${encodeURIComponent(e.name)}&live=1`}
                target="_blank"
                rel="noreferrer"
                title={e.error || e.last_moment || e.name}
              >
                <span className="mc_entity_name">{e.name}</span>
                <span className={`mc_entity_phase mc_phase_${entity_phase(e.state)}`}>{entity_phase(e.state)}</span>
                {e.age_days !== null ? <span className="mono muted">{e.age_days.toFixed(0)}d old</span> : null}
                {e.last_moment ? <span className="mc_entity_moment">{e.last_moment}</span> : null}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mc_board">
        {(Object.keys(COLUMN_LABEL) as BoardColumnId[]).map((col) => {
          const cards = columns[col];
          const visible = col === "done" && !show_done ? cards.slice(0, 8) : cards;
          return (
            <div key={col} className={`mc_column mc_column_${col}`}>
              <div className="mc_column_head">
                <span className="mc_column_title">{COLUMN_LABEL[col]}</span>
                <span className="mc_column_count mono">{cards.length}</span>
              </div>
              <div className="mc_column_hint muted">{COLUMN_HINT[col]}</div>
              <div className="mc_column_cards">
                {visible.map((card) => render_card(card))}
                {!cards.length ? (
                  <div className="mc_empty muted">{props.runs_refreshed_at === null ? "loading…" : "—"}</div>
                ) : null}
                {col === "done" && cards.length > 8 && !show_done ? (
                  <button className="btn mc_more" onClick={() => set_show_done(true)}>
                    show all {cards.length}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
