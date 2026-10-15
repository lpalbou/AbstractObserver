import { describe, expect, it } from "vitest";

import {
  FetchPool,
  POOL_LIMIT,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  RunsPoll,
  SWEEP_EARLY_FLOOR_MS,
  SWEEP_EVERY_MS,
  SWEEP_FORCE_FLOOR_MS,
  automation_wants,
  excerpt_of_input_data,
  fold_automation_record,
  is_current_poll,
  is_plain_run,
  mark_inflight,
  merge_run_row,
  pending_count,
  plan_fetches,
  pool_for,
  pulse_wants,
  pulse_window,
  reject_entry,
  resolve_entry,
  retry_after_ms,
  run_brief_wants,
  runs_poll_for,
  runs_poll_peek,
  select_values,
  wait_detail_wants,
  type CacheEntry,
  type Want,
  PULSE_MIN_AGE_MS,
  WAIT_DETAILS_CURRENT_ONLY,
  entries_for,
  OUTCOMES_IMMUTABLE,
  PRIORITY,
  answer_of_run,
  artifact_count_of,
  automation_facts,
  load_outcome,
  outcome_wants,
  PERSIST_KEY_PREFIX,
  PERSIST_MAX_CHARS,
  PERSIST_MAX_ENTRIES,
  PERSISTED_SCOPES,
  VISIBLE_FALLBACK_PER_LANE,
  board_fetch_plan,
  empty_entry,
  loading_ids,
  plan_request_count,
  read_persisted,
  rows_in_viewport,
  write_persisted,
  type StorageLike,
} from "./board_data";
import type { RunSummary } from "./run_status";

const T0 = Date.parse("2026-10-14T00:00:00Z");
const row = (p: Partial<RunSummary> & { run_id: string }): RunSummary => ({ status: "running", updated_at: "2026-10-14T00:00:00Z", ...p }) as RunSummary;

/** Run a plan to completion the way the hook does (mark → resolve). */
function settle<V>(entries: Map<string, CacheEntry<V>>, plan: Want[], value: (w: Want) => V): void {
  for (const w of plan) mark_inflight(entries, w);
  for (const w of plan) resolve_entry(entries, w, value(w));
}

describe("plan_fetches — which ids to fetch, and when", () => {
  it("fetches on first sight and not again while the version holds", () => {
    const entries = new Map<string, CacheEntry<string>>();
    const wants = [{ id: "a", version: "v1" }, { id: "b", version: "" }];
    const first = plan_fetches(wants, entries, T0);
    expect(first.map((w) => w.id)).toEqual(["a", "b"]);
    settle(entries, first, (w) => `${w.id}@${w.version}`);
    expect(plan_fetches(wants, entries, T0 + 5_000)).toEqual([]);
  });

  it("re-fetches exactly the id whose version moved (updated_at / ledger_len change)", () => {
    const entries = new Map<string, CacheEntry<string>>();
    settle(entries, plan_fetches([{ id: "a", version: "v1" }, { id: "b", version: "v1" }], entries, T0), (w) => w.version);
    const plan = plan_fetches([{ id: "a", version: "v2" }, { id: "b", version: "v1" }], entries, T0 + 5_000);
    expect(plan).toEqual([{ id: "a", version: "v2" }]);
  });

  it("immutable caches (input data) never re-fetch a read id, whatever its version does", () => {
    const entries = new Map<string, CacheEntry<string>>();
    settle(entries, plan_fetches([{ id: "a", version: "" }], entries, T0, { immutable: true }), () => "prompt");
    expect(plan_fetches([{ id: "a", version: "changed" }], entries, T0 + 1, { immutable: true })).toEqual([]);
    // …while a mutable cache would have.
    expect(plan_fetches([{ id: "a", version: "changed" }], entries, T0 + 1)).toEqual([{ id: "a", version: "changed" }]);
  });

  it("never plans an id already in flight, and plans each id once", () => {
    const entries = new Map<string, CacheEntry<string>>();
    mark_inflight(entries, { id: "a", version: "v1" });
    expect(plan_fetches([{ id: "a", version: "v2" }, { id: "b", version: "" }, { id: "b", version: "" }], entries, T0)).toEqual([{ id: "b", version: "" }]);
  });

  it("a failure backs off 60 s, then doubling (no retry storm), even when its version moves", () => {
    const entries = new Map<string, CacheEntry<string>>();
    const w = { id: "a", version: "v1" };
    mark_inflight(entries, w);
    reject_entry(entries, w, new Error("HTTP 500"), T0);
    expect(entries.get("a")!.error).toBe("HTTP 500");
    expect(plan_fetches([{ id: "a", version: "v2" }], entries, T0 + 59_000)).toEqual([]);
    expect(plan_fetches([{ id: "a", version: "v2" }], entries, T0 + 60_000)).toEqual([{ id: "a", version: "v2" }]);
    mark_inflight(entries, { id: "a", version: "v2" });
    reject_entry(entries, { id: "a", version: "v2" }, "again", T0 + 60_000);
    expect(plan_fetches([w], entries, T0 + 60_000 + 119_000)).toEqual([]);
    expect(plan_fetches([w], entries, T0 + 60_000 + 120_000)).toEqual([w]);
    expect(retry_after_ms(1)).toBe(RETRY_BASE_MS);
    expect(retry_after_ms(30)).toBe(RETRY_MAX_MS);
    // A success resets the count.
    resolve_entry(entries, w, "ok");
    expect(entries.get("a")!.failures).toBe(0);
  });
});

