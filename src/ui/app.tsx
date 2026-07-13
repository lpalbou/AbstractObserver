import React, { useEffect, useMemo, useRef, useState } from "react";

import { AgentCyclesPanel, build_agent_trace, type LedgerRecordItem } from "@abstractframework/monitor-flow";
import {
  ChatComposer,
  ChatThread,
  JsonViewer as SharedJsonViewer,
  Markdown,
  chatToMarkdown,
  copyText,
  downloadTextFile,
  tryParseJson,
  type ChatMessage,
} from "@abstractframework/panel-chat";
import {
  AfSelect,
  FontScaleSelect,
  GatewayConnectModal,
  HeaderDensitySelect,
  Icon,
  ProviderModelSelect,
  SteerComposer,
  ThemeSelect,
  applyTheme,
  applyTypography,
  fetchGatewayConnection,
  gatewayStatusBadge,
  type AfSelectOption,
  type GatewayConnectionState,
  type ProviderOption,
} from "@abstractframework/ui-kit";
import { registerMonitorGpuWidget } from "@abstractframework/monitor-gpu";

import { GatewayClient } from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import { McpWorkerClient } from "../lib/mcp_worker_client";
import { extract_emit_event, extract_tool_calls_from_wait, extract_wait_from_record } from "../lib/runtime_extractors";
import { LedgerStreamEvent, StepRecord, ToolCall, ToolResult, WaitState } from "../lib/types";
import { RecordBuffer } from "./record_buffer";
import {
  artifact_display_kind,
  artifact_preview_kind,
  artifact_text_render_kind,
  format_html_source,
  parse_markdown_report,
  type ArtifactPreviewKind,
  type ArtifactTextRenderKind,
} from "./artifact_rendering";
import { FlowGraph } from "./flow_graph";
import { MindmapPanel } from "./mindmap_panel";
import { MissionControlPage, type EntityTile as BoardEntityTile } from "./mission_control";
import { Modal } from "./modal";
import { MultiSelect } from "./multi_select";
import {
  build_runtime_activity_views,
  count_runtime_activity_queues,
  filter_runtime_activity_views,
  sort_runtime_activity_views,
  type RuntimeActivityQueue,
  type RuntimeActivitySort,
} from "./runtime_activity";
import { merge_runtime_metadata, split_runtime_metadata_envelope, type RuntimeMetadata } from "./runtime_metadata";
import { RunPicker, type RunSummary } from "./run_picker";
import { useGatewayVoice } from "./use_gateway_voice";

type Settings = {
  gateway_url: string;
  auth_token: string;
  gateway_user: string;
  gateway_auth_mode: "session" | "direct";
  worker_url: string;
  worker_token: string;
  theme: string;
  font_scale: string;
  header_density: string;
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

type RunFilterMode = "all" | "active" | "waiting" | "terminal" | "failed";
type ObserveRightTab = "overview" | "timeline" | "replay" | "ledger" | "providers" | "graph" | "digest" | "attachments" | "chat";

// Latest persisted run summary (abstract.summary emit) found in the ledger.
// Kept module-scope because it is shared by the always-on Overview scan and
// the digest-tab-gated digest memo.
type LatestRunSummary = {
  cursor: number;
  ts: string;
  text: string;
  provider?: string;
  model?: string;
  generated_at?: string;
  source?: any;
};

// Shape of the (digest-tab-gated) run digest memo. `overall`/`per_run` keep
// the memo's structural types loosely here; the precise field types live
// with the compute logic inside the memo.
type RunDigest = {
  overall: any;
  per_run: Record<string, any>;
  subruns: Array<{ run_id: string; parent_run_id: string; parent_node_id: string; digest: any }>;
  latest_summary: LatestRunSummary | null;
  summary_outdated: boolean;
};

type RuntimeArtifact = {
  artifact_id: string;
  run_id: string;
  content_type: string;
  modality: string;
  semantic_kind: string;
  render_kind: string;
  task: string;
  classification_source: string;
  session_id: string;
  workflow_id: string;
  node_id: string;
  step_id: string;
  effect_id: string;
  turn_id: string;
  ledger_cursor: string;
  parent_run_id: string;
  actor_id: string;
  title: string;
  created_at: string;
  size_bytes: number | null;
  filename: string;
  source_path: string;
  sha256: string;
  tags: Record<string, string>;
  producer: Record<string, any>;
  provenance: Record<string, any>;
  generation: Record<string, any>;
  media: Record<string, any>;
  source_refs: any[];
  access: Record<string, any>;
  links: Record<string, any>;
  available_actions: string[];
  provider_trace_available: boolean;
  audit_available: boolean;
  legacy_inferred: boolean;
  descriptor: Record<string, any>;
  source: "search" | "run" | "session";
  raw: any;
};

type RuntimeArtifactGroupMode = "type" | "run" | "time" | "turn" | "node" | "workflow" | "location" | "source";
type RuntimeArtifactSortMode = "newest" | "oldest" | "size_desc" | "size_asc" | "last_access" | "turn" | "type";
type RuntimeArtifactDateFilter = "all" | "hour" | "today" | "week" | "month";
type RuntimeArtifactTypeFilter = "voice" | "music" | "sound" | "recording" | "audio" | "image" | "video" | "markdown" | "html" | "json" | "document" | "code" | "text" | "other";
type RuntimeTab = "activity" | "artifacts" | "logs";
const RUNTIME_ARTIFACT_PAGE_SIZE = 500;
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080";

type RuntimeEmbeddedPreview = {
  artifact_id: string;
  kind: ArtifactPreviewKind;
  render_kind: ArtifactTextRenderKind | "";
  text: string;
  url: string;
  loading: boolean;
  error: string;
};

type RuntimeEmbeddedPreviewLoader = (artifact: RuntimeArtifact) => Promise<RuntimeEmbeddedPreview>;

type ProviderActivity = {
  id: string;
  cursor: number;
  ts: string;
  run_id: string;
  node_id: string;
  provider: string;
  model: string;
  prompt_preview: string;
  response_preview: string;
  missing_response: boolean;
  tokens: { prompt: number; completion: number; total: number };
  duration_ms: number | null;
  status: string;
  error: string;
  raw: StepRecord;
};

type RuntimeLogSource = "run_ledger" | "provider_calls" | "gateway_audit";
type RuntimeLedgerLogItem = { cursor: number; record: StepRecord };

type RunTreeRow = { run: RunSummary; children: RunSummary[] };
type RunTreeSection = { key: string; label: string; rows: RunTreeRow[] };

// === UI feature flags (runtime config injected by CLI) ===
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

// Human preview for the steer-delivery ack (hooks H4: runtime drains queued
// steer messages into the run's inbox at a tick boundary and acks with an
// `abstract.steer_seen` EMIT_EVENT — payload {seqs, count, node_id}, no prose,
// so the generic textish extraction renders an empty row without this).
// Exported for the contract test only.
export function steer_seen_preview(payload: any): string {
  const p = payload && typeof payload === "object" ? (payload as any) : {};
  const count = typeof p?.count === "number" && Number.isFinite(p.count) ? Number(p.count) : null;
  const node = typeof p?.node_id === "string" && p.node_id.trim() ? ` before ${p.node_id.trim()}` : "";
  const n = count === null ? "steering" : `${count} steer message${count === 1 ? "" : "s"}`;
  return `${n} folded into the run${node} — the loop sees it at this boundary`;
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

function raw_text_from_message_content(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => raw_text_from_message_content(item)).filter(Boolean).join("\n").trim();
  if (typeof value === "object") {
    const direct = value.text ?? value.content ?? value.message ?? value.value;
    if (direct !== value) {
      const text = raw_text_from_message_content(direct);
      if (text) return text;
    }
  }
  return "";
}

function message_text_and_metadata(value: any): { text: string; runtime_metadata: RuntimeMetadata | null } {
  const split = split_runtime_metadata_envelope(raw_text_from_message_content(value));
  return { text: split.text, runtime_metadata: split.metadata };
}

function extract_last_user_request_detail(input: Record<string, any> | null): { text: string; runtime_metadata: RuntimeMetadata | null } {
  if (!input) return { text: "", runtime_metadata: null };
  const direct = typeof input.prompt === "string" ? String(input.prompt).trim() : "";
  if (direct) {
    const split = split_runtime_metadata_envelope(direct);
    return { text: split.text, runtime_metadata: split.metadata };
  }
  const candidates = [input.context?.messages, input.messages, input.conversation, input.history].filter(Array.isArray) as any[][];
  for (const messages of candidates) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      const role = String(msg?.role || msg?.speaker || "").trim().toLowerCase();
      if (role && role !== "user" && role !== "human") continue;
      const parsed = message_text_and_metadata(msg?.content ?? msg?.text ?? msg);
      if (parsed.text) {
        return {
          text: parsed.text,
          runtime_metadata: merge_runtime_metadata(
            parsed.runtime_metadata,
            msg?.runtime_metadata && typeof msg.runtime_metadata === "object" ? msg.runtime_metadata : null,
            msg?.metadata?.runtime_metadata && typeof msg.metadata.runtime_metadata === "object" ? msg.metadata.runtime_metadata : null
          ),
        };
      }
    }
  }
  return { text: "", runtime_metadata: null };
}

function ledger_record_effect_label(rec: any): string {
  const status = String(rec?.status || "").trim();
  const effect_type = String(rec?.effect?.type || "").trim();
  const emit = rec?.effect?.payload && typeof rec.effect.payload === "object" ? String(rec.effect.payload.name || "").trim() : "";
  if (effect_type === "emit_event" && emit) return emit;
  if (effect_type) return effect_type;
  return status || "record";
}

function ledger_record_human_summary(rec: any): string {
  if (!rec || typeof rec !== "object") return "Ledger record";
  const node = String(rec.node_id || "").trim();
  const status = String(rec.status || "").trim();
  const effect = ledger_record_effect_label(rec);
  const wait = extract_wait_from_record(rec);
  if (wait) {
    const reason = String(wait.reason || "").trim();
    const prompt = String(wait.prompt || "").trim();
    if (prompt) return `${node || "node"} is waiting for a response`;
    if (reason) return `${node || "node"} is waiting (${reason})`;
  }
  if (rec.error) return `${node || "node"} failed`;
  if (status === "completed") return `${node || "node"} completed ${effect}`;
  if (status === "running") return `${node || "node"} started ${effect}`;
  if (status === "waiting") return `${node || "node"} is waiting`;
  return [node, status, effect].filter(Boolean).join(" · ") || "Ledger record";
}

function gateway_connect_error_message(value: any, settings: Settings): string {
  const msg = String(value?.message || value || "Discovery failed");
  if (/\b401\b/.test(msg)) {
    const user = String(settings.gateway_user || "").trim();
    return user
      ? `Gateway authentication failed for user '${user}'. Sign in again through the connection dialog. (${msg})`
      : `Gateway authentication failed. Sign in through the connection dialog (or check the dev bearer token under Settings → Advanced). (${msg})`;
  }
  return msg;
}

type ConversationContextItem = {
  role: string;
  text: string;
  ts: string;
  runtime_metadata?: RuntimeMetadata | null;
};

function extract_conversation_context(input: Record<string, any> | null, limit = 6): ConversationContextItem[] {
  if (!input) return [];
  const candidates = [input.context?.messages, input.messages, input.conversation, input.history].filter(Array.isArray) as any[][];
  const messages = candidates.find((items) => items.length) || [];
  const out: ConversationContextItem[] = [];
  for (const msg of messages) {
    const role = String(msg?.role || msg?.speaker || msg?.author || "").trim().toLowerCase() || "message";
    const parsed = message_text_and_metadata(msg?.content ?? msg?.text ?? msg?.message ?? msg);
    const text = parsed.text;
    if (!text) continue;
    const ts = String(msg?.ts || msg?.timestamp || msg?.created_at || msg?.time || "").trim();
    const explicit_meta = merge_runtime_metadata(
      parsed.runtime_metadata,
      msg?.runtime_metadata && typeof msg.runtime_metadata === "object" ? msg.runtime_metadata : null,
      msg?.metadata?.runtime_metadata && typeof msg.metadata.runtime_metadata === "object" ? msg.metadata.runtime_metadata : null
    );
    out.push({ role, text, ts, runtime_metadata: explicit_meta });
  }
  return out.slice(Math.max(0, out.length - Math.max(1, limit)));
}

