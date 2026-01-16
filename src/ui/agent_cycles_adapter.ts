import type { TraceItem, TraceStep } from "@abstractuic/monitor-flow";

import type { StepRecord } from "../lib/types";

export type LedgerRecordItem = {
  run_id: string;
  cursor: number;
  record: StepRecord;
};

export type AgentTraceBuildResult = {
  run_id: string;
  node_id: string;
  items: TraceItem[];
};

function as_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function run_id_of(item: LedgerRecordItem): string {
  return as_string(item.record?.run_id) || as_string(item.run_id);
}

function node_id_of(rec: StepRecord): string {
  return as_string(rec?.node_id);
}

function effect_type_of(rec: StepRecord): string {
  return as_string(rec?.effect?.type);
}

function status_of(rec: StepRecord): string {
  return as_string(rec?.status) || "unknown";
}

function step_id_of(rec: StepRecord): string {
  return as_string(rec?.step_id);
}

function ts_of(rec: StepRecord): string {
  return as_string(rec?.ended_at) || as_string(rec?.started_at);
}

function pick_best_node_id(records: StepRecord[]): string {
  const llm = new Map<string, number>();
  const tools = new Map<string, number>();

  for (const r of records) {
    const nid = node_id_of(r);
    if (!nid) continue;
    const t = effect_type_of(r);
    if (t === "llm_call") llm.set(nid, (llm.get(nid) || 0) + 1);
    else if (t === "tool_calls") tools.set(nid, (tools.get(nid) || 0) + 1);
  }

  const best_of = (m: Map<string, number>): string => {
    let best = "";
    let best_count = -1;
    for (const [k, v] of m) {
      if (v > best_count) {
        best = k;
        best_count = v;
      }
    }
    return best;
  };

  return best_of(llm) || best_of(tools) || "";
}

export function build_agent_trace(items: LedgerRecordItem[], opts: { run_id: string; node_id?: string | null }): AgentTraceBuildResult {
  const run_id = as_string(opts.run_id);
  if (!run_id) return { run_id: "", node_id: "", items: [] };

  const raw = (Array.isArray(items) ? items : [])
    .filter((x) => x && x.record && run_id_of(x) === run_id)
    .map((x) => ({ cursor: x.cursor, record: x.record }))
    .sort((a, b) => (a.cursor || 0) - (b.cursor || 0));

  const records = raw.map((x) => x.record);
  const requested_node_id = as_string(opts.node_id);
  const node_id = requested_node_id || pick_best_node_id(records);

  const INTERESTING = new Set(["llm_call", "tool_calls", "ask_user", "answer_user"]);
  let filtered = raw.filter((x) => INTERESTING.has(effect_type_of(x.record)));
  if (node_id) filtered = filtered.filter((x) => node_id_of(x.record) === node_id);

  const by_step_id = new Map<string, { cursor: number; record: StepRecord }>();
  const passthrough: Array<{ cursor: number; record: StepRecord }> = [];

  for (const item of filtered) {
    const sid = step_id_of(item.record);
    if (!sid) {
      passthrough.push(item);
      continue;
    }
    const prev = by_step_id.get(sid);
    if (!prev || (item.cursor || 0) > (prev.cursor || 0)) by_step_id.set(sid, item);
  }

  const deduped = [...passthrough, ...Array.from(by_step_id.values())].sort((a, b) => (a.cursor || 0) - (b.cursor || 0));

  const out: TraceItem[] = deduped.map((x) => {
    const rec = x.record;
    const nodeId = node_id_of(rec) || "(node?)";
    const ts = ts_of(rec);
    const sid = step_id_of(rec);
    return {
      id: `ledger:${run_id}:${x.cursor}:${sid || ""}`,
      runId: run_id,
      nodeId,
      ts: ts || undefined,
      status: status_of(rec),
      step: rec as unknown as TraceStep,
    };
  });

  return { run_id, node_id, items: out };
}

