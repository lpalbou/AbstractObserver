/**
 * AGENT FACTS — the pure folds behind the Agent page (backlog 0003 §Agent
 * page, delivery wave 3). No React, no fetch: each fold takes wire bodies as
 * the gateway serves them and returns typed facts with "" / [] / null where
 * the wire is silent. Nothing here guesses from prose.
 *
 * Wire shapes (gateway 0.13.1, read live 2026-10-14):
 * - `GET /runs/{id}` (service.py `run_summary`): `waiting`, `current_node`,
 *   `paused`, `error`, `flow_warnings: string[] | null`, `limits.tokens
 *   {estimated_used, max_tokens, max_input_tokens, pct, warn_tokens_pct}` —
 *   `pct` is a FRACTION of the budget (used / (max_input_tokens ?? max_tokens)),
 *   `warn_tokens_pct` a PERCENT; `session_history {policy, max_tokens,
 *   replayed_*, dropped_*, dropped_counts_complete, oversize_turn_kept, …}`;
 *   `output` (bounded projection, `#TRUNCATION` markers in-band; null until
 *   the run ends); `workspace_root` (turn rows only).
 * - `GET /runs/{id}/input_data` (gateway.py:10044): `{pin_ids, input_data,
 *   workspace}`. `input_data` is the run's CURRENT vars filtered to the start
 *   pin ids — not a start snapshot: live occurrence 02c4a311 showed
 *   `context.messages` 8 while running and 14 once completed.
 * - Flow JSON (`GET /workflows/{id}/flow` or `/bundles/{b}/flows/{f}`, either
 *   the bare flow or wrapped in `{…, flow}`): start pins = the FIRST
 *   `on_flow_start` node's `data.outputs` minus execution pins, defaults in
 *   `data.pinDefaults` (the gateway's own rule, gateway.py:3745-3790); the
 *   runtime applies a default to a pin the caller did not send
 *   (abstractruntime visual/executor.py:2163-2177). End pins = each
 *   `on_flow_end` node's `data.inputs` minus execution pins; an end with no
 *   data pins passes `_last_output` through (compiler.py:2781-2795).
 * - Run rows fetched with `include_metrics`: `tokens_total`, `llm_calls`,
 *   `tool_calls`, `steps` count the row's run AND every run below it
 *   (tree-inclusive, gateway.py:9960-9964).
 */
import { format_time_until_from_ms, parse_iso_ms, run_duration_ms, terminal_run_status } from "./format";
import type { RunSummary } from "./run_status";
import { build_run_steps, llm_detail, subflow_child_id, tool_detail, type LedgerItem, type RunStep } from "./run_steps";
import { isEventTrigger } from "@abstractframework/ui-kit";
import { fold_automation_brief, workflow_short, type AutomationBrief } from "./state_line";

// --- small readers -----------------------------------------------------------------

function obj(v: unknown): Record<string, any> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** A string list, or null when the field is not a list (absent ≠ empty). */
function str_list(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim())).filter(Boolean);
}

/** A list, or a newline-separated string (the workspace path fields come in both shapes). */
function path_list(v: unknown): string[] | null {
  if (typeof v === "string") return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return str_list(v);
}

function has(o: Record<string, any> | null, key: string): boolean {
  return !!o && Object.prototype.hasOwnProperty.call(o, key);
}

/** "48,210" — fixed locale so every viewer and every test reads the same digits. */
export function fmt_int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// --- Can do ------------------------------------------------------------------------

export type FactSource = "run" | "automation" | "";

export type CanDoField =
  | "model"
  | "provider"
  | "tools"
  | "tool_approval"
  | "workspace_access_mode"
  | "workspace_root"
  | "workspace_allowed_paths"
  | "workspace_ignored_paths"
  | "allowed_tools"
  | "max_iterations"
  | "untrusted_input_tools"
  | "email_allowed_recipients";

export type CanDo = {
  model: string;
  provider: string;
  /** The tool list the run was sent (its `tools` pin). */
  tools: string[];
  /** `policy.tool_approval` of the automation ("auto", "ask", …). */
  tool_approval: string;
  workspace_access_mode: string;
  workspace_root: string;
  workspace_allowed_paths: string[];
  workspace_ignored_paths: string[];
  /** The runtime allowlist (`target.input_data._runtime.allowed_tools`). */
  allowed_tools: string[];
  max_iterations: number | null;
  untrusted_input_tools: string[];
  email_allowed_recipients: string[];
  /** Where each fact came from; "" = the wire did not say (render as unknown, never as "none"). */
  source: Record<CanDoField, FactSource>;
};

/** The raw `GET /automations/{id}` body (`{definition, summary, active_revision}`). */
export function is_automation_body(v: unknown): boolean {
  const o = obj(v);
  return !!o && (has(o, "definition") || has(o, "summary"));
}

/**
 * What the agent can and cannot do. The RUN's own inputs win (that is what
 * this run was given); the automation definition fills what the run's
 * public inputs do not carry (policy, the runtime allowlist). `automation`
 * is either the folded `AutomationBrief` or the raw automation body; only
 * the body carries `_runtime.allowed_tools`, `untrusted_input_tools` and
 * `email_allowed_recipients`.
 */
export function fold_can_do(detail: any, input_data: any, automation: AutomationBrief | Record<string, any> | null | undefined): CanDo {
  const sent = obj(obj(input_data)?.input_data);
  const ws = obj(obj(input_data)?.workspace);
  const body = is_automation_body(automation) ? (automation as Record<string, any>) : null;
  const brief: AutomationBrief | null = body ? fold_automation_brief(body) : ((automation as AutomationBrief | null | undefined) ?? null);
  const def = obj(body?.definition);
  const target_in = obj(obj(def?.target)?.input_data);
  const runtime_ns = obj(target_in?._runtime);
  const policy = obj(def?.policy);

  const source = {} as Record<CanDoField, FactSource>;
  const pick_str = (field: CanDoField, ...cands: [FactSource, unknown][]): string => {
    for (const [src, v] of cands) {
      const s = str(v);
      if (s) {
        source[field] = src;
        return s;
      }
    }
    source[field] = "";
    return "";
  };
  const pick_list = (field: CanDoField, read: (v: unknown) => string[] | null, ...cands: [FactSource, unknown][]): string[] => {
    for (const [src, v] of cands) {
      const l = read(v);
      if (l !== null) {
        source[field] = src;
        return l;
      }
    }
    source[field] = "";
    return [];
  };
  const pick_num = (field: CanDoField, ...cands: [FactSource, unknown][]): number | null => {
    for (const [src, v] of cands) {
      const n = num(v);
      if (n !== null) {
        source[field] = src;
        return n;
      }
    }
    source[field] = "";
    return null;
  };
  // The folded brief keeps [] for an absent list: only a non-empty one is evidence.
  const brief_list = (l: string[] | undefined): string[] | null => (l && l.length ? l : null);

  return {
    model: pick_str("model", ["run", sent?.model], ["automation", target_in?.model], ["automation", brief?.model]),
    provider: pick_str("provider", ["run", sent?.provider], ["automation", target_in?.provider], ["automation", brief?.provider]),
    tools: pick_list("tools", str_list, ["run", sent?.tools], ["automation", target_in?.tools], ["automation", brief_list(brief?.tools)]),
    tool_approval: pick_str("tool_approval", ["automation", policy?.tool_approval], ["automation", brief?.tool_approval]),
    workspace_access_mode: pick_str(
      "workspace_access_mode",
      ["run", ws?.workspace_access_mode],
      ["run", sent?.workspace_access_mode],
      ["automation", target_in?.workspace_access_mode],
    ),
    workspace_root: pick_str(
      "workspace_root",
      ["run", obj(detail)?.workspace_root],
      ["run", ws?.workspace_root],
      ["run", sent?.workspace_root],
      ["automation", brief?.workspace_root],
      ["automation", target_in?.workspace_root],
    ),
    workspace_allowed_paths: pick_list(
      "workspace_allowed_paths",
      path_list,
      ["run", ws?.workspace_allowed_paths],
      ["automation", target_in?.workspace_allowed_paths],
    ),
    workspace_ignored_paths: pick_list(
      "workspace_ignored_paths",
      path_list,
      ["run", ws?.workspace_ignored_paths],
      ["automation", target_in?.workspace_ignored_paths],
    ),
    allowed_tools: pick_list("allowed_tools", str_list, ["automation", runtime_ns?.allowed_tools]),
    max_iterations: pick_num("max_iterations", ["run", sent?.max_iterations], ["automation", target_in?.max_iterations], ["automation", brief?.max_iterations]),
    untrusted_input_tools: pick_list("untrusted_input_tools", str_list, ["automation", policy?.untrusted_input_tools]),
    email_allowed_recipients: pick_list("email_allowed_recipients", str_list, ["automation", policy?.email_allowed_recipients]),
    source,
  };
}

