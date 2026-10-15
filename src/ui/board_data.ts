/**
 * BOARD DATA — the lazy caches behind the board (backlog 0003 W0, "cheap to
 * watch": the 5 s poll carries no metrics and no ledger folds; everything
 * per-card is lazy, cached and bounded).
 *
 * Five caches, one shape:
 * - automation briefs: `GET /automations/{id}` on FIRST sight of an
 *   automation_id, and again only when that automation's controller row
 *   changes `updated_at` (a summary walks every descendant, RT
 *   attention.py:216-238 — never on a timer);
 * - run briefs: `GET /runs/{id}/input_data` once per plain run (immutable,
 *   cached for the session); the excerpt is `input_data.prompt` when the
 *   flow declares a `prompt` pin, else "" — no other guessing;
 * - run pulses: the last ledger record of each running run, re-read when the
 *   row's `ledger_len`/`updated_at` moved;
 * - wait details: `GET /runs/{id}` for each `reason=user` row, once per
 *   `run_id:updated_at` (rows cannot tell a question from an approval from a
 *   pause — the detail can);
 * - run outcomes: the answer text and the artifact count of each Done card
 *   on screen, read ONCE per terminal run (a finished run never changes:
 *   cached for the session) at the lowest priority.
 *
 * Every fetch goes through ONE pool per gateway client (POOL_LIMIT in flight
 * across the five caches), failures back off (60 s, doubling, capped at 10
 * min), and nothing blocks rendering: the board paints from rows and fills in.
 *
 * Two bounds on the first paint (operator 2026-10-15, "114 loading" for 57
 * cards): the per-card caches (wait details, run briefs, outcomes) are planned
 * only for the cards in a lane's visible scroll range plus one screen
 * (`rows_in_viewport`; the page's IntersectionObserver feeds the set, tests and
 * SSR fall back to the first N per lane), and the IMMUTABLE caches (run
 * briefs, outcomes) are mirrored in sessionStorage keyed by id@version so a
 * reload paints them without a request (`read_persisted` / `write_persisted`,
 * capped, every storage call guarded).
 *
 * The planners (which ids to fetch, what changed) are pure and exported —
 * the hooks are thin shells over them. The poll cache (`RunsPoll`) lives here
 * too: app.tsx's `refresh_runs` folds the active listings and the 60 s sweep
 * through it.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { AutomationsClient } from "@abstractframework/ui-kit";

import { terminal_run_status, parse_iso_ms } from "./format";
import type { RunSummary } from "./run_status";
import { fold_automation_brief, fold_pulse, type AutomationBrief, type RunBrief, type RunPulse } from "./state_line";

// --- the client surface the board reads ------------------------------------------

/** The read-only gateway calls the board's caches use (GatewayClient satisfies it). */
export type BoardDataClient = {
  get_run(run_id: string): Promise<any>;
  get_run_input_data(run_id: string): Promise<any>;
  get_ledger(run_id: string, opts: { after: number; limit: number }): Promise<{ items: any[]; next_after: number }>;
  /** `GET /runs/{id}/artifacts?limit&offset` — the page's `total` is the run's artifact count. */
  list_run_artifacts(run_id: string, opts?: { limit?: number; offset?: number }): Promise<any>;
  automations_client(): AutomationsClient;
};

// --- fetch planning (pure) --------------------------------------------------------

/** One thing a cache wants: an id and the version its value must match. */
export type Want = { id: string; version: string };

export type CacheEntry<V> = {
  /** The version the held value was read at ("" = never read). */
  value_version: string;
  value: V | null;
  has_value: boolean;
  /** The version the last (or current) attempt asked for. */
  attempt_version: string;
  inflight: boolean;
  /** Consecutive failures (0 after a success). */
  failures: number;
  failed_at: number | null;
  error: string;
};

export const RETRY_BASE_MS = 60_000;
export const RETRY_MAX_MS = 10 * 60_000;