describe("select_values / pending_count", () => {
  it("current_only drops a value read at an older version (a stale wait detail never re-classifies a new wait)", () => {
    const entries = new Map<string, CacheEntry<string>>();
    settle(entries, [{ id: "a", version: "t1" }], () => "detail@t1");
    expect(select_values([{ id: "a", version: "t1" }], entries, { current_only: true }).get("a")).toBe("detail@t1");
    expect(select_values([{ id: "a", version: "t2" }], entries, { current_only: true }).has("a")).toBe(false);
    // Without current_only the last value rides until the fresh one lands.
    expect(select_values([{ id: "a", version: "t2" }], entries).get("a")).toBe("detail@t1");
  });

  it("counts the wanted ids still in flight", () => {
    const entries = new Map<string, CacheEntry<string>>();
    mark_inflight(entries, { id: "a", version: "" });
    mark_inflight(entries, { id: "z", version: "" });
    settle(entries, [{ id: "b", version: "" }], () => "x");
    expect(pending_count([{ id: "a", version: "" }, { id: "b", version: "" }], entries)).toBe(1);
  });
});

describe("what each cache wants", () => {
  it("automation briefs: every automation_id once; the controller row's updated_at is the version", () => {
    const occ = row({ run_id: "o5", role: "occurrence", automation_id: "A" });
    const ctl = row({ run_id: "A", role: "controller", automation_id: "A", status: "waiting", updated_at: "2026-10-14T00:03:00Z" });
    expect(automation_wants([occ])).toEqual([{ id: "A", version: "" }]);
    expect(automation_wants([occ, ctl, row({ run_id: "plain" })])).toEqual([{ id: "A", version: "2026-10-14T00:03:00Z" }]);
    expect(automation_wants([ctl, occ])).toEqual([{ id: "A", version: "2026-10-14T00:03:00Z" }]);
    // First sight → one fetch; the next poll with the same controller → none;
    // the controller moved (an occurrence fired/finished) → exactly one re-read.
    const entries = new Map<string, CacheEntry<string>>();
    settle(entries, plan_fetches(automation_wants([occ, ctl]), entries, T0), () => "brief");
    expect(plan_fetches(automation_wants([occ, ctl]), entries, T0 + 5_000)).toEqual([]);
    const moved = { ...ctl, updated_at: "2026-10-14T00:09:00Z" };
    expect(plan_fetches(automation_wants([occ, moved]), entries, T0 + 10_000)).toEqual([{ id: "A", version: "2026-10-14T00:09:00Z" }]);
  });

  it("run briefs: plain runs only (never an automation's occurrence, child or controller)", () => {
    const rows = [
      row({ run_id: "p", session_id: "s" }),
      row({ run_id: "o", role: "occurrence", automation_id: "A" }),
      row({ run_id: "d", role: "descendant" }),
      row({ run_id: "c", role: "controller" }),
      row({ run_id: "k", session_kind: "automation" }),
    ];
    expect(run_brief_wants(rows)).toEqual([{ id: "p", version: "" }]);
    expect(is_plain_run(rows[0])).toBe(true);
    expect(is_plain_run(rows[1])).toBe(false);
  });

  it("pulses: running rows older than PULSE_MIN_AGE_MS; the version is ledger_len ALONE (append-only ledger); the window is the LAST record", () => {
    const now = Date.parse("2026-10-13T23:50:00Z");
    const old = new Date(now - 120_000).toISOString();
    const fresh = new Date(now - 20_000).toISOString();
    const rows = [
      row({ run_id: "r1", ledger_len: 12, updated_at: old }),
      row({ run_id: "r2", ledger_len: null, updated_at: old }),
      row({ run_id: "w", status: "waiting", ledger_len: 3, updated_at: old }),
      row({ run_id: "r0", ledger_len: 0, updated_at: old }),
      row({ run_id: "young", ledger_len: 4, updated_at: fresh }),
    ];
    expect(pulse_wants(rows, now)).toEqual([{ id: "r1", version: "12" }]);
    // A run that progressed in the last minute shows a fresh age and needs no ledger read.
    expect(pulse_wants(rows, now, 10_000).map((w) => w.id)).toEqual(["r1", "young"]);
    expect(PULSE_MIN_AGE_MS).toBe(60_000);
    // The same ledger length means the same last record: no re-read when only updated_at moved.
    expect(pulse_wants([row({ run_id: "r1", ledger_len: 12, updated_at: new Date(now - 300_000).toISOString() })], now)).toEqual([{ id: "r1", version: "12" }]);
    expect(pulse_window(12)).toEqual({ after: 11, limit: 1 });
    expect(pulse_window(1)).toEqual({ after: 0, limit: 1 });
    expect(WAIT_DETAILS_CURRENT_ONLY).toBe(true);
  });

  it("wait details: reason=user waits only, one per run_id:updated_at", () => {
    const rows = [
      row({ run_id: "u", status: "waiting", waiting: { reason: "user" }, updated_at: "t1" }),
      row({ run_id: "s", status: "waiting", waiting: { reason: "subworkflow" } }),
      row({ run_id: "legacy", status: "waiting", waiting_reason: "user", updated_at: "t2" }),
      row({ run_id: "r", status: "running", waiting: { reason: "user" } }),
    ];
    expect(wait_detail_wants(rows)).toEqual([{ id: "u", version: "t1" }, { id: "legacy", version: "t2" }]);
  });

  it("the excerpt is input_data.prompt only when the flow declares a prompt pin — no other guessing", () => {
    expect(excerpt_of_input_data("r", { pin_ids: ["prompt", "tools"], input_data: { prompt: "  Summarise the inbox  " } })).toEqual({ run_id: "r", excerpt: "Summarise the inbox" });
    expect(excerpt_of_input_data("r", { pin_ids: ["task"], input_data: { prompt: "x", task: "y" } }).excerpt).toBe("");
    expect(excerpt_of_input_data("r", { pin_ids: ["prompt"], input_data: { prompt: { text: "x" } } }).excerpt).toBe("");
    expect(excerpt_of_input_data("r", null).excerpt).toBe("");
  });

  it("an automation record carries the revision a rename must name", () => {
    const rec = fold_automation_record({ active_revision: 3, summary: { automation_id: "A", title: "T", capabilities: ["revise"] }, definition: { revision: 3 } })!;
    expect(rec.brief.title).toBe("T");
    expect(rec.revision).toBe(3);
    expect(fold_automation_record({ summary: { automation_id: "A" }, definition: { revision: 2 } })!.revision).toBe(2);
    expect(fold_automation_record({})).toBeNull();
  });
});

