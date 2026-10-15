/**
 * NODE FACTS — what one workflow node did in a run, folded from the ledger
 * (operator 2026-10-14 11:15: "on mouse over of each of these nodes we could
 * actually see / copy to clipboard the state of the agent / context / results
 * / tool calls … useful for both human and AI").
 *
 * Pure functions, no React. The Flow tab (flow_graph.tsx) renders them on
 * hover/focus and copies them; an AI reader gets the same facts as JSON.
 *
 * Rules:
 * - Steps come from `build_run_steps` (one step per STARTED+terminal pair,
 *   `$slim` resolved) and their bodies from `llm_detail` / `tool_detail`: this
 *   module never re-parses what run_steps.ts already parses.
 * - A node's STATUS is its LAST step's record status, in AbstractFlow's run
 *   vocabulary (NodeStatusGlyph.tsx): started/running → running, waiting →
 *   waiting, failed → failed, completed → done. One exception, the state
 *   line's "one truth per run" rule: a node parked on its OWN subrun
 *   (`reason: subworkflow`) is running while that subrun is running.
 * - Records are keyed by the GRAPH id `graph_node_id_for(run_id, node_id)`
 *   gives (subrun nodes live under their parent node's `prefix::`). A subrun
 *   whose records map to a bare node id is not placed on the graph (its
 *   prefix is not registered yet) and is skipped: its `node-1` is not the
 *   root's `node-1`.
 * - No truncation (ADR-0026, the pins' rule): the result summary lists EVERY
 *   key; short values inline, long ones as their size — the full value sits
 *   behind "show all" in the panel and in "Copy facts".
 */
import type { StepRecord } from "../lib/types";
import { parse_iso_ms } from "./format";
import { build_run_steps, llm_detail, subflow_child_id, tool_detail, type ChatMessage, type LedgerItem, type RunStep } from "./run_steps";

export type NodeRunStatus = "running" | "waiting" | "failed" | "done";

export type NodeWait = { reason: string; wait_key: string; prompt?: string; /** The node is parked on this wait now. */ open: boolean };

export type NodeLlm = {
  calls: number;
  /** Model / provider of the node's LAST call. */
  model: string;
  provider: string;
  /** Summed usage over the calls that report it; absent when none do. */
  tokens?: { in: number; out: number; total: number };
};

/** The exact conversation of the node's last LLM call (`llm_detail`), for "Copy context". */
export type NodeContext = {
  provider: string;
  model: string;
  /** "sent" = the provider request as sent; "payload" = the runtime's effect payload. */
  messages_source: "sent" | "payload" | "";
  messages: ChatMessage[];
};

export type NodeFacts = {
  /** The node id inside its own workflow. */
  node_id: string;
  /** The id on the graph (`prefix::node_id` for subrun nodes). */
  graph_id: string;
  /** The runs whose records landed on this node (root and/or subruns), first seen first. */
  run_ids: string[];
  status: NodeRunStatus;
  /** Steps executed at this node. */
  visits: number;
  first_ms: number | null;
  last_ms: number | null;
  /** Sum of the steps' durations (open steps count 0). */
  duration_ms: number;
  last_effect: string;
  last_status: string;
  llm: NodeLlm | null;
  tools: Array<{ name: string; calls: number; failed: number }>;
  waits: NodeWait[];
  /** Subruns this node spawned (`sub_run_id`s). */
  subruns: string[];
  /** `{key: value, …}` of the latest step result — every key, never clipped. */
  last_result_summary: string;
  /** The latest step result, complete (behind "show all"). `undefined` = no step carried one. */
  last_result: unknown;
  last_error: string;
  /** The last LLM call's conversation; null when the node made none or its messages are not in the ledger. */
  context: NodeContext | null;
  /** The node's ledger records as recorded, newest last. */
  records: StepRecord[];
};

// --- value summary (no truncation) ---------------------------------------------

/** A value is shown inline when its compact JSON is at most this long; longer values show their size. */
export const INLINE_VALUE_CHARS = 60;

