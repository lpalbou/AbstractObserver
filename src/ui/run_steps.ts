/**
 * Run view model (operator 2026-10-01 13:05): the run's ledger as step cards
 * grouped by agent cycle, with every `$slim` placeholder resolved so the
 * person reads the real prompt.
 *
 * Pure functions, no React. The card UI lives in run_steps_view.tsx.
 *
 * `$slim` (abstractruntime storage/ledger_slim.py): a terminal record
 * (completed / waiting / failed) replaces conversation-sized fields that its
 * STARTED record (same `step_id`) already holds with
 * `{"$slim": {kind, step_id, field | layout, sha256, bytes, appendix?}}`.
 * The bytes live in the same ledger, so resolution is local: index STARTED
 * payloads by step_id, rebuild, check the sha256 over compact JSON. The
 * gateway's `/runs/{id}/ledger` returns every record, STARTED included.
 */
import { HOUSEKEEPING_EVENT_NAMES, is_housekeeping, step_kind_of, type StepKind } from "./run_step_kinds";

export type LedgerItem = { run_id?: string; cursor: number; record: any };

// --- sha256 (sync; crypto.subtle is async and missing outside secure contexts) ---

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256_hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bit_len = bytes.length * 8;
  const padded_len = (((bytes.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(padded_len);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padded_len - 8, Math.floor(bit_len / 0x100000000));
  view.setUint32(padded_len - 4, bit_len >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded_len; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

// --- $slim resolution ---

export const SLIM_KEY = "$slim";

export function is_slim_marker(v: any): boolean {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && v[SLIM_KEY] && typeof v[SLIM_KEY] === "object");
}

/** step_id → STARTED effect payload (first STARTED wins, as in the runtime). */
export function build_started_index(records: any[]): Map<string, any> {
  const out = new Map<string, any>();
  for (const rec of records || []) {
    if (!rec || typeof rec !== "object" || String(rec.status || "") !== "started") continue;
    const sid = String(rec.step_id || "");
    const payload = rec.effect && typeof rec.effect === "object" ? rec.effect.payload : null;
    if (sid && payload && typeof payload === "object" && !out.has(sid)) out.set(sid, payload);
  }
  return out;
}

export type SlimResolution =
  | { state: "resolved"; value: any }
  /** Rebuilt from the STARTED record but its checksum differs from the marker: shown with a warning. */
  | { state: "unverified"; value: any; reason: string }
  | { state: "missing"; reason: string };

function rebuild_layout(payload: any, layout: string[]): any[] | null {
  const out: any[] = [];
  for (const part of layout) {
    if (part === "system") {
      if (typeof payload.system_prompt !== "string" || !payload.system_prompt) return null;
      out.push({ role: "system", content: payload.system_prompt });
    } else if (part === "messages") {
      if (!Array.isArray(payload.messages)) return null;
      for (const m of payload.messages) if (m && typeof m === "object") out.push({ ...m });
    } else if (part === "prompt") {
      if (typeof payload.prompt !== "string" || !payload.prompt) return null;
      out.push({ role: "user", content: payload.prompt });
    } else return null;
  }
  return out;
}

/** Resolve one marker against the STARTED index (the runtime's `resolve_slim_value`, in the browser). */
export function resolve_slim_marker(marker: any, index: Map<string, any>): SlimResolution {
  const body = marker && marker[SLIM_KEY];
  if (!body || typeof body !== "object") return { state: "missing", reason: "not a $slim marker" };
  const payload = index.get(String(body.step_id || ""));
  if (!payload) return { state: "missing", reason: "its started record is not in the loaded ledger" };
  let rebuilt: any;
  if (body.kind === "started_payload_field") {
    const field = String(body.field || "");
    if (!(field in payload)) return { state: "missing", reason: `the started record has no "${field}" field` };
    rebuilt = payload[field];
  } else if (body.kind === "started_messages_layout") {
    rebuilt = Array.isArray(body.layout) ? rebuild_layout(payload, body.layout.map(String)) : null;
    if (!rebuilt) return { state: "missing", reason: "the started record cannot rebuild these messages" };
  } else {
    return { state: "missing", reason: `unknown $slim kind "${String(body.kind || "")}"` };
  }
  if (Array.isArray(body.appendix) && body.appendix.length) {
    if (!Array.isArray(rebuilt)) return { state: "missing", reason: "appendix on a non-list value" };
    const merged = rebuilt.map((m: any) => (m && typeof m === "object" ? { ...m } : m));
    const extras = [...body.appendix].sort((a: any, b: any) => Number(a?.at ?? -1) - Number(b?.at ?? -1));
    for (const e of extras) {
      const at = Number(e?.at);
      if (!Number.isInteger(at) || at < 0 || at > merged.length) return { state: "missing", reason: "appendix position out of range" };
      merged.splice(at, 0, e.item);
    }
    rebuilt = merged;
  }
  const sha = sha256_hex(JSON.stringify(rebuilt));
  if (sha !== String(body.sha256 || "")) return { state: "unverified", value: rebuilt, reason: "checksum differs from the record" };
  return { state: "resolved", value: rebuilt };
}

export type ResolvedTree = { value: any; unresolved: Array<{ path: string; reason: string }>; unverified: Array<{ path: string; reason: string }> };

/** Deep-resolve every marker in a record (copies only along changed paths). */
export function resolve_slim_tree(value: any, index: Map<string, any>): ResolvedTree {
  const unresolved: ResolvedTree["unresolved"] = [];
  const unverified: ResolvedTree["unverified"] = [];
  const walk = (v: any, path: string, depth: number): any => {
    if (depth > 14) return v;
    if (is_slim_marker(v)) {
      const r = resolve_slim_marker(v, index);
      if (r.state === "missing") {
        unresolved.push({ path, reason: r.reason });
        return v;
      }
      if (r.state === "unverified") unverified.push({ path, reason: r.reason });
      return r.value;
    }
    if (Array.isArray(v)) {
      let out: any[] | null = null;
      v.forEach((x, i) => {
        const nx = walk(x, `${path}[${i}]`, depth + 1);
        if (nx !== x) (out ??= [...v])[i] = nx;
      });
      return out ?? v;
    }
    if (v && typeof v === "object") {
      let out: any = null;
      for (const k of Object.keys(v)) {
        const nx = walk(v[k], path ? `${path}.${k}` : k, depth + 1);
        if (nx !== v[k]) (out ??= { ...v })[k] = nx;
      }
      return out ?? v;
    }
    return v;
  };
  return { value: walk(value, "", 0), unresolved, unverified };
}

// --- steps ---

export type RunStep = {
  id: string;
  run_id: string;
  step_id: string;
  node_id: string;
  kind: StepKind;
  effect_type: string;
  event_name: string;
  status: string;
  cursor: number;
  started_at: string;
  ended_at: string;
  duration_ms: number | null;
  /** The STARTED record (full payload), when the ledger has one. */
  started: any | null;
  /** The latest record of the step (terminal when finished), markers resolved. */
  record: any;
  failed: boolean;
  housekeeping: boolean;
  /** 0 = before the first LLM call of the run; n = the n-th agent cycle. */
  cycle: number;
  unresolved: ResolvedTree["unresolved"];
  unverified: ResolvedTree["unverified"];
};

function ms(ts: any): number | null {
  const t = Date.parse(String(ts || ""));
  return Number.isFinite(t) ? t : null;
}

function tool_results(rec: any): any[] {
  const r = rec?.result;
  return r && typeof r === "object" && Array.isArray(r.results) ? r.results : [];
}

export function step_failed(rec: any, kind: StepKind): boolean {
  if (!rec) return false;
  if (String(rec.status || "") === "failed" || rec.error) return true;
  return kind === "tool" && tool_results(rec).some((x) => x && x.success === false);
}

/**
 * One step per `step_id` (STARTED + terminal merged), in ledger order, for
 * ONE run. Records without a step_id stay one step each.
 */
export function build_run_steps(items: LedgerItem[], run_id: string): RunStep[] {
  const rid = String(run_id || "").trim();
  const mine = (items || [])
    .filter((x) => x && x.record && String(x.run_id || x.record.run_id || "").trim() === rid)
    .sort((a, b) => (a.cursor || 0) - (b.cursor || 0));
  const index = build_started_index(mine.map((x) => x.record));
  const groups = new Map<string, { cursor: number; started: any | null; latest: any; latest_cursor: number }>();
  const order: string[] = [];
  for (const it of mine) {
    const rec = it.record;
    const sid = String(rec.step_id || "");
    const key = sid || `cursor:${it.cursor}`;
    let g = groups.get(key);
    if (!g) {
      g = { cursor: it.cursor, started: null, latest: rec, latest_cursor: it.cursor };
      groups.set(key, g);
      order.push(key);
    }
    if (String(rec.status || "") === "started" && !g.started) g.started = rec;
    if (it.cursor >= g.latest_cursor) {
      g.latest = rec;
      g.latest_cursor = it.cursor;
    }
  }
  let cycle = 0;
  const out: RunStep[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    const resolved = resolve_slim_tree(g.latest, index);
    const rec = resolved.value;
    const effect_type = String(rec?.effect?.type || g.started?.effect?.type || "").trim();
    const kind = step_kind_of(effect_type);
    const event_name = kind === "event" ? String(rec?.effect?.payload?.name || "").trim() : "";
    if (kind === "llm_call") cycle += 1;
    const failed = step_failed(rec, kind);
    const started_at = String(g.started?.started_at || rec?.started_at || "");
    const ended_at = String(rec?.ended_at || "");
    const a = ms(started_at), b = ms(ended_at);
    out.push({
      id: `${rid}:${key}`,
      run_id: rid,
      step_id: String(rec?.step_id || ""),
      node_id: String(rec?.node_id || ""),
      kind,
      effect_type,
      event_name,
      status: String(rec?.status || ""),
      cursor: g.cursor,
      started_at,
      ended_at,
      duration_ms: a !== null && b !== null ? Math.max(0, b - a) : null,
      started: g.started,
      record: rec,
      failed,
      housekeeping: is_housekeeping(kind, event_name, failed),
      cycle,
      unresolved: resolved.unresolved,
      unverified: resolved.unverified,
    });
  }
  return out;
}

export type CycleGroup = { cycle: number; steps: RunStep[]; llm: RunStep | null };

/** One group per agent cycle: an LLM call and the steps that follow it until the next LLM call. */
export function group_by_cycle(steps: RunStep[]): CycleGroup[] {
  const out: CycleGroup[] = [];
  for (const s of steps) {
    let g = out[out.length - 1];
    if (!g || g.cycle !== s.cycle) {
      g = { cycle: s.cycle, steps: [], llm: null };
      out.push(g);
    }
    if (s.kind === "llm_call" && !g.llm) g.llm = s;
    g.steps.push(s);
  }
  return out;
}

// --- filters + search ---

export type StepFilter = "all" | "llm" | "tools" | "failed";
export type RunViewState = { view: "cycles" | "steps"; only: StepFilter; all_steps: boolean; q: string };
export const DEFAULT_RUN_VIEW_STATE: RunViewState = { view: "cycles", only: "all", all_steps: false, q: "" };

export function filter_steps(steps: RunStep[], state: Pick<RunViewState, "only" | "all_steps" | "q">, search_text: (s: RunStep) => string): RunStep[] {
  const q = String(state.q || "").trim().toLowerCase();
  return steps.filter((s) => {
    if (state.only === "llm" && s.kind !== "llm_call") return false;
    if (state.only === "tools" && s.kind !== "tool") return false;
    if (state.only === "failed" && !s.failed) return false;
    if (state.only === "all" && !state.all_steps && s.housekeeping) return false;
    if (q && !search_text(s).includes(q)) return false;
    return true;
  });
}

const FILTERS: StepFilter[] = ["all", "llm", "tools", "failed"];

/** `#run/<id>?view=steps&only=llm&all=1&q=text` → state (unknown values fall back to the defaults). */
export function parse_run_view_hash(hash: string): RunViewState {
  const h = String(hash || "");
  const qi = h.indexOf("?");
  if (qi < 0) return { ...DEFAULT_RUN_VIEW_STATE };
  const p = new URLSearchParams(h.slice(qi + 1));
  const only = String(p.get("only") || "") as StepFilter;
  return {
    view: p.get("view") === "steps" ? "steps" : "cycles",
    only: FILTERS.includes(only) ? only : "all",
    all_steps: p.get("all") === "1",
    q: String(p.get("q") || ""),
  };
}

/** The hash for a run + state; default values are omitted so a plain run link stays `#run/<id>`. */
export function run_view_hash(run_hash: string, state: RunViewState): string {
  const base = String(run_hash || "").split("?")[0];
  const p = new URLSearchParams();
  if (state.view !== "cycles") p.set("view", state.view);
  if (state.only !== "all") p.set("only", state.only);
  if (state.all_steps) p.set("all", "1");
  if (state.q.trim()) p.set("q", state.q);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

// --- card content ---

export type ChatMessage = { role: string; content: string; tool_calls?: Array<{ name: string; arguments: any }>; name?: string };
export type ToolOffered = { name: string; description: string; schema: any };
export type LlmDetail = {
  provider: string;
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  system: string;
  messages: ChatMessage[];
  /** Where the messages come from: "sent" = the provider request as sent; "payload" = the runtime's effect payload. */
  messages_source: "sent" | "payload" | "";
  tools: ToolOffered[];
  response: string;
  tool_calls: Array<{ name: string; arguments: any }>;
  reasoning: string;
  /** Why the prompt body is not shown (never silent). */
  missing: string[];
  unverified: string[];
};

function text_of(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : p?.type ? `[${String(p.type)}]` : JSON.stringify(p)))
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content, null, 2);
}