describe("FetchPool — bounded concurrency across the four caches", () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("never runs more than POOL_LIMIT (4: the tick keeps 2 of the browser's 6 slots) at once, drains everything, and a failure does not stall the pump", async () => {
    const pool = new FetchPool();
    expect(pool.limit).toBe(POOL_LIMIT);
    expect(POOL_LIMIT).toBe(4);
    const gates = Array.from({ length: 7 }, deferred);
    const done: number[] = [];
    gates.forEach((g, i) => pool.submit(1, async () => {
      await g.promise;
      done.push(i);
    }));
    await flush();
    expect(pool.active).toBe(4);
    expect(pool.queued).toBe(3);
    gates[0].reject(new Error("boom"));
    for (let i = 1; i < 7; i++) gates[i].resolve();
    for (let k = 0; k < 10 && (pool.active || pool.queued); k++) await flush();
    expect(pool.active).toBe(0);
    expect(pool.peak).toBe(4);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("serves the lower priority number first (titles before excerpts)", async () => {
    const pool = new FetchPool(1);
    const order: string[] = [];
    const gate = deferred();
    pool.submit(0, () => gate.promise);
    pool.submit(2, async () => void order.push("excerpt"));
    pool.submit(1, async () => void order.push("detail"));
    pool.submit(0, async () => void order.push("automation"));
    gate.resolve();
    for (let k = 0; k < 10 && (pool.active || pool.queued); k++) await flush();
    expect(order).toEqual(["automation", "detail", "excerpt"]);
  });

  it("one pool per gateway client", () => {
    const a = {};
    const b = {};
    expect(pool_for(a)).toBe(pool_for(a));
    expect(pool_for(a)).not.toBe(pool_for(b));
  });
});

describe("RunsPoll — the 5 s active poll and the 60 s sweep", () => {
  it("sweeps on the first poll, then every 60 s; never while one is in flight; force ≥10 s; early ≥15 s after a run leaves", () => {
    const p = new RunsPoll(1);
    expect(p.sweep_due(T0)).toBe(true);
    p.begin_sweep(T0);
    expect(p.sweep_due(T0 + SWEEP_EVERY_MS)).toBe(false); // in flight
    p.apply_sweep([], T0 + 2_000);
    expect(p.sweep_due(T0 + 30_000)).toBe(false);
    expect(p.sweep_due(T0 + SWEEP_FORCE_FLOOR_MS - 1, true)).toBe(false);
    expect(p.sweep_due(T0 + SWEEP_FORCE_FLOOR_MS, true)).toBe(true);
    expect(p.sweep_due(T0 + SWEEP_EVERY_MS)).toBe(true);
    // A run leaves the (complete) active listings → it is terminal now → sweep early.
    p.apply_active([row({ run_id: "r1" })], [], true);
    p.apply_active([], [], true);
    expect(p.sweep_due(T0 + SWEEP_EARLY_FLOOR_MS - 1)).toBe(false);
    expect(p.sweep_due(T0 + SWEEP_EARLY_FLOOR_MS)).toBe(true);
    // An INCOMPLETE listing proves nothing about absence.
    const q = new RunsPoll(1);
    q.begin_sweep(T0);
    q.apply_sweep([], T0);
    q.apply_active([row({ run_id: "r1" })], [], false);
    q.apply_active([], [], false);
    expect(q.sweep_due(T0 + SWEEP_EARLY_FLOOR_MS)).toBe(false);
    // A failed sweep waits for the normal cadence.
    q.begin_sweep(T0 + 100_000);
    q.fail_sweep();
    expect(q.sweep_due(T0 + 100_000 + 30_000)).toBe(false);
    expect(q.sweep_due(T0 + 100_000 + SWEEP_EVERY_MS)).toBe(true);
  });

  it("active rows win; the sweep only decorates them with metrics (never status/waiting)", () => {
    const fresh = row({ run_id: "r", status: "waiting", waiting: { reason: "user" }, tokens_total: null, tool_calls: null, llm_calls: null });
    const stale = row({ run_id: "r", status: "running", waiting: null, tokens_total: 54_205, tool_calls: 14, llm_calls: 9 });
    const merged = merge_run_row(fresh, stale);
    expect(merged.status).toBe("waiting");
    expect(merged.waiting).toEqual({ reason: "user" });
    expect(merged).toMatchObject({ tokens_total: 54_205, tool_calls: 14, llm_calls: 9 });
    expect(merge_run_row({ ...fresh, tokens_total: 7 }, stale).tokens_total).toBe(7);

    const p = new RunsPoll(1);
    p.apply_active([], [fresh], true);
    p.apply_sweep([stale], T0);
    const v = p.view();
    expect(v.all.filter((r) => r.run_id === "r")).toHaveLength(1);
    expect(v.all[0]).toMatchObject({ status: "waiting", tokens_total: 54_205 });
    expect(v.roots[0]).toMatchObject({ status: "waiting" });
  });

  it("a sweep copy still reading active but absent from COMPLETE listings leaves `all` (the board), stays in `roots` (the navigator)", () => {
    const p = new RunsPoll(1);
    p.apply_sweep([row({ run_id: "gone", status: "running" }), row({ run_id: "ok", status: "completed" })], T0);
    p.apply_active([], [], true);
    expect(p.view().all.map((r) => r.run_id)).toEqual(["ok"]);
    expect(p.view().roots.map((r) => r.run_id)).toEqual(["gone", "ok"]);
    // A truncated listing cannot prove the run left: it stays.
    p.apply_active([], [], false);
    expect(p.view().all.map((r) => r.run_id)).toEqual(["gone", "ok"]);
  });

  it("roots are today's listing roots (parent-less + occurrences); all keeps every depth", () => {
    const p = new RunsPoll(1);
    p.apply_active(
      [row({ run_id: "kid", parent_run_id: "occ" }), row({ run_id: "occ", parent_run_id: "ctl", role: "occurrence" })],
      [row({ run_id: "ctl", role: "controller", status: "waiting" })],
      true,
    );
    const v = p.view();
    expect(v.all.map((r) => r.run_id)).toEqual(["kid", "occ", "ctl"]);
    expect(v.roots.map((r) => r.run_id)).toEqual(["occ", "ctl"]);
  });

  it("one cache per client AND connection epoch: a sign-out never carries the previous account's rows", () => {
    const client = {};
    const a = runs_poll_for(client, 1);
    a.apply_sweep([row({ run_id: "theirs", status: "completed" })], T0);
    expect(runs_poll_for(client, 1)).toBe(a);
    const b = runs_poll_for(client, 2);
    expect(b).not.toBe(a);
    expect(b.view().all).toEqual([]);
    expect(runs_poll_peek(client)).toBe(b);
    expect(is_current_poll(b)).toBe(true);
    expect(is_current_poll(a)).toBe(false);
    expect(runs_poll_peek({})).toBeNull();
  });

  it("a second client of the same epoch (discovery client → polling client) adopts the last sweep, yet sweeps itself at once", () => {
    const discovery = {};
    const polling = {};
    const first = runs_poll_for(discovery, 7);
    first.begin_sweep(T0);
    first.apply_sweep([row({ run_id: "done1", status: "completed" })], T0 + 1_000);
    const second = runs_poll_for(polling, 7);
    expect(second).not.toBe(first);
    expect(second.sweep_at).toBe(T0 + 1_000);
    expect(second.view().all.map((r) => r.run_id)).toEqual(["done1"]);
    expect(second.sweep_due(T0 + 2_000)).toBe(true);
    // Across a sign-out (new epoch) nothing is adopted.
    expect(runs_poll_for({}, 8).view().all).toEqual([]);
  });
});

describe("session-scoped cache entries (GATE-1 finding 6)", () => {
  it("entries_for returns the same map for the same client + scope and distinct maps per scope/client", () => {
    const a = {};
    const b = {};
    const m1 = entries_for(a, "automation");
    m1.set("x", { value: 1, value_version: "v", inflight: false, failed_at: null, failures: 0 } as any);
    expect(entries_for(a, "automation")).toBe(m1);
    expect(entries_for(a, "automation").get("x")).toBeTruthy();
    expect(entries_for(a, "pulse")).not.toBe(m1);
    expect(entries_for(b, "automation")).not.toBe(m1);
  });
});

describe("run outcomes (lane E): a Done card's answer + artifact count, read once per finished run", () => {
  it("wants terminal runs only, at a constant version; immutable: a read outcome is never fetched again", () => {
    const rows = [row({ run_id: "d1", status: "completed" }), row({ run_id: "f1", status: "failed" }), row({ run_id: "live", status: "running" }), row({ run_id: "w", status: "waiting" }), row({ run_id: "" , status: "completed" })];
    expect(outcome_wants(rows)).toEqual([{ id: "d1", version: "" }, { id: "f1", version: "" }]);
    expect(OUTCOMES_IMMUTABLE).toBe(true);
    const entries = new Map<string, CacheEntry<{ answer: string; artifacts: number | null }>>();
    const first = plan_fetches(outcome_wants(rows), entries, T0, { immutable: OUTCOMES_IMMUTABLE });
    expect(first.map((w) => w.id)).toEqual(["d1", "f1"]);
    settle(entries, first, () => ({ answer: "done", artifacts: 2 }));
    // Whatever happens later (a version string moving, hours passing), a finished run is read once.
    expect(plan_fetches([{ id: "d1", version: "moved" }, { id: "f1", version: "" }], entries, T0 + 3_600_000, { immutable: OUTCOMES_IMMUTABLE })).toEqual([]);
  });

  it("is the LOWEST priority of the pool: nothing active ever waits behind an outcome", async () => {
    const others = [PRIORITY.automation, PRIORITY.wait_detail, PRIORITY.pulse, PRIORITY.run_brief];
    expect(PRIORITY.outcome).toBeGreaterThan(Math.max(...others));
    const pool = new FetchPool(1);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    pool.submit(0, () => gate);
    pool.submit(PRIORITY.outcome, async () => void order.push("outcome"));
    pool.submit(PRIORITY.run_brief, async () => void order.push("excerpt"));
    pool.submit(PRIORITY.wait_detail, async () => void order.push("detail"));
    release();
    for (let k = 0; k < 10 && (pool.active || pool.queued); k++) await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["detail", "excerpt", "outcome"]);
  });

  it("the answer is output.response when a string, else output._last_output when a string, else '' — no other guessing", () => {
    expect(answer_of_run({ output: { response: "  # Digest  ", _last_output: "x" } })).toBe("# Digest");
    expect(answer_of_run({ output: { response: { text: "not a string" }, _last_output: "the last output" } })).toBe("the last output");
    expect(answer_of_run({ output: { answer: "y", result: "z" } })).toBe("");
    expect(answer_of_run({ output: "a bare string" })).toBe("");
    expect(answer_of_run(null)).toBe("");
  });

  it("the artifact count is the listing page's `total` (live sample shape)", () => {
    // GET /runs/3e916517…/artifacts?limit=1 on 2026-10-14 (gateway 0.13.x).
    const live = { items: [{}], total: 11, offset: 0, limit: 1, has_more: true, cursor: null, next_cursor: "2026-10-14T00:17:06.361663+00:00|5191c9247198d01b136aa1a9b0bc4295", facets: {}, stats: {}, warnings: [] };
    expect(artifact_count_of(live)).toBe(11);
    expect(artifact_count_of({ items: [], total: 0 })).toBe(0);
    expect(artifact_count_of({ items: [{}, {}] })).toBeNull();
    expect(artifact_count_of({ total: "3" })).toBeNull();
    expect(artifact_count_of(null)).toBeNull();
  });

  it("one read = GET /runs/{id} + the artifact listing at limit 1; a failing detail fails the read (backoff), a failing listing leaves the count unknown", async () => {
    const calls: any[] = [];
    const client = {
      get_run: async (id: string) => (calls.push(["get_run", id]), { output: { response: "the answer" } }),
      list_run_artifacts: async (id: string, opts?: any) => (calls.push(["artifacts", id, opts]), { items: [], total: 3 }),
    };
    expect(await load_outcome(client, "d1")).toEqual({ answer: "the answer", artifacts: 3 });
    expect(calls).toEqual([["get_run", "d1"], ["artifacts", "d1", { limit: 1 }]]);
    expect(await load_outcome({ ...client, list_run_artifacts: async () => { throw new Error("404"); } }, "d1")).toEqual({ answer: "the answer", artifacts: null });
    await expect(load_outcome({ ...client, get_run: async () => { throw new Error("HTTP 500"); } }, "d1")).rejects.toThrow("HTTP 500");
  });
});