function compact_json(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** One value as the summary shows it: inline when short, else its shape and size. */
export function value_brief(v: unknown): string {
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    if (v.length <= INLINE_VALUE_CHARS && !v.includes("\n")) return JSON.stringify(v);
    return `text (${plural(v.length, "char", "chars")})`;
  }
  if (v === null || typeof v !== "object") return compact_json(v);
  const inline = compact_json(v);
  if (inline.length <= INLINE_VALUE_CHARS) return inline;
  if (Array.isArray(v)) return `list (${plural(v.length, "item", "items")})`;
  return `object (${plural(Object.keys(v as object).length, "key", "keys")})`;
}

/** True when the summary shows some value by its size only, so the panel offers the complete value. */
export function result_needs_show_all(v: unknown): boolean {
  if (v === undefined) return false;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.values(v as Record<string, unknown>).some((x) => value_brief(x) !== compact_json(x));
  }
  return value_brief(v) !== compact_json(v);
}

/** `{key: brief, …}` with EVERY top-level key (an object), or the value's brief (anything else). "" = no result. */
export function summarize_result(v: unknown): string {
  if (v === undefined) return "";
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v as object);
    if (!keys.length) return "{}";
    return `{${keys.map((k) => `${k}: ${value_brief((v as Record<string, unknown>)[k])}`).join(", ")}}`;
  }
  return value_brief(v);
}

// --- the fold ------------------------------------------------------------------

function ms(ts: unknown): number | null {
  return parse_iso_ms(ts);
}

function text_of_error(err: unknown): string {
  if (err === null || err === undefined || err === "") return "";
  if (typeof err === "string") return err;
  return compact_json(err);
}

function last_of(steps: RunStep[]): RunStep | null {
  return steps.length ? steps[steps.length - 1] : null;
}

/** The status one step gives its node; `child_status` reads a subrun's live status. */
function step_status(step: RunStep, child_status: (sub_run_id: string) => NodeRunStatus | null): NodeRunStatus {
  const st = String(step.status || "").trim().toLowerCase();
  if (st === "started" || st === "running") return "running";
  if (st === "waiting") {
    const wait = step.record?.result?.wait;
    if (String(wait?.reason || "") === "subworkflow") {
      const child = subflow_child_id(step.record);
      if (child && child_status(child) === "running") return "running";
    }
    return "waiting";
  }
  if (st === "failed") return "failed";
  if (st === "completed") return "done";
  // A status the runtime vocabulary does not list: closed when it carries an end time, open otherwise.
  return step.ended_at ? "done" : "running";
}

type Placed = { rid: string; t: number | null; seq: number };

type Acc = {
  facts: NodeFacts;
  steps: Array<Placed & { step: RunStep }>;
  records: Array<Placed & { rec: StepRecord }>;
};

/**
 * Oldest first: ledger order within one run (the truth there), merged across
 * runs by time (two subruns of one node). A k-way merge, so a run's own order
 * is never reshuffled by its timestamps; an untimed head goes first.
 */
function earlier(a: Placed, b: Placed): boolean {
  if (a.t === null || b.t === null) return a.t === null && (b.t !== null || a.seq < b.seq);
  return a.t < b.t || (a.t === b.t && a.seq < b.seq);
}

function oldest_first<T extends Placed>(list: T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const x of [...list].sort((a, b) => a.seq - b.seq)) {
    const q = queues.get(x.rid) || [];
    q.push(x);
    queues.set(x.rid, q);
  }
  const heads = Array.from(queues.values());
  const out: T[] = [];
  while (heads.some((q) => q.length)) {
    let pick: T[] | null = null;
    for (const q of heads) {
      if (!q.length) continue;
      if (!pick) {
        pick = q;
        continue;
      }
      if (earlier(q[0], pick[0])) pick = q;
    }
    out.push(pick!.shift()!);
  }
  return out;
}

function step_time(s: RunStep): number | null {
  return ms(s.ended_at) ?? ms(s.started_at);
}

