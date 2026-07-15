// MISSION CONTROL — the board (maintainer-directed, 2026-07-12 sign-off).
//
// One screen that answers "is everything healthy, and what needs me?" across
// runs AND entities. The organizing metaphor is the maintainer's ask: kanban
// columns Pending / Working / Review / Done — but cards move THEMSELVES
// (state-driven, no drag): the operator watches flow and acts only in the
// Review column, where waits carry inline Approve / Reject / Answer.
//
// Honesty rules carried in:
// - Cards derive from run-state truth (status + wait classification via
//   runtime_activity.ts) — never from prose.
// - The entities strip reads the CHEAP card endpoint (gateway c1038:
//   card + as_of_seq), never whole-life replay folds.
// - Staleness is visible (data age chip) because the board is only as live
//   as its poll — pretending otherwise is the old dashboard lie.
import { useEffect, useMemo, useState } from "react";
import "./board.css";

import { extract_tool_calls_from_wait } from "../lib/runtime_extractors";
import type { WaitState } from "../lib/types";
import { run_status_class, run_status_word, type RunSummary } from "./run_status";
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
  /** The run's error text (failed runs) — rendered as a clamped line on
   * the card so the WHY is visible without opening the run. */
  error: string;
  paused: boolean;
  is_subrun: boolean;
};

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
  error: string;
};

/** Compact token count for tile chips: 812 -> "812", 12_340 -> "12.3k",
 * 4_200_000 -> "4.2M". Null-safe (null renders nothing — never fabricate). */