describe("automation facts (lane E): what the (i) reads from the raw record beyond the brief", () => {
  it("the record keeps the raw body; trigger source, stop after / at, target workflow and retry fold from it", () => {
    const body = {
      active_revision: 2,
      summary: { automation_id: "A", title: "T", trigger: { source_id: "schedule", config: { every: "24h", count: 30, until: "2026-12-31T00:00:00Z" } } },
      definition: { target: { workflow_id: "basic-agent@0.0.5:81795ea9" }, policy: { retry: { max_attempts: 3, backoff: { initial: "30s", factor: 2, max: "10m" } } } },
    };
    const rec = fold_automation_record(body)!;
    expect(rec.raw).toBe(body);
    expect(automation_facts(rec.raw)).toEqual({
      trigger_source: "schedule",
      stop_after: 30,
      stop_at_ms: Date.parse("2026-12-31T00:00:00Z"),
      workflow_id: "basic-agent@0.0.5:81795ea9",
      retry: { max_attempts: 3, initial: "30s", factor: 2, max: "10m" },
    });
    // Absent on the wire = null / "", never a default.
    expect(automation_facts({ summary: { automation_id: "A" }, definition: { trigger: { source_id: "email_received", config: {} } } })).toEqual({ trigger_source: "email_received", stop_after: null, stop_at_ms: null, workflow_id: "", retry: null });
    expect(automation_facts(null)).toEqual({ trigger_source: "", stop_after: null, stop_at_ms: null, workflow_id: "", retry: null });
  });
});