/**
 * Fold a run's ledger (root + subrun records, as the Observer holds them)
 * into facts per GRAPH node id. `run_id` is the root run of the graph.
 */
export function fold_node_facts(
  items: LedgerItem[],
  run_id: string,
  graph_node_id_for: (rid: string, node_id: string) => string,
): Record<string, NodeFacts> {
  const root = String(run_id || "").trim();
  if (!root) return {};
  const run_ids: string[] = [];
  const seen_runs = new Set<string>();
  for (const it of items || []) {
    const rid = String(it?.run_id || it?.record?.run_id || "").trim();
    if (rid && !seen_runs.has(rid)) {
      seen_runs.add(rid);
      run_ids.push(rid);
    }
  }
  // Root first: its steps take the lower sequence numbers.
  run_ids.sort((a, b) => (a === root ? -1 : b === root ? 1 : 0));

  const steps_by_run = new Map<string, RunStep[]>();
  for (const rid of run_ids) steps_by_run.set(rid, build_run_steps(items, rid));

  const placed = (rid: string, node_id: string): string => {
    const gid = String(graph_node_id_for(rid, node_id) || "").trim();
    if (!gid) return "";
    if (rid !== root && gid === node_id) return "";
    return gid;
  };

  const child_cache = new Map<string, NodeRunStatus | null>();
  const child_status = (sub: string, depth = 0): NodeRunStatus | null => {
    if (child_cache.has(sub)) return child_cache.get(sub) ?? null;
    child_cache.set(sub, null); // cycle guard
    const last = depth < 6 ? last_of(steps_by_run.get(sub) || []) : null;
    const out = last ? step_status(last, (s) => child_status(s, depth + 1)) : null;
    child_cache.set(sub, out);
    return out;
  };

  const acc = new Map<string, Acc>();
  const get = (gid: string, node_id: string): Acc => {
    let a = acc.get(gid);
    if (!a) {
      a = {
        facts: {
          node_id,
          graph_id: gid,
          run_ids: [],
          status: "done",
          visits: 0,
          first_ms: null,
          last_ms: null,
          duration_ms: 0,
          last_effect: "",
          last_status: "",
          llm: null,
          tools: [],
          waits: [],
          subruns: [],
          last_result_summary: "",
          last_result: undefined,
          last_error: "",
          context: null,
          records: [],
        },
        steps: [],
        records: [],
      };
      acc.set(gid, a);
    }
    return a;
  };

  let seq = 0;
  for (const rid of run_ids) {
    for (const step of steps_by_run.get(rid) || []) {
      const nid = String(step.node_id || "").trim();
      if (!nid) continue;
      const gid = placed(rid, nid);
      if (!gid) continue;
      const a = get(gid, nid);
      a.steps.push({ step, rid, t: step_time(step), seq: seq++ });
      if (!a.facts.run_ids.includes(rid)) a.facts.run_ids.push(rid);
    }
  }
  // The raw records, as recorded, for "Copy records" and the wait/subrun history.
  const mine = (items || [])
    .filter((x) => x && x.record)
    .map((x, i) => ({ x, i }))
    .sort((p, q) => {
      const ra = run_ids.indexOf(String(p.x.run_id || p.x.record.run_id || "").trim());
      const rb = run_ids.indexOf(String(q.x.run_id || q.x.record.run_id || "").trim());
      return ra !== rb ? ra - rb : (p.x.cursor || 0) - (q.x.cursor || 0) || p.i - q.i;
    });
  seq = 0;
  for (const { x } of mine) {
    const rid = String(x.run_id || x.record.run_id || "").trim();
    const nid = String(x.record.node_id || "").trim();
    if (!rid || !nid) continue;
    const gid = placed(rid, nid);
    const a = gid ? acc.get(gid) : undefined;
    if (!a) continue;
    a.records.push({ rec: x.record as StepRecord, rid, t: ms(x.record.ended_at) ?? ms(x.record.started_at), seq: seq++ });
  }

  const out: Record<string, NodeFacts> = {};
  for (const [gid, a] of acc) {
    const f = a.facts;
    // Newest last: ledger order within a run, time across runs.
    const steps = oldest_first(a.steps).map((s) => s.step);
    const last = last_of(steps)!;
    f.visits = steps.length;
    f.status = step_status(last, (s) => child_status(s));
    f.last_effect = last.effect_type;
    f.last_status = last.status;

    let tok_in = 0, tok_out = 0, tok_total = 0, has_tokens = false, llm_calls = 0;
    let last_llm: RunStep | null = null;
    const tools = new Map<string, { name: string; calls: number; failed: number }>();
    for (const s of steps) {
      const a0 = ms(s.started_at);
      const b0 = ms(s.ended_at) ?? a0;
      if (a0 !== null) f.first_ms = f.first_ms === null ? a0 : Math.min(f.first_ms, a0);
      if (b0 !== null) f.last_ms = f.last_ms === null ? b0 : Math.max(f.last_ms, b0);
      if (typeof s.duration_ms === "number") f.duration_ms += s.duration_ms;
      if (s.kind === "llm_call") {
        llm_calls += 1;
        last_llm = s;
        const u = s.record?.result?.usage || s.record?.result?.token_usage || null;
        if (u && typeof u === "object") {
          const i = Number(u.prompt_tokens ?? u.input_tokens);
          const o = Number(u.completion_tokens ?? u.output_tokens);
          const t = Number(u.total_tokens);
          if (Number.isFinite(i) || Number.isFinite(o) || Number.isFinite(t)) {
            has_tokens = true;
            tok_in += Number.isFinite(i) ? i : 0;
            tok_out += Number.isFinite(o) ? o : 0;
            tok_total += Number.isFinite(t) ? t : (Number.isFinite(i) ? i : 0) + (Number.isFinite(o) ? o : 0);
          }
        }
      } else if (s.kind === "tool") {
        const d = tool_detail(s);
        const names = d.calls.length ? d.calls.map((c) => c.name) : d.results.map((r) => r.name);
        for (const n of names) {
          const row = tools.get(n) || { name: n, calls: 0, failed: 0 };
          row.calls += 1;
          tools.set(n, row);
        }
        for (const r of d.results) {
          if (r.success !== false) continue;
          const row = tools.get(r.name) || { name: r.name, calls: 0, failed: 0 };
          row.failed += 1;
          tools.set(r.name, row);
        }
      }
      const err = text_of_error(s.record?.error);
      if (err) f.last_error = err;
      if (s.record && Object.prototype.hasOwnProperty.call(s.record, "result") && s.record.result !== undefined && s.record.result !== null) {
        f.last_result = s.record.result;
      }
    }
    f.last_result_summary = summarize_result(f.last_result);
    f.tools = Array.from(tools.values());
    if (llm_calls && last_llm) {
      const d = llm_detail(last_llm);
      f.llm = { calls: llm_calls, model: d.model, provider: d.provider };
      if (has_tokens) f.llm.tokens = { in: tok_in, out: tok_out, total: tok_total };
      if (d.messages.length || d.system) {
        const messages: ChatMessage[] = d.system ? [{ role: "system", content: d.system }, ...d.messages] : [...d.messages];
        f.context = { provider: d.provider, model: d.model, messages_source: d.messages_source, messages };
      }
    }

    f.records = oldest_first(a.records).map((r) => r.rec);
    const open_key = f.status === "waiting" || (f.status === "running" && String(last.status) === "waiting") ? String(last.record?.result?.wait?.wait_key || "") : "";
    const wait_seen = new Set<string>();
    for (const r of f.records) {
      const w = (r as any)?.result?.wait;
      if (String(r.status || "") === "waiting" && w && typeof w === "object") {
        const key = String(w.wait_key || "");
        const id = `${String(w.reason || "")}|${key}`;
        if (!wait_seen.has(id)) {
          wait_seen.add(id);
          const row: NodeWait = { reason: String(w.reason || ""), wait_key: key, open: false };
          if (typeof w.prompt === "string" && w.prompt) row.prompt = w.prompt;
          f.waits.push(row);
        }
      }
      const sub = subflow_child_id(r);
      if (sub && !f.subruns.includes(sub)) f.subruns.push(sub);
    }
    if (open_key) for (const w of f.waits) w.open = w.wait_key === open_key;
    out[gid] = f;
  }
  return out;
}