// --- Pins --------------------------------------------------------------------------

/**
 * - `value`: the wire carries a value for this pin (may be null).
 * - `not_provided`: an input pin the flow declares that the run was not sent.
 * - `absent`: an output with no value (run not finished, or the output lacks the key).
 * - `unknown`: the body that would carry the value is not loaded.
 */
export type PinState = "value" | "not_provided" | "absent" | "unknown";

export type PinWithValue = {
  id: string;
  label: string;
  /** A PinType when the flow declares one; "any" when untyped. */
  type: string;
  /** False when no flow declared this pin's type (pin_ids only, a pass-through output). */
  typed: boolean;
  required: boolean;
  description: string;
  state: PinState;
  value: unknown;
  /** The start node's `pinDefaults` entry — what the runtime used when the pin was not sent. */
  flow_default: { value: unknown } | null;
};

export type PinFold = {
  inputs: PinWithValue[];
  outputs: PinWithValue[];
  /** In `input_data` but not a declared start pin — listed so nothing is hidden. */
  also_sent: [string, unknown][];
  /** In the run's `output` but not a declared end pin (incl. `#TRUNCATION`). */
  also_returned: [string, unknown][];
  /** Every `on_flow_end` declares no data pins: the run returns `_last_output` as ONE untyped output. */
  end_is_passthrough: boolean;
  flow_found: boolean;
  start_found: boolean;
  end_found: boolean;
  /** The run is terminal: output states are final, not pending. */
  outputs_final: boolean;
};

/** The flow body whether served bare (`{nodes, …}`) or wrapped (`{…, flow: {nodes}}`). */
export function flow_root(flow: any): Record<string, any> | null {
  const f = obj(flow);
  if (!f) return null;
  if (Array.isArray(f.nodes)) return f;
  const inner = obj(f.flow);
  return inner && Array.isArray(inner.nodes) ? inner : null;
}

/** Same reading as flow_graph.tsx `node_type_from_raw`: `data.nodeType`, else `type`. */
export function node_type(n: any): string {
  const data = obj(n?.data) || {};
  return str(data.nodeType) || str(n?.type);
}

const EXEC_IDS = new Set(["exec-out", "exec-in", "exec"]);

function data_pins(n: any, side: "inputs" | "outputs"): any[] {
  const data = obj(n?.data) || {};
  const raw = Array.isArray(data[side]) && data[side].length ? data[side] : Array.isArray(n?.[side]) ? n[side] : [];
  return raw.filter((p: any) => {
    const o = obj(p);
    if (!o) return false;
    const id = str(o.id);
    return !!id && str(o.type) !== "execution" && !EXEC_IDS.has(id);
  });
}

function declared_pin(p: any, state: PinState, value: unknown, flow_default: { value: unknown } | null): PinWithValue {
  const id = str(p.id);
  const type = str(p.type) || "any";
  return {
    id,
    label: str(p.label) || id,
    type,
    typed: true,
    required: p.required === true,
    description: str(p.description),
    state,
    value,
    flow_default,
  };
}

function untyped_pin(id: string, state: PinState, value: unknown): PinWithValue {
  return { id, label: id, type: "any", typed: false, required: false, description: "", state, value, flow_default: null };
}

export function fold_pins(flow: any, input_data: any, detail: any): PinFold {
  const root = flow_root(flow);
  const nodes: any[] = root ? root.nodes : [];
  const start = nodes.find((n) => node_type(n) === "on_flow_start") || null;
  const ends = nodes.filter((n) => node_type(n) === "on_flow_end");

  // --- inputs ---
  const body = obj(input_data);
  const sent = obj(body?.input_data);
  const defaults = obj(obj(start?.data)?.pinDefaults) || {};
  const inputs: PinWithValue[] = [];
  const declared = new Set<string>();
  const in_state = (id: string): { state: PinState; value: unknown } => {
    if (!sent) return { state: "unknown", value: undefined };
    return has(sent, id) ? { state: "value", value: sent[id] } : { state: "not_provided", value: undefined };
  };
  for (const p of start ? data_pins(start, "outputs") : []) {
    const id = str(p.id);
    if (declared.has(id)) continue;
    declared.add(id);
    const { state, value } = in_state(id);
    const flow_default = state === "not_provided" && has(defaults, id) ? { value: defaults[id] } : null;
    inputs.push(declared_pin(p, state, value, flow_default));
  }
  // The gateway's own pin list (it read the flow): any id the loaded flow lacks still shows, untyped.
  for (const raw of Array.isArray(body?.pin_ids) ? body!.pin_ids : []) {
    const id = str(raw);
    if (!id || declared.has(id)) continue;
    declared.add(id);
    const { state, value } = in_state(id);
    inputs.push(untyped_pin(id, state, value));
  }
  const also_sent: [string, unknown][] = sent ? Object.keys(sent).filter((k) => !declared.has(k)).map((k) => [k, sent[k]] as [string, unknown]) : [];

  // --- outputs ---
  const d = obj(detail);
  const outputs_final = !!d && terminal_run_status(d.status);
  const output = d ? d.output : undefined;
  const out_obj = obj(output);
  const out_state = (id: string): { state: PinState; value: unknown } => {
    if (!d) return { state: "unknown", value: undefined };
    if (out_obj && has(out_obj, id)) return { state: "value", value: out_obj[id] };
    return { state: "absent", value: undefined };
  };
  const outputs: PinWithValue[] = [];
  const end_ids = new Set<string>();
  for (const end of ends) {
    for (const p of data_pins(end, "inputs")) {
      const id = str(p.id);
      if (end_ids.has(id)) continue;
      end_ids.add(id);
      const { state, value } = out_state(id);
      outputs.push(declared_pin(p, state, value, null));
    }
  }
  const end_is_passthrough = ends.length > 0 && end_ids.size === 0;
  let also_returned: [string, unknown][] = [];
  if (end_is_passthrough) {
    const present = !!d && output !== null && output !== undefined;
    outputs.push(untyped_pin("output", !d ? "unknown" : present ? "value" : "absent", present ? output : undefined));
  } else if (out_obj) {
    also_returned = Object.keys(out_obj).filter((k) => !end_ids.has(k)).map((k) => [k, out_obj[k]] as [string, unknown]);
  } else if (d && output !== null && output !== undefined) {
    // A non-object output from a flow whose end declares pins (or no flow loaded): shown, never dropped.
    also_returned = [["output", output]];
  }

  return {
    inputs,
    outputs,
    also_sent,
    also_returned,
    end_is_passthrough,
    flow_found: !!root,
    start_found: !!start,
    end_found: ends.length > 0,
    outputs_final,
  };
}