function parse_args(raw: any): any {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function norm_tool_calls(list: any): Array<{ name: string; arguments: any }> {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === "object")
    .map((t) => ({ name: String(t.name || t.function?.name || "?"), arguments: parse_args(t.arguments ?? t.function?.arguments) }));
}

function norm_message(m: any): ChatMessage {
  const out: ChatMessage = { role: String(m?.role || "?"), content: text_of(m?.content) };
  const calls = norm_tool_calls(m?.tool_calls);
  if (calls.length) out.tool_calls = calls;
  if (m?.name) out.name = String(m.name);
  return out;
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== undefined ? n : null;
}

/** Record paths that hold the prompt body; an unresolved marker on one of them is said on screen. */
const PROMPT_BODY_PATHS: Readonly<Record<string, string>> = {
  "effect.payload.system_prompt": "System",
  "effect.payload.messages": "Messages",
  "effect.payload.prompt": "Prompt",
  "effect.payload.tools": "Tools offered",
  "result.metadata._provider_request.payload.messages": "Messages sent",
};

/** The full request and answer of one LLM call step, with `$slim` bodies already resolved. */
export function llm_detail(step: RunStep): LlmDetail {
  const rec = step.record || {};
  const payload = (step.started?.effect?.payload && typeof step.started.effect.payload === "object" ? step.started.effect.payload : rec?.effect?.payload) || {};
  const result = rec?.result && typeof rec.result === "object" ? rec.result : {};
  const usage = result.usage || result.token_usage || {};
  const missing: string[] = [];
  const unverified = step.unverified.map((u) => `${u.path}: ${u.reason}`);
  for (const u of step.unresolved) {
    const label = PROMPT_BODY_PATHS[u.path];
    if (label) missing.push(`${label}: ${u.reason}`);
  }

  const sent = result?.metadata?._provider_request?.payload;
  let system = "";
  let messages: ChatMessage[] = [];
  let messages_source: LlmDetail["messages_source"] = "";
  if (sent && Array.isArray(sent.messages)) {
    messages_source = "sent";
    for (const m of sent.messages) {
      if (String(m?.role || "") === "system" && !messages.length) system += (system ? "\n\n" : "") + text_of(m.content);
      else messages.push(norm_message(m));
    }
  } else if (Array.isArray(payload.messages) || typeof payload.prompt === "string") {
    messages_source = "payload";
    messages = (Array.isArray(payload.messages) ? payload.messages : []).map(norm_message);
    if (typeof payload.prompt === "string" && payload.prompt.trim()) messages.push({ role: "user", content: payload.prompt });
  }
  if (!system && typeof payload.system_prompt === "string") system = payload.system_prompt;
  const tools_raw = Array.isArray(payload.tools) ? payload.tools : Array.isArray(sent?.tools) ? sent.tools : [];
  const tools: ToolOffered[] = tools_raw
    .filter((t: any) => t && typeof t === "object")
    .map((t: any) => {
      const f = t.function && typeof t.function === "object" ? t.function : t;
      return { name: String(f.name || "?"), description: String(f.description || ""), schema: f.parameters ?? f.input_schema ?? null };
    });
  return {
    provider: String(payload.provider || result.provider || ""),
    model: String(payload.model || result.model || ""),
    tokens_in: num(usage.prompt_tokens ?? usage.input_tokens),
    tokens_out: num(usage.completion_tokens ?? usage.output_tokens),
    system,
    messages,
    messages_source,
    tools,
    response: text_of(result.content ?? result.response ?? ""),
    tool_calls: norm_tool_calls(result.tool_calls),
    reasoning: text_of(result.reasoning ?? result?.metadata?.reasoning ?? ""),
    missing,
    unverified,
  };
}