/** graph id → status, the shape FlowGraph's `node_status` prop takes. */
export function node_status_map(facts: Record<string, NodeFacts>): Record<string, NodeRunStatus> {
  const out: Record<string, NodeRunStatus> = {};
  for (const [k, f] of Object.entries(facts || {})) out[k] = f.status;
  return out;
}

// --- copy documents ----------------------------------------------------------------

/** "Copy facts (JSON)": the facts without the raw records and the conversation (they have their own copies). */
export function node_facts_copy(f: NodeFacts): string {
  const { records: _records, context: _context, ...rest } = f;
  return JSON.stringify(rest, null, 2);
}

/** "Copy records (JSONL)": the node's ledger records, one per line, newest last. */
export function node_records_jsonl(f: NodeFacts): string {
  return f.records.map((r) => compact_json(r)).join("\n");
}

/** "Copy context": the exact messages of the node's last LLM call, as JSON. "" when there are none. */
export function node_context_copy(f: NodeFacts): string {
  return f.context ? JSON.stringify(f.context, null, 2) : "";
}

export type RunStateNode = { id: string; label: string; type: string };

export type RunStateDoc = {
  run_id: string;
  status: string;
  state: string;
  finished: boolean;
  as_of: string;
  current_node: { id: string; label: string; type: string; status: NodeRunStatus | "none" } | null;
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    status: NodeRunStatus | "none";
    visits: number;
    first_at: string | null;
    last_at: string | null;
    duration_ms: number;
    llm: NodeLlm | null;
    tools: NodeFacts["tools"];
    waits: NodeWait[];
    subruns: string[];
    last_result_summary: string;
    last_error: string;
  }>;
  edges: Array<{ source: string; target: string }>;
};