// --- Context -----------------------------------------------------------------------

export type TokenGauge = {
  used: number | null;
  max_tokens: number | null;
  max_input_tokens: number | null;
  /** The budget `pct` is measured against: max_input_tokens when set, else max_tokens (service.py rule). */
  budget: number | null;
  /** 0..100 (the wire's `pct` is a fraction; converted here). */
  pct: number | null;
  /** 0..100 — the warn threshold as the wire states it. */
  warn_pct: number | null;
  over_warn: boolean;
};

export type ContextFacts = {
  has_history: boolean;
  policy: string;
  max_tokens: number | null;
  replayed_messages: number | null;
  replayed_tokens: number | null;
  dropped_messages: number | null;
  dropped_tokens: number | null;
  dropped_counts_complete: boolean | null;
  oversize_turn_kept: boolean | null;
  strict: boolean | null;
  token_estimator: string;
  session_kind: string;
  tokens: TokenGauge | null;
  flow_warnings: string[];
  /** One sentence built ONLY from the numbers present; "" when the run carries no window receipt. */
  window_note: string;
};

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

export function window_note_of(h: {
  replayed_messages: number | null;
  replayed_tokens: number | null;
  max_tokens: number | null;
  dropped_messages: number | null;
  dropped_tokens: number | null;
  dropped_counts_complete: boolean | null;
  oversize_turn_kept: boolean | null;
}): string {
  const parts: string[] = [];
  const complete = h.dropped_counts_complete !== false;
  if (h.replayed_messages !== null) {
    const total = h.dropped_messages !== null && complete ? h.replayed_messages + h.dropped_messages : null;
    let s = total !== null ? `replayed ${fmt_int(h.replayed_messages)} of ${fmt_int(total)} ${plural(total, "message")}` : `replayed ${fmt_int(h.replayed_messages)} ${plural(h.replayed_messages, "message")}`;
    if (h.replayed_tokens !== null) s += ` (${fmt_int(h.replayed_tokens)}${h.max_tokens !== null ? ` of ${fmt_int(h.max_tokens)}` : ""} tokens)`;
    else if (h.max_tokens !== null) s += ` (budget ${fmt_int(h.max_tokens)} tokens)`;
    parts.push(s);
  } else if (h.max_tokens !== null) {
    parts.push(`history budget ${fmt_int(h.max_tokens)} tokens`);
  }
  if (h.dropped_messages !== null) {
    if (h.dropped_messages > 0) {
      const tok = h.dropped_tokens !== null && h.dropped_tokens > 0 ? ` (${fmt_int(h.dropped_tokens)} tokens)` : "";
      parts.push(`${complete ? "" : "at least "}${fmt_int(h.dropped_messages)} older ${plural(h.dropped_messages, "message")} left out${tok}`);
    } else {
      parts.push(complete ? "nothing left out" : "left-out count incomplete");
    }
  } else if (h.dropped_counts_complete === false) {
    parts.push("left-out count incomplete");
  }
  if (h.oversize_turn_kept === true) parts.push("the newest turn alone exceeds the budget and was kept whole");
  return parts.join("; ");
}

export function fold_context(detail: any): ContextFacts {
  const d = obj(detail);
  const h = obj(d?.session_history);
  const t = obj(obj(d?.limits)?.tokens);
  let tokens: TokenGauge | null = null;
  if (t) {
    const used = num(t.estimated_used);
    const max_tokens = num(t.max_tokens);
    const max_input_tokens = num(t.max_input_tokens);
    const budget = max_input_tokens ?? max_tokens;
    const wire_pct = num(t.pct);
    const pct = wire_pct !== null ? wire_pct * 100 : used !== null && budget !== null && budget > 0 ? (used / budget) * 100 : null;
    const warn_pct = num(t.warn_tokens_pct);
    tokens = { used, max_tokens, max_input_tokens, budget, pct, warn_pct, over_warn: pct !== null && warn_pct !== null && pct >= warn_pct };
  }
  const flow_warnings = (str_list(d?.flow_warnings) || []).filter(Boolean);
  const facts = {
    replayed_messages: num(h?.replayed_messages),
    replayed_tokens: num(h?.replayed_tokens),
    max_tokens: num(h?.max_tokens),
    dropped_messages: num(h?.dropped_messages),
    dropped_tokens: num(h?.dropped_tokens),
    dropped_counts_complete: bool(h?.dropped_counts_complete),
    oversize_turn_kept: bool(h?.oversize_turn_kept),
  };
  return {
    has_history: !!h,
    policy: str(h?.policy),
    ...facts,
    strict: bool(h?.strict),
    token_estimator: str(h?.token_estimator),
    session_kind: str(h?.session_kind),
    tokens,
    flow_warnings,
    window_note: h ? window_note_of(facts) : "",
  };
}

// --- Run tree ----------------------------------------------------------------------

export type TreeNode = { run: RunSummary; children: TreeNode[]; depth: number; is_subject: boolean };

export type RunTree = {
  subject_id: string;
  /** The subject's root: the occurrence for automation runs, else the topmost loaded ancestor. */
  root: TreeNode | null;
  /** An occurrence root's controller — drawn as a parent line, never expanded (no siblings). */
  controller: RunSummary | null;
  controller_id: string;
  subject_found: boolean;
  size: number;
};

const MAX_TREE_DEPTH = 16;

function rid_of(r: RunSummary | null | undefined): string {
  return String(r?.run_id || "").trim();
}

function role_of(r: RunSummary | null | undefined): string {
  return String(r?.role || "").trim();
}

function created_ms(r: RunSummary): number {
  return parse_iso_ms(r.created_at || r.updated_at || "") ?? 0;
}

/** Walk `parent_run_id` up from the subject: stop AT an occurrence, BELOW a controller, or at the top of what is loaded. */
export function tree_root_id(subject_run_id: string, by_id: Map<string, RunSummary>): string {
  const start = String(subject_run_id || "").trim();
  let cur: RunSummary | undefined = by_id.get(start);
  if (!cur) return start;
  const seen = new Set<string>();
  while (cur) {
    const id = rid_of(cur);
    seen.add(id);
    if (role_of(cur) === "occurrence") return id;
    const pid: string = String(cur.parent_run_id || "").trim();
    const parent: RunSummary | undefined = pid ? by_id.get(pid) : undefined;
    if (!parent || seen.has(pid) || role_of(parent) === "controller") return id;
    cur = parent;
  }
  return start;
}

