import React, { useEffect, useMemo, useRef, useState } from "react";

import { AgentCyclesPanel, build_agent_trace, type LedgerRecordItem } from "@abstractuic/monitor-flow";
import { ChatComposer, ChatThread, Markdown, chatToMarkdown, copyText, downloadTextFile } from "@abstractuic/panel-chat";
import { AfSelect, ProviderModelSelect, ThemeSelect, applyTheme, type AfSelectOption, type ProviderOption } from "@abstractuic/ui-kit";
import { registerMonitorGpuWidget } from "@abstractutils/monitor-gpu";

import { GatewayClient } from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import { McpWorkerClient } from "../lib/mcp_worker_client";
import { extract_emit_event, extract_tool_calls_from_wait, extract_wait_from_record } from "../lib/runtime_extractors";
import { LedgerStreamEvent, StepRecord, ToolCall, ToolResult, WaitState } from "../lib/types";
import { FlowGraph } from "./flow_graph";
import { JsonViewer } from "./json_viewer";
import { BacklogBrowserPage } from "./backlog_browser";
import { MindmapPanel } from "./mindmap_panel";
import { Modal } from "./modal";
import { MultiSelect } from "./multi_select";
import { ReportInboxPage } from "./report_inbox";
import { RunPicker, type RunSummary } from "./run_picker";

type Settings = {
  gateway_url: string;
  auth_token: string;
  worker_url: string;
  worker_token: string;
  theme: string;
  auto_connect_gateway: boolean;
  maintenance_ai_provider: string;
  maintenance_ai_model: string;
};

type UiLogItem = {
  id: string;
  ts: string;
  kind: "step" | "event" | "message" | "error" | "info";
  title: string;
  preview?: string;
  data?: any;
  cursor?: number;
  run_id?: string;
  node_id?: string;
  status?: string;
  effect_type?: string;
  emit_name?: string;
};

type BundlePinDef = {
  id: string;
  label?: string;
  type?: string;
  default?: any;
};

type BundleEntrypoint = {
  flow_id?: string;
  workflow_id?: string | null;
  name?: string | null;
  description?: string;
  interfaces?: string[];
  inputs?: BundlePinDef[];
  node_index?: Record<string, any>;
};

type BundleInfo = {
  bundle_id?: string;
  bundle_version?: string;
  bundle_ref?: string;
  created_at?: string;
  default_entrypoint?: string | null;
  entrypoints?: BundleEntrypoint[];
  flows?: string[];
  metadata?: any;
};

type WorkflowOption = {
  workflow_id: string; // bundle_id:flow_id
  bundle_id: string;
  flow_id: string;
  label: string;
  description?: string;
};

function now_iso(): string {
  return new Date().toISOString();
}

function safe_json(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function safe_json_inline(v: any, max_len: number): string {
  try {
    const s = JSON.stringify(v);
    if (typeof s !== "string") return String(v);
    if (s.length <= max_len) return s;
    return `${s.slice(0, Math.max(0, max_len - 1))}…`;
  } catch {
    const s = String(v);
    if (s.length <= max_len) return s;
    return `${s.slice(0, Math.max(0, max_len - 1))}…`;
  }
}

function parse_namespaced_workflow_id(workflow_id: string): { bundle_id: string; flow_id: string } | null {
  const s = String(workflow_id || "").trim();
  const idx = s.indexOf(":");
  if (idx <= 0 || idx >= s.length - 1) return null;
  return { bundle_id: s.slice(0, idx), flow_id: s.slice(idx + 1) };
}

function normalize_ui_event_name(name: string): string {
  const s = String(name || "").trim();
  if (s.startsWith("abstractcode.")) return `abstract.${s.slice("abstractcode.".length)}`;
  return s;
}

function is_ui_event_name(name: string): boolean {
  const s = String(name || "").trim();
  return s.startsWith("abstract.") || s.startsWith("abstractcode.");
}

function event_name_from_wait_key(wait_key: string): string {
  const wk = String(wait_key || "").trim();
  if (wk.startsWith("evt:")) {
    const parts = wk.split(":", 4);
    if (parts.length === 4 && parts[3]) return String(parts[3]).trim();
  }
  return wk;
}

function extract_start_pins_from_visualflow(raw: any): BundlePinDef[] {
  if (!raw || typeof raw !== "object") return [];
  const nodes = Array.isArray((raw as any).nodes) ? (raw as any).nodes : [];
  if (!nodes.length) return [];

  let start_node: any = null;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const data = n.data && typeof n.data === "object" ? n.data : {};
    const nt = String((data as any).nodeType || n.type || "").trim();
    if (nt === "on_flow_start") {
      start_node = n;
      break;
    }
  }
  if (!start_node) return [];

  const data = start_node.data && typeof start_node.data === "object" ? start_node.data : {};
  const outputs = Array.isArray((data as any).outputs) ? (data as any).outputs : [];
  const pin_defaults = data.pinDefaults && typeof data.pinDefaults === "object" ? data.pinDefaults : {};

  const out: BundlePinDef[] = [];
  for (const p of outputs) {
    if (!p || typeof p !== "object") continue;
    const pid = String((p as any).id || "").trim();
    if (!pid) continue;
    const ptype = String((p as any).type || "").trim();
    if (ptype === "execution" || pid === "exec-out" || pid === "exec") continue;
    const label = String((p as any).label || pid).trim() || pid;
    const item: BundlePinDef = { id: pid, label, type: ptype || "unknown" };
    if (pin_defaults && Object.prototype.hasOwnProperty.call(pin_defaults, pid)) {
      item.default = (pin_defaults as any)[pid];
    }
    out.push(item);
  }
  return out;
}

function clamp_preview(text: string, opts?: { max_chars?: number; max_lines?: number }): string {
  const max_chars = typeof opts?.max_chars === "number" ? opts.max_chars : 360;
  const max_lines = typeof opts?.max_lines === "number" ? opts.max_lines : 2;
  const raw = String(text || "");
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const head = lines.slice(0, Math.max(1, max_lines)).join("\n");
  const more_lines = lines.length > max_lines;
  const trimmed = head.length > max_chars ? `${head.slice(0, Math.max(0, max_chars - 1))}…` : head;
  if (more_lines && trimmed === head) return `${head}…`;
  return trimmed;
}