function is_generic_wait_prompt(prompt: string): boolean {
  const normalized = String(prompt || "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "please respond:" || normalized === "please respond" || normalized === "type response..." || normalized === "type response";
}

function tool_call_names(tool_calls: ToolCall[]): string {
  const names = tool_calls.map((tc: any) => String(tc?.name || "tool").trim()).filter(Boolean);
  if (!names.length) return "";
  return `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
}

function tool_risk_labels(tool_call: ToolCall): string[] {
  const name = String((tool_call as any)?.name || "").trim().toLowerCase();
  const args = (tool_call as any)?.arguments && typeof (tool_call as any).arguments === "object" ? (tool_call as any).arguments : {};
  const command = String(args?.command || args?.cmd || args?.shell || "").trim().toLowerCase();
  const labels: string[] = [];
  if (name.includes("execute_command") || name.includes("terminal") || command) labels.push("Shell");
  if (/[;&|]?\s*(rm|rmdir|mv|chmod|chown|sudo)\b/.test(command)) labels.push("Destructive risk");
  if (/(^|\s)(curl|wget|scp|ssh|nc|ncat|ftp)\b/.test(command)) labels.push("Network");
  if (/(^|\s)(cat|sed|rg|grep|ls|find|pwd)\b/.test(command) && !/[>|]\s*\S/.test(command)) labels.push("Read path");
  if (/[>|]\s*\S|(^|\s)(tee|touch|mkdir|cp)\b/.test(command)) labels.push("Filesystem write");
  if (!labels.length) labels.push("Tool call");
  return Array.from(new Set(labels)).slice(0, 4);
}

function wait_blocker_title(wait: WaitState | null | undefined, tool_calls: ToolCall[]): string {
  const reason = String(wait?.reason || "").trim().toLowerCase();
  const names = tool_call_names(tool_calls);
  if (tool_calls.length) return `Approval required: ${names || "tool call"}`;
  if (reason === "user") return "Waiting for your answer";
  if (reason === "event") return "Waiting for a user response event";
  if (reason === "subworkflow") return "Waiting for a subworkflow";
  if (reason === "until") return "Scheduled wait";
  if (reason) return `Waiting: ${reason}`;
  return "Waiting for input";
}

function wait_expected_action(wait: WaitState | null | undefined, tool_calls: ToolCall[]): string {
  if (tool_calls.length) {
    return "Review the requested tool call, then approve and execute it, approve without local execution, reject it, or cancel the whole run.";
  }
  const choices = Array.isArray(wait?.choices) ? wait?.choices || [] : [];
  if (choices.length) return "Select one of the allowed responses, then submit it to resume this run.";
  if (wait?.allow_free_text === false) return "This wait does not allow free text. Use the available response control or inspect the ledger.";
  if (String(wait?.prompt || "").trim()) return "Answer the workflow question below. Submitting resumes only this wait.";
  return "No explicit question was emitted. Inspect the original request and recent ledger context before responding.";
}

function wait_request_detail(wait: WaitState | null | undefined, input: Record<string, any> | null): { text: string; runtime_metadata: RuntimeMetadata | null } {
  const prompt = String(wait?.prompt || "").trim();
  const prompt_split = split_runtime_metadata_envelope(prompt);
  const last_request = extract_last_user_request_detail(input);
  if (prompt_split.text && !is_generic_wait_prompt(prompt_split.text)) return { text: prompt_split.text, runtime_metadata: prompt_split.metadata };
  if (last_request.text) return last_request;
  return { text: prompt_split.text || prompt, runtime_metadata: prompt_split.metadata };
}

function wait_request_text(wait: WaitState | null | undefined, input: Record<string, any> | null): string {
  return wait_request_detail(wait, input).text;
}

function wait_json_value(parsed: Record<string, any> | null, raw: string): unknown {
  if (parsed) return parsed;
  const text = String(raw || "").trim();
  return text || {};
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
      gateway_url: String(parsed?.gateway_url || DEFAULT_GATEWAY_URL),
      auth_token: "",
      gateway_user: String(parsed?.gateway_user || ""),
      gateway_auth_mode: parsed?.gateway_auth_mode === "direct" ? "direct" : "session",
      worker_url: String(parsed?.worker_url || ""),
      worker_token: String(parsed?.worker_token || ""),
      theme: String(parsed?.theme || "dark"),
      font_scale: String(parsed?.font_scale || parsed?.fontScale || "md").trim() || "md",
      header_density: String(parsed?.header_density || parsed?.headerDensity || "standard").trim() || "standard",
      auto_connect_gateway: parsed?.auto_connect_gateway === false ? false : true,
      maintenance_ai_provider: String(parsed?.maintenance_ai_provider || ""),
      maintenance_ai_model: String(parsed?.maintenance_ai_model || ""),
    };
  } catch {
    return {
      gateway_url: DEFAULT_GATEWAY_URL,
      auth_token: "",
      gateway_user: "",
      gateway_auth_mode: "session",
      worker_url: "",
      worker_token: "",
      theme: "dark",
      font_scale: "md",
      header_density: "standard",
      auto_connect_gateway: true,
      maintenance_ai_provider: "",
      maintenance_ai_model: "",
    };
  }
}

function save_settings(s: Settings): void {
  localStorage.setItem("abstractobserver_settings", JSON.stringify({ ...s, auth_token: "" }));
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

function format_duration_ms(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const total_s = Math.floor(ms / 1000);
  const s = total_s % 60;
  const total_m = Math.floor(total_s / 60);
  const m = total_m % 60;
  const total_h = Math.floor(total_m / 60);
  const h = total_h % 24;
  const d = Math.floor(total_h / 24);
  if (d > 0) return `${d}d ${h}h`;
  if (total_h > 0) return `${total_h}h ${m}m`;
  if (total_m > 0) return `${total_m}m ${s}s`;
  return `${Math.max(0, total_s)}s`;
}

function terminal_run_status(status: any): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "completed" || s === "failed" || s === "cancelled";
}

function active_run_status(status: any): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "running" || s === "waiting";
}

function run_started_at(run: RunSummary | null | undefined): string {
  return String((run as any)?.started_at || run?.created_at || "").trim();
}

function run_finished_at(run: RunSummary | null | undefined): string {
  const st = String(run?.status || "").trim();
  if (!terminal_run_status(st)) return "";
  return String((run as any)?.finished_at || run?.updated_at || "").trim();
}

function run_duration_label(run: RunSummary | null | undefined, now_ms = Date.now()): string {
  const ms = run_duration_ms(run, now_ms);
  return format_duration_ms(ms);
}

function run_duration_ms(run: RunSummary | null | undefined, now_ms = Date.now()): number {
  const start = parse_iso_ms(run_started_at(run));
  if (start === null) return -1;
  const end = parse_iso_ms(run_finished_at(run));
  const stop = end !== null ? end : now_ms;
  return Math.max(0, stop - start);
}

function display_datetime(ts: any): string {
  const ms = parse_iso_ms(ts);
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
}

function runtime_metadata_chip_entries(metadata: RuntimeMetadata | null | undefined): Array<{ label: string; value: string }> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const entries: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    if (entries.some((item) => item.label === label && item.value === text)) return;
    entries.push({ label, value: text });
  };
  const display = String(metadata.display ?? "").trim().replace(/^\[/, "").replace(/\]$/, "");
  add("time", display || metadata.local_datetime);
  add("tz", metadata.timezone);
  add("country", metadata.country);
  add("user", metadata.user);
  return entries;
}

function RuntimeMetadataChips(props: { metadata?: RuntimeMetadata | null }): React.ReactElement | null {
  const entries = runtime_metadata_chip_entries(props.metadata);
  if (!entries.length) return null;
  return (
    <div className="runtime_metadata_chips" aria-label="Runtime metadata">
      {entries.map((item) => (
        <span key={`${item.label}:${item.value}`} className="chip mono muted">
          {item.label}: {item.value}
        </span>
      ))}
    </div>
  );
}

function first_string(...values: any[]): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function build_provider_activities_from_ledger(items: Array<{ run_id?: string; cursor: number; record: StepRecord }>): ProviderActivity[] {
  const out: ProviderActivity[] = [];
  for (const item of items || []) {
    const rec: any = item.record as any;
    const eff_type = String(rec?.effect?.type || "").trim();
    if (eff_type !== "llm_call") continue;
    const payload = rec?.effect?.payload && typeof rec.effect.payload === "object" ? (rec.effect.payload as any) : {};
    const result = rec?.result && typeof rec.result === "object" ? (rec.result as any) : {};
    const usage = result?.usage || result?.token_usage || {};
    const prompt = typeof payload.prompt === "string" ? payload.prompt : Array.isArray(payload.messages) ? safe_json_inline(payload.messages, 1800) : "";
    const content =
      typeof result.content === "string"
        ? result.content
        : typeof result.response === "string"
          ? result.response
          : typeof rec.result === "string"
            ? String(rec.result)
            : "";
    const start = parse_iso_ms(rec.started_at);
    const end = parse_iso_ms(rec.ended_at);
    const prompt_tokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
    const completion_tokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
    out.push({
      id: `${String(item.run_id || rec.run_id || "")}:${item.cursor}`,
      cursor: Number(item.cursor || 0),
      ts: String(rec.ended_at || rec.started_at || ""),
      run_id: String(item.run_id || rec.run_id || "").trim(),
      node_id: String(rec.node_id || "").trim(),
      provider: String(payload.provider || result.provider || result.runtime_provider || "").trim(),
      model: String(payload.model || result.model || result.runtime_model || "").trim(),
      prompt_preview: clamp_preview(prompt, { max_chars: 1200, max_lines: 10 }),
      response_preview: clamp_preview(content, { max_chars: 1200, max_lines: 10 }),
      missing_response: !String(content || "").trim(),
      tokens: {
        prompt: prompt_tokens,
        completion: completion_tokens,
        total: Number(usage.total_tokens ?? prompt_tokens + completion_tokens) || 0,
      },
      duration_ms: start !== null && end !== null ? Math.max(0, end - start) : typeof result.gen_time === "number" ? Number(result.gen_time) * 1000 : null,
      status: String(rec.status || "").trim(),
      error: rec.error ? safe_json_inline(rec.error, 500) : "",
      raw: rec as StepRecord,
    });
  }
  return out.sort((a, b) => (parse_iso_ms(b.ts) ?? 0) - (parse_iso_ms(a.ts) ?? 0));
}

function number_or_null(...values: any[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function artifact_nested_ref(item: any): any {
  return item?.ref && typeof item.ref === "object"
    ? item.ref
    : item?.artifact_ref && typeof item.artifact_ref === "object"
      ? item.artifact_ref
      : item?.artifact && typeof item.artifact === "object"
        ? item.artifact
        : {};
}

function infer_artifact_modality(item: any): string {
  const ref = artifact_nested_ref(item);
  const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata : item?.meta && typeof item.meta === "object" ? item.meta : {};
  const tags = item?.tags && typeof item.tags === "object" ? item.tags : {};
  const explicit = first_string(item?.modality, ref?.modality, meta?.modality, tags.modality).toLowerCase();
  if (explicit) return explicit;
  const ct = first_string(item?.content_type, item?.mime_type, item?.mime, ref?.content_type, ref?.mime_type, ref?.mime, meta?.content_type, tags.content_type).toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("video/")) return "video";
  if (ct.includes("pdf")) return "document";
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("markdown") || ct.includes("csv")) return "text";
  return "artifact";
}

function artifact_envelope(item: any): any {
  if (!item || typeof item !== "object") return {};
  if (item.artifact_envelope_v1 && typeof item.artifact_envelope_v1 === "object") return item.artifact_envelope_v1;
  if (item.envelope && typeof item.envelope === "object") return item.envelope;
  return item;
}

function normalize_artifact_item(item: any, source: RuntimeArtifact["source"]): RuntimeArtifact | null {
  if (!item || typeof item !== "object") return null;
  const env = artifact_envelope(item);
  const ref = artifact_nested_ref(item);
  const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata : item?.meta && typeof item.meta === "object" ? item.meta : {};
  const descriptor = env?.descriptor && typeof env.descriptor === "object" ? env.descriptor : item?.descriptor && typeof item.descriptor === "object" ? item.descriptor : {};
  const artifact_id = first_string(env.artifact_id, item.artifact_id, item.$artifact, item.id, ref.artifact_id, ref.$artifact, ref.id, meta.artifact_id, meta.$artifact);
  if (!artifact_id) return null;
  const tags0 = {
    ...(ref.tags && typeof ref.tags === "object" ? (ref.tags as Record<string, any>) : {}),
    ...(meta.tags && typeof meta.tags === "object" ? (meta.tags as Record<string, any>) : {}),
    ...(env.tags && typeof env.tags === "object" ? (env.tags as Record<string, any>) : {}),
    ...(item.tags && typeof item.tags === "object" ? (item.tags as Record<string, any>) : {}),
  };
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags0)) {
    const key = String(k || "").trim();
    if (!key) continue;
    tags[key] = String(v ?? "");
  }
  const filename = first_string(env.filename, item.filename, ref.filename, meta.filename, tags.filename, tags.name, item.name, ref.name);
  const source_path = first_string(env.source_path, item.source_path, ref.source_path, meta.source_path, item.path, ref.path, tags.path, tags.source_path, tags.file_path);
  const content_type = first_string(env.content_type, item.content_type, item.mime_type, item.mime, ref.content_type, ref.mime_type, ref.mime, meta.content_type, tags.content_type);
  const render_kind = first_string(env.render_kind, descriptor.render_kind, item.render_kind, tags.render_kind);
  const semantic_kind = first_string(env.semantic_kind, descriptor.semantic_kind, item.semantic_kind, tags.semantic_kind, tags.artifact_type);
  const access = env.access && typeof env.access === "object" ? env.access : item.access && typeof item.access === "object" ? item.access : {};
  const producer =
    env.producer && typeof env.producer === "object"
      ? env.producer
      : item.producer && typeof item.producer === "object"
        ? item.producer
        : descriptor.producer && typeof descriptor.producer === "object"
          ? descriptor.producer
          : {};
  const provenance =
    env.provenance && typeof env.provenance === "object"
      ? env.provenance
      : item.provenance && typeof item.provenance === "object"
        ? item.provenance
        : descriptor.provenance && typeof descriptor.provenance === "object"
          ? descriptor.provenance
          : {};
  const generation =
    env.generation && typeof env.generation === "object"
      ? env.generation
      : item.generation && typeof item.generation === "object"
        ? item.generation
        : descriptor.generation && typeof descriptor.generation === "object"
          ? descriptor.generation
          : {};
  const media =
    env.media && typeof env.media === "object"
      ? env.media
      : item.media && typeof item.media === "object"
        ? item.media
        : descriptor.media && typeof descriptor.media === "object"
          ? descriptor.media
          : {};
  const links =
    env.links && typeof env.links === "object"
      ? env.links
      : item.links && typeof item.links === "object"
        ? item.links
        : descriptor.links && typeof descriptor.links === "object"
          ? descriptor.links
          : {};
  return {
    artifact_id,
    run_id: first_string(env.run_id, item.run_id, ref.run_id, meta.run_id, tags.run_id, provenance.run_id),
    content_type,
    modality: first_string(env.modality, item.modality, descriptor.modality, tags.modality) || infer_artifact_modality({ ...item, ref, metadata: meta, tags }),
    semantic_kind: semantic_kind || infer_artifact_modality({ ...item, ref, metadata: meta, tags }),
    render_kind: render_kind || artifact_display_kind({ content_type, filename, source_path, modality: first_string(env.modality, item.modality, tags.modality), tags }),
    task: first_string(env.task, descriptor.task, item.task, tags.task, tags.provider_task),
    classification_source: first_string(env.classification_source, descriptor.classification_source, item.classification_source),
    session_id: first_string(env.session_id, descriptor.session_id, item.session_id, tags.session_id),
    workflow_id: first_string(env.workflow_id, descriptor.workflow_id, item.workflow_id, tags.workflow_id, tags.workflow),
    node_id: first_string(env.node_id, descriptor.node_id, item.node_id, tags.node_id, tags.node),
    step_id: first_string(env.step_id, descriptor.step_id, item.step_id, tags.step_id),
    effect_id: first_string(env.effect_id, descriptor.effect_id, item.effect_id, tags.effect_id, tags.effect_idempotency_key),
    turn_id: first_string(env.turn_id, descriptor.turn_id, item.turn_id, tags.turn_id, tags.turn),
    ledger_cursor: first_string(env.ledger_cursor, descriptor.ledger_cursor, item.ledger_cursor, tags.ledger_cursor, tags.step_cursor),
    parent_run_id: first_string(env.parent_run_id, descriptor.parent_run_id, item.parent_run_id, tags.parent_run_id),
    actor_id: first_string(env.actor_id, descriptor.actor_id, item.actor_id, tags.actor_id),
    title: first_string(env.title, item.title, tags.title, tags.label, tags.name),
    created_at: first_string(env.created_at, item.created_at, ref.created_at, meta.created_at, tags.created_at),
    size_bytes: number_or_null(env.size_bytes, item.size_bytes, ref.size_bytes, meta.size_bytes, tags.size_bytes),
    filename,
    source_path,
    sha256: first_string(env.sha256, item.sha256, ref.sha256, meta.sha256, tags.sha256),
    tags,
    producer,
    provenance,
    generation,
    media,
    source_refs: Array.isArray(env.source_refs) ? env.source_refs : Array.isArray(item.source_refs) ? item.source_refs : [],
    access,
    links,
    available_actions: Array.isArray(env.available_actions) ? env.available_actions.map(String) : Array.isArray(item.available_actions) ? item.available_actions.map(String) : [],
    provider_trace_available: Boolean(env.provider_trace_available ?? item.provider_trace_available),
    audit_available: Boolean(env.audit_available ?? item.audit_available),
    legacy_inferred: Boolean(
      (env.legacy_inferred ?? item.legacy_inferred) ||
        /(?:legacy|inferred|runtime_tags|runtime_mime)/i.test(first_string(env.classification_source, descriptor.classification_source, item.classification_source))
    ),
    descriptor,
    source,
    raw: item,
  };
}

function artifact_label(a: RuntimeArtifact): string {
  return a.filename || a.title || (a.source_path ? a.source_path.split("/").filter(Boolean).slice(-1)[0] : "") || short_id(a.artifact_id, 16);
}

function artifact_group_key(a: RuntimeArtifact, mode: RuntimeArtifactGroupMode): string {
  if (mode === "type") return artifact_semantic_label(a);
  if (mode === "run") return a.run_id || "(no run)";
  if (mode === "turn") return artifact_turn_label(a);
  if (mode === "node") return artifact_node_label(a) || "(node unknown)";
  if (mode === "workflow") return artifact_workflow_ref(a) || "(workflow unknown)";
  if (mode === "location") {
    const p = a.source_path || a.filename || "";
    const parts = p.split("/").filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
  }
  if (mode === "source") return artifact_origin_label(a) || a.source || "artifact";
  const ms = parse_iso_ms(a.created_at);
  if (ms === null) return "(unknown time)";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function artifact_workflow_ref(a: RuntimeArtifact | null | undefined): string {
  const tags = a?.tags || {};
  return String(a?.workflow_id || tags.workflow_id || tags.workflow || "").trim();
}

function artifact_node_label(a: RuntimeArtifact | null | undefined): string {
  const tags = a?.tags || {};
  const explicit = String(a?.node_id || tags.node_id || tags.node || a?.step_id || tags.step_id || "").trim();
  if (explicit) return explicit;
  const p = String(a?.source_path || tags.path || "").trim();
  const m = p.match(/(?:^|[._:/-])(node-[A-Za-z0-9_-]+)/);
  return m?.[1] ? String(m[1]) : "";
}

function artifact_turn_label(a: RuntimeArtifact | null | undefined): string {
  const tags = a?.tags || {};
  const explicit = String(a?.turn_id || tags.turn_id || tags.turn || tags.cycle || a?.ledger_cursor || tags.ledger_cursor || tags.step_cursor || "").trim();
  if (explicit) return `turn ${explicit}`;
  const node = artifact_node_label(a);
  const ms = parse_iso_ms(a?.created_at);
  const time = ms === null ? "unknown time" : new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const run = a?.run_id ? short_id(String(a.run_id), 10) : "unknown run";
  return node ? `${run} · ${node} · ${time}` : `${run} · ${time}`;
}

function artifact_provenance_label(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "provenance unavailable";
  const bits: string[] = [];
  const workflow = artifact_workflow_ref(a);
  const node = artifact_node_label(a);
  const source = artifact_origin_label(a);
  const producer = artifact_provider_model_label(a);
  if (workflow) bits.push(workflow);
  if (node) bits.push(node);
  if (source) bits.push(source);
  if (producer) bits.push(producer);
  if (!bits.length) return "provenance unavailable";
  return bits.join(" · ");
}

function format_bytes(size: number | null | undefined): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = size;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${units[idx]}`;
}

function artifact_semantic_label(a: RuntimeArtifact | null | undefined): string {
  const kind = String(a?.semantic_kind || a?.modality || "").trim().toLowerCase();
  const render = String(a?.render_kind || "").trim().toLowerCase();
  const value = kind || render || "artifact";
  const labels: Record<string, string> = {
    voice: "Voice",
    music: "Music",
    sound: "Sound",
    recording: "Recording",
    audio: "Unclassified audio",
    image: "Image",
    video: "Video",
    markdown: "Markdown",
    html: "HTML",
    json: "JSON",
    document: "Document",
    code: "Code",
    text: "Text",
    binary: "Other",
    artifact: "Other",
  };
  return labels[value] || value.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function runtime_type_filter_label(kind: RuntimeArtifactTypeFilter): string {
  if (kind === "html") return "HTML";
  if (kind === "json") return "JSON";
  if (kind === "audio") return "Unclassified audio";
  if (kind === "code") return "Code";
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function runtime_created_after_for_filter(filter: RuntimeArtifactDateFilter): string {
  const now = Date.now();
  if (filter === "hour") return new Date(now - 60 * 60 * 1000).toISOString();
  if (filter === "week") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (filter === "month") return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (filter === "today") {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }
  return "";
}

function runtime_sort_gateway_params(sort: RuntimeArtifactSortMode): { order_by: string; order: "asc" | "desc" } {
  if (sort === "oldest") return { order_by: "created_at", order: "asc" };
  if (sort === "size_desc") return { order_by: "size_bytes", order: "desc" };
  if (sort === "size_asc") return { order_by: "size_bytes", order: "asc" };
  if (sort === "last_access") return { order_by: "last_accessed_at", order: "desc" };
  if (sort === "turn") return { order_by: "turn", order: "asc" };
  if (sort === "type") return { order_by: "semantic_kind", order: "asc" };
  return { order_by: "created_at", order: "desc" };
}

function artifact_facets_from_search_response(search_res: any): Record<string, Record<string, number>> {
  const stats = search_res?.stats && typeof search_res.stats === "object" ? search_res.stats : {};
  const facets = stats?.facets && typeof stats.facets === "object" ? stats.facets : search_res?.facets && typeof search_res.facets === "object" ? search_res.facets : {};
  return facets && typeof facets === "object" ? (facets as Record<string, Record<string, number>>) : {};
}

function artifact_created_label(a: RuntimeArtifact): string {
  const dt = display_datetime(a.created_at);
  const ago = format_time_ago(a.created_at);
  if (dt === "—") return "Created —";
  return `${dt}${ago && ago !== "—" ? ` (${ago})` : ""}`;
}

function artifact_last_seen_label(a: RuntimeArtifact): string {
  const tags = a.tags || {};
  const ts = String(a.access?.last_accessed_at || tags.last_accessed_at || tags.accessed_at || tags.updated_at || a.created_at || "").trim();
  const label = display_datetime(ts);
  return label === "—" ? "—" : label;
}

function artifact_human_title(a: RuntimeArtifact): string {
  const tags = a.tags || {};
  const explicit = String(a.title || tags.title || tags.name || tags.label || a.filename || "").trim();
  if (explicit) return explicit;
  const path = String(a.source_path || tags.path || "").trim();
  if (path) return path.split("/").filter(Boolean).slice(-1)[0] || path;
  const source = artifact_origin_label(a);
  const type = artifact_semantic_label(a);
  if (source) return `${type} ${source}`;
  return `${type} artifact`;
}

function artifact_origin_label(a: RuntimeArtifact): string {
  const tags = a.tags || {};
  return String(a.task || a.provenance?.source || tags.task || tags.kind || tags.source || a.source || "").trim();
}

function artifact_provider_model_label(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "";
  const provider = first_string(a.producer?.provider, a.producer?.provider_id, a.provenance?.provider, a.generation?.provider);
  const model = first_string(a.producer?.model, a.producer?.model_id, a.provenance?.model, a.generation?.model);
  if (provider && model) return `${provider} / ${model}`;
  return provider || model;
}

function artifact_generation_prompt(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "";
  return first_string(a.generation?.prompt, a.generation?.input, a.generation?.text, a.provenance?.prompt);
}

function artifact_media_fact_label(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "";
  const media = a.media || {};
  const duration = Number(media.duration_s ?? media.duration_seconds ?? media.duration);
  const width = Number(media.width ?? media.image_width ?? media.video_width);
  const height = Number(media.height ?? media.image_height ?? media.video_height);
  const sample_rate = Number(media.sample_rate ?? media.sample_rate_hz);
  const channels = Number(media.channels);
  if (Number.isFinite(duration) && duration > 0) {
    const bits = [`${duration >= 60 ? `${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s` : `${duration.toFixed(duration >= 10 ? 1 : 2)}s`}`];
    if (Number.isFinite(sample_rate) && sample_rate > 0) bits.push(`${Math.round(sample_rate / 1000)} kHz`);
    if (Number.isFinite(channels) && channels > 0) bits.push(`${channels} ch`);
    return bits.join(" · ");
  }
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return `${Math.round(width)} x ${Math.round(height)}`;
  const pages = Number(media.page_count ?? media.pages);
  if (Number.isFinite(pages) && pages > 0) return `${Math.round(pages)} pages`;
  return "";
}

function artifact_path_label(a: RuntimeArtifact): string {
  return a.source_path || a.filename || "";
}

function artifact_with_runtime_context(a: RuntimeArtifact, run_by_id: Record<string, RunSummary>, workflow_label_by_id: Record<string, string>): RuntimeArtifact {
  const run = a.run_id ? run_by_id[a.run_id] || null : null;
  if (!run) return a;
  const workflow = run_workflow_label(run, workflow_label_by_id);
  const tags = { ...(a.tags || {}) };
  if (workflow && !tags.workflow) tags.workflow = workflow;
  if (workflow && !tags.workflow_id) tags.workflow_id = workflow;
  return { ...a, workflow_id: a.workflow_id || workflow, tags };
}

function artifact_display_type_label_for(a: RuntimeArtifact, run_by_id: Record<string, RunSummary>, workflow_label_by_id: Record<string, string>, text = ""): string {
  const enriched = artifact_with_runtime_context(a, run_by_id, workflow_label_by_id);
  const kind = artifact_display_kind(enriched, text);
  const labels: Record<string, string> = {
    json: "JSON",
    html: "HTML",
    markdown: "Markdown",
    code: "Code",
    voice: "Voice",
    music: "Music",
    sound: "Sound",
    audio: "Unclassified audio",
    image: "Image",
    video: "Video",
    document: "Document",
    text: "Text",
    other: "Other",
  };
  return labels[kind] || artifact_semantic_label(enriched);
}

/* short_run_id, extract_workflow_label: removed — info is now in the run picker. */

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
  // CI/CD development pages (backlog + codex execution, report/email inbox,
  // processes) moved to the abstractcontinuum repo (2026-07-12 split): the
  // observer's purpose is observing and discussing the running system.
  // "board" = Mission Control (the new landing page, maintainer sign-off
  // 2026-07-12): Pending/Working/Review/Done across runs + entities.
  const [page, set_page] = useState<"board" | "observe" | "launch" | "runtime" | "mindmap" | "settings">("board");

  const [settings, set_settings] = useState<Settings>(() => load_settings());
  const monitor_gpu_enabled = typeof window !== "undefined" && window.__ABSTRACT_UI_CONFIG__?.monitor_gpu === true;
  // The entity app is its OWN deployment since the 2026-07-12 split —
  // served config wins (ABSTRACTOBSERVER_ENTITY_APP_URL), local-stack
  // default (:3007, the workspace launchers' ENTITY_PORT) otherwise.
  const entity_app_url =
    (typeof window !== "undefined" && (window.__ABSTRACT_UI_CONFIG__?.entity_app_url || "").trim().replace(/\/+$/, "")) ||
    "http://127.0.0.1:3007";
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);
  const [run_id, set_run_id] = useState<string>("");
  const [root_run_id, set_root_run_id] = useState<string>("");
  const [pending_url_run_id, set_pending_url_run_id] = useState<string>(() => parse_run_id_from_url());
  const [flow_id, set_flow_id] = useState<string>("");
  const [bundle_id, set_bundle_id] = useState<string>("");
  const [input_data_text, set_input_data_text] = useState<string>("{}");
  const [start_session_id] = useState<string>(() => getOrCreateStableSessionId());

  const [bundle_info, set_bundle_info] = useState<BundleInfo | null>(null);
  const [bundle_loading, set_bundle_loading] = useState(false);
  const [bundle_error, set_bundle_error] = useState<string>("");

  const [discovery_loading, set_discovery_loading] = useState(false);
  const [discovery_error, set_discovery_error] = useState<string>("");
  const [gateway_connected, set_gateway_connected] = useState(false);
  // SHARED SIGN-IN (maintainer directive 2026-07-12, "comply with what
  // abstractgateway/console and abstractflow are doing"): the uic
  // GatewayConnectModal owns the sign-in UX against /api/connection/gateway;
  // this app only reacts to its status. Tokens exchange for HTTP-only
  // session cookies inside the modal — never stored here.
  const [connect_modal_open, set_connect_modal_open] = useState(false);
  const [connection_status, set_connection_status] = useState<GatewayConnectionState | null>(null);
  const [workflow_options, set_workflow_options] = useState<WorkflowOption[]>([]);
  const [run_options, set_run_options] = useState<RunSummary[]>([]);
  const [all_run_options, set_all_run_options] = useState<RunSummary[]>([]);
  const [runs_loading, set_runs_loading] = useState(false);
  const [runs_refreshed_at, set_runs_refreshed_at] = useState<number | null>(null);
  const [board_entities, set_board_entities] = useState<BoardEntityTile[]>([]);
  const [board_entities_total, set_board_entities_total] = useState(0);
  const [board_entities_error, set_board_entities_error] = useState("");
  // In-flight ref (not state): the poll effect captures ONE render's
  // closure, so a state-based guard is frozen there (adversary P1 — the
  // stale closure made the dedup claim false and let slow requests stack).
  const runs_inflight_ref = useRef(false);
  const [bundles_reloading, set_bundles_reloading] = useState(false);
  const [discovered_tool_specs, set_discovered_tool_specs] = useState<any[]>([]);
  const [discovered_providers, set_discovered_providers] = useState<any[]>([]);
  const [discovered_models_by_provider, set_discovered_models_by_provider] = useState<Record<string, { models: string[]; error?: string }>>({});

  const [connected, set_connected] = useState(false);
  const [connecting, set_connecting] = useState(false);
  const [resuming, set_resuming] = useState(false);
  const [records, set_records] = useState<Array<{ cursor: number; record: StepRecord }>>([]);
  const [child_records_for_digest, set_child_records_for_digest] = useState<Array<{ run_id: string; cursor: number; record: StepRecord }>>([]);
  const cursor_ref = useRef<number>(0);
  // Batched appenders for the UNBOUNDED records arrays: one concat (and one
  // pass of every records-derived useMemo) per ~40ms flush window instead of
  // one full array copy per ledger event — the per-event copies were O(N²)
  // cumulative at resident scale (~5k events/day), the entity-view
  // scale-contract class applied here. Scope note: per-event state updates
  // that remain (push_log ≤800 cap, mark_node_activity, active-node) are
  // BOUNDED structures and deliberately stay per-event for liveness.
  const records_buffer_ref = useRef<RecordBuffer<{ cursor: number; record: StepRecord }> | null>(null);
  if (!records_buffer_ref.current) {
    records_buffer_ref.current = new RecordBuffer(
      (flush) => window.setTimeout(flush, 40),
      (items) => set_records((prev) => prev.concat(items)),
    );
  }
  const child_records_buffer_ref = useRef<RecordBuffer<{ run_id: string; cursor: number; record: StepRecord }> | null>(null);
  if (!child_records_buffer_ref.current) {
    child_records_buffer_ref.current = new RecordBuffer(
      (flush) => window.setTimeout(flush, 40),
      (items) => set_child_records_for_digest((prev) => prev.concat(items)),
    );
  }
  // Last digest computed while the digest tab was visible (see the digest memo note).
  const digest_cache_ref = useRef<RunDigest | null>(null);
  // Incremental scan state for the always-on latest-summary memo: `records`
  // only grows (concat) or resets to [], so a shrink means "new run — rescan".
  const latest_summary_scan_ref = useRef<{ scanned: number; found: LatestRunSummary | null }>({ scanned: 0, found: null });
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
  const [chat_voice_error, set_chat_voice_error] = useState<string>("");
  const [chat_voice_run_id, set_chat_voice_run_id] = useState<string>("");
  const [chat_sending, set_chat_sending] = useState<boolean>(false);
  const [chat_export_state, set_chat_export_state] = useState<"idle" | "copied" | "failed">("idle");
  const [chat_messages, set_chat_messages] = useState<Array<{ id: string; role: "user" | "assistant"; content: string; ts: string }>>([]);
  const chat_input_ref = useRef<HTMLTextAreaElement | null>(null);
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
    if (el) el.token = settings.gateway_auth_mode === "direct" ? settings.auth_token || "" : "";
  }, [monitor_gpu_enabled, settings.auth_token, settings.gateway_auth_mode]);

  const [log, set_log] = useState<UiLogItem[]>([]);
  const [log_open, set_log_open] = useState<Record<string, boolean>>({});
  const [log_response_open, set_log_response_open] = useState<Record<string, boolean>>({});
  const [error_text, set_error_text] = useState<string>("");

  const [observe_search, set_observe_search] = useState("");
  const [observe_filter, set_observe_filter] = useState<RunFilterMode>("all");
  const [observe_group_by, set_observe_group_by] = useState<"status" | "workflow" | "session">("status");
  const [right_tab, set_right_tab] = useState<ObserveRightTab>("overview");
  const [replay_bundle, set_replay_bundle] = useState<any | null>(null);
  const [replay_bundle_run_id, set_replay_bundle_run_id] = useState<string>("");
  const [replay_loading, set_replay_loading] = useState(false);
  const [replay_error, set_replay_error] = useState<string>("");
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

  const empty_runtime_preview = (): RuntimeEmbeddedPreview => ({
    artifact_id: "",
    kind: "binary",
    render_kind: "",
    text: "",
    url: "",
    loading: false,
    error: "",
  });

  const [runtime_tab, set_runtime_tab] = useState<RuntimeTab>("activity");
  const [runtime_artifacts, set_runtime_artifacts] = useState<RuntimeArtifact[]>([]);
  const [runtime_artifact_total_count, set_runtime_artifact_total_count] = useState(0);
  const [runtime_artifact_total_bytes, set_runtime_artifact_total_bytes] = useState(0);
  const [runtime_artifact_facets, set_runtime_artifact_facets] = useState<Record<string, Record<string, number>>>({});
  const [runtime_artifact_type_facets, set_runtime_artifact_type_facets] = useState<Record<string, Record<string, number>>>({});
  const [runtime_artifacts_loading, set_runtime_artifacts_loading] = useState(false);
  const [runtime_artifacts_error, set_runtime_artifacts_error] = useState<string>("");
  const [runtime_query, set_runtime_query] = useState("");
  const [runtime_scope, set_runtime_scope] = useState<"all" | "session" | "run">("all");
  const [runtime_session_filter_id, set_runtime_session_filter_id] = useState("");
  const [runtime_type_filters, set_runtime_type_filters] = useState<RuntimeArtifactTypeFilter[]>([]);
  const [runtime_date_filter, set_runtime_date_filter] = useState<RuntimeArtifactDateFilter>("all");
  const [runtime_group_by, set_runtime_group_by] = useState<RuntimeArtifactGroupMode>("type");
  const [runtime_sort_by, set_runtime_sort_by] = useState<RuntimeArtifactSortMode>("newest");
  const [runtime_artifact_run_filter, set_runtime_artifact_run_filter] = useState("");
  const [runtime_selected_run_id, set_runtime_selected_run_id] = useState("");
  const [runtime_selected_artifact_id, set_runtime_selected_artifact_id] = useState("");
  const [runtime_artifact_page, set_runtime_artifact_page] = useState(0);
  const [runtime_embedded_preview, set_runtime_embedded_preview] = useState<RuntimeEmbeddedPreview>(() => empty_runtime_preview());
  const [runtime_preview_open, set_runtime_preview_open] = useState(false);
  const [runtime_preview_title, set_runtime_preview_title] = useState("");
  const [runtime_preview_text, set_runtime_preview_text] = useState("");
  const [runtime_preview_url, set_runtime_preview_url] = useState("");
  const [runtime_preview_kind, set_runtime_preview_kind] = useState<ArtifactPreviewKind>("text");
  const [runtime_preview_artifact, set_runtime_preview_artifact] = useState<RuntimeArtifact | null>(null);
  const [runtime_preview_loading, set_runtime_preview_loading] = useState(false);
  const [runtime_preview_error, set_runtime_preview_error] = useState("");
  const [audit_log_text, set_audit_log_text] = useState("");
  const [audit_log_meta, set_audit_log_meta] = useState("");
  const [audit_log_loading, set_audit_log_loading] = useState(false);
  const [audit_log_error, set_audit_log_error] = useState("");
  const [runtime_log_source, set_runtime_log_source] = useState<RuntimeLogSource>("run_ledger");
  const [runtime_log_query, set_runtime_log_query] = useState("");
  const [runtime_ledger_log_items, set_runtime_ledger_log_items] = useState<RuntimeLedgerLogItem[]>([]);
  const [runtime_ledger_log_meta, set_runtime_ledger_log_meta] = useState("");
  const [runtime_ledger_log_loading, set_runtime_ledger_log_loading] = useState(false);
  const [runtime_ledger_log_error, set_runtime_ledger_log_error] = useState("");

  const gateway = useMemo(
    () =>
      new GatewayClient({
        base_url: settings.gateway_auth_mode === "session" ? "" : settings.gateway_url,
        auth_token: settings.gateway_auth_mode === "session" ? "" : settings.auth_token,
      }),
    [settings.gateway_auth_mode, settings.gateway_url, settings.auth_token]
  );
  const worker = useMemo(
    () => (settings.worker_url.trim() ? new McpWorkerClient({ url: settings.worker_url.trim(), auth_token: settings.worker_token }) : null),
    [settings.worker_url, settings.worker_token]
  );

  async function refresh_replay_bundle(force = false): Promise<void> {
    const rid = run_id.trim();
    if (!rid || !gateway_connected) return;
    if (!force && replay_bundle_run_id === rid && replay_bundle) return;
    set_replay_loading(true);
    set_replay_error("");
    try {
      const bundle = await gateway.get_run_history_bundle(rid, {
        include_subruns: true,
        include_session: true,
        session_turn_limit: 100,
        ledger_mode: "tail",
        ledger_max_items: 500,
      });
      set_replay_bundle(bundle);
      set_replay_bundle_run_id(rid);
    } catch (e: any) {
      set_replay_error(String(e?.message || e || "Failed to load replay bundle"));
    } finally {
      set_replay_loading(false);
    }
  }

  useEffect(() => {
    if (right_tab !== "replay") return;
    void refresh_replay_bundle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [right_tab, run_id, gateway_connected]);

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
    applyTypography({ font_scale: settings.font_scale, header_density: settings.header_density });
  }, [settings.font_scale, settings.header_density]);

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
    // Flow/console parity: signed-out is a SIGN-IN SCREEN, never a dead
    // app — the boot probe opens the shared modal when no session and no
    // dev bearer exists.
    void on_discover_gateway({ open_modal_if_needed: true });
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
  const workspace_allowed_paths_value = useMemo(() => {
    const raw = (input_data_obj as any)?.workspace_allowed_paths;
    if (Array.isArray(raw)) return raw.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
    if (typeof raw === "string") return String(raw);
    return "";
  }, [input_data_obj]);
  const workspace_ignored_paths_value = useMemo(() => {
    const raw = (input_data_obj as any)?.workspace_ignored_paths;
    if (Array.isArray(raw)) return raw.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
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

  async function refresh_runs(gateway_client: GatewayClient = gateway, opts?: { force?: boolean }): Promise<void> {
    if (runs_inflight_ref.current && !opts?.force) return;
    runs_inflight_ref.current = true;
    const epoch = discovery_epoch_ref.current;
    set_runs_loading(true);
    try {
      const normalize_runs = (items: any[]): RunSummary[] =>
        items
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
          current_node: typeof r?.current_node === "string" ? String(r.current_node).trim() : r?.current_node ?? null,
          llm_calls: typeof r?.llm_calls === "number" ? Number(r.llm_calls) : r?.llm_calls ?? null,
          tool_calls: typeof r?.tool_calls === "number" ? Number(r.tool_calls) : r?.tool_calls ?? null,
          tokens_total: typeof r?.tokens_total === "number" ? Number(r.tokens_total) : r?.tokens_total ?? null,
          error: r?.error ?? null,
          waiting: r?.waiting ?? null,
        }))
        .filter((r) => Boolean(r.run_id));

      const [root_runs, all_runs] = await Promise.all([
        gateway_client.list_runs({ limit: 200, root_only: true, include_metrics: true }),
        gateway_client.list_runs({ limit: 500, root_only: false, include_metrics: true }),
      ]);
      // EPOCH GUARD (adversary 2026-07-13): a sign-out during this await
      // must not repopulate the disconnected app with late results.
      if (epoch !== discovery_epoch_ref.current) return;
      const root_items = Array.isArray((root_runs as any)?.items) ? ((root_runs as any).items as any[]) : [];
      const all_items = Array.isArray((all_runs as any)?.items) ? ((all_runs as any).items as any[]) : [];
      const next: RunSummary[] = normalize_runs(root_items)
        // Observability UX: show only parent/root runs (subruns are observable via the parent’s ledger).
        .filter((r) => !String(r.parent_run_id || "").trim());
      set_run_options(next);
      set_all_run_options(normalize_runs(all_items).filter((r) => Boolean(r.run_id)));
      set_runs_refreshed_at(Date.now());
    } catch (e: any) {
      push_log({ ts: now_iso(), kind: "error", title: "Refresh runs failed", preview: clamp_preview(String(e?.message || e || "")) });
    } finally {
      runs_inflight_ref.current = false;
      set_runs_loading(false);
    }
  }

  /** The post-auth half of connecting: discovery over an ALREADY
   * authenticated client (session cookies via the shared modal, or a direct
   * dev bearer). Shared by the modal path and the legacy direct path. */
  async function run_discovery(gateway_for_connect: GatewayClient): Promise<void> {
    // CONNECTED-FIRST (operator incident 2026-07-13 02:12: 10-15s pinned on
    // "Connecting…" ON LOCALHOST). Auth is already proven by every caller
    // (session probe ok / modal sign-in / a bearer verified by the direct
    // path's preflight) — the app flips to connected NOW and each discovery
    // surface fills as its fetch lands. The measured whale is the gateway
    // runs listing (2.2-7.9s at ~500 runs, include_metrics; /api/health
    // answers in 1ms) — a slow data scan must never gate first paint. The
    // four fetches below run in PARALLEL (they were serialized: bundles →
    // runs → tools ∥ providers).
    const epoch = discovery_epoch_ref.current;
    set_gateway_connected(true);
    set_discovered_models_by_provider({});

    const [bundles_res, , tools_res, providers_res] = await Promise.allSettled([
      gateway_for_connect.list_bundles(),
      refresh_runs(gateway_for_connect),
      gateway_for_connect.discovery_tools(),
      gateway_for_connect.discovery_providers({ include_models: false }),
    ]);
    // EPOCH GUARD (adversary 2026-07-13): a sign-out that happened during
    // the awaits must not have its cleared state repopulated by these
    // late results.
    if (epoch !== discovery_epoch_ref.current) return;

    // ALL-REJECTED = the gateway died (or refused us) between the auth
    // proof and discovery — staying "connected" over three failures would
    // be the old lie. Surface it and drop back to the sign-in screen.
    if (bundles_res.status === "rejected" && tools_res.status === "rejected" && providers_res.status === "rejected") {
      set_gateway_connected(false);
      set_discovery_error(gateway_connect_error_message(bundles_res.reason, settings));
      push_log({ ts: now_iso(), kind: "error", title: "Discovery failed", preview: clamp_preview(String(bundles_res.reason || "")) });
      return;
    }

    let workflow_count = 0;
    if (bundles_res.status === "fulfilled") {
      const opts = build_workflow_options_from_bundles(bundles_res.value);
      workflow_count = opts.length;
      set_workflow_options(opts);
    } else {
      set_workflow_options([]);
      push_log({ ts: now_iso(), kind: "error", title: "Discovery bundles failed", preview: clamp_preview(String(bundles_res.reason || "")) });
    }

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

    push_log({ ts: now_iso(), kind: "info", title: "Gateway discovery loaded", preview: clamp_preview(`workflows: ${workflow_count}`) });
  }

  /** Legacy/dev direct path (bearer token against a cross-origin gateway) +
   * the boot path when a browser session already exists. The primary
   * sign-in UX is the shared uic modal (handle_connection_status).
   * `opts.open_modal_if_needed`: explicit user clicks open the sign-in
   * modal when no credentials exist; the silent boot probe never does. */
  async function on_discover_gateway(opts?: { open_modal_if_needed?: boolean; prefer_direct?: boolean }): Promise<void> {
    set_discovery_error("");
    set_gateway_connected(false);
    set_discovery_loading(true);
    try {
      // SESSION FIRST, before any URL validation (adversary P0: the URL
      // checks below only matter for the DIRECT path — running them first
      // meant the default localhost URL blocked a perfectly valid session
      // on every deployed host). An existing browser session wins over any
      // stored direct token — sign-in-once is the contract.
      if (!opts?.prefer_direct) {
        const probe = await fetchGatewayConnection().catch(() => null);
        set_connection_status(probe);
        if (probe && probe.has_session && probe.gateway?.ok) {
          set_settings((s) => ({ ...s, gateway_auth_mode: "session", auth_token: "" }));
          await run_discovery(new GatewayClient({ base_url: "", auth_token: "" }));
          return;
        }
      }

      const direct_token = String(settings.auth_token || "").trim();
      if (!direct_token) {
        // No session, no dev bearer: the shared modal is the way in (the
        // boot path opens it too — flow/console parity: signed-out is a
        // sign-in screen, never a dead app).
        if (opts?.open_modal_if_needed) set_connect_modal_open(true);
        return;
      }

      // DIRECT dev path: the URL validation belongs to this branch only.
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
      // BEARER PREFLIGHT (adversary 2026-07-13: the token is operator-TYPED,
      // not verified — connected-first must not flip green for a wrong dev
      // token). One cheap authenticated call (~20ms) proves it; a 401 throws
      // into the catch below and surfaces as discovery_error with the app
      // still on the sign-in screen.
      const direct_client = new GatewayClient({ base_url: gw_url_raw, auth_token: direct_token });
      await direct_client.list_bundles();
      set_settings((s) => ({ ...s, gateway_auth_mode: "direct" }));
      await run_discovery(direct_client);
    } catch (e: any) {
      set_discovery_error(gateway_connect_error_message(e, settings));
    } finally {
      set_discovery_loading(false);
    }
  }

  /** The shared modal's status callback: a fresh sign-in flips the app to
   * session mode, runs discovery, and closes the modal (flow parity); a
   * sign-out disconnects. The modal also emits on OPEN (its silent probe) —
   * a connected app skips redundant re-discovery, and a connected DIRECT
   * app is never silently rewired by merely opening the dialog. */
  const had_session_ref = useRef(false);
  /** Bumped on every disconnect: in-flight discovery/runs fetches compare
   * their entry epoch before writing state, so late results can never
   * repopulate a signed-out app (adversary 2026-07-13). */
  const discovery_epoch_ref = useRef(0);
  function handle_connection_status(s: GatewayConnectionState | null): void {
    set_connection_status(s);
    const signed_in = Boolean(s && s.has_session && s.gateway?.ok);
    const was_signed_in = had_session_ref.current;
    had_session_ref.current = signed_in;
    if (signed_in) {
      // Looking at the dialog must not rewire a live DIRECT dev connection.
      if (gateway_connected && settings.gateway_auth_mode === "direct") return;
      const principal_user = String(s?.gateway?.principal?.user_id || "").trim();
      set_settings((prev) => ({
        ...prev,
        gateway_auth_mode: "session",
        auth_token: "",
        gateway_user: principal_user || prev.gateway_user,
      }));
      if (!was_signed_in) set_connect_modal_open(false); // fresh sign-in: dialog closes (flow parity)
      if (gateway_connected && settings.gateway_auth_mode === "session") return; // open-probe of a live connection
      set_discovery_error("");
      set_discovery_loading(true);
      void run_discovery(new GatewayClient({ base_url: "", auth_token: "" }))
        .catch((e: any) => set_discovery_error(gateway_connect_error_message(e, settings)))
        .finally(() => set_discovery_loading(false));
      return;
    }
    if (s && !s.has_session && settings.gateway_auth_mode === "session") {
      // Signed out through the modal (or the session expired): reflect it
      // app-wide — an app that keeps rendering over a dead session is the
      // old lie this wave exists to end. (No gateway_connected gate: a
      // sign-out DURING in-flight discovery must still land.)
      disconnect_gateway({ keep_session: true });
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

  /** Reset the app's connection state. By default this ALSO signs the
   * browser out (DELETE the session — it is what "Disconnect" means to an
   * operator, and matches the console's Sign out). Callers reacting to a
   * sign-out that ALREADY happened (the modal's own sign-out, an expired
   * session) pass keep_session to avoid a redundant DELETE. Scope is THIS
   * app's origin only — since the 2026-07-12 split the entity app is its
   * own deployment with its own cookies. */
  function disconnect_gateway(opts?: { keep_session?: boolean }): void {
    // Invalidate in-flight discovery/runs fetches BEFORE clearing state so
    // their late results cannot write over the cleared app.
    discovery_epoch_ref.current += 1;
    if (!opts?.keep_session) {
      void fetch("/api/connection/gateway", { method: "DELETE" }).catch(() => undefined);
      had_session_ref.current = false;
    }
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
    set_connection_status(null);
    set_settings((s) => ({ ...s, auth_token: "" }));
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

  // LIVE RUN LIST (mission-control wave, 2026-07-12): the board and the run
  // rail must never depend on a human pressing Refresh — a pending approval
  // on an unwatched run was invisible before this. 5s while the tab is
  // visible, 30s hidden — SELF-TUNING against slow servers (2026-07-13):
  // the runs listing measured 2-8s server-side at ~500 runs, and a fixed
  // 5s cadence against a 3s query makes the board the gateway's main load.
  // The next tick waits at least 3× the last request's duration, so a slow
  // gateway sees gentle polling and a fast one keeps the 5s liveness.
  useEffect(() => {
    if (!gateway_connected) return;
    let timer: number | null = null;
    let disposed = false;
    let ticking = false;
    const schedule = (ms: number) => {
      if (disposed) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      // One chain only: a visibility-triggered tick while a poll is in
      // flight would fork a second setTimeout chain forever (each chain
      // reschedules itself); the running chain already reschedules.
      if (ticking) return;
      ticking = true;
      const started = Date.now();
      try {
        await refresh_runs(gateway);
      } finally {
        // Reschedule INSIDE the finally: refresh_runs is throw-proof today,
        // but a future edit that lets it reject must degrade to a late
        // tick, never to silent poll death (adversary 2026-07-13).
        ticking = false;
        const took = Date.now() - started;
        const base = document.visibilityState === "hidden" ? 30_000 : 5_000;
        schedule(Math.max(base, took * 3));
      }
    };
    const on_visibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", on_visibility);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", on_visibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway_connected, gateway]);

  // Entity tiles for the board: roster + the CHEAP per-entity card (gateway
  // c1038 — card + as_of_seq; never whole-life replay folds). 30s cadence.
  useEffect(() => {
    if (!gateway_connected) {
      set_board_entities([]);
      set_board_entities_error("");
      return;
    }
    let stop = false;
    let timer: number | null = null;
    const load = async () => {
      try {
        const roster = await gateway.list_entities();
        const names = roster.entities
          .map((e: any) => String(e?.name || e?.slug || "").trim())
          .filter(Boolean)
          .slice(0, 12);
        const tiles: BoardEntityTile[] = await Promise.all(
          names.map(async (name): Promise<BoardEntityTile> => {
            try {
              const card = await gateway.get_entity_card(name);
              // Live card shape (verified against castor 2026-07-12):
              // state is an OBJECT {state, changed_at, reason, written_by};
              // moments entries carry {kind, at}, no title.
              const state_obj = card?.state && typeof card.state === "object" ? card.state : null;
              const moments = Array.isArray(card?.moments) ? card.moments : [];
              const last = moments.length ? moments[moments.length - 1] : null;
              return {
                name,
                state: String(state_obj?.state ?? (typeof card?.state === "string" ? card.state : "")).trim(),
                age_days: typeof card?.age_days === "number" ? card.age_days : null,
                last_moment: String(last?.kind || "").trim(),
                error: "",
              };
            } catch (e: any) {
              return { name, state: "", age_days: null, last_moment: "", error: String(e?.message || e || "card failed") };
            }
          }),
        );
        if (!stop) {
          set_board_entities(tiles);
          set_board_entities_total(roster.entities.length);
          set_board_entities_error("");
        }
      } catch (e: any) {
        // No entity door on this gateway is a normal deployment, not an error.
        if (!stop) {
          set_board_entities([]);
          const msg = String(e?.message || e || "");
          set_board_entities_error(/404|not found/i.test(msg) ? "" : msg);
        }
      }
      if (!stop) timer = window.setTimeout(() => void load(), 30_000);
    };
    void load();
    return () => {
      stop = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway_connected, gateway]);

  // Board-initiated wait answers: independent of the attached run (the
  // whole point — approve from the Review column without switching context).
  async function board_resume_wait(rid: string, wait_key: string, payload_obj: any): Promise<void> {
    const wk = String(wait_key || "").trim();
    if (!rid || !wk) throw new Error("This wait has no wait_key yet — open the run to inspect.");
    await gateway.submit_command({
      command_id: random_id(),
      run_id: rid,
      type: "resume",
      payload: { wait_key: wk, payload: payload_obj || {} },
      client_id: "web_pwa",
    });
    push_log({ ts: now_iso(), kind: "info", title: "Board resume submitted", preview: clamp_preview(`run ${rid} · wait ${wk}`), data: { run_id: rid, wait_key: wk } });
    void refresh_runs(gateway, { force: true });
    window.setTimeout(() => void refresh_runs(gateway, { force: true }), 1200);
  }

  const session_id_for_run = useMemo(() => {
    const sid = (run_state as any)?.session_id;
    if (typeof sid === "string") return sid.trim();
    if (sid == null) return "";
    return String(sid || "").trim();
  }, [run_state]);

  const chat_voice_session_id = useMemo(() => {
    const sid = String(session_id_for_run || "").trim();
    if (sid) return sid;
    return String(start_session_id || "").trim();
  }, [session_id_for_run, start_session_id]);

  useEffect(() => {
    if (!gateway_connected || !chat_voice_session_id) {
      set_chat_voice_run_id("");
      set_chat_voice_error("");
      return;
    }
    void (async () => {
      try {
        const rid = await session_memory_run_id(chat_voice_session_id);
        set_chat_voice_run_id(rid);
      } catch {
        set_chat_voice_run_id("");
      }
    })();
  }, [gateway_connected, chat_voice_session_id]);

  const chat_voice = useGatewayVoice({
    gateway: gateway_connected ? gateway : null,
    session_id: chat_voice_session_id,
    run_id: chat_voice_run_id,
    on_error: set_chat_voice_error,
    on_transcript: (text) => {
      const t = String(text || "").trim();
      if (!t) return;
      set_chat_input((prev) => {
        const cur = String(prev || "");
        if (!cur.trim()) return t;
        return `${cur.trimEnd()}\n${t}`;
      });
      window.setTimeout(() => chat_input_ref.current?.focus(), 0);
    },
  });

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
      const blob = await gateway.download_run_artifact_content(rid, artifact_id, { access: "download" });
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
      const blob = await gateway.download_run_artifact_content(rid, artifact_id, { access: "download" });
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

  async function download_runtime_artifact(item: RuntimeArtifact): Promise<void> {
    const rid = String(item?.run_id || "").trim();
    const artifact_id = String(item?.artifact_id || "").trim();
    if (!rid || !artifact_id) {
      set_status("Artifact download needs a run id", 3);
      return;
    }
    const fallback = artifact_label(item) || artifact_id;
    try {
      const blob = await gateway.download_run_artifact_content(rid, artifact_id, { access: "preview" });
      _download_blob(blob, sanitize_filename_part(fallback));
      set_status("Downloaded artifact", 2);
    } catch (e: any) {
      set_status(String(e?.message || e || "Download failed"), 3);
    }
  }

  async function preview_runtime_artifact(item: RuntimeArtifact): Promise<void> {
    const rid = String(item?.run_id || "").trim();
    const artifact_id = String(item?.artifact_id || "").trim();
    if (!rid || !artifact_id) {
      set_status("Artifact preview needs a run id", 3);
      return;
    }

    const label = artifact_label(item);
    const content_type = String(item?.content_type || "").trim().toLowerCase();
    const kind = artifact_preview_kind(item);
    const likely_html = kind === "text" && artifact_text_render_kind(item, "") === "html";
    const html_preview_window = likely_html ? window.open("about:blank", "_blank") : null;
    if (html_preview_window) {
      html_preview_window.document.write("<!doctype html><title>Loading artifact preview...</title><body style=\"font:14px system-ui;padding:24px\">Loading artifact preview...</body>");
      html_preview_window.document.close();
    }

    set_runtime_preview_title(label || artifact_id);
    set_runtime_preview_text("");
    set_runtime_preview_error("");
    set_runtime_preview_kind(kind);
    set_runtime_preview_artifact(item);
    set_runtime_preview_open(true);
    if (runtime_preview_url) {
      URL.revokeObjectURL(runtime_preview_url);
      set_runtime_preview_url("");
    }

    if (kind === "binary") {
      set_runtime_preview_text(`(Binary artifact: ${content_type || "unknown"}; download to view.)`);
      return;
    }
    if (kind === "text" && typeof item.size_bytes === "number" && item.size_bytes > 1_500_000) {
      set_runtime_preview_text(`(Text artifact is ${item.size_bytes.toLocaleString()} bytes; download to view.)`);
      return;
    }

    set_runtime_preview_loading(true);
    try {
      const blob = await gateway.download_run_artifact_content(rid, artifact_id, { access: "preview" });
      if (kind === "text") {
        const raw = await blob.text();
        const render_kind = artifact_text_render_kind(item, raw);
        if (render_kind === "html") {
          const html_blob = new Blob([raw], { type: content_type.includes("html") ? String(item.content_type || "text/html") : "text/html;charset=utf-8" });
          const html_url = URL.createObjectURL(html_blob);
          const target_window = html_preview_window || window.open("about:blank", "_blank");
          if (target_window) {
            target_window.location.href = html_url;
            set_runtime_preview_open(false);
            set_runtime_preview_artifact(null);
            set_runtime_preview_text("");
            set_runtime_preview_loading(false);
            setTimeout(() => URL.revokeObjectURL(html_url), 5 * 60 * 1000);
            set_status("Opened HTML preview", 2);
            return;
          }
          URL.revokeObjectURL(html_url);
          set_runtime_preview_error("Browser blocked opening the HTML page. Showing highlighted source instead.");
        } else if (html_preview_window) {
          html_preview_window.close();
        }
        const max_chars = render_kind === "json" ? 1_500_000 : render_kind === "markdown" ? 250_000 : render_kind === "html" ? 300_000 : 22000;
        set_runtime_preview_text(
          raw.length > max_chars && render_kind !== "text"
            ? `${format_bytes(item.size_bytes ?? raw.length)} ${render_kind.toUpperCase()} artifact. Download to inspect it.`
            : raw.length > max_chars
              ? `${raw.slice(0, Math.max(0, max_chars - 1))}…`
              : raw
        );
      } else {
        if (html_preview_window) html_preview_window.close();
        set_runtime_preview_url(URL.createObjectURL(blob));
      }
    } catch (e: any) {
      if (html_preview_window) html_preview_window.close();
      set_runtime_preview_error(String(e?.message || e || "Preview failed"));
    } finally {
      set_runtime_preview_loading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (runtime_preview_url) URL.revokeObjectURL(runtime_preview_url);
    };
  }, [runtime_preview_url]);

  async function fetch_runtime_embedded_preview(item: RuntimeArtifact): Promise<RuntimeEmbeddedPreview> {
    const artifact_id = String(item.artifact_id || "").trim();
    const rid = String(item.run_id || "").trim();
    const kind = artifact_preview_kind(item);

    if (!rid || !artifact_id) {
      return { artifact_id, kind, render_kind: "", text: "Preview needs artifact run metadata.", url: "", loading: false, error: "" };
    }
    if (kind === "binary") {
      return {
        artifact_id,
        kind,
        render_kind: "",
        text: `Preview unavailable for ${item.content_type || item.modality || "this artifact"}. Download to inspect it.`,
        url: "",
        loading: false,
        error: "",
      };
    }
    if (kind === "text" && typeof item.size_bytes === "number" && item.size_bytes > 500_000) {
      return {
        artifact_id,
        kind,
        render_kind: "",
        text: `${format_bytes(item.size_bytes)} text artifact. Use Preview for a larger view or Download to inspect locally.`,
        url: "",
        loading: false,
        error: "",
      };
    }

    try {
      const blob = await gateway.download_run_artifact_content(rid, artifact_id, { access: "preview" });
      if (kind === "text") {
        const raw = await blob.text();
        const render_kind = artifact_text_render_kind(item, raw);
        const max_chars = render_kind === "json" ? 500_000 : render_kind === "markdown" ? 120_000 : render_kind === "html" ? 300_000 : 8000;
        return {
          artifact_id,
          kind,
          render_kind,
          text:
            raw.length > max_chars && render_kind !== "text"
              ? `${format_bytes(item.size_bytes ?? raw.length)} ${render_kind.toUpperCase()} artifact. Use Larger preview or Download to inspect it.`
              : raw.length > max_chars
              ? `${raw.slice(0, Math.max(0, max_chars - 1))}…`
              : raw,
          url: "",
          loading: false,
          error: "",
        };
      }
      return { artifact_id, kind, render_kind: "", text: "", url: URL.createObjectURL(blob), loading: false, error: "" };
    } catch (e: any) {
      return { artifact_id, kind, render_kind: "", text: "", url: "", loading: false, error: String(e?.message || e || "Preview failed") };
    }
  }

  async function load_runtime_embedded_preview(item: RuntimeArtifact | null): Promise<void> {
    if (runtime_embedded_preview.url) URL.revokeObjectURL(runtime_embedded_preview.url);
    if (!item) {
      set_runtime_embedded_preview(empty_runtime_preview());
      return;
    }
    const artifact_id = String(item.artifact_id || "").trim();
    const kind = artifact_preview_kind(item);
    set_runtime_embedded_preview({ artifact_id, kind, render_kind: "", text: "", url: "", loading: true, error: "" });
    set_runtime_embedded_preview(await fetch_runtime_embedded_preview(item));
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
    records_buffer_ref.current?.push({ cursor: ev.cursor, record: ev.record });
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
      preview = clamp_preview(
        emit_name === "abstract.steer_seen" ? steer_seen_preview(emit?.payload) : extract_textish(emit?.payload).text,
      );
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
    child_records_buffer_ref.current?.push({ run_id: child_run_id, cursor: ev.cursor, record: ev.record });
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
      preview = clamp_preview(
        emit_name === "abstract.steer_seen" ? steer_seen_preview(emit?.payload) : extract_textish(emit?.payload).text,
      );
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
    child_records_buffer_ref.current?.push({ run_id: child_run_id, cursor: ev.cursor, record: ev.record });

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
      preview = clamp_preview(
        emit_name === "abstract.steer_seen" ? steer_seen_preview(emit?.payload) : extract_textish(emit?.payload).text,
      );
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
    records_buffer_ref.current?.reset();
    child_records_buffer_ref.current?.reset();
    digest_cache_ref.current = null;
    latest_summary_scan_ref.current = { scanned: 0, found: null };
    set_records([]);
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

      // Best-effort: discover descendant runs even when the root run's ledger does not include
      // explicit subworkflow wait markers (common for event-driven "listener" children).
      //
      // This keeps Observer useful for transports like Telegram where the durable work happens in
      // child runs (event listeners + per-message subruns).
      try {
        const bundle = await gateway.get_run_history_bundle(rid, { include_subruns: true, include_session: false, ledger_mode: "tail", ledger_max_items: 1 });
        const ledgers = bundle && typeof bundle === "object" ? (bundle as any).ledgers : null;
        const ids = ledgers && typeof ledgers === "object" ? Object.keys(ledgers as any) : [];
        const subs = ids
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .filter((x) => x !== rid);
        if (subs.length) {
          for (const s of subs) subrun_ids_ref.current.add(s);
          set_subrun_ids((prev) => Array.from(new Set([...prev, ...subs])));

          // If the selected run is just a lightweight wrapper (common for event-driven transports),
          // automatically follow the "main" descendant so the user sees meaningful ledger/digest data.
          try {
            const root_total = typeof (ledgers as any)?.[rid]?.total === "number" ? Number((ledgers as any)[rid].total) : 0;
            let best = "";
            let best_total = -1;
            for (const s of subs) {
              const total = typeof (ledgers as any)?.[s]?.total === "number" ? Number((ledgers as any)[s].total) : 0;
              if (total > best_total) {
                best = s;
                best_total = total;
              }
            }
            if (best && best_total > Math.max(root_total * 3, root_total + 20)) {
              follow_run_ref.current = best;
              set_follow_run_id(best);
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore (Observer still works for the root ledger)
      }

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

  async function attach_to_run(rid: string, opts?: { root_run_id?: string }): Promise<void> {
    const run = String(rid || "").trim();
    if (!run) return;
    set_error_text("");
    const root = String(opts?.root_run_id || run).trim() || run;
    set_root_run_id(root);
    set_run_id(run);
    await connect_to_run(run);
  }

  useEffect(() => {
    const rid = String(pending_url_run_id || "").trim();
    if (!rid) return;
    let stopped = false;
    void (async () => {
      try {
        if (!gateway_connected) await on_discover_gateway({ open_modal_if_needed: true });
        if (stopped) return;
        // A shared run link must LAND on the run — the board became the
        // default page, so deep links now navigate explicitly.
        set_page("observe");
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
    records_buffer_ref.current?.reset();
    child_records_buffer_ref.current?.reset();
    digest_cache_ref.current = null;
    latest_summary_scan_ref.current = { scanned: 0, found: null };
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

  async function submit_run_control_for_run(target_run_id: string, type: "pause" | "resume" | "cancel", opts?: { reason?: string }): Promise<string | null> {
    const rid = String(target_run_id || "").trim();
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
      push_log({ ts: now_iso(), kind: "info", title: `${type} submitted`, preview: reason ? `reason: ${reason}` : "", data: { run_id: rid, type, reason } });
      // Refresh run state quickly.
      try {
        if (rid === run_id.trim()) {
          const st = await gateway.get_run(rid);
          set_run_state(st);
        }
      } catch {
        // ignore
      }
      void refresh_runs(gateway, { force: true });
      window.setTimeout(() => void refresh_runs(gateway, { force: true }), 900);
      window.setTimeout(() => void refresh_runs(gateway, { force: true }), 2400);
      return null;
    } catch (e: any) {
      const msg = String(e?.message || e || `${type} failed`);
      set_error_text(msg);
      return msg;
    }
  }

  async function submit_run_control(type: "pause" | "resume" | "cancel", opts?: { reason?: string }): Promise<string | null> {
    return submit_run_control_for_run(run_id.trim(), type, opts);
  }

  async function cancel_visible_run(target_run_id: string, reason = "Stopped from AbstractObserver"): Promise<void> {
    const rid = String(target_run_id || "").trim();
    if (!rid) return;
    const ok = window.confirm(`Cancel run ${short_id(rid, 24)}?`);
    if (!ok) return;
    const err = await submit_run_control_for_run(rid, "cancel", { reason });
    if (!err) set_status("Cancel submitted", 2);
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
    if (chat_voice.voice_ptt_busy) {
      set_chat_voice_error("Wait for transcription to finish.");
      return;
    }

    set_chat_error("");
    set_chat_voice_error("");
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

  function toggle_chat_tts(m: ChatMessage): void {
    const key = String(m.id || m.ts || "").trim();
    const text = String(m.content || "").trim();
    if (!key || !text) return;
    set_chat_voice_error("");
    void chat_voice.toggle_tts(key, text);
  }

  function chat_tts_state_for(m: ChatMessage): "idle" | "loading" | "playing" | "paused" {
    const key = String(m.id || m.ts || "").trim();
    const cur = chat_voice.tts_playback;
    if (!key || !cur.key || cur.key !== key) return "idle";
    return cur.status;
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
      try {
        const st = await gateway.get_run(rid);
        set_run_state(st);
      } catch {
        // ignore
      }
      void refresh_runs(gateway, { force: true });
      window.setTimeout(() => void refresh_runs(gateway, { force: true }), 900);
      window.setTimeout(() => void refresh_runs(gateway, { force: true }), 2400);
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
  const run_status = typeof run_state?.status === "string" ? String(run_state.status) : "";
  const run_paused = Boolean(run_state?.paused);
  const run_terminal = run_status === "completed" || run_status === "failed" || run_status === "cancelled";
  const is_until_wait = wait_reason === "until" && Boolean(wait_until);
  const is_waiting = !run_terminal && is_waiting_status(last_record) && (Boolean(wait_key) || is_until_wait);
  const is_user_wait = wait_reason === "user";
  const wait_event_name = wait_reason === "event" ? normalize_ui_event_name(event_name_from_wait_key(wait_key)) : "";
  const is_ask_event_wait = wait_reason === "event" && wait_event_name === "abstract.ask";
  const has_tool_wait = tool_calls_for_wait.length > 0;
  const show_wait_modal = is_waiting && wait_key && (is_user_wait || is_ask_event_wait || has_tool_wait) && dismissed_wait_key !== wait_key;
  const sub_run_id = typeof (wait_state as any)?.details?.sub_run_id === "string" ? String((wait_state as any).details.sub_run_id) : "";
  const wait_context_run: RunSummary = {
    run_id: run_id.trim(),
    workflow_id: typeof run_state?.workflow_id === "string" ? String(run_state.workflow_id) : null,
    status: run_status,
    created_at: typeof run_state?.created_at === "string" ? String(run_state.created_at) : null,
    updated_at: typeof run_state?.updated_at === "string" ? String(run_state.updated_at) : null,
    session_id: typeof run_state?.session_id === "string" ? String(run_state.session_id) : null,
    current_node: typeof run_state?.current_node === "string" ? String(run_state.current_node) : null,
  };
  const wait_recent_events = records.slice(-10).map((item) => ({
    cursor: item.cursor,
    node_id: String((item.record as any)?.node_id || "").trim(),
    status: String((item.record as any)?.status || "").trim(),
    effect_type: String((item.record as any)?.effect?.type || "").trim(),
    ts: String((item.record as any)?.ended_at || (item.record as any)?.started_at || "").trim(),
    summary: ledger_record_human_summary(item.record as StepRecord),
  }));
  const wait_blocker = wait_blocker_title(wait_state as WaitState | null, tool_calls_for_wait);
  const wait_expected = wait_expected_action(wait_state as WaitState | null, tool_calls_for_wait);
  const wait_request_info = wait_request_detail(wait_state as WaitState | null, input_data_obj);
  const wait_request = wait_request_info.text;
  const wait_request_metadata = wait_request_info.runtime_metadata;
  const wait_prompt_raw = String((wait_state as any)?.prompt || "").trim();
  const wait_conversation_context = extract_conversation_context(input_data_obj, 6);
  const wait_prompt_is_generic = Boolean(wait_prompt_raw && is_generic_wait_prompt(wait_prompt_raw));
  const wait_has_direct_question = Boolean(wait_prompt_raw && !wait_prompt_is_generic);
  const wait_request_label = wait_has_direct_question ? "Question from workflow" : wait_request && wait_request !== wait_prompt_raw ? "Closest prior user request" : "Request context";
  const wait_input_value = wait_json_value(input_data_obj, input_data_text);
  const wait_has_input = Boolean(input_data_text.trim());

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

  // Always-on, incremental: the latest persisted run summary (abstract.summary)
  // in the root ledger. The Overview tab (the app's default tab) needs this
  // live, so it must NOT ride the digest-tab-gated memo below. `records` only
  // grows via concat or resets to [] (run switch), so scanning just the new
  // tail keeps this O(new records) per flush.
  const latest_run_summary = useMemo<LatestRunSummary | null>(() => {
    const scan = latest_summary_scan_ref.current;
    if (records.length < scan.scanned) {
      scan.scanned = 0;
      scan.found = null;
    }
    for (let i = scan.scanned; i < records.length; i++) {
      const item = records[i];
      const rec = item?.record;
      if (!rec) continue;
      const emit = extract_emit_event(rec);
      const name = emit && emit.name ? normalize_ui_event_name(emit.name) : "";
      if (name !== "abstract.summary") continue;
      const payload = emit?.payload && typeof emit.payload === "object" ? (emit.payload as any) : {};
      const text = typeof payload?.text === "string" ? String(payload.text) : "";
      if (!text.trim()) continue;
      scan.found = {
        cursor: item.cursor,
        ts: String(rec?.ended_at || rec?.started_at || ""),
        text,
        provider: typeof payload?.provider === "string" ? String(payload.provider) : undefined,
        model: typeof payload?.model === "string" ? String(payload.model) : undefined,
        generated_at: typeof payload?.generated_at === "string" ? String(payload.generated_at) : undefined,
        source: payload?.source,
      };
    }
    scan.scanned = records.length;
    return scan.found;
  }, [records]);

  const digest = useMemo<RunDigest | null>(() => {
    // Every OTHER consumer of the digest lives inside the `right_tab ===
    // "digest"` panel (Overview reads `latest_run_summary` above), but this
    // memo used to recompute over the FULL record history on every ledger
    // flush regardless of visibility — per-record parsing (emit extraction,
    // JSON previews) over an unbounded array, the main always-on CPU burn at
    // resident scale. Compute only while the digest tab is showing; keep the
    // last computed value so tab switches render instantly (it recomputes
    // fresh on the next records change while open).
    if (right_tab !== "digest") return digest_cache_ref.current;
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

    // Latest persisted run summary (abstract.summary) in the parent/root
    // ledger — shared with the always-on Overview scan above.
    const latest_summary = latest_run_summary;

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

    const computed: RunDigest = { overall, per_run, subruns, latest_summary, summary_outdated };
    digest_cache_ref.current = computed;
    return computed;
  }, [records, child_records_for_digest, run_id, subrun_ids, discovered_tool_specs, right_tab, latest_run_summary]);

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
    return all_run_options.find((r) => String(r.run_id || "").trim() === rid) || run_options.find((r) => String(r.run_id || "").trim() === rid) || null;
  }, [all_run_options, run_options, run_id]);

  const selected_run_status_raw = String(run_state?.status || selected_run_summary?.status || "").trim();
  const selected_run_wait_reason = String(wait_reason || run_state?.waiting?.reason || selected_run_summary?.waiting_reason || "").trim().toLowerCase();
  const selected_run_is_scheduled = Boolean(run_state?.is_scheduled || selected_run_summary?.is_scheduled);
  const selected_run_is_paused = Boolean(run_state?.paused || selected_run_summary?.paused);
  const selected_run_is_scheduled_waiting = selected_run_is_scheduled && selected_run_status_raw.toLowerCase() === "waiting";
  const selected_run_is_scheduled_until = selected_run_is_scheduled_waiting && selected_run_wait_reason === "until";
  const selected_next_ms = parse_iso_ms(wait_until);
  const selected_next_in =
    selected_run_is_scheduled_until && selected_next_ms !== null ? format_time_until_from_ms(selected_next_ms - Date.now()) : "";
  const selected_run_status_label = selected_run_is_scheduled && selected_run_is_paused ? "Suspended" : selected_run_is_scheduled_waiting ? "Scheduled" : selected_run_status_raw;

  async function refresh_runtime_artifacts(): Promise<void> {
    if (!gateway_connected) return;
    set_runtime_artifacts_loading(true);
    set_runtime_artifacts_error("");
    try {
      const scope = runtime_scope;
      const session_id = scope === "session" ? String(runtime_session_filter_id || session_id_for_run || start_session_id || "").trim() : "";
      const scoped_run_id = scope === "run" ? String(runtime_artifact_run_filter || run_id || "").trim() : "";
      const created_after = runtime_created_after_for_filter(runtime_date_filter);
      const artifact_kind = runtime_type_filters.length ? runtime_type_filters.join(",") : "";
      const sort_params = runtime_sort_gateway_params(runtime_sort_by);
      const offset = Math.max(0, runtime_artifact_page) * RUNTIME_ARTIFACT_PAGE_SIZE;

      const search_res = await gateway.search_artifacts({
        scope,
        session_id: session_id || undefined,
        run_id: scoped_run_id || undefined,
        query: runtime_query || undefined,
        artifact_kind: artifact_kind || undefined,
        created_after: created_after || undefined,
        include_stats: true,
        limit: RUNTIME_ARTIFACT_PAGE_SIZE,
        offset,
        order_by: sort_params.order_by,
        order: sort_params.order,
      });

      const rows: RuntimeArtifact[] = [];
      const seen = new Set<string>();
      for (const raw of Array.isArray(search_res?.items) ? search_res.items : []) {
        const art = normalize_artifact_item(raw, "search");
        if (!art || seen.has(art.artifact_id)) continue;
        seen.add(art.artifact_id);
        rows.push(art);
      }
      const stats = search_res?.stats && typeof search_res.stats === "object" ? search_res.stats : {};
      const total = Number(stats?.total ?? search_res?.total ?? rows.length);
      const filtered_facets = artifact_facets_from_search_response(search_res);
      let type_facets = filtered_facets;
      if (runtime_type_filters.length) {
        try {
          const facet_res = await gateway.search_artifacts({
            scope,
            session_id: session_id || undefined,
            run_id: scoped_run_id || undefined,
            query: runtime_query || undefined,
            created_after: created_after || undefined,
            include_stats: true,
            limit: 1,
            offset: 0,
            order_by: sort_params.order_by,
            order: sort_params.order,
          });
          type_facets = artifact_facets_from_search_response(facet_res);
        } catch {
          type_facets = filtered_facets;
        }
      }
      set_runtime_artifact_total_count(Number.isFinite(total) ? Math.max(0, total) : rows.length);
      set_runtime_artifact_total_bytes(Number(stats?.total_bytes ?? stats?.byte_total ?? 0) || 0);
      set_runtime_artifact_facets(filtered_facets);
      set_runtime_artifact_type_facets(type_facets);
      set_runtime_artifacts(rows);
      set_runtime_selected_artifact_id((prev) => (prev && rows.some((a) => a.artifact_id === prev) ? prev : rows[0]?.artifact_id || ""));
    } catch (e: any) {
      set_runtime_artifacts_error(String(e?.message || e || "Failed to load artifacts"));
      set_runtime_artifacts([]);
      set_runtime_artifact_total_count(0);
      set_runtime_artifact_total_bytes(0);
      set_runtime_artifact_facets({});
      set_runtime_artifact_type_facets({});
      set_runtime_selected_artifact_id("");
    } finally {
      set_runtime_artifacts_loading(false);
    }
  }

  async function refresh_audit_log(): Promise<void> {
    if (!gateway_connected) return;
    set_audit_log_loading(true);
    set_audit_log_error("");
    try {
      const body = await gateway.audit_log_tail({ max_bytes: 160000 });
      const bytes = typeof body?.bytes === "number" ? Number(body.bytes) : 0;
      const truncated = Boolean(body?.truncated);
      set_audit_log_text(String(body?.content || ""));
      set_audit_log_meta(`${bytes.toLocaleString()} bytes${truncated ? " (tail)" : ""}`);
    } catch (e: any) {
      set_audit_log_error(String(e?.message || e || "Failed to load audit log"));
      set_audit_log_text("");
      set_audit_log_meta("");
    } finally {
      set_audit_log_loading(false);
    }
  }

  async function refresh_runtime_ledger_log(run_id_value?: string): Promise<void> {
    if (!gateway_connected) return;
    const rid = String(run_id_value || runtime_selected_run_id || runtime_artifact_run_filter || run_id || "").trim();
    if (!rid) {
      set_runtime_ledger_log_items([]);
      set_runtime_ledger_log_meta("");
      set_runtime_ledger_log_error("Select a run in Activity or Artifacts to load its runtime ledger.");
      return;
    }
    set_runtime_ledger_log_loading(true);
    set_runtime_ledger_log_error("");
    try {
      const page = await gateway.get_ledger(rid, { after: 0, limit: 2000 });
      const items = Array.isArray(page.items) ? page.items : [];
      set_runtime_ledger_log_items(items.map((record, idx) => ({ cursor: idx + 1, record: record as StepRecord })));
      const next_after = typeof page.next_after === "number" ? Number(page.next_after) : items.length;
      set_runtime_ledger_log_meta(`${items.length.toLocaleString()} record${items.length === 1 ? "" : "s"}${next_after >= 2000 ? " (first 2,000)" : ""}`);
    } catch (e: any) {
      set_runtime_ledger_log_error(String(e?.message || e || "Failed to load run ledger"));
      set_runtime_ledger_log_items([]);
      set_runtime_ledger_log_meta("");
    } finally {
      set_runtime_ledger_log_loading(false);
    }
  }

  useEffect(() => {
    if (!gateway_connected) return;
    if (page !== "runtime") return;
    void refresh_runtime_artifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway_connected, page, runtime_scope, runtime_session_filter_id, runtime_artifact_run_filter, runtime_query, runtime_type_filters, runtime_date_filter, runtime_sort_by, runtime_artifact_page]);

  useEffect(() => {
    if (!gateway_connected) return;
    if (audit_log_loading || audit_log_text) return;
    if (page === "runtime" || (page === "observe" && right_tab === "providers")) void refresh_audit_log();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway_connected, page, right_tab]);

  useEffect(() => {
    if (!gateway_connected) return;
    if (page !== "runtime" || runtime_tab !== "logs" || (runtime_log_source !== "run_ledger" && runtime_log_source !== "provider_calls")) return;
    const rid = String(runtime_selected_run_id || runtime_artifact_run_filter || run_id || "").trim();
    if (!rid) return;
    void refresh_runtime_ledger_log(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway_connected, page, runtime_tab, runtime_log_source, runtime_selected_run_id, runtime_artifact_run_filter, run_id]);

  const runtime_run_rows = useMemo(() => {
    const by_id = new Map<string, RunSummary>();
    for (const r of [...run_options, ...all_run_options]) {
      const rid = String(r.run_id || "").trim();
      if (rid) by_id.set(rid, r);
    }
    for (const rid0 of subrun_ids) {
      const rid = String(rid0 || "").trim();
      if (!rid || by_id.has(rid)) continue;
      by_id.set(rid, {
        run_id: rid,
        workflow_id: null,
        status: "",
        created_at: null,
        updated_at: null,
        ledger_len: null,
        parent_run_id: subrun_parent_ref.current[rid] || null,
        session_id: session_id_for_run || null,
      });
    }
    if (run_id.trim() && !by_id.has(run_id.trim())) {
      by_id.set(run_id.trim(), {
        run_id: run_id.trim(),
        workflow_id: typeof run_state?.workflow_id === "string" ? String(run_state.workflow_id) : null,
        status: typeof run_state?.status === "string" ? String(run_state.status) : "",
        created_at: typeof run_state?.created_at === "string" ? String(run_state.created_at) : null,
        updated_at: typeof run_state?.updated_at === "string" ? String(run_state.updated_at) : null,
        ledger_len: records.length || null,
        parent_run_id: typeof run_state?.parent_run_id === "string" ? String(run_state.parent_run_id) : null,
        session_id: typeof run_state?.session_id === "string" ? String(run_state.session_id) : session_id_for_run || null,
      });
    }
    return Array.from(by_id.values()).sort((a, b) => {
      const am = parse_iso_ms(a.updated_at || a.created_at) ?? 0;
      const bm = parse_iso_ms(b.updated_at || b.created_at) ?? 0;
      return bm - am;
    });
  }, [all_run_options, run_options, run_id, run_state, records.length, subrun_ids, session_id_for_run]);

  const observe_sections = useMemo<RunTreeSection[]>(() => {
    const q = observe_search.trim().toLowerCase();
    const rows = runtime_run_rows;
    const children_by_parent: Record<string, RunSummary[]> = {};
    const by_id: Record<string, RunSummary> = {};
    for (const r of rows) {
      const rid = String(r.run_id || "").trim();
      if (!rid) continue;
      by_id[rid] = r;
      const parent = String(r.parent_run_id || subrun_parent_ref.current[rid] || "").trim();
      if (parent) {
        if (!children_by_parent[parent]) children_by_parent[parent] = [];
        children_by_parent[parent].push(r);
      }
    }

    const matches_status = (r: RunSummary): boolean => {
      const st = String(r.status || "").trim().toLowerCase();
      if (observe_filter === "all") return true;
      if (observe_filter === "active") return active_run_status(st);
      if (observe_filter === "waiting") return st === "waiting";
      if (observe_filter === "terminal") return terminal_run_status(st);
      if (observe_filter === "failed") return st === "failed";
      return true;
    };
    const matches_query = (r: RunSummary): boolean => {
      if (!q) return true;
      const wid = String(r.workflow_id || r.schedule_target_workflow_id || "").trim();
      const label = wid ? workflow_label_by_id[wid] || wid : "";
      const hay = [r.run_id, wid, label, r.session_id, r.status].join(" ").toLowerCase();
      return hay.includes(q);
    };
    const root_ids = new Set<string>();
    for (const r of rows) {
      const rid = String(r.run_id || "").trim();
      if (!rid) continue;
      const parent = String(r.parent_run_id || subrun_parent_ref.current[rid] || "").trim();
      if (!parent || !by_id[parent]) root_ids.add(rid);
    }

    const section_map: Record<string, RunTreeSection> = {};
    const group_for = (r: RunSummary): { key: string; label: string } => {
      if (observe_group_by === "workflow") {
        const wid = String(r.schedule_target_workflow_id || r.workflow_id || "").trim() || "(unknown workflow)";
        return { key: wid, label: workflow_label_by_id[wid] || wid };
      }
      if (observe_group_by === "session") {
        const sid = String(r.session_id || "").trim() || "(no session)";
        return { key: sid, label: sid };
      }
      const st = String(r.status || "").trim().toLowerCase() || "unknown";
      if (active_run_status(st)) return { key: "active", label: "Active" };
      if (st === "failed") return { key: "failed", label: "Failed" };
      if (terminal_run_status(st)) return { key: "finished", label: "Finished" };
      return { key: st, label: st };
    };

    for (const rid of root_ids) {
      const root = by_id[rid];
      if (!root) continue;
      const children = [...(children_by_parent[rid] || [])].sort((a, b) => {
        const am = parse_iso_ms(a.updated_at || a.created_at) ?? 0;
        const bm = parse_iso_ms(b.updated_at || b.created_at) ?? 0;
        return bm - am;
      });
      const child_matches = children.some((c) => matches_status(c) && matches_query(c));
      if (!(matches_status(root) && matches_query(root)) && !child_matches) continue;
      const g = group_for(root);
      if (!section_map[g.key]) section_map[g.key] = { key: g.key, label: g.label, rows: [] };
      section_map[g.key].rows.push({ run: root, children });
    }

    return Object.values(section_map).sort((a, b) => {
      const order: Record<string, number> = { active: 0, waiting: 1, failed: 2, finished: 3 };
      const ao = order[a.key] ?? 10;
      const bo = order[b.key] ?? 10;
      if (ao !== bo) return ao - bo;
      return a.label.localeCompare(b.label);
    });
  }, [runtime_run_rows, observe_search, observe_filter, observe_group_by, workflow_label_by_id]);

  const provider_activities = useMemo<ProviderActivity[]>(() => build_provider_activities_from_ledger(ledger_record_items as any), [ledger_record_items]);

  const timeline_items = useMemo(() => {
    const out = [...ledger_record_items];
    out.sort((a, b) => {
      const at = parse_iso_ms(a.record?.ended_at || a.record?.started_at) ?? 0;
      const bt = parse_iso_ms(b.record?.ended_at || b.record?.started_at) ?? 0;
      return at - bt;
    });
    return out.slice(-240);
  }, [ledger_record_items]);

  const runtime_run_by_id = useMemo(() => {
    const out: Record<string, RunSummary> = {};
    for (const r of runtime_run_rows) {
      const rid = String(r.run_id || "").trim();
      if (rid) out[rid] = r;
    }
    return out;
  }, [runtime_run_rows]);

  const runtime_context_run_id = String(runtime_selected_run_id || runtime_artifact_run_filter || run_id || "").trim();
  const runtime_context_run = runtime_context_run_id ? runtime_run_by_id[runtime_context_run_id] || null : null;
  const runtime_context_session_id = String(runtime_session_filter_id || runtime_context_run?.session_id || session_id_for_run || start_session_id || "").trim();

  const runtime_visible_artifacts = useMemo(() => {
    return runtime_artifacts.map((a) => artifact_with_runtime_context(a, runtime_run_by_id, workflow_label_by_id));
  }, [runtime_artifacts, runtime_run_by_id, workflow_label_by_id]);

  useEffect(() => {
    set_runtime_artifact_page(0);
  }, [runtime_query, runtime_type_filters, runtime_date_filter, runtime_artifact_run_filter, runtime_sort_by, runtime_group_by, runtime_scope, runtime_session_filter_id]);

  const runtime_artifact_total_pages = Math.max(1, Math.ceil(runtime_artifact_total_count / RUNTIME_ARTIFACT_PAGE_SIZE));
  const runtime_artifact_page_clamped = Math.min(Math.max(0, runtime_artifact_page), runtime_artifact_total_pages - 1);

  useEffect(() => {
    if (runtime_artifact_page !== runtime_artifact_page_clamped) set_runtime_artifact_page(runtime_artifact_page_clamped);
  }, [runtime_artifact_page, runtime_artifact_page_clamped]);

  const runtime_paged_artifacts = useMemo(() => {
    void runtime_artifact_page_clamped;
    return runtime_visible_artifacts;
  }, [runtime_visible_artifacts, runtime_artifact_page_clamped]);

  const runtime_artifact_groups = useMemo(() => {
    const groups: Record<string, RuntimeArtifact[]> = {};
    for (const a of runtime_paged_artifacts) {
      const key = runtime_group_by === "type" ? artifact_display_type_label_for(a, runtime_run_by_id, workflow_label_by_id) : artifact_group_key(a, runtime_group_by);
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    }
    return Object.entries(groups)
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => {
        if (runtime_group_by === "time") {
          const am = parse_iso_ms(a.items[0]?.created_at) ?? 0;
          const bm = parse_iso_ms(b.items[0]?.created_at) ?? 0;
          if (am !== bm) return bm - am;
        }
        return a.key.localeCompare(b.key);
      });
  }, [runtime_paged_artifacts, runtime_group_by, runtime_run_by_id, workflow_label_by_id]);

  const runtime_selected_artifact = useMemo(() => {
    const aid = runtime_selected_artifact_id.trim();
    if (aid) return runtime_paged_artifacts.find((a) => a.artifact_id === aid) || runtime_paged_artifacts[0] || null;
    return runtime_paged_artifacts[0] || null;
  }, [runtime_paged_artifacts, runtime_selected_artifact_id]);

  useEffect(() => {
    if (page !== "runtime" || runtime_tab !== "artifacts") return;
    void load_runtime_embedded_preview(runtime_selected_artifact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, runtime_tab, runtime_selected_artifact?.artifact_id]);

  useEffect(() => {
    return () => {
      if (runtime_embedded_preview.url) URL.revokeObjectURL(runtime_embedded_preview.url);
    };
  }, [runtime_embedded_preview.url]);

  const active_runtime_runs = useMemo(() => runtime_run_rows.filter((r) => active_run_status(r.status)), [runtime_run_rows]);

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
          <span className="logo_name">AbstractObserver</span>
        </div>
        <div className="app_nav">
          <button className={`nav_tab ${page === "board" ? "active" : ""}`} onClick={() => set_page("board")}>
            Board
          </button>
          <button className={`nav_tab ${page === "observe" ? "active" : ""}`} onClick={() => set_page("observe")}>
            Observe
          </button>
          <button className={`nav_tab ${page === "runtime" ? "active" : ""}`} onClick={() => set_page("runtime")}>
            Runtime
          </button>
          <button className={`nav_tab ${page === "launch" ? "active" : ""}`} onClick={() => set_page("launch")}>
            Launch
          </button>
          <button className={`nav_tab ${page === "mindmap" ? "active" : ""}`} onClick={() => set_page("mindmap")}>
            Mindmap
          </button>
          {/* The entity app is its own deployment (abstractentity) — one
              link ends the two-apps-are-mutually-invisible era. */}
          <a className="nav_tab" href={entity_app_url} target="_blank" rel="noreferrer" title="Open the entity app (memory graph + visits)">
            Entities ↗
          </a>
        </div>
        <div className="status_pills">
          {monitor_gpu_enabled ? (
            <monitor-gpu
              ref={monitor_gpu_ref as any}
              mode="icon"
              history-size="5"
              tick-ms="1500"
              base-url={settings.gateway_auth_mode === "session" ? "" : settings.gateway_url}
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
          <button
            className={`header_icon_btn ${page === "settings" ? "active" : ""}`}
            title="Settings"
            aria-label="Settings"
            type="button"
            onClick={() => set_page("settings")}
          >
            <Icon name="settings" size={16} />
          </button>
          {/* The LED is the connection CONTROL with a visible identity —
              console parity: dot + who you are + one click to manage. */}
          <button
            className="gateway_led_btn"
            type="button"
            onClick={() => set_connect_modal_open(true)}
            title={
              gateway_connected
                ? "Gateway connection — click to manage or sign out"
                : discovery_loading
                  ? "Gateway: connecting…"
                  : "Gateway: signed out — click to sign in"
            }
            aria-label="Gateway connection"
          >
            <span className={`gateway_led ${gateway_connected ? "ok" : discovery_loading ? "warn" : "err"}`} aria-hidden="true" />
            <span className="gateway_led_label mono">
              {gateway_connected
                ? connection_status?.gateway?.principal?.user_id || (settings.gateway_auth_mode === "direct" ? "direct dev" : "connected")
                : discovery_loading
                  ? "connecting…"
                  : "sign in"}
            </span>
          </button>
        </div>
      </div>

      <GatewayConnectModal
        isOpen={connect_modal_open}
        onClose={() => set_connect_modal_open(false)}
        appName="AbstractObserver"
        defaultGatewayUrl={
          (typeof window !== "undefined" && window.__ABSTRACT_UI_CONFIG__?.gateway_url) || settings.gateway_url || DEFAULT_GATEWAY_URL
        }
        onStatusChange={handle_connection_status}
      />

      <div className="app-body">
        {page === "board" ? (
          !gateway_connected ? (
            <div className="page page_scroll">
              <div className="page_inner constrained">
                <div className="card mc_hero">
                  <div className="title">
                    <h1>Connect to your gateway</h1>
                  </div>
                  <p className="muted">
                    Mission Control shows every run and entity on one board — but nothing is connected yet.
                    {discovery_error ? ` Last attempt: ${discovery_error}` : ""}
                  </p>
                  <div className="row" style={{ gap: "8px", alignItems: "center" }}>
                    <button className="btn primary" onClick={() => set_connect_modal_open(true)} disabled={discovery_loading}>
                      {discovery_loading ? "Connecting…" : "Sign in"}
                    </button>
                    <button className="btn" onClick={() => void on_discover_gateway({ open_modal_if_needed: true })} disabled={discovery_loading} title="Retry with an existing browser session or a direct dev token">
                      Retry connection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <MissionControlPage
              gateway_connected={gateway_connected}
              runs={run_options}
              all_runs={all_run_options}
              runs_refreshed_at={runs_refreshed_at}
              entities={board_entities}
              entities_total={board_entities_total}
              entities_error={board_entities_error}
              refreshing={runs_loading}
              on_refresh={() => void refresh_runs(gateway, { force: true })}
              on_open_run={(rid) => {
                set_page("observe");
                set_right_tab("overview");
                void attach_to_run(rid);
              }}
              on_resume_wait={board_resume_wait}
              entity_app_href={entity_app_url}
            />
          )
        ) : null}

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
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                    Stored locally in this browser (no server round-trip).
                  </div>
                </div>
                <div className="field">
                  <label>Font size</label>
                  <FontScaleSelect value={settings.font_scale} onChange={(id) => set_settings((s) => ({ ...s, font_scale: id }))} />
                </div>
                <div className="field">
                  <label>Header size</label>
                  <HeaderDensitySelect value={settings.header_density} onChange={(id) => set_settings((s) => ({ ...s, header_density: id }))} />
                </div>

                <div className="section_title">Gateway</div>
                <div className="field">
                  <label>Connection</label>
                  <div className="field_inline">
                    <span className={`mc_pill ${gateway_connected ? "" : "mc_pill_hot"}`}>
                      {gatewayStatusBadge(connection_status).label}
                    </span>
                    <button className="btn primary" onClick={() => set_connect_modal_open(true)}>
                      Manage connection…
                    </button>
                    {gateway_connected ? (
                      <button className="btn" onClick={() => disconnect_gateway()} title="Sign this browser out of the gateway (this app's session only — the entity app signs in on its own deployment)">
                        Sign out
                      </button>
                    ) : null}
                  </div>
                  {discovery_error ? (
                    <div className="mono" style={{ color: "var(--error)", fontSize: "var(--font-size-sm)" }}>
                      {discovery_error}
                    </div>
                  ) : null}
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                    Sign-in is the shared AbstractFramework dialog: a Gateway user token exchanges for an HTTP-only browser
                    session (same flow as AbstractFlow and the gateway console). Raw tokens are never stored.
                  </div>
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
                <details style={{ marginTop: "6px" }}>
                  <summary className="mono muted" style={{ cursor: "pointer" }}>
                    Advanced: direct dev connection (bearer token, cross-origin)
                  </summary>
                  <div className="field" style={{ marginTop: "8px" }}>
                    <label>Gateway URL</label>
                    <input
                      value={settings.gateway_url}
                      onChange={(e) => set_settings((s) => ({ ...s, gateway_url: e.target.value }))}
                      placeholder={DEFAULT_GATEWAY_URL}
                    />
                  </div>
                  <div className="field">
                    <label>Dev bearer token</label>
                    <input
                      type="password"
                      value={settings.auth_token}
                      onChange={(e) => set_settings((s) => ({ ...s, auth_token: e.target.value, gateway_auth_mode: "direct" }))}
                      placeholder="development only — prefer the sign-in dialog"
                    />
                  </div>
                  <button className="btn" onClick={() => void on_discover_gateway({ prefer_direct: true })} disabled={discovery_loading}>
                    {discovery_loading ? "Connecting…" : "Connect directly"}
                  </button>
                </details>

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
                <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                  Used for in-editor maintenance chat. Defaults follow `ABSTRACTGATEWAY_PROVIDER` /
                  `ABSTRACTGATEWAY_MODEL`.
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
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
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

                <div className="launch_workflow_bar">
                  <select
                    className="launch_workflow_select"
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
                    <option value="">{workflow_options.length ? "(select workflow)" : "(connect in Settings)"}</option>
                    {workflow_options.map((w) => (
                      <option key={w.workflow_id} value={w.workflow_id}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <input ref={bundle_upload_input_ref} type="file" accept=".flow" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files.length ? e.target.files[0] : null; if (!f) return; void upload_gateway_bundle(f); }} />
                  <button type="button" className="btn launch_btn_upload" onClick={() => bundle_upload_input_ref.current?.click()} disabled={!gateway_connected || discovery_loading || bundle_uploading || connecting || resuming} title="Upload a .flow bundle">{bundle_uploading ? "…" : "Upload"}</button>
                  <button type="button" className="btn launch_btn_reload" onClick={() => void reload_gateway_bundles()} disabled={!gateway_connected || discovery_loading || bundles_reloading || connecting || resuming} title="Reload picks up server-side edits"><Icon name="refresh" size={14} />{bundles_reloading ? "…" : "Reload"}</button>
                    </div>
                <div className="field">
                  {selected_entrypoint?.description ? (
                    <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                      {String(selected_entrypoint.description)}
                    </div>
                  ) : null}
                  {bundle_loading ? (
                    <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                      Loading workflow…
                    </div>
                  ) : null}
	                  {bundle_error ? (
	                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)" }}>
	                      {bundle_error}
	                    </div>
	                  ) : null}
	                </div>

                <div className="section_divider" />
                <div className="section_title">Inputs</div>

                  {!bundle_id.trim() || !flow_id.trim() ? (
                    <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
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
                    <div className="launch_inputs">
                      {(() => {
                        const disabled = connecting || resuming;
                        const wide_pins: typeof adaptive_pins = [];
                        const compact_pins: typeof adaptive_pins = [];

                        for (const p of adaptive_pins) {
                          if (!p || typeof p !== "object") continue;
                          const pid = String((p as any).id || "").trim();
                          if (!pid) continue;
                          const ptype = String((p as any).type || "").trim().toLowerCase();
                          const is_wide = ptype === "tools" || ptype === "array" || is_json_pin_type(ptype) || pid === "prompt" || pid === "system";
                          if (is_wide) wide_pins.push(p);
                          else compact_pins.push(p);
                        }

                        const humanize = (id: string): string => String(id || "").trim().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

                        const render_pin = (p: BundlePinDef, grid_class?: string) => {
                        const pid = String((p as any).id || "").trim();
                        if (!pid) return null;
                        const raw_label = String((p as any).label || pid).trim() || pid;
                        const display_label = raw_label === pid ? humanize(pid) : raw_label;
                        const ptype = String((p as any).type || "").trim().toLowerCase();
                        const has_default = Object.prototype.hasOwnProperty.call(p, "default");
                        const default_val = has_default ? (p as any).default : undefined;
                        const default_s = has_default ? safe_json_inline(default_val, 80) : "";
                        const cur = (input_data_obj as any)?.[pid];
                        const placeholder_default = has_default ? `${default_s}` : "";

                        if (ptype === "tools") {
                          const selected = Array.isArray(cur) ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
                          const default_tools = Array.isArray(default_val) ? (default_val as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
                          const merged_options = Array.from(new Set([...available_tool_names, ...selected, ...default_tools])).sort();
                          return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><MultiSelect options={merged_options} value={selected} disabled={disabled} placeholder="(no tools selected)" onChange={(next) => update_input_data_field(pid, next)} /></div>);
                        }
                        if (ptype === "provider" || ptype === "provider_text") {
                          const sel = typeof cur === "string" ? String(cur) : "";
                          return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label><select value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} disabled={disabled}><option value="">{placeholder_default || "(select)"}</option>{available_providers.map((p) => (<option key={p} value={p}>{p}</option>))}</select></div>);
                        }
                        if (ptype === "model" || ptype === "model_text") {
                          const sel = typeof cur === "string" ? String(cur) : "";
                          const prov = String((input_data_obj as any)?.provider || "").trim();
                          const found = prov ? discovered_models_by_provider[prov] : undefined;
                          const models = found && Array.isArray(found.models) ? found.models.map((x) => String(x || "").trim()).filter(Boolean) : [];
                          return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label>{models.length ? (<select value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} disabled={disabled}><option value="">{placeholder_default || "(select)"}</option>{models.map((m) => (<option key={m} value={m}>{m}</option>))}</select>) : (<input className="mono" value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} placeholder={placeholder_default || "model id"} disabled={disabled} />)}</div>);
                        }
                        if (ptype === "boolean") {
                          const sel = typeof cur === "boolean" ? (cur ? "true" : "false") : "";
                          return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label><select value={sel} onChange={(e) => { const v = String(e.target.value || "").trim(); if (!v) update_input_data_field(pid, undefined); else update_input_data_field(pid, v === "true"); }} disabled={disabled}><option value="">{placeholder_default || "(default)"}</option><option value="true">Yes</option><option value="false">No</option></select></div>);
                        }
                        if (ptype === "number") {
                          const sel = typeof cur === "number" && Number.isFinite(cur) ? String(cur) : "";
                          return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label><input type="number" value={sel} onChange={(e) => { const raw = String(e.target.value || "").trim(); if (!raw) { update_input_data_field(pid, undefined); return; } const n = Number(raw); if (Number.isFinite(n)) update_input_data_field(pid, n); }} placeholder={placeholder_default} disabled={disabled} /></div>);
                        }
                        if (ptype === "array") {
                          const sel = Array.isArray(cur) ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean).join("\n") : "";
                          return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><textarea className="mono" value={sel} onChange={(e) => { const lines = String(e.target.value || "").split(/\r?\n/g).map((x) => String(x || "").trim()).filter(Boolean); update_input_data_field(pid, lines.length ? lines : undefined); }} placeholder={placeholder_default || "(one item per line)"} rows={2} disabled={disabled} /></div>);
                        }
                        if (is_json_pin_type(ptype)) {
                          const val = typeof pin_json_text_by_id[pid] === "string" ? pin_json_text_by_id[pid] : "";
                          const err = String(pin_json_error_by_id[pid] || "").trim();
                          return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label} <span className="launch_label_type">{ptype}</span></label><textarea className="mono" value={val} onChange={(e) => { const next = String(e.target.value ?? ""); set_pin_json_text_by_id((prev) => ({ ...prev, [pid]: next })); const trimmed = next.trim(); if (!trimmed) { set_pin_json_error_by_id((prev) => { const out = { ...prev }; delete out[pid]; return out; }); update_input_data_field(pid, undefined); return; } try { const parsed = JSON.parse(trimmed); set_pin_json_error_by_id((prev) => { const out = { ...prev }; delete out[pid]; return out; }); update_input_data_field(pid, parsed); } catch (e: any) { set_pin_json_error_by_id((prev) => ({ ...prev, [pid]: String(e?.message || e || "Invalid JSON") })); } }} placeholder={placeholder_default || "{...}"} rows={3} disabled={disabled} />{err ? <div className="launch_field_error">{err}</div> : null}</div>);
                        }
                        /* Default: string */
                        const sel = typeof cur === "string" ? String(cur) : "";
                        const is_textarea = pid === "prompt" || pid === "system";
                        if (is_textarea) return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><textarea className="mono" value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} placeholder={placeholder_default || (pid === "prompt" ? "What should the agent do?" : "System instructions (optional)")} rows={3} disabled={disabled} /></div>);
                        return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label><input className="mono" value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} placeholder={placeholder_default} disabled={disabled} /></div>);
                        };

                        wide_pins.sort((a, b) => { const order: Record<string, number> = { system: 0, prompt: 1, tools: 2 }; return (order[String((a as any).id || "")] ?? 10) - (order[String((b as any).id || "")] ?? 10); });

                        return (<>{wide_pins.map((p) => render_pin(p))}{compact_pins.length > 0 ? (<div className="launch_grid">{compact_pins.map((p) => render_pin(p, "launch_grid_cell"))}</div>) : null}</>);
                      })()}
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

                  {/* Advanced JSON + session_id removed: raw JSON is an implementation
                      detail (form fields are the source of truth), and session_id is
                      auto-generated — no user-facing reason to expose either. */}

                  <details style={{ marginTop: "10px" }}>
                    <summary className="mono muted" style={{ cursor: "pointer" }}>
                      Workspace
                    </summary>
                    <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                      Controls what the agent can access via filesystem tools.
                    </div>

                    <div className="launch_grid" style={{ marginTop: "8px" }}>
                      <div className="launch_grid_cell" style={{ gridColumn: "1 / -1" }}>
                        <label className="launch_label">Workspace Root</label>
                        <input className="mono" value={workspace_root_value} onChange={(e) => update_input_data_field("workspace_root", e.target.value)} placeholder="/path/to/workspace" disabled={connecting || resuming} />
                        <div className="mono muted" style={{ fontSize: "var(--font-size-xxs)" }}>Empty = gateway default (isolated per-run workspace)</div>
                      </div>
                      <div className="launch_grid_cell">
                        <label className="launch_label">Access Mode</label>
                        <select className="mono" value={(workspace_access_mode_value || "workspace_only").trim() || "workspace_only"} onChange={(e) => update_input_data_field("workspace_access_mode", e.target.value)} disabled={connecting || resuming}>
                          <option value="workspace_only">workspace_only</option>
                          <option value="workspace_or_allowed">workspace_or_allowed</option>
                          <option value="all_except_ignored">all_except_ignored</option>
                      </select>
                        <div className="mono muted" style={{ fontSize: "var(--font-size-xxs)" }}>workspace_only: absolute paths must stay under root. workspace_or_allowed: allow additional roots.</div>
                      </div>
                    </div>

                    {(workspace_access_mode_value || "").trim() === "workspace_or_allowed" ? (
                      <div className="field" style={{ marginTop: "8px" }}>
                        <label className="launch_label">Allowed Paths</label>
                        <textarea className="mono" rows={3} value={workspace_allowed_paths_value} onChange={(e) => update_input_data_field("workspace_allowed_paths", e.target.value)} placeholder={"/path/to/project\n/path/to/workspace"} disabled={connecting || resuming} spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
                        <div className="mono muted" style={{ fontSize: "var(--font-size-xxs)" }}>Newline-separated directories (absolute or relative to workspace_root)</div>
                      </div>
                    ) : null}

                    <div className="field" style={{ marginTop: "8px" }}>
                      <label className="launch_label">Ignored Paths</label>
                      <textarea className="mono" rows={3} value={workspace_ignored_paths_value} onChange={(e) => update_input_data_field("workspace_ignored_paths", e.target.value)} placeholder={"node_modules\nruntime\nsecret"} disabled={connecting || resuming} spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
                      <div className="mono muted" style={{ fontSize: "var(--font-size-xxs)" }}>Newline-separated paths to block (absolute or relative to workspace_root)</div>
	                    </div>
	                  </details>

                <div className="section_divider" />
                <div className="section_title">Schedule</div>

                    {schedule_error ? (
                  <div className="observe_context_card error" style={{ marginTop: "6px" }}>
                    <span className="chip mono danger">error</span>
                    <span className="mono">{schedule_error}</span>
                      </div>
                    ) : null}

                <div className="sched_grid">
                  <div className="sched_cell">
                    <label className="launch_label">Start</label>
                    <div className="sched_radio_row">
                      <label className="sched_radio"><input type="radio" name="schedule_start" checked={schedule_start_mode === "now"} onChange={() => set_schedule_start_mode("now")} /><span>Now</span></label>
                      <label className="sched_radio"><input type="radio" name="schedule_start" checked={schedule_start_mode === "at"} onChange={() => set_schedule_start_mode("at")} /><span>Scheduled</span></label>
                      </div>
                    {schedule_start_mode === "at" ? (<input type="datetime-local" value={schedule_start_at_local} onChange={(e) => set_schedule_start_at_local(e.target.value)} style={{ marginTop: "6px" }} />) : null}
                        </div>
                  <div className="sched_cell">
                    <label className="launch_label">Cadence</label>
                      <select value={schedule_repeat_mode} onChange={(e) => set_schedule_repeat_mode(e.target.value as any)}>
                      <option value="once">Run once</option>
                      <option value="forever">Repeat forever</option>
                      <option value="count">Repeat N times</option>
                      <option value="until">Repeat until date</option>
                      </select>
                    </div>
                    {schedule_repeat_mode !== "once" ? (
                    <div className="sched_cell">
                      <label className="launch_label">Every</label>
                      <div className="sched_inline">
                        <input type="number" min={1} value={String(schedule_every_n)} onChange={(e) => set_schedule_every_n(Math.max(1, parseInt(e.target.value || "1", 10) || 1))} style={{ width: "70px" }} />
                              <select value={schedule_every_unit} onChange={(e) => set_schedule_every_unit(e.target.value as any)}>
                          <option value="minutes">min</option><option value="hours">hours</option><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option>
                              </select>
                            </div>
                          </div>
                        ) : null}
                    {schedule_repeat_mode === "count" ? (
                    <div className="sched_cell"><label className="launch_label">Total runs</label><input type="number" min={1} value={String(schedule_repeat_count)} onChange={(e) => set_schedule_repeat_count(Math.max(1, parseInt(e.target.value || "1", 10) || 1))} style={{ width: "100px" }} /></div>
                    ) : null}
                    {schedule_repeat_mode === "until" ? (
                    <div className="sched_cell"><label className="launch_label">End date</label><div className="sched_inline"><input type="date" value={schedule_repeat_until_date_local} onChange={(e) => set_schedule_repeat_until_date_local(e.target.value)} /><input type="time" value={schedule_repeat_until_time_local} onChange={(e) => set_schedule_repeat_until_time_local(e.target.value)} /></div></div>
                    ) : null}
                </div>
                <label className="launch_checkbox" style={{ marginTop: "8px" }}>
                        <input type="checkbox" checked={schedule_share_context} onChange={(e) => set_schedule_share_context(Boolean(e.target.checked))} />
                  <span>Share context across executions <span className="mono muted" style={{ fontSize: "var(--font-size-xxs)", fontWeight: 400 }}>(when disabled, each run gets its own isolated session)</span></span>
                      </label>

                {/* ── Launch button ── */}
                <div className="section_divider" />
                {new_run_error ? (
                  <div className="observe_context_card error" style={{ marginBottom: "10px" }}>
                    <span className="chip mono danger">error</span>
                    <span className="mono">{new_run_error}</span>
                    </div>
                ) : null}
                <div className="launch_actions_bar">
                  <button className="launch_submit_btn" onClick={() => void submit_launch()} disabled={connecting || resuming || discovery_loading || bundle_loading || schedule_submitting || !gateway_connected || !bundle_id.trim() || !flow_id.trim() || input_data_obj === null}>
                    {schedule_start_mode !== "now" || schedule_repeat_mode !== "once" ? "Launch (scheduled)" : "Launch now"}
                  </button>
                </div>
              </div>
            </div>
          </div>
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
                    Not connected.{" "}
                    <button className="btn primary" onClick={() => set_connect_modal_open(true)}>
                      Sign in
                    </button>{" "}
                    to watch this gateway.
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

        {page === "runtime" ? (
          <RuntimeExplorerPage
            gateway_connected={gateway_connected}
            tab={runtime_tab}
            runs={runtime_run_rows}
            active_runs={active_runtime_runs}
            all_artifacts={runtime_artifacts}
            artifacts={runtime_paged_artifacts}
            artifact_total_count={runtime_artifact_total_count}
            artifact_total_bytes={runtime_artifact_total_bytes}
            artifact_facets={runtime_artifact_facets}
            artifact_type_facets={runtime_artifact_type_facets}
            artifact_page={runtime_artifact_page_clamped}
            artifact_page_size={RUNTIME_ARTIFACT_PAGE_SIZE}
            artifact_groups={runtime_artifact_groups}
            selected_artifact={runtime_selected_artifact}
            embedded_preview={runtime_embedded_preview}
            loading={runtime_artifacts_loading}
            error={runtime_artifacts_error}
            query={runtime_query}
            scope={runtime_scope}
            type_filters={runtime_type_filters}
            date_filter={runtime_date_filter}
            group_by={runtime_group_by}
            sort_by={runtime_sort_by}
            artifact_run_filter={runtime_artifact_run_filter}
            audit_log_text={audit_log_text}
            audit_log_meta={audit_log_meta}
            audit_log_loading={audit_log_loading}
            audit_log_error={audit_log_error}
            workflow_label_by_id={workflow_label_by_id}
            run_by_id={runtime_run_by_id}
            selected_run_id={runtime_context_run_id}
            session_id={runtime_context_session_id}
            runtime_log_source={runtime_log_source}
            runtime_log_query={runtime_log_query}
            runtime_ledger_log_items={runtime_ledger_log_items}
            runtime_ledger_log_meta={runtime_ledger_log_meta}
            runtime_ledger_log_loading={runtime_ledger_log_loading}
            runtime_ledger_log_error={runtime_ledger_log_error}
            on_tab_change={set_runtime_tab}
            on_query_change={set_runtime_query}
            on_scope_change={set_runtime_scope}
            on_session_filter_change={set_runtime_session_filter_id}
            on_type_filters_change={set_runtime_type_filters}
            on_date_filter_change={set_runtime_date_filter}
            on_group_by_change={set_runtime_group_by}
            on_sort_by_change={set_runtime_sort_by}
            on_artifact_page_change={set_runtime_artifact_page}
            on_artifact_run_filter_change={(rid) => {
              const next = String(rid || "").trim();
              set_runtime_artifact_run_filter(next);
              if (next) set_runtime_selected_run_id(next);
              if (next && runtime_scope !== "run") set_runtime_scope("run");
            }}
            on_refresh_artifacts={() => void refresh_runtime_artifacts()}
            on_refresh_audit={() => void refresh_audit_log()}
            on_refresh_runtime_ledger={(rid) => void refresh_runtime_ledger_log(rid)}
            on_runtime_log_source_change={set_runtime_log_source}
            on_runtime_log_query_change={set_runtime_log_query}
            on_select_run={(rid) => {
              const next = String(rid || "").trim();
              set_runtime_selected_run_id(next);
              const r = next ? runtime_run_by_id[next] || null : null;
              const sid = String(r?.session_id || "").trim();
              if (sid) set_runtime_session_filter_id(sid);
            }}
            on_select_artifact={set_runtime_selected_artifact_id}
            on_preview_artifact={(a) => void preview_runtime_artifact(a)}
            on_download_artifact={(a) => void download_runtime_artifact(a)}
            on_open_run={(rid) => {
              set_runtime_selected_run_id(String(rid || "").trim());
              set_page("observe");
              set_right_tab("overview");
              void attach_to_run(rid);
            }}
            on_open_ledger={(rid) => {
              set_runtime_selected_run_id(String(rid || "").trim());
              set_page("observe");
              set_right_tab("ledger");
              void attach_to_run(rid);
            }}
            on_refresh_runs={() => void refresh_runs(gateway, { force: true })}
            on_reconnect={() => void on_discover_gateway({ open_modal_if_needed: true })}
            on_open_settings={() => set_page("settings")}
          />
        ) : null}

        {page === "observe" ? (
          <div className="page observe_page">
            <div className="observatory_layout">
              <WorkflowRunNavigator
                sections={observe_sections}
                selected_run_id={run_id}
                root_run_id={root_run_id}
                search={observe_search}
                filter={observe_filter}
                group_by={observe_group_by}
                loading={runs_loading}
                total_runs={runtime_run_rows.length}
                workflow_label_by_id={workflow_label_by_id}
                on_search={set_observe_search}
                on_filter={set_observe_filter}
                on_group_by={set_observe_group_by}
                on_refresh={() => void refresh_runs()}
                on_select={(rid, root) => void attach_to_run(rid, { root_run_id: root || rid })}
              />
              <div className="observatory_main">
            {/* ── Observe toolbar: run picker + controls ── */}
            <div className="observe_toolbar">
              <div className="observe_toolbar_row">
                    <RunPicker
                      runs={run_options}
                      selected_run_id={run_id}
                      workflow_label_by_id={workflow_label_by_id}
                      disabled={!gateway_connected || runs_loading || discovery_loading || connecting || resuming}
                      loading={runs_loading}
                      onSelect={(rid) => void attach_to_run(rid)}
                    />
                <button className="btn btn_icon" onClick={() => void refresh_runs()} disabled={!gateway_connected || runs_loading || discovery_loading} title="Refresh runs">
                  <Icon name="refresh" size={14} />
                  {runs_loading ? "…" : "Refresh"}
                    </button>
                <button className="btn btn_icon" onClick={clear_run_view} disabled={!run_id.trim() && !connected} title="Disconnect from run">
                  <Icon name="x" size={14} />
                      Disconnect
                    </button>

                <span className="observe_toolbar_sep" />

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
	                </div>

              {/* STEERING (uic kit c1239, hooks P3): mid-run guidance via the
                * durable inject_guidance command. Status truth stays honest —
                * "Queued (seq N)" from the composer; DELIVERY is the ledger's
                * own abstract.steer_seen line. The submit override rides
                * gateway.submit_command so session (proxy+CSRF) and direct
                * (bearer) postures both work. */}
              {run_id.trim() && !run_terminal ? (
                <div className="observe_steer_row">
                  <SteerComposer
                    runId={run_id.trim()}
                    parked={is_waiting}
                    submit={(rid, guidance) =>
                      gateway
                        .submit_command({
                          command_id: `steer-${random_id()}`,
                          run_id: rid,
                          type: "inject_guidance",
                          payload: { guidance },
                          client_id: "web_pwa",
                        })
                        .then((r: any) => ({
                          accepted: Boolean(r?.accepted),
                          duplicate: Boolean(r?.duplicate),
                          seq: Number(r?.seq ?? 0),
                        }))
                    }
                    onSent={() =>
                      push_log({
                        ts: now_iso(),
                        kind: "info",
                        title: "Steer queued",
                        preview: "inject_guidance submitted — delivery shows as abstract.steer_seen in the ledger",
                      })
                    }
                  />
                </div>
              ) : null}

              {/* Contextual info: waiting / schedule / error — shown inline when relevant */}
              {(is_waiting || is_scheduled_run || error_text) ? (
                <div className="observe_toolbar_context">
                {is_waiting ? (
                    <div className="observe_context_card info">
                      <div className="observe_context_label">
                        <span className="chip mono info">{is_scheduled_run ? (run_paused ? "suspended" : "scheduled") : "waiting"}</span>
                        <span className="mono muted">{wait_reason || "unknown"}</span>
	                    </div>
                      <div className="observe_context_body">
                        {wait_key ? (<span className="mono" title={wait_key}><span className="muted">wait_key</span>: {short_id(wait_key, 46)}</span>) : null}
                        {wait_reason === "event" && wait_event_name ? (<span className="mono"><span className="muted">event</span>: {wait_event_name}</span>) : null}
                        {wait_reason === "subworkflow" && sub_run_id ? (<span className="mono"><span className="muted">child</span>: {short_id(sub_run_id, 18)}</span>) : null}
                        {wait_reason === "until" && wait_until ? (<span className="mono" title={wait_until}><span className="muted">until</span>: {short_id(wait_until, 46)}</span>) : null}
                      {wait_reason === "until" && wait_until ? (
                          <span className="mono muted">
                        {(() => {
                          const ms = parse_iso_ms(wait_until);
                          const at = ms !== null ? new Date(ms).toLocaleString() : wait_until;
                          const in_ = ms !== null ? format_time_until_from_ms(ms - Date.now()) : "";
                              return `Next at ${at}${in_ ? ` (in ${in_})` : ""}`;
                        })()}
                          </span>
                    ) : null}
                      </div>
                    {wait_reason === "subworkflow" && sub_run_id ? (
                        <div className="observe_context_actions">
                          <button className="btn primary" onClick={async () => { set_run_id(sub_run_id); await connect_to_run(sub_run_id); }} disabled={connecting}>Attach to child</button>
                        {root_run_id.trim() && root_run_id.trim() !== run_id.trim() ? (
                            <button className="btn" onClick={async () => { set_run_id(root_run_id.trim()); await connect_to_run(root_run_id.trim()); }} disabled={connecting}>Back to root</button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {is_scheduled_run ? (
                    <div className="observe_context_card muted">
                      <div className="observe_context_label">
                        <span className="chip mono muted">schedule</span>
                        <span className="mono muted">{is_scheduled_recurrent ? `every ${schedule_interval}` : "once"}</span>
                    </div>
                      <div className="observe_context_body">
                        {schedule_interval ? (<span className="mono"><span className="muted">interval</span>: {schedule_interval}</span>) : null}
                        <span className="mono"><span className="muted">share ctx</span>: {schedule_share_ctx ? "yes" : "no"}</span>
                        {typeof schedule_meta_repeat_count === "number" ? (<span className="mono"><span className="muted">repeats</span>: {schedule_meta_repeat_count}</span>) : null}
                    </div>
                    {limits_pct !== null ? (
                        <div className="observe_context_budget">
                          <span className="mono muted">{typeof limits_used === "number" && typeof limits_budget === "number" ? `${limits_used.toLocaleString()} / ${limits_budget.toLocaleString()}` : ""}{` • ${Math.round(Math.max(0, Math.min(1, limits_pct)) * 100)}%`}</span>
                          <div className="observe_budget_bar"><div className="observe_budget_fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, limits_pct)) * 100)}%`, background: limits_pct >= 0.9 ? "rgba(239, 68, 68, 0.9)" : limits_pct >= 0.75 ? "rgba(245, 158, 11, 0.9)" : "rgba(34, 197, 94, 0.9)" }} /></div>
                          </div>
                        ) : null}
                      <div className="observe_context_actions">
                        {is_scheduled_recurrent ? (<button className="btn" onClick={() => { set_schedule_edit_interval(schedule_interval || ""); set_schedule_edit_apply_immediately(true); set_schedule_edit_error(""); set_schedule_edit_open(true); }} disabled={connecting || schedule_edit_submitting}>Edit schedule</button>) : null}
                        {is_scheduled_recurrent ? (<button className="btn" onClick={() => { set_compact_error(""); set_compact_open(true); }} disabled={connecting || compact_submitting}>Compact context</button>) : null}
                    </div>
                  </div>
                ) : null}

                  {error_text ? (
                    <div className="observe_context_card error">
                      <span className="chip mono danger">error</span>
                      <span className="mono">{error_text}</span>
                      </div>
                ) : null}
                  </div>
                ) : null}
              </div>

            {/* ── Single full-width content panel ── */}
            <div className="card panel_card card_scroll observe_viewer observe_viewer_full">
              {/* Content tabs + inline contextual controls */}
                <div className="tab_bar" style={{ justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <button className={`tab mono ${right_tab === "overview" ? "active" : ""}`} onClick={() => set_right_tab("overview")}>
                    Overview
                  </button>
                  <button className={`tab mono ${right_tab === "timeline" ? "active" : ""}`} onClick={() => set_right_tab("timeline")}>
                    Timeline
                  </button>
                  <button className={`tab mono ${right_tab === "replay" ? "active" : ""}`} onClick={() => set_right_tab("replay")}>
                    Replay
                  </button>
                  <button className={`tab mono ${right_tab === "ledger" ? "active" : ""}`} onClick={() => set_right_tab("ledger")}>
                    Ledger
                  </button>
                  <button className={`tab mono ${right_tab === "providers" ? "active" : ""}`} onClick={() => set_right_tab("providers")}>
                    Providers
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

                  {/* Ledger inline controls — only shown when ledger tab is active AND there is data */}
                  {right_tab === "ledger" && (visible_log.length > 0 || ledger_view === "cycles") ? (
                    <div className="tab_bar_controls">
                      <div className="seg_toggle mono">
                        <button className={`seg_btn ${ledger_view === "steps" ? "active" : ""}`} onClick={() => set_ledger_view("steps")}>Steps</button>
                        <button className={`seg_btn ${ledger_view === "cycles" ? "active" : ""}`} onClick={() => set_ledger_view("cycles")}>Cycles</button>
	                  </div>
                      {ledger_view === "steps" ? (
                        <button className={`seg_action mono ${ledger_condensed ? "active" : ""}`} onClick={() => set_ledger_condensed((v) => !v)} title={ledger_condensed ? "Showing condensed view" : "Showing all steps"}>
                          {ledger_condensed ? "Condensed" : "All"}
                        </button>
                      ) : (
                          <select
                          className="mono seg_select"
                            value={cycles_run_id}
                            onChange={(e) => set_ledger_cycles_run_id(String(e.target.value || ""))}
                            disabled={!cycles_run_options.length}
                          title="Select run for cycles view"
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
                      )}
                      <button
                        className="seg_action mono"
                        disabled={!records.length && !child_records_for_digest.length}
                        title="Copy full ledger as JSONL"
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
                        Copy JSONL
                      </button>
                    </div>
                  ) : null}

                  {/* Graph inline controls — only shown when graph tab is active */}
                  {right_tab === "graph" ? (
                    <div className="tab_bar_controls">
                      <button className={`seg_action mono ${graph_show_subflows ? "active" : ""}`} onClick={() => set_graph_show_subflows((v) => !v)}>
                        Subflows
                      </button>
                      <button className={`seg_action mono ${graph_highlight_path ? "active" : ""}`} onClick={() => set_graph_highlight_path((v) => !v)}>
                        Path
                      </button>
                      {graph_flow_options.length ? (
                        <select
                          className="mono seg_select"
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
                    </div>
                  ) : null}

                  {/* Digest inline controls — only shown when digest tab is active and has data */}
                  {right_tab === "digest" && digest?.overall?.stats?.steps ? (
                    <div className="tab_bar_controls">
                      <button
                        className="seg_action mono"
                        onClick={() => { copy_to_clipboard(JSON.stringify(digest, null, 2)); }}
                        disabled={!digest?.overall?.stats?.steps}
                      >
                        Copy JSON
                      </button>
                    </div>
                  ) : null}
                </div>

                {right_tab === "overview" ? (
                  <RunOverviewPanel
                    run_id={run_id}
                    run={selected_run_summary}
                    run_state={run_state}
                    status_label={selected_run_status_label || selected_run_status_raw || "unknown"}
                    workflow_label_by_id={workflow_label_by_id}
                    root_run_id={root_run_id}
                    subrun_ids={subrun_ids}
                    session_id={session_id_for_run}
                    records_count={records.length}
                    child_records_count={child_records_for_digest.length}
                    provider_activities={provider_activities}
                    attachments_count={session_attachments.length}
                    latest_summary={latest_run_summary}
                    wait_state={wait_state}
                    summary_generating={summary_generating}
                    summary_error={summary_error}
                    on_generate_summary={() => void generate_summary()}
                    on_open_runtime={() => set_page("runtime")}
                    on_open_subrun={(rid) => void attach_to_run(rid, { root_run_id: root_run_id || run_id || rid })}
                  />
                ) : null}

                {right_tab === "timeline" ? (
                  <HumanTimelinePanel
                    items={timeline_items}
                    node_index={node_index_for_run}
                    workflow_label_by_id={workflow_label_by_id}
                    on_copy={(text) => void copy_to_clipboard(text)}
                  />
                ) : null}

                {right_tab === "replay" ? (
                  <ReplayWorkbenchPanel
                    bundle={replay_bundle_run_id === run_id.trim() ? replay_bundle : null}
                    loading={replay_loading}
                    error={replay_error}
                    run_id={run_id.trim()}
                    load_artifact_preview={fetch_runtime_embedded_preview}
                    on_download_artifact={(artifact) => void download_runtime_artifact(artifact)}
                    on_open_artifact_explorer={(artifact) => {
                      const artifact_run_id = String(artifact?.run_id || run_id || "").trim();
                      set_runtime_tab("artifacts");
                      if (artifact_run_id) {
                        set_runtime_artifact_run_filter(artifact_run_id);
                        set_runtime_selected_run_id(artifact_run_id);
                        set_runtime_scope("run");
                      }
                      if (artifact?.artifact_id) set_runtime_selected_artifact_id(artifact.artifact_id);
                      set_page("runtime");
                    }}
                    on_refresh={() => void refresh_replay_bundle(true)}
                    on_open_ledger={() => set_right_tab("ledger")}
                    on_open_chat={() => {
                      set_right_tab("chat");
                      set_chat_input("Explain this run using the replay bundle, session turns, ledger timeline, provider activity, and produced artifacts.");
                    }}
                    on_copy={(text) => void copy_to_clipboard(text)}
                  />
                ) : null}

                {right_tab === "providers" ? (
                  <ProviderActivityPanel
                    activities={provider_activities}
                    audit_log_text={audit_log_text}
                    audit_log_meta={audit_log_meta}
                    audit_log_loading={audit_log_loading}
                    audit_log_error={audit_log_error}
                    on_refresh_audit={() => void refresh_audit_log()}
                    on_copy={(text) => void copy_to_clipboard(text)}
                  />
                ) : null}

                {right_tab === "ledger" ? (
                  <>
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
                            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginBottom: "8px" }}>
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
                        <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
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
                              <SharedJsonViewer value={digest as any} collapseAfterDepth={3} showCopy={true} />
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
                        <span className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
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
                          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginBottom: "8px" }}>
                            Loading…
                          </div>
                        ) : null}
                        {attachment_preview_error ? (
                          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginBottom: "8px" }}>
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
                    <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginBottom: "6px" }}>
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
                    {chat_voice_error ? (
                      <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
                        <div className="meta">
                          <span className="mono">voice</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{chat_voice_error}</div>
                      </div>
                    ) : null}

                    <div className="chat_messages" style={{ marginTop: "10px" }}>
                      <ChatThread
                        messages={chat_messages}
                        className="log_scroll"
                        messageProps={
                          chat_voice.tts_supported && gateway_connected && Boolean(chat_voice_run_id.trim())
                            ? {
                                onSpeakToggle: toggle_chat_tts,
                                getSpeakState: chat_tts_state_for,
                                jsonCollapseAfterDepth: 4,
                              }
                            : { jsonCollapseAfterDepth: 4 }
                        }
                        empty={<div className="chat_empty_hint">Ask about this run (why failed, which tools, what happened in subflows).</div>}
                      />
                    </div>

                    <div className="chat_composer" style={{ marginTop: "10px" }}>
                      <ChatComposer
                        ref={chat_input_ref}
                        value={chat_input}
                        onChange={set_chat_input}
                        onSubmit={() => void send_chat_message()}
                        placeholder="Ask about this run…"
                        disabled={!run_id.trim() || !gateway_connected || chat_sending}
                        busy={chat_sending || chat_voice.voice_ptt_busy}
                        busyLabel={chat_voice.voice_ptt_busy ? "Transcribing…" : "Thinking…"}
                        rows={3}
                        sendButtonClassName="btn primary"
                        actions={
                          <button
                            className={`btn btn_icon voice_btn${chat_voice.voice_ptt_recording ? " danger" : ""}`}
                            type="button"
                            disabled={
                              !gateway_connected ||
                              !chat_voice_session_id.trim() ||
                              !chat_voice_run_id.trim() ||
                              chat_sending ||
                              chat_voice.voice_ptt_busy ||
                              !chat_voice.voice_ptt_supported
                            }
                            title={
                              !chat_voice.voice_ptt_supported
                                ? "Voice recording is not supported in this browser"
                                : chat_voice.voice_ptt_busy
                                  ? "Transcribing…"
                                  : chat_voice.voice_ptt_recording
                                    ? "Recording… release to transcribe"
                                    : "Hold to talk (record + transcribe)"
                            }
                            aria-label="Voice input"
                            onPointerDown={(e) => {
                              if (
                                !gateway_connected ||
                                !chat_voice_session_id.trim() ||
                                !chat_voice_run_id.trim() ||
                                chat_sending ||
                                chat_voice.voice_ptt_busy ||
                                !chat_voice.voice_ptt_supported
                              )
                                return;
                              e.preventDefault();
                              try {
                                (e.currentTarget as any)?.setPointerCapture?.(e.pointerId);
                              } catch {
                                // ignore
                              }
                              void chat_voice.start_voice_ptt_recording();
                            }}
                            onPointerUp={(e) => {
                              e.preventDefault();
                              chat_voice.stop_voice_ptt_recording();
                            }}
                            onPointerCancel={(e) => {
                              e.preventDefault();
                              chat_voice.stop_voice_ptt_recording();
                            }}
                          >
                            <Icon name={chat_voice.voice_ptt_recording ? "x" : "mic"} size={16} />
                            {chat_voice.voice_ptt_busy ? "Transcribing…" : chat_voice.voice_ptt_recording ? "Recording…" : "Voice"}
                          </button>
                        }
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
          </div>
        ) : null}

        <Modal
          open={runtime_preview_open}
          title={runtime_preview_title || "Artifact"}
          onClose={() => {
            set_runtime_preview_open(false);
            set_runtime_preview_text("");
            set_runtime_preview_error("");
            set_runtime_preview_loading(false);
            set_runtime_preview_artifact(null);
            if (runtime_preview_url) {
              URL.revokeObjectURL(runtime_preview_url);
              set_runtime_preview_url("");
            }
          }}
          actions={
            <button
              className="btn"
              onClick={() => {
                set_runtime_preview_open(false);
                set_runtime_preview_text("");
                set_runtime_preview_error("");
                set_runtime_preview_loading(false);
                set_runtime_preview_artifact(null);
                if (runtime_preview_url) {
                  URL.revokeObjectURL(runtime_preview_url);
                  set_runtime_preview_url("");
                }
              }}
            >
              Close
            </button>
          }
        >
          {runtime_preview_loading ? (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginBottom: "8px" }}>
              Loading…
            </div>
          ) : null}
          {runtime_preview_error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginBottom: "8px" }}>
              {runtime_preview_error}
            </div>
          ) : null}
          {runtime_preview_kind === "image" && runtime_preview_url ? (
            <img className="runtime_preview_media" src={runtime_preview_url} alt={runtime_preview_title || "Artifact preview"} />
          ) : runtime_preview_kind === "audio" && runtime_preview_url ? (
            <audio className="runtime_preview_media" controls src={runtime_preview_url} />
          ) : runtime_preview_kind === "video" && runtime_preview_url ? (
            <video className="runtime_preview_media" controls src={runtime_preview_url} />
          ) : (
            <RuntimeStructuredTextPreview artifact={runtime_preview_artifact} text={runtime_preview_text || "(empty)"} className="runtime_preview_text" />
          )}
        </Modal>

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
              <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
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
          <Modal
            open={show_wait_modal}
            title={wait_blocker}
            onClose={() => {
              if (wait_key) set_dismissed_wait_key(wait_key);
            }}
            actions={
              <>
                <button
                  className="btn"
                  onClick={() => {
                    set_right_tab("ledger");
                    set_page("observe");
                  }}
                  disabled={!run_id.trim()}
                >
                  Open ledger
                </button>
                <button className="btn" onClick={() => wait_key && set_dismissed_wait_key(wait_key)} disabled={resuming}>
                  Dismiss
                </button>
                <button className="btn danger" onClick={() => void cancel_visible_run(run_id.trim(), "Cancelled from wait prompt")} disabled={!run_id.trim() || resuming}>
                  Cancel run
                </button>
              </>
            }
          >
            <div className="wait_context_panel">
              <div className="wait_context_header">
                <div>
                  <div className="run_hero_eyebrow">What you need to do</div>
                  <strong>{wait_blocker}</strong>
                  <p>{wait_expected}</p>
                </div>
                <RunStatusPill status={run_status || "waiting"} />
              </div>
	              {wait_request ? (
		                <div className={`wait_request_card ${wait_has_direct_question ? "" : "inferred"}`}>
		                  <span>{wait_request_label}</span>
                      <RuntimeMetadataChips metadata={wait_request_metadata} />
		                  <Markdown text={wait_request} />
		                  {!wait_has_direct_question ? (
	                    <p className="wait_context_note">
	                      The runtime did not attach a specific question to this wait. This is inferred from the run input; verify the session turns and workflow steps before answering.
	                    </p>
	                  ) : null}
	                </div>
	              ) : (
	                <div className="warn_callout">
	                  This wait did not provide a clear prompt or recoverable prior user request. Review the full run input and recent workflow steps before submitting a response.
	                </div>
	              )}
              {wait_conversation_context.length ? (
                <section className="wait_context_block wait_conversation_context">
                  <span>Recent session turns</span>
                  <div className="wait_turn_list">
                    {wait_conversation_context.map((msg, idx) => (
                      <div key={`${msg.role}:${idx}`} className={`wait_turn_row role_${msg.role.replace(/[^a-z0-9_-]+/g, "_")}`}>
	                        <div className="wait_turn_meta">
	                          <strong>{msg.role === "assistant" ? "Assistant" : msg.role === "user" || msg.role === "human" ? "User" : msg.role}</strong>
	                          {msg.ts ? <span className="mono muted">{format_time_ago(msg.ts)}</span> : null}
	                        </div>
                        <RuntimeMetadataChips metadata={msg.runtime_metadata} />
	                        <Markdown text={clamp_preview(msg.text, { max_chars: 1200, max_lines: 10 })} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="artifact_detail_grid">
                <div><span>Workflow</span><strong>{run_workflow_label(wait_context_run, workflow_label_by_id)}</strong></div>
                <div><span>Run</span><strong className="mono">{short_id(run_id.trim(), 24)}</strong></div>
                <div><span>Node</span><strong className="mono">{wait_context_run.current_node || String(last_record?.node_id || "—")}</strong></div>
                <div><span>Elapsed</span><strong>{run_duration_label(wait_context_run)}</strong></div>
                <div><span>Session</span><strong className="mono">{wait_context_run.session_id ? short_id(String(wait_context_run.session_id), 18) : "—"}</strong></div>
                <div><span>Wait key</span><strong className="mono">{short_id(wait_key, 28)}</strong></div>
              </div>
              {wait_has_input ? (
                <details className="runtime_raw_details wait_full_input_details" open={!wait_request}>
                  <summary className="mono muted">Full run input JSON</summary>
                  <div className="wait_shared_json">
                    <SharedJsonViewer value={wait_input_value} collapseAfterDepth={4} showCopy={true} />
                  </div>
                </details>
              ) : null}
	              <section className="wait_context_block">
	                <span>Recent workflow steps leading to this wait</span>
	                <div className="wait_event_list">
	                  {wait_recent_events.map((ev) => (
	                    <div key={`${ev.cursor}:${ev.node_id}:${ev.status}`} className="wait_event_row">
                      <span className="mono">#{ev.cursor}</span>
                      <strong>{ev.summary || ev.effect_type || ev.status || "event"}</strong>
                      <span className="mono muted">{[ev.node_id, ev.status, format_time_ago(ev.ts)].filter(Boolean).join(" · ")}</span>
                    </div>
                  ))}
                  {!wait_recent_events.length ? <div className="empty_state_inline">No ledger context is loaded. Open the ledger before deciding.</div> : null}
                </div>
              </section>
            </div>
            {tool_calls_for_wait.length ? (
              <div className="wait_action_panel">
                <div className="wait_action_intro">
                  Approve and execute runs the listed tool request through your configured worker. Approve only sends approval without local execution. Reject returns a denial. Cancel run stops the whole workflow run.
                </div>
                <div className="wait_tool_list">
                  {tool_calls_for_wait.map((tc, idx) => (
                    <div key={`${String((tc as any)?.name || "tool")}:${idx}`} className="wait_tool_card">
                      <div className="wait_tool_header">
                        <strong>{String((tc as any)?.name || "tool")}</strong>
                        <div className="wait_tool_badges">
                          <span className="chip mono warn">approval</span>
                          {tool_risk_labels(tc).map((label) => (
                            <span key={label} className="chip mono muted">{label}</span>
                          ))}
                        </div>
                      </div>
                      <div className="wait_tool_args">
                        <SharedJsonViewer value={(tc as any)?.arguments || {}} collapseAfterDepth={3} showCopy={true} />
                      </div>
                    </div>
                  ))}
                </div>
                {!worker ? <div className="warn_callout">No tool worker is configured, so Observer cannot execute these calls directly.</div> : null}
                <div className="actions">
                  <button className="btn primary" disabled={!worker || resuming} onClick={() => execute_tools_via_worker(tool_calls_for_wait)}>
                    Approve and execute
                  </button>
                  <button className="btn" disabled={resuming} onClick={() => resume_wait({ approved: true })}>
                    Approve only
                  </button>
                  <button className="btn danger" disabled={resuming} onClick={() => resume_wait({ approved: false })}>
                    Reject
                  </button>
                </div>
                <details className="runtime_raw_details">
                  <summary className="mono muted">Diagnostics</summary>
                  <div className="wait_shared_json">
                    <SharedJsonViewer value={wait_state || {}} collapseAfterDepth={3} showCopy={true} />
                  </div>
                </details>
              </div>
            ) : (
	              <div className="wait_action_panel">
	                <div className="wait_action_intro">
	                  Submit only when the request above is clear. The response resumes this wait only; Cancel run attempts to stop the whole workflow and prevent further work.
	                </div>
                <div className="wait_prompt_text">{wait_request || "No explicit prompt was provided. Open the ledger for context before responding."}</div>
                <AskForm wait={wait_state as WaitState} disabled={resuming} on_submit={(val) => resume_wait({ response: val })} />
                <details className="runtime_raw_details">
                  <summary className="mono muted">Diagnostics</summary>
                  <div className="wait_shared_json">
                    <SharedJsonViewer value={wait_state || {}} collapseAfterDepth={3} showCopy={true} />
                  </div>
                </details>
              </div>
            )}
          </Modal>
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
  const prompt = String(props.wait.prompt || "").trim();

  return (
    <>
      {choices.length ? (
        <div className="field">
          <label>Expected response</label>
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
          <label>{choices.length ? "Or type a response" : prompt ? "Your answer" : "Response to resume this wait"}</label>
          <textarea
            className="mono wait_response_input"
            value={value}
            onChange={(e) => set_value(e.target.value)}
            placeholder={prompt ? "Type your answer to the request above…" : "Type the response the workflow is waiting for…"}
            rows={4}
          />
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

function run_status_class(status: any): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "completed") return "ok";
  if (s === "failed" || s === "cancelled") return "danger";
  if (s === "waiting") return "warn";
  if (s === "running") return "info";
  return "muted";
}

function run_workflow_label(run: RunSummary | null | undefined, labels: Record<string, string>): string {
  const wid = String(run?.schedule_target_workflow_id || run?.workflow_id || "").trim();
  if (!wid) return "(workflow unknown)";
  return labels[wid] || wid;
}

function RunStatusPill(props: { status: any }): React.ReactElement {
  const status = String(props.status || "unknown").trim() || "unknown";
  return <span className={`run_status_pill ${run_status_class(status)}`}>{status}</span>;
}

function run_wait_label(run: RunSummary | null | undefined): string {
  const st = String(run?.status || "").trim().toLowerCase();
  if (terminal_run_status(st)) return "";
  const waiting = run?.waiting && typeof run.waiting === "object" ? (run.waiting as any) : null;
  const reason = String(waiting?.reason || run?.waiting_reason || "").trim().toLowerCase();
  const tool_calls = Array.isArray(waiting?.details?.tool_calls) ? waiting.details.tool_calls : [];
  if (tool_calls.length) return wait_blocker_title(waiting as WaitState, tool_calls as ToolCall[]);
  if (reason === "user") return "Waiting for your answer";
  if (reason === "event") return "Waiting for a response event";
  if (reason === "subworkflow") return "Waiting for subworkflow";
  if (reason === "until") return "Scheduled wait";
  if (reason) return `Waiting: ${reason}`;
  return st === "waiting" ? "Waiting, reason unknown" : "";
}

function run_error_label(run: RunSummary | null | undefined): string {
  const err: any = run?.error;
  if (!err) return "";
  if (typeof err === "string") return clamp_preview(err, { max_chars: 220, max_lines: 2 });
  return clamp_preview(safe_json_inline(err, 400), { max_chars: 220, max_lines: 2 });
}

function run_activity_label(run: RunSummary | null | undefined): string {
  const wait = run_wait_label(run);
  if (wait) return wait;
  const err = run_error_label(run);
  if (err) return err;
  const node = String(run?.current_node || "").trim();
  if (node) return `Current node: ${node}`;
  const st = String(run?.status || "").trim().toLowerCase();
  if (st === "running") return "Running";
  if (terminal_run_status(st)) return "Terminal";
  return "No current activity reported";
}

function WorkflowRunNavigator(props: {
  sections: RunTreeSection[];
  selected_run_id: string;
  root_run_id: string;
  search: string;
  filter: RunFilterMode;
  group_by: "status" | "workflow" | "session";
  loading: boolean;
  total_runs: number;
  workflow_label_by_id: Record<string, string>;
  on_search: (value: string) => void;
  on_filter: (value: RunFilterMode) => void;
  on_group_by: (value: "status" | "workflow" | "session") => void;
  on_refresh: () => void;
  on_select: (run_id: string, root_run_id?: string) => void;
}): React.ReactElement {
  const selected = props.selected_run_id.trim();
  const root_selected = props.root_run_id.trim() || selected;
  const active_count = props.sections.reduce(
    (count, section) =>
      count +
      section.rows.reduce((inner, row) => {
        const rows = [row.run, ...row.children];
        return inner + rows.filter((r) => active_run_status(r.status)).length;
      }, 0),
    0
  );

  return (
    <aside className="observatory_sidebar">
      <div className="run_nav_header">
        <div>
          <div className="run_nav_title">Workflows</div>
          <div className="run_nav_subtitle">
            {props.total_runs.toLocaleString()} runs • {active_count.toLocaleString()} active
          </div>
        </div>
        <button className="btn btn_icon" onClick={props.on_refresh} disabled={props.loading} title="Refresh workflow runs">
          <Icon name="refresh" size={14} />
          {props.loading ? "…" : ""}
        </button>
      </div>

      <div className="run_nav_controls">
        <input
          className="mono"
          value={props.search}
          onChange={(e) => props.on_search(e.target.value)}
          placeholder="Search runs, sessions, workflows"
        />
        <div className="seg_toggle mono run_nav_segments">
          {(["active", "waiting", "terminal", "failed", "all"] as RunFilterMode[]).map((mode) => (
            <button key={mode} className={`seg_btn ${props.filter === mode ? "active" : ""}`} onClick={() => props.on_filter(mode)}>
              {mode}
            </button>
          ))}
        </div>
        <select
          className="mono seg_select"
          value={props.group_by}
          onChange={(e) => props.on_group_by(e.target.value as "status" | "workflow" | "session")}
          title="Group workflow runs"
        >
          <option value="status">Group by status</option>
          <option value="workflow">Group by workflow</option>
          <option value="session">Group by session</option>
        </select>
      </div>

      <div className="run_tree">
        {!props.sections.length ? <div className="run_tree_empty">No runs match the current filters.</div> : null}
        {props.sections.map((section) => (
          <section key={section.key} className="run_tree_section">
            <div className="run_tree_section_header">
              <span>{section.label}</span>
              <span className="mono">{section.rows.length}</span>
            </div>
            {section.rows.map((row) => {
              const root = row.run;
              const root_id = String(root.run_id || "").trim();
              const root_selected_here = root_id === selected;
              return (
                <div key={root_id} className="run_tree_group">
                  <button
                    className={`run_tree_item ${root_selected_here ? "selected" : ""} ${root_id === root_selected ? "root_context" : ""}`}
                    onClick={() => props.on_select(root_id, root_id)}
                    title={root_id}
                  >
                    <div className="run_tree_item_top">
                      <span className="run_tree_label">{run_workflow_label(root, props.workflow_label_by_id)}</span>
                      <RunStatusPill status={root.status} />
                    </div>
                    <div className="run_tree_meta">
                      <span className="mono">{short_id(root_id, 13)}</span>
                      <span>{run_started_at(root) ? format_time_ago(run_started_at(root)) : "no start"}</span>
                      <span>{run_duration_label(root)}</span>
                    </div>
                  </button>
                  {row.children.length ? (
                    <div className="run_tree_children">
                      {row.children.map((child) => {
                        const child_id = String(child.run_id || "").trim();
                        return (
                          <button
                            key={child_id}
                            className={`run_tree_item run_tree_child ${child_id === selected ? "selected" : ""}`}
                            onClick={() => props.on_select(child_id, root_id)}
                            title={child_id}
                          >
                            <div className="run_tree_item_top">
                              <span className="run_tree_label">{run_workflow_label(child, props.workflow_label_by_id)}</span>
                              <RunStatusPill status={child.status} />
                            </div>
                            <div className="run_tree_meta">
                              <span className="mono">{short_id(child_id, 13)}</span>
                              <span>{run_started_at(child) ? format_time_ago(run_started_at(child)) : "child"}</span>
                              <span>{run_duration_label(child)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

function replay_descriptor(a: any): Record<string, any> {
  return a?.descriptor && typeof a.descriptor === "object" ? a.descriptor : {};
}

function replay_artifacts_from_bundle(bundle: any): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  const add = (a: any) => {
    const aid = String(a?.artifact_id || "").trim();
    const rid = String(a?.run_id || replay_descriptor(a).run_id || "").trim();
    const key = `${rid || "run"}:${aid}`;
    if (!aid || seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  const ledgers = bundle?.ledgers && typeof bundle.ledgers === "object" ? bundle.ledgers : {};
  Object.values(ledgers).forEach((entry: any) => {
    const artifacts = Array.isArray(entry?.artifacts) ? entry.artifacts : [];
    artifacts.forEach(add);
  });
  const turns = Array.isArray(bundle?.session?.turns) ? bundle.session.turns : [];
  turns.forEach((turn: any) => {
    const artifacts = Array.isArray(turn?.artifacts) ? turn.artifacts : [];
    artifacts.forEach(add);
  });
  return out;
}

function replay_artifact_preview_key(a: RuntimeArtifact): string {
  return `${a.run_id || "run"}:${a.artifact_id}`;
}

function replay_artifact_sort_key(a: RuntimeArtifact): number {
  const created = parse_iso_ms(a.created_at);
  if (created !== null) return created;
  const cursor = Number(a.ledger_cursor || a.turn_id || 0);
  return Number.isFinite(cursor) ? cursor : 0;
}

function replay_artifact_can_preview(a: RuntimeArtifact): boolean {
  return artifact_preview_kind(a) !== "binary";
}

function ReplayArtifactCards(props: {
  artifacts: any[];
  compact?: boolean;
  load_artifact_preview?: RuntimeEmbeddedPreviewLoader;
  on_open_artifact_explorer: (artifact: RuntimeArtifact) => void;
  on_download_artifact?: (artifact: RuntimeArtifact) => void;
}): React.ReactElement | null {
  const artifacts = useMemo(() => {
    const out: RuntimeArtifact[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(props.artifacts) ? props.artifacts : []) {
      const artifact = normalize_artifact_item(raw, "run");
      if (!artifact) continue;
      const key = replay_artifact_preview_key(artifact);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(artifact);
    }
    out.sort((a, b) => replay_artifact_sort_key(a) - replay_artifact_sort_key(b) || artifact_label(a).localeCompare(artifact_label(b)));
    return out;
  }, [props.artifacts]);
  const artifact_signature = artifacts.map(replay_artifact_preview_key).join("|");
  const [previews, set_previews] = useState<Record<string, RuntimeEmbeddedPreview>>({});
  const preview_urls_ref = useRef<Record<string, string>>({});
  const visible = artifacts;

  useEffect(() => {
    return () => {
      Object.values(preview_urls_ref.current).forEach((url) => URL.revokeObjectURL(url));
      preview_urls_ref.current = {};
    };
  }, []);

  useEffect(() => {
    set_previews(() => {
      Object.values(preview_urls_ref.current).forEach((url) => URL.revokeObjectURL(url));
      preview_urls_ref.current = {};
      return {};
    });
  }, [artifact_signature]);

  const store_preview = (key: string, preview: RuntimeEmbeddedPreview) => {
    set_previews((prev) => {
      const old_url = preview_urls_ref.current[key];
      if (old_url && old_url !== preview.url) URL.revokeObjectURL(old_url);
      if (preview.url) preview_urls_ref.current[key] = preview.url;
      else delete preview_urls_ref.current[key];
      return { ...prev, [key]: preview };
    });
  };

  const load_preview = (artifact: RuntimeArtifact, force = false) => {
    const key = replay_artifact_preview_key(artifact);
    const existing = previews[key];
    if (!force && existing && !existing.error) return;
    const kind = artifact_preview_kind(artifact);
    if (!props.load_artifact_preview) {
      store_preview(key, { artifact_id: artifact.artifact_id, kind, render_kind: "", text: "Preview loading is unavailable in this view.", url: "", loading: false, error: "" });
      return;
    }
    store_preview(key, { artifact_id: artifact.artifact_id, kind, render_kind: "", text: "", url: "", loading: true, error: "" });
    props.load_artifact_preview(artifact)
      .then((preview) => store_preview(key, preview))
      .catch((e: any) => {
        store_preview(key, { artifact_id: artifact.artifact_id, kind, render_kind: "", text: "", url: "", loading: false, error: String(e?.message || e || "Preview failed") });
      });
  };

  useEffect(() => {
    if (!props.load_artifact_preview || !artifacts.length) return;
    visible.filter(replay_artifact_can_preview).forEach((artifact) => load_preview(artifact));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact_signature, props.load_artifact_preview]);

  if (!artifacts.length) return null;
  return (
    <div className="replay_artifact_output">
      <div className="replay_artifact_output_header">
        <span>Outputs and artifacts linked to this turn</span>
        <strong>{artifacts.length.toLocaleString()}</strong>
      </div>
      <div className="replay_artifact_grid">
        {visible.map((artifact) => {
          const key = replay_artifact_preview_key(artifact);
          const preview = previews[key];
          const label = artifact_human_title(artifact);
          const type_label = artifact_display_type_label_for(artifact, {}, {}, preview?.text || "");
          const media_fact = artifact_media_fact_label(artifact);
          const provider_model = artifact_provider_model_label(artifact);
          const prompt = artifact_generation_prompt(artifact);
          const node = artifact_node_label(artifact);
          const can_preview = replay_artifact_can_preview(artifact);
          const loaded = Boolean(preview && !preview.loading && !preview.error);
          const loading = Boolean(preview?.loading);
          const created = display_datetime(artifact.created_at);
          const provenance = artifact_provenance_label(artifact);
          return (
            <article key={key} className="replay_artifact_card">
              <header className="replay_artifact_card_header">
                <ArtifactGlyph artifact={artifact} size={18} />
                <div>
                  <h5>{label}</h5>
                  <p>
                    <span>{type_label}</span>
                    <span>{format_bytes(artifact.size_bytes)}</span>
                    {created !== "—" ? <span>{created}</span> : null}
                    {node ? <span className="mono">{node}</span> : null}
                  </p>
                </div>
              </header>
              <div className="replay_artifact_facts">
                {provider_model ? <span><b>Provider</b> {provider_model}</span> : null}
                {media_fact ? <span><b>Media</b> {media_fact}</span> : null}
                {provenance ? <span><b>Source</b> {provenance}</span> : null}
                {artifact.turn_id || artifact.ledger_cursor ? <span><b>Turn</b> {artifact_turn_label(artifact)}</span> : null}
              </div>
              {prompt ? (
                <details className="replay_artifact_prompt">
                  <summary>Generation prompt</summary>
                  <p>{prompt}</p>
                </details>
              ) : null}
              {preview ? (
                <RuntimeInlinePreview artifact={artifact} preview={preview} />
              ) : (
                <div className="runtime_inline_preview empty">
                  {can_preview ? "Loading preview..." : "No inline preview for this artifact type."}
                </div>
              )}
              <div className="replay_artifact_actions">
                <button className="btn" onClick={() => load_preview(artifact, true)} disabled={!can_preview || loading || !props.load_artifact_preview}>
                  {loading ? "Loading…" : loaded ? "Reload preview" : "Preview"}
                </button>
                <button className="btn" onClick={() => props.on_download_artifact?.(artifact)} disabled={!artifact.run_id || !props.on_download_artifact}>
                  Download
                </button>
                <button className="btn" onClick={() => props.on_open_artifact_explorer(artifact)} disabled={!artifact.run_id}>
                  Artifact explorer
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function replay_status_copy(status: any): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "waiting") return "Waiting for response";
  if (s === "running") return "In progress";
  if (s === "completed") return "Completed";
  if (s === "failed") return "Failed";
  if (s === "cancelled") return "Cancelled";
  return s ? s.replace(/[_-]+/g, " ") : "Unknown";
}

function replay_turn_title(turn: any, idx: number, root_run_id: string): string {
  const rid = String(turn?.run_id || "").trim();
  const status = String(turn?.status || "").trim().toLowerCase();
  if (rid && rid === root_run_id) {
    if (status === "waiting") return "Current request needing attention";
    if (status === "running") return "Current request in progress";
    return "Selected request";
  }
  return `Earlier request ${idx + 1}`;
}

function replay_turn_subtitle(turn: any): string {
  const workflow = String(turn?.workflow_id || "").trim();
  const kind = String(turn?.kind || "").trim();
  return [workflow, kind && kind !== "run" ? kind : ""].filter(Boolean).join(" · ") || "Session turn";
}

function ReplayWorkbenchPanel(props: {
  bundle: any | null;
  loading: boolean;
  error: string;
  run_id: string;
  load_artifact_preview?: RuntimeEmbeddedPreviewLoader;
  on_download_artifact?: (artifact: RuntimeArtifact) => void;
  on_open_artifact_explorer: (artifact?: RuntimeArtifact) => void;
  on_refresh: () => void;
  on_open_ledger: () => void;
  on_open_chat: () => void;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const bundle = props.bundle;
  const turns = Array.isArray(bundle?.session?.turns)
    ? [...bundle.session.turns].sort((a: any, b: any) => {
        const am = parse_iso_ms(a?.created_at || a?.updated_at) ?? 0;
        const bm = parse_iso_ms(b?.created_at || b?.updated_at) ?? 0;
        return am - bm;
      })
    : [];
  const timeline = Array.isArray(bundle?.timeline) ? [...bundle.timeline] : [];
  timeline.sort((a: any, b: any) => {
    const am = parse_iso_ms(a?.started_at || a?.ended_at) ?? 0;
    const bm = parse_iso_ms(b?.started_at || b?.ended_at) ?? 0;
    return am - bm;
  });
  const ledgers = bundle?.ledgers && typeof bundle.ledgers === "object" ? bundle.ledgers : {};
  const run_count = Object.keys(ledgers).length;
  const artifacts = replay_artifacts_from_bundle(bundle);
  const session_id = String(bundle?.session?.session_id || bundle?.run?.session_id || "").trim();
  const root_run_id = String(bundle?.root_run_id || props.run_id || "").trim();

  return (
    <div className="replay_workbench">
      <section className="replay_hero">
        <div className="replay_hero_copy">
          <span className="replay_eyebrow">Conversation replay</span>
          <h3>Rebuild what led to this run</h3>
          <p>
            Read-only reconstruction of the session up to the selected run. Later session activity is intentionally excluded so the replay does not mix future retries or cancellations into this view.
          </p>
        </div>
        <div className="replay_hero_actions">
          <button className="btn" onClick={props.on_refresh} disabled={!props.run_id || props.loading}>{props.loading ? "Loading…" : "Refresh"}</button>
          <button className="btn primary" onClick={props.on_open_chat} disabled={!props.run_id}>Ask about replay</button>
          <button className="btn" onClick={props.on_open_ledger} disabled={!props.run_id}>Open ledger</button>
          <button className="btn" onClick={() => props.on_open_artifact_explorer()} disabled={!props.run_id}>Runtime artifacts</button>
          <button className="btn" onClick={() => props.on_copy(JSON.stringify(bundle || {}, null, 2))} disabled={!bundle}>Copy bundle</button>
        </div>
        <div className="replay_metric_grid">
          <div><span>Selected run</span><strong className="mono">{root_run_id ? short_id(root_run_id, 22) : "—"}</strong></div>
          <div><span>Session</span><strong className="mono">{session_id ? short_id(session_id, 22) : "—"}</strong></div>
          <div><span>Turns shown</span><strong>{turns.length.toLocaleString()}</strong></div>
          <div><span>Artifacts</span><strong>{artifacts.length.toLocaleString()}</strong></div>
        </div>
        <div className="replay_scope_note">
          {bundle?.generated_at
            ? `Replay refreshed ${display_datetime(bundle.generated_at)} from ${run_count.toLocaleString()} inspected run${run_count === 1 ? "" : "s"}.`
            : props.loading
              ? "Loading replay bundle."
              : "Replay bundle has not been loaded yet."}
        </div>
        {props.error ? <div className="warn_callout">{props.error}</div> : null}
      </section>

      {!bundle && !props.loading ? (
        <div className="chat_empty_hint">Select a run and refresh replay to load session turns, ledger timeline, and artifact summaries.</div>
      ) : null}

      {turns.length ? (
        <section className="replay_panel">
          <div className="replay_section_header">
            <div>
              <span className="replay_eyebrow">Session context</span>
              <h3>Turns before this point</h3>
            </div>
            <span className="chip mono info">{turns.length} shown</span>
          </div>
          <div className="replay_turn_list">
            {turns.map((turn: any, idx: number) => {
              const turn_artifacts = Array.isArray(turn?.artifacts) ? turn.artifacts : [];
              const prompt_split = split_runtime_metadata_envelope(String(turn?.prompt || "").trim());
              const prompt = prompt_split.text;
              const prompt_metadata = merge_runtime_metadata(
                prompt_split.metadata,
                turn?.prompt_metadata && typeof turn.prompt_metadata === "object" ? turn.prompt_metadata : null
              );
              const answer = String(turn?.answer || "").trim();
              const stats = turn?.stats && typeof turn.stats === "object" ? turn.stats : {};
              const turn_run_id = String(turn?.run_id || "").trim();
              const selected = Boolean(turn_run_id && turn_run_id === root_run_id);
              const status = String(turn?.status || "unknown").trim();
              return (
                <article key={`${turn_run_id || "turn"}:${idx}`} className={`replay_turn_card ${selected ? "selected" : ""}`}>
                  <header className="replay_turn_header">
                    <div className="replay_turn_number">#{idx + 1}</div>
                    <div className="replay_turn_title">
                      <h4>{replay_turn_title(turn, idx, root_run_id)}</h4>
                      <p>{replay_turn_subtitle(turn)}</p>
                    </div>
                    <div className="replay_turn_state">
                      <RunStatusPill status={status} />
                      <time>{display_datetime(turn?.created_at || turn?.updated_at)}</time>
                    </div>
                  </header>
                  {prompt ? (
                    <div className="replay_message_block request">
                      <span>Request</span>
                      <RuntimeMetadataChips metadata={prompt_metadata} />
                      <Markdown text={prompt} />
                    </div>
                  ) : (
                    <div className="replay_message_block muted">
                      <span>Request</span>
                      <p>No user request was recoverable for this turn.</p>
                    </div>
                  )}
                  {answer ? (
                    <div className="replay_message_block outcome">
                      <span>Outcome</span>
                      <Markdown text={answer} />
                    </div>
                  ) : (
                    <div className="replay_message_block muted">
                      <span>Current state</span>
                      <p>{replay_status_copy(status)}</p>
                    </div>
                  )}
                  {turn_artifacts.length ? (
                    <ReplayArtifactCards
                      artifacts={turn_artifacts}
                      compact
                      load_artifact_preview={props.load_artifact_preview}
                      on_download_artifact={props.on_download_artifact}
                      on_open_artifact_explorer={props.on_open_artifact_explorer}
                    />
                  ) : null}
                  <details className="runtime_raw_details replay_turn_details">
                    <summary className="mono muted">Diagnostics</summary>
                    <div className="artifact_detail_grid">
                      <div><span>Workflow</span><strong>{String(turn?.workflow_id || "—")}</strong></div>
                      <div><span>Run</span><strong className="mono">{turn_run_id ? short_id(turn_run_id, 28) : "—"}</strong></div>
                      <div><span>Provider calls</span><strong>{Number(stats.llm_calls || 0).toLocaleString()}</strong></div>
                      <div><span>Tool calls</span><strong>{Number(stats.tool_calls || 0).toLocaleString()}</strong></div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      ) : bundle ? (
        <div className="chat_empty_hint">No session turns were available in this bounded replay bundle.</div>
      ) : null}

      {timeline.length ? (
        <section className="replay_panel compact">
          <div className="replay_section_header">
            <div>
              <span className="replay_eyebrow">Execution trace</span>
              <h3>Run timeline</h3>
            </div>
            <span className="chip mono muted">{timeline.length} events</span>
          </div>
          <div className="timeline_list">
            {timeline.slice(-120).map((item: any, idx: number) => (
              <div key={`${String(item?.run_id || "run")}:${String(item?.cursor || idx)}`} className="timeline_row">
                <span className="mono">{display_datetime(item?.started_at || item?.ended_at)}</span>
                <strong>{String(item?.node_id || "run")}</strong>
                <span>{String(item?.effect_type || item?.status || "event")}</span>
                <span className="mono muted">{item?.run_id ? short_id(String(item.run_id), 14) : ""}{item?.cursor ? ` · #${item.cursor}` : ""}</span>
              </div>
            ))}
          </div>
          {timeline.length > 120 ? <div className="chat_hint">Showing the latest 120 events from the bounded replay bundle.</div> : null}
        </section>
      ) : null}
    </div>
  );
}

function RunOverviewPanel(props: {
  run_id: string;
  run: RunSummary | null;
  run_state: any;
  status_label: string;
  workflow_label_by_id: Record<string, string>;
  root_run_id: string;
  subrun_ids: string[];
  session_id: string;
  records_count: number;
  child_records_count: number;
  provider_activities: ProviderActivity[];
  attachments_count: number;
  latest_summary: LatestRunSummary | null;
  wait_state: WaitState | null;
  summary_generating: boolean;
  summary_error: string;
  on_generate_summary: () => void;
  on_open_runtime: () => void;
  on_open_subrun: (run_id: string) => void;
}): React.ReactElement {
  const run_id = props.run_id.trim();
  const title = run_workflow_label(props.run, props.workflow_label_by_id);
  const started = run_started_at(props.run) || String(props.run_state?.started_at || props.run_state?.created_at || "").trim();
  const finished = run_finished_at(props.run) || (terminal_run_status(props.status_label) ? String(props.run_state?.updated_at || "").trim() : "");
  const duration = props.run ? run_duration_label(props.run) : started ? format_duration_ms((parse_iso_ms(finished) ?? Date.now()) - (parse_iso_ms(started) ?? Date.now())) : "—";
  const llm_count = props.provider_activities.length;
  const token_total = props.provider_activities.reduce((n, a) => n + (Number(a.tokens.total) || 0), 0);
  const missing = props.provider_activities.filter((a) => a.missing_response || a.error).length;
  const summary_text = String(props.latest_summary?.text || "").trim();
  const wait = props.wait_state;

  return (
    <div className="run_overview">
      <section className="run_hero">
        <div className="run_hero_main">
          <div className="run_hero_eyebrow">Selected workflow</div>
          <h2>{title}</h2>
          <div className="run_hero_meta">
            <RunStatusPill status={props.status_label} />
            {run_id ? <span className="mono" title={run_id}>{short_id(run_id, 22)}</span> : <span className="mono">(no run selected)</span>}
            {props.root_run_id && props.root_run_id !== run_id ? <span className="mono">root {short_id(props.root_run_id, 14)}</span> : null}
          </div>
        </div>
        <div className="run_hero_actions">
          <button className="btn primary" onClick={props.on_generate_summary} disabled={!run_id || props.summary_generating}>
            {props.summary_generating ? "Summarizing…" : summary_text ? "Refresh Summary" : "Summarize"}
          </button>
          <button className="btn" onClick={props.on_open_runtime}>
            Runtime
          </button>
        </div>
      </section>

      <div className="metric_grid">
        <div className="metric_tile">
          <span>Started</span>
          <strong>{display_datetime(started)}</strong>
        </div>
        <div className="metric_tile">
          <span>{finished ? "Finished" : "Running for"}</span>
          <strong>{finished ? display_datetime(finished) : duration}</strong>
        </div>
        <div className="metric_tile">
          <span>Total duration</span>
          <strong>{duration}</strong>
        </div>
        <div className="metric_tile">
          <span>Ledger</span>
          <strong>{(props.records_count + props.child_records_count).toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Subworkflows</span>
          <strong>{props.subrun_ids.length.toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Provider calls</span>
          <strong>{llm_count.toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Tokens</span>
          <strong>{token_total ? token_total.toLocaleString() : "—"}</strong>
        </div>
        <div className="metric_tile">
          <span>Assets</span>
          <strong>{props.attachments_count.toLocaleString()}</strong>
        </div>
      </div>

      <div className="overview_columns">
        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>What Is Happening</h3>
            {wait ? <span className="chip mono info">waiting</span> : null}
          </div>
          {wait ? (
            <div className="overview_fact_list">
              <div><span>Reason</span><strong>{String(wait.reason || "unknown")}</strong></div>
              {wait.wait_key ? <div><span>Wait key</span><strong className="mono">{short_id(String(wait.wait_key), 34)}</strong></div> : null}
              {(wait as any)?.details?.sub_run_id ? (
                <div><span>Subworkflow</span><strong className="mono">{short_id(String((wait as any).details.sub_run_id), 24)}</strong></div>
              ) : null}
              {wait.prompt ? <div><span>Prompt</span><strong>{clamp_preview(String(wait.prompt), { max_chars: 260, max_lines: 3 })}</strong></div> : null}
            </div>
          ) : (
            <div className="empty_state_inline">No active wait is reported for this run.</div>
          )}
          {missing ? <div className="warn_callout">{missing} provider call(s) have missing responses or errors.</div> : null}
        </section>

        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Summary</h3>
            {props.latest_summary ? <span className="chip mono ok">saved</span> : <span className="chip mono muted">none</span>}
          </div>
          {props.summary_error ? <div className="warn_callout">{props.summary_error}</div> : null}
          {summary_text ? <Markdown text={summary_text} /> : <div className="empty_state_inline">Generate a grounded summary from the root run and its subflows.</div>}
        </section>
      </div>

      {props.subrun_ids.length ? (
        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Subworkflows</h3>
            <span className="mono muted">{props.subrun_ids.length}</span>
          </div>
          <div className="subrun_chip_list">
            {props.subrun_ids.map((rid) => (
              <button key={rid} className="subrun_chip mono" onClick={() => props.on_open_subrun(rid)} title={rid}>
                {short_id(rid, 22)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HumanTimelinePanel(props: {
  items: LedgerRecordItem[];
  node_index: Record<string, any>;
  workflow_label_by_id: Record<string, string>;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const humanize = (item: LedgerRecordItem): { title: string; subtitle: string; request: string; outcome: string; cls: string } => {
    const extra: any = item as any;
    const rec: any = item.record || {};
    const effect_type = String(rec?.effect?.type || extra.effect_type || "").trim();
    const status = String(rec?.status || extra.status || "").trim();
    const node_id = String(rec?.node_id || extra.node_id || "").trim();
    const node = node_id && props.node_index ? (props.node_index as any)[node_id] : null;
    const node_label = String(node?.label || node_id || extra.title || "Step").trim();
    const wait = extract_wait_from_record(rec);
    const payload = rec?.effect?.payload;
    const result = rec?.result;
    const response = extract_response_text_from_record(rec);
    const request = effect_type ? safe_json_inline(payload ?? {}, 900) : clamp_preview(String(extra.preview || ""), { max_chars: 900, max_lines: 8 });
    const outcome =
      response ||
      (wait ? `Waiting for ${String(wait.reason || "input")}${wait.wait_key ? ` (${short_id(String(wait.wait_key), 18)})` : ""}` : "") ||
      (result !== undefined ? safe_json_inline(result, 900) : "");
    const title =
      effect_type === "llm_call"
        ? "Model call"
        : effect_type === "tool_calls"
          ? "Tool execution"
          : effect_type === "answer_user"
            ? "User-facing response"
            : effect_type === "start_subworkflow"
              ? "Subworkflow launched"
              : effect_type === "ask_user"
                ? "User input requested"
                : effect_type || extra.title || "Ledger event";
    return {
      title,
      subtitle: node_label,
      request: clamp_preview(request, { max_chars: 900, max_lines: 7 }),
      outcome: clamp_preview(outcome, { max_chars: 1100, max_lines: 9 }),
      cls: run_status_class(status),
    };
  };

  return (
    <div className="human_timeline">
      {!props.items.length ? <div className="empty_state_inline">No ledger records yet.</div> : null}
      {props.items.map((item) => {
        const rec: any = item.record || {};
        const h = humanize(item);
        const ts = String(rec.ended_at || rec.started_at || (item as any).ts || "").trim();
        return (
          <article key={`${String(item.run_id || rec.run_id || "")}:${item.cursor}`} className={`timeline_event ${h.cls}`}>
            <div className="timeline_marker" />
            <div className="timeline_event_body">
              <div className="timeline_event_header">
                <div>
                  <h3>{h.title}</h3>
                  <div className="timeline_subtitle">
                    <span>{h.subtitle}</span>
                    {item.run_id ? <span className="mono">{short_id(String(item.run_id), 13)}</span> : null}
                  </div>
                </div>
                <div className="timeline_time">
                  <span>{format_time_ago(ts)}</span>
                  <span className="mono" title={ts}>{display_datetime(ts)}</span>
                </div>
              </div>
              <div className="timeline_payload_grid">
                <div>
                  <span>Requested</span>
                  <p className="mono">{h.request || "—"}</p>
                </div>
                <div>
                  <span>Outcome</span>
                  <p>{h.outcome || "—"}</p>
                </div>
              </div>
              <div className="timeline_actions">
                <button className="btn btn_icon" onClick={() => props.on_copy(JSON.stringify(rec, null, 2))}>
                  <Icon name="copy" size={14} />
                  JSON
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ProviderActivityPanel(props: {
  activities: ProviderActivity[];
  audit_log_text: string;
  audit_log_meta: string;
  audit_log_loading: boolean;
  audit_log_error: string;
  on_refresh_audit: () => void;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const total_tokens = props.activities.reduce((n, a) => n + (Number(a.tokens.total) || 0), 0);
  const missing = props.activities.filter((a) => a.missing_response || a.error).length;
  const providers = Array.from(new Set(props.activities.map((a) => [a.provider, a.model].filter(Boolean).join("/")).filter(Boolean))).slice(0, 8);

  return (
    <div className="provider_panel">
      <div className="metric_grid compact">
        <div className="metric_tile">
          <span>Calls</span>
          <strong>{props.activities.length.toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Tokens</span>
          <strong>{total_tokens ? total_tokens.toLocaleString() : "—"}</strong>
        </div>
        <div className="metric_tile">
          <span>Issues</span>
          <strong>{missing.toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Providers</span>
          <strong>{providers.length ? providers.length.toLocaleString() : "—"}</strong>
        </div>
      </div>

      <section className="overview_panel">
        <div className="overview_panel_header">
          <h3>Provider Calls In This Run</h3>
          <span className="mono muted">{providers.join(", ") || "no model calls detected"}</span>
        </div>
        {!props.activities.length ? <div className="empty_state_inline">No LLM provider activity is present in the loaded ledger.</div> : null}
        <div className="provider_activity_list">
          {props.activities.map((a) => (
            <article key={a.id} className={`provider_activity ${a.error || a.missing_response ? "danger" : ""}`}>
              <div className="provider_activity_header">
                <div>
                  <h4>{[a.provider || "provider?", a.model || "model?"].join(" / ")}</h4>
                  <div className="timeline_subtitle">
                    <span className="mono">{short_id(a.run_id, 13)}</span>
                    {a.node_id ? <span className="mono">{a.node_id}</span> : null}
                    <span>{format_duration_ms(a.duration_ms)}</span>
                  </div>
                </div>
                <div className="provider_tokens mono">
                  {a.tokens.total ? a.tokens.total.toLocaleString() : "—"} tokens
                </div>
              </div>
              <div className="provider_preview_grid">
                <div>
                  <span>Prompt</span>
                  <p>{a.prompt_preview || "—"}</p>
                </div>
                <div>
                  <span>Response</span>
                  <p>{a.response_preview || (a.error ? a.error : "No response captured")}</p>
                </div>
              </div>
              <div className="timeline_actions">
                <button className="btn btn_icon" onClick={() => props.on_copy(a.prompt_preview)} disabled={!a.prompt_preview}>
                  <Icon name="copy" size={14} />
                  Prompt
                </button>
                <button className="btn btn_icon" onClick={() => props.on_copy(a.response_preview)} disabled={!a.response_preview}>
                  <Icon name="copy" size={14} />
                  Response
                </button>
                <button className="btn btn_icon" onClick={() => props.on_copy(JSON.stringify(a.raw, null, 2))}>
                  <Icon name="copy" size={14} />
                  JSON
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="overview_panel">
        <div className="overview_panel_header">
          <h3>Gateway Audit Tail</h3>
          <div className="actions" style={{ marginTop: 0 }}>
            {props.audit_log_meta ? <span className="mono muted">{props.audit_log_meta}</span> : null}
            <button className="btn btn_icon" onClick={props.on_refresh_audit} disabled={props.audit_log_loading}>
              <Icon name="refresh" size={14} />
              {props.audit_log_loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {props.audit_log_error ? <div className="warn_callout">{props.audit_log_error}</div> : null}
        <pre className="mono audit_log_tail">{props.audit_log_text || "(audit tail not loaded)"}</pre>
      </section>
    </div>
  );
}

function ArtifactGlyph(props: { artifact: RuntimeArtifact | null; size?: number }): React.ReactElement {
  const size = props.size || 18;
  const kind = artifact_preview_kind(props.artifact);
  const display_kind = artifact_display_kind(props.artifact, "");
  const cls = `artifact_glyph ${display_kind === "code" ? "code" : kind}`;
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as any;
  if (kind === "image") {
    return (
      <span className={cls}>
        <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15l3-3 3 3 2-2 4 4" /><circle cx="8" cy="9" r="1.4" /></svg>
      </span>
    );
  }
  if (kind === "audio") {
    return (
      <span className={cls}>
        <svg {...common}><path d="M4 12h2" /><path d="M8 8v8" /><path d="M12 5v14" /><path d="M16 8v8" /><path d="M20 12h-2" /></svg>
      </span>
    );
  }
  if (kind === "video") {
    return (
      <span className={cls}>
        <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 9l6 3-6 3V9z" fill="currentColor" stroke="none" /></svg>
      </span>
    );
  }
  if (display_kind === "code") {
    return (
      <span className={cls}>
        <svg {...common}><path d="M8 8l-4 4 4 4" /><path d="M16 8l4 4-4 4" /><path d="M14 4l-4 16" /></svg>
      </span>
    );
  }
  if (kind === "text") {
    return (
      <span className={cls}>
        <svg {...common}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h6" /><path d="M10 13h7" /><path d="M10 17h5" /></svg>
      </span>
    );
  }
  return (
    <span className={cls}>
      <svg {...common}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h6" /><path d="M9 14h8" /></svg>
    </span>
  );
}

type HtmlExpansionMode = "folded" | "unfolded";
type HtmlTreeNode =
  | { kind: "doctype"; name: string }
  | { kind: "comment"; text: string }
  | { kind: "text"; text: string }
  | { kind: "element"; tag: string; attrs: Array<{ name: string; value: string }>; children: HtmlTreeNode[] };

const HTML_FOLDED_DEPTH = 2;
const HTML_UNFOLDED_DEPTH = Number.MAX_SAFE_INTEGER;

function html_text_preview(text: string, max = 120): string {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function parse_html_tree(text: string): HtmlTreeNode[] {
  const raw = String(text || "");
  if (typeof DOMParser === "undefined") {
    return [{ kind: "text", text: format_html_source(raw) || raw }];
  }
  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const nodes: HtmlTreeNode[] = [];
    if (doc.doctype) nodes.push({ kind: "doctype", name: doc.doctype.name || "html" });

    const convert = (node: Node): HtmlTreeNode | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = String(node.textContent || "").trim();
        return value ? { kind: "text", text: value } : null;
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        return { kind: "comment", text: String(node.textContent || "") };
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const attrs = Array.from(el.attributes || []).map((a) => ({ name: a.name, value: a.value }));
        const children = Array.from(el.childNodes || []).map(convert).filter(Boolean) as HtmlTreeNode[];
        return { kind: "element", tag: el.tagName.toLowerCase(), attrs, children };
      }
      return null;
    };

    if (doc.documentElement) {
      const root = convert(doc.documentElement);
      if (root) nodes.push(root);
    }
    return nodes.length ? nodes : [{ kind: "text", text: format_html_source(raw) || raw }];
  } catch {
    return [{ kind: "text", text: format_html_source(raw) || raw }];
  }
}

function HtmlOpenTag(props: { tag: string; attrs: Array<{ name: string; value: string }>; closing?: boolean; selfClosing?: boolean }): React.ReactElement {
  if (props.closing) {
    return (
      <>
        <span className="runtime_html_punct">&lt;/</span>
        <span className="runtime_html_tag">{props.tag}</span>
        <span className="runtime_html_punct">&gt;</span>
      </>
    );
  }
  return (
    <>
      <span className="runtime_html_punct">&lt;</span>
      <span className="runtime_html_tag">{props.tag}</span>
      {props.attrs.map((attr) => (
        <React.Fragment key={`${props.tag}:${attr.name}:${attr.value}`}>
          {" "}
          <span className="runtime_html_attr">{attr.name}</span>
          <span className="runtime_html_punct">=</span>
          <span className="runtime_html_value">"{attr.value}"</span>
        </React.Fragment>
      ))}
      <span className="runtime_html_punct">{props.selfClosing ? " />" : ">"}</span>
    </>
  );
}

function HtmlTreeNodeView(props: { node: HtmlTreeNode; depth: number; collapseAfterDepth: number; expansionMode: HtmlExpansionMode; expansionVersion: number }): React.ReactElement {
  const node = props.node;
  const indentPx = props.depth * 14;
  const defaultOpen = props.depth < props.collapseAfterDepth;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, props.expansionVersion]);

  if (node.kind === "doctype") {
    return (
      <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
        <span className="runtime_html_punct">&lt;!DOCTYPE </span>
        <span className="runtime_html_tag">{node.name}</span>
        <span className="runtime_html_punct">&gt;</span>
      </div>
    );
  }

  if (node.kind === "comment") {
    return (
      <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
        <span className="runtime_html_comment">{`<!-- ${node.text.trim()} -->`}</span>
      </div>
    );
  }

  if (node.kind === "text") {
    return (
      <div className="html-tree__line html-tree__text" style={{ paddingLeft: indentPx }}>
        {node.text}
      </div>
    );
  }

  if (!node.children.length) {
    return (
      <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
        <HtmlOpenTag tag={node.tag} attrs={node.attrs} selfClosing={true} />
      </div>
    );
  }

  const summary = node.children.find((child) => child.kind === "text") as Extract<HtmlTreeNode, { kind: "text" }> | undefined;

  return (
    <details className="html-tree__details" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="html-tree__summary" style={{ paddingLeft: indentPx }}>
        <span className="html-tree__caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <HtmlOpenTag tag={node.tag} attrs={node.attrs} />
        {!open && summary ? <span className="html-tree__summary_text"> {html_text_preview(summary.text)}</span> : null}
      </summary>
      {open ? (
        <div className="html-tree__children">
          {node.children.map((child, idx) => (
            <HtmlTreeNodeView
              key={`${props.depth}:${node.kind}:${node.tag}:${idx}`}
              node={child}
              depth={props.depth + 1}
              collapseAfterDepth={props.collapseAfterDepth}
              expansionMode={props.expansionMode}
              expansionVersion={props.expansionVersion}
            />
          ))}
          <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
            <HtmlOpenTag tag={node.tag} attrs={[]} closing={true} />
          </div>
        </div>
      ) : null}
    </details>
  );
}

function HtmlSourcePreview(props: { text: string; className: string }): React.ReactElement {
  const nodes = useMemo(() => parse_html_tree(props.text), [props.text]);
  const [expansion, setExpansion] = useState<{ mode: HtmlExpansionMode; version: number }>({ mode: "folded", version: 0 });
  const collapseAfterDepth = expansion.mode === "unfolded" ? HTML_UNFOLDED_DEPTH : HTML_FOLDED_DEPTH;

  useEffect(() => {
    setExpansion((prev) => ({ mode: "folded", version: prev.version + 1 }));
  }, [props.text]);

  const toggleExpansion = () => {
    setExpansion((prev) => ({
      mode: prev.mode === "unfolded" ? "folded" : "unfolded",
      version: prev.version + 1,
    }));
  };

  return (
    <div className={`${props.className} structured html_source_preview`}>
      <div className="html-tree__toolbar">
        <button type="button" className="btn html-tree__toggle" onClick={toggleExpansion} aria-expanded={expansion.mode === "unfolded"}>
          {expansion.mode === "unfolded" ? "Fold all" : "Unfold all"}
        </button>
      </div>
      <div className="html-tree__tree" role="tree" aria-label="HTML source tree">
        {nodes.map((node, idx) => (
          <HtmlTreeNodeView key={`root:${idx}`} node={node} depth={0} collapseAfterDepth={collapseAfterDepth} expansionMode={expansion.mode} expansionVersion={expansion.version} />
        ))}
      </div>
    </div>
  );
}

function MarkdownArtifactPreview(props: { text: string; className: string }): React.ReactElement {
  const report = parse_markdown_report(props.text);
  if (!report) {
    return (
      <div className={`${props.className} structured markdown_preview`}>
        <Markdown text={props.text} />
      </div>
    );
  }

  const title = report.metadata.find((m) => m.label.toLowerCase() === "title")?.value || "";
  return (
    <div className={`${props.className} structured markdown_preview artifact_markdown_report`}>
      {title ? <h1 className="artifact_markdown_title">{title}</h1> : null}
      {report.metadata.length ? (
        <dl className="artifact_markdown_meta">
          {report.metadata.map((m) => {
            const is_url = /^https?:\/\//i.test(m.value);
            return (
              <div key={`${m.label}:${m.value}`}>
                <dt>{m.label}</dt>
                <dd>
                  {is_url ? (
                    <a href={m.value} target="_blank" rel="noreferrer">
                      {m.value}
                    </a>
                  ) : (
                    m.value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      <Markdown text={report.body || props.text} />
    </div>
  );
}

function RuntimeStructuredTextPreview(props: { artifact: RuntimeArtifact | null; text: string; className: string }): React.ReactElement {
  const text = String(props.text || "");
  const render_kind = artifact_text_render_kind(props.artifact, text);

  if (render_kind === "json") {
    const parsed = tryParseJson(text);
    if (parsed !== null) {
      return (
        <div className={`${props.className} structured`}>
          <SharedJsonViewer value={parsed} collapseAfterDepth={4} showCopy={false} />
        </div>
      );
    }
  }

  if (render_kind === "markdown") {
    return <MarkdownArtifactPreview text={text} className={props.className} />;
  }

  if (render_kind === "html") {
    return <HtmlSourcePreview text={text} className={props.className} />;
  }

  return <pre className={`mono ${props.className}`}>{text}</pre>;
}

function RuntimeInlinePreview(props: { artifact: RuntimeArtifact | null; preview: RuntimeEmbeddedPreview }): React.ReactElement {
  const preview = props.preview;
  const artifact = props.artifact;
  if (!artifact) return <div className="runtime_inline_preview empty">Select an artifact to preview it here.</div>;
  if (preview.loading) return <div className="runtime_inline_preview empty">Loading preview…</div>;
  if (preview.error) return <div className="runtime_inline_preview empty danger">{preview.error}</div>;
  if (preview.kind === "image" && preview.url) return <img className="runtime_inline_preview media" src={preview.url} alt={artifact_label(artifact)} />;
  if (preview.kind === "audio" && preview.url) return <audio className="runtime_inline_preview audio" src={preview.url} controls />;
  if (preview.kind === "video" && preview.url) return <video className="runtime_inline_preview media" src={preview.url} controls />;
  return <RuntimeStructuredTextPreview artifact={artifact} text={preview.text || "Preview unavailable. Use Preview or Download."} className="runtime_inline_preview text" />;
}

function RuntimeActivityConsole(props: {
  gateway_connected: boolean;
  runs: RunSummary[];
  artifacts: RuntimeArtifact[];
  selected_run_id: string;
  workflow_label_by_id: Record<string, string>;
  on_select_run: (run_id: string) => void;
  on_open_run: (run_id: string) => void;
  on_open_ledger: (run_id: string) => void;
  on_filter_artifacts: (run_id: string) => void;
  on_filter_session_artifacts: (session_id: string) => void;
  on_open_logs: () => void;
  on_refresh_runs: () => void;
  on_reconnect: () => void;
}): React.ReactElement {
  const [filter, set_filter] = useState<RuntimeActivityQueue>("attention");
  const [query, set_query] = useState("");
  const [sort, set_sort] = useState<RuntimeActivitySort>("attention");
  const [selected_id, set_selected_id] = useState("");

  const artifact_counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of props.artifacts) {
      const rid = String(a.run_id || "").trim();
      if (rid) out[rid] = (out[rid] || 0) + 1;
    }
    return out;
  }, [props.artifacts]);

  const views = useMemo(
    () => build_runtime_activity_views(props.runs as any[], { workflow_label_by_id: props.workflow_label_by_id }),
    [props.runs, props.workflow_label_by_id]
  );
  const counts = useMemo(() => count_runtime_activity_queues(views), [views]);
  const rows = useMemo(() => {
    const filtered = filter_runtime_activity_views(views, { queue: filter, query });
    return sort_runtime_activity_views(filtered, sort);
  }, [views, filter, query, sort]);

  const selected_view =
    rows.find((v) => String(v.run_id || "") === selected_id) ||
    rows.find((v) => String(v.run_id || "") === props.selected_run_id) ||
    rows[0] ||
    null;
  const selected = (selected_view?.run as RunSummary | undefined) || null;
  const selected_run_id = String(selected?.run_id || "").trim();
  const selected_session_id = String(selected?.session_id || "").trim();
  const selected_session_run_ids = useMemo(() => {
    if (!selected_session_id) return new Set<string>();
    return new Set(
      props.runs
        .filter((r) => String(r.session_id || "").trim() === selected_session_id)
        .map((r) => String(r.run_id || "").trim())
        .filter(Boolean)
    );
  }, [props.runs, selected_session_id]);
  const selected_session_runs = selected_session_id ? selected_session_run_ids.size : 0;
  const selected_session_artifacts = useMemo(() => {
    if (!selected_session_id) return 0;
    return props.artifacts.filter((a) => String(a.session_id || "").trim() === selected_session_id || selected_session_run_ids.has(String(a.run_id || "").trim())).length;
  }, [props.artifacts, selected_session_id, selected_session_run_ids]);
  const waiting = selected?.waiting && typeof selected.waiting === "object" ? (selected.waiting as any) : null;
  const selected_tool_calls = waiting ? extract_tool_calls_from_wait(waiting as WaitState) : [];
  const selected_wait_blocker = selected_view?.reason || (waiting ? wait_blocker_title(waiting as WaitState, selected_tool_calls) : "");
  const selected_wait_expected = selected_view?.expected_action || (waiting ? wait_expected_action(waiting as WaitState, selected_tool_calls) : "");
  const selected_wait_request = waiting ? wait_request_text(waiting as WaitState, null) : "";
  const selected_artifacts = selected_run_id ? artifact_counts[selected_run_id] || 0 : 0;
  const selected_terminal = terminal_run_status(selected?.status);
  const filters: Array<{ key: RuntimeActivityQueue; label: string; count: number }> = [
    { key: "attention", label: "Needs attention", count: counts.attention },
    { key: "user_wait", label: "Needs my response", count: counts.user_wait },
    { key: "tool_approval", label: "Tool approvals", count: counts.tool_approval },
    { key: "running", label: "Running", count: counts.running },
    { key: "failed", label: "Failed", count: counts.failed },
    { key: "scheduled", label: "Scheduled/subflows", count: counts.scheduled },
    { key: "finished", label: "Finished", count: counts.finished },
    { key: "all", label: "All loaded", count: counts.all },
  ];

  return (
    <div className="runtime_ops_layout">
      <aside className="runtime_ops_filters">
        <div className="runtime_ops_filter_header">
          <strong>Queues</strong>
          <button className="btn btn_icon" onClick={props.gateway_connected ? props.on_refresh_runs : props.on_reconnect}>
            <Icon name="refresh" size={14} />
            {props.gateway_connected ? "Refresh" : "Reconnect"}
          </button>
        </div>
        {filters.map((f) => (
          <button key={f.key} className={`runtime_ops_filter ${filter === f.key ? "selected" : ""}`} aria-pressed={filter === f.key} onClick={() => set_filter(f.key)}>
            <span>{f.label}</span>
            <strong className="mono">{f.count.toLocaleString()}</strong>
          </button>
        ))}
        <div className="runtime_ops_hint">
          Counts are for the loaded runtime page. Refine search or refresh when supervising large runtimes.
        </div>
      </aside>

      <section className="runtime_ops_table_panel">
        <div className="runtime_ops_toolbar">
          <input className="mono" value={query} onChange={(e) => set_query(e.target.value)} placeholder="Search workflow, run, node, status, error" />
          <select className="mono seg_select" value={sort} onChange={(e) => set_sort(e.target.value as any)}>
            <option value="attention">Attention order</option>
            <option value="recent">Latest event</option>
            <option value="oldest">Oldest event</option>
            <option value="duration">Longest duration</option>
            <option value="tokens">Most tokens</option>
            <option value="workflow">Workflow</option>
          </select>
        </div>
        <div className="runtime_ops_table_scroll">
          <table className="runtime_ops_table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Workflow / Run</th>
                <th>Blocking / Current Activity</th>
                <th>Age</th>
                <th>Last Event</th>
                <th>Calls</th>
                <th>Visible artifacts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="runtime_ops_empty">
                    {props.gateway_connected ? "No runs match this queue." : "Gateway offline. Runtime activity cannot be loaded until the connection is restored."}
                  </td>
                </tr>
              ) : null}
              {rows.map((view) => {
                const r = view.run as RunSummary;
                const rid = String(r.run_id || "").trim();
                const artifact_count = artifact_counts[rid] || 0;
                return (
                  <tr
                    key={rid}
                    className={rid === selected_run_id ? "selected" : ""}
                    aria-selected={rid === selected_run_id}
                    tabIndex={0}
                    onClick={() => {
                      set_selected_id(rid);
                      props.on_select_run(rid);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        set_selected_id(rid);
                        props.on_select_run(rid);
                      }
                    }}
                  >
                    <td><RunStatusPill status={r.status} /></td>
                    <td>
                      <strong>{run_workflow_label(r, props.workflow_label_by_id)}</strong>
                      <span className="mono">{short_id(rid, 18)}</span>
                      {r.session_id ? <span className="mono">session {short_id(String(r.session_id), 14)}</span> : null}
                      {r.parent_run_id ? <span className="mono muted">child of {short_id(String(r.parent_run_id), 10)}</span> : null}
                    </td>
                    <td>
                      <span>{view.reason}</span>
                      {r.current_node ? <span className="mono muted">{String(r.current_node)}</span> : null}
                      {view.is_stale ? <span className="chip mono warn">stale</span> : null}
                    </td>
                    <td>
                      <span>{run_duration_label(r)}</span>
                      <span className="muted">{display_datetime(run_started_at(r))}</span>
                    </td>
                    <td>{format_time_ago(r.updated_at || r.created_at)}</td>
                    <td>
                      <span className="mono">{Number(r.llm_calls || 0).toLocaleString()} llm</span>
                      <span className="mono">{Number(r.tool_calls || 0).toLocaleString()} tools</span>
                      <span className="mono">{Number(r.tokens_total || 0).toLocaleString()} tok</span>
                    </td>
                    <td className="mono">{artifact_count.toLocaleString()}</td>
                    <td>
                      <div className="runtime_ops_actions">
                        {view.needs_user_action ? (
                          <button className="btn primary" onClick={(e) => { e.stopPropagation(); props.on_open_run(rid); }}>{view.action_label}</button>
                        ) : (
                          <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_open_run(rid); }}>Open</button>
	                        )}
	                        <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_open_ledger(rid); }}>Ledger</button>
	                        <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_select_run(rid); props.on_open_logs(); }}>Logs</button>
	                        <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_filter_artifacts(rid); }}>Artifacts</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="runtime_ops_inspector">
        {!selected ? (
          <div className="empty_state_inline">Select a run to inspect why it is active or blocked.</div>
        ) : (
          <>
            <div className="runtime_ops_inspector_head">
              <RunStatusPill status={selected.status} />
              <h3>{run_workflow_label(selected, props.workflow_label_by_id)}</h3>
              <span className="mono">{short_id(selected_run_id, 28)}</span>
            </div>
            <div className="runtime_ops_decision">
              <strong>{selected_view?.reason || run_activity_label(selected)}</strong>
              <span>
                {selected_view?.expected_action ||
                (String(selected.status || "").toLowerCase() === "waiting"
                  ? "This run is paused until the pending wait is resolved or the run is cancelled."
                  : selected_terminal
                    ? "This run is terminal. Open the ledger for the narrative and final error/output."
                    : "This run is active or recently updated. Use ledger/provider logs to inspect live work.")}
              </span>
            </div>
            <div className="artifact_detail_grid">
              <div><span>Started</span><strong>{display_datetime(run_started_at(selected))}</strong></div>
              <div><span>Elapsed</span><strong>{run_duration_label(selected)}</strong></div>
              <div><span>Last event</span><strong>{display_datetime(selected.updated_at || selected.created_at)}</strong></div>
              <div><span>Session</span><strong className="mono">{selected.session_id ? short_id(String(selected.session_id), 18) : "—"}</strong></div>
              <div><span>Node</span><strong className="mono">{selected.current_node || "—"}</strong></div>
              <div><span>Visible artifacts</span><strong>{selected_artifacts.toLocaleString()}</strong></div>
              <div><span>Provider calls</span><strong>{Number(selected.llm_calls || 0).toLocaleString()}</strong></div>
              <div><span>Tokens</span><strong>{Number(selected.tokens_total || 0).toLocaleString()}</strong></div>
            </div>
            {selected_session_id ? (
              <section className="runtime_ops_session_context">
                <div>
                  <span className="run_hero_eyebrow">Session context</span>
                  <strong className="mono">{short_id(selected_session_id, 30)}</strong>
                </div>
                <div className="runtime_ops_session_facts">
                  <span>{selected_session_runs.toLocaleString()} loaded run{selected_session_runs === 1 ? "" : "s"}</span>
                  <span>{selected_session_artifacts.toLocaleString()} visible artifact{selected_session_artifacts === 1 ? "" : "s"}</span>
                </div>
                <div className="runtime_detail_actions compact">
                  <button className="btn" onClick={() => props.on_filter_session_artifacts(selected_session_id)}>Open session artifacts</button>
                  <button className="btn" onClick={() => void copyText(selected_session_id)}>Copy session id</button>
                </div>
              </section>
            ) : null}
            {waiting ? (
              <div className="runtime_ops_wait_summary">
                <div className="runtime_ops_wait_header">
                  <span className="run_hero_eyebrow">Blocked on</span>
                  <strong>{selected_wait_blocker}</strong>
                </div>
                <p>{selected_wait_expected}</p>
                {selected_wait_request ? (
                  <div className="runtime_ops_wait_request">
                    <span>Request</span>
                    <Markdown text={selected_wait_request} />
                  </div>
                ) : (
                  <div className="runtime_ops_wait_request muted">
                    No explicit prompt is attached to this wait. Open Observe or the ledger for full run context before responding.
                  </div>
                )}
                {selected_tool_calls.length ? (
                  <div className="runtime_ops_wait_tools">
                    {selected_tool_calls.map((tc, idx) => (
                      <React.Fragment key={`${String((tc as any)?.name || "tool")}:${idx}`}>
                        <span className="chip mono warn">{String((tc as any)?.name || "tool")}</span>
                        {tool_risk_labels(tc).map((label) => (
                          <span key={`${idx}:${label}`} className="chip mono muted">{label}</span>
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                ) : null}
                <details className="runtime_raw_details">
                  <summary className="mono muted">Raw wait payload</summary>
                  <SharedJsonViewer value={waiting} collapseAfterDepth={3} showCopy={true} />
                </details>
              </div>
            ) : null}
            {run_error_label(selected) ? <div className="warn_callout">{run_error_label(selected)}</div> : null}
            <div className="runtime_detail_actions">
              <button className="btn primary" onClick={() => props.on_open_run(selected_run_id)}>Open Observe</button>
              <button className="btn" onClick={() => props.on_open_ledger(selected_run_id)}>Open ledger</button>
              <button className="btn" onClick={() => props.on_filter_artifacts(selected_run_id)}>Open artifacts</button>
              <button className="btn" onClick={props.on_open_logs}>Open logs</button>
              <button className="btn" onClick={() => void copyText(selected_run_id)}>Copy run id</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function RuntimeExplorerPage(props: {
  gateway_connected: boolean;
  tab: RuntimeTab;
  runs: RunSummary[];
  active_runs: RunSummary[];
  all_artifacts: RuntimeArtifact[];
  artifacts: RuntimeArtifact[];
  artifact_total_count: number;
  artifact_total_bytes: number;
  artifact_facets: Record<string, Record<string, number>>;
  artifact_type_facets: Record<string, Record<string, number>>;
  artifact_page: number;
  artifact_page_size: number;
  artifact_groups: Array<{ key: string; items: RuntimeArtifact[] }>;
  selected_artifact: RuntimeArtifact | null;
  embedded_preview: RuntimeEmbeddedPreview;
  loading: boolean;
  error: string;
  query: string;
  scope: "all" | "session" | "run";
  type_filters: RuntimeArtifactTypeFilter[];
  date_filter: RuntimeArtifactDateFilter;
  group_by: RuntimeArtifactGroupMode;
  sort_by: RuntimeArtifactSortMode;
  artifact_run_filter: string;
  audit_log_text: string;
  audit_log_meta: string;
  audit_log_loading: boolean;
  audit_log_error: string;
  workflow_label_by_id: Record<string, string>;
  run_by_id: Record<string, RunSummary>;
  selected_run_id: string;
  session_id: string;
  runtime_log_source: RuntimeLogSource;
  runtime_log_query: string;
  runtime_ledger_log_items: RuntimeLedgerLogItem[];
  runtime_ledger_log_meta: string;
  runtime_ledger_log_loading: boolean;
  runtime_ledger_log_error: string;
  on_tab_change: (tab: RuntimeTab) => void;
  on_query_change: (value: string) => void;
  on_scope_change: (value: "all" | "session" | "run") => void;
  on_session_filter_change: (session_id: string) => void;
  on_type_filters_change: (value: RuntimeArtifactTypeFilter[]) => void;
  on_date_filter_change: (value: RuntimeArtifactDateFilter) => void;
  on_group_by_change: (value: RuntimeArtifactGroupMode) => void;
  on_sort_by_change: (value: RuntimeArtifactSortMode) => void;
  on_artifact_page_change: (page: number) => void;
  on_artifact_run_filter_change: (run_id: string) => void;
  on_refresh_artifacts: () => void;
  on_refresh_audit: () => void;
  on_refresh_runtime_ledger: (run_id?: string) => void;
  on_runtime_log_source_change: (value: RuntimeLogSource) => void;
  on_runtime_log_query_change: (value: string) => void;
  on_select_run: (run_id: string) => void;
  on_select_artifact: (artifact_id: string) => void;
  on_preview_artifact: (artifact: RuntimeArtifact) => void;
  on_download_artifact: (artifact: RuntimeArtifact) => void;
  on_open_run: (run_id: string) => void;
  on_open_ledger: (run_id: string) => void;
  on_refresh_runs: () => void;
  on_reconnect: () => void;
  on_open_settings: () => void;
}): React.ReactElement {
  const selected = props.selected_artifact;
  const artifact_type_options: RuntimeArtifactTypeFilter[] = ["voice", "music", "sound", "recording", "audio", "image", "video", "markdown", "html", "json", "document", "code", "text", "other"];
  const artifact_date_options: Array<{ value: RuntimeArtifactDateFilter; label: string }> = [
    { value: "all", label: "Any time" },
    { value: "hour", label: "Last hour" },
    { value: "today", label: "Today" },
    { value: "week", label: "7 days" },
    { value: "month", label: "30 days" },
  ];
  const selected_type_filters = useMemo(() => new Set(props.type_filters), [props.type_filters]);
  const artifact_total_count = Math.max(0, Number(props.artifact_total_count || 0));
  const artifact_page_size = Math.max(1, Number(props.artifact_page_size || 500));
  const artifact_total_pages = Math.max(1, Math.ceil(artifact_total_count / artifact_page_size));
  const artifact_page = Math.min(Math.max(0, Number(props.artifact_page || 0)), artifact_total_pages - 1);
  const artifact_page_start = artifact_total_count ? artifact_page * artifact_page_size + 1 : 0;
  const artifact_page_end = Math.min(artifact_total_count, artifact_page * artifact_page_size + props.artifacts.length);
  const artifact_type_counts = useMemo(() => {
    const out: Partial<Record<RuntimeArtifactTypeFilter, number>> = {};
    const facets = props.artifact_type_facets && Object.keys(props.artifact_type_facets).length ? props.artifact_type_facets : props.artifact_facets;
    const semantic_counts = facets?.semantic_kind || {};
    const render_counts = facets?.render_kind || {};
    for (const kind of artifact_type_options) {
      out[kind] = Number(semantic_counts[kind] || render_counts[kind] || 0);
    }
    out.audio = Number(semantic_counts.audio || 0);
    out.other = Number(semantic_counts.other || 0) + Number(semantic_counts.artifact || 0) + Number(semantic_counts.binary || 0) + Number(semantic_counts["(none)"] || 0);
    return out;
  }, [props.artifact_facets, props.artifact_type_facets]);
  const toggle_type_filter = (kind: RuntimeArtifactTypeFilter) => {
    const next = new Set(selected_type_filters);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    props.on_type_filters_change(Array.from(next.values()));
  };
  const run_groups = useMemo(() => {
    const groups: Record<string, RunSummary[]> = { waiting: [], running: [], failed: [], cancelled: [], completed: [], other: [] };
    for (const r of props.runs) {
      const st = String(r.status || "").trim().toLowerCase();
      if (st === "waiting") groups.waiting.push(r);
      else if (st === "running") groups.running.push(r);
      else if (st === "failed") groups.failed.push(r);
      else if (st === "cancelled") groups.cancelled.push(r);
      else if (st === "completed") groups.completed.push(r);
      else groups.other.push(r);
    }
    return groups;
  }, [props.runs]);
  const selected_run_for_artifact = selected?.run_id ? props.run_by_id[selected.run_id] || null : null;
  const run_filter_label = props.artifact_run_filter
    ? run_workflow_label(props.run_by_id[props.artifact_run_filter], props.workflow_label_by_id)
    : "";
  const artifact_filter_runs = useMemo(() => {
    const ids = new Set<string>();
    const run_counts = props.artifact_facets?.run_id || {};
    for (const rid of Object.keys(run_counts)) {
      if (rid && rid !== "(none)") ids.add(rid);
    }
    for (const a of props.artifacts) if (a.run_id) ids.add(a.run_id);
    for (const r of props.active_runs) if (r.run_id) ids.add(String(r.run_id));
    return Array.from(ids)
      .map((rid) => props.run_by_id[rid] || ({ run_id: rid, workflow_id: null, status: "", created_at: null, updated_at: null } as RunSummary))
      .sort((a, b) => {
        const active_a = active_run_status(a.status) ? 0 : 1;
        const active_b = active_run_status(b.status) ? 0 : 1;
        if (active_a !== active_b) return active_a - active_b;
        const am = parse_iso_ms(a.updated_at || a.created_at) ?? 0;
        const bm = parse_iso_ms(b.updated_at || b.created_at) ?? 0;
        return bm - am;
      })
      .slice(0, 160);
  }, [props.artifacts, props.active_runs, props.run_by_id, props.artifact_facets]);
  const set_run_artifact_filter = (rid: string) => {
    props.on_artifact_run_filter_change(rid);
    props.on_session_filter_change("");
    props.on_scope_change(rid ? "run" : "all");
  };
  const runtime_metric_label = (value: number) => (props.gateway_connected ? Math.max(0, Number(value || 0)).toLocaleString() : "—");
  const selected_runtime_run = props.selected_run_id ? props.run_by_id[props.selected_run_id] || null : null;
  const runtime_log_rows = useMemo(() => {
    const q = props.runtime_log_query.trim().toLowerCase();
    const rows = props.runtime_ledger_log_items || [];
    if (!q) return rows;
    return rows.filter((item) => {
      const rec: any = item.record || {};
      const hay = [
        item.cursor,
        rec.run_id,
        rec.node_id,
        rec.status,
        rec.effect?.type,
        rec.started_at,
        rec.ended_at,
        safe_json_inline(rec.effect?.payload ?? {}, 900),
        safe_json_inline(rec.result ?? {}, 900),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [props.runtime_ledger_log_items, props.runtime_log_query]);
  const runtime_provider_rows = useMemo(() => {
    const q = props.runtime_log_query.trim().toLowerCase();
    const rows = build_provider_activities_from_ledger(props.runtime_ledger_log_items);
    if (!q) return rows;
    return rows.filter((a) =>
      [
        a.provider,
        a.model,
        a.run_id,
        a.node_id,
        a.status,
        a.error,
        a.prompt_preview,
        a.response_preview,
        a.tokens.prompt,
        a.tokens.completion,
        a.tokens.total,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [props.runtime_ledger_log_items, props.runtime_log_query]);
  const runtime_provider_token_total = runtime_provider_rows.reduce((n, a) => n + (Number(a.tokens.total) || 0), 0);
  const runtime_provider_issue_count = runtime_provider_rows.filter((a) => a.missing_response || a.error).length;
  const audit_log_lines = useMemo(() => {
    const q = props.runtime_log_query.trim().toLowerCase();
    const lines = String(props.audit_log_text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
    return q ? lines.filter((line) => line.toLowerCase().includes(q)) : lines;
  }, [props.audit_log_text, props.runtime_log_query]);
  const runtime_log_is_run_scoped = props.runtime_log_source === "run_ledger" || props.runtime_log_source === "provider_calls";
  const runtime_log_title =
    props.runtime_log_source === "run_ledger"
      ? "Selected Run Ledger"
      : props.runtime_log_source === "provider_calls"
        ? "Provider Calls"
        : "Gateway HTTP Audit";
  const runtime_log_description =
    props.runtime_log_source === "run_ledger"
      ? "Runtime execution records for the selected workflow run."
      : props.runtime_log_source === "provider_calls"
        ? "Model/provider call records extracted from the selected run ledger."
        : "Global Gateway HTTP/audit tail. This is system activity, not artifact provenance.";

  return (
    <div className="page runtime_page">
      <section className="runtime_header">
        <div>
          <div className="run_hero_eyebrow">Runtime explorer</div>
          <h2>{props.tab === "activity" ? "Activity monitor" : props.tab === "artifacts" ? "Artifact explorer" : "Runtime logs"}</h2>
          <div className="run_hero_meta">
            <span className={`status_pill ${props.gateway_connected ? "ok" : "warn"}`}>{props.gateway_connected ? "gateway connected" : "gateway offline"}</span>
            {props.tab === "artifacts" && props.artifact_run_filter ? <span className="mono">filtered run {short_id(props.artifact_run_filter, 18)}</span> : null}
            {props.session_id ? <span className="mono">session {short_id(props.session_id, 18)}</span> : null}
          </div>
        </div>
        <div className="metric_grid compact runtime_header_metrics">
          <div className="metric_tile">
            <span>Waiting</span>
            <strong>{runtime_metric_label(run_groups.waiting.length)}</strong>
          </div>
          <div className="metric_tile">
            <span>Running</span>
            <strong>{runtime_metric_label(run_groups.running.length)}</strong>
          </div>
          <div className="metric_tile">
            <span>Failed</span>
            <strong>{runtime_metric_label(run_groups.failed.length)}</strong>
          </div>
          <div className="metric_tile">
            <span>Artifacts</span>
            <strong>{runtime_metric_label(artifact_total_count)}</strong>
          </div>
        </div>
      </section>

      <nav className="runtime_mode_tabs" role="tablist" aria-label="Runtime sections">
        {(["activity", "artifacts", "logs"] as RuntimeTab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={props.tab === tab}
            className={`runtime_mode_tab ${props.tab === tab ? "active" : ""}`}
            onClick={() => props.on_tab_change(tab)}
          >
            <Icon name={tab === "activity" ? "history" : tab === "artifacts" ? "download" : "terminal"} size={14} />
            <span>{tab === "activity" ? "Activity" : tab === "artifacts" ? "Artifacts" : "Logs"}</span>
          </button>
        ))}
      </nav>

      {!props.gateway_connected ? (
        <div className="runtime_offline_banner" role="status">
          <div>
            <strong>Gateway offline</strong>
            <span>Runtime activity, artifacts, and logs are unavailable until the gateway reconnects.</span>
          </div>
          <div>
            <button className="btn primary" onClick={props.on_reconnect}>Reconnect</button>
            <button className="btn" onClick={props.on_open_settings}>Settings</button>
          </div>
        </div>
      ) : null}

      {props.error ? <div className="warn_callout">{props.error}</div> : null}

      {props.tab === "activity" ? (
        <RuntimeActivityConsole
          gateway_connected={props.gateway_connected}
          runs={props.runs}
          artifacts={props.artifacts}
          selected_run_id={props.selected_run_id}
          workflow_label_by_id={props.workflow_label_by_id}
          on_select_run={props.on_select_run}
          on_open_run={props.on_open_run}
          on_open_ledger={props.on_open_ledger}
          on_refresh_runs={props.on_refresh_runs}
          on_reconnect={props.on_reconnect}
          on_open_logs={() => props.on_tab_change("logs")}
          on_filter_artifacts={(rid) => {
            set_run_artifact_filter(rid);
            props.on_select_run(rid);
            props.on_tab_change("artifacts");
          }}
          on_filter_session_artifacts={(sid) => {
            if (!sid) return;
            props.on_artifact_run_filter_change("");
            props.on_session_filter_change(sid);
            props.on_scope_change("session");
            props.on_tab_change("artifacts");
          }}
        />
      ) : null}

      {props.tab === "artifacts" ? (
        <>
          <section className="runtime_artifact_toolbar" aria-label="Find artifacts">
            <div className="runtime_artifact_toolbar_top">
              <label className="artifact_filter_field artifact_filter_search">
                <span>Search</span>
                <input className="mono" value={props.query} onChange={(e) => props.on_query_change(e.target.value)} placeholder="title, path, hash, run, workflow, tag" />
              </label>
              <label className="artifact_filter_field">
                <span>Scope</span>
                <select
                  className="mono seg_select"
                  value={props.scope}
                  onChange={(e) => {
                    const next = e.target.value as "all" | "session" | "run";
                    if (next !== "run") props.on_artifact_run_filter_change("");
                    if (next === "session") props.on_session_filter_change(props.session_id);
                    else props.on_session_filter_change("");
                    props.on_scope_change(next);
                  }}
                >
                  <option value="all">All runtime</option>
                  <option value="session">This session</option>
                  <option value="run">Selected run</option>
                </select>
              </label>
              <label className="artifact_filter_field">
                <span>Group</span>
                <select className="mono seg_select" value={props.group_by} onChange={(e) => props.on_group_by_change(e.target.value as RuntimeArtifactGroupMode)}>
                  <option value="type">Type</option>
                  <option value="time">Date</option>
                  <option value="turn">Turn</option>
                  <option value="node">Node</option>
                  <option value="workflow">Workflow</option>
                  <option value="run">Run</option>
                  <option value="location">Location</option>
                  <option value="source">Source</option>
                </select>
              </label>
              <label className="artifact_filter_field">
                <span>Sort</span>
                <select className="mono seg_select" value={props.sort_by} onChange={(e) => props.on_sort_by_change(e.target.value as RuntimeArtifactSortMode)}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="last_access">Last accessed</option>
                  <option value="turn">Turn order</option>
                  <option value="type">Type</option>
                  <option value="size_desc">Largest</option>
                  <option value="size_asc">Smallest</option>
                </select>
              </label>
              <button className="btn btn_icon" onClick={props.on_refresh_artifacts} disabled={!props.gateway_connected || props.loading}>
                <Icon name="refresh" size={14} />
                {props.loading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="artifact_filter_section">
              <div className="artifact_filter_label">Type <span className="muted">OR</span></div>
              <div className="artifact_filter_chips" role="group" aria-label="Artifact type filters combine with OR">
                {artifact_type_options.map((kind) => {
                  const active = selected_type_filters.has(kind);
                  const count = artifact_type_counts[kind] || 0;
                  const label = runtime_type_filter_label(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${active ? "Remove" : "Add"} ${label} artifact type filter. Type filters combine with OR.`}
                      title={`${active ? "Remove" : "Add"} ${label}. Type filters combine with OR.`}
                      className={`artifact_filter_chip ${active ? "active" : ""}`}
                      onClick={() => toggle_type_filter(kind)}
                    >
                      <span>{label}</span>
                      <span className="mono">{props.gateway_connected ? count.toLocaleString() : "—"}</span>
                    </button>
                  );
                })}
                {props.type_filters.length ? <button type="button" className="artifact_filter_chip clear" onClick={() => props.on_type_filters_change([])}>Clear types</button> : null}
              </div>
            </div>
            <div className="artifact_filter_section">
              <div className="artifact_filter_label">Date</div>
              <div className="artifact_filter_chips" role="group" aria-label="Artifact date filters">
                {artifact_date_options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={props.date_filter === opt.value}
                    className={`artifact_filter_chip ${props.date_filter === opt.value ? "active" : ""}`}
                    onClick={() => props.on_date_filter_change(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <div className="artifact_scope_banner">
            {props.artifact_run_filter ? (
              <>
                Showing artifacts for <strong>{run_filter_label || short_id(props.artifact_run_filter, 18)}</strong>.
                <button className="btn" onClick={() => set_run_artifact_filter("")}>Show all</button>
              </>
            ) : (
              <>Showing artifacts across the selected runtime scope. Select a run to filter the inventory. {props.artifact_total_bytes ? <span className="mono muted">Total size {format_bytes(props.artifact_total_bytes)}</span> : null}</>
            )}
          </div>
          <div className="runtime_artifacts_layout">
            <aside className="artifact_filter_rail">
              <button className={`artifact_filter_run ${!props.artifact_run_filter ? "selected" : ""}`} onClick={() => set_run_artifact_filter("")}>
                <strong>All artifacts</strong>
                <span>{props.gateway_connected ? `${artifact_total_count.toLocaleString()} match${artifact_total_count === 1 ? "" : "es"}` : "counts unavailable"}</span>
              </button>
              {artifact_filter_runs.map((r) => {
                const rid = String(r.run_id || "").trim();
                const highlighted = rid === props.artifact_run_filter || rid === selected?.run_id;
                return (
                  <button key={rid} className={`artifact_filter_run ${highlighted ? "selected" : ""}`} onClick={() => set_run_artifact_filter(rid)} title={rid}>
                    <strong>{run_workflow_label(r, props.workflow_label_by_id)}</strong>
                    <span className="mono">{short_id(rid, 15)}</span>
                    <span>{run_duration_label(r)}</span>
                  </button>
                );
              })}
            </aside>
            <section className="runtime_artifact_browser">
          <div className="overview_panel_header artifact_browser_header">
            <div>
              <h3>Artifact Explorer</h3>
              <span className="mono muted">
                {artifact_total_count
                  ? `${artifact_page_start.toLocaleString()}-${artifact_page_end.toLocaleString()} of ${artifact_total_count.toLocaleString()}`
                  : "0 items"}
              </span>
            </div>
            {artifact_total_pages > 1 ? (
              <div className="artifact_pagination" aria-label="Artifact pages">
                <button className="btn" onClick={() => props.on_artifact_page_change(0)} disabled={artifact_page <= 0}>First</button>
                <button className="btn" onClick={() => props.on_artifact_page_change(artifact_page - 1)} disabled={artifact_page <= 0}>Prev</button>
                <span className="mono muted">Page {(artifact_page + 1).toLocaleString()} / {artifact_total_pages.toLocaleString()}</span>
                <button className="btn" onClick={() => props.on_artifact_page_change(artifact_page + 1)} disabled={artifact_page >= artifact_total_pages - 1}>Next</button>
                <button className="btn" onClick={() => props.on_artifact_page_change(artifact_total_pages - 1)} disabled={artifact_page >= artifact_total_pages - 1}>Last</button>
              </div>
            ) : null}
          </div>
          {!props.artifact_groups.length ? (
            <div className="empty_state_inline">
              {props.gateway_connected ? "No artifacts match the current filters." : "Gateway offline. Artifact inventory cannot be loaded until the connection is restored."}
            </div>
          ) : null}
          <div className="artifact_group_list">
            {props.artifact_groups.map((group) => (
              <section key={group.key} className="artifact_group">
                <div className="artifact_group_header">
                  <span>{group.key}</span>
                  <span className="mono">{group.items.length}</span>
                </div>
                {group.items.map((a) => {
	                  const row_run = a.run_id ? props.run_by_id[a.run_id] || null : null;
	                  const workflow_label = row_run ? run_workflow_label(row_run, props.workflow_label_by_id) : artifact_workflow_ref(a);
	                  const media_fact = artifact_media_fact_label(a);
	                  const access_count = Number(a.access?.access_count || 0) || 0;
	                  return (
                    <button
                      key={a.artifact_id}
                      className={`artifact_row ${selected?.artifact_id === a.artifact_id ? "selected" : ""}`}
                      onClick={() => {
                        props.on_select_artifact(a.artifact_id);
                        if (a.run_id) props.on_select_run(a.run_id);
                      }}
                      title={a.artifact_id}
                    >
                      <ArtifactGlyph artifact={a} size={18} />
                      <div className="artifact_row_main">
	                        <div className="artifact_row_title">
	                          <strong>{artifact_human_title(artifact_with_runtime_context(a, props.run_by_id, props.workflow_label_by_id))}</strong>
	                          <span className="artifact_type_badge">{artifact_semantic_label(a)}</span>
	                          {a.render_kind && a.render_kind !== a.semantic_kind ? <span className="artifact_type_badge muted">{a.render_kind}</span> : null}
	                          {a.legacy_inferred ? <span className="artifact_type_badge inferred">legacy inferred</span> : null}
	                        </div>
	                        <div className="artifact_row_facts">
	                          <span><b>Created</b> {artifact_created_label(a)}</span>
	                          <span><b>Size</b> {format_bytes(a.size_bytes)}</span>
	                          <span><b>Last seen</b> {artifact_last_seen_label(a)}</span>
	                          {access_count ? <span><b>Accesses</b> {access_count.toLocaleString()}</span> : null}
	                          {media_fact ? <span><b>Media</b> {media_fact}</span> : null}
	                          {a.content_type ? <span><b>MIME</b> {a.content_type}</span> : null}
                        </div>
                        <div className="artifact_row_facts secondary">
                          {workflow_label ? <span><b>Workflow</b> {workflow_label}</span> : null}
                          {a.run_id ? <span className="mono"><b>Run</b> {short_id(a.run_id, 13)}</span> : null}
                          <span><b>Turn</b> {artifact_turn_label(a)}</span>
                          {artifact_node_label(a) ? <span className="mono"><b>Node</b> {artifact_node_label(a)}</span> : null}
                          {artifact_origin_label(a) ? <span><b>Source</b> {artifact_origin_label(a)}</span> : null}
                        </div>
                        <div className="artifact_row_facts tertiary">
                          <span className="mono"><b>ID</b> {short_id(a.artifact_id, 22)}</span>
                          <span><b>Provenance</b> {artifact_provenance_label(a)}</span>
                        </div>
                        {artifact_path_label(a) ? <div className="artifact_row_path mono">{artifact_path_label(a)}</div> : null}
                      </div>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
            </section>

            <aside className="runtime_detail">
              <section className="overview_panel runtime_artifact_detail">
            <div className="overview_panel_header">
              <h3>Artifact Detail</h3>
              {selected ? <span className="chip mono muted">{props.embedded_preview.render_kind ? artifact_display_type_label_for(selected, props.run_by_id, props.workflow_label_by_id, props.embedded_preview.text) : artifact_display_type_label_for(selected, props.run_by_id, props.workflow_label_by_id)}</span> : null}
            </div>
            {!selected ? (
              <div className="empty_state_inline">Select an artifact to inspect metadata, preview, or download content.</div>
            ) : (
              <>
                {(() => {
                  const prompt = artifact_generation_prompt(selected);
                  const provider_model = artifact_provider_model_label(selected);
                  const media_fact = artifact_media_fact_label(selected);
                  const access_count = Number(selected.access?.access_count || 0) || 0;
                  const provider_trace_link = first_string(selected.links?.provider_trace, selected.links?.provider_trace_url, selected.links?.provider_trace_id);
                  const audit_link = first_string(selected.links?.audit, selected.links?.audit_tail, selected.links?.audit_url);
                  return (
                    <>
                <div className="artifact_detail_header">
                  <ArtifactGlyph artifact={selected} size={22} />
                  <div>
                    <div className="artifact_detail_title">{artifact_human_title(artifact_with_runtime_context(selected, props.run_by_id, props.workflow_label_by_id))}</div>
                    <div className="artifact_detail_subtitle">
                      {artifact_semantic_label(selected)} • {selected.render_kind || props.embedded_preview.render_kind || selected.modality || "artifact"} • {selected.content_type || "unknown MIME"} • {format_bytes(selected.size_bytes)}
                      {selected.legacy_inferred ? " • legacy inferred" : ""}
                    </div>
                  </div>
                </div>
                <RuntimeInlinePreview artifact={selected} preview={props.embedded_preview} />
                <div className="artifact_detail_grid">
                  <div><span>Semantic type</span><strong>{artifact_semantic_label(selected)}</strong></div>
                  <div><span>Render kind</span><strong>{selected.render_kind || props.embedded_preview.render_kind || "—"}</strong></div>
                  <div><span>Created</span><strong>{display_datetime(selected.created_at)}</strong></div>
                  <div><span>Size</span><strong>{format_bytes(selected.size_bytes)}</strong></div>
                  <div><span>Last seen</span><strong>{artifact_last_seen_label(selected)}</strong></div>
                  <div><span>Accesses</span><strong>{access_count ? access_count.toLocaleString() : "—"}</strong></div>
                  <div><span>Run</span><strong className="mono">{selected.run_id ? short_id(selected.run_id, 24) : "—"}</strong></div>
                  <div><span>Workflow</span><strong>{selected_run_for_artifact ? run_workflow_label(selected_run_for_artifact, props.workflow_label_by_id) : "—"}</strong></div>
                  <div><span>Turn</span><strong>{artifact_turn_label(selected)}</strong></div>
                  <div><span>Node</span><strong className="mono">{artifact_node_label(selected) || "—"}</strong></div>
                  <div><span>Provider/model</span><strong>{provider_model || "—"}</strong></div>
                  <div><span>Media facts</span><strong>{media_fact || "—"}</strong></div>
                  <div><span>Trace</span><strong>{selected.provider_trace_available ? "available" : "not recorded"}</strong></div>
                  <div><span>Provenance</span><strong>{artifact_provenance_label(selected)}</strong></div>
                  <div><span>Artifact id</span><strong className="mono">{short_id(selected.artifact_id, 30)}</strong></div>
                  {selected.sha256 ? <div><span>sha256</span><strong className="mono">{short_id(selected.sha256, 30)}</strong></div> : null}
                </div>
                {prompt ? (
                  <div className="artifact_provenance_panel">
                    <div className="artifact_filter_label">Generation prompt / input</div>
                    <div className="artifact_prompt_text">{prompt}</div>
                  </div>
                ) : (
                  <div className="artifact_provenance_panel muted">
                    <div className="artifact_filter_label">Generation prompt / input</div>
                    <div className="artifact_prompt_text">Generation prompt not recorded by the runtime artifact descriptor.</div>
                  </div>
                )}
                {Object.keys(selected.generation || {}).length || Object.keys(selected.producer || {}).length ? (
                  <details className="runtime_raw_details">
                    <summary className="mono muted">Generation and producer metadata</summary>
                    <SharedJsonViewer value={{ generation: selected.generation, producer: selected.producer, source_refs: selected.source_refs }} collapseAfterDepth={3} showCopy={true} />
                  </details>
                ) : null}
                {selected.source_path ? <div className="artifact_detail_path mono">{selected.source_path}</div> : null}
                <div className="runtime_detail_actions">
                  <button className="btn primary" onClick={() => props.on_preview_artifact(selected)} disabled={!selected.run_id}>
                    {props.embedded_preview.render_kind === "html" ? "Open as web page" : "Open full preview"}
                  </button>
                  <button className="btn" onClick={() => props.on_download_artifact(selected)} disabled={!selected.run_id}>
                    Download
                  </button>
                  <button className="btn" onClick={() => set_run_artifact_filter(selected.run_id)} disabled={!selected.run_id}>
                    Show run artifacts
                  </button>
                  <button className="btn" onClick={() => props.on_open_run(selected.run_id)} disabled={!selected.run_id}>
                    Open in Observe
                  </button>
                  <button className="btn" onClick={() => props.on_open_ledger(selected.run_id)} disabled={!selected.run_id}>
                    Open run ledger
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (provider_trace_link) window.open(provider_trace_link, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!provider_trace_link}
                  >
                    Open provider trace
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (audit_link) window.open(audit_link, "_blank", "noopener,noreferrer");
                      else props.on_tab_change("logs");
                    }}
                    disabled={!audit_link && !selected.audit_available}
                  >
                    Open audit trail
                  </button>
                  <button className="btn" onClick={() => void copyText(selected.artifact_id)} disabled={!selected.artifact_id}>
                    Copy artifact id
                  </button>
                </div>
                    </>
                  );
                })()}
                <details className="runtime_raw_details">
                  <summary className="mono muted">Raw metadata</summary>
                  <SharedJsonViewer value={selected.raw} collapseAfterDepth={3} showCopy={true} />
                </details>
              </>
            )}
              </section>
            </aside>
          </div>
        </>
      ) : null}

	      {props.tab === "logs" ? (
	        <section className="overview_panel runtime_logs_panel">
	          <div className="overview_panel_header">
	            <div>
	              <h3>{runtime_log_title}</h3>
	              <div className="mono muted">{runtime_log_description}</div>
	            </div>
	            <div className="actions" style={{ marginTop: 0 }}>
	              {runtime_log_is_run_scoped && props.runtime_ledger_log_meta ? <span className="mono muted">{props.runtime_ledger_log_meta}</span> : null}
	              {props.runtime_log_source === "gateway_audit" && props.audit_log_meta ? <span className="mono muted">{props.audit_log_meta}</span> : null}
	              <button
	                className="btn btn_icon"
	                onClick={() => {
	                  if (runtime_log_is_run_scoped) props.on_refresh_runtime_ledger(props.selected_run_id);
	                  else props.on_refresh_audit();
	                }}
	                disabled={runtime_log_is_run_scoped ? props.runtime_ledger_log_loading : props.audit_log_loading}
	              >
	                <Icon name="refresh" size={14} />
	                {runtime_log_is_run_scoped ? (props.runtime_ledger_log_loading ? "Loading…" : "Refresh") : props.audit_log_loading ? "Loading…" : "Refresh"}
	              </button>
	            </div>
	          </div>
          <div className="runtime_log_toolbar">
            <div className="seg_toggle mono">
	              <button className={`seg_btn ${props.runtime_log_source === "run_ledger" ? "active" : ""}`} onClick={() => props.on_runtime_log_source_change("run_ledger")}>
	                Run ledger
	              </button>
	              <button className={`seg_btn ${props.runtime_log_source === "provider_calls" ? "active" : ""}`} onClick={() => props.on_runtime_log_source_change("provider_calls")}>
	                Provider calls
	              </button>
	              <button className={`seg_btn ${props.runtime_log_source === "gateway_audit" ? "active" : ""}`} onClick={() => props.on_runtime_log_source_change("gateway_audit")}>
	                Gateway audit
	              </button>
            </div>
            <input
              className="mono"
              value={props.runtime_log_query}
              onChange={(e) => props.on_runtime_log_query_change(e.target.value)}
              placeholder="Search node, status, effect, payload, error"
            />
          </div>

	          {props.runtime_log_source === "run_ledger" ? (
	            <>
	              <div className="runtime_log_context">
	                <div>
                  <span>Selected run</span>
                  <strong>{selected_runtime_run ? run_workflow_label(selected_runtime_run, props.workflow_label_by_id) : props.selected_run_id ? short_id(props.selected_run_id, 24) : "No run selected"}</strong>
                  {props.selected_run_id ? <em className="mono">{short_id(props.selected_run_id, 34)}</em> : null}
                </div>
                <div>
                  <span>Session</span>
                  <strong className="mono">{selected_runtime_run?.session_id ? short_id(String(selected_runtime_run.session_id), 28) : props.session_id ? short_id(props.session_id, 28) : "—"}</strong>
                </div>
                <div className="runtime_log_context_actions">
                  <button className="btn" onClick={() => props.on_open_run(props.selected_run_id)} disabled={!props.selected_run_id}>Open Observe</button>
                  <button className="btn" onClick={() => set_run_artifact_filter(props.selected_run_id)} disabled={!props.selected_run_id}>Run artifacts</button>
                </div>
              </div>
              {props.runtime_ledger_log_error ? <div className="warn_callout">{props.runtime_ledger_log_error}</div> : null}
              {!props.selected_run_id ? <div className="empty_state_inline">Select a run in Activity or Artifact Explorer to inspect its runtime ledger.</div> : null}
              {props.selected_run_id && !runtime_log_rows.length && !props.runtime_ledger_log_loading ? <div className="empty_state_inline">No ledger records match the current search.</div> : null}
              <div className="runtime_log_event_list" aria-label="Selected run ledger records">
                {runtime_log_rows.map((item) => {
                  const rec: any = item.record || {};
                  const effect_type = String(rec?.effect?.type || "").trim();
                  const status = String(rec?.status || "").trim();
	                  const node_id = String(rec?.node_id || "").trim();
	                  const ts = first_string(rec?.ended_at, rec?.started_at, rec?.ts);
	                  const wait = extract_wait_from_record(rec);
	                  const human_summary = ledger_record_human_summary(rec);
	                  const payload_preview = effect_type ? clamp_preview(safe_json_inline(rec?.effect?.payload ?? {}, 1200), { max_chars: 1200, max_lines: 6 }) : "";
	                  const outcome =
	                    extract_response_text_from_record(rec) ||
	                    (wait ? `Waiting for ${String(wait.reason || "input")}` : "") ||
                    (rec?.result !== undefined ? safe_json_inline(rec.result, 700) : "");
                  return (
                    <article key={`${props.selected_run_id}:${item.cursor}`} className={`runtime_log_event ${run_status_class(status)}`}>
                      <div className="runtime_log_event_header">
                        <span className="mono">#{item.cursor}</span>
                        <RunStatusPill status={status || "record"} />
                        {effect_type ? <span className="chip mono muted">{effect_type}</span> : null}
                        {node_id ? <strong className="mono">{node_id}</strong> : null}
                        {ts ? <span className="mono muted">{display_datetime(ts)}</span> : null}
                      </div>
	                      <div className="runtime_log_event_body">
	                        <div>
	                          <span>Request / activity</span>
	                          <p>{[human_summary || format_step_summary(rec as StepRecord), payload_preview && payload_preview !== "{}" ? payload_preview : ""].filter(Boolean).join("\n")}</p>
	                        </div>
                        <div>
                          <span>Outcome</span>
                          <p>{clamp_preview(outcome || "—", { max_chars: 1200, max_lines: 6 })}</p>
                        </div>
                      </div>
                      <details className="runtime_raw_details">
                        <summary className="mono muted">Raw ledger record</summary>
                        <SharedJsonViewer value={rec} collapseAfterDepth={3} showCopy={true} />
                      </details>
                    </article>
                  );
	                })}
	              </div>
	            </>
	          ) : props.runtime_log_source === "provider_calls" ? (
	            <>
	              <div className="runtime_log_context">
	                <div>
	                  <span>Selected run</span>
	                  <strong>{selected_runtime_run ? run_workflow_label(selected_runtime_run, props.workflow_label_by_id) : props.selected_run_id ? short_id(props.selected_run_id, 24) : "No run selected"}</strong>
	                  {props.selected_run_id ? <em className="mono">{short_id(props.selected_run_id, 34)}</em> : null}
	                </div>
	                <div>
	                  <span>Provider calls</span>
	                  <strong>{runtime_provider_rows.length.toLocaleString()}</strong>
	                  <em className="mono">{runtime_provider_token_total ? `${runtime_provider_token_total.toLocaleString()} tokens` : "tokens not recorded"}</em>
	                </div>
	                <div>
	                  <span>Issues</span>
	                  <strong>{runtime_provider_issue_count.toLocaleString()}</strong>
	                </div>
	                <div className="runtime_log_context_actions">
	                  <button className="btn" onClick={() => props.on_open_run(props.selected_run_id)} disabled={!props.selected_run_id}>Open Observe</button>
	                  <button className="btn" onClick={() => props.on_runtime_log_source_change("run_ledger")} disabled={!props.selected_run_id}>Run ledger</button>
	                </div>
	              </div>
	              {props.runtime_ledger_log_error ? <div className="warn_callout">{props.runtime_ledger_log_error}</div> : null}
	              {!props.selected_run_id ? <div className="empty_state_inline">Select a run in Activity or Artifact Explorer to inspect provider calls.</div> : null}
	              {props.selected_run_id && !runtime_provider_rows.length && !props.runtime_ledger_log_loading ? (
	                <div className="empty_state_inline">No provider calls are present in the selected run ledger, or none match the current search.</div>
	              ) : null}
	              <div className="provider_activity_list runtime_provider_log_list">
	                {runtime_provider_rows.map((a) => (
	                  <article key={a.id} className={`provider_activity ${a.error || a.missing_response ? "danger" : ""}`}>
	                    <div className="provider_activity_header">
	                      <div>
	                        <h4>{[a.provider || "provider unknown", a.model || "model unknown"].join(" / ")}</h4>
	                        <div className="timeline_subtitle">
	                          {a.node_id ? <span className="mono">{a.node_id}</span> : null}
	                          {a.run_id ? <span className="mono">{short_id(a.run_id, 16)}</span> : null}
	                          <span>{format_duration_ms(a.duration_ms)}</span>
	                          {a.status ? <RunStatusPill status={a.status} /> : null}
	                        </div>
	                      </div>
	                      <div className="provider_tokens mono">
	                        {a.tokens.total ? a.tokens.total.toLocaleString() : "—"} tokens
	                      </div>
	                    </div>
	                    <div className="provider_preview_grid">
	                      <div>
	                        <span>Prompt / messages</span>
	                        <p>{a.prompt_preview || "No prompt payload captured"}</p>
	                      </div>
	                      <div>
	                        <span>Response / error</span>
	                        <p>{a.response_preview || a.error || "No response captured"}</p>
	                      </div>
	                    </div>
	                    <details className="runtime_raw_details">
	                      <summary className="mono muted">Raw provider ledger record</summary>
	                      <SharedJsonViewer value={a.raw} collapseAfterDepth={3} showCopy={true} />
	                    </details>
	                  </article>
	                ))}
	              </div>
	            </>
	          ) : (
            <>
              {props.audit_log_error ? <div className="warn_callout">{props.audit_log_error}</div> : null}
              <pre className="mono audit_log_tail">{audit_log_lines.length ? audit_log_lines.join("\n") : "(audit tail not loaded or no lines match search)"}</pre>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   LedgerCard — visual step card for the observe ledger.
   Structured layout: header row (title + status + time), meta chips,
   optional preview, and compact action buttons.
   -------------------------------------------------------------------------- */
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
  const status_cls =
    st === "completed" ? "ok" : st === "failed" ? "danger" : st === "waiting" ? "warn" : st === "running" ? "info" : "muted";

  const response_text = extract_response_text_from_record(item.data);
  const has_response = Boolean(response_text && response_text.trim());
  const when = format_time_ago(item.ts);

  return (
    <div className={`lc ${status_cls}`} style={{ ["--lc-accent" as any]: accent }}>
      <div className="lc_header">
        <span className="lc_title">{display_label}</span>
        <div className="lc_header_right">
          {status ? <span className={`lc_status ${status_cls}`}>{status}</span> : null}
          <span className="lc_time" title={item.ts}>{when}</span>
      </div>
      </div>
      <div className="lc_meta">
        {node_type ? <span className="lc_chip">{node_type}</span> : null}
        {item.effect_type ? <span className="lc_chip">{String(item.effect_type)}</span> : null}
        {item.cursor ? <span className="lc_chip">#{item.cursor}</span> : null}
        {item.run_id ? <span className="lc_chip">{short_id(String(item.run_id), 10)}</span> : null}
        {item.kind !== "step" && node_id ? <span className="lc_chip">{node_id}</span> : null}
      </div>
      {item.preview ? <div className="lc_preview">{item.preview}</div> : null}
      {item.data ? (
        <div className="lc_actions">
          {has_response ? (
            <>
              <button className="lc_btn" onClick={props.on_toggle_response}>{props.response_open ? "Fold Response" : "Unfold Response"}</button>
              <button className="lc_btn" onClick={() => props.on_copy(String(response_text || ""))}>Copy Response</button>
            </>
          ) : null}
          <button className="lc_btn" onClick={props.on_toggle}>{props.open ? "Fold JSON" : "Unfold JSON"}</button>
          <button className="lc_btn" onClick={() => { try { props.on_copy(JSON.stringify(item.data, null, 2)); } catch { props.on_copy(String(item.data)); } }}>Copy JSON</button>
        </div>
      ) : null}
      {props.response_open && has_response ? (
        <div className="lc_body"><Markdown text={String(response_text || "")} /></div>
      ) : null}
      {props.open && item.data ? (
        <div className="lc_body lc_body_json mono"><SharedJsonViewer value={item.data} collapseAfterDepth={3} showCopy={false} /></div>
      ) : null}
    </div>
  );
}