export function fold_tree(subject_run_id: string, runs: RunSummary[]): RunTree {
  const subject_id = String(subject_run_id || "").trim();
  const by_id = new Map<string, RunSummary>();
  const children_of = new Map<string, RunSummary[]>();
  for (const r of runs || []) {
    const id = rid_of(r);
    if (id) by_id.set(id, r);
  }
  for (const r of by_id.values()) {
    const pid = String(r.parent_run_id || "").trim();
    if (!pid || pid === rid_of(r)) continue;
    const list = children_of.get(pid) || [];
    list.push(r);
    children_of.set(pid, list);
  }
  if (!by_id.has(subject_id)) {
    return { subject_id, root: null, controller: null, controller_id: "", subject_found: false, size: 0 };
  }
  const root_id = tree_root_id(subject_id, by_id);
  const root_run = by_id.get(root_id) as RunSummary;
  let size = 0;
  const seen = new Set<string>();
  const build = (run: RunSummary, depth: number): TreeNode => {
    const id = rid_of(run);
    seen.add(id);
    size += 1;
    const kids = depth < MAX_TREE_DEPTH ? [...(children_of.get(id) || [])].filter((k) => !seen.has(rid_of(k))) : [];
    kids.sort((a, b) => created_ms(a) - created_ms(b) || rid_of(a).localeCompare(rid_of(b)));
    return { run, depth, is_subject: id === subject_id, children: kids.map((k) => build(k, depth + 1)) };
  };
  const root = build(root_run, 0);
  let controller: RunSummary | null = null;
  let controller_id = "";
  if (role_of(root_run) === "occurrence") {
    controller_id = String(root_run.parent_run_id || root_run.automation_id || "").trim();
    controller = controller_id ? by_id.get(controller_id) || null : null;
  }
  return { subject_id, root, controller, controller_id, subject_found: true, size };
}

/** Depth-first, parents before children — the order the tree and the spend table share. */
export function flatten_tree(root: TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  if (root) walk(root);
  return out;
}

// --- Spend -------------------------------------------------------------------------

export type SpendRow = {
  run_id: string;
  depth: number;
  workflow_id: string;
  status: string;
  is_subject: boolean;
  /** Wall time created → finished (or → now while active); null when the row has no start. */
  duration_ms: number | null;
  running: boolean;
  tokens_total: number | null;
  llm_calls: number | null;
  tool_calls: number | null;
  steps: number | null;
  has_metrics: boolean;
  /** Metrics count this run AND every run below it: never sum a column. */
  inclusive: true;
};

export type Spend = { rows: SpendRow[]; inclusive: true; any_metrics: boolean };

export function fold_spend(tree: RunTree | TreeNode | null, runs_with_metrics: RunSummary[], now_ms: number = Date.now()): Spend {
  const root = tree && "children" in tree ? (tree as TreeNode) : ((tree as RunTree | null)?.root ?? null);
  const metrics = new Map<string, any>();
  for (const r of runs_with_metrics || []) {
    const id = rid_of(r);
    if (id) metrics.set(id, r);
  }
  const rows = flatten_tree(root).map((n): SpendRow => {
    const id = rid_of(n.run);
    const m = metrics.get(id) ?? n.run;
    const tokens_total = num(m?.tokens_total);
    const llm_calls = num(m?.llm_calls);
    const tool_calls = num(m?.tool_calls);
    const steps = num(m?.steps);
    const d = run_duration_ms(n.run as any, now_ms);
    const status = String(n.run.status || "").trim().toLowerCase();
    return {
      run_id: id,
      depth: n.depth,
      workflow_id: String(n.run.workflow_id || "").trim(),
      status,
      is_subject: n.is_subject,
      duration_ms: d >= 0 ? d : null,
      running: !terminal_run_status(status),
      tokens_total,
      llm_calls,
      tool_calls,
      steps,
      has_metrics: tokens_total !== null || llm_calls !== null || tool_calls !== null || steps !== null,
      inclusive: true,
    };
  });
  return { rows, inclusive: true, any_metrics: rows.some((r) => r.has_metrics) };
}

// --- Agent profile (operator 2026-10-14 11:11) ---------------------------------------
//
// WHO the agent is, WHAT IT HAS ACCESS TO, WHAT IT DOES, FOR HOW LONG, WHAT
// IT MAY DO AFTER. Every fact carries its source, in a fixed structural
// precedence (never inferred from prose):
//   used          the ledger (`build_run_steps` → `llm_detail` / `tool_detail`
//                 / subworkflow steps) — what the run actually did;
//   output        the run's own output (`output.meta`, `output.response`);
//   run           the run's detail and `input_data` (the pins it was sent);
//   flow default  the start node's `pinDefaults` for pins not sent (the
//                 runtime applies them: this IS what the agent runs with);
//   flow          the flow declaration itself ("none declared");
//   automation    `GET /automations/{id}` (definition + summary);
//   listing       run rows (`include_metrics` counts are tree-inclusive);
//   gateway       the gateway's own default, which this wire does not report.
// An absent fact is `value: null` with a `why` — never a silent dash.

export type ProfileSource = "used" | "output" | "run" | "flow default" | "flow" | "automation" | "listing" | "gateway" | "";

export type Fact<T> = { value: T | null; source: ProfileSource; why: string };

function known<T>(value: T, source: ProfileSource): Fact<T> {
  return { value, source, why: "" };
}

function absent<T>(why: string, source: ProfileSource = ""): Fact<T> {
  return { value: null, source, why };
}

/** The reasons an absent fact gives (one vocabulary, tested). */
export const WHY = {
  wire: "not on this wire",
  no_default: "not provided, no default",
  not_automation: "not an automation run",
  automation_not_loaded: "automation definition not loaded",
  ledger_not_loaded: "ledger not loaded here",
  ledger_no_records: "no ledger records for this run in what is loaded",
  not_ended: "the run has not ended",
  flow_not_loaded: "flow not loaded",
  gateway_default: "gateway default (not reported on this wire)",
} as const;

/** "2026-10-13 22:43:43 UTC" — fixed zone so every viewer and test reads the same clock. */
export function fmt_utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

// --- what the ledger shows (used) ---

export type ModelUse = { provider: string; model: string; calls: number; run_ids: string[] };
export type ToolUse = {
  name: string;
  calls: number;
  failures: number;
  run_ids: string[];
  /** Called but not in the declared "may call" list: a finding, not an error. Null when no list is known. */
  outside_declared: boolean | null;
};
export type SubrunUse = {
  /** The child run (from the wait's `sub_run_id`); "" while the step has not parked yet. */
  run_id: string;
  workflow_id: string;
  /** The run whose ledger started it. */
  from_run_id: string;
  /** What the parent handed the child: `vars._runtime.{provider, model, allowed_tools}`, `vars._limits.max_iterations`. */
  provider: string;
  model: string;
  allowed_tools: string[] | null;
  max_iterations: number | null;
};
export type RunUse = { run_id: string; llm_calls: number; tool_calls: number; tool_failures: number; steps: number };
export type LedgerUse = {
  /** `records` was passed (an array). */
  loaded: boolean;
  /** The subject's own records are among them. */
  subject_found: boolean;
  /** Folded runs, subject first, then descendants in discovery order. */
  runs: RunUse[];
  /** Descendants (tree rows or subruns the ledger started) whose records are not loaded. */
  missing_run_ids: string[];
  llm_calls: number;
  tool_calls: number;
  tool_failures: number;
  models: ModelUse[];
  tools: ToolUse[];
  subruns: SubrunUse[];
  /** The allowlist the runtime enforced on a tool call (`tool_calls` payload `allowed_tools`). */
  allowlist: string[] | null;
  first_ms: number | null;
  last_ms: number | null;
};