describe("loading ids (the card's inline skeleton)", () => {
  it("an unplanned, queued or in-flight want is loading; a read one is not; a failed one backing off is not; a stale current_only value is", () => {
    const entries = new Map<string, CacheEntry<string>>();
    const wants = [{ id: "a", version: "v1" }, { id: "b", version: "v1" }, { id: "c", version: "v1" }, { id: "d", version: "v2" }];
    expect([...loading_ids(wants, entries)]).toEqual(["a", "b", "c", "d"]);
    mark_inflight(entries, wants[0]);
    resolve_entry(entries, wants[1], "ok");
    mark_inflight(entries, wants[2]);
    reject_entry(entries, wants[2], new Error("x"), T0);
    resolve_entry(entries, { id: "d", version: "v1" }, "old");
    expect([...loading_ids(wants, entries)]).toEqual(["a"]);
    expect([...loading_ids(wants, entries, { current_only: true })]).toEqual(["a", "d"]);
  });
});

describe("the viewport bound (operator 2026-10-15: 114 loading for 57 cards)", () => {
  // The screenshot's board: 57 Needs-you chat runs (reason=user waits), 3 scheduled
  // automations, 9 finished runs (8 shown).
  const needs = Array.from({ length: 57 }, (_, i) => row({ run_id: `n${i}`, status: "waiting", waiting: { reason: "user" }, session_id: `acode-${i}` }));
  const scheduled = Array.from({ length: 3 }, (_, i) => row({ run_id: `auto${i}`, role: "controller", session_kind: "automation", automation_id: `auto${i}`, status: "waiting", waiting: { reason: "event" } } as any));
  const done = Array.from({ length: 9 }, (_, i) => row({ run_id: `d${i}`, status: "completed", session_id: `acode-d${i}` }));
  const done_shown = done.slice(0, 8);
  const lane_rows = [needs, [], [], scheduled, done_shown];
  const plan_for = (visible: Set<string> | null) =>
    board_fetch_plan({ all_rows: [...needs, ...scheduled, ...done], active_rows: [...needs, ...scheduled], lane_rows, done_rows: done_shown, visible, now_ms: T0 });

  it("rows_in_viewport: the visible set when there is an observer, the first N per lane without one; each row once, lane order kept", () => {
    expect(VISIBLE_FALLBACK_PER_LANE).toBe(12);
    const fallback = rows_in_viewport(lane_rows, null);
    expect(fallback.map((r) => r.run_id)).toEqual([...needs.slice(0, 12).map((r) => r.run_id), "auto0", "auto1", "auto2", ...done_shown.map((r) => r.run_id)]);
    const seen = rows_in_viewport(lane_rows, new Set(["n3", "n40", "d7", "nope"]));
    expect(seen.map((r) => r.run_id)).toEqual(["n3", "n40", "d7"]);
    expect(rows_in_viewport([needs.slice(0, 3), done_shown], null, 2).map((r) => r.run_id)).toEqual(["n0", "n1", "d0", "d1"]);
    expect(rows_in_viewport(lane_rows, new Set())).toEqual([]);
  });

  it("before: every card's details at once = 141 requests on an empty cache; after: 51 on first paint (first N per lane), 24 when 6 cards are in view", () => {
    // BEFORE (every want unbounded): 3 briefs + 57 wait details + 65 run briefs (57 + 8 Done) + 8 outcomes × 2 (run + artifacts) = 141.
    const before = plan_for(new Set([...needs, ...scheduled, ...done].map((r) => r.run_id)));
    expect({ automations: 3, wait_details: 57, run_briefs: 65, outcomes: 8, pulses: 0 }).toEqual({
      automations: before.automations.length,
      wait_details: before.wait_details.length,
      run_briefs: before.run_briefs.length,
      outcomes: before.outcomes.length,
      pulses: before.pulses.length,
    });
    expect(plan_request_count(before)).toBe(141);
    // AFTER, no observer (tests / static render): the first 12 Needs-you cards + the 8 Done cards.
    const fallback = plan_for(null);
    expect(plan_request_count(fallback)).toBe(3 + 12 + (12 + 8) + 2 * 8);
    expect(plan_request_count(fallback)).toBe(51);
    // AFTER, with the observer reporting 6 Needs-you cards and 3 Done cards in view.
    const seen = plan_for(new Set(["n0", "n1", "n2", "n3", "n4", "n5", "d0", "d1", "d2"]));
    expect(plan_request_count(seen)).toBe(3 + 6 + (6 + 3) + 2 * 3);
    expect(plan_request_count(seen)).toBe(24);
    // Briefs and pulses are global (they title and order cards off screen too).
    expect(seen.automations.map((w) => w.id)).toEqual(["auto0", "auto1", "auto2"]);
  });

  it("a warm reload: the persisted briefs and outcomes are read, not fetched (24 → 6 for the same view)", () => {
    const seen = plan_for(new Set(["n0", "n1", "n2", "n3", "n4", "n5", "d0", "d1", "d2"]));
    const excerpts = new Map<string, CacheEntry<unknown>>();
    const outcomes = new Map<string, CacheEntry<unknown>>();
    settle(excerpts, seen.run_briefs, (w) => ({ run_id: w.id, excerpt: "task" }));
    settle(outcomes, seen.outcomes, () => ({ answer: "done", artifacts: 0 }));
    const storage = fake_storage();
    write_persisted(storage, "excerpt", excerpts);
    write_persisted(storage, "outcome", outcomes);
    // A fresh session: the entries come back from the store at their version, so the planner skips them.
    const briefs_plan = plan_fetches(seen.run_briefs, read_persisted(storage, "excerpt"), T0, { immutable: true });
    const outcomes_plan = plan_fetches(seen.outcomes, read_persisted(storage, "outcome"), T0, { immutable: true });
    expect(briefs_plan).toEqual([]);
    expect(outcomes_plan).toEqual([]);
    const warm = plan_request_count({ ...seen, run_briefs: briefs_plan, outcomes: outcomes_plan });
    expect(warm).toBe(3 + 6);
    expect(warm).toBe(9);
    // (Wait details are versioned by the row's updated_at and are not persisted: 6 of the 9 remain.)
  });
});