/** Backoff after `failures` consecutive failures: 60 s, 120 s, 240 s … capped at 10 min. */
export function retry_after_ms(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

export function empty_entry<V>(): CacheEntry<V> {
  return { value_version: "", value: null, has_value: false, attempt_version: "", inflight: false, failures: 0, failed_at: null, error: "" };
}

/**
 * Which wants need a fetch NOW:
 * - first sight (no entry);
 * - the version moved since the last successful read (unless `immutable`);
 * - a failed id whose backoff has elapsed (a failing id never retries faster,
 *   whatever its version does — no retry storm).
 * Never an id already in flight; each id at most once.
 */
export function plan_fetches<V>(wants: Want[], entries: Map<string, CacheEntry<V>>, now_ms: number, opts?: { immutable?: boolean }): Want[] {
  const out: Want[] = [];
  const seen = new Set<string>();
  for (const w of wants || []) {
    const id = String(w?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const e = entries.get(id);
    if (!e) {
      out.push({ id, version: String(w.version || "") });
      continue;
    }
    if (e.inflight) continue;
    if (e.failed_at !== null) {
      if (now_ms - e.failed_at >= retry_after_ms(e.failures)) out.push({ id, version: String(w.version || "") });
      continue;
    }
    if (opts?.immutable && e.has_value) continue;
    if (e.value_version !== String(w.version || "")) out.push({ id, version: String(w.version || "") });
  }
  return out;
}

export function mark_inflight<V>(entries: Map<string, CacheEntry<V>>, w: Want): void {
  const prev = entries.get(w.id) || empty_entry<V>();
  entries.set(w.id, { ...prev, attempt_version: w.version, inflight: true });
}

export function resolve_entry<V>(entries: Map<string, CacheEntry<V>>, w: Want, value: V | null): void {
  const prev = entries.get(w.id) || empty_entry<V>();
  entries.set(w.id, { ...prev, value, has_value: true, value_version: w.version, attempt_version: w.version, inflight: false, failures: 0, failed_at: null, error: "" });
}

export function reject_entry<V>(entries: Map<string, CacheEntry<V>>, w: Want, error: unknown, now_ms: number): void {
  const prev = entries.get(w.id) || empty_entry<V>();
  entries.set(w.id, {
    ...prev,
    attempt_version: w.version,
    inflight: false,
    failures: prev.failures + 1,
    failed_at: now_ms,
    error: String((error as any)?.message || error || "failed"),
  });
}

/**
 * The values to show for the current wants. `current_only` keeps a value
 * only when it was read at the want's version (a wait detail read before
 * the run moved would re-classify the run's NEW wait — never shown);
 * otherwise the last known value rides until the fresh one lands.
 */
export function select_values<V>(wants: Want[], entries: Map<string, CacheEntry<V>>, opts?: { current_only?: boolean }): Map<string, V> {
  const out = new Map<string, V>();
  for (const w of wants || []) {
    const e = entries.get(w.id);
    if (!e || !e.has_value || e.value === null) continue;
    if (opts?.current_only && e.value_version !== w.version) continue;
    out.set(w.id, e.value);
  }
  return out;
}

/** How many of the current wants are queued or in flight (the data-age chip's "loading" count). */
export function pending_count<V>(wants: Want[], entries: Map<string, CacheEntry<V>>): number {
  let n = 0;
  const seen = new Set<string>();
  for (const w of wants || []) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    if (entries.get(w.id)?.inflight) n += 1;
  }
  return n;
}

/** The wanted ids whose value is not known yet: not planned, queued or in
 * flight, or (`current_only`) held at an older version than wanted. A failed id
 * backing off is NOT loading (the card shows what it has). The card's inline
 * skeleton reads this. */
export function loading_ids<V>(wants: Want[], entries: Map<string, CacheEntry<V>>, opts?: { current_only?: boolean }): Set<string> {
  const out = new Set<string>();
  for (const w of wants || []) {
    const id = String(w?.id || "").trim();
    if (!id || out.has(id)) continue;
    const e = entries.get(id);
    if (!e || e.inflight) {
      out.add(id);
      continue;
    }
    if (e.failed_at !== null) continue;
    if (!e.has_value || (opts?.current_only && e.value_version !== String(w.version || ""))) out.add(id);
  }
  return out;
}

// --- what each cache wants (pure) -------------------------------------------------

function rid(r: RunSummary | null | undefined): string {
  return String(r?.run_id || "").trim();
}

/** The row's wait reason (rows reduce `waiting` to {reason, until}). */
export function row_wait_reason(r: RunSummary): string {
  const w = r?.waiting && typeof r.waiting === "object" ? (r.waiting as any) : null;
  return String(w?.reason || r?.waiting_reason || "").trim().toLowerCase();
}

/** Every distinct automation_id on the rows; its version is the controller row's
 * `updated_at` when the controller is listed, else "" (first sight only). */
export function automation_wants(runs: RunSummary[]): Want[] {
  const version = new Map<string, string>();
  for (const r of runs || []) {
    const aid = String(r?.automation_id || "").trim();
    if (!aid) continue;
    const is_controller = String(r?.role || "").trim() === "controller";
    if (is_controller) version.set(aid, String(r?.updated_at || ""));
    else if (!version.has(aid)) version.set(aid, "");
  }
  return Array.from(version, ([id, v]) => ({ id, version: v }));
}

/** A run that belongs to no automation: its own input is its task. */
export function is_plain_run(r: RunSummary): boolean {
  if (String(r?.automation_id || "").trim()) return false;
  const role = String(r?.role || "").trim();
  if (role === "occurrence" || role === "descendant" || role === "controller") return false;
  return String(r?.session_kind || "").trim() !== "automation";
}

/** Plain runs in view; input data is immutable, so the version is constant. */
export function run_brief_wants(runs_in_view: RunSummary[]): Want[] {
  return (runs_in_view || []).filter((r) => rid(r) && is_plain_run(r)).map((r) => ({ id: rid(r), version: "" }));
}

/** Running rows with a ledger: re-read when `ledger_len` or `updated_at` moved.
 * A row without `ledger_len` cannot address its last record and is skipped
 * (its line keeps the row's own last-touch age). */
/** A running row's last touch must be at least this old before its last ledger
 * record is read: a run that progressed in the last minute shows a fresh age
 * and needs no pulse (P10: no ledger reads at poll cadence; GATE-1 finding 5). */
export const PULSE_MIN_AGE_MS = 60_000;

/** Running rows whose last touch is older than PULSE_MIN_AGE_MS. The version is
 * the ledger length ALONE: the ledger is append-only, so the last record can
 * only change when the length does — `updated_at` in the version re-read a
 * progressing run's ledger every tick (GATE-1 finding 5). */
export function pulse_wants(runs: RunSummary[], now_ms: number = Date.now(), min_age_ms: number = PULSE_MIN_AGE_MS): Want[] {
  const out: Want[] = [];
  for (const r of runs || []) {
    if (!rid(r) || String(r?.status || "").trim().toLowerCase() !== "running") continue;
    const n = typeof r?.ledger_len === "number" ? r.ledger_len : null;
    if (n === null || n < 1) continue;
    const touched = parse_iso_ms(r?.updated_at || r?.created_at || "");
    if (touched !== null && now_ms - touched < min_age_ms) continue;
    out.push({ id: rid(r), version: String(n) });
  }
  return out;
}

/** The ledger window of a run's LAST record (`after` is the cursor before it). */
export function pulse_window(ledger_len: number): { after: number; limit: number } {
  return { after: Math.max(0, Math.floor(ledger_len) - 1), limit: 1 };
}

/** `reason=user` waits (the unresolved class): one detail per `run_id:updated_at`. */
export function wait_detail_wants(runs: RunSummary[]): Want[] {
  const out: Want[] = [];
  for (const r of runs || []) {
    if (!rid(r) || String(r?.status || "").trim().toLowerCase() !== "waiting") continue;
    if (row_wait_reason(r) !== "user") continue;
    out.push({ id: rid(r), version: String(r?.updated_at || "") });
  }
  return out;
}

/** The task excerpt of a plain run: `input_data.prompt` when the flow declares a
 * `prompt` pin, else "". The full text is kept (the card clamps; the (i) shows it). */
export function excerpt_of_input_data(run_id: string, body: any): RunBrief {
  const pins = Array.isArray(body?.pin_ids) ? body.pin_ids.map((p: any) => String(p)) : [];
  const prompt = body?.input_data?.prompt;
  const excerpt = pins.includes("prompt") && typeof prompt === "string" ? prompt.trim() : "";
  return { run_id, excerpt };
}

// --- the viewport bound (pure) ----------------------------------------------------

/** Without an IntersectionObserver (tests, the static render) a lane's first N
 * cards count as in view: about two screens of cards in a 62 vh lane. */
export const VISIBLE_FALLBACK_PER_LANE = 12;

/** The carded rows the per-card caches may fetch for: those whose card is in the
 * visible set (the page's observer: the lane's scroll range plus one screen), or,
 * when there is no observer (`visible === null`), the first `fallback` of each
 * lane. Lane order is kept; a row is listed once. */
export function rows_in_viewport(lane_rows: RunSummary[][], visible: Set<string> | null, fallback: number = VISIBLE_FALLBACK_PER_LANE): RunSummary[] {
  const out: RunSummary[] = [];
  const seen = new Set<string>();
  for (const rows of lane_rows || []) {
    let n = 0;
    for (const r of rows || []) {
      const id = rid(r);
      if (!id || seen.has(id)) continue;
      if (visible === null ? n >= fallback : !visible.has(id)) continue;
      seen.add(id);
      out.push(r);
      n += 1;
    }
  }
  return out;
}

export type BoardFetchPlan = { automations: Want[]; wait_details: Want[]; pulses: Want[]; run_briefs: Want[]; outcomes: Want[] };

/**
 * What the board's five caches want for one paint — the ONE composition the
 * page's hooks and the request-count test share:
 * - automation briefs and pulses are GLOBAL (a brief titles every card of its
 *   automation; a pulse of an off-screen child decides a Working parent's
 *   staleness and the lane's stalled-first order);
 * - wait details, run briefs and outcomes are per card and bounded by the
 *   viewport (`rows_in_viewport`): a title or a glimpse never moves a card
 *   between lanes, so an unread one costs nothing but its own skeleton line.
 * `lane_rows` = the carded rows per lane in lane order (Done: the shown ones).
 */
export function board_fetch_plan(input: { all_rows: RunSummary[]; active_rows: RunSummary[]; lane_rows: RunSummary[][]; done_rows: RunSummary[]; visible: Set<string> | null; now_ms?: number }): BoardFetchPlan {
  const in_view = rows_in_viewport(input.lane_rows, input.visible);
  const done_in_view = rows_in_viewport([input.done_rows], input.visible);
  return {
    automations: automation_wants(input.all_rows),
    wait_details: wait_detail_wants(in_view),
    pulses: pulse_wants(input.active_rows, input.now_ms ?? Date.now()),
    run_briefs: run_brief_wants(in_view),
    outcomes: outcome_wants(done_in_view),
  };
}

/** How many requests a plan costs on an empty cache: one per want, two per outcome
 * (`load_outcome` reads the run and its artifact listing). */
export function plan_request_count(plan: BoardFetchPlan): number {
  return plan.automations.length + plan.wait_details.length + plan.pulses.length + plan.run_briefs.length + 2 * plan.outcomes.length;
}

// --- the session store (pure over a storage-like) ---------------------------------

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PERSIST_KEY_PREFIX = "abstractobserver_board_cache_v1:";
/** Newest entries kept per scope, and the largest blob written (a 5 MB quota is shared with everything else). */
export const PERSIST_MAX_ENTRIES = 400;
export const PERSIST_MAX_CHARS = 600_000;

type PersistedRow = { id: string; version: string; value: unknown };

/** The persisted entries of a scope as cache entries (read at their stored version);
 * empty on any storage failure or an unreadable blob. */
export function read_persisted<V>(storage: StorageLike | null | undefined, scope: string): Map<string, CacheEntry<V>> {
  const out = new Map<string, CacheEntry<V>>();
  if (!storage) return out;
  try {
    const raw = storage.getItem(PERSIST_KEY_PREFIX + scope);
    if (!raw) return out;
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return out;
    for (const r of rows as PersistedRow[]) {
      const id = String(r?.id || "").trim();
      if (!id || r.value === null || r.value === undefined) continue;
      out.set(id, { ...empty_entry<V>(), value: r.value as V, has_value: true, value_version: String(r.version ?? "") });
    }
  } catch {
    return new Map();
  }
  return out;
}

/** Mirror a scope's READ entries (not in flight, not failed) to storage: the newest
 * PERSIST_MAX_ENTRIES, dropping the oldest until the blob fits PERSIST_MAX_CHARS.
 * Never throws. */
export function write_persisted<V>(storage: StorageLike | null | undefined, scope: string, entries: Map<string, CacheEntry<V>>): void {
  if (!storage) return;
  try {
    let rows: PersistedRow[] = [];
    for (const [id, e] of entries) {
      if (!e.has_value || e.value === null || e.inflight || e.failed_at !== null) continue;
      rows.push({ id, version: e.value_version, value: e.value });
    }
    rows = rows.slice(-PERSIST_MAX_ENTRIES);
    let blob = JSON.stringify(rows);
    while (blob.length > PERSIST_MAX_CHARS && rows.length) {
      rows = rows.slice(Math.max(1, Math.floor(rows.length / 4)));
      blob = JSON.stringify(rows);
    }
    if (!rows.length) storage.removeItem(PERSIST_KEY_PREFIX + scope);
    else storage.setItem(PERSIST_KEY_PREFIX + scope, blob);
  } catch {
    // Quota, private mode, a thrown accessor: the in-memory cache is the truth.
  }
}

function session_storage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

// --- the bounded pool -------------------------------------------------------------

/** 3 → 4 (2026-10-15). It was 3 for a reason (backlog 0003 §P2-9/10): the
 * browser's 6-connection budget per host (the gateway speaks HTTP/1.1) is
 * shared with the 5 s tick (2 listings) and the 60 s sweep (2 listings), so 6
 * lazy slots would queue the poll behind card details. 4 leaves the tick its
 * two slots; the viewport bound and the session store carry the real saving. */
export const POOL_LIMIT = 4;

/** Priorities: automation identity first (titles), then what classifies a card, then
 * excerpts, and LAST the outcomes of finished runs (a Done card is readable without
 * its answer; nothing active ever waits behind one). */
export const PRIORITY = { automation: 0, wait_detail: 1, pulse: 1, run_brief: 2, outcome: 3 } as const;

/** A tiny priority queue with at most `limit` tasks in flight. A task's
 * failure never stalls the pump. */
export class FetchPool {
  private queue: Array<{ priority: number; seq: number; task: () => Promise<void> }> = [];
  private seq = 0;
  active = 0;
  peak = 0;

  constructor(readonly limit = POOL_LIMIT) {}

  get queued(): number {
    return this.queue.length;
  }

  submit(priority: number, task: () => Promise<void>): void {
    this.queue.push({ priority, seq: this.seq++, task });
    this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.limit && this.queue.length) {
      const next = this.queue.shift()!;
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      void Promise.resolve()
        .then(next.task)
        .catch(() => undefined)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

const pools = new WeakMap<object, FetchPool>();
/** ONE pool per gateway client: the five caches share its POOL_LIMIT slots. */
export function pool_for(client: object): FetchPool {
  let p = pools.get(client);
  if (!p) {
    p = new FetchPool();
    pools.set(client, p);
  }
  return p;
}

const automations_clients = new WeakMap<object, AutomationsClient>();
function automations_client_for(client: BoardDataClient): AutomationsClient {
  let c = automations_clients.get(client);
  if (!c) {
    c = client.automations_client();
    automations_clients.set(client, c);
  }
  return c;
}

// --- the hooks (thin) ---------------------------------------------------------------

type LazyResult<V> = { map: Map<string, V>; pending: number; loading: Set<string>; invalidate: (id: string) => void };

function want_signature(wants: Want[]): string {
  return wants
    .map((w) => `${w.id}@${w.version}`)
    .sort()
    .join("|");
}

/** Cache entries live for the SESSION, keyed by gateway client and cache scope:
 * the board unmounts on every page switch, and a per-component ref re-fetched
 * every brief, detail, excerpt and pulse on each return (GATE-1 finding 6). A
 * new client (sign-in) is a new map; sign-out drops the old one with its client. */
const entry_stores = new WeakMap<object, Map<string, Map<string, CacheEntry<any>>>>();
export function entries_for<V>(client: object, scope: string, opts?: { persist?: boolean; storage?: StorageLike | null }): Map<string, CacheEntry<V>> {
  let scopes = entry_stores.get(client);
  if (!scopes) {
    scopes = new Map();
    entry_stores.set(client, scopes);
  }
  let entries = scopes.get(scope);
  if (!entries) {
    // A persisted scope (immutable values) starts from the session store: a
    // reload paints its briefs and outcomes without a request.
    entries = opts?.persist ? read_persisted<V>(opts.storage === undefined ? session_storage() : opts.storage, scope) : new Map();
    scopes.set(scope, entries);
  }
  return entries as Map<string, CacheEntry<V>>;
}

const persist_timers = new Map<string, number>();
/** Mirror a scope to the session store soon (one write per burst of landings). */
function schedule_persist<V>(scope: string, entries: Map<string, CacheEntry<V>>): void {
  if (typeof setTimeout === "undefined") return;
  const prev = persist_timers.get(scope);
  if (prev !== undefined) clearTimeout(prev);
  persist_timers.set(
    scope,
    setTimeout(() => {
      persist_timers.delete(scope);
      write_persisted(session_storage(), scope, entries);
    }, 250) as unknown as number,
  );
}

function useLazyCache<V>(
  client: BoardDataClient | null | undefined,
  wants: Want[],
  load: (client: BoardDataClient, w: Want) => Promise<V | null>,
  opts: { scope: string; priority: number; immutable?: boolean; current_only?: boolean; persist?: boolean },
): LazyResult<V> {
  const store = useRef<{ client: BoardDataClient | null; entries: Map<string, CacheEntry<V>>; gen: number }>({ client: null, entries: new Map(), gen: 0 });
  if (store.current.client !== (client || null)) {
    store.current = { client: client || null, entries: client ? entries_for<V>(client, opts.scope, { persist: opts.persist }) : new Map(), gen: store.current.gen + 1 };
  }
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  const sig = want_signature(wants);
  // A coarse clock in the deps lets a failed id retry once its backoff has
  // elapsed (the board re-renders on every poll); finer would re-plan for nothing.
  const retry_clock = Math.floor(Date.now() / 30_000);
  const load_ref = useRef(load);
  load_ref.current = load;

  useEffect(() => {
    const s = store.current;
    if (!s.client) return;
    const c = s.client;
    const gen = s.gen;
    const plan = plan_fetches(wants, s.entries, Date.now(), { immutable: opts.immutable });
    if (!plan.length) return;
    const pool = pool_for(c);
    for (const w of plan) {
      mark_inflight(s.entries, w);
      pool.submit(opts.priority, async () => {
        try {
          const v = await load_ref.current(c, w);
          if (store.current.gen !== gen) return;
          resolve_entry(s.entries, w, v);
          if (opts.persist) schedule_persist(opts.scope, s.entries);
        } catch (e) {
          if (store.current.gen !== gen) return;
          reject_entry(s.entries, w, e, Date.now());
        }
        bump();
      });
    }
    bump();
    // `wants` is represented by `sig`; `tick` re-plans after every landing and
    // after an invalidate (an empty plan is a no-op, so this cannot loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sig, retry_clock, tick, opts.priority, opts.immutable]);

  const map = useMemo(
    () => select_values(wants, store.current.entries, { current_only: opts.current_only }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, tick, opts.current_only, client],
  );
  const pending = useMemo(
    () => pending_count(wants, store.current.entries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, tick, client],
  );
  const loading = useMemo(
    () => loading_ids(wants, store.current.entries, { current_only: opts.current_only }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, tick, opts.current_only, client],
  );
  const invalidate = useMemo(
    () => (id: string) => {
      const e = store.current.entries.get(id);
      // Forget the read version: the next plan fetches it again.
      if (e && !e.inflight) store.current.entries.set(id, { ...e, value_version: "\u0000stale", failed_at: null, failures: 0 });
      bump();
    },
    [],
  );
  return { map, pending, loading, invalidate };
}

/** A fetched automation: the folded brief, the revision a rename must name, and the
 * raw `GET /automations/{id}` body (the (i) reads the fields the brief does not fold). */
export type AutomationRecord = { brief: AutomationBrief; revision: number | null; raw: any };

export function fold_automation_record(body: any): AutomationRecord | null {
  const brief = fold_automation_brief(body);
  if (!brief) return null;
  const rev = typeof body?.active_revision === "number" ? body.active_revision : typeof body?.definition?.revision === "number" ? body.definition.revision : null;
  return { brief, revision: rev, raw: body };
}

/** What the (i) shows beyond the brief, read from the raw record (gateway
 * docs/automations.md: `schedule@1` takes `{start_at?, every?, until?, count?}`;
 * `policy.retry = {max_attempts, backoff: {initial, factor, max}}`). Absent on
 * the wire = null, never a default. */
export type AutomationFacts = {
  /** `trigger.source_id`: "schedule" / "email_received" / "manual" / … ("" when absent). */
  trigger_source: string;
  /** `trigger.config.count`: the schedule stops after this many runs. */
  stop_after: number | null;
  /** `trigger.config.until` (exclusive end of the schedule), epoch ms. */
  stop_at_ms: number | null;
  /** `definition.target.workflow_id`. */
  workflow_id: string;
  retry: { max_attempts: number | null; initial: string; factor: number | null; max: string } | null;
};

export function automation_facts(raw: any): AutomationFacts {
  const def = raw?.definition && typeof raw.definition === "object" ? raw.definition : {};
  const trigger = raw?.summary?.trigger && typeof raw.summary.trigger === "object" ? raw.summary.trigger : def?.trigger && typeof def.trigger === "object" ? def.trigger : {};
  const config = trigger?.config && typeof trigger.config === "object" ? trigger.config : {};
  const retry = def?.policy?.retry && typeof def.policy.retry === "object" ? def.policy.retry : null;
  const backoff = retry?.backoff && typeof retry.backoff === "object" ? retry.backoff : {};
  const count = typeof config.count === "number" && Number.isFinite(config.count) && config.count > 0 ? config.count : null;
  return {
    trigger_source: String(trigger?.source_id || "").trim(),
    stop_after: count,
    stop_at_ms: parse_iso_ms(typeof config.until === "string" ? config.until : ""),
    workflow_id: String(def?.target?.workflow_id || "").trim(),
    retry: retry
      ? {
          max_attempts: typeof retry.max_attempts === "number" ? retry.max_attempts : null,
          initial: String(backoff.initial ?? "").trim(),
          factor: typeof backoff.factor === "number" ? backoff.factor : null,
          max: String(backoff.max ?? "").trim(),
        }
      : null,
  };
}

export function useAutomationBriefs(
  client: BoardDataClient | null | undefined,
  runs: RunSummary[],
): { map: Map<string, AutomationBrief>; revisions: Map<string, number>; records: Map<string, AutomationRecord>; pending: number; loading: Set<string>; invalidate: (automation_id: string) => void } {
  const wants = useMemo(() => automation_wants(runs), [runs]);
  const res = useLazyCache<AutomationRecord>(
    client,
    wants,
    async (c, w) => fold_automation_record(await automations_client_for(c).getAutomation(w.id)),
    { scope: "automation", priority: PRIORITY.automation },
  );
  const out = useMemo(() => {
    const map = new Map<string, AutomationBrief>();
    const revisions = new Map<string, number>();
    for (const [id, rec] of res.map) {
      map.set(id, rec.brief);
      if (rec.revision !== null) revisions.set(id, rec.revision);
    }
    return { map, revisions };
  }, [res.map]);
  return { map: out.map, revisions: out.revisions, records: res.map, pending: res.pending, loading: res.loading, invalidate: res.invalidate };
}

/** Run briefs and outcomes are immutable, so they are the two scopes the session store mirrors. */
export const PERSISTED_SCOPES = ["excerpt", "outcome"] as const;

export function useRunBriefs(client: BoardDataClient | null | undefined, runs_in_view: RunSummary[]): { map: Map<string, RunBrief>; pending: number; loading: Set<string> } {
  const wants = useMemo(() => run_brief_wants(runs_in_view), [runs_in_view]);
  const res = useLazyCache<RunBrief>(client, wants, async (c, w) => excerpt_of_input_data(w.id, await c.get_run_input_data(w.id)), {
    scope: "excerpt",
    priority: PRIORITY.run_brief,
    immutable: true,
    persist: true,
  });
  return { map: res.map, pending: res.pending, loading: res.loading };
}

export function useRunPulses(client: BoardDataClient | null | undefined, running_runs: RunSummary[]): { map: Map<string, RunPulse>; pending: number; loading: Set<string> } {
  const wants = useMemo(() => pulse_wants(running_runs, Date.now()), [running_runs]);
  const res = useLazyCache<RunPulse>(
    client,
    wants,
    async (c, w) => {
      const n = Number(String(w.version).split(":")[0] || 0);
      const page = await c.get_ledger(w.id, pulse_window(n));
      const items = Array.isArray(page?.items) ? page.items : [];
      return items.length ? fold_pulse(w.id, n, items[items.length - 1]) : null;
    },
    { scope: "pulse", priority: PRIORITY.pulse },
  );
  return { map: res.map, pending: res.pending, loading: res.loading };
}

/** A detail read before the run moved must never classify its NEW wait (GATE-1 M8 pin). */
export const WAIT_DETAILS_CURRENT_ONLY = true;

export function useWaitDetails(client: BoardDataClient | null | undefined, user_wait_runs: RunSummary[]): { map: Map<string, any>; pending: number; loading: Set<string> } {
  const wants = useMemo(() => wait_detail_wants(user_wait_runs), [user_wait_runs]);
  const res = useLazyCache<any>(client, wants, async (c, w) => await c.get_run(w.id), { scope: "wait_detail", priority: PRIORITY.wait_detail, current_only: WAIT_DETAILS_CURRENT_ONLY });
  return { map: res.map, pending: res.pending, loading: res.loading };
}

/** What a Done card shows of a finished run: a glimpse of its answer and how many
 * artifacts it produced. */
export type RunOutcome = { answer: string; artifacts: number | null };

/** A finished run never changes: its outcome is read once and kept for the session. */
export const OUTCOMES_IMMUTABLE = true;

/** Terminal rows only (a non-terminal row's output is not an outcome yet); constant version. */
export function outcome_wants(done_runs: RunSummary[]): Want[] {
  return (done_runs || []).filter((r) => rid(r) && terminal_run_status(String(r?.status || ""))).map((r) => ({ id: rid(r), version: "" }));
}

/** The answer of a finished run (`GET /runs/{id}`): `output.response` when it is a
 * string, else `output._last_output` when it is a string, else "" — no other guessing. */
export function answer_of_run(detail: any): string {
  const out = detail?.output && typeof detail.output === "object" ? detail.output : null;
  if (typeof out?.response === "string") return out.response.trim();
  if (typeof out?._last_output === "string") return out._last_output.trim();
  return "";
}

/** The artifact count: the listing page's `total` (`GET /runs/{id}/artifacts?limit=1`). */
export function artifact_count_of(page: any): number | null {
  const t = page?.total;
  return typeof t === "number" && Number.isFinite(t) && t >= 0 ? t : null;
}

/** One outcome read: the run detail (its failure fails the read, and the planner backs
 * off) and the artifact count (an unreadable listing leaves the count unknown). */
export async function load_outcome(client: Pick<BoardDataClient, "get_run" | "list_run_artifacts">, run_id: string): Promise<RunOutcome> {
  const [detail, artifacts] = await Promise.all([
    client.get_run(run_id),
    client.list_run_artifacts(run_id, { limit: 1 }).then(artifact_count_of, () => null),
  ]);
  return { answer: answer_of_run(detail), artifacts };
}

/** The outcomes of the Done cards on screen (immutable, lowest priority). */
export function useRunOutcomes(client: BoardDataClient | null | undefined, done_runs: RunSummary[]): { map: Map<string, RunOutcome>; pending: number; loading: Set<string> } {
  const wants = useMemo(() => outcome_wants(done_runs), [done_runs]);
  const res = useLazyCache<RunOutcome>(client, wants, async (c, w) => await load_outcome(c, w.id), {
    scope: "outcome",
    priority: PRIORITY.outcome,
    immutable: OUTCOMES_IMMUTABLE,
    persist: true,
  });
  return { map: res.map, pending: res.pending, loading: res.loading };
}

// --- the viewport hook (the page) -------------------------------------------------

/**
 * Which cards are in view: one IntersectionObserver per lane, rooted at the
 * lane's scroll container with a one-screen margin above and below, over every
 * `[data-run-id]` card inside it. `visible` is null where there is no observer
 * (tests, the static render): `rows_in_viewport` then takes the first N per lane.
 * `attach(lane, el)` is the lane's ref callback; `refresh()` re-observes after
 * the cards changed (call it from an effect keyed on the card ids).
 */
export function useVisibleCards(): { visible: Set<string> | null; attach: (lane: string, el: HTMLElement | null) => void; refresh: () => void } {
  const supported = typeof IntersectionObserver !== "undefined";
  const [visible, set_visible] = useState<Set<string> | null>(() => (supported ? new Set() : null));
  const lanes = useRef(new Map<string, { el: HTMLElement; observer: IntersectionObserver }>());
  const seen = useRef(new Set<string>());
  const attach = useMemo(
    () => (lane: string, el: HTMLElement | null) => {
      const prev = lanes.current.get(lane);
      if (prev && prev.el === el) return;
      if (prev) {
        prev.observer.disconnect();
        lanes.current.delete(lane);
      }
      if (!el || !supported) return;
      const observer = new IntersectionObserver(
        (entries) => {
          let changed = false;
          for (const e of entries) {
            const id = String((e.target as HTMLElement).dataset.runId || "").trim();
            if (!id) continue;
            if (e.isIntersecting ? !seen.current.has(id) : seen.current.has(id)) {
              if (e.isIntersecting) seen.current.add(id);
              else seen.current.delete(id);
              changed = true;
            }
          }
          if (changed) set_visible(new Set(seen.current));
        },
        { root: el, rootMargin: "100% 0px 100% 0px" },
      );
      lanes.current.set(lane, { el, observer });
      for (const card of Array.from(el.querySelectorAll<HTMLElement>("[data-run-id]"))) observer.observe(card);
    },
    [supported],
  );
  const refresh = useMemo(
    () => () => {
      for (const { el, observer } of lanes.current.values()) {
        observer.disconnect();
        for (const card of Array.from(el.querySelectorAll<HTMLElement>("[data-run-id]"))) observer.observe(card);
      }
    },
    [],
  );
  useEffect(() => () => {
    for (const { observer } of lanes.current.values()) observer.disconnect();
    lanes.current.clear();
  }, []);
  return { visible, attach, refresh };
}

// --- the poll cache (app.tsx refresh_runs) ----------------------------------------

/** The active listings' page sizes (W0: no root_only, no include_metrics). */
export const RUNNING_LIMIT = 200;
export const WAITING_LIMIT = 500;
/** The metrics sweep (roots + archived roots, include_metrics): its cadence and floors. */
export const SWEEP_EVERY_MS = 60_000;
/** A forced refresh (Refresh button, after a resume) sweeps too, but never more often than this. */
export const SWEEP_FORCE_FLOOR_MS = 10_000;
/** A run that LEFT the active listings is terminal now: sweep early (its Done card), at most this often. */
export const SWEEP_EARLY_FLOOR_MS = 15_000;

const METRIC_KEYS = ["llm_calls", "tool_calls", "tokens_total"] as const;

/** One run seen by both: the fresh active row wins every field; the sweep only
 * fills metrics the active row lacks (never status/waiting from a stale copy). */
export function merge_run_row(active: RunSummary, sweep: RunSummary | undefined): RunSummary {
  if (!sweep) return active;
  const out: RunSummary = { ...active };
  for (const k of METRIC_KEYS) {
    const v = (active as any)[k];
    if (v === null || v === undefined) (out as any)[k] = (sweep as any)[k] ?? null;
  }
  // The archived flag arrives only with the sweep's (archived_only) copy; an
  // active row of an archived conversation keeps its pill (GATE-1 finding 13).
  if (sweep.archived === true) out.archived = true;
  return out;
}

/** Today's root filter: parent-less runs plus automation occurrences. */
export function is_listing_root(r: RunSummary): boolean {
  return !String(r?.parent_run_id || "").trim() || String(r?.role || "").trim() === "occurrence";
}

export class RunsPoll {
  /** The last sweep's rows (roots + archived roots, with metrics). */
  sweep_rows: RunSummary[] = [];
  /** When the last sweep LANDED (null = never: the Done lane is still loading). */
  sweep_at: number | null = null;
  sweep_started_at: number | null = null;
  sweep_inflight = false;
  /** The last active poll's rows (running + waiting). */
  active_rows: RunSummary[] = [];
  /** Both active listings answered below their page size: absence means "not active". */
  active_complete = false;
  private early = false;

  constructor(readonly epoch: number) {}

  /** Is a sweep due now? First poll; every 60 s; early after a run left the
   * active set (≥15 s since the last); on force (≥10 s since the last). */
  sweep_due(now_ms: number, force = false): boolean {
    if (this.sweep_inflight) return false;
    if (this.sweep_started_at === null) return true;
    const since = now_ms - this.sweep_started_at;
    if (since >= SWEEP_EVERY_MS) return true;
    if (this.early && since >= SWEEP_EARLY_FLOOR_MS) return true;
    return force && since >= SWEEP_FORCE_FLOOR_MS;
  }

  begin_sweep(now_ms: number): void {
    this.sweep_inflight = true;
    this.sweep_started_at = now_ms;
    this.early = false;
  }

  apply_sweep(rows: RunSummary[], now_ms: number): void {
    this.sweep_inflight = false;
    this.sweep_rows = (rows || []).filter((r) => Boolean(rid(r)));
    this.sweep_at = now_ms;
  }

  fail_sweep(): void {
    this.sweep_inflight = false;
  }

  /** Take over another cache's last sweep (rows + landing time) without its
   * schedule: this cache still sweeps at once on its own client. */
  adopt_sweep(prev: RunsPoll): void {
    this.sweep_rows = prev.sweep_rows;
    this.sweep_at = prev.sweep_at;
  }

  apply_active(running: RunSummary[], waiting: RunSummary[], complete: boolean): void {
    const prev = new Set(this.active_rows.map(rid));
    const seen = new Set<string>();
    const rows: RunSummary[] = [];
    for (const r of [...(running || []), ...(waiting || [])]) {
      const id = rid(r);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(r);
    }
    this.active_rows = rows;
    this.active_complete = complete;
    if (complete) for (const id of prev) if (!seen.has(id)) this.early = true;
  }

  /** The views the app keeps: `roots` (the navigator's listing roots) and
   * `all` (every row seen). Active rows win; a sweep copy that still reads
   * non-terminal but is absent from COMPLETE active listings is stale (the
   * run finished since the sweep) and leaves `all` — the board must not
   * show it as working — while `roots` keeps it until the next sweep. */
  view(): { roots: RunSummary[]; all: RunSummary[] } {
    const sweep_by_id = new Map<string, RunSummary>();
    for (const r of this.sweep_rows) sweep_by_id.set(rid(r), r);
    const active_ids = new Set<string>();
    const active_merged: RunSummary[] = [];
    for (const r of this.active_rows) {
      active_ids.add(rid(r));
      active_merged.push(merge_run_row(r, sweep_by_id.get(rid(r))));
    }
    const merged_by_id = new Map(active_merged.map((r) => [rid(r), r]));
    const all: RunSummary[] = [...active_merged];
    const roots: RunSummary[] = active_merged.filter((r) => is_listing_root(r) && !sweep_by_id.has(rid(r)));
    for (const s of this.sweep_rows) {
      const id = rid(s);
      const fresh = merged_by_id.get(id);
      if (fresh) {
        if (is_listing_root(fresh)) roots.push(fresh);
        continue;
      }
      const stale = this.active_complete && !terminal_run_status(String(s?.status || ""));
      if (!stale) all.push(s);
      if (is_listing_root(s)) roots.push(s);
    }
    return { roots, all };
  }
}

const polls = new WeakMap<object, RunsPoll>();
let current_poll: RunsPoll | null = null;

/** The poll cache of a gateway client for one connection epoch (a sign-out
 * bumps the epoch: the previous account's rows never survive it). */
export function runs_poll_for(client: object, epoch: number): RunsPoll {
  let p = polls.get(client);
  if (!p || p.epoch !== epoch) {
    const prev = current_poll;
    p = new RunsPoll(epoch);
    // A second client in the SAME connection epoch (app.tsx polls first
    // through its discovery client, then through its own): adopt the last
    // sweep so the Done lane does not blink empty while this client's own
    // first sweep (due at once) runs. A sign-out bumps the epoch: nothing
    // carries over it.
    if (prev && prev.epoch === epoch && prev.sweep_at !== null) p.adopt_sweep(prev);
    polls.set(client, p);
  }
  current_poll = p;
  return p;
}

/** Read-only: the client's poll cache, if any (render-time reads, e.g. "Done loaded?"). */
export function runs_poll_peek(client: object): RunsPoll | null {
  return polls.get(client) || null;
}

/** True while `p` is the cache the latest poll used (a late sweep of a
 * replaced client/epoch must not write over the current state). */
export function is_current_poll(p: RunsPoll): boolean {
  return current_poll === p;
}