function llm_model_of(step: RunStep): { provider: string; model: string } {
  const d = llm_detail(step);
  // A call made with the runtime's defaults carries no provider/model in its payload; the
  // provider request the runtime recorded does (`result.metadata._provider_request`).
  const req = obj(obj(obj(step.record?.result)?.metadata)?._provider_request);
  return { provider: d.provider || str(req?.provider), model: d.model || str(req?.model) || str(obj(req?.payload)?.model) };
}

function subrun_of(step: RunStep): SubrunUse {
  const started = obj(obj(step.started?.effect)?.payload);
  const latest = obj(obj(step.record?.effect)?.payload);
  const pick_vars = obj(started?.vars) && !obj(started?.vars)?.$slim ? obj(started?.vars) : obj(latest?.vars);
  const rt = obj(pick_vars?._runtime);
  const lim = obj(pick_vars?._limits);
  return {
    run_id: subflow_child_id(step.record),
    workflow_id: str(started?.workflow_id) || str(latest?.workflow_id),
    from_run_id: step.run_id,
    provider: str(rt?.provider),
    model: str(rt?.model),
    allowed_tools: str_list(rt?.allowed_tools),
    max_iterations: num(lim?.max_iterations),
  };
}

/**
 * Fold the loaded ledger records: the subject's own run, then every
 * descendant whose records are present (tree rows in `descendant_ids`, and
 * subruns the folded ledgers started). Counts one per step, as the Ledger
 * tab's `run_facts` does.
 */