function fake_storage(opts?: { throw_on_set?: boolean }): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (opts?.throw_on_set) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

describe("the session store (immutable scopes mirrored to sessionStorage, keyed by id@version)", () => {
  it("the two persisted scopes are the immutable ones", () => {
    expect([...PERSISTED_SCOPES]).toEqual(["excerpt", "outcome"]);
  });

  it("round trip: read entries come back at their version with has_value; in-flight and failed entries are never written", () => {
    const entries = new Map<string, CacheEntry<unknown>>();
    resolve_entry(entries, { id: "a", version: "" }, { answer: "A", artifacts: 1 });
    resolve_entry(entries, { id: "b", version: "v2" }, { answer: "B", artifacts: null });
    mark_inflight(entries, { id: "c", version: "" });
    mark_inflight(entries, { id: "d", version: "" });
    reject_entry(entries, { id: "d", version: "" }, new Error("x"), T0);
    const storage = fake_storage();
    write_persisted(storage, "outcome", entries);
    expect([...storage.data.keys()]).toEqual([`${PERSIST_KEY_PREFIX}outcome`]);
    const back = read_persisted<{ answer: string }>(storage, "outcome");
    expect([...back.keys()]).toEqual(["a", "b"]);
    expect(back.get("a")).toEqual({ ...empty_entry(), value: { answer: "A", artifacts: 1 }, has_value: true, value_version: "" });
    expect(back.get("b")!.value_version).toBe("v2");
    // A version that moved is re-planned; a matching one is not.
    expect(plan_fetches([{ id: "b", version: "v3" }], back, T0)).toEqual([{ id: "b", version: "v3" }]);
    expect(plan_fetches([{ id: "b", version: "v2" }], back, T0)).toEqual([]);
  });

  it("is capped: the newest PERSIST_MAX_ENTRIES survive, and the blob shrinks until it fits PERSIST_MAX_CHARS", () => {
    const entries = new Map<string, CacheEntry<unknown>>();
    for (let i = 0; i < PERSIST_MAX_ENTRIES + 25; i++) resolve_entry(entries, { id: `r${i}`, version: "" }, { run_id: `r${i}`, excerpt: "x" });
    const storage = fake_storage();
    write_persisted(storage, "excerpt", entries);
    const back = read_persisted(storage, "excerpt");
    expect(back.size).toBe(PERSIST_MAX_ENTRIES);
    expect(back.has("r24")).toBe(false);
    expect(back.has("r25")).toBe(true);
    const big = new Map<string, CacheEntry<unknown>>();
    for (let i = 0; i < 40; i++) resolve_entry(big, { id: `b${i}`, version: "" }, { run_id: `b${i}`, excerpt: "y".repeat(50_000) });
    write_persisted(storage, "excerpt", big);
    expect(storage.data.get(`${PERSIST_KEY_PREFIX}excerpt`)!.length).toBeLessThanOrEqual(PERSIST_MAX_CHARS);
    expect(read_persisted(storage, "excerpt").size).toBeLessThan(40);
    expect(read_persisted(storage, "excerpt").size).toBeGreaterThan(0);
  });

  it("never throws: a missing storage, a throwing setItem, and an unreadable blob all leave the memory cache the truth", () => {
    const entries = new Map<string, CacheEntry<unknown>>();
    resolve_entry(entries, { id: "a", version: "" }, { answer: "A", artifacts: 0 });
    expect(() => write_persisted(null, "outcome", entries)).not.toThrow();
    expect(() => write_persisted(fake_storage({ throw_on_set: true }), "outcome", entries)).not.toThrow();
    expect(read_persisted(null, "outcome").size).toBe(0);
    const broken = fake_storage();
    broken.data.set(`${PERSIST_KEY_PREFIX}outcome`, "{not json");
    expect(read_persisted(broken, "outcome").size).toBe(0);
    broken.data.set(`${PERSIST_KEY_PREFIX}outcome`, JSON.stringify([{ id: "", value: 1 }, { id: "x", value: null }, { id: "y", version: "", value: { answer: "Y" } }]));
    expect([...read_persisted(broken, "outcome").keys()]).toEqual(["y"]);
    // An empty scope removes its key.
    const storage = fake_storage();
    write_persisted(storage, "outcome", entries);
    write_persisted(storage, "outcome", new Map());
    expect(storage.data.size).toBe(0);
  });
});