export function format_tokens(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/* REVIEW FIRST: the column where a human is the blocker renders leftmost —
 * insertion order IS render order, and at narrow widths later columns fall
 * below the fold (fable5 layout P1-5: Review was third of four). */
export const COLUMN_LABEL: Record<BoardColumnId, string> = {
  review: "Review",
  working: "Working",
  pending: "Pending",
  done: "Done",
};

/* Empty columns say what empty MEANS — a bare "—" reads as a load failure
 * (fable5 layout P1-12). */
export const COLUMN_EMPTY: Record<BoardColumnId, string> = {
  review: "nothing needs you",
  working: "idle",
  pending: "nothing scheduled",
  done: "no recent runs",
};

export const COLUMN_HINT: Record<BoardColumnId, string> = {
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
    // Failed cards carry their WHY — the Done column promises "read the
    // outcome" and a bare red pill kept the error three clicks away
    // (fable5 layout P1-14).
    error: String((run as any)?.error || "").trim(),
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
  let tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s;
  // "bundle@ver:hash" ids: a bare hex tail would title the card by HASH
  // (usability defender — the operator read "a8f5b5f8" where the run's
  // NAME belonged). Keep the human prefix; the id still rides the meta row.
  if (s.includes(":") && /^[0-9a-f]{6,}$/i.test(tail.trim())) {
    const head = s.slice(0, s.lastIndexOf(":"));
    if (/[a-z]/i.test(head) && !/^[0-9a-f]+$/i.test(head.replace(/[@.\-_]/g, ""))) tail = head;
  }
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
  // LIVENESS AXIS (c1523): stop is NOT a phase — it is the kill switch
  // above the machine. The board renders it unmistakably whichever at-rest
  // spelling semantics rules (stop / stopped); paused is today's engraved
  // hard-freeze (frozen:true, everything torn down) and wears the same
  // emergency treatment until the spelling ruling lands.
  if (s.includes("stop")) return "stopped";
  if (s.includes("pause")) return "paused";
  if (s.includes("rest")) return "resting";
  // Unlisted server words pass through VERBATIM (never coerced into a
  // ruled phase — collapsing them is the gateway's strict-alignment job,
  // not the renderer's). awake/paused/resting are pre-alignment
  // passthroughs: delete those branches when the gateway serves strict
  // four-phase values only.
  return s;
}

/** Phase keys with a dedicated mc_phase_* style. Unlisted keys render
 * their verbatim WORD but a bounded "other" CLASS (server strings never
 * interpolate into class names). */
export const KNOWN_PHASE_KEYS = new Set(["visit", "work", "personal", "sleep", "awake", "paused", "resting", "stopped", "unknown"]);

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
  const done_view = useMemo(
    () => filter_done_window(columns.done, done_window, now_ms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns.done, done_window],
  );

  const data_age = format_age(props.runs_refreshed_at, now_ms);
  const review_count = columns.review.length;
  // The failed stat matches what the Done column SHOWS (the window) — a
  // two-week-old failure alarming forever is noise, not signal.
  const failed_count = done_view.visible.filter((c) => c.failed).length;

  /** Busy identity includes the wait's APPEARANCE (since_ms): runtime wait
   * keys are deterministic per run+node, so a recurring ask at the same
   * node carries the IDENTICAL run_id:wait_key — keying busy on that alone
   * locked every repeat of the wait on "Resuming…" forever (fable5 code
   * adversary P1). A re-asked wait has a new `since`, so it never matches
   * the consumed one's busy key. */
  const busy_key = (card: BoardCard) => `${card.run_id}:${card.wait_key}:${card.since_ms ?? ""}`;

  // Belt for the same finding: when the busy card is no longer in Review
  // (the resume landed and the poll moved it), release the lock.
  useEffect(() => {
    if (!busy_wait) return;
    if (!columns.review.some((c) => busy_key(c) === busy_wait)) set_busy_wait("");
  }, [columns, busy_wait]);

  async function act(card: BoardCard, payload: any): Promise<void> {
    set_busy_wait(busy_key(card));
    set_act_error("");
    try {
      await props.on_resume_wait(card.run_id, card.wait_key, payload);
      // Deliberately KEEP busy until the poll moves the card out of Review:
      // "command accepted" is not "run resumed", and re-enabling the buttons
      // in that window invited a double-approve (adversary P2).
    } catch (e: any) {
      set_act_error(`${card.run_id}: ${String(e?.message || e || "resume failed")}`);
      set_busy_wait("");
    }
  }

  function render_card(card: BoardCard): React.ReactElement {
    const busy = busy_wait === busy_key(card);
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
          {(() => {
            // ONE word, ONE color map (adversary 3 P0-1: the board's private
            // mc_status_* palette said running=green while every Observe
            // chip said running=blue — same run, two truths).
            const status_word = card.failed ? "failed" : run_status_word({ status: card.status, paused: card.paused });
            return <span className={`mc_status ${run_status_class(status_word)}`}>{status_word === "unknown" ? "?" : status_word}</span>;
          })()}
        </div>
        <div className="mc_card_meta">
          <span className="mono" title={card.run_id}>{short_run_id(card.run_id)}</span>
          {card.is_subrun ? <span title="This wait lives in a child run of an agent workflow">subrun</span> : null}
          {card.duration_ms >= 0 ? <span>{format_duration(card.duration_ms)}</span> : null}
          {card.tokens_total !== null ? <span>{card.tokens_total.toLocaleString()} tk</span> : null}
          {card.tool_calls !== null && card.tool_calls > 0 ? <span>{card.tool_calls} tools</span> : null}
        </div>
        {card.is_scheduled && card.schedule_interval ? (
          <div className="mc_card_line">every {card.schedule_interval}</div>
        ) : null}
        {card.failed && card.error ? (
          <div className="mc_card_error" title={card.error}>
            {card.error.length > 120 ? `${card.error.slice(0, 118)}…` : card.error}
          </div>
        ) : null}
        {is_review ? (
          <div
            className="mc_card_review_body"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="mc_card_reason">{card.reason || "Needs a decision"}</div>
            {/* THE ASK, in place (usability defender): a review card that
              * hides what the run wants — the question text, the tools
              * awaiting approval — forces the open-the-run detour the
              * column exists to remove. Both render from card fields the
              * wire already carries; the full prompt rides the tooltip. */}
            {card.prompt ? (
              <div className="mc_card_prompt" title={card.prompt}>
                {card.prompt.length > 240 ? `${card.prompt.slice(0, 238)}…` : card.prompt}
              </div>
            ) : null}
            {card.tool_names.length ? (
              <div className="mc_card_tools" title="Tool calls awaiting your approval">
                {card.tool_names.slice(0, 4).map((t, i) => (
                  <span key={`${t}_${i}`} className="mc_tool_chip mono">{t}</span>
                ))}
                {card.tool_names.length > 4 ? <span className="mc_tool_chip">+{card.tool_names.length - 4} more</span> : null}
              </div>
            ) : null}
            {card.since_ms !== null ? <div className="mc_card_waiting">waiting {format_age(card.since_ms, now_ms)}</div> : null}
            {no_wait_key ? (
              <div className="mc_card_line" title="The wait has not registered a wait_key yet — open the run to inspect.">
                wait key not published yet — open the run
              </div>
            ) : null}
            {no_wait_key ? (
              /* No wait key = nothing can resume from here. A disabled
               * accent button read as a broken control; the ONE working
               * move (open the run) becomes the button instead. */
              <div className="mc_card_actions">
                <button className="btn" onClick={() => props.on_open_run(card.run_id)}>
                  Open the run →
                </button>
              </div>
            ) : card.wait_kind === "tool_approval" ? (
              <div className="mc_card_actions">
                <button className="btn success" disabled={busy} onClick={() => void act(card, { approved: true })}>
                  {busy ? "Resuming…" : "Approve"}
                </button>
                <button className="btn danger" disabled={busy} onClick={() => void act(card, { approved: false })}>
                  Reject
                </button>
              </div>
            ) : (
              /* USER-RESPONSE waits never take a blind inline answer
               * (operator, 2026-07-14: "to answer, I would require to
               * understand the context — build the proper view over the
               * context"). The card states the ask; the button opens the
               * run's full context view, where the question sits over the
               * session turns and recent steps with the composer. */
              <div className="mc_card_actions">
                <button className="btn primary" onClick={() => props.on_open_run(card.run_id)}>
                  Review &amp; answer →
                </button>
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
        {/* The LED + stat cards carry the answer; "gateway connected" prose
          * duplicated the sidebar footer's connection control (adversary 2
          * board #5). The words only appear when something is WRONG. */}
        <span className={`mc_led ${props.gateway_connected ? "ok" : "bad"}`} title={props.gateway_connected ? "Gateway connected" : "Gateway unreachable"} />
        {!props.gateway_connected ? <span className="mc_health_text">gateway unreachable</span> : null}
        {/* HONEST FIRST PAINT (connected-first fix, 2026-07-13): before the
          * first runs payload lands there are no counts to claim — "0 need
          * you" over a still-loading list is a false empty. */}
        {props.runs_refreshed_at === null ? (
          <span className="mc_health_text muted mc_loading">loading runs…</span>
        ) : (
          /* The three-second answer wears the board.css stat-card recipe
           * (big tabular number over an uppercase label) — the old micro
           * pills buried the ONE number the page exists to surface. */
          <div className="mc_stats">
            <div className={`mc_stat ${review_count ? "is_hot" : ""}`} title="runs blocked on a human decision (Review column)">
              <span className="mc_stat_value">{review_count}</span>
              <span className="mc_stat_label">need you</span>
            </div>
            <div className={`mc_stat ${failed_count ? "is_bad" : ""}`} title="failed runs in the Done column">
              <span className="mc_stat_value">{failed_count}</span>
              <span className="mc_stat_label">failed</span>
            </div>
            <div className="mc_stat" title="runs executing or parked listening">
              <span className="mc_stat_value">{columns.working.length}</span>
              <span className="mc_stat_label">working</span>
            </div>
          </div>
        )}
        <span className="mc_spacer" />
        <div className="mc_health_side">
          {data_age ? <span className="mc_health_text muted" title="age of the last runs poll — the board is only as live as this">data {data_age} old</span> : null}
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
              <a
                key={e.name}
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
                  const phase_word = entity_phase(e.live_phase || e.state);
                  const phase_cls = KNOWN_PHASE_KEYS.has(phase_word) ? phase_word : "other";
                  return (
                    <span
                      className={`mc_entity_phase mc_phase_${phase_cls}`}
                      title={e.live_phase ? "phase (cognition wire)" : "phase from card state — cognition wire unavailable"}
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
            ))}
          </div>
        </div>
      ) : null}

      <div className="mc_board">
        {(Object.keys(COLUMN_LABEL) as BoardColumnId[]).map((col) => {
          // Done is WINDOWED (operator 2026-07-14): terminal runs grow
          // without bound, active columns never hide anything.
          const windowed = col === "done" ? done_view.visible : columns[col];
          const visible = col === "done" && !show_done ? windowed.slice(0, 8) : windowed;
          return (
            <div key={col} className={`mc_column mc_column_${col}`}>
              <div className="mc_column_head">
                <span className="mc_column_title">{COLUMN_LABEL[col]}</span>
                {col === "done" ? (
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
                ) : null}
                <span className="mc_column_count" title={col === "done" && done_view.hidden_count ? `${done_view.hidden_count} older run(s) outside this window` : undefined}>
                  {windowed.length}
                </span>
              </div>
              <div className="mc_column_hint muted">{COLUMN_HINT[col]}</div>
              <div className="mc_column_cards">
                {visible.map((card) => render_card(card))}
                {!windowed.length ? (
                  <div className="mc_empty muted">
                    {props.runs_refreshed_at === null
                      ? "loading…"
                      : col === "done" && done_view.hidden_count
                        ? `none in the ${DONE_WINDOW_LABEL[done_window]} — ${done_view.hidden_count} older`
                        : COLUMN_EMPTY[col]}
                  </div>
                ) : null}
                {col === "done" && windowed.length > 8 && !show_done ? (
                  <button className="btn mc_more" onClick={() => set_show_done(true)}>
                    show all {windowed.length}
                  </button>
                ) : null}
                {col === "done" && done_view.hidden_count && windowed.length ? (
                  <div className="mc_window_note muted" title="Widen the window above to see older terminal runs">
                    +{done_view.hidden_count} older outside {DONE_WINDOW_LABEL[done_window]}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