export function fold_ledger_use(records: LedgerItem[] | null | undefined, subject_id: string, descendant_ids: string[] = []): LedgerUse {
  const out: LedgerUse = {
    loaded: Array.isArray(records),
    subject_found: false,
    runs: [],
    missing_run_ids: [],
    llm_calls: 0,
    tool_calls: 0,
    tool_failures: 0,
    models: [],
    tools: [],
    subruns: [],
    allowlist: null,
    first_ms: null,
    last_ms: null,
  };
  if (!Array.isArray(records)) return out;
  const sid = String(subject_id || "").trim();
  const have = new Set<string>();
  for (const it of records) {
    const rid = String(it?.run_id || it?.record?.run_id || "").trim();
    if (rid && it?.record) have.add(rid);
  }
  const models = new Map<string, ModelUse>();
  const tools = new Map<string, ToolUse>();
  const queue: string[] = [sid, ...descendant_ids.map((x) => String(x || "").trim()).filter(Boolean)];
  const seen = new Set<string>();
  const missing: string[] = [];
  while (queue.length) {
    const rid = queue.shift() as string;
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
    if (!have.has(rid)) {
      if (rid !== sid) missing.push(rid);
      continue;
    }
    if (rid === sid) out.subject_found = true;
    const use: RunUse = { run_id: rid, llm_calls: 0, tool_calls: 0, tool_failures: 0, steps: 0 };
    for (const step of build_run_steps(records, rid)) {
      use.steps += 1;
      const a = parse_iso_ms(step.started_at);
      const b = parse_iso_ms(step.ended_at);
      for (const t of [a, b]) {
        if (t === null) continue;
        if (out.first_ms === null || t < out.first_ms) out.first_ms = t;
        if (out.last_ms === null || t > out.last_ms) out.last_ms = t;
      }
      if (step.kind === "llm_call") {
        use.llm_calls += 1;
        const m = llm_model_of(step);
        const key = `${m.provider}\u0000${m.model}`;
        const prev = models.get(key) || { provider: m.provider, model: m.model, calls: 0, run_ids: [] };
        prev.calls += 1;
        if (!prev.run_ids.includes(rid)) prev.run_ids.push(rid);
        models.set(key, prev);
      } else if (step.kind === "tool") {
        const d = tool_detail(step);
        const names = new Map<string, { calls: number; results: number; failures: number }>();
        for (const c of d.calls) {
          const n = names.get(c.name) || { calls: 0, results: 0, failures: 0 };
          n.calls += 1;
          names.set(c.name, n);
        }
        for (const r of d.results) {
          const n = names.get(r.name) || { calls: 0, results: 0, failures: 0 };
          n.results += 1;
          if (r.success === false) n.failures += 1;
          names.set(r.name, n);
        }
        for (const [name, n] of names) {
          const calls = Math.max(n.calls, n.results);
          use.tool_calls += calls;
          use.tool_failures += n.failures;
          const prev = tools.get(name) || { name, calls: 0, failures: 0, run_ids: [], outside_declared: null };
          prev.calls += calls;
          prev.failures += n.failures;
          if (!prev.run_ids.includes(rid)) prev.run_ids.push(rid);
          tools.set(name, prev);
        }
        const allow = str_list(obj(step.started?.effect?.payload)?.allowed_tools) ?? str_list(obj(step.record?.effect?.payload)?.allowed_tools);
        if (allow !== null && out.allowlist === null) out.allowlist = allow;
      } else if (step.kind === "subflow") {
        const sub = subrun_of(step);
        out.subruns.push(sub);
        if (sub.run_id) queue.push(sub.run_id);
      }
    }
    out.llm_calls += use.llm_calls;
    out.tool_calls += use.tool_calls;
    out.tool_failures += use.tool_failures;
    out.runs.push(use);
  }
  out.missing_run_ids = missing;
  out.models = [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
  out.tools = [...tools.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  return out;
}

// --- the profile ---

export type ModelFact = { provider: string; model: string; calls: number | null };
export type WorkspaceFact = { mode: Fact<string>; root: Fact<string>; allowed_paths: Fact<string[]>; ignored_paths: Fact<string[]> };
export type RetryPolicy = {
  max_attempts: number | null;
  backoff_initial: string;
  backoff_factor: number | null;
  backoff_max: string;
  failure: string;
  misfire: string;
  serial: boolean | null;
};
export type ContextPlan = {
  mode: string;
  growing_max_tokens: number | null;
  replayed_messages: number | null;
  replayed_tokens: number | null;
  dropped_messages: number | null;
  dropped_tokens: number | null;
};
export type NextRun = { kind: "next_at" | "last" | "none" | "on_trigger"; at_ms: number | null; text: string };

export type AgentProfile = {
  subject_id: string;
  is_automation: boolean;
  who: {
    workflow: Fact<{ id: string; name: string; version: string; flow_name: string }>;
    subject: Fact<{ kind: "automation" | "session" | "run"; title: string; id: string }>;
    role: Fact<{ text: string; parent_run_id: string }>;
    /** Several entries only when the ledger shows several models. */
    model: Fact<ModelFact[]>;
    /** What the run / flow / automation asked for, when it differs from what was used. */
    model_declared: Fact<ModelFact> | null;
    system_prompt: Fact<string>;
    task: Fact<string>;
  };
  access: {
    tools_allowed: Fact<string[]>;
    runtime_allowlist: Fact<string[]>;
    tools_called: Fact<ToolUse[]>;
    tool_approval: Fact<string>;
    untrusted_input_tools: Fact<string[]>;
    email_recipients: Fact<string[]>;
    /** `_runtime.operator_email`: what the recipient token "self" resolves to (gateway accounts.py:249). */
    operator_email: string;
    workspace: WorkspaceFact;
  };
  does: {
    llm_calls: Fact<number>;
    tool_calls: Fact<{ calls: number; failures: number | null }>;
    subruns: Fact<SubrunUse[]>;
    /** `{$artifact}` references in the output pins (the runtime has no artifact effect type to count). */
    artifacts: { pin: string; id: string }[];
    outcome: Fact<string>;
    /** Descendants whose ledgers are not among the records: their calls live in their own view. */
    children_not_loaded: string[];
  };
  how_long: {
    started_ms: number | null;
    finished_ms: number | null;
    running: boolean;
    duration: Fact<number>;
    max_iterations: Fact<number>;
    iterations_used: Fact<number>;
    tokens: TokenGauge | null;
    cadence: Fact<{ text: string; start_ms: number | null }>;
    next_fire_ms: number | null;
    occurrence: Fact<{ index: number | null; count: number | null }>;
    stop_after: Fact<number>;
    stop_at: Fact<number>;
    retry: Fact<RetryPolicy>;
  };
  after: {
    notify: Fact<string[]>;
    context: Fact<ContextPlan>;
    outputs_to: Fact<string>;
    next: Fact<NextRun>;
  };
  ledger: LedgerUse;
};

function first_fact<T>(cands: [ProfileSource, T | null | undefined][], why: string): Fact<T> {
  for (const [src, v] of cands) if (v !== null && v !== undefined) return known(v as T, src);
  return absent<T>(why);
}

function nonempty(v: unknown): string | null {
  const s = str(v);
  return s ? s : null;
}

function model_pair(provider: unknown, model: unknown): ModelFact | null {
  const p = str(provider);
  const m = str(model);
  return p || m ? { provider: p, model: m, calls: null } : null;
}

const AUTOMATION_ROLES = new Set(["controller", "occurrence", "descendant", "discussion"]);

/**
 * The Agent profile: five groups of facts, each with its source. Pure:
 * `detail` = `GET /runs/{id}`, `input_data` = `GET /runs/{id}/input_data`,
 * `flow` = the flow JSON, `automation` = the raw `GET /automations/{id}`
 * body (or the folded brief, which lacks the policy details), `records` =
 * the ledger items the host holds (the subject's and any subrun's;
 * undefined = not loaded), `runs` = listing rows (tree + metrics).
 */
export function fold_agent_profile(
  detail: any,
  input_data: any,
  flow: any,
  automation: AutomationBrief | Record<string, any> | null | undefined,
  records: LedgerItem[] | null | undefined,
  runs: RunSummary[] | null | undefined,
  now_ms: number = Date.now(),
  opts: { subject_run_id?: string; row?: RunSummary | null } = {},
): AgentProfile {
  const d = obj(detail);
  const inb = obj(input_data);
  const sent = obj(inb?.input_data);
  const subject_id = String(opts.subject_run_id || d?.run_id || inb?.run_id || opts.row?.run_id || "").trim();
  const rows = Array.isArray(runs) ? runs : [];
  const row_of = (id: string): RunSummary | undefined => rows.find((r) => String(r?.run_id || "").trim() === id);
  const row: any = { ...(row_of(subject_id) || {}), ...(opts.row || {}) };
  for (const k of ["workflow_id", "status", "created_at", "updated_at", "role", "occurrence_index", "automation_id", "parent_run_id", "session_id", "session_kind"]) {
    if (d && d[k] !== undefined && d[k] !== null && d[k] !== "") row[k] = d[k];
  }

  const body = is_automation_body(automation) ? (automation as Record<string, any>) : null;
  const brief: AutomationBrief | null = body ? fold_automation_brief(body) : ((automation as AutomationBrief | null | undefined) ?? null);
  const def = obj(body?.definition);
  const summary = obj(body?.summary);
  const target_in = obj(obj(def?.target)?.input_data);
  const runtime_ns = obj(target_in?._runtime);
  const policy = obj(def?.policy);
  const role = str(row.role);
  const is_automation = !!str(row.automation_id) || AUTOMATION_ROLES.has(role) || str(row.session_kind) === "automation";
  const auto_why = !is_automation ? WHY.not_automation : !brief ? WHY.automation_not_loaded : WHY.wire;

  // flow start node
  const root = flow_root(flow);
  const start = root ? root.nodes.find((n: any) => node_type(n) === "on_flow_start") || null : null;
  const defaults = obj(obj(start?.data)?.pinDefaults);
  const start_pin_ids = new Set(start ? data_pins(start, "outputs").map((p) => str(p.id)) : []);
  const flow_default = (id: string): unknown => (sent && has(sent, id) ? undefined : defaults && has(defaults, id) ? defaults[id] : undefined);

  // tree + ledger
  const tree = fold_tree(subject_id, rows);
  const descendants = flatten_tree(tree.root)
    .filter((n) => rid_of(n.run) !== subject_id && is_below(n, subject_id, tree.root))
    .map((n) => rid_of(n.run));
  const ledger = fold_ledger_use(records, subject_id, descendants);
  const ledger_why = !ledger.loaded ? WHY.ledger_not_loaded : WHY.ledger_no_records;
  const used = ledger.loaded && ledger.subject_found;

  const can = fold_can_do(detail, input_data, body ?? brief);
  const can_src = (f: CanDoField): ProfileSource => (can.source[f] === "run" ? "run" : can.source[f] === "automation" ? "automation" : "");

  const out_obj = obj(d?.output);
  const meta = obj(out_obj?.meta);

  // --- WHO ---
  const wf_id = str(row.workflow_id) || str(inb?.workflow_id);
  const wf_version = str(inb?.bundle_version) || (wf_id.includes("@") ? wf_id.split("@")[1].split(":")[0] : "");
  const workflow: Fact<{ id: string; name: string; version: string; flow_name: string }> = wf_id
    ? known({ id: wf_id, name: workflow_short(wf_id), version: wf_version, flow_name: str(root?.name) }, "run")
    : absent(WHY.wire);

  const subject: AgentProfile["who"]["subject"] = is_automation
    ? brief
      ? known({ kind: "automation", title: brief.title, id: brief.automation_id }, "automation")
      : absent(WHY.automation_not_loaded)
    : str(row.session_id)
      ? known({ kind: "session", title: "", id: str(row.session_id) }, "run")
      : known({ kind: "run", title: "", id: subject_id }, "run");

  const parent_id = str(row.parent_run_id);
  const parent_row = parent_id ? row_of(parent_id) : undefined;
  const occ_index = num(row.occurrence_index);
  let role_text = "";
  if (role === "occurrence") role_text = occ_index !== null ? `run #${occ_index}` : "automation run";
  else if (role === "controller") role_text = "automation controller (the schedule's own run)";
  else if (role === "discussion") role_text = "discussion of the automation";
  else if (parent_id) {
    const p_role = str(parent_row?.role);
    const p_idx = num(parent_row?.occurrence_index);
    const p_name = p_role === "occurrence" && p_idx !== null ? `run #${p_idx}` : workflow_short(str(parent_row?.workflow_id)) || "a parent run (row not loaded)";
    role_text = `subrun of ${p_name}`;
  } else role_text = str(row.session_id) ? "run in a session" : "top-level run";
  const role_fact = known({ text: role_text, parent_run_id: parent_id }, "run");

  // model · provider: used → output → run → flow default → automation → gateway default
  const declared: [ProfileSource, ModelFact | null][] = [
    ["run", model_pair(sent?.provider, sent?.model)],
    ["flow default", model_pair(flow_default("provider"), flow_default("model"))],
    ["automation", model_pair(target_in?.provider, target_in?.model)],
    ["automation", model_pair(runtime_ns?.provider, runtime_ns?.model)],
    ["automation", body ? null : model_pair(brief?.provider, brief?.model)],
  ];
  const first_declared = declared.find(([, v]) => v !== null) || null;
  let model: Fact<ModelFact[]>;
  if (used && ledger.models.length) model = known(ledger.models.map((m) => ({ provider: m.provider, model: m.model, calls: m.calls })), "used");
  else if (model_pair(meta?.provider, meta?.model)) model = known([model_pair(meta?.provider, meta?.model) as ModelFact], "output");
  else if (first_declared) model = known([first_declared[1] as ModelFact], first_declared[0]);
  else model = absent(WHY.gateway_default, "gateway");
  let model_declared: Fact<ModelFact> | null = null;
  if ((model.source === "used" || model.source === "output") && first_declared && model.value) {
    const dm = first_declared[1] as ModelFact;
    const same = model.value.some((m) => (!dm.provider || m.provider === dm.provider) && (!dm.model || m.model === dm.model));
    if (!same) model_declared = known(dm, first_declared[0]);
  }

  const system_prompt: Fact<string> =
    sent && typeof sent.system === "string"
      ? known(sent.system, "run")
      : !root
        ? absent(WHY.flow_not_loaded)
        : nonempty(flow_default("system")) !== null
          ? known(String(flow_default("system")), "flow default")
          : start_pin_ids.has("system")
            ? absent("none declared: not provided and the flow has no default", "flow")
            : absent("the flow has no system pin", "flow");

  const task = first_fact<string>(
    [
      ["run", sent && typeof sent.prompt === "string" && sent.prompt.trim() ? sent.prompt : null],
      ["run", nonempty(obj(sent?.context)?.task)],
      ["flow default", nonempty(flow_default("prompt"))],
      ["automation", nonempty(target_in?.prompt)],
      ["automation", body ? null : nonempty(brief?.task)],
    ],
    WHY.no_default,
  );

  // --- ACCESS ---
  const tools_allowed = first_fact<string[]>(
    [
      ["run", str_list(sent?.tools)],
      ["flow default", str_list(flow_default("tools"))],
      ["automation", str_list(target_in?.tools)],
      ["automation", str_list(runtime_ns?.allowed_tools)],
      ["automation", body ? null : brief?.tools?.length ? brief.tools : null],
    ],
    WHY.no_default,
  );
  const handed = ledger.subruns.find((s) => s.allowed_tools !== null)?.allowed_tools ?? null;
  const runtime_allowlist = first_fact<string[]>(
    [
      ["used", used ? ledger.allowlist : null],
      ["used", used ? handed : null],
      ["automation", str_list(runtime_ns?.allowed_tools)],
      ["automation", body ? null : (brief?.allowed_tools ?? null)],
    ],
    !is_automation ? (used ? "the ledger shows no enforced allowlist" : ledger_why) : auto_why,
  );
  const declared_list = tools_allowed.value;
  const tools_called: Fact<ToolUse[]> = used
    ? known(
        ledger.tools.map((t) => ({ ...t, outside_declared: declared_list === null ? null : !declared_list.includes(t.name) })),
        "used",
      )
    : absent(ledger_why);

  const auto_fact = <T,>(v: T | null, field: CanDoField): Fact<T> => (v !== null && can.source[field] ? known(v, can_src(field)) : absent<T>(auto_why));
  const tool_approval = auto_fact(nonempty(can.tool_approval), "tool_approval");
  const untrusted_input_tools = auto_fact(can.source.untrusted_input_tools ? can.untrusted_input_tools : null, "untrusted_input_tools");
  const email_recipients = auto_fact(can.source.email_allowed_recipients ? can.email_allowed_recipients : null, "email_allowed_recipients");

  const ws_fact = <T,>(v: T, field: CanDoField): Fact<T> => (can.source[field] ? known(v, can_src(field)) : absent<T>(WHY.wire));
  const workspace: WorkspaceFact = {
    mode: ws_fact(can.workspace_access_mode, "workspace_access_mode"),
    root: ws_fact(can.workspace_root, "workspace_root"),
    allowed_paths: ws_fact(can.workspace_allowed_paths, "workspace_allowed_paths"),
    ignored_paths: ws_fact(can.workspace_ignored_paths, "workspace_ignored_paths"),
  };

  // --- DOES ---
  const subject_row: any = row_of(subject_id) || row;
  const llm_calls: Fact<number> = used
    ? known(ledger.llm_calls, "used")
    : num(subject_row?.llm_calls) !== null
      ? known(num(subject_row.llm_calls) as number, "listing")
      : absent(ledger_why);
  const tool_calls: Fact<{ calls: number; failures: number | null }> = used
    ? known({ calls: ledger.tool_calls, failures: ledger.tool_failures }, "used")
    : num(subject_row?.tool_calls) !== null
      ? known({ calls: num(subject_row.tool_calls) as number, failures: null }, "listing")
      : absent(ledger_why);
  const kids = tree.root ? find_node(tree.root, subject_id)?.children || [] : [];
  const subruns: Fact<SubrunUse[]> = used
    ? known(ledger.subruns, "used")
    : kids.length
      ? known(
          kids.map((k) => ({ run_id: rid_of(k.run), workflow_id: str(k.run.workflow_id), from_run_id: subject_id, provider: "", model: "", allowed_tools: null, max_iterations: null })),
          "listing",
        )
      : absent(ledger.loaded ? WHY.ledger_no_records : "none among the loaded rows; ledger not loaded here");
  const artifacts: { pin: string; id: string }[] = [];
  if (out_obj) {
    for (const [k, v] of Object.entries(out_obj)) {
      const o = obj(v);
      if (o && Object.keys(o).length === 1 && typeof o.$artifact === "string" && o.$artifact.trim()) artifacts.push({ pin: k, id: o.$artifact.trim() });
    }
  }
  const terminal = terminal_run_status(row.status);
  let outcome: Fact<string>;
  if (!d) outcome = absent("run detail not loaded");
  else if (!terminal) outcome = absent(WHY.not_ended);
  else if (out_obj && typeof out_obj.response === "string" && out_obj.response.trim()) outcome = known(out_obj.response, "output");
  else if (typeof d.output === "string" && d.output.trim()) outcome = known(d.output, "output");
  else if (str(d.error)) outcome = known(str(d.error), "run");
  else outcome = absent("the output carries no response text");

  // --- HOW LONG ---
  const started_ms = parse_iso_ms(row.created_at || "");
  const finished_ms = terminal ? parse_iso_ms(row.updated_at || "") : null;
  const dur = run_duration_ms(row, now_ms);
  const duration: Fact<number> =
    dur >= 0 ? known(dur, "run") : ledger.first_ms !== null && ledger.last_ms !== null ? known(ledger.last_ms - ledger.first_ms, "used") : absent(WHY.wire);
  const handed_iter = used ? (ledger.subruns.find((s) => s.max_iterations !== null)?.max_iterations ?? null) : null;
  const max_iterations = first_fact<number>(
    [
      ["used", handed_iter],
      ["run", num(sent?.max_iterations)],
      ["flow default", num(flow_default("max_iterations"))],
      ["automation", num(target_in?.max_iterations)],
      ["automation", body ? null : (brief?.max_iterations ?? null)],
    ],
    WHY.no_default,
  );
  const iterations_used: Fact<number> = num(meta?.iterations) !== null ? known(num(meta?.iterations) as number, "output") : absent(terminal ? "the output carries no iteration count" : WHY.not_ended);
  const tokens = fold_context(detail).tokens;
  const trigger = obj(summary?.trigger) || obj(def?.trigger);
  const tcfg = obj(trigger?.config);
  const cadence: Fact<{ text: string; start_ms: number | null }> = brief?.cadence ? known({ text: brief.cadence, start_ms: parse_iso_ms(tcfg?.start_at || "") }, "automation") : absent(auto_why);
  const occurrence: Fact<{ index: number | null; count: number | null }> = is_automation
    ? known({ index: occ_index, count: brief ? brief.occurrence_count : null }, brief ? "automation" : "run")
    : absent(WHY.not_automation);
  const stop_after: Fact<number> = num(tcfg?.count) !== null ? known(num(tcfg?.count) as number, "automation") : absent(is_automation && trigger ? "no count limit" : auto_why, is_automation && trigger ? "automation" : "");
  const stop_at_ms = parse_iso_ms(tcfg?.until || "");
  const stop_at: Fact<number> = stop_at_ms !== null ? known(stop_at_ms, "automation") : absent(is_automation && trigger ? "no end date" : auto_why, is_automation && trigger ? "automation" : "");
  const retry_raw = obj(policy?.retry);
  const backoff = obj(retry_raw?.backoff);
  const retry: Fact<RetryPolicy> = policy
    ? known(
        {
          max_attempts: num(retry_raw?.max_attempts),
          backoff_initial: str(backoff?.initial),
          backoff_factor: num(backoff?.factor),
          backoff_max: str(backoff?.max),
          failure: str(policy.failure),
          misfire: str(policy.misfire),
          serial: bool(policy.serial),
        },
        "automation",
      )
    : absent(auto_why);

  // --- AFTER ---
  const notify: Fact<string[]> = def && Array.isArray(obj(def.notify)?.channels) ? known(str_list(def.notify.channels) as string[], "automation") : absent(auto_why);
  const hist = fold_context(detail);
  const context: Fact<ContextPlan> =
    brief?.context_mode || hist.has_history
      ? known(
          {
            mode: brief?.context_mode || "",
            growing_max_tokens: brief?.growing_max_tokens ?? null,
            replayed_messages: hist.replayed_messages,
            replayed_tokens: hist.replayed_tokens,
            dropped_messages: hist.dropped_messages,
            dropped_tokens: hist.dropped_tokens,
          },
          brief?.context_mode ? "automation" : "run",
        )
      : absent(is_automation ? auto_why : "no session history on this run");
  const outputs_to: Fact<string> = workspace.root.value ? known(workspace.root.value, workspace.root.source) : absent(WHY.wire);

  let next: Fact<NextRun>;
  if (!is_automation) next = absent(WHY.not_automation);
  else if (!brief) next = absent(WHY.automation_not_loaded);
  else {
    const st = brief.status;
    if (st === "paused") next = known({ kind: "none", at_ms: null, text: "no next run (paused)" }, "automation");
    else if (st === "completed")
      next = known(
        brief.last && occ_index !== null && brief.last.index === occ_index
          ? { kind: "last", at_ms: null, text: "this was the last (stop reached)" }
          : { kind: "none", at_ms: null, text: "no next run (completed: stop reached)" },
        "automation",
      );
    else if (st === "archived") next = known({ kind: "none", at_ms: null, text: "no next run (archived)" }, "automation");
    else if (st === "failed") next = known({ kind: "none", at_ms: null, text: "no next run (the automation failed)" }, "automation");
    else if (brief.next_fire_ms !== null) {
      const until = format_time_until_from_ms(brief.next_fire_ms - now_ms);
      next = known({ kind: "next_at", at_ms: brief.next_fire_ms, text: `next run at ${fmt_utc(brief.next_fire_ms)}${until ? ` (in ${until})` : ""}` }, "automation");
    } else if (str(trigger?.source_id) === "manual") next = known({ kind: "on_trigger", at_ms: null, text: "next run when someone runs it" }, "automation");
    // Mail, a feed, a webhook (`email.received`, `feed.item`, `webhook.received`): the next run is
    // what arrives next, named ("next run when Release notes has a new item"; UX review 2026-10-25 #2).
    else if (brief.event_driven || isEventTrigger(trigger as any)) {
      const words = brief.cadence || "when something new arrives";
      next = known({ kind: "on_trigger", at_ms: null, text: `next run ${words.charAt(0).toLowerCase()}${words.slice(1)}` }, "automation");
    } else next = absent("no next fire time on this wire", "automation");
  }

  return {
    subject_id,
    is_automation,
    who: { workflow, subject, role: role_fact, model, model_declared, system_prompt, task },
    access: {
      tools_allowed,
      runtime_allowlist,
      tools_called,
      tool_approval,
      untrusted_input_tools,
      email_recipients,
      operator_email: str(runtime_ns?.operator_email),
      workspace,
    },
    does: { llm_calls, tool_calls, subruns, artifacts, outcome, children_not_loaded: ledger.missing_run_ids },
    how_long: {
      started_ms,
      finished_ms,
      running: !terminal,
      duration,
      max_iterations,
      iterations_used,
      tokens,
      cadence,
      next_fire_ms: brief?.next_fire_ms ?? null,
      occurrence,
      stop_after,
      stop_at,
      retry,
    },
    after: { notify, context, outputs_to, next },
    ledger,
  };
}

function find_node(n: TreeNode, id: string): TreeNode | null {
  if (rid_of(n.run) === id) return n;
  for (const c of n.children) {
    const hit = find_node(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Is `n` below the subject in the tree (a descendant, not an ancestor or a sibling)? */
function is_below(n: TreeNode, subject_id: string, root: TreeNode | null): boolean {
  const at = root ? find_node(root, subject_id) : null;
  return !!at && at !== n && !!find_node(at, rid_of(n.run));
}