export type ToolDetail = {
  calls: Array<{ name: string; arguments: any; call_id: string }>;
  results: Array<{ name: string; success: boolean | null; output: string; error: string; call_id: string }>;
};

export function tool_detail(step: RunStep): ToolDetail {
  const payload = step.record?.effect?.payload || step.started?.effect?.payload || {};
  const calls = (Array.isArray(payload.tool_calls) ? payload.tool_calls : []).map((c: any) => ({
    name: String(c?.name || c?.function?.name || "?"),
    arguments: parse_args(c?.arguments ?? c?.function?.arguments),
    call_id: String(c?.call_id || c?.id || ""),
  }));
  const results = tool_results(step.record).map((r: any) => ({
    name: String(r?.name || "?"),
    success: typeof r?.success === "boolean" ? r.success : null,
    output: r?.output == null ? "" : text_of(r.output),
    error: r?.error == null ? "" : text_of(r.error),
    call_id: String(r?.call_id || ""),
  }));
  return { calls, results };
}

function args_preview(args: any): string {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return Object.entries(args)
      .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`)
      .join(", ");
  }
  return typeof args === "string" ? args : JSON.stringify(args ?? "");
}

export function subflow_child_id(rec: any): string {
  const wait = rec?.result?.wait;
  const fromKey = typeof wait?.wait_key === "string" && wait.wait_key.startsWith("subworkflow:") ? wait.wait_key.slice("subworkflow:".length) : "";
  return String(wait?.details?.sub_run_id || rec?.result?.sub_run_id || fromKey || "").trim();
}

/** The ONE line of substance a collapsed card shows. */
export function step_substance(step: RunStep): string {
  const rec = step.record || {};
  switch (step.kind) {
    case "llm_call": {
      const d = llm_detail(step);
      const tok = d.tokens_in !== null || d.tokens_out !== null ? `${(d.tokens_in ?? 0).toLocaleString("en-US")} in / ${(d.tokens_out ?? 0).toLocaleString("en-US")} out` : "";
      return [d.model, tok].filter(Boolean).join(" · ");
    }
    case "tool": {
      const calls = tool_detail(step).calls;
      if (!calls.length) return "";
      const first = `${calls[0].name}(${args_preview(calls[0].arguments)})`;
      return calls.length > 1 ? `${first} +${calls.length - 1} more` : first;
    }
    case "event":
      return step.event_name;
    case "subflow": {
      const child = subflow_child_id(rec);
      const wf = String(rec?.effect?.payload?.workflow_id || "");
      return [wf, child].filter(Boolean).join(" · ");
    }
    case "wait":
    case "resume":
      return String(rec?.result?.wait?.reason || rec?.effect?.payload?.reason || "");
    case "ask":
      return String(rec?.effect?.payload?.prompt || "");
    case "answer":
      return String(rec?.effect?.payload?.message || rec?.result?.message || "");
    default:
      return step.effect_type;
  }
}

/** Everything a search may match for one step: the card text plus the expanded bodies (lower-cased). */
export function step_search_text(step: RunStep, node_label: string): string {
  const parts = [step.kind, step.effect_type, step.event_name, step.node_id, node_label, step.status, step_substance(step)];
  try {
    parts.push(JSON.stringify(step.started?.effect?.payload ?? null));
    parts.push(JSON.stringify(step.record ?? null));
  } catch {
    // circular data cannot come from JSON ledgers; ignore
  }
  return parts.join("\n").toLowerCase();
}

export { HOUSEKEEPING_EVENT_NAMES };