function iso(ms_value: number | null): string | null {
  return typeof ms_value === "number" && Number.isFinite(ms_value) ? new Date(ms_value).toISOString() : null;
}

/**
 * "Copy run state": one JSON document an AI can reason over — where the run
 * is, why, and what each node did — without raw records or conversations.
 */
export function build_run_state_doc(args: {
  run_id: string;
  status: string;
  state: string;
  finished: boolean;
  now_ms: number;
  current_id: string;
  nodes: RunStateNode[];
  edges: Array<{ source: string; target: string }>;
  facts: Record<string, NodeFacts>;
  status_of: (id: string) => NodeRunStatus | "none";
}): RunStateDoc {
  const by_id = new Map(args.nodes.map((n) => [n.id, n]));
  const cur = args.current_id ? by_id.get(args.current_id) : undefined;
  return {
    run_id: args.run_id,
    status: args.status,
    state: args.state,
    finished: args.finished,
    as_of: iso(args.now_ms) || "",
    current_node: cur ? { id: cur.id, label: cur.label, type: cur.type, status: args.status_of(cur.id) } : null,
    nodes: args.nodes.map((n) => {
      const f = args.facts[n.id];
      return {
        id: n.id,
        label: n.label,
        type: n.type,
        status: args.status_of(n.id),
        visits: f ? f.visits : 0,
        first_at: f ? iso(f.first_ms) : null,
        last_at: f ? iso(f.last_ms) : null,
        duration_ms: f ? f.duration_ms : 0,
        llm: f ? f.llm : null,
        tools: f ? f.tools : [],
        waits: f ? f.waits : [],
        subruns: f ? f.subruns : [],
        last_result_summary: f ? f.last_result_summary : "",
        last_error: f ? f.last_error : "",
      };
    }),
    edges: args.edges.map((e) => ({ source: e.source, target: e.target })),
  };
}