function short_id(id: string, keep: number): string {
  const s = String(id || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

const _SAFE_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function _is_safe_run_id(value: string): boolean {
  return _SAFE_RUN_ID_PATTERN.test(String(value || "").trim());
}

async function _sha256_hex(text: string): Promise<string> {
  const payload = String(text || "");
  const enc = new TextEncoder().encode(payload);
  const c: any = (globalThis as any).crypto;
  if (!c || !c.subtle || typeof c.subtle.digest !== "function") throw new Error("crypto.subtle.digest not available");
  const digest = await c.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function session_memory_run_id(session_id: string): Promise<string> {
  const sid = String(session_id || "").trim();
  if (!sid) throw new Error("session_id is required");
  if (_is_safe_run_id(sid)) {
    const rid = `session_memory_${sid}`;
    if (_is_safe_run_id(rid)) return rid;
  }
  const digest = await _sha256_hex(sid);
  return `session_memory_sha_${digest.slice(0, 32)}`;
}

function sanitize_filename_part(value: string): string {
  const s = String(value || "").trim();
  if (!s) return "untitled";
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "untitled";
}

function extract_textish(payload: any): { text: string; duration: number } {
  if (typeof payload === "string") return { text: payload, duration: -1 };
  if (payload && typeof payload === "object") {
    const text =
      typeof (payload as any).text === "string"
        ? String((payload as any).text)
        : typeof (payload as any).value === "string"
          ? String((payload as any).value)
          : typeof (payload as any).message === "string"
            ? String((payload as any).message)
            : safe_json_inline(payload, 320);
    const duration = typeof (payload as any).duration === "number" ? Number((payload as any).duration) : -1;
    return { text, duration };
  }
  return { text: safe_json_inline(payload, 320), duration: -1 };
}

function extract_response_text_from_record(rec: any): string {
  if (!rec || typeof rec !== "object") return "";
  const eff_type = String(rec?.effect?.type || "").trim();
  const result = rec?.result;

  const pick_text = (v: any): string => {
    if (typeof v === "string") return v.trim();
    if (v == null) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  };

  const pick_from_obj = (obj: any): string => {
    if (!obj || typeof obj !== "object") return "";
    const o: any = obj;
    const candidates = [o.response, o.answer, o.message, o.text, o.content];
    for (const c of candidates) {
      const t = pick_text(c);
      if (t) return t;
    }
    return "";
  };

  if (eff_type === "answer_user") {
    const t =
      pick_text(result?.message) ||
      pick_text(result?.output?.message) ||
      pick_text(result?.output?.response) ||
      pick_text(rec?.effect?.payload?.message) ||
      pick_text(rec?.effect?.payload?.text) ||
      pick_text(rec?.effect?.payload?.content);
    if (t) return t;
  }

  if (eff_type === "llm_call") {
    const t =
      pick_from_obj(result) ||
      pick_text(result?.output) ||
      pick_from_obj(result?.output) ||
      pick_text(result?.response);
    if (t) return t;
  }

  const t =
    pick_text(result?.output) ||
    pick_from_obj(result?.output) ||
    pick_from_obj(result) ||
    pick_text(result?.response);
  return t;
}

const CONDENSED_HIDE_EMIT_NAMES = new Set(["abstract.status", "abstract.summary", "abstract.chat"]);

function is_condensed_ledger_item(item: UiLogItem): boolean {
  if (!item) return false;
  if (item.kind === "error") return true;
  if (item.kind === "info") return false;

  const emit_name = String(item.emit_name || "").trim();
  if ((item.kind === "event" || item.kind === "message") && emit_name) {
    if (CONDENSED_HIDE_EMIT_NAMES.has(emit_name)) return false;
    return true;
  }

  const effect_type = String(item.effect_type || "").trim();
  if (effect_type) {
    if (effect_type === "tool_calls") return true;
    if (effect_type === "llm_call") return true;
    if (effect_type === "ask_user") return true;
    if (effect_type === "answer_user") return true;
    if (effect_type === "memory_compact") return true;
    if (effect_type === "start_subworkflow") return true;
    if (effect_type === "emit_event") {
      if (emit_name && CONDENSED_HIDE_EMIT_NAMES.has(emit_name)) return false;
      return true;
    }
  }

  const status = String(item.status || "").trim();
  if (status === "waiting") {
    const w = extract_wait_from_record(item.data);
    const reason = String(w?.reason || "").trim();
    if (reason === "user" || reason === "event") return true;
    const tool_calls = extract_tool_calls_from_wait(w);
    if (tool_calls.length) return true;
    return false;
  }

  const resp = extract_response_text_from_record(item.data);
  return Boolean(resp);
}

function load_settings(): Settings {
  try {
    const raw = localStorage.getItem("abstractobserver_settings");
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw);
    return {
      gateway_url: String(parsed?.gateway_url || ""),
      auth_token: String(parsed?.auth_token || ""),
      worker_url: String(parsed?.worker_url || ""),
      worker_token: String(parsed?.worker_token || ""),
      theme: String(parsed?.theme || "dark"),
      auto_connect_gateway: parsed?.auto_connect_gateway === false ? false : true,
      maintenance_ai_provider: String(parsed?.maintenance_ai_provider || ""),
      maintenance_ai_model: String(parsed?.maintenance_ai_model || ""),
    };
  } catch {
    return {
      gateway_url: "",
      auth_token: "",
      worker_url: "",
      worker_token: "",
      theme: "dark",
      auto_connect_gateway: true,
      maintenance_ai_provider: "",
      maintenance_ai_model: "",
    };
  }
}

function save_settings(s: Settings): void {
  localStorage.setItem("abstractobserver_settings", JSON.stringify(s));
}

function format_step_summary(rec: StepRecord): string {
  const node = String(rec?.node_id || "");
  const st = String(rec?.status || "");
  const eff = String(rec?.effect?.type || "");
  return `${node || "(node?)"} • ${st || "(status?)"} • ${eff || "(effect?)"}`;
}

function is_waiting_status(rec: StepRecord | null): boolean {
  return Boolean(rec && String(rec.status || "") === "waiting");
}

function parse_iso_ms(ts: any): number | null {
  const s = typeof ts === "string" ? ts.trim() : "";
  if (!s) return null;
  // Some backends emit ISO timestamps with microseconds (e.g. `.123456Z`).
  // JS `Date.parse` can be picky across environments; clamp to milliseconds.
  const normalized = s.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function format_relative_time_from_ms(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days <= 3) return `${days}d ago`;

  // Beyond 3 days, show date (matches AbstractFlow's "history" feel and avoids stale "Xd ago").
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function format_time_ago(ts: any): string {
  const ms = parse_iso_ms(ts);
  if (ms === null) return "—";
  return format_relative_time_from_ms(ms);
}

function format_time_until_from_ms(ms_until: number): string {
  if (!Number.isFinite(ms_until)) return "";
  const total_s = Math.floor(ms_until / 1000);
  if (total_s <= 0) return "now";

  const total_m = Math.floor(total_s / 60);
  const total_h = Math.floor(total_m / 60);
  const total_d = Math.floor(total_h / 24);

  const s = total_s % 60;
  const m = total_m % 60;
  const h = total_h % 24;

  if (total_d > 0) return `${total_d}d ${h}h`;
  if (total_h > 0) return `${total_h}h ${m}m`;
  if (total_m > 0) return `${total_m}m ${s}s`;
  return `${total_s}s`;
}

function short_run_id(run_id: string): string {
  const s = String(run_id || "").trim();
  if (!s) return "";
  if (s.length <= 8) return s;
  return `${s.slice(0, 7)}…`;
}

function extract_workflow_label(workflow_id: any, label_map: Record<string, string>): string {
  const wid = typeof workflow_id === "string" ? String(workflow_id).trim() : "";
  if (!wid) return "Unknown workflow";

  const mapped = label_map[wid];
  if (mapped) {
    const parts = mapped.split(/[·:]/);
    return parts.length > 1 ? parts[parts.length - 1].trim() : mapped.trim();
  }

  const idx = wid.indexOf(":");
  if (idx > 0) return wid.slice(idx + 1).trim() || wid.slice(0, idx).trim();

  if (/[a-z]/i.test(wid)) return wid;

  return "Unknown workflow";
}

function is_uuid(s: string): boolean {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function parse_run_id_from_url(): string {
  try {
    const hash = String(window.location.hash || "").replace(/^#/, "");
    const hash_parts = hash.split("/").filter(Boolean);
    const hash_last = hash_parts.length ? String(hash_parts[hash_parts.length - 1] || "").trim() : "";
    if (is_uuid(hash_last)) return hash_last;

    const path = String(window.location.pathname || "");
    const parts = path.split("/").filter(Boolean);
    const last = parts.length ? String(parts[parts.length - 1] || "").trim() : "";
    if (is_uuid(last)) return last;
  } catch {
    // ignore
  }
  return "";
}

function getOrCreateStableSessionId(): string {
  // Session scope is powered by RunState.session_id (host contract).
  // For AbstractObserver, default to a stable-per-tab session id so workflows
  // started from the UI can share `scope=session` memory when desired.
  try {
    const key = "abstractobserver_session_id_v1";
    const existing = window.sessionStorage.getItem(key);
    if (existing && existing.trim()) return existing.trim();

    const c: any = (globalThis as any).crypto;
    const uuid =
      c && typeof c.randomUUID === "function"
        ? c.randomUUID()
        : `${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    const next = `obs_${uuid}`;
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return "";
  }
}

export function App(): React.ReactElement {
  const [page, set_page] = useState<"observe" | "launch" | "mindmap" | "backlog" | "inbox" | "settings">("observe");

  const [settings, set_settings] = useState<Settings>(() => load_settings());
  const monitor_gpu_enabled = typeof window !== "undefined" && window.__ABSTRACT_UI_CONFIG__?.monitor_gpu === true;
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);
  const [run_id, set_run_id] = useState<string>("");
  const [root_run_id, set_root_run_id] = useState<string>("");
  const [pending_url_run_id, set_pending_url_run_id] = useState<string>(() => parse_run_id_from_url());
  const [flow_id, set_flow_id] = useState<string>("");
  const [bundle_id, set_bundle_id] = useState<string>("");
  const [input_data_text, set_input_data_text] = useState<string>("{}");
  const [start_session_id, set_start_session_id] = useState<string>(() => getOrCreateStableSessionId());

  const [bundle_info, set_bundle_info] = useState<BundleInfo | null>(null);
  const [bundle_loading, set_bundle_loading] = useState(false);
  const [bundle_error, set_bundle_error] = useState<string>("");

  const [discovery_loading, set_discovery_loading] = useState(false);
  const [discovery_error, set_discovery_error] = useState<string>("");
  const [gateway_connected, set_gateway_connected] = useState(false);
  const [workflow_options, set_workflow_options] = useState<WorkflowOption[]>([]);
  const [run_options, set_run_options] = useState<RunSummary[]>([]);
  const [runs_loading, set_runs_loading] = useState(false);
  const [bundles_reloading, set_bundles_reloading] = useState(false);
  const [discovered_tool_specs, set_discovered_tool_specs] = useState<any[]>([]);
  const [discovered_providers, set_discovered_providers] = useState<any[]>([]);
  const [discovered_models_by_provider, set_discovered_models_by_provider] = useState<Record<string, { models: string[]; error?: string }>>({});

  const [connected, set_connected] = useState(false);
  const [connecting, set_connecting] = useState(false);
  const [resuming, set_resuming] = useState(false);
  const [cursor, set_cursor] = useState<number>(0);
  const [records, set_records] = useState<Array<{ cursor: number; record: StepRecord }>>([]);
  const [child_records_for_digest, set_child_records_for_digest] = useState<Array<{ run_id: string; cursor: number; record: StepRecord }>>([]);
  const cursor_ref = useRef<number>(0);
  const [run_state, set_run_state] = useState<any>(null);

  const [new_run_error, set_new_run_error] = useState<string>("");
  const [schedule_error, set_schedule_error] = useState<string>("");
  const [schedule_submitting, set_schedule_submitting] = useState(false);
  const [bundle_uploading, set_bundle_uploading] = useState(false);
  const bundle_upload_input_ref = useRef<HTMLInputElement | null>(null);

  const [pin_json_text_by_id, set_pin_json_text_by_id] = useState<Record<string, string>>({});
  const [pin_json_error_by_id, set_pin_json_error_by_id] = useState<Record<string, string>>({});
  const [schedule_start_mode, set_schedule_start_mode] = useState<"now" | "at">("now");
  const [schedule_start_at_local, set_schedule_start_at_local] = useState<string>("");
  const [schedule_repeat_mode, set_schedule_repeat_mode] = useState<"once" | "forever" | "count" | "until">("once");
  const [schedule_every_n, set_schedule_every_n] = useState<number>(1);
  const [schedule_every_unit, set_schedule_every_unit] = useState<"minutes" | "hours" | "days" | "weeks" | "months">("days");
  const [schedule_repeat_count, set_schedule_repeat_count] = useState<number>(2);
  const [schedule_repeat_until_date_local, set_schedule_repeat_until_date_local] = useState<string>("");
  const [schedule_repeat_until_time_local, set_schedule_repeat_until_time_local] = useState<string>("23:59");
  const [schedule_share_context, set_schedule_share_context] = useState<boolean>(true);
  const [schedule_edit_open, set_schedule_edit_open] = useState(false);
  const [schedule_edit_interval, set_schedule_edit_interval] = useState<string>("");
  const [schedule_edit_apply_immediately, set_schedule_edit_apply_immediately] = useState<boolean>(true);
  const [schedule_edit_error, set_schedule_edit_error] = useState<string>("");
  const [schedule_edit_submitting, set_schedule_edit_submitting] = useState(false);

  const [compact_open, set_compact_open] = useState(false);
  const [compact_preserve_recent, set_compact_preserve_recent] = useState<number>(6);
  const [compact_mode, set_compact_mode] = useState<"light" | "standard" | "heavy">("standard");
  const [compact_focus, set_compact_focus] = useState<string>("");
  const [compact_error, set_compact_error] = useState<string>("");
  const [compact_submitting, set_compact_submitting] = useState(false);
  const [run_control_open, set_run_control_open] = useState(false);
  const [run_control_type, set_run_control_type] = useState<"pause" | "cancel">("pause");
  const [run_control_reason, set_run_control_reason] = useState<string>("");
  const [run_control_error, set_run_control_error] = useState<string>("");

  const [status_text, set_status_text] = useState<string>("");
  const status_timer_ref = useRef<number | null>(null);
  const status_pulse_timer_ref = useRef<number | null>(null);
  const [status_pulse, set_status_pulse] = useState(false);
  const dismiss_timer_ref = useRef<number | null>(null);
  const [dismissed_wait_key, set_dismissed_wait_key] = useState<string>("");

  const [chat_input, set_chat_input] = useState<string>("");
  const [chat_error, set_chat_error] = useState<string>("");
  const [chat_sending, set_chat_sending] = useState<boolean>(false);
  const [chat_export_state, set_chat_export_state] = useState<"idle" | "copied" | "failed">("idle");
  const [chat_messages, set_chat_messages] = useState<Array<{ id: string; role: "user" | "assistant"; content: string; ts: string }>>([]);
  const [chat_thread_saving, set_chat_thread_saving] = useState(false);
  const [chat_thread_save_error, set_chat_thread_save_error] = useState<string>("");
  const [chat_thread_last_saved_at, set_chat_thread_last_saved_at] = useState<string>("");
  const [chat_thread_last_saved_fingerprint, set_chat_thread_last_saved_fingerprint] = useState<string>("");

  const [saved_chat_threads, set_saved_chat_threads] = useState<
    Array<{
      thread_id: string;
      created_at: string;
      title: string;
      run_id: string;
      workflow_id: string;
      message_count: number | null;
      provider: string;
      model: string;
      artifact_id: string;
    }>
  >([]);
  const [saved_chat_threads_loading, set_saved_chat_threads_loading] = useState(false);
  const [saved_chat_threads_error, set_saved_chat_threads_error] = useState<string>("");
  const [saved_chat_thread_selected, set_saved_chat_thread_selected] = useState<string>("");
  const [saved_chat_thread_loading, set_saved_chat_thread_loading] = useState(false);
  const [saved_chat_thread_load_error, set_saved_chat_thread_load_error] = useState<string>("");

  const chat_fingerprint = useMemo(() => {
    if (!chat_messages.length) return "";
    try {
      return JSON.stringify(chat_messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts })));
    } catch {
      return "1";
    }
  }, [chat_messages]);

  const chat_has_unsaved_changes = useMemo(() => {
    if (!chat_messages.length) return false;
    if (!chat_thread_last_saved_fingerprint) return true;
    return chat_fingerprint !== chat_thread_last_saved_fingerprint;
  }, [chat_fingerprint, chat_messages.length, chat_thread_last_saved_fingerprint]);

  const saved_chat_thread_options: AfSelectOption[] = useMemo(() => {
    return saved_chat_threads.map((t) => {
      const title = String(t.title || "").trim() || `Chat ${String(t.thread_id || "").slice(0, 8)}`;
      const created = String(t.created_at || "").trim();
      const created_label = created ? created.replace("T", " ").slice(0, 19) : "";
      const run_short = String(t.run_id || "").trim() ? String(t.run_id).slice(0, 8) : "";
      const label = [title, created_label && `(${created_label})`, run_short && `run ${run_short}`].filter(Boolean).join(" • ");
      return { value: String(t.thread_id || ""), label };
    });
  }, [saved_chat_threads]);

  useEffect(() => {
    if (!monitor_gpu_enabled) return;
    registerMonitorGpuWidget();
  }, [monitor_gpu_enabled]);

  useEffect(() => {
    if (!monitor_gpu_enabled) return;
    const el = monitor_gpu_ref.current as any;
    if (el) el.token = settings.auth_token || "";
  }, [monitor_gpu_enabled, settings.auth_token]);

  const [log, set_log] = useState<UiLogItem[]>([]);
  const [log_open, set_log_open] = useState<Record<string, boolean>>({});
  const [log_response_open, set_log_response_open] = useState<Record<string, boolean>>({});
  const [error_text, set_error_text] = useState<string>("");

  const [right_tab, set_right_tab] = useState<"ledger" | "mindmap" | "graph" | "digest" | "attachments" | "chat">("ledger");
  const [ledger_condensed, set_ledger_condensed] = useState(true);
  const [ledger_view, set_ledger_view] = useState<"steps" | "cycles">("steps");
  const [ledger_cycles_run_id, set_ledger_cycles_run_id] = useState<string>("");
  const [session_attachments_run_id, set_session_attachments_run_id] = useState<string>("");
  const [session_attachments, set_session_attachments] = useState<any[]>([]);
  const [session_attachments_loading, set_session_attachments_loading] = useState(false);
  const [session_attachments_error, set_session_attachments_error] = useState<string>("");
  const [attachment_preview_open, set_attachment_preview_open] = useState(false);
  const [attachment_preview_title, set_attachment_preview_title] = useState<string>("");
  const [attachment_preview_text, set_attachment_preview_text] = useState<string>("");
  const [attachment_preview_error, set_attachment_preview_error] = useState<string>("");
  const [attachment_preview_loading, set_attachment_preview_loading] = useState<boolean>(false);
  const [graph_flow_id, set_graph_flow_id] = useState<string>("");
  const [graph_flow, set_graph_flow] = useState<any | null>(null);
  const [graph_flow_cache, set_graph_flow_cache] = useState<Record<string, any>>({});
  const [graph_loading, set_graph_loading] = useState(false);
  const [graph_error, set_graph_error] = useState<string>("");
  const [graph_show_subflows, set_graph_show_subflows] = useState(false);
  const [graph_highlight_path, set_graph_highlight_path] = useState(false);
  const [graph_now_ms, set_graph_now_ms] = useState<number>(() => Date.now());
  const [active_node_id, set_active_node_id] = useState<string>("");
  const [recent_nodes, set_recent_nodes] = useState<Record<string, number>>({});
  const [visited_nodes, set_visited_nodes] = useState<Record<string, number>>({});
  const visited_order_ref = useRef<string[]>([]);
  const recent_prune_timer_ref = useRef<number | null>(null);
  const active_node_ref = useRef<string>("");
  const run_prefix_ref = useRef<Record<string, string>>({});
  const subrun_parent_ref = useRef<Record<string, string>>({});
  const subrun_spawn_ref = useRef<Record<string, { parent_run_id: string; parent_node_id: string }>>({});
  const subrun_ids_ref = useRef<Set<string>>(new Set());
  const [subrun_ids, set_subrun_ids] = useState<string[]>([]);
  const root_subrun_ref = useRef<string>("");
  const models_fetch_inflight_ref = useRef<Record<string, boolean>>({});

  const abort_ref = useRef<AbortController | null>(null);
  const child_abort_ref = useRef<AbortController | null>(null);
  const child_cursor_ref = useRef<number>(0);
  const subrun_cursor_ref = useRef<Record<string, number>>({});
  const subrun_poll_inflight_ref = useRef<boolean>(false);
  const digest_seen_ref = useRef<Set<string>>(new Set());
  const [following_child_run_id, set_following_child_run_id] = useState<string>("");
  const [follow_run_id, set_follow_run_id] = useState<string>("");
  const follow_run_ref = useRef<string>("");
  const [summary_generating, set_summary_generating] = useState(false);
  const [summary_error, set_summary_error] = useState<string>("");

  const gateway = useMemo(() => new GatewayClient({ base_url: settings.gateway_url, auth_token: settings.auth_token }), [settings]);
  const worker = useMemo(
    () => (settings.worker_url.trim() ? new McpWorkerClient({ url: settings.worker_url.trim(), auth_token: settings.worker_token }) : null),
    [settings.worker_url, settings.worker_token]
  );

  const last_record = records.length ? records[records.length - 1].record : null;
  const wait_state: WaitState | null = useMemo(() => extract_wait_from_record(last_record), [last_record]);

  const selected_entrypoint: BundleEntrypoint | null = useMemo(() => {
    const bid = bundle_id.trim();
    if (!bundle_info || !bid) return null;
    if (String(bundle_info.bundle_id || "").trim() && String(bundle_info.bundle_id || "").trim() !== bid) return null;
    const eps = Array.isArray(bundle_info.entrypoints) ? bundle_info.entrypoints : [];
    if (!eps.length) return null;
    const fid = flow_id.trim();
    if (fid) return eps.find((e) => String(e.flow_id || "").trim() === fid) || null;
    if (eps.length === 1) return eps[0];
    const de = String(bundle_info.default_entrypoint || "").trim();
    if (de) return eps.find((e) => String(e.flow_id || "").trim() === de) || null;
    return null;
  }, [bundle_info, bundle_id, flow_id]);

  const entrypoint_pins: BundlePinDef[] = useMemo(() => {
    const pins = selected_entrypoint?.inputs;
    return Array.isArray(pins) ? (pins as BundlePinDef[]) : [];
  }, [selected_entrypoint]);

  const flow_pins: BundlePinDef[] = useMemo(() => extract_start_pins_from_visualflow(graph_flow), [graph_flow]);
  const adaptive_pins: BundlePinDef[] = useMemo(() => (entrypoint_pins.length ? entrypoint_pins : flow_pins), [entrypoint_pins, flow_pins]);

  const node_index_for_run: Record<string, any> = useMemo(() => {
    const wid = typeof run_state?.workflow_id === "string" ? String(run_state.workflow_id) : "";
    const parsed = parse_namespaced_workflow_id(wid);
    if (parsed && bundle_info && String(bundle_info.bundle_id || "").trim() === parsed.bundle_id) {
      const eps = Array.isArray(bundle_info.entrypoints) ? bundle_info.entrypoints : [];
      const ep = eps.find((e) => String(e?.flow_id || "").trim() === parsed.flow_id);
      if (ep && ep.node_index && typeof ep.node_index === "object") return ep.node_index as any;
    }
    const idx = selected_entrypoint?.node_index;
    if (idx && typeof idx === "object") return idx as any;
    return {};
  }, [run_state, bundle_info, selected_entrypoint]);

  useEffect(() => {
    save_settings(settings);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    return () => {
      if (abort_ref.current) abort_ref.current.abort();
      if (child_abort_ref.current) child_abort_ref.current.abort();
      if (status_timer_ref.current) window.clearTimeout(status_timer_ref.current);
      if (status_pulse_timer_ref.current) window.clearTimeout(status_pulse_timer_ref.current);
      if (recent_prune_timer_ref.current) window.clearTimeout(recent_prune_timer_ref.current);
      if (dismiss_timer_ref.current) window.clearTimeout(dismiss_timer_ref.current);
    };
  }, []);

  useEffect(() => {
    if (!settings.auto_connect_gateway) return;
    if (!settings.gateway_url.trim() && typeof window !== "undefined" && !window.location?.origin) return;
    void on_discover_gateway();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.auto_connect_gateway]);

  const input_data_obj: Record<string, any> | null = useMemo(() => {
    const raw = input_data_text.trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [input_data_text]);
  const prompt_value = typeof input_data_obj?.prompt === "string" ? String(input_data_obj.prompt) : "";
  const provider_value = typeof input_data_obj?.provider === "string" ? String(input_data_obj.provider) : "";
  const model_value = typeof input_data_obj?.model === "string" ? String(input_data_obj.model) : "";
  const workspace_root_value = typeof input_data_obj?.workspace_root === "string" ? String(input_data_obj.workspace_root) : "";
  const workspace_access_mode_value =
    typeof input_data_obj?.workspace_access_mode === "string" ? String(input_data_obj.workspace_access_mode) : "";
  const workspace_ignored_paths_value = useMemo(() => {
    const raw = (input_data_obj as any)?.workspace_ignored_paths;
    if (Array.isArray(raw)) {
      return raw.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
    }
    if (typeof raw === "string") return String(raw);
    return "";
  }, [input_data_obj]);
  const has_adaptive_inputs = adaptive_pins.length > 0 && Boolean(bundle_id.trim());

  const is_json_pin_type = (t: string): boolean => {
    const s = String(t || "").trim().toLowerCase();
    return s === "object" || s === "memory" || s === "assertion" || s === "assertions" || s === "any";
  };

  useEffect(() => {
    // Reset per-pin editor errors when switching workflows.
    set_pin_json_error_by_id({});
  }, [bundle_id, flow_id]);

  useEffect(() => {
    if (input_data_obj === null) return;
    set_pin_json_text_by_id((prev) => {
      const next: Record<string, string> = {};
      for (const p of adaptive_pins) {
        if (!p || typeof p !== "object") continue;
        const pid = String((p as any).id || "").trim();
        if (!pid) continue;
        const ptype = String((p as any).type || "").trim();
        if (!is_json_pin_type(ptype)) continue;
        const cur_err = String(pin_json_error_by_id[pid] || "").trim();
        if (cur_err) {
          next[pid] = typeof prev[pid] === "string" ? prev[pid] : "";
          continue;
        }
        const cur_val = (input_data_obj as any)?.[pid];
        if (cur_val === undefined) {
          next[pid] = "";
        } else {
          next[pid] = safe_json(cur_val);
        }
      }
      return next;
    });
  }, [adaptive_pins, input_data_obj, pin_json_error_by_id]);

  const selected_workflow_value = bundle_id.trim() && flow_id.trim() ? `${bundle_id.trim()}:${flow_id.trim()}` : "";

  const workflow_label_by_id = useMemo(() => {
    const out: Record<string, string> = {};
    for (const w of workflow_options) {
      const key = String(w.workflow_id || "").trim();
      const label = String(w.label || "").trim();
      if (key && label) out[key] = label;
    }
    return out;
  }, [workflow_options]);

  const available_providers = useMemo(() => {
    const out = new Set<string>();
    for (const p of Array.isArray(discovered_providers) ? discovered_providers : []) {
      const name = String((p as any)?.name || "").trim();
      if (name) out.add(name);
    }
    return Array.from(out).sort();
  }, [discovered_providers]);

  const discovered_provider_options = useMemo((): ProviderOption[] => {
    const out: ProviderOption[] = [];
    for (const p of Array.isArray(discovered_providers) ? discovered_providers : []) {
      const name = String((p as any)?.name || "").trim();
      if (!name) continue;
      const display_name = String((p as any)?.display_name || "").trim();
      out.push({ name, display_name: display_name || undefined });
    }
    return out;
  }, [discovered_providers]);

  const available_tool_names = useMemo(() => {
    const out = new Set<string>();
    for (const s of discovered_tool_specs || []) {
      if (!s || typeof s !== "object") continue;
      const name = String((s as any).name || "").trim();
      if (name) out.add(name);
    }
    return Array.from(out).sort();
  }, [discovered_tool_specs]);

  const maintenance_models_for_provider = useMemo(() => {
    const prov = settings.maintenance_ai_provider.trim();
    if (!prov) return { models: [] as string[], error: "" };
    const found = discovered_models_by_provider[prov];
    if (!found) return { models: [] as string[], error: "" };
    const models = Array.isArray(found.models) ? found.models : [];
    return { models: models.map((x) => String(x || "").trim()).filter(Boolean), error: String((found as any).error || "") };
  }, [discovered_models_by_provider, settings.maintenance_ai_provider]);

  const maintenance_provider_selected = settings.maintenance_ai_provider.trim();
  const maintenance_models_loading = Boolean(
    maintenance_provider_selected && gateway_connected && !Object.prototype.hasOwnProperty.call(discovered_models_by_provider, maintenance_provider_selected)
  );

  useEffect(() => {
    const prov = provider_value.trim();
    if (!prov) return;
    if (discovered_models_by_provider[prov]) return;
    if (models_fetch_inflight_ref.current[prov]) return;
    models_fetch_inflight_ref.current[prov] = true;
    let stopped = false;
    const run = async () => {
      try {
        const res = await gateway.discovery_provider_models(prov);
        if (stopped) return;
        const models = Array.isArray(res?.models) ? res.models : [];
        const err = typeof res?.error === "string" ? String(res.error) : "";
        set_discovered_models_by_provider((prev) => ({ ...prev, [prov]: { models, error: err || undefined } }));
      } catch (e: any) {
        if (stopped) return;
        set_discovered_models_by_provider((prev) => ({ ...prev, [prov]: { models: [], error: String(e?.message || e || "Failed to load models") } }));
      } finally {
        delete models_fetch_inflight_ref.current[prov];
      }
    };
    run();
    return () => {
      stopped = true;
    };
  }, [provider_value, discovered_models_by_provider, gateway]);

  useEffect(() => {
    const prov = settings.maintenance_ai_provider.trim();
    if (!prov) return;
    if (!gateway_connected) return;
    if (discovered_models_by_provider[prov]) return;
    if (models_fetch_inflight_ref.current[prov]) return;
    models_fetch_inflight_ref.current[prov] = true;
    let stopped = false;
    const run = async () => {
      try {
        const res = await gateway.discovery_provider_models(prov);
        if (stopped) return;
        const models = Array.isArray(res?.models) ? res.models : [];
        const err = typeof res?.error === "string" ? String(res.error) : "";
        set_discovered_models_by_provider((prev) => ({ ...prev, [prov]: { models, error: err || undefined } }));
      } catch (e: any) {
        if (stopped) return;
        set_discovered_models_by_provider((prev) => ({
          ...prev,
          [prov]: { models: [], error: String(e?.message || e || "Failed to load models") },
        }));
      } finally {
        delete models_fetch_inflight_ref.current[prov];
      }
    };
    run();
    return () => {
      stopped = true;
    };
  }, [settings.maintenance_ai_provider, discovered_models_by_provider, gateway, gateway_connected]);

  function update_input_data_field(key: string, value: any): void {
    const k = String(key || "").trim();
    if (!k) return;

    let obj: Record<string, any> = {};
    try {
      const parsed = JSON.parse(input_data_text || "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) obj = parsed;
    } catch {
      obj = {};
    }

    if (value === null || value === undefined) {
      delete obj[k];
      set_input_data_text(JSON.stringify(obj, null, 2));
      return;
    }

    if (typeof value === "string") {
      const trimmed = String(value || "").trim();
      if (!trimmed) delete obj[k];
      else obj[k] = trimmed;
    } else if (Array.isArray(value)) {
      const cleaned = value.map((x) => x).filter((x) => x !== undefined && x !== null);
      if (!cleaned.length) delete obj[k];
      else obj[k] = cleaned;
    } else {
      obj[k] = value;
    }

    set_input_data_text(JSON.stringify(obj, null, 2));
  }

  async function load_bundle_info(bid_raw: string): Promise<BundleInfo | null> {
    const bid = String(bid_raw || "").trim();
    if (!bid) {
      set_bundle_error("Missing bundle_id");
      return null;
    }
    set_bundle_error("");
    set_bundle_loading(true);
    try {
      const info = (await gateway.get_bundle(bid)) as BundleInfo;
      set_bundle_info(info);
      push_log({ ts: now_iso(), kind: "info", title: `Loaded bundle ${bid}` });
      return info;
    } catch (e: any) {
      set_bundle_info(null);
      set_bundle_error(String(e?.message || e || "Failed to load bundle"));
      return null;
    } finally {
      set_bundle_loading(false);
    }
  }

  function build_workflow_options_from_bundles(resp: any): WorkflowOption[] {
    const out: WorkflowOption[] = [];
    const items = Array.isArray(resp?.items) ? resp.items : [];
    for (const b of items) {
      const bid = String(b?.bundle_id || "").trim();
      if (!bid) continue;
      const eps = Array.isArray(b?.entrypoints) ? b.entrypoints : [];
      if (!eps.length) continue;
      for (const ep of eps) {
        const fid = String(ep?.flow_id || "").trim();
        if (!fid) continue;
        const workflow_id = `${bid}:${fid}`;
        const name = String(ep?.name || "").trim();
        const label = name ? `${bid} · ${name}` : `${bid} · ${fid}`;
        const description = String(ep?.description || "").trim();
        out.push({ workflow_id, bundle_id: bid, flow_id: fid, label, description: description || undefined });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  async function refresh_runs(): Promise<void> {
    if (runs_loading) return;
    set_runs_loading(true);
    try {
      const runs = await gateway.list_runs({ limit: 200, root_only: true });
      const items = Array.isArray((runs as any)?.items) ? ((runs as any).items as any[]) : [];
      const next: RunSummary[] = items
        .map((r) => ({
          run_id: String(r?.run_id || "").trim(),
          workflow_id: typeof r?.workflow_id === "string" ? String(r.workflow_id) : r?.workflow_id ?? null,
          status: typeof r?.status === "string" ? String(r.status) : "",
          created_at: typeof r?.created_at === "string" ? String(r.created_at) : r?.created_at ?? null,
          updated_at: typeof r?.updated_at === "string" ? String(r.updated_at) : r?.updated_at ?? null,
          ledger_len: typeof r?.ledger_len === "number" ? Number(r.ledger_len) : r?.ledger_len ?? null,
          parent_run_id: typeof r?.parent_run_id === "string" ? String(r.parent_run_id) : r?.parent_run_id ?? null,
          session_id: typeof r?.session_id === "string" ? String(r.session_id) : r?.session_id ?? null,
          is_scheduled: typeof r?.is_scheduled === "boolean" ? Boolean(r.is_scheduled) : r?.is_scheduled ?? null,
          paused: typeof r?.paused === "boolean" ? Boolean(r.paused) : r?.paused ?? null,
          waiting_reason: typeof r?.waiting?.reason === "string" ? String(r.waiting.reason) : r?.waiting?.reason ?? null,
          schedule_interval: typeof r?.schedule?.interval === "string" ? String(r.schedule.interval).trim() : r?.schedule?.interval ?? null,
          schedule_target_workflow_id:
            typeof r?.schedule?.target_workflow_id === "string" ? String(r.schedule.target_workflow_id).trim() : r?.schedule?.target_workflow_id ?? null,
        }))
        .filter((r) => Boolean(r.run_id))
        // Observability UX: show only parent/root runs (subruns are observable via the parent’s ledger).
        .filter((r) => !String(r.parent_run_id || "").trim());
      set_run_options(next);
    } catch (e: any) {
      push_log({ ts: now_iso(), kind: "error", title: "Refresh runs failed", preview: clamp_preview(String(e?.message || e || "")) });
    } finally {
      set_runs_loading(false);
    }
  }

  async function on_discover_gateway(): Promise<void> {
    set_discovery_error("");
    set_gateway_connected(false);
    set_discovery_loading(true);
    try {
      const gw_url_raw = String(settings.gateway_url || "").trim();
      if (gw_url_raw) {
        const lower = gw_url_raw.toLowerCase();
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
          throw new Error("Gateway URL must start with http:// or https:// (or leave it blank to use same origin / dev proxy).");
        }
        try {
          const page_proto = String(window?.location?.protocol || "");
          if (page_proto === "https:" && lower.startsWith("http://")) {
            throw new Error("Gateway URL is http:// but this page is https:// (mixed content is blocked). Use https:// or leave Gateway URL blank to use same origin /api proxy.");
          }
          const u = new URL(gw_url_raw);
          const page_host = String(window?.location?.hostname || "").trim().toLowerCase();
          const gw_host = String(u.hostname || "").trim().toLowerCase();
          const is_loopback = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "::1";
          if (is_loopback(gw_host) && page_host && !is_loopback(page_host)) {
            throw new Error(
              "Gateway URL points to localhost, which from this device is not your machine. Use the gateway's public URL (e.g. an ngrok https URL) or leave Gateway URL blank to use same origin /api proxy."
            );
          }
        } catch (e: any) {
          throw new Error(String(e?.message || e || "Invalid Gateway URL"));
        }
      }

      const bundles = await gateway.list_bundles();
      const opts = build_workflow_options_from_bundles(bundles);
      set_workflow_options(opts);

      try {
        await refresh_runs();
      } catch (e: any) {
        set_run_options([]);
        push_log({ ts: now_iso(), kind: "error", title: "Discovery runs failed", preview: clamp_preview(String(e?.message || e || "")) });
      }

      const [tools_res, providers_res] = await Promise.allSettled([gateway.discovery_tools(), gateway.discovery_providers({ include_models: false })]);
      if (tools_res.status === "fulfilled") {
        const items = Array.isArray(tools_res.value?.items) ? tools_res.value.items : [];
        set_discovered_tool_specs(items);
      } else {
        set_discovered_tool_specs([]);
        push_log({ ts: now_iso(), kind: "error", title: "Discovery tools failed", preview: clamp_preview(String(tools_res.reason || "")) });
      }

      if (providers_res.status === "fulfilled") {
        const items = Array.isArray(providers_res.value?.items) ? providers_res.value.items : [];
        set_discovered_providers(items);
      } else {
        set_discovered_providers([]);
        push_log({ ts: now_iso(), kind: "error", title: "Discovery providers failed", preview: clamp_preview(String(providers_res.reason || "")) });
      }

      set_discovered_models_by_provider({});
      set_gateway_connected(true);
      push_log({ ts: now_iso(), kind: "info", title: "Gateway discovery loaded", preview: clamp_preview(`workflows: ${opts.length}`) });
    } catch (e: any) {
      set_discovery_error(String(e?.message || e || "Discovery failed"));
    } finally {
      set_discovery_loading(false);
    }
  }

  async function reload_gateway_bundles(): Promise<void> {
    if (bundles_reloading || discovery_loading) return;
    set_bundles_reloading(true);
    try {
      await gateway.reload_bundles();
      const bundles = await gateway.list_bundles();
      const opts = build_workflow_options_from_bundles(bundles);
      set_workflow_options(opts);
      push_log({ ts: now_iso(), kind: "info", title: "Bundles reloaded", preview: clamp_preview(`workflows: ${opts.length}`) });
    } catch (e: any) {
      const msg = String(e?.message || e || "Bundle reload failed");
      push_log({ ts: now_iso(), kind: "error", title: "Bundle reload failed", preview: clamp_preview(msg), data: { error: msg } });
    } finally {
      set_bundles_reloading(false);
    }
  }

  async function upload_gateway_bundle(file: File): Promise<void> {
    if (bundle_uploading || discovery_loading) return;
    if (!gateway_connected) return;
    const f = file;
    if (!f) return;
    set_bundle_uploading(true);
    set_error_text("");
    try {
      const res = await gateway.upload_bundle(f, { overwrite: false, reload: true });
      push_log({ ts: now_iso(), kind: "info", title: "Bundle uploaded", preview: clamp_preview(String(res?.bundle_ref || "")) });
      const bundles = await gateway.list_bundles();
      const opts = build_workflow_options_from_bundles(bundles);
      set_workflow_options(opts);
    } catch (e: any) {
      const msg = String(e?.message || e || "Upload failed");
      set_error_text(msg);
      push_log({ ts: now_iso(), kind: "error", title: "Upload .flow failed", preview: clamp_preview(msg), data: { error: msg } });
    } finally {
      set_bundle_uploading(false);
      try {
        if (bundle_upload_input_ref.current) bundle_upload_input_ref.current.value = "";
      } catch {
        // ignore
      }
    }
  }

  function disconnect_gateway(): void {
    clear_run_view();
    set_bundle_id("");
    set_flow_id("");
    set_graph_flow_id("");
    set_bundle_info(null);
    set_bundle_error("");
    set_bundle_loading(false);

    set_workflow_options([]);
    set_run_options([]);
    set_discovered_tool_specs([]);
    set_discovered_providers([]);
    set_discovered_models_by_provider({});

    set_discovery_error("");
    set_gateway_connected(false);
    push_log({ ts: now_iso(), kind: "info", title: "Gateway disconnected" });
  }

  async function copy_to_clipboard(text: string): Promise<void> {
    const payload = String(text ?? "");
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      set_status("Copied to clipboard", 2);
      return;
    } catch {
      // fall back
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      set_status("Copied to clipboard", 2);
    } catch {
      set_status("Copy failed", 2);
    }
  }

  // Best-effort run state polling (pause/cancel are run-level changes that are not currently ledgered).
  useEffect(() => {
    const rid = run_id.trim();
    if (!connected || !rid) return;

    let stopped = false;
    const poll = async () => {
      try {
        const st = await gateway.get_run(rid);
        if (!stopped) set_run_state(st);
      } catch {
        // ignore
      }
    };

    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [connected, run_id, gateway]);

  const session_id_for_run = useMemo(() => {
    const sid = (run_state as any)?.session_id;
    if (typeof sid === "string") return sid.trim();
    if (sid == null) return "";
    return String(sid || "").trim();
  }, [run_state]);

  function _download_blob(blob: Blob, filename: string): void {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "download";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // ignore
    }
  }

  async function refresh_session_attachments(): Promise<void> {
    if (session_attachments_loading) return;
    if (!gateway_connected || !session_id_for_run) {
      set_session_attachments_run_id("");
      set_session_attachments([]);
      set_session_attachments_error("");
      return;
    }
    set_session_attachments_loading(true);
    set_session_attachments_error("");
    try {
      const rid = await session_memory_run_id(session_id_for_run);
      set_session_attachments_run_id(rid);
      const res = await gateway.list_run_artifacts(rid, { limit: 800 });
      const items = Array.isArray((res as any)?.items) ? ((res as any).items as any[]) : [];
      const atts = items.filter((it) => {
        const tags = it?.tags;
        return tags && typeof tags === "object" && String((tags as any).kind || "").trim() === "attachment";
      });
      set_session_attachments(atts);
    } catch (e: any) {
      const msg = String(e?.message || e || "Failed to load session attachments");
      // No session memory run yet → treat as empty instead of error noise.
      const low = msg.toLowerCase();
      const missing_session_store =
        msg.includes("404") ||
        (low.includes("session_memory_") && low.includes("not found")) ||
        (low.includes("\"detail\"") && low.includes("not found") && low.includes("session_memory_"));
      if (missing_session_store) {
        set_session_attachments([]);
        set_session_attachments_error("");
      } else {
        set_session_attachments([]);
        set_session_attachments_error(msg);
      }
      set_session_attachments_run_id("");
    } finally {
      set_session_attachments_loading(false);
    }
  }

  async function download_session_attachment(item: any): Promise<void> {
    const rid = String(session_attachments_run_id || "").trim();
    if (!rid) {
      set_status("No session attachment store yet", 2);
      return;
    }
    const artifact_id = String(item?.artifact_id || "").trim();
    if (!artifact_id) return;
    const tags = item?.tags && typeof item.tags === "object" ? item.tags : {};
    const filename = String((tags as any).filename || "").trim();
    const path = String((tags as any).path || "").trim();
    const fallback = filename || (path ? path.split("/").pop() : "") || artifact_id;
    const safe = sanitize_filename_part(fallback);
    try {
      const blob = await gateway.download_run_artifact_content(rid, artifact_id);
      _download_blob(blob, safe);
      set_status("Downloaded attachment", 2);
    } catch (e: any) {
      set_status(String(e?.message || e || "Download failed"), 3);
    }
  }

  async function preview_session_attachment(item: any): Promise<void> {
    const rid = String(session_attachments_run_id || "").trim();
    const artifact_id = String(item?.artifact_id || "").trim();
    if (!rid || !artifact_id) return;

    const tags = item?.tags && typeof item.tags === "object" ? item.tags : {};
    const filename = String((tags as any).filename || "").trim();
    const path = String((tags as any).path || "").trim();
    const label = path ? `@${path}` : filename || artifact_id;

    const size_bytes = typeof item?.size_bytes === "number" ? Number(item.size_bytes) : null;
    const content_type = String(item?.content_type || (tags as any).content_type || "").trim().toLowerCase();

    set_attachment_preview_title(label);
    set_attachment_preview_text("");
    set_attachment_preview_error("");
    set_attachment_preview_open(true);

    if (typeof size_bytes === "number" && size_bytes > 1_000_000) {
      set_attachment_preview_text(`(Attachment is ${size_bytes.toLocaleString()} bytes; download to view.)`);
      return;
    }

    const textish =
      !content_type ||
      content_type.startsWith("text/") ||
      content_type.includes("json") ||
      content_type.includes("yaml") ||
      content_type.includes("toml") ||
      content_type.includes("xml");
    if (!textish) {
      set_attachment_preview_text(`(Binary attachment: ${content_type || "unknown"}; download to view.)`);
      return;
    }

    set_attachment_preview_loading(true);
    try {
      const blob = await gateway.download_run_artifact_content(rid, artifact_id);
      const raw = await blob.text();
      const max_chars = 14000;
      const text = raw.length > max_chars ? `${raw.slice(0, Math.max(0, max_chars - 1))}…` : raw;
      set_attachment_preview_text(text);
    } catch (e: any) {
      set_attachment_preview_error(String(e?.message || e || "Preview failed"));
    } finally {
      set_attachment_preview_loading(false);
    }
  }

  useEffect(() => {
    void refresh_session_attachments();
  }, [gateway, gateway_connected, session_id_for_run]);

  function push_log(item: Omit<UiLogItem, "id"> & { id?: string }): void {
    const id = String(item.id || "").trim() || random_id();
    set_log((prev) => [{ ...(item as any), id } as UiLogItem, ...prev].slice(0, 800));
  }

  function set_status(text: string, duration_s: number): void {
    set_status_text(text);

    if (status_pulse_timer_ref.current) window.clearTimeout(status_pulse_timer_ref.current);
    set_status_pulse(false);
    window.requestAnimationFrame(() => set_status_pulse(true));
    status_pulse_timer_ref.current = window.setTimeout(() => {
      set_status_pulse(false);
      status_pulse_timer_ref.current = null;
    }, 1500);

    if (status_timer_ref.current) {
      window.clearTimeout(status_timer_ref.current);
      status_timer_ref.current = null;
    }
    if (duration_s > 0) {
      status_timer_ref.current = window.setTimeout(() => {
        set_status_text("");
        status_timer_ref.current = null;
      }, Math.max(1, duration_s) * 1000);
    }
  }

  function graph_node_id_for(run_id_value: string, node_id_value: string): string {
    const rid = String(run_id_value || "").trim();
    const nid = String(node_id_value || "").trim();
    if (!nid) return "";
    const prefix = rid ? String(run_prefix_ref.current[rid] || "").trim() : "";
    return prefix ? `${prefix}::${nid}` : nid;
  }

  function register_subworkflow_child_run(parent_run_id_value: string, parent_node_id_value: string, sub_run_id_value: string): void {
    const parent_run_id = String(parent_run_id_value || "").trim();
    const parent_node_id = String(parent_node_id_value || "").trim();
    const sub_run_id = String(sub_run_id_value || "").trim();
    if (!parent_run_id || !parent_node_id || !sub_run_id) return;
    const prefix = graph_node_id_for(parent_run_id, parent_node_id);
    if (!prefix) return;
    run_prefix_ref.current[sub_run_id] = prefix;
    subrun_parent_ref.current[sub_run_id] = parent_run_id;
    subrun_spawn_ref.current[sub_run_id] = { parent_run_id, parent_node_id };
    if (!subrun_ids_ref.current.has(sub_run_id)) {
      subrun_ids_ref.current.add(sub_run_id);
      set_subrun_ids((prev) => (prev.includes(sub_run_id) ? prev : [...prev, sub_run_id]));
    }
  }

  function mark_node_activity(node_id_for_graph: string): void {
    const node_id = String(node_id_for_graph || "").trim();
    if (!node_id) return;
    const now = Date.now();
    const prev_active = active_node_ref.current;
    active_node_ref.current = node_id;
    set_graph_now_ms(now);

    set_recent_nodes((prev) => {
      const next: Record<string, number> = {};
      for (const [k, until] of Object.entries(prev)) {
        if (typeof until === "number" && until > now) next[k] = until;
      }
      next[node_id] = Math.max(next[node_id] || 0, now + 2000);
      if (prev_active && prev_active !== node_id) next[prev_active] = Math.max(next[prev_active] || 0, now + 2000);

      // Cap to avoid unbounded growth.
      const keys = Object.keys(next);
      if (keys.length <= 200) return next;
      const keep = keys.sort((a, b) => (next[b] || 0) - (next[a] || 0)).slice(0, 200);
      const pruned: Record<string, number> = {};
      for (const k of keep) pruned[k] = next[k] || 0;
      return pruned;
    });

    set_visited_nodes((prev) => {
      if (typeof prev[node_id] === "number") return prev;
      const next = { ...prev, [node_id]: now };
      visited_order_ref.current.push(node_id);
      if (visited_order_ref.current.length > 8000) {
        const drop = visited_order_ref.current.splice(0, 1500);
        for (const k of drop) delete next[k];
      }
      return next;
    });

    if (recent_prune_timer_ref.current) window.clearTimeout(recent_prune_timer_ref.current);
    recent_prune_timer_ref.current = window.setTimeout(() => {
      const t = Date.now();
      set_recent_nodes((prev) => {
        const next: Record<string, number> = {};
        for (const [k, until] of Object.entries(prev)) {
          if (typeof until === "number" && until > t) next[k] = until;
        }
        return next;
      });
      set_graph_now_ms(t);
      recent_prune_timer_ref.current = null;
    }, 2200);
  }

  function handle_step(ev: LedgerStreamEvent): void {
    cursor_ref.current = ev.cursor;
    set_cursor(ev.cursor);
    set_records((prev) => [...prev, { cursor: ev.cursor, record: ev.record }]);
    if (run_id.trim()) digest_seen_ref.current.add(`${run_id.trim()}:${ev.cursor}`);

    const emit = extract_emit_event(ev.record);
    const emit_name = emit && emit.name ? normalize_ui_event_name(emit.name) : "";

    const rec = ev.record;
    const node_id = typeof rec?.node_id === "string" ? rec.node_id : "";
    const status = typeof rec?.status === "string" ? rec.status : "";
    const effect_type = typeof rec?.effect?.type === "string" ? rec.effect.type : "";
    const rec_run_id = typeof rec?.run_id === "string" ? rec.run_id : "";

    const effective_run_id = rec_run_id || run_id.trim();
    if (emit_name === "abstract.status" && effective_run_id === run_id.trim()) {
      const { text, duration } = extract_textish(emit?.payload);
      set_status(text, duration);
    }
    const node_id_for_log = node_id ? graph_node_id_for(effective_run_id, node_id) : "";
    if (status === "waiting") {
      const w = extract_wait_from_record(rec);
      const reason = String(w?.reason || "").trim();
      if (reason === "subworkflow") {
        const sub = typeof (w as any)?.details?.sub_run_id === "string" ? String((w as any).details.sub_run_id) : "";
        if (sub && node_id) register_subworkflow_child_run(effective_run_id, node_id, sub);
      }
    }

    // Graph UX:
    // - `recent_nodes` should still blink as we receive steps.
    // - `active_node_id` should represent the *currently running/waiting* node, not the last completed step.
    if (node_id) {
      mark_node_activity(graph_node_id_for(effective_run_id, node_id));
      if (status === "waiting" || status === "running") {
        const nid = graph_node_id_for(effective_run_id, node_id);
        if (nid) {
          active_node_ref.current = nid;
          set_active_node_id(nid);
        }
      }
    }

    let kind: UiLogItem["kind"] = "step";
    let title = node_id_for_log || node_id || "(node?)";
    let preview = "";

    if (emit && emit.name && is_ui_event_name(emit.name)) {
      kind = emit_name === "abstract.message" ? "message" : "event";
      title = emit_name || emit.name;
      preview = clamp_preview(extract_textish(emit?.payload).text);
    } else if (rec?.error) {
      kind = "error";
      title = "error";
      preview = clamp_preview(safe_json_inline(rec.error, 360));
    } else if (status === "waiting") {
      const w = extract_wait_from_record(rec);
      const reason = String(w?.reason || "").trim();
      preview = clamp_preview(reason ? `waiting • ${reason}` : "waiting");
    } else if (rec?.result) {
      preview = clamp_preview(safe_json_inline(rec.result, 360));
    } else if (effect_type) {
      preview = clamp_preview(effect_type);
    } else {
      preview = clamp_preview(format_step_summary(rec));
    }

    push_log({
      id: `step:${rec_run_id || run_id.trim() || "?"}:${ev.cursor}`,
      ts: String(rec?.ended_at || rec?.started_at || now_iso()),
      kind,
      title,
      preview,
      data: rec,
      cursor: ev.cursor,
      run_id: rec_run_id || run_id.trim() || undefined,
      node_id: node_id_for_log || node_id,
      status,
      effect_type,
      emit_name: emit_name || emit?.name || undefined,
    });
  }

  function handle_child_step(child_run_id: string, ev: LedgerStreamEvent): void {
    child_cursor_ref.current = Math.max(child_cursor_ref.current, ev.cursor);
    const dig_key = `${child_run_id}:${ev.cursor}`;
    const is_new = !digest_seen_ref.current.has(dig_key);
    if (!is_new) return;
    digest_seen_ref.current.add(dig_key);
    set_child_records_for_digest((prev) => [...prev, { run_id: child_run_id, cursor: ev.cursor, record: ev.record }]);
    const emit = extract_emit_event(ev.record);
    const emit_name = emit && emit.name ? normalize_ui_event_name(emit.name) : "";
    const rec = ev.record;
    const node_id = typeof rec?.node_id === "string" ? rec.node_id : "";
    const node_id_for_log = node_id ? graph_node_id_for(child_run_id, node_id) : "";
    const status = typeof rec?.status === "string" ? rec.status : "";
    const effect_type = typeof rec?.effect?.type === "string" ? rec.effect.type : "";
    if (status === "waiting") {
      const w = extract_wait_from_record(rec);
      const reason = String(w?.reason || "").trim();
      if (reason === "subworkflow") {
        const sub = typeof (w as any)?.details?.sub_run_id === "string" ? String((w as any).details.sub_run_id) : "";
        if (sub && node_id) register_subworkflow_child_run(child_run_id, node_id, sub);
        // Descend into nested subflows so status/events aren't missed when emitted in grandchildren.
        if (sub && follow_run_ref.current.trim() === String(child_run_id || "").trim()) {
          follow_run_ref.current = sub;
          set_follow_run_id(sub);
        }
      }
    }
    if (node_id) {
      mark_node_activity(graph_node_id_for(child_run_id, node_id));
      if (status === "waiting" || status === "running") {
        const nid = graph_node_id_for(child_run_id, node_id);
        if (nid) {
          active_node_ref.current = nid;
          set_active_node_id(nid);
        }
      }
    }

    // If the currently-followed run completes, fall back to its parent (if any).
    if ((status === "completed" || status === "failed") && follow_run_ref.current.trim() === String(child_run_id || "").trim()) {
      const parent = String(subrun_parent_ref.current[String(child_run_id || "").trim()] || "").trim();
      if (parent && parent !== run_id.trim()) {
        follow_run_ref.current = parent;
        set_follow_run_id(parent);
      } else {
        follow_run_ref.current = "";
        set_follow_run_id("");
      }
    }

    if (emit_name === "abstract.status" && child_run_id === run_id.trim()) {
      const { text, duration } = extract_textish(emit?.payload);
      set_status(text, duration);
    }
    let kind: UiLogItem["kind"] = "step";
    let title = node_id_for_log || node_id || "(node?)";
    let preview = "";

    if (emit && emit.name && is_ui_event_name(emit.name)) {
      kind = emit_name === "abstract.message" ? "message" : "event";
      title = `subrun • ${emit_name || emit.name}`;
      preview = clamp_preview(extract_textish(emit?.payload).text);
    } else if (rec?.error) {
      kind = "error";
      title = "error";
      preview = clamp_preview(safe_json_inline(rec.error, 360));
    } else if (status === "waiting") {
      const w = extract_wait_from_record(rec);
      const reason = String(w?.reason || "").trim();
      preview = clamp_preview(reason ? `waiting • ${reason}` : "waiting");
    } else if (rec?.result) {
      preview = clamp_preview(safe_json_inline(rec.result, 360));
    } else if (effect_type) {
      preview = clamp_preview(effect_type);
    } else {
      preview = clamp_preview(format_step_summary(rec));
    }

    push_log({
      id: `step:${child_run_id}:${ev.cursor}`,
      ts: String(rec?.ended_at || rec?.started_at || now_iso()),
      kind,
      title,
      preview,
      data: rec,
      cursor: ev.cursor,
      run_id: child_run_id,
      node_id: node_id_for_log || node_id,
      status,
      effect_type,
      emit_name: emit_name || emit?.name || "",
    });
  }

  function handle_subrun_digest_step(sub_run_id_value: string, ev: LedgerStreamEvent): void {
    const child_run_id = String(sub_run_id_value || "").trim();
    if (!child_run_id) return;
    const dig_key = `${child_run_id}:${ev.cursor}`;
    const is_new = !digest_seen_ref.current.has(dig_key);
    if (!is_new) return;
    digest_seen_ref.current.add(dig_key);
    set_child_records_for_digest((prev) => [...prev, { run_id: child_run_id, cursor: ev.cursor, record: ev.record }]);

    const emit = extract_emit_event(ev.record);
    const emit_name = emit && emit.name ? normalize_ui_event_name(emit.name) : "";
    const rec = ev.record;
    const node_id = typeof rec?.node_id === "string" ? rec.node_id : "";
    const node_id_for_log = node_id ? graph_node_id_for(child_run_id, node_id) : "";
    const status = typeof rec?.status === "string" ? rec.status : "";
    const effect_type = typeof rec?.effect?.type === "string" ? rec.effect.type : "";

    if (status === "waiting") {
      const w = extract_wait_from_record(rec);
      const reason = String(w?.reason || "").trim();
      if (reason === "subworkflow") {
        const sub = typeof (w as any)?.details?.sub_run_id === "string" ? String((w as any).details.sub_run_id) : "";
        if (sub && node_id) register_subworkflow_child_run(child_run_id, node_id, sub);
      }
    }
    if (node_id) {
      mark_node_activity(graph_node_id_for(child_run_id, node_id));
      if (status === "waiting" || status === "running") {
        const nid = graph_node_id_for(child_run_id, node_id);
        if (nid) {
          active_node_ref.current = nid;
          set_active_node_id(nid);
        }
      }
    }

    if (emit_name === "abstract.status" && child_run_id === run_id.trim()) {
      const { text, duration } = extract_textish(emit?.payload);
      set_status(text, duration);
    }
    let kind: UiLogItem["kind"] = "step";
    let title = node_id_for_log || node_id || "(node?)";
    let preview = "";

    if (emit && emit.name && is_ui_event_name(emit.name)) {
      kind = emit_name === "abstract.message" ? "message" : "event";
      title = `subrun • ${emit_name || emit.name}`;
      preview = clamp_preview(extract_textish(emit?.payload).text);
    } else if (rec?.error) {
      kind = "error";
      title = "error";
      preview = clamp_preview(safe_json_inline(rec.error, 360));
    } else if (status === "waiting") {
      const w = extract_wait_from_record(rec);
      const reason = String(w?.reason || "").trim();
      preview = clamp_preview(reason ? `waiting • ${reason}` : "waiting");
    } else if (rec?.result) {
      preview = clamp_preview(safe_json_inline(rec.result, 360));
    } else if (effect_type) {
      preview = clamp_preview(effect_type);
    } else {
      preview = clamp_preview(format_step_summary(rec));
    }

    push_log({
      id: `step:${child_run_id}:${ev.cursor}`,
      ts: String(rec?.ended_at || rec?.started_at || now_iso()),
      kind,
      title,
      preview,
      data: rec,
      cursor: ev.cursor,
      run_id: child_run_id,
      node_id: node_id_for_log || node_id,
      status,
      effect_type,
      emit_name: emit_name || emit?.name || "",
    });
  }

  async function replay_ledger(run_id_value: string, opts: { after: number }): Promise<number> {
    let after = opts.after;
    while (true) {
      const page = await gateway.get_ledger(run_id_value, { after, limit: 200 });
      const items = Array.isArray(page.items) ? page.items : [];
      if (!items.length) {
        set_cursor(after);
        cursor_ref.current = after;
        return after;
      }
      const base = after;
      for (let i = 0; i < items.length; i++) {
        const record = items[i] as StepRecord;
        handle_step({ cursor: base + i + 1, record });
      }
      after = typeof page.next_after === "number" ? page.next_after : after;
    }
  }

  async function connect_to_run(run_id_value: string): Promise<void> {
    const rid = String(run_id_value || "").trim();
    set_error_text("");
    set_connecting(true);
    set_connected(false);
    set_records([]);
    set_cursor(0);
    cursor_ref.current = 0;
    set_child_records_for_digest([]);
    digest_seen_ref.current = new Set();
    set_log([]);
    set_log_open({});
    set_log_response_open({});
    set_ledger_view("steps");
    set_ledger_cycles_run_id("");
    set_status_text("");
    set_run_state(null);
    set_dismissed_wait_key("");
    set_active_node_id("");
    active_node_ref.current = "";
    set_recent_nodes({});
    set_visited_nodes({});
    visited_order_ref.current = [];
    set_graph_now_ms(Date.now());
    run_prefix_ref.current = rid ? { [rid]: "" } : {};
    subrun_parent_ref.current = {};
    subrun_spawn_ref.current = {};
    subrun_ids_ref.current = new Set();
    set_subrun_ids([]);
    root_subrun_ref.current = "";
    follow_run_ref.current = "";
    set_follow_run_id("");
    subrun_cursor_ref.current = {};
    if (recent_prune_timer_ref.current) window.clearTimeout(recent_prune_timer_ref.current);
    recent_prune_timer_ref.current = null;
    if (dismiss_timer_ref.current) window.clearTimeout(dismiss_timer_ref.current);
    dismiss_timer_ref.current = null;

    if (abort_ref.current) abort_ref.current.abort();
    if (child_abort_ref.current) child_abort_ref.current.abort();
    child_abort_ref.current = null;
    child_cursor_ref.current = 0;
    set_following_child_run_id("");
    const abort = new AbortController();
    abort_ref.current = abort;

    let attach_ok = false;
    try {
      // Best-effort attach context (bundle/flow + input_data) to make Attach match Start.
      let inferred_bundle_id = "";
      let inferred_flow_id = "";
      try {
        const st = await gateway.get_run(rid);
        set_run_state(st);
        const wid = typeof st?.workflow_id === "string" ? String(st.workflow_id) : "";
        const parsed = parse_namespaced_workflow_id(wid);
        if (parsed) {
          inferred_bundle_id = parsed.bundle_id;
          inferred_flow_id = parsed.flow_id;
        }
      } catch {
        // ignore
      }

      try {
        const inp = await gateway.get_run_input_data(rid);
        if (typeof (inp as any)?.bundle_id === "string") inferred_bundle_id = String((inp as any).bundle_id || "").trim() || inferred_bundle_id;
        if (typeof (inp as any)?.flow_id === "string") inferred_flow_id = String((inp as any).flow_id || "").trim() || inferred_flow_id;

        const data = inp && typeof inp.input_data === "object" && inp.input_data && !Array.isArray(inp.input_data) ? inp.input_data : null;
        if (data) {
          set_input_data_text(JSON.stringify(data, null, 2));
        }
      } catch {
        // ignore
      }

      if (inferred_bundle_id && inferred_flow_id) {
        set_bundle_id(inferred_bundle_id);
        set_flow_id(inferred_flow_id);
        set_graph_flow_id(inferred_flow_id);
        await load_bundle_info(inferred_bundle_id);
      }

      await replay_ledger(rid, { after: 0 });
      set_connected(true);
      push_log({ ts: now_iso(), kind: "info", title: `Attached to run ${rid}`, data: { run_id: rid } });
      attach_ok = true;
    } catch (e: any) {
      const msg = String(e?.message || e || "unknown error");
      set_error_text(msg);
      push_log({ ts: now_iso(), kind: "error", title: "Connection error", preview: clamp_preview(msg), data: { error: msg } });
      set_connected(false);
    } finally {
      set_connecting(false);
    }

    if (!attach_ok || abort.signal.aborted) return;

    // Stream in the background so UI controls remain usable while attached.
    const stream_loop = async () => {
      let backoff_ms = 250;
      while (!abort.signal.aborted) {
        try {
          // Best-effort resync before streaming (replay-first).
          const after = await replay_ledger(rid, { after: cursor_ref.current });
          await gateway.stream_ledger(rid, {
            after,
            on_step: handle_step,
            signal: abort.signal,
          });
        } catch (e: any) {
          if (abort.signal.aborted) break;
          const msg = String(e?.message || e || "stream error");
          push_log({ ts: now_iso(), kind: "error", title: "Ledger stream error (will retry)", preview: clamp_preview(msg), data: { error: msg } });
        }

        if (abort.signal.aborted) break;
        await new Promise((r) => setTimeout(r, backoff_ms));
        backoff_ms = Math.min(5000, Math.floor(backoff_ms * 1.6));
      }
    };
    stream_loop();
  }

	  async function start_new_run(): Promise<string | null> {
    const fid = flow_id.trim();
    const bid = bundle_id.trim();
    if (!fid || !bid) {
      const msg = "Select a workflow first (Start Workflow → pick a workflow).";
      set_error_text(msg);
      return msg;
    }

    set_error_text("");
    set_connecting(true);
	    try {
	      let input_data: Record<string, any> = {};
      const raw = input_data_text.trim();
      if (raw) {
        try {
          input_data = JSON.parse(raw);
          if (typeof input_data !== "object" || input_data === null || Array.isArray(input_data)) {
            throw new Error("input_data must be a JSON object");
          }
        } catch (e: any) {
          const msg = `Invalid input_data JSON: ${String(e?.message || e)}`;
          set_error_text(msg);
	          return msg;
	        }
	      }
	      // Best-effort contract for common agent workflows: require prompt only when declared.
	      const prompt_pin = (adaptive_pins || []).find((p) => p && typeof p === "object" && (p as any).id === "prompt");
	      const prompt_default_specified =
	        prompt_pin && typeof prompt_pin === "object" && Object.prototype.hasOwnProperty.call(prompt_pin, "default");
	      const raw_prompt = (input_data as any)?.prompt;
	      const prompt_text = typeof raw_prompt === "string" ? raw_prompt.trim() : "";
	      if (prompt_pin && !prompt_default_specified && !prompt_text) {
	        const msg = "Missing required input_data.prompt";
	        set_error_text(msg);
	        return msg;
	      }
      const rid = await gateway.start_run(fid, input_data, {
        bundle_id: bid,
        session_id: String(start_session_id || "").trim() || null,
      });
      set_root_run_id(rid);
      set_run_id(rid);
      set_new_run_error("");
      await connect_to_run(rid);
      // Best-effort refresh so the run appears in the dropdown quickly.
      void refresh_runs();
      return null;
    } catch (e: any) {
      const msg = String(e?.message || e || "start failed");
      set_error_text(msg);
      return msg;
    } finally {
      set_connecting(false);
    }
  }

  async function start_scheduled_run(args: {
    start_mode: "now" | "at";
    start_at_local: string;
    repeat_mode: "once" | "forever" | "count" | "until";
    every_n: number;
    every_unit: "minutes" | "hours" | "days" | "weeks" | "months";
    repeat_count: number;
    repeat_until_date_local?: string;
    repeat_until_time_local?: string;
    share_context: boolean;
  }): Promise<string | null> {
    const fid = flow_id.trim();
    const bid = bundle_id.trim();
    if (!fid || !bid) {
      const msg = "Select a workflow first (Start Workflow → pick a workflow).";
      set_error_text(msg);
      return msg;
    }

    if (schedule_submitting) return "Schedule already in progress";

    set_schedule_error("");
    set_error_text("");
    set_schedule_submitting(true);
    set_connecting(true);
	    try {
	      let input_data: Record<string, any> = {};
      const raw = input_data_text.trim();
      if (raw) {
        try {
          input_data = JSON.parse(raw);
          if (typeof input_data !== "object" || input_data === null || Array.isArray(input_data)) {
            throw new Error("input_data must be a JSON object");
          }
        } catch (e: any) {
          const msg = `Invalid input_data JSON: ${String(e?.message || e)}`;
          set_schedule_error(msg);
	          return msg;
	        }
	      }
	
	      const prompt_pin = (adaptive_pins || []).find((p) => p && typeof p === "object" && (p as any).id === "prompt");
	      const prompt_default_specified =
	        prompt_pin && typeof prompt_pin === "object" && Object.prototype.hasOwnProperty.call(prompt_pin, "default");
	      const raw_prompt = (input_data as any)?.prompt;
	      const prompt_text = typeof raw_prompt === "string" ? raw_prompt.trim() : "";
	      if (prompt_pin && !prompt_default_specified && !prompt_text) {
	        const msg = "Missing required input_data.prompt";
	        set_schedule_error(msg);
	        return msg;
	      }

	      let start_at: string | null = null;
      let start_at_dt_utc: Date | null = null;
      if (args.start_mode === "now") {
        start_at = "now";
        start_at_dt_utc = new Date();
      } else {
        const local = String(args.start_at_local || "").trim();
        if (!local) {
          const msg = "Pick a start date/time (or choose 'now').";
          set_schedule_error(msg);
          return msg;
        }
        const dt = new Date(local);
        if (!Number.isFinite(dt.getTime())) {
          const msg = "Invalid start date/time";
          set_schedule_error(msg);
          return msg;
        }
        start_at = dt.toISOString();
        start_at_dt_utc = new Date(start_at);
      }

      const every_raw = Number.isFinite(args.every_n) ? args.every_n : 1;
      const every_n = Math.max(1, Math.min(10_000, Math.floor(every_raw)));
      const every_unit = String(args.every_unit || "").trim() as any;

      let interval: string = "1d";
      if (every_unit === "minutes") interval = `${every_n}m`;
      else if (every_unit === "hours") interval = `${every_n}h`;
      else if (every_unit === "days") interval = `${every_n}d`;
      else if (every_unit === "weeks") interval = `${every_n * 7}d`;
      else if (every_unit === "months") interval = `${every_n * 30}d`;

      const repeat_mode = args.repeat_mode;
      const interval_to_send = repeat_mode === "once" ? null : interval;
      const repeat_count =
        repeat_mode === "count" ? Math.max(1, Math.floor(Number.isFinite(args.repeat_count) ? args.repeat_count : 1)) : null;
      let repeat_until: string | null = null;
      if (repeat_mode === "until") {
        const d = String(args.repeat_until_date_local || "").trim();
        const t = String(args.repeat_until_time_local || "").trim() || "23:59";
        if (!d) {
          const msg = "Pick an end date (Until).";
          set_schedule_error(msg);
          return msg;
        }
        const dt = new Date(`${d}T${t}`);
        if (!Number.isFinite(dt.getTime())) {
          const msg = "Invalid end date/time";
          set_schedule_error(msg);
          return msg;
        }
        repeat_until = dt.toISOString();
        if (start_at_dt_utc && Number.isFinite(start_at_dt_utc.getTime()) && dt.getTime() < start_at_dt_utc.getTime()) {
          const msg = "End date must be after the start date.";
          set_schedule_error(msg);
          return msg;
        }
      }

      const rid = await gateway.schedule_run({
        bundle_id: bid,
        flow_id: fid,
        input_data,
        start_at,
        interval: interval_to_send,
	        repeat_count,
	        repeat_until,
        share_context: Boolean(args.share_context),
        session_id: String(start_session_id || "").trim() || null,
      });
      set_root_run_id(rid);
      set_run_id(rid);
      set_schedule_error("");
      await connect_to_run(rid);
      void refresh_runs();
      return null;
    } catch (e: any) {
      const msg = String(e?.message || e || "schedule failed");
      set_schedule_error(msg);
      set_error_text(msg);
      return msg;
    } finally {
      set_connecting(false);
      set_schedule_submitting(false);
    }
  }

  async function submit_launch(): Promise<void> {
    set_new_run_error("");
    set_schedule_error("");
    const should_schedule = schedule_start_mode !== "now" || schedule_repeat_mode !== "once";
    const err = should_schedule
      ? await start_scheduled_run({
          start_mode: schedule_start_mode,
          start_at_local: schedule_start_at_local,
          repeat_mode: schedule_repeat_mode,
          every_n: schedule_every_n,
          every_unit: schedule_every_unit,
          repeat_count: schedule_repeat_count,
          repeat_until_date_local: schedule_repeat_until_date_local,
          repeat_until_time_local: schedule_repeat_until_time_local,
          share_context: schedule_share_context,
        })
      : await start_new_run();
    if (err) set_new_run_error(err);
  }

  async function attach_to_run(rid: string): Promise<void> {
    const run = String(rid || "").trim();
    if (!run) return;
    set_error_text("");
    set_root_run_id(run);
    set_run_id(run);
    await connect_to_run(run);
  }

  useEffect(() => {
    const rid = String(pending_url_run_id || "").trim();
    if (!rid) return;
    let stopped = false;
    void (async () => {
      try {
        if (!gateway_connected) await on_discover_gateway();
        if (stopped) return;
        await attach_to_run(rid);
      } catch (e: any) {
        if (!stopped) set_error_text(String(e?.message || e || "Failed to attach run from URL"));
      } finally {
        if (!stopped) set_pending_url_run_id("");
      }
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending_url_run_id]);

  function clear_run_view(): void {
    if (abort_ref.current) abort_ref.current.abort();
    abort_ref.current = null;
    if (child_abort_ref.current) child_abort_ref.current.abort();
    child_abort_ref.current = null;
    child_cursor_ref.current = 0;
    set_following_child_run_id("");

    set_run_id("");
    set_root_run_id("");
    run_prefix_ref.current = {};
    subrun_parent_ref.current = {};
    subrun_spawn_ref.current = {};
    subrun_ids_ref.current = new Set();
    set_subrun_ids([]);
    root_subrun_ref.current = "";
    follow_run_ref.current = "";
    set_follow_run_id("");
    subrun_cursor_ref.current = {};
    set_dismissed_wait_key("");
    if (recent_prune_timer_ref.current) window.clearTimeout(recent_prune_timer_ref.current);
    recent_prune_timer_ref.current = null;
    if (dismiss_timer_ref.current) window.clearTimeout(dismiss_timer_ref.current);
    dismiss_timer_ref.current = null;

    set_connected(false);
    set_connecting(false);
    set_resuming(false);

    cursor_ref.current = 0;
    set_cursor(0);
    set_records([]);
    set_child_records_for_digest([]);
    digest_seen_ref.current = new Set();
    set_run_state(null);
    set_log([]);
    set_log_open({});
    set_active_node_id("");
    active_node_ref.current = "";
    set_recent_nodes({});
    set_visited_nodes({});
    visited_order_ref.current = [];
    set_graph_now_ms(Date.now());
    set_status("", -1);
    set_error_text("");
    set_summary_generating(false);
    set_summary_error("");

    set_chat_messages([]);
    set_chat_input("");
    set_chat_error("");
	    set_chat_sending(false);
	    set_chat_thread_saving(false);
	    set_chat_thread_save_error("");
	    set_chat_thread_last_saved_at("");
	    set_chat_thread_last_saved_fingerprint("");
	    set_saved_chat_threads([]);
	    set_saved_chat_threads_loading(false);
	    set_saved_chat_threads_error("");
	    set_saved_chat_thread_selected("");
	    set_saved_chat_thread_loading(false);
	    set_saved_chat_thread_load_error("");
	  }

  useEffect(() => {
    set_chat_messages([]);
    set_chat_input("");
    set_chat_error("");
	    set_chat_sending(false);
	    set_chat_thread_saving(false);
	    set_chat_thread_save_error("");
	    set_chat_thread_last_saved_at("");
	    set_chat_thread_last_saved_fingerprint("");
	    set_saved_chat_threads([]);
	    set_saved_chat_threads_loading(false);
	    set_saved_chat_threads_error("");
	    set_saved_chat_thread_selected("");
	    set_saved_chat_thread_loading(false);
	    set_saved_chat_thread_load_error("");
	  }, [run_id]);

  useEffect(() => {
    if (right_tab !== "chat") return;
    if (!run_id.trim()) return;
    if (!gateway_connected) return;
    void refresh_saved_chat_threads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [right_tab, run_id, gateway_connected, run_state?.workflow_id]);

  async function submit_run_control(type: "pause" | "resume" | "cancel", opts?: { reason?: string }): Promise<string | null> {
    const rid = run_id.trim();
    if (!rid) {
      set_error_text("Missing run_id");
      return "Missing run_id";
    }
    set_error_text("");
    try {
      const payload: any = {};
      const reason = String(opts?.reason || "").trim();
      if (reason) payload.reason = reason;
      await gateway.submit_command({
        command_id: random_id(),
        run_id: rid,
        type,
        payload,
        client_id: "web_pwa",
      });
      push_log({ ts: now_iso(), kind: "info", title: `${type} submitted`, preview: reason ? `reason: ${reason}` : "", data: { type, reason } });
      // Refresh run state quickly.
      try {
        const st = await gateway.get_run(rid);
        set_run_state(st);
      } catch {
        // ignore
      }
      return null;
    } catch (e: any) {
      const msg = String(e?.message || e || `${type} failed`);
      set_error_text(msg);
      return msg;
    }
  }

  async function run_scheduled_now(): Promise<void> {
    const rid = run_id.trim();
    if (!rid) {
      set_error_text("Select a run first.");
      return;
    }
    if (!gateway_connected) {
      set_error_text("Connect to the gateway first.");
      return;
    }
    if (resuming) return;

    // Scheduled runs idle in a WAIT_UNTIL node. Triggering "now" is implemented by resuming that wait early.
    const wait_reason2 = String(run_state?.waiting?.reason || "").trim().toLowerCase() || String(wait_reason || "").trim().toLowerCase();
    if (!is_scheduled_run || run_terminal || run_paused || run_status.toLowerCase() !== "waiting" || wait_reason2 !== "until") {
      set_error_text("This run is not a scheduled wait that can be triggered now.");
      return;
    }

    set_error_text("");
    set_resuming(true);
    try {
      const payload: any = { payload: { mode: "run_now", requested_at: now_iso() } };
      const wk = String(wait_key || "").trim();
      if (wk) payload.wait_key = wk;
      await gateway.submit_command({ command_id: random_id(), run_id: rid, type: "resume", payload, client_id: "web_pwa" });
      push_log({
        ts: now_iso(),
        kind: "info",
        title: "Scheduled run triggered",
        preview: clamp_preview(`run ${rid}`),
        data: { run_id: rid, until: wait_until || null },
      });
      try {
        const st = await gateway.get_run(rid);
        set_run_state(st);
      } catch {
        // ignore
      }
    } catch (e: any) {
      set_error_text(String(e?.message || e || "Failed to trigger scheduled run"));
    } finally {
      set_resuming(false);
    }
  }

  async function submit_update_schedule(opts: { interval: string; apply_immediately?: boolean }): Promise<string | null> {
    const rid = run_id.trim();
    if (!rid) {
      set_error_text("Missing run_id");
      return "Missing run_id";
    }
    if (schedule_edit_submitting) return "Schedule update already in progress";

    const interval = String(opts.interval || "").trim();
    const interval_re = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/i;
    if (!interval_re.test(interval)) {
      const msg = "Invalid interval (expected like '20m', '1h', '0.5s', '250ms')";
      set_schedule_edit_error(msg);
      return msg;
    }

    set_schedule_edit_error("");
    set_error_text("");
    set_schedule_edit_submitting(true);
    set_connecting(true);
    try {
      await gateway.submit_command({
        command_id: random_id(),
        run_id: rid,
        type: "update_schedule",
        payload: { interval, apply_immediately: opts.apply_immediately !== false },
        client_id: "web_pwa",
      });
      push_log({
        ts: now_iso(),
        kind: "info",
        title: "Schedule updated",
        preview: clamp_preview(`interval: ${interval}`),
        data: { interval },
        run_id: rid,
      });
      try {
        const st = await gateway.get_run(rid);
        set_run_state(st);
      } catch {
        // ignore
      }
      return null;
    } catch (e: any) {
      const msg = String(e?.message || e || "update_schedule failed");
      set_schedule_edit_error(msg);
      set_error_text(msg);
      return msg;
    } finally {
      set_connecting(false);
      set_schedule_edit_submitting(false);
    }
  }

  async function submit_compact_memory(opts?: { preserve_recent?: number; compression_mode?: "light" | "standard" | "heavy"; focus?: string }): Promise<string | null> {
    const rid = run_id.trim();
    if (!rid) {
      set_error_text("Missing run_id");
      return "Missing run_id";
    }
    if (compact_submitting) return "Compaction already in progress";

    const preserve_recent_raw = typeof opts?.preserve_recent === "number" ? opts.preserve_recent : compact_preserve_recent;
    const preserve_recent = Math.max(0, Math.min(500, Math.floor(Number.isFinite(preserve_recent_raw) ? preserve_recent_raw : 6)));
    const compression_mode = (opts?.compression_mode || compact_mode) as any;
    const focus = String(opts?.focus ?? compact_focus ?? "").trim();

    set_compact_error("");
    set_error_text("");
    set_compact_submitting(true);
    set_connecting(true);
    try {
      const payload: any = { preserve_recent, compression_mode };
      if (focus) payload.focus = focus;
      await gateway.submit_command({
        command_id: random_id(),
        run_id: rid,
        type: "compact_memory",
        payload,
        client_id: "web_pwa",
      });
      push_log({
        ts: now_iso(),
        kind: "info",
        title: "Compaction requested",
        preview: clamp_preview(`mode: ${compression_mode} • preserve_recent: ${preserve_recent}`),
        data: payload,
        run_id: rid,
      });
      return null;
    } catch (e: any) {
      const msg = String(e?.message || e || "compact_memory failed");
      set_compact_error(msg);
      set_error_text(msg);
      return msg;
    } finally {
      set_connecting(false);
      set_compact_submitting(false);
    }
  }

  async function generate_summary(): Promise<void> {
    const rid = run_id.trim();
    if (!rid) {
      set_summary_error("Missing run_id");
      return;
    }
    if (summary_generating) return;
    set_summary_error("");
    set_summary_generating(true);
    try {
      const provider = settings.maintenance_ai_provider.trim();
      const model = settings.maintenance_ai_model.trim();
      await gateway.generate_run_summary(rid, { provider: provider || undefined, model: model || undefined, include_subruns: true });
      push_log({ ts: now_iso(), kind: "info", title: "Summary generation requested", preview: clamp_preview(`run ${rid}`) });
    } catch (e: any) {
      set_summary_error(String(e?.message || e || "Failed to generate summary"));
    } finally {
      set_summary_generating(false);
    }
  }

  async function send_chat_message(): Promise<void> {
    const rid = run_id.trim();
    if (!rid) {
      set_chat_error("Select a run first.");
      return;
    }
    if (!gateway_connected) {
      set_chat_error("Connect to the gateway first.");
      return;
    }
    const q = chat_input.trim();
    if (!q) return;
    if (chat_sending) return;

    set_chat_error("");
    set_chat_sending(true);
    const user_id = `local:${random_id()}`;
    const user_msg = { id: user_id, role: "user" as const, content: q, ts: now_iso() };
    set_chat_messages((prev) => [...prev, user_msg]);
    set_chat_input("");

    try {
      const history = [...chat_messages, user_msg].slice(-20).map((m) => ({ role: m.role, content: m.content }));
      const provider = settings.maintenance_ai_provider.trim();
      const model = settings.maintenance_ai_model.trim();
      const res = await gateway.run_chat(rid, {
        provider: provider || undefined,
        model: model || undefined,
        include_subruns: true,
        messages: history,
      });
      const answer = String(res?.answer || "").trim() || "(empty response)";
      const ts = String(res?.generated_at || "").trim() || now_iso();

      set_chat_messages((prev) => {
        return [...prev, { id: `local:${random_id()}`, role: "assistant" as const, content: answer, ts }];
      });
    } catch (e: any) {
      set_chat_error(String(e?.message || e || "Chat failed"));
      set_chat_messages((prev) => [
        ...prev,
        { id: `local:${random_id()}`, role: "assistant" as const, content: "(error: failed to generate answer)", ts: now_iso() },
      ]);
    } finally {
      set_chat_sending(false);
    }
  }

  function export_chat_markdown(mode: "copy" | "download"): void {
    if (!chat_messages.length) return;
    const rid = run_id.trim();
    const heading = rid ? `Run ${rid}` : "Chat";
    const md = chatToMarkdown(
      chat_messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts })),
      { heading }
    );

    if (mode === "download") {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const fname = `abstractobserver-chat-${sanitize_filename_part(rid || "run")}-${stamp}.md`;
      downloadTextFile({ filename: fname, text: md, mime: "text/markdown;charset=utf-8" });
      return;
    }

    void (async () => {
      const ok = await copyText(md);
      set_chat_export_state(ok ? "copied" : "failed");
      window.setTimeout(() => set_chat_export_state("idle"), 900);
    })();
  }

  async function refresh_saved_chat_threads(): Promise<void> {
    const wid = typeof run_state?.workflow_id === "string" ? String(run_state.workflow_id).trim() : "";
    if (!wid) {
      set_saved_chat_threads([]);
      return;
    }
    if (!gateway_connected) return;
    if (saved_chat_threads_loading) return;

    set_saved_chat_threads_error("");
    set_saved_chat_threads_loading(true);
    try {
      const runs_res = await gateway.list_runs({ limit: 200, workflow_id: wid, root_only: true });
      const items = Array.isArray(runs_res?.items) ? runs_res.items : [];
      const runs: Array<{ run_id: string; ledger_len: number }> = [];
      for (const it of items) {
        const rid = typeof it?.run_id === "string" ? String(it.run_id).trim() : "";
        if (!rid) continue;
        const ll = typeof it?.ledger_len === "number" ? Number(it.ledger_len) : 0;
        runs.push({ run_id: rid, ledger_len: Number.isFinite(ll) ? ll : 0 });
      }
      if (!runs.length) {
        set_saved_chat_threads([]);
        return;
      }

      const per_run_limit = 400;
      const batch_runs = runs.map((r) => ({ run_id: r.run_id, after: Math.max(0, (r.ledger_len || 0) - per_run_limit) }));
      const batch = await gateway.get_ledger_batch({ runs: batch_runs, limit: per_run_limit });
      const out: Array<{
        thread_id: string;
        created_at: string;
        title: string;
        run_id: string;
        workflow_id: string;
        message_count: number | null;
        provider: string;
        model: string;
        artifact_id: string;
      }> = [];
      const seen = new Set<string>();

      for (const r of runs) {
        const page = batch?.runs && typeof batch.runs === "object" ? (batch.runs as any)[r.run_id] : null;
        const ledger_items = Array.isArray(page?.items) ? page.items : [];
        for (const rec of ledger_items) {
          const eff = (rec as any)?.effect;
          if (!eff || typeof eff !== "object") continue;
          if (String((eff as any).type || "") !== "emit_event") continue;
          const p = (eff as any).payload;
          if (!p || typeof p !== "object") continue;
          if (String((p as any).name || "") !== "abstract.chat.thread") continue;
          const pay = (p as any).payload;
          if (!pay || typeof pay !== "object") continue;

          const thread_id = typeof (pay as any).thread_id === "string" ? String((pay as any).thread_id).trim() : "";
          if (!thread_id || seen.has(thread_id)) continue;
          seen.add(thread_id);
          const created_at = typeof (pay as any).created_at === "string" ? String((pay as any).created_at) : "";
          const title = typeof (pay as any).title === "string" ? String((pay as any).title) : "";
          const workflow_id = typeof (pay as any).workflow_id === "string" ? String((pay as any).workflow_id) : wid;
          const run_id2 = typeof (pay as any).run_id === "string" ? String((pay as any).run_id) : r.run_id;
          const provider = typeof (pay as any).provider === "string" ? String((pay as any).provider) : "";
          const model = typeof (pay as any).model === "string" ? String((pay as any).model) : "";
          const mc = typeof (pay as any).message_count === "number" ? Number((pay as any).message_count) : null;
          const art = (pay as any).chat_artifact;
          const artifact_id = art && typeof art === "object" && typeof art.$artifact === "string" ? String(art.$artifact) : "";
          if (!artifact_id) continue;

          out.push({
            thread_id,
            created_at,
            title: title || `Chat ${thread_id.slice(0, 8)}`,
            run_id: run_id2,
            workflow_id,
            message_count: mc,
            provider,
            model,
            artifact_id,
          });
        }
      }

      out.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      set_saved_chat_threads(out);
    } catch (e: any) {
      set_saved_chat_threads_error(String(e?.message || e || "Failed to load saved discussions"));
    } finally {
      set_saved_chat_threads_loading(false);
    }
  }

  async function save_current_chat_thread(): Promise<void> {
    const rid = run_id.trim();
    if (!rid) {
      set_chat_thread_save_error("Select a run first.");
      return;
    }
    if (!gateway_connected) {
      set_chat_thread_save_error("Connect to the gateway first.");
      return;
    }
    if (!chat_messages.length) return;
    if (chat_thread_saving) return;

    set_chat_thread_save_error("");
    set_chat_thread_saving(true);
    try {
      const provider = settings.maintenance_ai_provider.trim();
      const model = settings.maintenance_ai_model.trim();
      const res = await gateway.save_chat_thread(rid, {
        provider: provider || undefined,
        model: model || undefined,
        include_subruns: true,
        messages: chat_messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts })),
      });
      const ts = typeof res?.created_at === "string" ? String(res.created_at) : now_iso();
      set_chat_thread_last_saved_at(ts);
      try {
        const fingerprint = JSON.stringify(chat_messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts })));
        set_chat_thread_last_saved_fingerprint(fingerprint);
      } catch {
        set_chat_thread_last_saved_fingerprint("1");
      }
      if (typeof res?.thread_id === "string" && String(res.thread_id).trim()) {
        set_saved_chat_thread_selected(String(res.thread_id).trim());
      }
      const dup = Boolean((res as any)?.duplicate);
      set_status(dup ? "Already saved" : "Saved discussion", 2);
      await refresh_saved_chat_threads();
    } catch (e: any) {
      set_chat_thread_save_error(String(e?.message || e || "Failed to save discussion"));
    } finally {
      set_chat_thread_saving(false);
    }
  }

  async function load_selected_chat_thread(): Promise<void> {
    const tid = String(saved_chat_thread_selected || "").trim();
    if (!tid) return;
    const thread = saved_chat_threads.find((t) => String(t.thread_id || "").trim() === tid) || null;
    if (!thread) {
      set_saved_chat_thread_load_error("Saved discussion not found (refresh list).");
      return;
    }
    if (!gateway_connected) {
      set_saved_chat_thread_load_error("Connect to the gateway first.");
      return;
    }
    if (saved_chat_thread_loading) return;

    // Avoid silently discarding local edits.
    const has_local = chat_messages.length > 0;
    const has_unsaved = (() => {
      if (!has_local) return false;
      if (!chat_thread_last_saved_fingerprint) return true;
      try {
        const fp = JSON.stringify(chat_messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts })));
        return fp !== chat_thread_last_saved_fingerprint;
      } catch {
        return true;
      }
    })();
    if (has_local && has_unsaved) {
      const ok = window.confirm("Replace the current chat with the selected saved discussion? Unsaved changes will be lost.");
      if (!ok) return;
    }

    set_saved_chat_thread_load_error("");
    set_saved_chat_thread_loading(true);
    try {
      const blob = await gateway.download_run_artifact_content(thread.run_id, thread.artifact_id);
      const raw = await blob.text();
      const doc = JSON.parse(raw);
      const msgs0 = Array.isArray(doc?.messages) ? doc.messages : [];
      const created_at = typeof doc?.created_at === "string" ? String(doc.created_at) : String(thread.created_at || "");
      const msgs: Array<{ id: string; role: "user" | "assistant"; content: string; ts: string }> = [];
      for (let i = 0; i < msgs0.length; i++) {
        const m = msgs0[i];
        if (!m || typeof m !== "object") continue;
        const role = String((m as any).role || "").trim() === "assistant" ? "assistant" : "user";
        const content = typeof (m as any).content === "string" ? String((m as any).content) : "";
        if (!content.trim()) continue;
        const ts = typeof (m as any).ts === "string" ? String((m as any).ts) : created_at || now_iso();
        msgs.push({ id: `thread:${tid}:${i}`, role, content: content.trim(), ts });
      }

      set_chat_messages(msgs);
      set_chat_input("");
      set_chat_error("");
      set_chat_thread_save_error("");
      set_chat_thread_last_saved_at(created_at || "");
      try {
        const fp = JSON.stringify(msgs.map((m) => ({ role: m.role, content: m.content, ts: m.ts })));
        set_chat_thread_last_saved_fingerprint(fp);
      } catch {
        set_chat_thread_last_saved_fingerprint("1");
      }
      set_status("Loaded discussion", 2);
    } catch (e: any) {
      set_saved_chat_thread_load_error(String(e?.message || e || "Failed to load saved discussion"));
    } finally {
      set_saved_chat_thread_loading(false);
    }
  }

  async function resume_wait(payload_obj: any): Promise<void> {
    const rid = run_id.trim();
    const wk = String(wait_state?.wait_key || "").trim();
    if (!rid || !wk) {
      set_error_text("No active wait to resume");
      return;
    }
    if (String(wait_state?.reason || "").trim() === "subworkflow") {
      set_error_text("This run is waiting on a subworkflow; attach to the child run instead of resuming manually.");
      return;
    }
    set_error_text("");
    set_resuming(true);
    try {
      await gateway.submit_command({
        command_id: random_id(),
        run_id: rid,
        type: "resume",
        payload: { wait_key: wk, payload: payload_obj || {} },
        client_id: "web_pwa",
      });
      push_log({ ts: now_iso(), kind: "info", title: "Resume submitted", preview: clamp_preview(`wait_key: ${wk}`), data: { wait_key: wk, payload: payload_obj || {} } });
      set_dismissed_wait_key(wk);
      if (dismiss_timer_ref.current) window.clearTimeout(dismiss_timer_ref.current);
      dismiss_timer_ref.current = window.setTimeout(() => {
        set_dismissed_wait_key((prev) => (prev === wk ? "" : prev));
      }, 2000);
    } catch (e: any) {
      set_error_text(String(e?.message || e || "resume failed"));
    } finally {
      set_resuming(false);
    }
  }

  async function execute_tools_via_worker(tool_calls: ToolCall[]): Promise<void> {
    if (!worker) {
      set_error_text("No worker configured");
      return;
    }
    if (resuming) return;
    set_error_text("");
    set_resuming(true);

    try {
      const results: ToolResult[] = [];
      for (const tc of tool_calls) {
        // Sequential to keep UX predictable (and avoid flooding).
        // Future: bounded concurrency + cancellation.
        const res = await worker.call_tool(tc);
        results.push(res);
      }

      await resume_wait({ mode: "executed", results });
    } finally {
      set_resuming(false);
    }
  }

  const tool_calls_for_wait = useMemo(() => extract_tool_calls_from_wait(wait_state), [wait_state]);
  const wait_key = String(wait_state?.wait_key || "").trim();
  const wait_reason = String(wait_state?.reason || "").trim();
  const wait_until = typeof (wait_state as any)?.until === "string" ? String((wait_state as any).until) : "";
  const is_until_wait = wait_reason === "until" && Boolean(wait_until);
  const is_waiting = is_waiting_status(last_record) && (Boolean(wait_key) || is_until_wait);
  const is_user_wait = wait_reason === "user";
  const wait_event_name = wait_reason === "event" ? normalize_ui_event_name(event_name_from_wait_key(wait_key)) : "";
  const is_ask_event_wait = wait_reason === "event" && wait_event_name === "abstract.ask";
  const has_tool_wait = tool_calls_for_wait.length > 0;
  const show_wait_modal = is_waiting && wait_key && (is_user_wait || is_ask_event_wait || has_tool_wait) && dismissed_wait_key !== wait_key;
  const sub_run_id = typeof (wait_state as any)?.details?.sub_run_id === "string" ? String((wait_state as any).details.sub_run_id) : "";

  const run_status = typeof run_state?.status === "string" ? String(run_state.status) : "";
  const run_paused = Boolean(run_state?.paused);
  const run_terminal = run_status === "completed" || run_status === "failed" || run_status === "cancelled";

  const schedule_meta = run_state?.schedule && typeof run_state.schedule === "object" ? run_state.schedule : null;
  const schedule_interval = typeof schedule_meta?.interval === "string" ? String(schedule_meta.interval).trim() : "";
  const schedule_share_ctx = typeof schedule_meta?.share_context === "boolean" ? Boolean(schedule_meta.share_context) : null;
  const schedule_meta_repeat_count = typeof schedule_meta?.repeat_count === "number" ? Number(schedule_meta.repeat_count) : null;
  const is_scheduled_run =
    Boolean(run_state?.is_scheduled) ||
    Boolean(schedule_meta) ||
    (typeof run_state?.workflow_id === "string" && String(run_state.workflow_id).startsWith("scheduled:"));
  const is_scheduled_recurrent = is_scheduled_run && Boolean(schedule_interval);

  const primary_control_label = is_scheduled_run ? (run_paused ? "Resume schedule" : "Suspend schedule") : run_status === "running" && !run_paused ? "Pause" : "Resume";
  const primary_control_action: "pause" | "resume" = is_scheduled_run ? (run_paused ? "resume" : "pause") : primary_control_label === "Pause" ? "pause" : "resume";
  const primary_control_disabled = is_scheduled_run
    ? !run_id.trim() || connecting || resuming || run_terminal
    : !run_id.trim() || connecting || resuming || run_terminal || (primary_control_action === "resume" && !run_paused);

  const can_run_scheduled_now =
    is_scheduled_run &&
    !run_paused &&
    !run_terminal &&
    !connecting &&
    !resuming &&
    run_status.toLowerCase() === "waiting" &&
    (String(run_state?.waiting?.reason || "").trim().toLowerCase() === "until" || wait_reason === "until") &&
    Boolean(String(wait_until || "").trim());

  const limits_tokens = (run_state as any)?.limits?.tokens;
  const limits_pct = typeof limits_tokens?.pct === "number" ? Number(limits_tokens.pct) : null;
  const limits_used = limits_tokens?.estimated_used;
  const limits_budget = limits_tokens?.max_input_tokens ?? limits_tokens?.max_tokens;

  const digest = useMemo(() => {
    type DigestStats = {
      steps: number;
      tool_calls_effects: number;
      tool_calls: number;
      unique_tools: number;
      llm_calls: number;
      llm_missing_responses: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      started_at: string;
      ended_at: string;
      duration_s: number;
      errors: number;
    };

    type DigestToolCall = {
      ts: string;
      run_id: string;
      node_id: string;
      name: string;
      signature: string;
      success: boolean | null;
      output_preview: string;
      error: string;
    };

	    type DigestLlmCall = {
	      ts: string;
	      run_id: string;
	      node_id: string;
	      provider: string;
	      model: string;
	      prompt_preview: string;
	      response_preview: string;
	      missing_response: boolean;
	      tokens: { prompt: number; completion: number; total: number };
	    };

	    const tool_specs_by_name: Record<string, any> = {};
	    for (const s of discovered_tool_specs || []) {
	      if (!s || typeof s !== "object") continue;
	      const name = String((s as any).name || "").trim();
	      if (!name) continue;
	      tool_specs_by_name[name] = s;
	    }

	    const tool_toolset = (tool_name: string): string => {
	      const spec = tool_specs_by_name[String(tool_name || "").trim()];
	      const v = spec && typeof spec === "object" ? (spec as any).toolset : "";
	      return typeof v === "string" ? v.trim() : "";
	    };

	    const format_arg_value = (value: any): string => {
	      if (value === null || value === undefined) return "";
	      if (typeof value === "boolean") return value ? "true" : "false";
	      if (typeof value === "number") return String(value);
	      if (typeof value === "string") return clamp_preview(value, { max_chars: 160, max_lines: 2 });
	      return clamp_preview(safe_json_inline(value, 160), { max_chars: 160, max_lines: 2 });
	    };

	    const ordered_tool_args = (tool_name: string, args: any): Array<[string, any]> => {
	      const n = String(tool_name || "").trim();
	      const a = args && typeof args === "object" ? (args as any) : {};
	      const spec = tool_specs_by_name[n];
	      const params = spec && typeof spec === "object" ? (spec as any).parameters : null;
	      const order = params && typeof params === "object" ? Object.keys(params) : Object.keys(a);

	      const out: Array<[string, any]> = [];
	      const seen = new Set<string>();
	      for (const k of order) {
	        if (typeof k !== "string" || !k.trim() || seen.has(k)) continue;
	        seen.add(k);
	        if (Object.prototype.hasOwnProperty.call(a, k)) out.push([k, a[k]]);
	      }
	      for (const k of Object.keys(a)) {
	        if (seen.has(k)) continue;
	        out.push([k, a[k]]);
	      }
	      return out;
	    };

	    const tool_primary_arg_value = (tool_name: string, args: any): string => {
	      const pairs = ordered_tool_args(tool_name, args);
	      if (!pairs.length) return "";
	      return format_arg_value(pairs[0][1]);
	    };

	    const tool_signature = (tool_name: string, args: any): string => {
	      const n = String(tool_name || "").trim() || "tool";
	      const pairs = ordered_tool_args(n, args);
	      const shown = pairs.slice(0, 2);
	      if (!shown.length) return `${n}()`;
	      if (shown.length === 1) return `${n}(${format_arg_value(shown[0][1])})`;
	      const inner = shown.map(([k, v]) => `${k}=${format_arg_value(v)}`).join(", ");
	      return `${n}(${inner})`;
	    };

	    type DigestForRun = {
	      stats: DigestStats;
	      files: Array<{ tool: string; file_path: string; run_id: string; ts: string }>;
	      commands: Array<{ command: string; run_id: string; ts: string }>;
      web: Array<{ tool: string; value: string; run_id: string; ts: string }>;
      tools_used: string[];
      tool_calls_detail: DigestToolCall[];
      llm_calls_detail: DigestLlmCall[];
    };

    const compute = (all: StepRecord[]): DigestForRun => {
      const stats: DigestStats = {
        steps: all.length,
        tool_calls_effects: 0,
        tool_calls: 0,
        unique_tools: 0,
        llm_calls: 0,
        llm_missing_responses: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        started_at: "",
        ended_at: "",
        duration_s: 0,
        errors: 0,
      };

      const files: Array<{ tool: string; file_path: string; run_id: string; ts: string }> = [];
      const commands: Array<{ command: string; run_id: string; ts: string }> = [];
      const web: Array<{ tool: string; value: string; run_id: string; ts: string }> = [];
      const tools_used = new Set<string>();
      const tool_calls_detail: DigestToolCall[] = [];
      const llm_calls_detail: DigestLlmCall[] = [];

      let min_ms: number | null = null;
      let max_ms: number | null = null;

      const llm_prompt_from_payload = (payload: any): string => {
        if (!payload || typeof payload !== "object") return "";
        const p = (payload as any).prompt;
        if (typeof p === "string" && p.trim()) return p.trim();
        const msgs = (payload as any).messages;
        if (Array.isArray(msgs)) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (!m || typeof m !== "object") continue;
            if (String((m as any).role || "") !== "user") continue;
            const c = (m as any).content;
            if (typeof c === "string" && c.trim()) return c.trim();
          }
        }
        return "";
      };

      const output_preview = (value: any): string => {
        if (value === null || value === undefined) return "";
        if (typeof value === "string") return clamp_preview(value, { max_chars: 2400, max_lines: 32 });
        return clamp_preview(safe_json(value), { max_chars: 2400, max_lines: 32 });
      };

      for (const rec of all) {
        const rid = typeof rec?.run_id === "string" ? String(rec.run_id) : "";
        const node_id = typeof rec?.node_id === "string" ? String(rec.node_id) : "";
        const ts_s = String(rec?.ended_at || rec?.started_at || "").trim();
        const ms = parse_iso_ms(ts_s);
        if (ms !== null) {
          if (min_ms === null || ms < min_ms) min_ms = ms;
          if (max_ms === null || ms > max_ms) max_ms = ms;
        }

        if (rec?.error) stats.errors += 1;

        const eff_type = typeof rec?.effect?.type === "string" ? String(rec.effect.type) : "";
        if (eff_type === "llm_call") {
          stats.llm_calls += 1;
          const payload = rec?.effect?.payload;
          const usage = rec?.result && typeof rec.result === "object" ? (rec.result as any).usage || (rec.result as any).token_usage : null;
          let pt = 0;
          let ct = 0;
          let tt = 0;
          if (usage && typeof usage === "object") {
            pt = Number((usage as any).prompt_tokens ?? (usage as any).input_tokens ?? 0);
            ct = Number((usage as any).completion_tokens ?? (usage as any).output_tokens ?? 0);
            tt = Number((usage as any).total_tokens ?? pt + ct);
            if (Number.isFinite(pt)) stats.prompt_tokens += pt;
            if (Number.isFinite(ct)) stats.completion_tokens += ct;
            if (Number.isFinite(tt)) stats.total_tokens += tt;
          }

          const provider = payload && typeof payload === "object" && typeof (payload as any).provider === "string" ? String((payload as any).provider) : "";
          const model = payload && typeof payload === "object" && typeof (payload as any).model === "string" ? String((payload as any).model) : "";
          const prompt = llm_prompt_from_payload(payload);
          const content =
            rec?.result && typeof rec.result === "object" && typeof (rec.result as any).content === "string"
              ? String((rec.result as any).content)
              : rec?.result && typeof rec.result === "object" && typeof (rec.result as any).response === "string"
                ? String((rec.result as any).response)
                : typeof rec?.result === "string"
                  ? String(rec.result)
                  : "";
          const missing_response = !String(content || "").trim();
          if (missing_response) stats.llm_missing_responses += 1;
          if (llm_calls_detail.length < 80) {
            llm_calls_detail.push({
              ts: ts_s,
              run_id: rid,
              node_id,
              provider,
              model,
              prompt_preview: clamp_preview(prompt, { max_chars: 1800, max_lines: 24 }),
              response_preview: clamp_preview(String(content || ""), { max_chars: 1800, max_lines: 24 }),
              missing_response,
              tokens: { prompt: Number.isFinite(pt) ? pt : 0, completion: Number.isFinite(ct) ? ct : 0, total: Number.isFinite(tt) ? tt : 0 },
            });
          }
        }

        if (eff_type !== "tool_calls") continue;
        stats.tool_calls_effects += 1;
        const payload = rec?.effect?.payload;
        const tool_calls = payload && typeof payload === "object" ? (payload as any).tool_calls : null;
        const calls = Array.isArray(tool_calls) ? (tool_calls as any[]) : [];
        if (!calls.length) continue;
        stats.tool_calls += calls.length;

        const results = rec?.result && typeof rec.result === "object" ? (rec.result as any).results : null;
        const results_list = Array.isArray(results) ? (results as any[]) : [];
        const results_by_id = new Map<string, any>();
        for (const r of results_list) {
          if (!r || typeof r !== "object") continue;
          const cid = String((r as any).call_id || (r as any).id || "").trim();
          if (cid && !results_by_id.has(cid)) results_by_id.set(cid, r);
        }

        for (let i = 0; i < calls.length; i++) {
          const c = calls[i];
          if (!c || typeof c !== "object") continue;
          const name = String((c as any).name || "").trim();
          if (!name) continue;
          tools_used.add(name);
          const args = (c as any).arguments;
          const call_id = String((c as any).call_id || (c as any).id || "").trim();
          const result = call_id && results_by_id.has(call_id) ? results_by_id.get(call_id) : i < results_list.length ? results_list[i] : null;
          const ok = result && typeof result === "object" && typeof (result as any).success === "boolean" ? Boolean((result as any).success) : null;
          const out = result && typeof result === "object" ? (result as any).output : null;
          const err = result && typeof result === "object" ? (result as any).error : null;

          if (tool_calls_detail.length < 240) {
            tool_calls_detail.push({
              ts: ts_s,
              run_id: rid,
              node_id,
              name,
              signature: tool_signature(name, args),
              success: ok,
              output_preview: output_preview(out),
              error: typeof err === "string" ? String(err) : err ? String(err) : "",
            });
          }

          const toolset = tool_toolset(name);
          const primary = tool_primary_arg_value(name, args);
          if (toolset === "files" && primary) files.push({ tool: name, file_path: primary, run_id: rid, ts: ts_s });
          else if (toolset === "system" && primary) commands.push({ command: primary, run_id: rid, ts: ts_s });
          else if (toolset === "web" && primary) web.push({ tool: name, value: primary, run_id: rid, ts: ts_s });
        }
      }

      stats.unique_tools = tools_used.size;
      if (min_ms !== null) stats.started_at = new Date(min_ms).toISOString();
      if (max_ms !== null) stats.ended_at = new Date(max_ms).toISOString();
      if (min_ms !== null && max_ms !== null) stats.duration_s = Math.max(0, Math.round((max_ms - min_ms) / 1000));

      return { stats, files, commands, web, tools_used: Array.from(tools_used).sort(), tool_calls_detail, llm_calls_detail };
    };

    const all_records: StepRecord[] = [];
    const by_run: Record<string, StepRecord[]> = {};
    const root_id = run_id.trim();

    const add = (r: StepRecord) => {
      if (!r) return;
      all_records.push(r);
      const rid = typeof (r as any)?.run_id === "string" ? String((r as any).run_id || "").trim() : "";
      const key = rid || root_id || "unknown";
      if (!by_run[key]) by_run[key] = [];
      by_run[key].push(r);
    };

    for (const x of records) {
      if (x && x.record) add(x.record);
    }
    for (const x of child_records_for_digest) {
      if (x && x.record) add(x.record);
    }

    const overall = compute(all_records);
    const per_run: Record<string, DigestForRun> = {};
    for (const [rid, items] of Object.entries(by_run)) {
      per_run[rid] = compute(items);
    }

    const subruns = subrun_ids
      .map((rid) => {
        const r = String(rid || "").trim();
        if (!r) return null;
        const parent_run_id = String(subrun_parent_ref.current[r] || "").trim();
        const spawn = subrun_spawn_ref.current[r];
        const parent_node_id = spawn ? String(spawn.parent_node_id || "").trim() : "";
        return { run_id: r, parent_run_id, parent_node_id, digest: per_run[r] || null };
      })
      .filter(Boolean) as Array<{ run_id: string; parent_run_id: string; parent_node_id: string; digest: DigestForRun | null }>;

    subruns.sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0));

    // Latest persisted run summary (abstract.summary) in the parent/root ledger.
    let latest_summary:
      | { cursor: number; ts: string; text: string; provider?: string; model?: string; generated_at?: string; source?: any }
      | null = null;
    for (const item of records) {
      const rec = item.record;
      const emit = extract_emit_event(rec);
      const name = emit && emit.name ? normalize_ui_event_name(emit.name) : "";
      if (name !== "abstract.summary") continue;
      const payload = emit?.payload && typeof emit.payload === "object" ? (emit.payload as any) : {};
      const text = typeof payload?.text === "string" ? String(payload.text) : "";
      if (!text.trim()) continue;
      latest_summary = {
        cursor: item.cursor,
        ts: String(rec?.ended_at || rec?.started_at || ""),
        text,
        provider: typeof payload?.provider === "string" ? String(payload.provider) : undefined,
        model: typeof payload?.model === "string" ? String(payload.model) : undefined,
        generated_at: typeof payload?.generated_at === "string" ? String(payload.generated_at) : undefined,
        source: payload?.source,
      };
    }

    const summary_ms = latest_summary ? parse_iso_ms(latest_summary.generated_at || latest_summary.ts) : null;
    let last_meaningful_ms: number | null = null;
    for (const rec of all_records) {
      const eff_type = typeof rec?.effect?.type === "string" ? String(rec.effect.type) : "";
      if (eff_type === "emit_event") continue;
      const ts_s = String(rec?.ended_at || rec?.started_at || "").trim();
      const ms = parse_iso_ms(ts_s);
      if (ms === null) continue;
      if (last_meaningful_ms === null || ms > last_meaningful_ms) last_meaningful_ms = ms;
    }
    const summary_outdated = summary_ms !== null && last_meaningful_ms !== null ? last_meaningful_ms > summary_ms : false;

    return { overall, per_run, subruns, latest_summary, summary_outdated };
  }, [records, child_records_for_digest, run_id, subrun_ids, discovered_tool_specs]);

  // Follow the deepest active subworkflow run for status/event UX (not just the immediate child).
  useEffect(() => {
    follow_run_ref.current = follow_run_id.trim();
  }, [follow_run_id]);

  useEffect(() => {
    const rid = run_id.trim();
    const child = sub_run_id.trim();
    const should_follow = connected && wait_reason === "subworkflow" && Boolean(child) && child !== rid;
    if (!should_follow) {
      root_subrun_ref.current = "";
      if (follow_run_id.trim()) set_follow_run_id("");
      return;
    }
    // Only reset when the root's immediate child changes, so deeper-follow can take over.
    if (root_subrun_ref.current !== child) {
      root_subrun_ref.current = child;
      follow_run_ref.current = child;
      set_follow_run_id(child);
    }
  }, [connected, run_id, wait_reason, sub_run_id, follow_run_id]);

  useEffect(() => {
    // Bundle switch should invalidate any cached flow JSON.
    set_graph_flow_cache({});
  }, [bundle_id]);

  const graph_entrypoint_ids = useMemo(() => {
    const eps = Array.isArray(bundle_info?.entrypoints) ? bundle_info?.entrypoints : [];
    return (eps || [])
      .map((e: any) => String(e?.flow_id || "").trim())
      .filter(Boolean);
  }, [bundle_info]);

  const scheduled_workflow_id = useMemo(() => {
    const wid = String(run_state?.workflow_id || "").trim();
    return connected && wid.startsWith("scheduled:") ? wid : "";
  }, [connected, run_state?.workflow_id]);

  const graph_active_node_id = useMemo(() => {
    if (!connected || !run_id.trim()) return active_node_id;
    if (!scheduled_workflow_id.trim()) return active_node_id;

    const st = String(run_state?.status || "").trim().toLowerCase();
    const current_node = String(run_state?.current_node || "").trim();
    if ((st !== "waiting" && st !== "running") || !current_node) return active_node_id;

    const current_graph_id = graph_node_id_for(run_id.trim(), current_node);
    if (!current_graph_id) return active_node_id;

    const waiting_reason = String(wait_reason || run_state?.waiting?.reason || "").trim().toLowerCase();
    const last_node_id = typeof (last_record as any)?.node_id === "string" ? String((last_record as any).node_id).trim() : "";
    const last_status = typeof (last_record as any)?.status === "string" ? String((last_record as any).status).trim().toLowerCase() : "";

    // For scheduled waits, prefer the durable run_state.current_node (it can be more accurate than the last ledger item).
    if (st === "waiting" && waiting_reason === "until") return current_graph_id;

    // If the ledger doesn't provide a waiting/running node id, fall back to current_node.
    if (!active_node_id.trim()) return current_graph_id;
    if ((last_status === "waiting" || last_status === "running") && !last_node_id) return current_graph_id;

    return active_node_id;
  }, [
    connected,
    run_id,
    scheduled_workflow_id,
    run_state?.status,
    run_state?.current_node,
    run_state?.waiting?.reason,
    wait_reason,
    active_node_id,
    last_record,
  ]);

  const graph_node_last_ms = useMemo(() => {
    const out: Record<string, number> = {};
    const root = run_id.trim();

    const add = (rid: string, rec: StepRecord) => {
      if (!rec) return;
      const node_id = typeof rec?.node_id === "string" ? String(rec.node_id).trim() : "";
      if (!node_id) return;
      const gid = graph_node_id_for(rid, node_id);
      if (!gid) return;
      const ts = String((rec as any)?.ended_at || (rec as any)?.started_at || "").trim();
      const ms = parse_iso_ms(ts);
      if (ms === null) return;
      out[gid] = Math.max(out[gid] || 0, ms);
    };

    for (const x of records) {
      if (x && x.record) add(root, x.record);
    }
    for (const x of child_records_for_digest) {
      if (x && x.record) add(String(x.run_id || "").trim(), x.record);
    }

    return out;
  }, [records, child_records_for_digest, run_id, subrun_ids]);

  useEffect(() => {
    if (!connected || !run_id.trim()) return;
    if (!scheduled_workflow_id.trim()) return;
    const node_id = String(run_state?.current_node || "").trim();
    if (!node_id) return;
    const reason = String(run_state?.waiting?.reason || "").trim();
    if (reason === "subworkflow") return;
    // Do not "stick" the active highlight to `current_node` (which may still point to the
    // last non-terminal node even after completion). Keep the active highlight driven by
    // the live ledger step stream (waiting/running), and only use `current_node` to refresh
    // transient "recent" emphasis.
    mark_node_activity(graph_node_id_for(run_id.trim(), node_id));
  }, [connected, run_id, scheduled_workflow_id, run_state?.current_node, run_state?.waiting?.reason]);

  useEffect(() => {
    const root = String(selected_entrypoint?.flow_id || "").trim();
    if (!root) return;
    if (!graph_flow_id.trim()) set_graph_flow_id(root);
  }, [selected_entrypoint, graph_flow_id]);

  useEffect(() => {
    const wid = scheduled_workflow_id.trim();
    const bid = bundle_id.trim();
    const fid = graph_flow_id.trim();

    if (wid) {
      let stopped = false;
      set_graph_loading(true);
      set_graph_error("");
      gateway
        .get_workflow_flow(wid)
        .then((res) => {
          if (stopped) return;
          const flow = (res as any)?.flow;
          const vf = flow && typeof flow === "object" ? flow : null;
          set_graph_flow(vf);
        })
        .catch((e: any) => {
          if (stopped) return;
          set_graph_flow(null);
          set_graph_error(String(e?.message || e || "Failed to load workflow flow"));
        })
        .finally(() => {
          if (stopped) return;
          set_graph_loading(false);
        });
      return () => {
        stopped = true;
      };
    }

    if (!bid || !fid) {
      set_graph_flow(null);
      set_graph_error("");
      set_graph_loading(false);
      return;
    }
    let stopped = false;
    set_graph_loading(true);
    set_graph_error("");
    gateway
      .get_bundle_flow(bid, fid)
      .then((res) => {
        if (stopped) return;
        const flow = (res as any)?.flow;
        const vf = flow && typeof flow === "object" ? flow : null;
        set_graph_flow(vf);
        if (vf) set_graph_flow_cache((prev) => ({ ...prev, [fid]: vf }));
      })
      .catch((e: any) => {
        if (stopped) return;
        set_graph_flow(null);
        set_graph_error(String(e?.message || e || "Failed to load flow"));
      })
      .finally(() => {
        if (stopped) return;
        set_graph_loading(false);
      });
    return () => {
      stopped = true;
    };
  }, [scheduled_workflow_id, bundle_id, graph_flow_id, gateway]);

  useEffect(() => {
    const bid = bundle_id.trim();
    if (!graph_show_subflows || !bid || !graph_flow) return;

    let stopped = false;
    const max_depth = 3;

    const extract_subflow_ids = (flow: any): string[] => {
      const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
      const out: string[] = [];
      for (const n of nodes) {
        const data = n?.data && typeof n.data === "object" ? n.data : {};
        const nt = String((data as any)?.nodeType || n?.type || "").trim();
        if (nt !== "subflow") continue;
        const sid = (data as any)?.subflowId || (data as any)?.flowId;
        const s = typeof sid === "string" ? sid.trim() : "";
        if (s) out.push(s.includes(":") ? s.split(":", 2)[1] : s);
      }
      return out;
    };

    const seen = new Set<string>();
    const want = new Set<string>();
    const visit = (flow: any, depth: number) => {
      if (!flow || depth >= max_depth) return;
      for (const sid of extract_subflow_ids(flow)) {
        const s = String(sid || "").trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        want.add(s);
        const cached = graph_flow_cache[s];
        if (cached) visit(cached, depth + 1);
      }
    };

    visit(graph_flow, 0);
    const missing = Array.from(want).filter((fid) => !graph_flow_cache[fid]).slice(0, 20);
    if (!missing.length) return;

    const run = async () => {
      for (const fid of missing) {
        if (stopped) return;
        try {
          const res = await gateway.get_bundle_flow(bid, fid);
          const flow = (res as any)?.flow;
          const vf = flow && typeof flow === "object" ? flow : null;
          if (!vf) continue;
          set_graph_flow_cache((prev) => (prev[fid] ? prev : { ...prev, [fid]: vf }));
        } catch {
          // ignore missing subflows (best-effort)
        }
      }
    };
    run();

    return () => {
      stopped = true;
    };
  }, [graph_show_subflows, bundle_id, graph_flow, graph_flow_cache, gateway]);

  const graph_flow_options = useMemo(() => {
    const flows = Array.isArray(bundle_info?.flows) ? (bundle_info?.flows as any[]) : [];
    const from_bundle = flows.map((x) => String(x || "").trim()).filter(Boolean);
    if (from_bundle.length) return Array.from(new Set(from_bundle)).sort();
    return Array.from(new Set(graph_entrypoint_ids)).sort();
  }, [bundle_info, graph_entrypoint_ids]);

  // If the run is terminal, there is no "currently executing" node.
  // Keep transient emphasis via `recent_nodes`, but clear the strong active highlight.
  useEffect(() => {
    if (!run_terminal) return;
    if (!active_node_id.trim()) return;
    set_active_node_id("");
    active_node_ref.current = "";
  }, [run_terminal, run_id, active_node_id]);

  // Follow the current deepest descendant run for status/events.
  useEffect(() => {
    const child_id = follow_run_id.trim();
    const parent_id = run_id.trim();
    const should_follow = connected && Boolean(child_id) && child_id !== parent_id;

    if (!should_follow) {
      if (child_abort_ref.current) child_abort_ref.current.abort();
      child_abort_ref.current = null;
      child_cursor_ref.current = 0;
      if (following_child_run_id) set_following_child_run_id("");
      return;
    }

    if (following_child_run_id === child_id) return;

    if (child_abort_ref.current) child_abort_ref.current.abort();
    const abort = new AbortController();
    child_abort_ref.current = abort;
    child_cursor_ref.current = 0;
    set_following_child_run_id(child_id);
    push_log({ ts: now_iso(), kind: "info", title: `Following run ${child_id} (status/events)` });

    let backoff_ms = 250;
    const run = async () => {
      while (!abort.signal.aborted) {
        try {
          await gateway.stream_ledger(child_id, {
            after: child_cursor_ref.current,
            on_step: (ev) => handle_child_step(child_id, ev),
            signal: abort.signal,
          });
          return;
        } catch (e: any) {
          if (abort.signal.aborted) break;
          const msg = String(e?.message || e || "stream error");
          push_log({
            ts: now_iso(),
            kind: "error",
            title: `Child ledger stream error (will retry)`,
            preview: clamp_preview(msg),
            data: { child_run_id: child_id, error: msg },
          });
        }

        if (abort.signal.aborted) break;
        await new Promise((r) => setTimeout(r, backoff_ms));
        backoff_ms = Math.min(5000, Math.floor(backoff_ms * 1.6));
      }
    };
    run();

    return () => {
      abort.abort();
    };
  }, [connected, follow_run_id, run_id, gateway, following_child_run_id]);

  // Poll all discovered subruns for digest completeness (avoid multiple SSE connections).
  useEffect(() => {
    if (!connected || !run_id.trim()) return;

    let stopped = false;

    const poll_once = async () => {
      if (stopped) return;
      if (subrun_poll_inflight_ref.current) return;
      if (!subrun_ids.length) return;
      subrun_poll_inflight_ref.current = true;
      try {
        const ids = subrun_ids.map((x) => String(x || "").trim()).filter(Boolean);
        if (!ids.length) return;
        const req_runs = ids.map((rid) => ({ run_id: rid, after: Number(subrun_cursor_ref.current[rid] || 0) }));
        const batch = await gateway.get_ledger_batch({ runs: req_runs, limit: 200 });
        const map = batch && typeof batch === "object" ? (batch as any).runs : {};
        for (const child_id of ids) {
          if (stopped) return;
          const entry = map && typeof map === "object" ? (map as any)[child_id] : null;
          const items = Array.isArray(entry?.items) ? entry.items : [];
          const next_after = typeof entry?.next_after === "number" ? entry.next_after : Number(subrun_cursor_ref.current[child_id] || 0);
          const base = Number(subrun_cursor_ref.current[child_id] || 0);
          for (let i = 0; i < items.length; i++) {
            const record = items[i] as StepRecord;
            handle_subrun_digest_step(child_id, { cursor: base + i + 1, record });
          }
          subrun_cursor_ref.current[child_id] = next_after;
        }
      } catch (e: any) {
        if (stopped) return;
        push_log({ ts: now_iso(), kind: "error", title: "Subrun digest poll failed", preview: clamp_preview(String(e?.message || e || "")) });
      } finally {
        subrun_poll_inflight_ref.current = false;
      }
    };

    void poll_once();
    const timer = window.setInterval(() => void poll_once(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      subrun_poll_inflight_ref.current = false;
    };
  }, [connected, run_id, subrun_ids, gateway]);

  const visible_log = useMemo(() => {
    if (!ledger_condensed) return log;
    return log.filter(is_condensed_ledger_item);
  }, [ledger_condensed, log]);

  const ledger_record_items = useMemo<LedgerRecordItem[]>(() => {
    const root = run_id.trim();
    const out: LedgerRecordItem[] = [];
    for (const x of records) {
      if (!x || !x.record) continue;
      out.push({ run_id: root, cursor: x.cursor, record: x.record });
    }
    for (const x of child_records_for_digest) {
      if (!x || !x.record) continue;
      out.push({ run_id: String(x.run_id || "").trim(), cursor: x.cursor, record: x.record });
    }
    return out;
  }, [records, child_records_for_digest, run_id]);

  const cycles_run_counts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of ledger_record_items) {
      const rid = String(item.run_id || item.record?.run_id || "").trim();
      if (!rid) continue;
      const eff = String(item.record?.effect?.type || "").trim();
      if (eff !== "llm_call") continue;
      counts[rid] = (counts[rid] || 0) + 1;
    }
    return counts;
  }, [ledger_record_items]);

  const default_cycles_run_id = useMemo(() => {
    const follow = follow_run_id.trim();
    if (follow) return follow;
    let best = "";
    let best_count = -1;
    for (const [rid, count] of Object.entries(cycles_run_counts)) {
      if (count > best_count) {
        best = rid;
        best_count = count;
      }
    }
    return best || run_id.trim();
  }, [cycles_run_counts, follow_run_id, run_id]);

  const cycles_run_id = (ledger_cycles_run_id.trim() || default_cycles_run_id).trim();

  const cycles_run_options = useMemo(() => {
    const out = new Set<string>();
    const root = run_id.trim();
    const follow = follow_run_id.trim();
    if (root) out.add(root);
    if (follow) out.add(follow);
    for (const r of subrun_ids) {
      const rid = String(r || "").trim();
      if (rid) out.add(rid);
    }
    for (const item of ledger_record_items) {
      const rid = String(item.run_id || item.record?.run_id || "").trim();
      if (rid) out.add(rid);
    }

    const ids = Array.from(out);
    ids.sort((a, b) => {
      if (root && a === root && b !== root) return -1;
      if (root && b === root && a !== root) return 1;
      if (follow && a === follow && b !== follow) return -1;
      if (follow && b === follow && a !== follow) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return ids;
  }, [run_id, follow_run_id, subrun_ids, ledger_record_items]);

  const agent_trace = useMemo(() => build_agent_trace(ledger_record_items, { run_id: cycles_run_id }), [ledger_record_items, cycles_run_id]);

  const selected_run_summary = useMemo(() => {
    const rid = run_id.trim();
    if (!rid) return null;
    return run_options.find((r) => String(r.run_id || "").trim() === rid) || null;
  }, [run_options, run_id]);

  const selected_run_label = useMemo(() => {
    const target = typeof (run_state as any)?.schedule?.target_workflow_id === "string" ? String((run_state as any).schedule.target_workflow_id).trim() : "";
    if (target) return extract_workflow_label(target, workflow_label_by_id);
    return extract_workflow_label(selected_run_summary?.workflow_id, workflow_label_by_id);
  }, [run_state, selected_run_summary, workflow_label_by_id]);

  const selected_run_status_raw = String(run_state?.status || selected_run_summary?.status || "").trim();
  const selected_run_wait_reason = String(wait_reason || run_state?.waiting?.reason || selected_run_summary?.waiting_reason || "").trim().toLowerCase();
  const selected_run_is_scheduled = Boolean(run_state?.is_scheduled || selected_run_summary?.is_scheduled);
  const selected_run_is_paused = Boolean(run_state?.paused || selected_run_summary?.paused);
  const selected_run_is_scheduled_waiting = selected_run_is_scheduled && selected_run_status_raw.toLowerCase() === "waiting";
  const selected_run_is_scheduled_until = selected_run_is_scheduled_waiting && selected_run_wait_reason === "until";
  const selected_next_ms = parse_iso_ms(wait_until);
  const selected_next_in =
    selected_run_is_scheduled_until && selected_next_ms !== null ? format_time_until_from_ms(selected_next_ms - Date.now()) : "";
  const selected_next_at =
    selected_run_is_scheduled_until && selected_next_ms !== null
      ? new Date(selected_next_ms).toLocaleString()
      : selected_run_is_scheduled_until
        ? String(wait_until || "").trim()
        : "";
  const selected_run_status_label = selected_run_is_scheduled && selected_run_is_paused ? "Suspended" : selected_run_is_scheduled_waiting ? "Scheduled" : selected_run_status_raw;
  const selected_run_status_chip_cls = selected_run_is_scheduled && (selected_run_is_paused || selected_run_is_scheduled_waiting)
    ? "scheduled"
    : selected_run_status_raw.toLowerCase() === "completed"
      ? "ok"
      : selected_run_status_raw.toLowerCase() === "failed"
        ? "danger"
        : selected_run_status_raw.toLowerCase() === "waiting" || selected_run_status_raw.toLowerCase() === "running"
          ? "warn"
          : "muted";
  const selected_run_when = format_time_ago(selected_run_summary?.updated_at || selected_run_summary?.created_at);

  return (
      <div className="app-shell">
      <div className="app-header">
        <div className="logo" title="AbstractObserver (Web/PWA)">
          <span className="logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <ellipse
                cx="12"
                cy="12"
                rx="9"
                ry="4.2"
                transform="rotate(-18 12 12)"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.75"
              />
              <circle cx="12" cy="12" r="4.7" fill="currentColor" opacity="0.95" />
              <circle cx="10.3" cy="10.7" r="1.6" fill="#ffffff" opacity="0.18" />
              <circle cx="19" cy="13.6" r="1.2" fill="currentColor" />
            </svg>
          </span>
          <span>AbstractObserver</span>
        </div>
        <div className="app_nav">
          <button className={`nav_tab ${page === "observe" ? "active" : ""}`} onClick={() => set_page("observe")}>
            Observe
          </button>
          <button className={`nav_tab ${page === "launch" ? "active" : ""}`} onClick={() => set_page("launch")}>
            Launch
          </button>
          <button className={`nav_tab ${page === "mindmap" ? "active" : ""}`} onClick={() => set_page("mindmap")}>
            Mindmap
          </button>
          <button className={`nav_tab ${page === "backlog" ? "active" : ""}`} onClick={() => set_page("backlog")}>
            Backlog
          </button>
          <button className={`nav_tab ${page === "inbox" ? "active" : ""}`} onClick={() => set_page("inbox")}>
            Inbox
          </button>
          <button className={`nav_tab ${page === "settings" ? "active" : ""}`} onClick={() => set_page("settings")}>
            Settings
          </button>
        </div>
        <div className="status_pills">
          <span className={`status_pill ${gateway_connected ? "ok" : discovery_loading ? "warn" : "muted"}`}>
            gateway {gateway_connected ? "ok" : discovery_loading ? "…" : "off"}
          </span>
          {page === "observe" ? (
            <>
              <span className={`status_pill ${connected ? "ok" : connecting ? "warn" : "muted"}`}>
                run {connected ? "ok" : connecting ? "…" : "off"}
              </span>
              <span className="status_pill muted status_pill_cursor">cursor {cursor}</span>
            </>
          ) : null}
          {monitor_gpu_enabled ? (
            <monitor-gpu
              ref={monitor_gpu_ref as any}
              mode="icon"
              history-size="5"
              tick-ms="1500"
              base-url={settings.gateway_url}
              title="GPU usage (host)"
              style={
                {
                  ["--monitor-gpu-width" as any]: "34px",
                  ["--monitor-gpu-bars-height" as any]: "22px",
                  ["--monitor-gpu-padding" as any]: "2px 4px",
                  ["--monitor-gpu-radius" as any]: "999px",
                  ["--monitor-gpu-bg" as any]: "rgba(0,0,0,0.22)",
                  ["--monitor-gpu-border" as any]: "rgba(255,255,255,0.16)",
                  flexShrink: 0,
                } as React.CSSProperties
              }
            />
          ) : null}
        </div>
      </div>

      <div className="app-body">
        {page === "settings" ? (
          <div className="page page_scroll">
            <div className="page_inner constrained">
              <div className="card">
                <div className="title">
                  <h1>Settings</h1>
                </div>

                <div className="section_title">Appearance</div>
                <div className="field">
                  <label>Theme</label>
                  <ThemeSelect value={settings.theme} onChange={(id) => set_settings((s) => ({ ...s, theme: id }))} />
                  <div className="mono muted" style={{ fontSize: "12px", marginTop: "6px" }}>
                    Stored locally in this browser (no server round-trip).
                  </div>
                </div>

                <div className="section_title">Gateway</div>
                <div className="field">
                  <label>Gateway URL (blank = same origin / dev proxy)</label>
                  <div className="field_inline">
                    <input
                      value={settings.gateway_url}
                      onChange={(e) => set_settings((s) => ({ ...s, gateway_url: e.target.value }))}
                      placeholder="https://your-gateway-host"
                    />
                    <button className="btn" onClick={gateway_connected ? disconnect_gateway : on_discover_gateway} disabled={discovery_loading}>
                      {discovery_loading ? "Connecting…" : gateway_connected ? "Disconnect" : "Connect"}
                    </button>
                  </div>
                  {discovery_error ? (
                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px" }}>
                      {discovery_error}
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label>Auto-connect to gateway on load</label>
                  <select
                    value={settings.auto_connect_gateway ? "on" : "off"}
                    onChange={(e) => set_settings((s) => ({ ...s, auto_connect_gateway: e.target.value === "on" }))}
                  >
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </div>
                <div className="field">
                  <label>Gateway token (Authorization: Bearer …)</label>
                  <input
                    type="password"
                    value={settings.auth_token}
                    onChange={(e) => set_settings((s) => ({ ...s, auth_token: e.target.value }))}
                    placeholder="(optional for localhost dev)"
                  />
                </div>

                <div className="section_title">Maintenance AI</div>
                <ProviderModelSelect
                  className="field"
                  providerLabel="Provider (blank = gateway default)"
                  modelLabel="Model (blank = gateway default)"
                  providerPlaceholder="lmstudio"
                  modelPlaceholder="qwen/qwen3-next-80b"
                  provider={settings.maintenance_ai_provider}
                  model={settings.maintenance_ai_model}
                  providers={discovered_provider_options}
                  models={maintenance_models_for_provider.models}
                  loadingProviders={discovery_loading}
                  loadingModels={maintenance_models_loading}
                  modelError={maintenance_provider_selected ? maintenance_models_for_provider.error : ""}
                  allowCustomProvider
                  allowCustomModel
                  allowGatewayDefault
                  gatewayDefaultLabel="(gateway default)"
                  selectClassName="mono"
                  onChange={(next) =>
                    set_settings((s) => ({
                      ...s,
                      maintenance_ai_provider: next.provider,
                      maintenance_ai_model: next.model,
                    }))
                  }
                />
                <div className="mono muted" style={{ fontSize: "12px", marginTop: "6px" }}>
                  Used for backlog AI assist and in-editor maintenance chat. Defaults follow `ABSTRACTGATEWAY_PROVIDER` / `ABSTRACTGATEWAY_MODEL`.
                </div>

                <div className="section_divider" />
                <div className="section_title">Remote Tool Worker (MCP)</div>
                <details>
                  <summary className="mono muted" style={{ cursor: "pointer" }}>
                    Advanced
                  </summary>
                  <div className="field" style={{ marginTop: "10px" }}>
                    <label>Tool worker endpoint (MCP HTTP)</label>
                    <input
                      className="mono"
                      value={settings.worker_url}
                      onChange={(e) => set_settings((s) => ({ ...s, worker_url: e.target.value }))}
                      placeholder="https://your-mcp-worker-endpoint"
                    />
                  </div>
                  <div className="field">
                    <label>Tool worker token (Authorization: Bearer …)</label>
                    <input
                      className="mono"
                      type="password"
                      value={settings.worker_token}
                      onChange={(e) => set_settings((s) => ({ ...s, worker_token: e.target.value }))}
                      placeholder="(optional)"
                    />
                  </div>
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    Used to execute tool waits from the UI (advanced / potentially dangerous).
                  </div>
                </details>
              </div>
            </div>
          </div>
        ) : null}

        {page === "launch" ? (
          <div className="page page_scroll">
            <div className="page_inner constrained">
              <div className="card">
                <div className="title">
                  <h1>Launch</h1>
                </div>

                {!gateway_connected ? (
                  <div className="log_item" style={{ borderColor: "rgba(245, 158, 11, 0.35)" }}>
                    <div className="meta">
                      <span className="mono">gateway</span>
                      <span className="mono">{now_iso()}</span>
                    </div>
                    <div className="body mono">
                      Not connected. Open{" "}
                      <button className="btn" onClick={() => set_page("settings")}>
                        Settings
                      </button>{" "}
                      to connect to a gateway.
                    </div>
                  </div>
                ) : null}

                <div className="field">
                  <label>Workflow (discovered)</label>
                  <select
                    value={selected_workflow_value}
                    onChange={async (e) => {
                      const wid = String(e.target.value || "").trim();
                      if (!wid) return;
                      const parsed = parse_namespaced_workflow_id(wid);
                      if (!parsed) return;
                      set_bundle_id(parsed.bundle_id);
                      set_flow_id(parsed.flow_id);
                      set_graph_flow_id(parsed.flow_id);
                      await load_bundle_info(parsed.bundle_id);
                    }}
                    disabled={discovery_loading || !workflow_options.length}
                  >
                    <option value="">{workflow_options.length ? "(select)" : "(empty — connect in Settings)"}</option>
                    {workflow_options.map((w) => (
                      <option key={w.workflow_id} value={w.workflow_id}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <div className="actions" style={{ justifyContent: "flex-start", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                    <input
                      ref={bundle_upload_input_ref}
                      type="file"
                      accept=".flow"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files && e.target.files.length ? e.target.files[0] : null;
                        if (!f) return;
                        void upload_gateway_bundle(f);
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => bundle_upload_input_ref.current?.click()}
                      disabled={!gateway_connected || discovery_loading || bundle_uploading || connecting || resuming}
                    >
                      {bundle_uploading ? "Uploading…" : "Upload .flow"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void reload_gateway_bundles()}
                      disabled={!gateway_connected || discovery_loading || bundles_reloading || connecting || resuming}
                    >
                      {bundles_reloading ? "Reloading…" : "Reload bundles"}
                    </button>
                    <button type="button" className="btn" onClick={() => void refresh_runs()} disabled={!gateway_connected || runs_loading || discovery_loading}>
                      {runs_loading ? "Refreshing…" : "Refresh runs"}
                    </button>
                    <div className="mono muted" style={{ fontSize: "12px" }}>
                      Use Upload for remote installs. Reload picks up server-side edits (dev).
                    </div>
                  </div>
                  {selected_entrypoint?.description ? (
                    <div className="mono muted" style={{ fontSize: "12px", marginTop: "6px" }}>
                      {String(selected_entrypoint.description)}
                    </div>
                  ) : null}
                  {bundle_loading ? (
                    <div className="mono muted" style={{ fontSize: "12px" }}>
                      Loading workflow…
                    </div>
                  ) : null}
	                  {bundle_error ? (
	                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px" }}>
	                      {bundle_error}
	                    </div>
	                  ) : null}
	                </div>

	                {bundle_info && selected_entrypoint ? (
	                  <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)", marginTop: "10px" }}>
	                    <div className="meta">
	                      <span className="mono">workflow</span>
	                      <span className="mono">{String(bundle_info.bundle_ref || `${bundle_id.trim()}:${flow_id.trim()}`)}</span>
	                    </div>
	                    <div className="body">
	                      {selected_entrypoint.name ? (
	                        <div className="mono">
	                          <span className="muted">name</span>: {String(selected_entrypoint.name)}
	                        </div>
	                      ) : null}
	                      {selected_entrypoint.interfaces && selected_entrypoint.interfaces.length ? (
	                        <div className="mono">
	                          <span className="muted">interfaces</span>: {selected_entrypoint.interfaces.join(", ")}
	                        </div>
	                      ) : null}
	                      <div className="mono">
	                        <span className="muted">inputs</span>: {adaptive_pins.length}
	                      </div>
	                      {bundle_info.created_at ? (
	                        <div className="mono">
	                          <span className="muted">created</span>: {String(bundle_info.created_at)}
	                        </div>
	                      ) : null}
	                    </div>
	                  </div>
	                ) : null}

	                <div className="field">
	                  <label>session_id (scope=session)</label>
	                  <input
                    className="mono"
                    value={start_session_id}
                    onChange={(e) => set_start_session_id(e.target.value)}
                    placeholder="(optional; empty ⇒ scope=session behaves like per-run)"
                    disabled={connecting || resuming}
                  />
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    Shared across runs when the same session_id is sent to the gateway.
                  </div>
                </div>

                <div className="actions" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                  <button
                    className="btn primary"
                    onClick={() => void submit_launch()}
                    disabled={
                      connecting ||
                      resuming ||
                      discovery_loading ||
                      bundle_loading ||
                      schedule_submitting ||
                      !gateway_connected ||
                      !bundle_id.trim() ||
                      !flow_id.trim() ||
                      input_data_obj === null
                    }
                  >
                    {schedule_start_mode !== "now" || schedule_repeat_mode !== "once" ? "Launch (scheduled)" : "Launch now"}
                  </button>
                  <div className="mono muted" style={{ fontSize: "12px", alignSelf: "center" }}>
                    {schedule_start_mode !== "now" || schedule_repeat_mode !== "once"
                      ? "Uses the schedule settings below."
                      : "Starts immediately (no schedule)."}
                  </div>
                </div>

                {new_run_error ? (
                  <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: "10px" }}>
                    <div className="meta">
                      <span className="mono">error</span>
                      <span className="mono">{now_iso()}</span>
                    </div>
                    <div className="body mono">{new_run_error}</div>
                  </div>
                ) : null}

                <details style={{ marginTop: "10px" }} open>
                  <summary className="mono muted" style={{ cursor: "pointer" }}>
                    Inputs
                  </summary>

                  {!bundle_id.trim() || !flow_id.trim() ? (
                    <div className="mono muted" style={{ fontSize: "12px", marginTop: "8px" }}>
                      Select a workflow above to configure inputs.
                    </div>
                  ) : input_data_obj === null ? (
                    <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: "10px" }}>
                      <div className="meta">
                        <span className="mono">input error</span>
                        <span className="mono">{now_iso()}</span>
                      </div>
                      <div className="body mono">Invalid input JSON. Fix it in Advanced JSON.</div>
                    </div>
                  ) : has_adaptive_inputs ? (
                    <div style={{ marginTop: "10px" }}>
                      {adaptive_pins.map((p) => {
                        if (!p || typeof p !== "object") return null;
                        const pid = String((p as any).id || "").trim();
                        if (!pid) return null;
                        const label = String((p as any).label || pid).trim() || pid;
                        const ptype = String((p as any).type || "").trim().toLowerCase();
                        const has_default = Object.prototype.hasOwnProperty.call(p, "default");
                        const default_s = has_default ? safe_json_inline((p as any).default, 160) : "";
                        const disabled = connecting || resuming;
                        const cur = (input_data_obj as any)?.[pid];

                        const field_label = ptype && ptype !== "unknown" ? `${label} (${ptype})` : label;
                        const hint = default_s ? `default: ${default_s}` : "";

                        if (ptype === "tools") {
                          const selected = Array.isArray(cur)
                            ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean)
                            : [];
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              <MultiSelect
                                options={available_tool_names}
                                value={selected}
                                disabled={disabled}
                                placeholder="(no tools selected)"
                                onChange={(next) => update_input_data_field(pid, next)}
                              />
                              {hint ? (
                                <div className="mono muted" style={{ fontSize: "12px" }}>
                                  {hint}
                                </div>
                              ) : null}
                            </div>
                          );
                        }

                        if (ptype === "provider") {
                          const selected = typeof cur === "string" ? String(cur) : "";
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              <select value={selected} onChange={(e) => update_input_data_field(pid, e.target.value)} disabled={disabled}>
                                <option value="">{has_default ? `(default: ${default_s || "…" })` : "(unset)"}</option>
                                {available_providers.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        if (ptype === "model") {
                          const selected = typeof cur === "string" ? String(cur) : "";
                          const prov = String((input_data_obj as any)?.provider || "").trim();
                          const found = prov ? discovered_models_by_provider[prov] : undefined;
                          const models = found && Array.isArray(found.models) ? found.models.map((x) => String(x || "").trim()).filter(Boolean) : [];
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              {models.length ? (
                                <select value={selected} onChange={(e) => update_input_data_field(pid, e.target.value)} disabled={disabled}>
                                  <option value="">{has_default ? `(default: ${default_s || "…" })` : "(unset)"}</option>
                                  {models.map((m) => (
                                    <option key={m} value={m}>
                                      {m}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="mono"
                                  value={selected}
                                  onChange={(e) => update_input_data_field(pid, e.target.value)}
                                  placeholder={has_default ? `(default: ${default_s || "…" })` : "model id"}
                                  disabled={disabled}
                                />
                              )}
                            </div>
                          );
                        }

                        if (ptype === "boolean") {
                          const selected = typeof cur === "boolean" ? (cur ? "true" : "false") : "";
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              <select
                                value={selected}
                                onChange={(e) => {
                                  const v = String(e.target.value || "").trim();
                                  if (!v) update_input_data_field(pid, undefined);
                                  else update_input_data_field(pid, v === "true");
                                }}
                                disabled={disabled}
                              >
                                <option value="">{has_default ? `(default: ${default_s || "…" })` : "(unset)"}</option>
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            </div>
                          );
                        }

                        if (ptype === "number") {
                          const selected = typeof cur === "number" && Number.isFinite(cur) ? String(cur) : "";
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              <input
                                type="number"
                                value={selected}
                                onChange={(e) => {
                                  const raw = String(e.target.value || "").trim();
                                  if (!raw) {
                                    update_input_data_field(pid, undefined);
                                    return;
                                  }
                                  const n = Number(raw);
                                  if (Number.isFinite(n)) update_input_data_field(pid, n);
                                }}
                                placeholder={has_default ? `(default: ${default_s || "…" })` : ""}
                                disabled={disabled}
                              />
                            </div>
                          );
                        }

                        if (ptype === "array") {
                          const selected = Array.isArray(cur) ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean).join("\n") : "";
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              <textarea
                                className="mono"
                                value={selected}
                                onChange={(e) => {
                                  const lines = String(e.target.value || "")
                                    .split(/\r?\n/g)
                                    .map((x) => String(x || "").trim())
                                    .filter(Boolean);
                                  update_input_data_field(pid, lines.length ? lines : undefined);
                                }}
                                placeholder={has_default ? `(default: ${default_s || "…" })` : "(one item per line)"}
                                rows={3}
                                disabled={disabled}
                              />
                            </div>
                          );
                        }

                        if (is_json_pin_type(ptype)) {
                          const val = typeof pin_json_text_by_id[pid] === "string" ? pin_json_text_by_id[pid] : "";
                          const err = String(pin_json_error_by_id[pid] || "").trim();
                          return (
                            <div key={pid} className="field" style={{ marginTop: "10px" }}>
                              <label>{field_label}</label>
                              <textarea
                                className="mono"
                                value={val}
                                onChange={(e) => {
                                  const next = String(e.target.value ?? "");
                                  set_pin_json_text_by_id((prev) => ({ ...prev, [pid]: next }));
                                  const trimmed = next.trim();
                                  if (!trimmed) {
                                    set_pin_json_error_by_id((prev) => {
                                      const out = { ...prev };
                                      delete out[pid];
                                      return out;
                                    });
                                    update_input_data_field(pid, undefined);
                                    return;
                                  }
                                  try {
                                    const parsed = JSON.parse(trimmed);
                                    set_pin_json_error_by_id((prev) => {
                                      const out = { ...prev };
                                      delete out[pid];
                                      return out;
                                    });
                                    update_input_data_field(pid, parsed);
                                  } catch (e: any) {
                                    set_pin_json_error_by_id((prev) => ({
                                      ...prev,
                                      [pid]: String(e?.message || e || "Invalid JSON"),
                                    }));
                                  }
                                }}
                                placeholder={has_default ? `(default: ${default_s || "…" })` : "{...}"}
                                rows={5}
                                disabled={disabled}
                              />
                              {err ? (
                                <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px" }}>
                                  {err}
                                </div>
                              ) : hint ? (
                                <div className="mono muted" style={{ fontSize: "12px" }}>
                                  {hint}
                                </div>
                              ) : null}
                            </div>
                          );
                        }

                        const selected = typeof cur === "string" ? String(cur) : "";
                        const is_prompt = pid === "prompt";
                        return (
                          <div key={pid} className="field" style={{ marginTop: "10px" }}>
                            <label>{field_label}</label>
                            {is_prompt ? (
                              <textarea
                                className="mono"
                                value={selected}
                                onChange={(e) => update_input_data_field(pid, e.target.value)}
                                placeholder={has_default ? `(default: ${default_s || "…" })` : "prompt"}
                                rows={3}
                                disabled={disabled}
                              />
                            ) : (
                              <input
                                className="mono"
                                value={selected}
                                onChange={(e) => update_input_data_field(pid, e.target.value)}
                                placeholder={has_default ? `(default: ${default_s || "…" })` : ""}
                                disabled={disabled}
                              />
                            )}
                            {hint ? (
                              <div className="mono muted" style={{ fontSize: "12px" }}>
                                {hint}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      <div className="mono muted" style={{ fontSize: "12px", marginTop: "10px" }}>
                        Advanced JSON below is the source of truth for full `input_data`.
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="field" style={{ marginTop: "10px" }}>
                        <label>Prompt (common)</label>
                        <textarea
                          className="mono"
                          value={prompt_value}
                          onChange={(e) => update_input_data_field("prompt", e.target.value)}
                          placeholder="What do you want the workflow/agent to do?"
                          rows={3}
                          disabled={connecting || resuming}
                        />
                      </div>
                      <div className="row">
                        <div className="col">
                          <div className="field">
                            <label>Provider (common)</label>
                            <input
                              className="mono"
                              value={provider_value}
                              onChange={(e) => update_input_data_field("provider", e.target.value)}
                              placeholder="lmstudio / ollama / openai / ..."
                              disabled={connecting || resuming}
                            />
                          </div>
                        </div>
                        <div className="col">
                          <div className="field">
                            <label>Model (common)</label>
                            <input
                              className="mono"
                              value={model_value}
                              onChange={(e) => update_input_data_field("model", e.target.value)}
                              placeholder="qwen/qwen3-next-80b / gpt-4.1 / ..."
                              disabled={connecting || resuming}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <details style={{ marginTop: "10px" }}>
                    <summary className="mono muted" style={{ cursor: "pointer" }}>
                      Advanced: input_data JSON
                    </summary>
                    <div className="field" style={{ marginTop: "10px" }}>
                      <label>Input data (JSON)</label>
                      <textarea
                        className="mono"
                        value={input_data_text}
                        onChange={(e) => set_input_data_text(e.target.value)}
                        placeholder='{"prompt":"...","provider":"lmstudio","model":"qwen/qwen3-next-80b"}'
                        rows={10}
                        disabled={connecting || resuming}
                      />
                    </div>
                  </details>

                  <details style={{ marginTop: "10px" }}>
                    <summary className="mono muted" style={{ cursor: "pointer" }}>
                      Workspace policy (filesystem)
                    </summary>
                    <div className="field" style={{ marginTop: "10px" }}>
                      <label>Workspace root (workspace_root)</label>
                      <input
                        className="mono"
                        value={workspace_root_value}
                        onChange={(e) => update_input_data_field("workspace_root", e.target.value)}
                        placeholder="(leave blank to auto-generate a per-run workspace on the gateway)"
                        disabled={connecting || resuming}
                      />
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        Relative tool paths resolve under this directory.
                      </div>
                    </div>
                    <div className="field">
                      <label>Filesystem access mode (workspace_access_mode)</label>
                      <select
                        className="mono"
                        value={(workspace_access_mode_value || "workspace_only").trim() || "workspace_only"}
                        onChange={(e) => update_input_data_field("workspace_access_mode", e.target.value)}
                        disabled={connecting || resuming}
                      >
                        <option value="workspace_only">workspace_only (restrict absolute paths to workspace_root)</option>
                        <option value="all_except_ignored">all_except_ignored (allow absolute paths outside workspace_root)</option>
                      </select>
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        This only affects absolute paths; relative paths still stay under workspace_root.
                      </div>
                    </div>
                    <div className="field">
                      <label>Ignored folders (workspace_ignored_paths)</label>
                      <textarea
                        className="mono"
                        value={workspace_ignored_paths_value}
                        onChange={(e) => update_input_data_field("workspace_ignored_paths", e.target.value)}
                        placeholder={".git\nnode_modules\n.venv\n~/Library\n/Users/albou/.ssh"}
                        rows={5}
                        disabled={connecting || resuming}
                      />
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        One path per line. Relative entries are resolved under workspace_root.
                      </div>
	                    </div>
	                  </details>

	                </details>

	                <details style={{ marginTop: "10px" }}>
	                    <summary className="mono muted" style={{ cursor: "pointer" }}>
	                      Schedule
	                    </summary>

                    {(() => {
                      const unit_label = schedule_every_unit === "weeks" ? "week" : schedule_every_unit === "months" ? "month" : schedule_every_unit.slice(0, -1);
                      const n = Math.max(1, Math.floor(schedule_every_n || 1));
                      const every = `${n} ${unit_label}${n === 1 ? "" : "s"}`;
                      const start_s =
                        schedule_start_mode === "now"
                          ? "now"
                          : schedule_start_at_local
                            ? (() => {
                                const dt = new Date(schedule_start_at_local);
                                return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : "at …";
                              })()
                            : "at …";
                      const until_s =
                        schedule_repeat_mode === "until" && schedule_repeat_until_date_local
                          ? (() => {
                              const t = schedule_repeat_until_time_local || "23:59";
                              const dt = new Date(`${schedule_repeat_until_date_local}T${t}`);
                              return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : "…";
                            })()
                          : "";
                      const end_s =
                        schedule_repeat_mode === "once"
                          ? ""
                          : schedule_repeat_mode === "forever"
                            ? "forever"
                            : schedule_repeat_mode === "count"
                              ? `${Math.max(1, Math.floor(schedule_repeat_count || 1))} runs`
                              : until_s
                                ? `until ${until_s}`
                                : "until …";
                      const summary =
                        schedule_repeat_mode === "once"
                          ? `Runs once • starts ${start_s}`
                          : `Repeats every ${every} • starts ${start_s} • ${end_s}`;
                      return (
                        <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)", marginTop: "10px" }}>
                          <div className="meta">
                            <span className="mono">schedule</span>
                            <span className="mono">{schedule_repeat_mode}</span>
                          </div>
                          <div className="body">{summary}</div>
                        </div>
                      );
                    })()}

                    {schedule_error ? (
                      <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: "10px" }}>
                        <div className="meta">
                          <span className="mono">error</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{schedule_error}</div>
                      </div>
                    ) : null}

                    <div className="field" style={{ marginTop: "10px" }}>
                      <label>Start</label>
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                        <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <input
                            type="radio"
                            name="schedule_start"
                            checked={schedule_start_mode === "now"}
                            onChange={() => set_schedule_start_mode("now")}
                          />
                          now
                        </label>
                        <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <input
                            type="radio"
                            name="schedule_start"
                            checked={schedule_start_mode === "at"}
                            onChange={() => set_schedule_start_mode("at")}
                          />
                          at
                        </label>
                        {schedule_start_mode === "at" ? (
                          <input type="datetime-local" value={schedule_start_at_local} onChange={(e) => set_schedule_start_at_local(e.target.value)} />
                        ) : null}
                      </div>
                      {schedule_start_mode === "at" ? (
                        <div className="mono muted" style={{ fontSize: "12px" }}>
                          Uses your device time; the gateway stores UTC.
                        </div>
                      ) : null}
                    </div>

                    <div className="field">
                      <label>Cadence</label>
                      <select value={schedule_repeat_mode} onChange={(e) => set_schedule_repeat_mode(e.target.value as any)}>
                        <option value="once">Once</option>
                        <option value="forever">Repeat</option>
                        <option value="count">Repeat • N times</option>
                        <option value="until">Repeat • until date</option>
                      </select>
                    </div>

                    {schedule_repeat_mode !== "once" ? (
                      <>
                        <div className="row">
                          <div className="col">
                            <div className="field">
                              <label>Every</label>
                              <input
                                type="number"
                                min={1}
                                value={String(schedule_every_n)}
                                onChange={(e) => set_schedule_every_n(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                              />
                            </div>
                          </div>
                          <div className="col">
                            <div className="field">
                              <label>Unit</label>
                              <select value={schedule_every_unit} onChange={(e) => set_schedule_every_unit(e.target.value as any)}>
                                <option value="minutes">minutes</option>
                                <option value="hours">hours</option>
                                <option value="days">days</option>
                                <option value="weeks">weeks (≈7d)</option>
                                <option value="months">months (≈30d)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        {schedule_every_unit === "months" || schedule_every_unit === "weeks" ? (
                          <div className="mono muted" style={{ fontSize: "12px" }}>
                            Note: weeks/months are implemented as fixed day intervals (calendar-aware scheduling is planned).
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {schedule_repeat_mode === "count" ? (
                      <div className="field">
                        <label>Runs</label>
                        <input
                          type="number"
                          min={1}
                          value={String(schedule_repeat_count)}
                          onChange={(e) => set_schedule_repeat_count(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                        />
                      </div>
                    ) : null}

                    {schedule_repeat_mode === "until" ? (
                      <div className="row">
                        <div className="col">
                          <div className="field">
                            <label>Until (date)</label>
                            <input type="date" value={schedule_repeat_until_date_local} onChange={(e) => set_schedule_repeat_until_date_local(e.target.value)} />
                          </div>
                        </div>
                        <div className="col">
                          <div className="field">
                            <label>Until (time)</label>
                            <input type="time" value={schedule_repeat_until_time_local} onChange={(e) => set_schedule_repeat_until_time_local(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="field">
                      <label>Context</label>
                      <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <input type="checkbox" checked={schedule_share_context} onChange={(e) => set_schedule_share_context(Boolean(e.target.checked))} />
                        Share context over time/calls
                      </label>
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        When disabled, each execution runs in its own session (isolated memory).
                      </div>
                    </div>

                    <div className="mono muted" style={{ fontSize: "12px" }}>
                      Tip: set cadence to Once + now for an immediate launch.
                    </div>
                  </details>
              </div>
            </div>
          </div>
        ) : null}

        {page === "backlog" ? (
          <BacklogBrowserPage
            gateway={gateway}
            gateway_connected={gateway_connected}
            maintenance_ai_provider={settings.maintenance_ai_provider}
            maintenance_ai_model={settings.maintenance_ai_model}
          />
        ) : null}

        {page === "inbox" ? (
          <ReportInboxPage
            gateway={gateway}
            gateway_connected={gateway_connected}
            default_session_id={session_id_for_run || run_id || start_session_id}
            default_active_run_id={run_id}
            default_workflow_id={(run_state as any)?.workflow_id ?? selected_run_summary?.workflow_id ?? null}
          />
        ) : null}

        {page === "mindmap" ? (
          <div className="page mindmap_page">
            {!gateway_connected ? (
              <div className="page_inner constrained">
                <div className="card">
                  <div className="title">
                    <h1>Mindmap</h1>
                  </div>
                  <div className="mono muted">
                    Not connected. Open{" "}
                    <button className="btn" onClick={() => set_page("settings")}>
                      Settings
                    </button>{" "}
                    to connect to a gateway.
                  </div>
                </div>
              </div>
            ) : (
              <div className="mindmap_full">
                <MindmapPanel
                  gateway={gateway}
                  selected_run_id={run_id}
                  selected_session_id={session_id_for_run || start_session_id}
                />
              </div>
            )}
          </div>
        ) : null}

        {page === "observe" ? (
          <div className="page observe_page">
            <div className="observe_layout">
              <div className="card panel_card scroll_y observe_sidebar">
                <div className="section_title">Runs</div>
                <div className="field">
                  <label>Runs (parent — select to observe)</label>
                  <div className="field_inline">
                    <RunPicker
                      runs={run_options}
                      selected_run_id={run_id}
                      workflow_label_by_id={workflow_label_by_id}
                      disabled={!gateway_connected || runs_loading || discovery_loading || connecting || resuming}
                      loading={runs_loading}
                      onSelect={(rid) => void attach_to_run(rid)}
                    />
                    <button className="btn" onClick={refresh_runs} disabled={!gateway_connected || runs_loading || discovery_loading}>
                      {runs_loading ? "Refreshing…" : "Refresh"}
                    </button>
                    <button className="btn" onClick={clear_run_view} disabled={!run_id.trim() && !connected}>
                      Disconnect
                    </button>
                  </div>
                </div>

	                <div className="actions" style={{ justifyContent: "flex-start" }}>
	                  <button
	                    className="btn"
	                    onClick={() => {
	                      if (primary_control_action === "pause") {
	                        set_run_control_type("pause");
	                        set_run_control_reason("");
	                        set_run_control_error("");
	                        set_run_control_open(true);
	                        return;
	                      }
	                      void submit_run_control("resume");
	                    }}
	                    disabled={primary_control_disabled}
	                  >
	                    {primary_control_label}
	                  </button>
	                  {can_run_scheduled_now ? (
	                    <button
	                      className="btn primary"
	                      onClick={() => void run_scheduled_now()}
	                      disabled={!run_id.trim() || connecting || resuming || run_terminal || run_paused}
	                    >
	                      Run now
	                    </button>
	                  ) : null}
	                  <button
	                    className="btn danger"
	                    onClick={() => {
	                      set_run_control_type("cancel");
	                      set_run_control_reason("");
	                      set_run_control_error("");
	                      set_run_control_open(true);
	                    }}
	                    disabled={!run_id.trim() || connecting || resuming || run_terminal}
	                  >
	                    Cancel
	                  </button>
	                  <button className="btn" onClick={() => set_page("launch")} disabled={!gateway_connected || discovery_loading}>
	                    Launch…
	                  </button>
	                </div>

                {is_waiting ? (
                  <div className="log_item" style={{ borderColor: "rgba(96, 165, 250, 0.25)" }}>
	                    <div className="meta">
	                      <span className="mono">{is_scheduled_run ? (run_paused ? "suspended" : "scheduled") : "waiting"}</span>
	                      <span className="mono">{wait_reason || "unknown"}</span>
	                    </div>
                    <div className="body">
                      {wait_key ? (
                        <div className="mono" title={wait_key}>
                          <span className="muted">wait_key</span>: {short_id(wait_key, 46)}
                        </div>
                      ) : null}
                      {wait_reason === "event" && wait_event_name ? (
                        <div className="mono">
                          <span className="muted">event</span>: {wait_event_name}
                        </div>
                      ) : null}
                      {wait_reason === "subworkflow" && sub_run_id ? (
                        <div className="mono">
                          <span className="muted">child run</span>: {short_id(sub_run_id, 18)}
                        </div>
                      ) : null}
                      {wait_reason === "until" && wait_until ? (
                        <div className="mono" title={wait_until}>
                          <span className="muted">until</span>: {short_id(wait_until, 46)}
                        </div>
                      ) : null}
                    </div>
                    {wait_reason === "until" && wait_until ? (
                      <div className="mono muted" style={{ marginTop: "10px", fontSize: "12px" }}>
                        {(() => {
                          const ms = parse_iso_ms(wait_until);
                          const at = ms !== null ? new Date(ms).toLocaleString() : wait_until;
                          const in_ = ms !== null ? format_time_until_from_ms(ms - Date.now()) : "";
                          return `Next execution at ${at}${in_ ? ` (in ${in_})` : ""}`;
                        })()}
                      </div>
                    ) : null}
                    {wait_reason === "subworkflow" && sub_run_id ? (
                      <div className="actions">
                        <button
                          className="btn primary"
                          onClick={async () => {
                            set_run_id(sub_run_id);
                            await connect_to_run(sub_run_id);
                          }}
                          disabled={connecting}
                        >
                          Attach to child run
                        </button>
                        {root_run_id.trim() && root_run_id.trim() !== run_id.trim() ? (
                          <button
                            className="btn"
                            onClick={async () => {
                              set_run_id(root_run_id.trim());
                              await connect_to_run(root_run_id.trim());
                            }}
                            disabled={connecting}
                          >
                            Back to root
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {is_scheduled_run ? (
                  <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)" }}>
                    <div className="meta">
                      <span className="mono">schedule</span>
                      <span className="mono">{is_scheduled_recurrent ? `every ${schedule_interval}` : "once"}</span>
                    </div>
                    <div className="body">
                      {schedule_interval ? (
                        <div className="mono">
                          <span className="muted">interval</span>: {schedule_interval}
                        </div>
                      ) : null}
                      <div className="mono">
                        <span className="muted">share context</span>: {schedule_share_ctx ? "true" : "false"}
                      </div>
                      {typeof schedule_meta_repeat_count === "number" ? (
                        <div className="mono">
                          <span className="muted">repeat count</span>: {schedule_meta_repeat_count}
                        </div>
                      ) : null}
                    </div>
                    {limits_pct !== null ? (
                      <div className="body" style={{ marginTop: "10px" }}>
                        <div className="mono muted" style={{ fontSize: "12px", marginBottom: "6px" }}>
                          Context budget
                        </div>
                        <div className="mono" style={{ marginBottom: "6px" }}>
                          {typeof limits_used === "number" && typeof limits_budget === "number"
                            ? `${limits_used.toLocaleString()} / ${limits_budget.toLocaleString()}`
                            : ""}
                          {` • ${Math.round(Math.max(0, Math.min(1, limits_pct)) * 100)}%`}
                        </div>
                        <div style={{ height: "6px", borderRadius: "999px", background: "rgba(148, 163, 184, 0.25)", overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.round(Math.max(0, Math.min(1, limits_pct)) * 100)}%`,
                              background:
                                limits_pct >= 0.9
                                  ? "rgba(239, 68, 68, 0.9)"
                                  : limits_pct >= 0.75
                                    ? "rgba(245, 158, 11, 0.9)"
                                    : "rgba(34, 197, 94, 0.9)",
                            }}
                          />
                        </div>
                        {is_scheduled_recurrent ? (
                          <div className="mono muted" style={{ fontSize: "12px", marginTop: "6px" }}>
                            Auto-compaction triggers at ~90% for recurrent schedules.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="actions">
                      {is_scheduled_recurrent ? (
                        <button
                          className="btn"
                          onClick={() => {
                            set_schedule_edit_interval(schedule_interval || "");
                            set_schedule_edit_apply_immediately(true);
                            set_schedule_edit_error("");
                            set_schedule_edit_open(true);
                          }}
                          disabled={connecting || schedule_edit_submitting}
                        >
                          Edit schedule
                        </button>
                      ) : null}
                      {is_scheduled_recurrent ? (
                        <button
                          className="btn primary"
                          onClick={() => {
                            set_compact_error("");
                            set_compact_open(true);
                          }}
                          disabled={connecting || compact_submitting}
                        >
                          Compact context
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {run_state ? (
                  <details style={{ marginTop: "10px" }}>
                    <summary className="mono" style={{ color: "var(--muted)", cursor: "pointer" }}>
                      Run state • {run_status || "unknown"}
                      {run_paused ? " • paused" : ""}
                    </summary>
                    <div className="log_item" style={{ marginTop: "10px" }}>
                      <div className="body mono">
                        {safe_json({
                          status: run_state?.status,
                          paused: run_state?.paused,
                          current_node: run_state?.current_node,
                          waiting: run_state?.waiting
                            ? {
                                reason: run_state.waiting.reason,
                                wait_key: run_state.waiting.wait_key,
                                prompt: run_state.waiting.prompt,
                                details: run_state.waiting.details,
                              }
                            : null,
                          error: run_state?.error,
                        })}
                      </div>
                    </div>
                  </details>
                ) : null}

                {error_text ? (
                  <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
                    <div className="meta">
                      <span className="mono">error</span>
                      <span className="mono">{now_iso()}</span>
                    </div>
                    <div className="body mono">{error_text}</div>
                  </div>
                ) : null}
              </div>

              <div className="card panel_card card_scroll observe_viewer">
                <div className="tab_bar">
                  <button className={`tab mono ${right_tab === "ledger" ? "active" : ""}`} onClick={() => set_right_tab("ledger")}>
                    Ledger
                  </button>
                  <button className={`tab mono ${right_tab === "graph" ? "active" : ""}`} onClick={() => set_right_tab("graph")}>
                    Graph
                  </button>
                  <button className={`tab mono ${right_tab === "digest" ? "active" : ""}`} onClick={() => set_right_tab("digest")}>
                    Digest
                  </button>
                  <button className={`tab mono ${right_tab === "attachments" ? "active" : ""}`} onClick={() => set_right_tab("attachments")}>
                    Attachments
                  </button>
                  <button className={`tab mono ${right_tab === "chat" ? "active" : ""}`} onClick={() => set_right_tab("chat")}>
                    Chat
                  </button>
                </div>

                <div className="viewer_header">
                  <div className="viewer_header_left">
                    <div className="viewer_run_title">{run_id.trim() ? selected_run_label : "No run selected"}</div>
                    <span className={`chip mono ${selected_run_status_chip_cls}`}>{selected_run_status_label || "—"}</span>
	                    {selected_run_is_scheduled_until && selected_next_in ? (
	                      <span className="chip mono scheduled" title={selected_next_at ? `Next at ${selected_next_at}` : undefined}>
	                        next in {selected_next_in}
	                      </span>
	                    ) : null}
	                    {is_scheduled_recurrent && schedule_interval ? (
	                      <span className="chip mono muted">every {schedule_interval}</span>
	                    ) : null}
	                  </div>
                  <div className="viewer_header_right">
                    {run_id.trim() ? <span className="mono muted">{short_run_id(run_id.trim())}</span> : null}
                    {run_id.trim() ? <span className="muted">{selected_run_when}</span> : null}
                  </div>
                </div>

                {right_tab === "ledger" ? (
                  <>
                    <div className="log_actions" style={{ marginTop: "6px", flexWrap: "wrap" }}>
                      <button className={`btn ${ledger_view === "steps" ? "primary" : ""}`} onClick={() => set_ledger_view("steps")}>
                        Steps
                      </button>
                      <button className={`btn ${ledger_view === "cycles" ? "primary" : ""}`} onClick={() => set_ledger_view("cycles")}>
                        Cycles
                      </button>
                      {ledger_view === "steps" ? (
                        <button className={`btn ${ledger_condensed ? "primary" : ""}`} onClick={() => set_ledger_condensed((v) => !v)}>
                          {ledger_condensed ? "Condensed" : "All"}
                        </button>
                      ) : (
                        <div className="field_inline" style={{ alignItems: "center", flexWrap: "wrap" }}>
                          <span className="mono muted" style={{ fontSize: "12px" }}>
                            Run
                          </span>
                          <select
                            className="mono"
                            value={cycles_run_id}
                            onChange={(e) => set_ledger_cycles_run_id(String(e.target.value || ""))}
                            disabled={!cycles_run_options.length}
                          >
                            {!cycles_run_options.length ? <option value="">(no runs)</option> : null}
                            {cycles_run_options.map((rid) => {
                              const count = typeof cycles_run_counts[rid] === "number" ? Number(cycles_run_counts[rid]) : 0;
                              const label = `${short_id(rid, 18)}${count ? ` • ${count} llm` : ""}`;
                              return (
                                <option key={rid} value={rid}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}
                      <button
                        className="btn"
                        disabled={!records.length && !child_records_for_digest.length}
                        onClick={() => {
                          const max = 5000;
                          const merged = [
                            ...records.map((x) => ({ run_id: run_id.trim() || x.record.run_id || "", cursor: x.cursor, record: x.record })),
                            ...child_records_for_digest.map((x) => ({ run_id: x.run_id, cursor: x.cursor, record: x.record })),
                          ];
                          const with_ms = merged.map((x) => {
                            const ts = String((x.record as any)?.ended_at || (x.record as any)?.started_at || "").trim();
                            const ms = parse_iso_ms(ts);
                            return { ...x, _ms: ms ?? 0 };
                          });
                          with_ms.sort((a, b) => (a._ms || 0) - (b._ms || 0));
                          const items = with_ms.length > max ? with_ms.slice(with_ms.length - max) : with_ms;
                          const text = items.map(({ _ms, ...x }) => JSON.stringify(x)).join("\n");
                          copy_to_clipboard(text);
                        }}
                      >
                        Copy ledger (JSONL)
                      </button>
                    </div>
                    {ledger_view === "steps" ? (
                      <div className="log log_scroll">
                        {visible_log.map((item) => (
                          <LedgerCard
                            key={item.id}
                            item={item}
                            open={log_open[item.id] === true}
                            on_toggle={() => set_log_open((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                            response_open={log_response_open[item.id] === true}
                            on_toggle_response={() => set_log_response_open((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                            node_index={node_index_for_run}
                            on_copy={(t) => void copy_to_clipboard(t)}
                          />
                        ))}
                        {!visible_log.length ? (
                          <div className="mono muted" style={{ padding: "10px 12px" }}>
                            (no ledger items)
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="log log_scroll">
                        <AgentCyclesPanel
                          items={agent_trace.items}
                          title="Agent"
                          subtitle={agent_trace.node_id ? `node_id: ${agent_trace.node_id}` : "Live per-effect trace (LLM/tool calls)."}
                          subRunId={cycles_run_id}
                          onOpenSubRun={
                            cycles_run_id && cycles_run_id !== run_id.trim()
                              ? () => {
                                  set_run_id(cycles_run_id);
                                  void connect_to_run(cycles_run_id);
                                }
                              : undefined
                          }
                        />
                      </div>
                    )}
                  </>
                ) : null}

                {right_tab === "graph" ? (
                  <>
                    <div className="log_actions" style={{ marginTop: "6px", flexWrap: "wrap" }}>
                      <button className={`btn ${graph_show_subflows ? "primary" : ""}`} onClick={() => set_graph_show_subflows((v) => !v)}>
                        {graph_show_subflows ? "Subflows: on" : "Subflows: off"}
                      </button>
                      <button
                        className={`btn ${graph_highlight_path ? "primary" : ""}`}
                        onClick={() => set_graph_highlight_path((v) => !v)}
                      >
                        {graph_highlight_path ? "Path: on" : "Path: off"}
                      </button>
                      {graph_flow_options.length ? (
                        <select
                          className="mono"
                          value={graph_flow_id}
                          onChange={(e) => set_graph_flow_id(String(e.target.value || ""))}
                          disabled={Boolean(scheduled_workflow_id.trim()) || !bundle_id.trim() || graph_loading}
                        >
                          {graph_flow_options.map((fid) => (
                            <option key={fid} value={fid}>
                              {fid}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <span className="mono muted" style={{ fontSize: "12px" }}>
                        {scheduled_workflow_id.trim() ? scheduled_workflow_id.trim() : graph_flow_id ? `flow ${graph_flow_id}` : ""}
                      </span>
                    </div>

                    {graph_error ? (
                      <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
                        <div className="meta">
                          <span className="mono">graph error</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{graph_error}</div>
                      </div>
                    ) : null}
                    {graph_loading ? (
                      <div className="log_item" style={{ borderColor: "rgba(96, 165, 250, 0.25)" }}>
                        <div className="meta">
                          <span className="mono">loading</span>
                          <span className="mono">{scheduled_workflow_id.trim() ? scheduled_workflow_id.trim() : graph_flow_id}</span>
                        </div>
                        <div className="body mono">Loading graph…</div>
                      </div>
                    ) : null}

                    <div className="graph_panel">
                      <FlowGraph
                        flow={graph_flow}
                        flow_by_id={graph_flow_cache}
                        expand_subflows={graph_show_subflows}
                        simplify={true}
                        prefer_vertical={true}
                        vertical_compact={0.78}
                        schedule_next_in={selected_next_in}
                        schedule_interval={schedule_interval}
                        node_last_ms={graph_node_last_ms}
                        active_node_id={graph_active_node_id}
                        recent_nodes={recent_nodes}
                        visited_nodes={visited_nodes}
                        highlight_path={graph_highlight_path}
                        now_ms={graph_now_ms}
                      />
                    </div>
                  </>
                ) : null}

                {right_tab === "digest" ? (
                  <div className="log log_scroll" style={{ marginTop: "6px" }}>
                    <div className="log_actions" style={{ marginTop: "6px", flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        onClick={() => {
                          copy_to_clipboard(JSON.stringify(digest, null, 2));
                        }}
                        disabled={!digest?.overall?.stats?.steps}
                      >
                        Copy JSON
                      </button>
                    </div>

                    <div
                      className="log_item"
                      style={{
                        borderColor: digest?.latest_summary
                          ? digest?.summary_outdated
                            ? "rgba(239, 68, 68, 0.45)"
                            : "rgba(34, 197, 94, 0.35)"
                          : "rgba(96, 165, 250, 0.25)",
                      }}
                    >
                      <div className="meta">
                        <span className="mono">summary</span>
                        <span className="mono">{digest?.latest_summary ? (digest?.summary_outdated ? "outdated" : "current") : "(none)"}</span>
                      </div>
                      <div className="body" style={{ whiteSpace: "pre-wrap" }}>
                        {digest?.latest_summary ? (
                          <>
                            <div className="mono muted" style={{ fontSize: "12px", marginBottom: "8px" }}>
                              {digest.latest_summary.generated_at || digest.latest_summary.ts || ""} •{" "}
                              {digest.latest_summary.provider || "provider?"} • {digest.latest_summary.model || "model?"}
                            </div>
                            <Markdown text={digest.latest_summary.text} />
                          </>
                        ) : (
                          <div className="mono muted">No summary yet.</div>
                        )}
                      </div>
                      <div className="actions">
                        <button className="btn primary" onClick={() => void generate_summary()} disabled={!run_id.trim() || summary_generating}>
                          {summary_generating ? "Generating…" : digest?.latest_summary ? "Regenerate" : "Generate"}
                        </button>
                      </div>
                      {summary_error ? (
                        <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                          {summary_error}
                        </div>
                      ) : null}
                    </div>
                    {digest ? (
                      <>
                        <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)" }}>
                          <div className="meta">
                            <span className="mono">overall</span>
                            <span className="mono">{digest.overall?.stats?.steps ?? 0} steps</span>
                          </div>
                          <div className="body mono">
                            <div>tools: {digest.overall?.stats?.tool_calls ?? 0} calls • {digest.overall?.stats?.unique_tools ?? 0} unique</div>
                            <div>llm: {digest.overall?.stats?.llm_calls ?? 0} calls • missing {digest.overall?.stats?.llm_missing_responses ?? 0}</div>
                            <div>
                              tokens: {digest.overall?.stats?.prompt_tokens ?? 0} / {digest.overall?.stats?.completion_tokens ?? 0} • total{" "}
                              {digest.overall?.stats?.total_tokens ?? 0}
                            </div>
                            <div>
                              duration:{" "}
                              {typeof digest.overall?.stats?.duration_s === "number"
                                ? `${Math.round(digest.overall.stats.duration_s)}s`
                                : digest.overall?.stats?.duration_s ?? 0}
                              {" • "}errors: {digest.overall?.stats?.errors ?? 0}
                            </div>
                          </div>
                        </div>

                        {Array.isArray(digest.overall?.tools_used) && digest.overall.tools_used.length ? (
                          <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)" }}>
                            <div className="meta">
                              <span className="mono">tools used</span>
                              <span className="mono">{digest.overall.tools_used.length}</span>
                            </div>
                            <div className="body mono">{digest.overall.tools_used.join(", ")}</div>
                          </div>
                        ) : null}

                        <details style={{ marginTop: "10px" }}>
                          <summary className="mono muted" style={{ cursor: "pointer" }}>
                            Advanced: digest JSON
                          </summary>
                          <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)", marginTop: "10px" }}>
                            <div className="body mono">
                              <JsonViewer value={digest as any} max_string_len={240} />
                            </div>
                          </div>
                        </details>
                      </>
                    ) : (
                      <div className="mono muted" style={{ padding: "10px 12px" }}>
                        (no digest)
                      </div>
                    )}
                  </div>
                ) : null}

                {right_tab === "attachments" ? (
                  <div className="log log_scroll" style={{ marginTop: "6px" }}>
                    <div className="log_actions" style={{ marginTop: "6px", flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        onClick={() => void refresh_session_attachments()}
                        disabled={!gateway_connected || session_attachments_loading || !session_id_for_run}
                      >
                        {session_attachments_loading ? "Refreshing…" : "Refresh"}
                      </button>
                      {session_id_for_run ? (
                        <span className="chip mono muted" title={session_id_for_run}>
                          session {short_id(session_id_for_run, 18)}
                        </span>
                      ) : (
                        <span className="mono muted" style={{ fontSize: "12px" }}>
                          No session id (pick a run)
                        </span>
                      )}
                      {session_attachments_run_id.trim() ? (
                        <span className="chip mono muted" title={session_attachments_run_id}>
                          store {short_id(session_attachments_run_id, 18)}
                        </span>
                      ) : null}
                    </div>

                    {session_attachments_error ? (
                      <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
                        <div className="meta">
                          <span className="mono">error</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{session_attachments_error}</div>
                      </div>
                    ) : null}

                    <div className="log" style={{ marginTop: "10px" }}>
                      {!session_attachments_loading && !session_attachments_error && !session_attachments.length ? (
                        <div className="chat_empty_hint">No session attachments.</div>
                      ) : null}
                      {session_attachments.map((a: any) => {
                        const artifact_id = String(a?.artifact_id || "").trim();
                        if (!artifact_id) return null;
                        const tags = a?.tags && typeof a.tags === "object" ? (a.tags as any) : {};
                        const filename = String(tags?.filename || "").trim();
                        const path = String(tags?.path || "").trim();
                        const sha = String(tags?.sha256 || "").trim();
                        const ct = String(a?.content_type || "").trim();
                        const size_bytes = typeof a?.size_bytes === "number" ? Number(a.size_bytes) : null;
                        const label = path ? `@${path}` : filename || artifact_id;
                        return (
                          <div key={artifact_id} className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)" }}>
                            <div className="meta">
                              <span className="mono">{label}</span>
                              <span className="mono">{short_id(artifact_id, 18)}</span>
                            </div>
                            <div className="body">
                              {sha ? (
                                <div className="mono">
                                  <span className="muted">sha256</span>: {short_id(sha, 18)}
                                </div>
                              ) : null}
                              {ct ? (
                                <div className="mono">
                                  <span className="muted">type</span>: {ct}
                                </div>
                              ) : null}
                              {typeof size_bytes === "number" ? (
                                <div className="mono">
                                  <span className="muted">size</span>: {size_bytes.toLocaleString()} bytes
                                </div>
                              ) : null}
                            </div>
                            <div className="actions">
                              <button className="btn" onClick={() => void copy_to_clipboard(artifact_id)}>
                                Copy id
                              </button>
                              <button className="btn" onClick={() => void preview_session_attachment(a)} disabled={!session_attachments_run_id.trim()}>
                                Preview
                              </button>
                              <button className="btn" onClick={() => void download_session_attachment(a)} disabled={!session_attachments_run_id.trim()}>
                                Download
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      <Modal
                        open={attachment_preview_open}
                        title={attachment_preview_title || "Attachment"}
                        onClose={() => {
                          set_attachment_preview_open(false);
                          set_attachment_preview_text("");
                          set_attachment_preview_error("");
                          set_attachment_preview_loading(false);
                        }}
                        actions={
                          <>
                            <button
                              className="btn"
                              onClick={() => {
                                set_attachment_preview_open(false);
                                set_attachment_preview_text("");
                                set_attachment_preview_error("");
                                set_attachment_preview_loading(false);
                              }}
                            >
                              Close
                            </button>
                          </>
                        }
                      >
                        {attachment_preview_loading ? (
                          <div className="mono muted" style={{ fontSize: "12px", marginBottom: "8px" }}>
                            Loading…
                          </div>
                        ) : null}
                        {attachment_preview_error ? (
                          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginBottom: "8px" }}>
                            {attachment_preview_error}
                          </div>
                        ) : null}
                        <pre className="mono" style={{ whiteSpace: "pre-wrap", maxHeight: "62vh", overflow: "auto", margin: 0 }}>
                          {attachment_preview_text || "(empty)"}
                        </pre>
                      </Modal>
                    </div>
                  </div>
                ) : null}

                {right_tab === "chat" ? (
                  <div className="log log_scroll" style={{ marginTop: "6px" }}>
                    <div className="mono muted" style={{ fontSize: "12px", marginBottom: "6px" }}>
                      Using Maintenance AI from Settings: {settings.maintenance_ai_provider.trim() || "(gateway default)"} /{" "}
                      {settings.maintenance_ai_model.trim() || "(gateway default)"}
                    </div>

                    <div className="field" style={{ marginTop: "10px" }}>
                      <label>Saved discussions</label>
                      <div className="actions" style={{ justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: 0 }}>
                        <div style={{ flex: 1, minWidth: 260 }}>
                          <AfSelect
                            value={saved_chat_thread_selected}
                            options={saved_chat_thread_options}
                            placeholder={saved_chat_threads_loading ? "Loading…" : saved_chat_thread_options.length ? "Select a saved discussion…" : "(none saved)"}
                            disabled={!run_id.trim() || !gateway_connected || !saved_chat_thread_options.length}
                            loading={saved_chat_threads_loading}
                            searchable
                            clearable
                            onChange={(v) => {
                              set_saved_chat_thread_selected(v);
                              set_saved_chat_thread_load_error("");
                            }}
                          />
                        </div>

                        <div className="actions" style={{ justifyContent: "flex-end", marginTop: 0 }}>
                          <button
                            className="btn"
                            type="button"
                            disabled={!saved_chat_thread_selected.trim() || !gateway_connected || saved_chat_thread_loading}
                            onClick={() => void load_selected_chat_thread()}
                          >
                            {saved_chat_thread_loading ? "Loading…" : "Load"}
                          </button>
                          <button
                            className="btn"
                            type="button"
                            disabled={!chat_messages.length || chat_sending || chat_thread_saving || saved_chat_thread_loading}
                            onClick={() => {
                              set_chat_messages([]);
                              set_chat_input("");
                              set_chat_error("");
                              set_chat_thread_save_error("");
                              set_chat_thread_last_saved_at("");
                              set_chat_thread_last_saved_fingerprint("");
                            }}
                          >
                            Clear
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => void refresh_saved_chat_threads()}
                            disabled={!run_id.trim() || !gateway_connected || saved_chat_threads_loading}
                          >
                            {saved_chat_threads_loading ? "Refreshing…" : "Refresh"}
                          </button>
                        </div>
                      </div>

                      <div className="actions" style={{ justifyContent: "flex-end", marginTop: "8px", flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          type="button"
                          disabled={!chat_messages.length || !run_id.trim() || !gateway_connected || chat_thread_saving || !chat_has_unsaved_changes}
                          onClick={() => void save_current_chat_thread()}
                          title={!chat_has_unsaved_changes ? "No changes since last save" : ""}
                        >
                          {chat_thread_saving ? "Saving…" : !chat_has_unsaved_changes && chat_thread_last_saved_at ? "Saved" : "Save discussion"}
                        </button>
                        <button className="btn" type="button" disabled={!chat_messages.length} onClick={() => export_chat_markdown("download")}>
                          Export Markdown
                        </button>
                        <button className="btn" type="button" disabled={!chat_messages.length} onClick={() => export_chat_markdown("copy")}>
                          {chat_export_state === "copied"
                            ? "Copied"
                            : chat_export_state === "failed"
                              ? "Copy failed"
                              : "Copy Markdown"}
                        </button>
                      </div>

                      <div className="chat_hint">Read-only. No tools. Grounded in the parent run + subflows ledger.</div>
                      {chat_thread_last_saved_at ? <div className="chat_hint">Last saved: {format_time_ago(chat_thread_last_saved_at)}</div> : null}
                      {chat_thread_save_error ? (
                        <div className="chat_hint" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                          {chat_thread_save_error}
                        </div>
                      ) : null}
                      {saved_chat_thread_load_error ? (
                        <div className="chat_hint" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                          {saved_chat_thread_load_error}
                        </div>
                      ) : null}
                      {saved_chat_threads_error ? (
                        <div className="chat_hint" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                          {saved_chat_threads_error}
                        </div>
                      ) : null}
                    </div>

                    {chat_error ? (
                      <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
                        <div className="meta">
                          <span className="mono">error</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{chat_error}</div>
                      </div>
                    ) : null}

                    <div className="chat_messages" style={{ marginTop: "10px" }}>
                      <ChatThread
                        messages={chat_messages}
                        className="log_scroll"
                        empty={<div className="chat_empty_hint">Ask about this run (why failed, which tools, what happened in subflows).</div>}
                      />
                    </div>

                    <div className="chat_composer" style={{ marginTop: "10px" }}>
                      <ChatComposer
                        value={chat_input}
                        onChange={set_chat_input}
                        onSubmit={() => void send_chat_message()}
                        placeholder="Ask about this run…"
                        disabled={!run_id.trim() || !gateway_connected || chat_sending}
                        busy={chat_sending}
                        rows={3}
                        sendButtonClassName="btn primary"
                      />
                    </div>

                  </div>
                ) : null}

                <div className={`status_bar ${status_pulse ? "pulse" : ""}`}>
                  <strong>Run</strong>:{" "}
                  {run_id.trim() ? (
                    <span className="mono">{selected_run_status_label || selected_run_status_raw || "unknown"}</span>
                  ) : (
                    <span className="mono">(none)</span>
                  )}
                  {run_id.trim() && selected_run_is_scheduled_until && selected_next_in ? <span className="mono muted"> • next in {selected_next_in}</span> : null}
                  {status_text ? <span className="mono muted"> • {status_text}</span> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {schedule_edit_open ? (
          <Modal
            open={schedule_edit_open}
            title="Edit schedule"
            onClose={() => {
              set_schedule_edit_open(false);
              set_schedule_edit_interval("");
              set_schedule_edit_apply_immediately(true);
              set_schedule_edit_error("");
              set_schedule_edit_submitting(false);
            }}
            actions={
              <>
                <button
                  className="btn"
                  onClick={() => {
                    set_schedule_edit_open(false);
                    set_schedule_edit_interval("");
                    set_schedule_edit_apply_immediately(true);
                    set_schedule_edit_error("");
                    set_schedule_edit_submitting(false);
                  }}
                  disabled={connecting || schedule_edit_submitting}
                >
                  Back
                </button>
                <button
                  className="btn primary"
                  onClick={async () => {
                    const err = await submit_update_schedule({
                      interval: schedule_edit_interval,
                      apply_immediately: schedule_edit_apply_immediately,
                    });
                    if (err) return;
                    set_schedule_edit_open(false);
                    set_schedule_edit_error("");
                    set_schedule_edit_submitting(false);
                  }}
                  disabled={connecting || schedule_edit_submitting || !schedule_edit_interval.trim()}
                >
                  Save
                </button>
              </>
            }
          >
            {schedule_edit_error ? (
              <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginBottom: "10px" }}>
                <div className="meta">
                  <span className="mono">error</span>
                  <span className="mono">{now_iso()}</span>
                </div>
                <div className="body mono">{schedule_edit_error}</div>
              </div>
            ) : null}

            <div className="field">
              <label>Interval</label>
              <input
                className="mono"
                value={schedule_edit_interval}
                onChange={(e) => set_schedule_edit_interval(String(e.target.value || ""))}
                placeholder="20m / 1h / 0.5s / 250ms"
                disabled={connecting || schedule_edit_submitting}
              />
              <div className="mono muted" style={{ fontSize: "12px" }}>
                Accepted units: <span className="mono">ms</span>, <span className="mono">s</span>, <span className="mono">m</span>,{" "}
                <span className="mono">h</span>, <span className="mono">d</span>. This updates the existing scheduled run in place (no context loss).
              </div>
            </div>

            <div className="field">
              <label>Quick picks</label>
              <div className="actions" style={{ gap: "8px", flexWrap: "wrap" }}>
                {["15m", "30m", "1h", "2h", "6h", "1d"].map((v) => (
                  <button key={v} className="btn" onClick={() => set_schedule_edit_interval(v)} disabled={connecting || schedule_edit_submitting}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Apply</label>
              <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={schedule_edit_apply_immediately}
                  onChange={(e) => set_schedule_edit_apply_immediately(Boolean(e.target.checked))}
                  disabled={connecting || schedule_edit_submitting}
                />
                Apply immediately (recompute next run from now if waiting)
              </label>
            </div>
          </Modal>
        ) : null}

        {compact_open ? (
          <Modal
            open={compact_open}
            title="Compact scheduled context"
            onClose={() => {
              set_compact_open(false);
              set_compact_error("");
              set_compact_submitting(false);
            }}
            actions={
              <>
                <button
                  className="btn"
                  onClick={() => {
                    set_compact_open(false);
                    set_compact_error("");
                    set_compact_submitting(false);
                  }}
                  disabled={connecting || compact_submitting}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={async () => {
                    const err = await submit_compact_memory({
                      preserve_recent: compact_preserve_recent,
                      compression_mode: compact_mode,
                      focus: compact_focus,
                    });
                    if (err) return;
                    set_compact_open(false);
                    set_compact_error("");
                    set_compact_submitting(false);
                  }}
                  disabled={connecting || compact_submitting}
                >
                  {compact_submitting ? "Compacting…" : "Compact"}
                </button>
              </>
            }
          >
            {compact_error ? (
              <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginBottom: "10px" }}>
                <div className="meta">
                  <span className="mono">error</span>
                  <span className="mono">{now_iso()}</span>
                </div>
                <div className="body mono">{compact_error}</div>
              </div>
            ) : null}

            <div className="field">
              <label>Preserve recent turns</label>
              <input
                type="number"
                min={1}
                value={String(compact_preserve_recent)}
                onChange={(e) => set_compact_preserve_recent(Math.max(1, parseInt(e.target.value || "6", 10) || 6))}
                disabled={connecting || compact_submitting}
              />
            </div>

            <div className="field">
              <label>Mode</label>
              <select value={compact_mode} onChange={(e) => set_compact_mode(e.target.value as any)} disabled={connecting || compact_submitting}>
                <option value="light">light</option>
                <option value="standard">standard</option>
                <option value="heavy">heavy</option>
              </select>
            </div>

            <div className="field">
              <label>Focus (optional)</label>
              <input
                className="mono"
                value={compact_focus}
                onChange={(e) => set_compact_focus(String(e.target.value || ""))}
                placeholder="e.g. important decisions, next steps…"
                disabled={connecting || compact_submitting}
              />
            </div>
          </Modal>
        ) : null}

	        {run_control_open ? (
	          <Modal
	            open={run_control_open}
	            title={run_control_type === "cancel" ? "Cancel run" : is_scheduled_run ? "Suspend schedule" : "Pause run"}
            onClose={() => {
              set_run_control_open(false);
              set_run_control_reason("");
              set_run_control_error("");
            }}
            actions={
              <>
                <button
                  className="btn"
                  onClick={() => {
                    set_run_control_open(false);
                    set_run_control_reason("");
                    set_run_control_error("");
                  }}
                  disabled={connecting || resuming}
                >
                  Back
                </button>
                <button
                  className={`btn ${run_control_type === "cancel" ? "danger" : "primary"}`}
                  onClick={async () => {
                    set_run_control_error("");
                    const err = await submit_run_control(run_control_type, { reason: run_control_reason });
                    if (err) {
                      set_run_control_error(err);
                      return;
                    }
                    set_run_control_open(false);
                    set_run_control_reason("");
                    set_run_control_error("");
                  }}
                  disabled={connecting || resuming}
	                >
	                  {run_control_type === "pause" ? (is_scheduled_run ? "Suspend" : "Pause") : "Cancel"}
	                </button>
	              </>
	            }
	          >
            {run_control_error ? (
              <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginBottom: "10px" }}>
                <div className="meta">
                  <span className="mono">error</span>
                  <span className="mono">{now_iso()}</span>
                </div>
                <div className="body mono">{run_control_error}</div>
              </div>
            ) : null}
            <div className="field">
              <label>Reason (optional)</label>
              <input className="mono" value={run_control_reason} onChange={(e) => set_run_control_reason(e.target.value)} placeholder="reason…" />
            </div>
          </Modal>
        ) : null}

        {show_wait_modal ? (
          <div className="overlay">
            <div className="modal">
              <h2 className="mono">Run is waiting ({String(wait_state?.reason || "unknown")})</h2>
              <p className="mono">wait_key: {String(wait_state?.wait_key || "")}</p>

              {tool_calls_for_wait.length ? (
                <>
                  <div className="field">
                    <label>Tool calls (from wait.details.tool_calls)</label>
                    <textarea className="mono" readOnly value={safe_json(tool_calls_for_wait)} />
                  </div>
                  <div className="actions">
                    <button className="btn primary" disabled={!worker || resuming} onClick={() => execute_tools_via_worker(tool_calls_for_wait)}>
                      Execute via tool worker + resume
                    </button>
                    <button className="btn" disabled={resuming} onClick={() => resume_wait({ approved: true })}>
                      Resume (manual / advanced)
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>Prompt</label>
                    <textarea className="mono" readOnly value={String(wait_state?.prompt || "") || "(no prompt provided)"} />
                  </div>

                  <AskForm wait={wait_state as WaitState} disabled={resuming} on_submit={(val) => resume_wait({ response: val })} />
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

}

function AskForm(props: { wait: WaitState; disabled?: boolean; on_submit: (value: string) => void }): React.ReactElement {
  const [value, set_value] = useState("");
  const choices = Array.isArray(props.wait.choices) ? props.wait.choices : [];
  const allow_free_text = props.wait.allow_free_text !== false;
  const disabled = props.disabled === true;

  return (
    <>
      {choices.length ? (
        <div className="field">
          <label>Choices</label>
          <select className="mono" value={value} onChange={(e) => set_value(e.target.value)}>
            <option value="">(select)</option>
            {choices.map((c, idx) => (
              <option key={idx} value={String(c)}>
                {String(c)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {allow_free_text ? (
        <div className="field">
          <label>Response</label>
          <input className="mono" value={value} onChange={(e) => set_value(e.target.value)} placeholder="Type response…" />
        </div>
      ) : null}

      <div className="actions">
        <button className="btn primary" disabled={disabled || !value.trim()} onClick={() => props.on_submit(value.trim())}>
          Submit response
        </button>
      </div>
    </>
  );
}

function LedgerCard(props: {
  item: UiLogItem;
  open: boolean;
  on_toggle: () => void;
  response_open: boolean;
  on_toggle_response: () => void;
  node_index: Record<string, any>;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const item = props.item;
  const node_id = String(item.node_id || "").trim();
  const meta = node_id && props.node_index && typeof props.node_index === "object" ? (props.node_index as any)[node_id] : null;
  const node_label = typeof meta?.label === "string" && meta.label.trim() ? meta.label.trim() : node_id || item.title;
  const node_type = typeof meta?.type === "string" && meta.type.trim() ? meta.type.trim() : "";
  const header_color = typeof meta?.headerColor === "string" && meta.headerColor.trim() ? meta.headerColor.trim() : "";
  const display_label = item.kind === "step" ? node_label : item.title;

  const accent =
    header_color ||
    (item.kind === "error"
      ? "rgba(239, 68, 68, 0.85)"
      : item.kind === "message"
        ? "rgba(167, 139, 250, 0.85)"
        : item.kind === "event"
          ? "rgba(96, 165, 250, 0.85)"
          : item.status === "waiting"
            ? "rgba(96, 165, 250, 0.65)"
            : item.status === "completed"
              ? "rgba(34, 197, 94, 0.65)"
              : "rgba(255, 255, 255, 0.14)");

  const status = String(item.status || "").trim();
  const st = status.toLowerCase();
  const status_chip =
    st === "completed"
      ? "chip ok"
      : st === "failed"
        ? "chip danger"
        : st === "waiting"
          ? "chip warn"
          : st === "running"
            ? "chip info"
            : status
              ? "chip muted"
              : "chip muted";

  const response_text = extract_response_text_from_record(item.data);
  const has_response = Boolean(response_text && response_text.trim());
  const when = format_time_ago(item.ts);

  return (
    <div className="log_item card" style={{ ["--card-accent" as any]: accent }}>
      <div className="meta">
        <span className="mono">
          {item.kind} • {display_label}
        </span>
        <span className="mono muted" title={item.ts}>
          {when}
        </span>
      </div>
      <div className="meta2">
        {status ? <span className={`mono ${status_chip}`}>{status}</span> : null}
        {node_type ? <span className="chip mono muted">{node_type}</span> : null}
        {item.effect_type ? <span className="chip mono muted">{String(item.effect_type)}</span> : null}
        {item.cursor ? <span className="chip mono muted">#{item.cursor}</span> : null}
        {item.run_id ? <span className="chip mono muted">{short_id(String(item.run_id), 10)}</span> : null}
        {item.kind !== "step" && node_id ? <span className="chip mono muted">{node_id}</span> : null}
      </div>
      {item.preview ? <div className="log_preview mono">{item.preview}</div> : null}
      {item.data ? (
        <div className="log_actions">
          {has_response ? (
            <>
              <button className="btn" onClick={props.on_toggle_response}>
                {props.response_open ? "Fold Response" : "Unfold Response"}
              </button>
              <button className="btn" onClick={() => props.on_copy(String(response_text || ""))}>
                Copy Response
              </button>
            </>
          ) : null}
          <button className="btn" onClick={props.on_toggle}>
            {props.open ? "Fold JSON" : "Unfold JSON"}
          </button>
          <button
            className="btn"
            onClick={() => {
              try {
                props.on_copy(JSON.stringify(item.data, null, 2));
              } catch {
                props.on_copy(String(item.data));
              }
            }}
          >
            Copy JSON
          </button>
        </div>
      ) : null}
      {props.response_open && has_response ? (
        <div className="body">
          <Markdown text={String(response_text || "")} />
        </div>
      ) : null}
      {props.open && item.data ? (
        <div className="body mono">
          <JsonViewer value={item.data} max_string_len={220} />
        </div>
      ) : null}
    </div>
  );
}
