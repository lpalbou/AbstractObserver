import React, { useEffect, useMemo, useRef, useState } from "react";

import { AgentCyclesPanel, build_agent_trace, type LedgerRecordItem } from "@abstractframework/monitor-flow";
import "@abstractframework/monitor-flow/agent_cycles.css";
import {
  ChatComposer,
  ChatThread,
  JsonViewer as SharedJsonViewer,
  Markdown,
  chatToMarkdown,
  copyText,
  downloadTextFile,
  type ChatMessage,
} from "@abstractframework/panel-chat";
import {
  AfAppearanceDialog,
  AfSelect,
  AfTopBarActions,
  GatewayConnectModal,
  Icon,
  ProviderModelSelect,
  SteerComposer,
  gatewayStatusBadge,
  useAppearanceSettings,
  useGatewayConnection,
  type AfSelectOption,
  type GatewayConnectionState,
  type ProviderOption,
} from "@abstractframework/ui-kit";
import { AppAssistantDrawer } from "./app_assistant";
import { registerMonitorGpuWidget } from "@abstractframework/monitor-gpu";

import "./forms.css";

import "./observe.css";

import {
  active_run_status,
  clamp_preview,
  format_time_ago,
  format_time_until_from_ms,
  now_iso,
  parse_iso_ms,
  run_duration_label,
  safe_json,
  safe_json_inline,
  sanitize_filename_part,
  short_id,
  terminal_run_status,
} from "./format";
import {
  artifact_display_type_label_for,
  artifact_with_runtime_context,
  artifact_facets_from_search_response,
  artifact_group_key,
  artifact_label,
  format_bytes,
  normalize_artifact_item,
  runtime_created_after_for_filter,
  runtime_sort_gateway_params,
  type RuntimeArtifact,
  type RuntimeArtifactDateFilter,
  type RuntimeArtifactGroupMode,
  type RuntimeArtifactSortMode,
  type RuntimeArtifactTypeFilter,
} from "./artifacts";
import {
  RunStatusPill,
  extract_conversation_context,
  is_generic_wait_prompt,
  run_workflow_label,
  TOOL_RISK_INFERRED_TITLE,
  tool_risk_labels,
  wait_blocker_title,
  wait_expected_action,
  wait_request_detail,
  wait_json_value,
} from "./run_labels";
import {
  build_provider_activities_from_ledger,
  extract_response_text_from_record,
  extract_textish,
  format_step_summary,
  is_waiting_status,
  ledger_record_human_summary,
  type ProviderActivity,
  type LatestRunSummary,
  type UiLogItem,
} from "./ledger_views";
import { RuntimeStructuredTextPreview, type RuntimeEmbeddedPreview } from "./artifact_previews";
import { RuntimeExplorerPage, type RuntimeLedgerLogItem, type RuntimeLogSource, type RuntimeTab } from "./runtime_page";
import {
  AskForm,
  LedgerCard,
  RunOverviewPanel,
  WorkflowRunNavigator,
} from "./run_panels";
import { GatewayClient } from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import { McpWorkerClient } from "../lib/mcp_worker_client";
import { extract_emit_event, extract_tool_calls_from_wait, extract_wait_from_record } from "../lib/runtime_extractors";
import { LedgerStreamEvent, StepRecord, ToolCall, ToolResult, WaitState } from "../lib/types";
import { RecordBuffer } from "./record_buffer";
import {
  artifact_preview_kind,
  artifact_text_render_kind,
  type ArtifactPreviewKind,
} from "./artifact_rendering";
import { FlowGraph } from "./flow_graph";
import { MindmapPanel } from "./mindmap_panel";
import { MissionControlPage, derive_phase_graph, extract_dreams_brief, extract_open_briefs, type EntityTile as BoardEntityTile, type PhaseGraph } from "./mission_control";
import { Modal } from "./modal";
import { MultiSelect } from "./multi_select";
import { type RuntimeMetadata } from "./runtime_metadata";
import { run_status_class, run_status_word, type RunFilterMode, type RunSummary, type RunTreeSection } from "./run_status";
import { useGatewayVoice } from "./use_gateway_voice";
import "./system.css";
// Usability layer LAST: it corrects actionable-information presentation and
// must win equal-specificity fights with every page sheet above.
import "./usability.css";

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
  assistant_skill_names: string[];
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
  /** True when the entrypoint declares at least one interface contract —
   * the launchable set (operator 2026-07-14: Launch surfaces ONLY
   * executable workflows; interface-less scratch bundles stay out of the
   * picker but keep their labels for run display). */
  has_interface: boolean;
};

/* Observe content tabs — Story (overview), Ledger, Flow (graph), Ask (chat). */
type ObserveRightTab = "overview" | "ledger" | "graph" | "chat";


const RUNTIME_ARTIFACT_PAGE_SIZE = 500;
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080";


// === UI feature flags (runtime config injected by CLI) ===
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
      assistant_skill_names: Array.isArray(parsed?.assistant_skill_names) ? parsed.assistant_skill_names.map((x: any) => String(x || "").trim()).filter(Boolean) : [],
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
      assistant_skill_names: [],
      maintenance_ai_model: "",
    };
  }
}

function save_settings(s: Settings): void {
  localStorage.setItem("abstractobserver_settings", JSON.stringify({ ...s, auth_token: "" }));
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
  const [page, set_page] = useState<"board" | "observe" | "launch" | "runtime" | "settings">("board");

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
  // SHARED SIGN-IN (maintainer directive 2026-07-12 + B5 ruling 2026-07-13
  // "login/auth should be consistent across apps"): the uic
  // useGatewayConnection hook IS the connection state machine (boot probe,
  // auto-open on resolved disconnect, close on sign-in transition, episode
  // re-arm) — this app only reacts to status transitions (discovery /
  // disconnect) and never hand-rolls the modal lifecycle again. Tokens
  // exchange for HTTP-only session cookies inside the modal — never here.
  const gateway_connection = useGatewayConnection({
    appName: "AbstractObserver",
    variant: "dismissable",
    defaultGatewayUrl:
      (typeof window !== "undefined" && window.__ABSTRACT_UI_CONFIG__?.gateway_url) || DEFAULT_GATEWAY_URL,
    onStatusChange: (s) => handle_connection_status(s),
  });
  const [connection_status, set_connection_status] = useState<GatewayConnectionState | null>(null);
  /* Skills inventory for the Assistant section (feature-detected: the
   * gateway may not serve the abstractskill shelf yet — null renders the
   * honest absent state, never a fabricated list). */
  const [assistant_skills, set_assistant_skills] = useState<Array<{ name: string; description?: string; version?: string; trust_level?: string; blocked?: boolean; requires_review?: boolean; tree_hash?: string; reasons?: string[] }> | null>(null);
  const [assistant_skills_probed, set_assistant_skills_probed] = useState(false);
  /** Feature-detected MCP server inventory (null = gateway doesn't serve
   * one yet — Launch renders the honest absent state). */
  const [gateway_mcp_servers, set_gateway_mcp_servers] = useState<Array<{ name: string; url?: string; description?: string }> | null>(null);
  /** Run-level skills selection for the NEXT launch (rides
   * input_data.skills — the 0087 lane). Reset with the workflow. */
  const [launch_skills, set_launch_skills] = useState<string[]>([]);
  /* Unified top-right cluster (operator directive + plans/unified-top-bar.md):
   * assistant drawer + shared appearance dialog + the ONE disconnect pill.
   * Appearance persistence is the kit's per-app hook (theme/font/header
   * applied synchronously at first paint; migrates once from the old
   * settings blob). */
  const [appearance, set_appearance] = useAppearanceSettings("abstractobserver", { legacyKey: "abstractobserver_settings" });
  const [appearance_open, set_appearance_open] = useState(false);
  const [assistant_open, set_assistant_open] = useState(false);
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
  /* Gateway 429 courtesy (operator 2026-07-15): while the auth-lockout
   * window is open, every poller stands down instead of keeping the lock
   * warm. until=epoch-ms gate; backoff doubles 15s→120s, reset on success. */
  const rate_limited_until_ref = useRef(0);
  const rate_limit_backoff_ref = useRef(0);
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
  const [ledger_condensed, set_ledger_condensed] = useState(true);
  const [ledger_view, set_ledger_view] = useState<"steps" | "cycles">("steps");
  const [ledger_cycles_run_id, set_ledger_cycles_run_id] = useState<string>("");
  const [session_attachments_run_id, set_session_attachments_run_id] = useState<string>("");
  const [session_attachments, set_session_attachments] = useState<any[]>([]);
  const [session_attachments_loading, set_session_attachments_loading] = useState(false);
  const [session_attachments_error, set_session_attachments_error] = useState<string>("");
  /* Run workspace + durable artifacts (operator 2026-07-15): the folder
   * button reveals the run's workspace locally; the Story lists what the
   * runtime durably recorded for THIS run. */
  const [run_workspace_root, set_run_workspace_root] = useState<string>("");
  const [run_artifacts, set_run_artifacts] = useState<any[]>([]);
  const [run_artifacts_loading, set_run_artifacts_loading] = useState(false);
  const [run_artifacts_error, set_run_artifacts_error] = useState<string>("");
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
    return () => {
      if (abort_ref.current) abort_ref.current.abort();
      if (child_abort_ref.current) child_abort_ref.current.abort();
      if (status_timer_ref.current) window.clearTimeout(status_timer_ref.current);
      if (status_pulse_timer_ref.current) window.clearTimeout(status_pulse_timer_ref.current);
      if (recent_prune_timer_ref.current) window.clearTimeout(recent_prune_timer_ref.current);
      if (dismiss_timer_ref.current) window.clearTimeout(dismiss_timer_ref.current);
    };
  }, []);

  // BOOT: the uic useGatewayConnection hook owns the probe + modal machine
  // (B5, 2026-07-13) — its status callback runs session discovery and the
  // direct-dev fallback. No app-side boot effect remains; the old
  // auto_connect_gateway toggle is superseded by the ruled contract
  // (signed-out is a sign-in screen, never a dead app).

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

  /* LAUNCHABLE SET (operator 2026-07-14): the Launch picker surfaces only
   * entrypoints that declare an interface contract — scratch/dev bundles
   * (test, yoda, basic…) publish none and are not operator-facing. The
   * FULL option list stays for run labels, so runs of unlisted bundles
   * still display their names everywhere else. */
  const launchable_workflow_options = useMemo(
    () => workflow_options.filter((w) => w.has_interface),
    [workflow_options],
  );

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
      // AS TYPED (operator 2026-07-15: "the space key doesn't work"): this
      // ran on EVERY keystroke of a controlled input, so trimming here ate
      // the trailing space the user just typed. Whitespace hygiene belongs
      // at SUBMIT (build_launch_input_data), never mid-edit.
      if (!value) delete obj[k];
      else obj[k] = value;
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
        // Deprecated entrypoints are not launch candidates.
        if (ep?.deprecated === true) continue;
        const workflow_id = `${bid}:${fid}`;
        const name = String(ep?.name || "").trim();
        const label = name ? `${bid} · ${name}` : `${bid} · ${fid}`;
        const description = String(ep?.description || "").trim();
        const interfaces = Array.isArray(ep?.interfaces) ? ep.interfaces : [];
        const has_interface = interfaces.some((i: any) => String(i || "").trim().length > 0);
        out.push({ workflow_id, bundle_id: bid, flow_id: fid, label, description: description || undefined, has_interface });
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
      // First success clears any rate-limit backoff.
      rate_limit_backoff_ref.current = 0;
      rate_limited_until_ref.current = 0;
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      push_log({ ts: now_iso(), kind: "error", title: "Refresh runs failed", preview: clamp_preview(msg) });
      // SESSION-EXPIRY HONESTY (fable5 code adversary P1): a 401/403 from
      // the heartbeat means the session died mid-use — without this, the
      // app stayed "connected" with frozen columns while every action
      // failed. Re-probing through the hook drives the real sign-in flow.
      if (/\b40[13]\b/.test(msg) || /unauthorized|forbidden/i.test(msg)) {
        void gateway_connection.refresh().catch(() => undefined);
      }
      // RATE-LIMIT COURTESY (operator incident 2026-07-15 19:41, "Too Many
      // Requests (auth lockout)"): a locked gateway answers 429 FAST, so the
      // duration-based self-tuning never backs off — several apps polling
      // at 5s keep the lock warm forever. On 429 the pollers go quiet
      // (15s → 30s → 60s → 120s, reset on the first success).
      if (/\b429\b/.test(msg) || /too many requests/i.test(msg)) {
        const next = Math.min(120_000, Math.max(15_000, rate_limit_backoff_ref.current * 2 || 15_000));
        rate_limit_backoff_ref.current = next;
        rate_limited_until_ref.current = Date.now() + next;
        push_log({ ts: now_iso(), kind: "info", title: `Gateway rate-limited — pausing polls ${Math.round(next / 1000)}s` });
      }
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
        // Re-probe through the HOOK (one machine): a live session lands in
        // handle_connection_status, which runs discovery.
        await gateway_connection.refresh();
        if (had_session_ref.current) return;
      }

      const direct_token = String(settings.auth_token || "").trim();
      if (!direct_token) {
        // No session, no dev bearer: the shared modal is the way in (the
        // hook auto-opens on resolved disconnects; explicit retries open it
        // directly — flow/console parity: signed-out is a sign-in screen,
        // never a dead app).
        if (opts?.open_modal_if_needed) gateway_connection.openModal();
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
  /** Once per signed-out episode: the direct dev-bearer fallback (a stored
   * token with no proxy session) must not loop on every status echo. */
  const direct_fallback_tried_ref = useRef(false);
  function handle_connection_status(s: GatewayConnectionState | null): void {
    set_connection_status(s);
    const signed_in = Boolean(s && s.has_session && s.gateway?.ok);
    had_session_ref.current = signed_in;
    if (signed_in) {
      direct_fallback_tried_ref.current = false;
      // Looking at the dialog must not rewire a live DIRECT dev connection.
      if (gateway_connected && settings.gateway_auth_mode === "direct") return;
      const principal_user = String(s?.gateway?.principal?.user_id || "").trim();
      set_settings((prev) => ({
        ...prev,
        gateway_auth_mode: "session",
        auth_token: "",
        gateway_user: principal_user || prev.gateway_user,
      }));
      // Modal close on the sign-in transition is the HOOK's job now (B5).
      if (gateway_connected && settings.gateway_auth_mode === "session") return; // open-probe of a live connection
      set_discovery_error("");
      set_discovery_loading(true);
      void run_discovery(new GatewayClient({ base_url: "", auth_token: "" }))
        .catch((e: any) => set_discovery_error(gateway_connect_error_message(e, settings)))
        .finally(() => set_discovery_loading(false));
      return;
    }
    if (s && !s.has_session) {
      if (settings.gateway_auth_mode === "session") {
        // Signed out through the modal (or the session expired): reflect it
        // app-wide — an app that keeps rendering over a dead session is the
        // old lie this wave exists to end. (No gateway_connected gate: a
        // sign-out DURING in-flight discovery must still land.)
        disconnect_gateway({ keep_session: true });
      }
      // DIRECT dev fallback (the pre-hook boot path's other half): a stored
      // dev bearer connects without a proxy session — tried once per
      // signed-out episode, alongside the hook's auto-opened modal.
      const dev_token = String(settings.auth_token || "").trim();
      if (dev_token && !gateway_connected && !direct_fallback_tried_ref.current) {
        direct_fallback_tried_ref.current = true;
        void on_discover_gateway({ prefer_direct: true });
      }
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
      // Sign out THROUGH the hook's machine (uic c1327: signOut() = server
      // DELETE + fresh probe, so phase/auto-open react to the real state —
      // replaces the old fire-and-forget DELETE + delayed refresh poke).
      void gateway_connection.signOut().catch(() => undefined);
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
    // The board's Review column reads all_run_options — leaving it populated
    // kept the PREVIOUS session's waits rendered as actionable cards after
    // sign-out (and across gateway/account switches: a wrong-data join over
    // trust boundaries — fable5 code adversary P1). The freshness chip's
    // clock resets with it.
    set_all_run_options([]);
    set_runs_refreshed_at(null);
    set_board_entities([]);
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
      // Stand down during a gateway auth-lockout window (429 courtesy).
      if (rate_limited_until_ref.current > Date.now()) return;
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
      // Rate-limit gate: while the gateway's lockout window is open, wait
      // it out instead of feeding it (429s answer fast, so the duration
      // heuristic below never backs off on its own).
      const wait_429 = rate_limited_until_ref.current - Date.now();
      if (wait_429 > 0) {
        schedule(wait_429 + 500);
        return;
      }
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

  // THE phase graph (one-graph mechanism, laurent dm#79): fetched once per
  // connection from the gateway-vendored artifact; null = pre-wire gateway
  // (the labeled fallback vocabulary applies, board renders as before).
  const [phase_graph, set_phase_graph] = useState<PhaseGraph | null>(null);
  useEffect(() => {
    if (!gateway_connected) {
      set_phase_graph(null);
      return;
    }
    let stop = false;
    (async () => {
      try {
        const payload = await gateway.get_entity_phases_spec();
        if (stop) return;
        const graph = derive_phase_graph(payload);
        set_phase_graph(graph);
        // Drift honesty (the c3563 sha promise, adversary F3): compare the
        // served bytes' identity against the last one this browser saw —
        // a sha change WITHOUT a version bump is exactly the drift class
        // the mechanism exists to make loud.
        if (graph) {
          try {
            const prev_raw = localStorage.getItem("abstractobserver_phase_graph_id_v1");
            const prev = prev_raw ? JSON.parse(prev_raw) : null;
            if (prev && prev.sha256 && graph.sha256 && prev.sha256 !== graph.sha256 && prev.version === graph.version) {
              push_log({
                ts: now_iso(),
                kind: "error",
                title: "Phase-graph drift: served bytes changed without a version bump",
                preview: clamp_preview(`v${graph.version}: ${String(prev.sha256).slice(0, 12)}… -> ${String(graph.sha256).slice(0, 12)}…`),
                data: { prev, now: { sha256: graph.sha256, version: graph.version } },
              });
            }
            localStorage.setItem("abstractobserver_phase_graph_id_v1", JSON.stringify({ sha256: graph.sha256, version: graph.version }));
          } catch {}
        }
      } catch (err: any) {
        // Pre-wire gateway (404) keeps the labeled fallback SILENTLY —
        // that deployment is normal. Any OTHER failure (503 re-vendor
        // lane, timeout, network) also falls back but says so in the log
        // pane (adversary F6: "absent endpoint" and "temporarily broken"
        // are different truths). No retry loop — the next connect refetches.
        if (!stop) {
          set_phase_graph(null);
          const msg = String(err?.message || err || "");
          if (!/404|not found/i.test(msg)) {
            push_log({
              ts: now_iso(),
              kind: "info",
              title: "Phase-graph fetch failed — pre-wire fallback vocabulary in use (#FALLBACK)",
              preview: clamp_preview(msg),
              data: { error: msg },
            });
          }
        }
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway_connected]);

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
      // Stand down during a gateway auth-lockout window (429 courtesy).
      if (rate_limited_until_ref.current > Date.now()) return;
      try {
        const roster = await gateway.list_entities();
        const names = roster.entities
          .map((e: any) => String(e?.name || e?.slug || "").trim())
          .filter(Boolean)
          .slice(0, 12);
        const tiles: BoardEntityTile[] = await Promise.all(
          names.map(async (name): Promise<BoardEntityTile> => {
            try {
              // Card + the B3 cognition wire (gateway c1390) side by side;
              // cognition is OPTIONAL (pre-wire gateways 404 it — tile
              // degrades to the moment-age heuristic, never fabricates).
              const [card, cog] = await Promise.all([
                gateway.get_entity_card(name),
                gateway.get_entity_cognition(name).catch(() => null),
              ]);
              // Live card shape (verified against castor 2026-07-12):
              // state is an OBJECT {state, changed_at, reason, written_by};
              // moments entries carry {kind, at}, no title.
              const state_obj = card?.state && typeof card.state === "object" ? card.state : null;
              const moments = Array.isArray(card?.moments) ? card.moments : [];
              const last = moments.length ? moments[moments.length - 1] : null;
              const lifetime = cog?.spend?.lifetime;
              const live_visit = cog?.spend?.live_visit;
              const warnings = Array.isArray(cog?.warnings) ? cog.warnings.map((w: any) => String(w || "")).filter(Boolean) : [];
              // Access-hint lane (plan §observer 2): open questions/problems
              // briefs off the card, render-when-present — pre-M-A cards
              // simply have no entry_id and the chips degrade to text.
              const briefs = extract_open_briefs(card);
              return {
                name,
                state: String(state_obj?.state ?? (typeof card?.state === "string" ? card.state : "")).trim(),
                age_days: typeof card?.age_days === "number" ? card.age_days : null,
                last_moment: String(last?.kind || "").trim(),
                last_moment_at: String(last?.at || "").trim(),
                working: typeof cog?.working === "boolean" ? cog.working : null,
                tokens_total: typeof lifetime?.tokens_total === "number" ? lifetime.tokens_total : null,
                live_visit_tokens: typeof live_visit?.tokens_total === "number" ? live_visit.tokens_total : null,
                spend_warning: warnings.join(" | "),
                live_phase: typeof cog?.phase === "string" ? cog.phase : "",
                open_questions: briefs.questions,
                open_questions_total: briefs.questions_total,
                open_problems: briefs.problems,
                open_problems_total: briefs.problems_total,
                lessons: briefs.lessons,
                lessons_total: briefs.lessons_total,
                dreams_brief: extract_dreams_brief(card),
                error: "",
              };
            } catch (e: any) {
              return {
                name,
                state: "",
                age_days: null,
                last_moment: "",
                last_moment_at: "",
                working: null,
                tokens_total: null,
                live_visit_tokens: null,
                spend_warning: "",
                live_phase: "",
                open_questions: [],
                open_questions_total: 0,
                open_problems: [],
                open_problems_total: 0,
                lessons: [],
                lessons_total: 0,
                dreams_brief: null,
                error: String(e?.message || e || "card failed"),
              };
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

  /** Reveal the run's workspace folder in the local file manager. Served
   * by the observer's own cli.js (/api/local/reveal, loopback-only) —
   * meaningful in the local-first posture where observer + gateway share
   * the machine; elsewhere it reports the honest refusal. */
  async function reveal_run_workspace(): Promise<void> {
    const ws = run_workspace_root.trim();
    if (!ws) {
      set_status("This run recorded no workspace folder", 2);
      return;
    }
    try {
      const r = await fetch("/api/local/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && (body as any)?.ok) {
        set_status(`Opened ${String((body as any).path || ws)}`, 2);
      } else {
        set_status(String((body as any)?.error || `Folder reveal failed (${r.status})`), 3);
      }
    } catch (e: any) {
      set_status(String(e?.message || e || "Folder reveal failed"), 3);
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

  /** `attached_rid` is the run id of the OWNING attach, passed explicitly.
   * Reading the `run_id` STATE here was a stale closure (fable5 code
   * adversary P1): the stream loop captured the PREVIOUS run id forever,
   * which (a) made the abstract.status ticker dead code — the equality
   * gate below never matched on first attach or re-attach — and (b)
   * poisoned digest dedup keys with the wrong run id, silently dropping a
   * child run's records from the digest after a child→root switch. */
  function handle_step(ev: LedgerStreamEvent, attached_rid?: string): void {
    const attach_run_id = String(attached_rid || "").trim() || run_id.trim();
    cursor_ref.current = ev.cursor;
    records_buffer_ref.current?.push({ cursor: ev.cursor, record: ev.record });
    if (attach_run_id) digest_seen_ref.current.add(`${attach_run_id}:${ev.cursor}`);

    const emit = extract_emit_event(ev.record);
    const emit_name = emit && emit.name ? normalize_ui_event_name(emit.name) : "";

    const rec = ev.record;
    const node_id = typeof rec?.node_id === "string" ? rec.node_id : "";
    const status = typeof rec?.status === "string" ? rec.status : "";
    const effect_type = typeof rec?.effect?.type === "string" ? rec.effect.type : "";
    const rec_run_id = typeof rec?.run_id === "string" ? rec.run_id : "";

    const effective_run_id = rec_run_id || attach_run_id;
    if (emit_name === "abstract.status" && effective_run_id === attach_run_id) {
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
      id: `step:${rec_run_id || attach_run_id || "?"}:${ev.cursor}`,
      ts: String(rec?.ended_at || rec?.started_at || now_iso()),
      kind,
      title,
      preview,
      data: rec,
      cursor: ev.cursor,
      run_id: rec_run_id || attach_run_id || undefined,
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

  async function replay_ledger(run_id_value: string, opts: { after: number; signal?: AbortSignal }): Promise<number> {
    let after = opts.after;
    while (true) {
      // ABORT-AWARE (fable5 code adversary P0): the replay loop used to
      // outlive its attach — switching runs mid-replay kept the OLD run's
      // pages flushing into the NEW run's records (wrong-wait exposure:
      // the operator could approve A's tool calls while B executes).
      // The attach's signal now cancels the page loop and each push.
      if (opts.signal?.aborted) return after;
      const page = await gateway.get_ledger(run_id_value, { after, limit: 200, signal: opts.signal });
      if (opts.signal?.aborted) return after;
      const items = Array.isArray(page.items) ? page.items : [];
      if (!items.length) {
        cursor_ref.current = after;
        return after;
      }
      const base = after;
      for (let i = 0; i < items.length; i++) {
        const record = items[i] as StepRecord;
        handle_step({ cursor: base + i + 1, record }, run_id_value);
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
    set_run_workspace_root("");
    set_run_artifacts([]);
    set_run_artifacts_error("");
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
        // The run's workspace folder (operator 2026-07-15: folder button).
        // Gateway serves it beside input_data; often RELATIVE to the
        // gateway process cwd — the local reveal endpoint resolves that.
        const ws = (inp as any)?.workspace;
        const ws_root = typeof ws?.workspace_root === "string" ? String(ws.workspace_root).trim() : "";
        set_run_workspace_root(ws_root);
      } catch {
        set_run_workspace_root("");
      }

      // Durable run artifacts for the Story panel (products + internal
      // offloads; the panel separates them). Best-effort — never blocks;
      // the attach AbortController is the staleness guard (a newer attach
      // aborts this one before its state lands).
      void (async () => {
        set_run_artifacts_loading(true);
        set_run_artifacts_error("");
        try {
          const resp = await gateway.list_run_artifacts(rid, { limit: 200 });
          const items = Array.isArray((resp as any)?.items) ? (resp as any).items : [];
          if (!abort.signal.aborted) set_run_artifacts(items);
        } catch (e: any) {
          if (!abort.signal.aborted) {
            set_run_artifacts([]);
            set_run_artifacts_error(String(e?.message || e || "artifact listing failed"));
          }
        } finally {
          if (!abort.signal.aborted) set_run_artifacts_loading(false);
        }
      })();

      if (inferred_bundle_id && inferred_flow_id) {
        set_bundle_id(inferred_bundle_id);
        set_flow_id(inferred_flow_id);
        set_graph_flow_id(inferred_flow_id);
        await load_bundle_info(inferred_bundle_id);
      }

      await replay_ledger(rid, { after: 0, signal: abort.signal });

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
          const after = await replay_ledger(rid, { after: cursor_ref.current, signal: abort.signal });
          await gateway.stream_ledger(rid, {
            after,
            on_step: (ev) => handle_step(ev, rid),
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
      const msg = "Select a workflow first (Launch → pick a workflow).";
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
      // Whitespace hygiene lives HERE, at submit — mid-edit trimming ate
      // the space key (operator 2026-07-15). Interior whitespace is the
      // user's; only the accidental edges go. Empty-after-trim = unset.
      for (const [k, v] of Object.entries(input_data)) {
        if (typeof v !== "string") continue;
        const t = v.trim();
        if (!t) delete (input_data as any)[k];
        else (input_data as any)[k] = t;
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
      const msg = "Select a workflow first (Launch → pick a workflow).";
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
    if (err) {
      set_new_run_error(err);
      return;
    }
    // Launch is not a dead end: BOTH paths land the operator on the run
    // they just created. The scheduled path used to stay on Launch with
    // zero visible change (adversary 2 P0-3: "click → nothing happens")
    // while silently attaching in the background — now it navigates like
    // the immediate path and the schedule chip on the run view is the
    // confirmation.
    set_right_tab("overview");
    set_page("observe");
  }

  async function attach_to_run(rid: string, opts?: { root_run_id?: string }): Promise<void> {
    const run = String(rid || "").trim();
    if (!run) return;
    // SINGLE-FLIGHT (fable5 code adversary P0): board cards are clickable
    // during an in-flight attach; overlapping connect_to_run calls fought
    // over the shared cursor/buffer refs and contaminated the run view.
    // The abort-aware replay closes the data hole; this guard closes the
    // race at the door.
    if (connecting) {
      set_status(`Still attaching — retry in a moment (${short_id(run, 14)})`, 2500);
      return;
    }
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
        // default page, so deep links now navigate explicitly. Reset the
        // content tab too: landing on a stale Ask/Ledger tab for a fresh
        // run reads as an empty page (adversary 1 P1-7).
        set_right_tab("overview");
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
  // The board has its own inline answer forms — the global modal landing
  // on top of a half-typed board answer was a hijack (fable5 layout P1-6).
  const show_wait_modal =
    is_waiting && wait_key && (is_user_wait || is_ask_event_wait || has_tool_wait) && dismissed_wait_key !== wait_key && page !== "board";
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
      // Stand down during a gateway auth-lockout window (429 courtesy).
      if (rate_limited_until_ref.current > Date.now()) return;
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
  const selected_run_status_label = selected_run_is_scheduled && selected_run_is_paused
    ? "Suspended"
    : selected_run_is_scheduled_waiting
      ? "Scheduled"
      : run_status_word({ status: selected_run_status_raw, paused: selected_run_is_paused });

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
    if (page === "runtime") void refresh_audit_log();
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

  useEffect(() => {
    // Skills + MCP inventories feed BOTH Settings (assistant) and Launch
    // (skills/mcp pins) — probe on either page, once per connection.
    if ((page !== "settings" && page !== "launch") || !gateway_connected || assistant_skills_probed) return;
    let stopped = false;
    (async () => {
      const [items, mcp] = await Promise.all([gateway.list_skills(), gateway.list_mcp_servers()]);
      if (stopped) return;
      set_assistant_skills(items);
      set_gateway_mcp_servers(mcp);
      set_assistant_skills_probed(true);
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, gateway_connected, assistant_skills_probed]);

  /* SHELL (redesign wave 1, 2026-07-13): sidebar nav + slim header — the
   * benchmark shape (continuum's shell, flow's restraint). The shell names
   * the page; the header holds page-scoped chrome; the connection control
   * lives in the sidebar footer. Six pill tabs and the solid-accent active
   * state are gone. */
  const NAV_ITEMS: Array<{ id: typeof page; label: string; icon: React.ReactNode }> = [
    { id: "board", label: "Board", icon: <Icon name="board" size={16} /> },
    { id: "observe", label: "Observe", icon: <Icon name="history" size={16} /> },
    { id: "runtime", label: "System", icon: <Icon name="server" size={16} /> },
    { id: "launch", label: "Launch", icon: <Icon name="send" size={16} /> },
  ];
  const PAGE_TITLE: Record<string, string> = {
    board: "Board",
    observe: "Observe",
    runtime: "System",
    launch: "Launch",
    settings: "Settings",
  };

  return (
    <div className="app-shell shell">
      <aside className="shell_sidebar">
        <div className="shell_brand" title="AbstractObserver (Web/PWA)">
          <span className="logo-icon shell_brand_mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
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
          <span className="shell_brand_name">Observer</span>
        </div>
        <nav className="shell_nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`shell_nav_item ${page === item.id ? "active" : ""}`}
              onClick={() => set_page(item.id)}
              type="button"
            >
              <span className="shell_nav_icon">{item.icon}</span>
              <span className="shell_nav_label">{item.label}</span>
            </button>
          ))}
          {/* The entity app is its own deployment (abstractentity). */}
          <a className="shell_nav_item" href={entity_app_url} target="_blank" rel="noreferrer" title="Open the entity app (memory graph + visits)">
            <span className="shell_nav_icon"><Icon name="bot" size={16} /></span>
            <span className="shell_nav_label">Entities ↗</span>
          </a>
          <button
            className={`shell_nav_item ${page === "settings" ? "active" : ""}`}
            onClick={() => set_page("settings")}
            type="button"
          >
            <span className="shell_nav_icon"><Icon name="settings" size={16} /></span>
            <span className="shell_nav_label">Settings</span>
          </button>
        </nav>
        <div className="shell_sidebar_footer">
          {/* PASSIVE identity display — the top-bar pill is the ONE
            * connect/disconnect control (unified top-bar adoption; one
            * disconnect truth, c1640/c1663). */}
          <div
            className="shell_connection shell_connection_passive"
            title={gateway_connected ? "Gateway connected" : discovery_loading ? "Gateway: connecting…" : "Gateway: signed out"}
          >
            <span className={`gateway_led ${gateway_connected ? "ok" : discovery_loading ? "warn" : "err"}`} aria-hidden="true" />
            {/* Prose states ("signed out", "connecting…") are sentences, not
              * identifiers — mono only when showing the signed-in user id. */}
            <span className={`shell_connection_label ${gateway_connected && connection_status?.gateway?.principal?.user_id ? "mono" : ""}`}>
              {gateway_connected
                ? connection_status?.gateway?.principal?.user_id || (settings.gateway_auth_mode === "direct" ? "direct dev" : "connected")
                : discovery_loading
                  ? "connecting…"
                  : "signed out"}
            </span>
          </div>
        </div>
      </aside>

      <div className="shell_main">
        <header className="shell_header">
          <div className="shell_header_title">{PAGE_TITLE[page] || "Observer"}</div>
          <div className="shell_header_actions">
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
            {/* The unified upper-right cluster (same order in every
              * AbstractFramework app): assistant → appearance → Disconnect. */}
            <AfTopBarActions
              assistant={{ open: assistant_open, onToggle: () => set_assistant_open((v) => !v), label: "Observer assistant (docs-grounded)" }}
              appearance={{ onOpen: () => set_appearance_open(true) }}
              connection={{
                phase: gateway_connection.phase,
                signingOut: gateway_connection.signingOut,
                onConnect: () => gateway_connection.openModal(),
                onDisconnect: () => disconnect_gateway(),
              }}
            />
          </div>
        </header>

        <GatewayConnectModal {...gateway_connection.modalProps} />

        <AfAppearanceDialog
          open={appearance_open}
          onClose={() => set_appearance_open(false)}
          value={appearance}
          onChange={set_appearance}
        />

        {/* Keep-alive: mounted regardless of open so the conversation
          * survives close/reopen (kit contract statement 10). */}
        <AppAssistantDrawer
          open={assistant_open}
          onClose={() => set_assistant_open(false)}
          connected={gateway_connected}
          topOffset={44}
          gateway={gateway}
        />

        <div className="app-body shell_content">
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
                    <button className="btn primary" onClick={() => gateway_connection.openModal()} disabled={discovery_loading}>
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
              on_read_diary={(name, entry_id) => gateway.read_entity_diary_entry(name, entry_id)}
              phase_graph={phase_graph}
            />
          )
        ) : null}

        {page === "settings" ? (
          <div className="page page_scroll">
            <div className="page_inner settings_col">

              {/* ── Gateway ── */}
              <section className="pane">
                <div className="pane_header">
                  <span className="pane_title">Gateway</span>
                  <span className="pane_spacer" />
                  <span className={`chip ${gateway_connected ? "ok" : "warn"}`}>{gatewayStatusBadge(connection_status).label}</span>
                </div>
                <div className="pane_body settings_body">
                  <div className="settings_row">
                    <div className="settings_row_main">
                      <div className="settings_row_title">Connection</div>
                      <div className="settings_row_help">
                        The shared AbstractFramework sign-in: a gateway user token exchanges for an HTTP-only browser session. Raw tokens are never stored.
                      </div>
                    </div>
                    <div className="settings_row_actions">
                      <button className="btn" onClick={() => gateway_connection.openModal()}>Manage connection…</button>
                      {gateway_connected ? (
                        <button className="btn" onClick={() => disconnect_gateway()} title="Sign this browser out of the gateway (this app's session only)">Sign out</button>
                      ) : null}
                    </div>
                  </div>
                  {discovery_error ? <div className="warn_callout">{discovery_error}</div> : null}
                  <div className="settings_row">
                    <div className="settings_row_main">
                      <div className="settings_row_title">Auto-connect on load</div>
                      <div className="settings_row_help">Reuse the browser session automatically when the app opens.</div>
                    </div>
                    <div className="settings_row_actions">
                      <select
                        value={settings.auto_connect_gateway ? "on" : "off"}
                        onChange={(e) => set_settings((s) => ({ ...s, auto_connect_gateway: e.target.value === "on" }))}
                      >
                        <option value="on">On</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  </div>
                  <details className="settings_advanced">
                    <summary>Advanced: direct dev connection (bearer token, cross-origin)</summary>
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
                </div>
              </section>

              {/* ── Assistant (model + skills + MCP) ── */}
              <section className="pane">
                <div className="pane_header">
                  <span className="pane_title">Assistant</span>
                  <span className="pane_spacer" />
                  <span className="chip muted">docs Q&A + run Ask</span>
                </div>
                <div className="pane_body settings_body">
                  <div className="settings_row_help" style={{ marginTop: 0 }}>
                    The model answering the header assistant and the run page's Ask tab. Blank fields follow the gateway defaults.
                  </div>
                  <ProviderModelSelect
                    className="field"
                    providerLabel="Provider"
                    modelLabel="Model"
                    providerPlaceholder="(gateway default)"
                    modelPlaceholder="(gateway default)"
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
                    onChange={(next) =>
                      set_settings((s) => ({
                        ...s,
                        maintenance_ai_provider: next.provider,
                        maintenance_ai_model: next.model,
                      }))
                    }
                  />

                  <div className="settings_subhead">Skills</div>
                  {assistant_skills === null ? (
                    <div className="settings_row_help">
                      {gateway_connected
                        ? assistant_skills_probed
                          ? "The gateway does not serve a skills inventory yet — the abstractskill shelf list lights up here the day it ships."
                          : "Probing the gateway for the skills inventory…"
                        : "Connect to the gateway to list installable skills (abstractskill shelf)."}
                    </div>
                  ) : !assistant_skills.length ? (
                    <div className="settings_row_help">The gateway serves an empty skills inventory.</div>
                  ) : (
                    <div className="settings_choice_list">
                      {assistant_skills.map((sk) => {
                        const on = settings.assistant_skill_names.includes(sk.name);
                        return (
                          <label key={sk.name} className={`settings_choice ${on ? "on" : ""}`} title={sk.description || sk.name}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) =>
                                set_settings((s) => ({
                                  ...s,
                                  assistant_skill_names: e.target.checked
                                    ? Array.from(new Set([...s.assistant_skill_names, sk.name]))
                                    : s.assistant_skill_names.filter((n) => n !== sk.name),
                                }))
                              }
                            />
                            <span className="settings_choice_name">{sk.name}{sk.version ? <em> v{sk.version}</em> : null}</span>
                            {sk.description ? <span className="settings_choice_desc">{sk.description}</span> : null}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className="settings_row_help">
                    Selected skills ride the assistant's runs once the gateway's skills-attachment lane serves them; the selection persists here meanwhile.
                  </div>

                  <div className="settings_subhead">MCP servers</div>
                  <div className="settings_row_help" style={{ marginTop: 0 }}>
                    Remote tool endpoints the assistant may call. The gateway does not serve an MCP inventory yet — one manual endpoint is supported (advanced / potentially dangerous: it executes tool waits from this browser).
                  </div>
                  <div className="settings_mcp_row">
                    <input
                      className="mono"
                      value={settings.worker_url}
                      onChange={(e) => set_settings((s) => ({ ...s, worker_url: e.target.value }))}
                      placeholder="https://your-mcp-worker-endpoint"
                    />
                    <input
                      className="mono"
                      type="password"
                      value={settings.worker_token}
                      onChange={(e) => set_settings((s) => ({ ...s, worker_token: e.target.value }))}
                      placeholder="Bearer token (optional)"
                    />
                    <span className={`chip ${settings.worker_url.trim() ? "ok" : "muted"}`}>{settings.worker_url.trim() ? "configured" : "none"}</span>
                  </div>
                </div>
              </section>

            </div>
          </div>
        ) : null}

        {page === "launch" ? (
          <div className="page page_scroll">
            <div className="page_inner constrained">
              <div className="card">
                {/* The shell header already names the page — the card leads
                  * with what to do, not a second "Launch" heading. */}
                <div className="help_text muted">Pick a workflow, fill its inputs, and start a run on the connected gateway.</div>

                {!gateway_connected ? (
                  <div className="warn_callout">
                    Not connected.{" "}
                    <button className="btn primary" onClick={() => gateway_connection.openModal()}>
                      Sign in
                    </button>{" "}
                    to launch workflows on this gateway.
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
                      // Capabilities are per-launch state; a new workflow starts clean.
                      set_launch_skills([]);
                      await load_bundle_info(parsed.bundle_id);
                    }}
                    disabled={discovery_loading || !launchable_workflow_options.length}
                  >
                    <option value="">
                      {launchable_workflow_options.length
                        ? "(select workflow)"
                        : connected
                          ? discovery_loading
                            ? "(loading workflows…)"
                            : "(no executable workflows published on this gateway)"
                          : "(sign in to load workflows)"}
                    </option>
                    {launchable_workflow_options.map((w) => (
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
                    <div className="help_text muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                      {String(selected_entrypoint.description)}
                    </div>
                  ) : null}
                  {bundle_loading ? (
                    <div className="help_text muted" style={{ fontSize: "var(--font-size-sm)" }}>
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
                    <div className="help_text muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                      Select a workflow above to configure inputs.
                    </div>
                  ) : input_data_obj === null ? (
                    <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: "10px" }}>
                      <div className="meta">
                        <span className="mono">input error</span>
                        <span className="mono">{now_iso()}</span>
                      </div>
                      <div className="body mono">Invalid input JSON — reselect the workflow to reset its inputs.</div>
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
                          const is_wide =
                            ptype === "tools" || ptype === "skills" || ptype === "mcp" || ptype === "mcp_servers" ||
                            pid === "skills" || pid === "mcp" || pid === "mcp_servers" ||
                            ptype === "array" || is_json_pin_type(ptype) || pid === "prompt" || pid === "system";
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
                        // Bare strings for string defaults (operator 2026-07-15: provider/
                        // model placeholders showed JSON quotes — `"lmstudio"`). JSON
                        // rendering is for structured defaults only.
                        const default_s = has_default
                          ? typeof default_val === "string"
                            ? default_val
                            : safe_json_inline(default_val, 80)
                          : "";
                        const cur = (input_data_obj as any)?.[pid];
                        const placeholder_default = has_default ? `${default_s}` : "";

                        if (ptype === "tools") {
                          const selected = Array.isArray(cur) ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
                          const default_tools = Array.isArray(default_val) ? (default_val as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
                          const merged_options = Array.from(new Set([...available_tool_names, ...selected, ...default_tools])).sort();
                          return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><MultiSelect options={merged_options} value={selected} disabled={disabled} placeholder="(no tools selected)" onChange={(next) => update_input_data_field(pid, next)} /></div>);
                        }
                        /* SKILLS / MCP pins (operator 2026-07-15): same picker shape
                         * as Tools, fed by the gateway's feature-detected inventories
                         * (abstractskill shelf / MCP registry). A workflow declaring
                         * the pin against a gateway that serves no inventory gets the
                         * honest absent line — never a fabricated list. Alignment
                         * thread with gateway/skill on agora (same day). */
                        if (ptype === "skills" || pid === "skills") {
                          const selected = Array.isArray(cur) ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
                          if (assistant_skills === null && !selected.length) {
                            return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><div className="help_text muted">This gateway does not serve a skills inventory yet — skill selection lights up here when it ships (abstractskill shelf via abstractgateway).</div></div>);
                          }
                          // Trust verdicts are the gateway's (c2243): BLOCKED skills
                          // never enter the selectable set. A previously-selected
                          // name stays visible (user state), never silently dropped.
                          const names = (assistant_skills || []).filter((s) => s.blocked !== true).map((s) => s.name);
                          const merged = Array.from(new Set([...names, ...selected])).sort();
                          return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><MultiSelect options={merged} value={selected} disabled={disabled} placeholder="(no skills selected)" onChange={(next) => update_input_data_field(pid, next)} /></div>);
                        }
                        if (ptype === "mcp" || ptype === "mcp_servers" || pid === "mcp" || pid === "mcp_servers") {
                          const selected = Array.isArray(cur) ? (cur as any[]).map((x) => String(x || "").trim()).filter(Boolean) : [];
                          if (gateway_mcp_servers === null && !selected.length) {
                            return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><div className="help_text muted">This gateway does not serve an MCP server inventory yet — MCP selection lights up here when it ships.</div></div>);
                          }
                          const names = (gateway_mcp_servers || []).map((s) => s.name);
                          const merged = Array.from(new Set([...names, ...selected])).sort();
                          return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><MultiSelect options={merged} value={selected} disabled={disabled} placeholder="(no MCP servers selected)" onChange={(next) => update_input_data_field(pid, next)} /></div>);
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
                          return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label>{models.length ? (<select value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} disabled={disabled}><option value="">{placeholder_default || "(select)"}</option>{models.map((m) => (<option key={m} value={m}>{m}</option>))}</select>) : (<input value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} placeholder={placeholder_default || "model id"} disabled={disabled} />)}</div>);
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
                        /* Default: string — PROSE fields speak the framework sans
                         * (operator 2026-07-15); mono stays an explicit opt-in for
                         * JSON/array editors and path fields. */
                        const sel = typeof cur === "string" ? String(cur) : "";
                        const is_textarea = pid === "prompt" || pid === "system";
                        if (is_textarea) return (<div key={pid} className="launch_field_wide"><label className="launch_label">{display_label}</label><textarea value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} placeholder={placeholder_default || (pid === "prompt" ? "What should the agent do?" : "System instructions (optional)")} rows={3} disabled={disabled} /></div>);
                        return (<div key={pid} className={grid_class || "launch_field"}><label className="launch_label">{display_label}</label><input value={sel} onChange={(e) => update_input_data_field(pid, e.target.value)} placeholder={placeholder_default} disabled={disabled} /></div>);
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

                  {/* ── CAPABILITIES: run-level skills attachment (operator directive
                    * 2026-07-15 16:22; contract = decision:launch-skills-selection-
                    * contract). Selection rides input_data.skills (names); the
                    * gateway resolves through the trust gate into
                    * _runtime.skills_block (card 0087, closed end-to-end c2442).
                    * Render rules are skill's (c2372, adopted c2376): attachable =
                    * selectable · requires_review = selectable with the verdict
                    * visible (the gateway HOLDS unverified at start — selecting is
                    * safe, the resolution records it) · blocked = visible but
                    * refused, with reasons. Never a fabricated list: no inventory
                    * → honest absent line. ── */}
                  {bundle_id.trim() && flow_id.trim() ? (
                    <details className="launch_capabilities" style={{ marginTop: "10px" }}>
                      <summary className="help_text muted" style={{ cursor: "pointer" }}>
                        Capabilities{launch_skills.length ? ` · ${launch_skills.length} skill${launch_skills.length === 1 ? "" : "s"}` : ""}
                      </summary>
                      <div className="help_text muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                        Skills attach knowledge procedures to this run. The gateway resolves selections through the trust gate at start: validated skills activate, unverified ones are held for review, blocked ones never ride.
                      </div>
                      {assistant_skills === null ? (
                        <div className="help_text muted" style={{ marginTop: "8px" }}>
                          This gateway does not serve a skills inventory yet — the shelf lights up here when it ships.
                        </div>
                      ) : !assistant_skills.length ? (
                        <div className="help_text muted" style={{ marginTop: "8px" }}>The gateway's skills shelf is empty.</div>
                      ) : (
                        <div className="launch_skill_list">
                          {assistant_skills.map((s) => {
                            const selected = launch_skills.includes(s.name);
                            const blocked = s.blocked === true;
                            const review = s.requires_review === true && !blocked;
                            return (
                              <label
                                key={s.name}
                                className={`launch_skill_row ${blocked ? "is_blocked" : ""} ${selected ? "is_on" : ""}`}
                                title={[s.description || "", s.tree_hash ? `tree ${s.tree_hash.slice(0, 16)}…` : "", blocked && s.reasons?.length ? `blocked: ${s.reasons.join("; ")}` : ""].filter(Boolean).join("\n")}
                              >
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={blocked || connecting || resuming}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? Array.from(new Set([...launch_skills, s.name]))
                                      : launch_skills.filter((n) => n !== s.name);
                                    set_launch_skills(next);
                                    update_input_data_field("skills", next.length ? next : undefined);
                                  }}
                                />
                                <span className="launch_skill_name">{s.name}</span>
                                {s.trust_level ? <span className={`chip ${blocked ? "danger" : review ? "warn" : "muted"}`}>{blocked ? "blocked" : review ? "review" : s.trust_level}</span> : null}
                                {s.description ? <span className="launch_skill_desc">{s.description}</span> : null}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {launch_skills.length ? (
                        <div className="help_text muted" style={{ fontSize: "var(--font-size-xxs)", marginTop: "6px" }}>
                          Selected skills ride the run as input_data.skills; the resolved verdicts land in the run's record.
                        </div>
                      ) : null}
                    </details>
                  ) : null}

                  {/* Advanced JSON + session_id removed: raw JSON is an implementation
                      detail (form fields are the source of truth), and session_id is
                      auto-generated — no user-facing reason to expose either. */}

                  <details style={{ marginTop: "10px" }}>
                    <summary className="help_text muted" style={{ cursor: "pointer" }}>
                      Workspace
                    </summary>
                    <div className="help_text muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                      Controls what the agent can access via filesystem tools.
                    </div>

                    <div className="launch_grid" style={{ marginTop: "8px" }}>
                      <div className="launch_grid_cell" style={{ gridColumn: "1 / -1" }}>
                        <label className="launch_label">Workspace Root</label>
                        <input className="mono" value={workspace_root_value} onChange={(e) => update_input_data_field("workspace_root", e.target.value)} placeholder="/path/to/workspace" disabled={connecting || resuming} />
                        <div className="help_text muted" style={{ fontSize: "var(--font-size-xxs)" }}>Empty = gateway default (isolated per-run workspace)</div>
                      </div>
                      <div className="launch_grid_cell">
                        <label className="launch_label">Access Mode</label>
                        <select className="mono" value={(workspace_access_mode_value || "workspace_only").trim() || "workspace_only"} onChange={(e) => update_input_data_field("workspace_access_mode", e.target.value)} disabled={connecting || resuming}>
                          <option value="workspace_only">workspace_only</option>
                          <option value="workspace_or_allowed">workspace_or_allowed</option>
                          <option value="all_except_ignored">all_except_ignored</option>
                      </select>
                        <div className="help_text muted" style={{ fontSize: "var(--font-size-xxs)" }}>workspace_only: absolute paths must stay under root. workspace_or_allowed: allow additional roots.</div>
                      </div>
                    </div>

                    {(workspace_access_mode_value || "").trim() === "workspace_or_allowed" ? (
                      <div className="field" style={{ marginTop: "8px" }}>
                        <label className="launch_label">Allowed Paths</label>
                        <textarea className="mono" rows={3} value={workspace_allowed_paths_value} onChange={(e) => update_input_data_field("workspace_allowed_paths", e.target.value)} placeholder={"/path/to/project\n/path/to/workspace"} disabled={connecting || resuming} spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
                        <div className="help_text muted" style={{ fontSize: "var(--font-size-xxs)" }}>Newline-separated directories (absolute or relative to workspace_root)</div>
                      </div>
                    ) : null}

                    <div className="field" style={{ marginTop: "8px" }}>
                      <label className="launch_label">Ignored Paths</label>
                      <textarea className="mono" rows={3} value={workspace_ignored_paths_value} onChange={(e) => update_input_data_field("workspace_ignored_paths", e.target.value)} placeholder={"node_modules\nruntime\nsecret"} disabled={connecting || resuming} spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
                      <div className="help_text muted" style={{ fontSize: "var(--font-size-xxs)" }}>Newline-separated paths to block (absolute or relative to workspace_root)</div>
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
                  <span>Share context across executions <span className="help_text muted" style={{ fontSize: "var(--font-size-xxs)", fontWeight: 400 }}>(when disabled, each run gets its own isolated session)</span></span>
                      </label>

                {/* ── Launch button ── */}
                <div className="section_divider" />
                {new_run_error ? (
                  <div className="observe_context_card error" style={{ marginBottom: "10px" }}>
                    <span className="chip mono danger">error</span>
                    <span className="mono">{new_run_error}</span>
                    </div>
                ) : null}
                <div className="launch_actions_bar launch_actions_stack">
                  {(() => {
                    // A dead button must SAY WHY (adversary 2 P1-C2: nine
                    // silent disable conditions read as "broken app").
                    const disabled_reason = !gateway_connected
                      ? "Sign in first"
                      : !bundle_id.trim() || !flow_id.trim()
                        ? "Select a workflow"
                        : input_data_obj === null
                          ? "Inputs contain invalid JSON"
                          : connecting || resuming
                            ? "Attaching to a run…"
                            : discovery_loading || bundle_loading
                              ? "Loading…"
                              : schedule_submitting
                                ? "Submitting…"
                                : "";
                    return (
                      <>
                        <button className="launch_submit_btn" onClick={() => void submit_launch()} disabled={Boolean(disabled_reason)} title={disabled_reason}>
                          {schedule_submitting || connecting ? "Launching…" : schedule_start_mode !== "now" || schedule_repeat_mode !== "once" ? "Launch (scheduled)" : "Launch now"}
                        </button>
                        {disabled_reason && !schedule_submitting && !connecting ? (
                          <span className="mono muted launch_disabled_reason">{disabled_reason}</span>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
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
            memory_panel={
              gateway_connected ? (
                <MindmapPanel
                  gateway={gateway}
                  selected_run_id={runtime_selected_run_id}
                  selected_session_id={runtime_context_session_id}
                />
              ) : null
            }
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
                connected={gateway_connected}
                on_sign_in={() => gateway_connection.openModal()}
                total_runs={runtime_run_rows.length}
                workflow_label_by_id={workflow_label_by_id}
                on_search={set_observe_search}
                on_filter={set_observe_filter}
                on_group_by={set_observe_group_by}
                on_refresh={() => void refresh_runs()}
                on_select={(rid, root) => void attach_to_run(rid, { root_run_id: root || rid })}
              />
              <div className="observatory_main">
            {/* ── Observe toolbar ──
              * The navigator (left) is the ONE run selector; this row only
              * names the selected run and offers actions on it. The old
              * duplicate RunPicker dropdown is gone. */}
            <div className="observe_toolbar">
              <div className="observe_toolbar_row">
                {run_id.trim() ? (
                  <div className="observe_run_identity" title={run_id.trim()}>
                    <span className="observe_run_name">
                      {workflow_label_by_id[String(selected_run_summary?.workflow_id || "")] || String(selected_run_summary?.workflow_id || "").trim() || short_id(run_id.trim(), 22)}
                    </span>
                    <span className="chip mono muted">{short_id(run_id.trim(), 14)}</span>
                    <span className={`chip ${run_status_class(selected_run_status_label || selected_run_status_raw)}`}>
                      {selected_run_status_label || selected_run_status_raw || "unknown"}
                    </span>
                  </div>
                ) : (
                  // The body's empty state carries the instruction; the
                  // toolbar states the fact once (was a duplicate
                  // "Select a run…" sentence at two heights).
                  <span className="observe_run_identity_empty">No run selected</span>
                )}

                <span className="observe_toolbar_spacer" />

                {/* Actions only exist when a run is selected — a row of disabled
                  * buttons in the empty state reads as broken, not as guidance. */}
                {run_id.trim() ? (
                  <>
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
	                      disabled={connecting || resuming || run_terminal || run_paused}
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
	                    disabled={connecting || resuming || run_terminal}
	                  >
	                    Cancel
	                  </button>
                  <button className="btn btn_icon" onClick={clear_run_view} title="Clear the run view">
                    <Icon name="x" size={14} />
                  </button>
                  </>
                ) : null}
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
                        {(() => {
                          const word = is_scheduled_run ? (run_paused ? "suspended" : "scheduled") : "waiting";
                          return <span className={`chip ${run_status_class(word)}`}>{word}</span>;
                        })()}
                        <span className="muted">{wait_reason || "unknown"}</span>
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
                        <span className="chip muted">schedule</span>
                        <span className="muted">{is_scheduled_recurrent ? `every ${schedule_interval}` : "once"}</span>
                    </div>
                      <div className="observe_context_body">
                        {schedule_interval ? (<span className="mono"><span className="muted">interval</span>: {schedule_interval}</span>) : null}
                        <span className="mono"><span className="muted">share ctx</span>: {schedule_share_ctx ? "yes" : "no"}</span>
                        {typeof schedule_meta_repeat_count === "number" ? (<span className="mono"><span className="muted">repeats</span>: {schedule_meta_repeat_count}</span>) : null}
                    </div>
                    {limits_pct !== null ? (
                        <div className="observe_context_budget">
                          <span className="mono muted">{typeof limits_used === "number" && typeof limits_budget === "number" ? `${limits_used.toLocaleString()} / ${limits_budget.toLocaleString()}` : ""}{` • ${Math.round(Math.max(0, Math.min(1, limits_pct)) * 100)}%`}</span>
                          <div className="observe_budget_bar"><div className={`observe_budget_fill ${limits_pct >= 0.9 ? "danger" : limits_pct >= 0.75 ? "warn" : "ok"}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, limits_pct)) * 100)}%` }} /></div>
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
                      <span className="chip danger">error</span>
                      <span className="mono">{error_text}</span>
                      </div>
                ) : null}
                  </div>
                ) : null}
              </div>

            {/* ── Single full-width content panel ── */}
            <div className="card panel_card card_scroll observe_viewer observe_viewer_full">
              {/* Content tabs + inline contextual controls */}
                {/* FOUR tabs (redesign: nine → four). Story is the answer-
                  * first narrative (outcome, waits, summary, produced,
                  * chronology); Ledger is the raw truth; Flow the graph;
                  * Ask the conversation. Timeline/Replay/Digest/Providers/
                  * Attachments were re-renderings of the same ledger and
                  * their unique content now lives inside Story or Runtime. */}
                <div className="tab_bar">
                  <div role="tablist" aria-label="Run views" className="observe_tablist">
                  <button role="tab" aria-selected={right_tab === "overview"} className={`tab ${right_tab === "overview" ? "active" : ""}`} onClick={() => set_right_tab("overview")}>
                    Story
                  </button>
                  <button role="tab" aria-selected={right_tab === "ledger"} className={`tab ${right_tab === "ledger" ? "active" : ""}`} onClick={() => set_right_tab("ledger")}>
                    Ledger
                  </button>
                  <button role="tab" aria-selected={right_tab === "graph"} className={`tab ${right_tab === "graph" ? "active" : ""}`} onClick={() => set_right_tab("graph")}>
                    Flow
                  </button>
                  <button role="tab" aria-selected={right_tab === "chat"} className={`tab ${right_tab === "chat" ? "active" : ""}`} onClick={() => set_right_tab("chat")}>
                    Ask
                  </button>
                </div>

                  {/* Ledger inline controls — only shown when ledger tab is active AND there is data */}
                  {right_tab === "ledger" && (visible_log.length > 0 || ledger_view === "cycles") ? (
                    <div className="tab_bar_controls">
                      <div className="seg_toggle">
                        <button className={`seg_btn ${ledger_view === "steps" ? "active" : ""}`} onClick={() => set_ledger_view("steps")}>Steps</button>
                        <button className={`seg_btn ${ledger_view === "cycles" ? "active" : ""}`} onClick={() => set_ledger_view("cycles")}>Cycles</button>
	                  </div>
                      {ledger_view === "steps" ? (
                        <button className={`seg_action ${ledger_condensed ? "active" : ""}`} onClick={() => set_ledger_condensed((v) => !v)} title={ledger_condensed ? "Showing condensed view" : "Showing all steps"}>
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
                        className="seg_action"
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
                      <button className={`seg_action ${graph_show_subflows ? "active" : ""}`} onClick={() => set_graph_show_subflows((v) => !v)}>
                        Subflows
                      </button>
                      <button className={`seg_action ${graph_highlight_path ? "active" : ""}`} onClick={() => set_graph_highlight_path((v) => !v)}>
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
                    records={records}
                    child_records_count={child_records_for_digest.length}
                    provider_activities={provider_activities}
                    attachments_count={session_attachments.length}
                    latest_summary={latest_run_summary}
                    wait_state={wait_state}
                    summary_generating={summary_generating}
                    summary_error={summary_error}
                    on_generate_summary={() => void generate_summary()}
                    on_open_runtime={() => {
                      const rid = String(run_id || "").trim();
                      if (rid) {
                        set_runtime_selected_run_id(rid);
                        set_runtime_artifact_run_filter(rid);
                        set_runtime_scope("run");
                      }
                      set_runtime_tab("artifacts");
                      set_page("runtime");
                    }}
                    on_open_subrun={(rid) => void attach_to_run(rid, { root_run_id: root_run_id || run_id || rid })}
                    on_answer_wait={() => set_dismissed_wait_key("")}
                    workspace_root={run_workspace_root}
                    on_reveal_workspace={() => void reveal_run_workspace()}
                    run_artifacts={run_artifacts}
                    run_artifacts_loading={run_artifacts_loading}
                    run_artifacts_error={run_artifacts_error}
                    on_preview_run_artifact={(a) => void preview_runtime_artifact(a as RuntimeArtifact)}
                    on_download_run_artifact={(a) => void download_runtime_artifact(a as RuntimeArtifact)}
                    timeline_items={timeline_items}
                    node_index={node_index_for_run}
                    attachments={session_attachments}
                    attachments_loading={session_attachments_loading}
                    attachments_error={session_attachments_error}
                    attachments_ready={Boolean(session_attachments_run_id.trim())}
                    on_refresh_attachments={() => void refresh_session_attachments()}
                    on_preview_attachment={(a) => void preview_session_attachment(a)}
                    on_download_attachment={(a) => void download_session_attachment(a)}
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
                          <div className="empty_state_inline">
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
                      <div className="log_item log_item_danger">
                        <div className="meta">
                          <span>graph error</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{graph_error}</div>
                      </div>
                    ) : null}
                    {graph_loading ? (
                      <div className="log_item log_item_info">
                        <div className="meta">
                          <span>loading</span>
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

                {/* Attachment preview modal (opened from Story's Session files list) */}
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

                {right_tab === "chat" ? (
                  <div className="ask_tab log_scroll" style={{ marginTop: "6px" }}>
                    {/* Conversation-first (operator 13:07): the thread leads;
                      * model identity is a quiet chip; history/export live
                      * behind one disclosure. Kit components render the chat. */}
                    <div className="ask_header">
                      <span className="ask_title">Ask about this run</span>
                      <span className="chip muted" title="Model comes from Settings → Assistant (blank = gateway default)">
                        {(settings.maintenance_ai_provider.trim() || "gateway") + " / " + (settings.maintenance_ai_model.trim() || "default")}
                      </span>
                      <span className="pane_spacer" />
                      <span className="ask_hint">Read-only · grounded in this run + subflows</span>
                    </div>

                    <details className="ask_manage">
                      <summary>History & export</summary>
                      <div className="field" style={{ marginTop: "10px" }}>
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

                      {chat_thread_last_saved_at ? <div className="chat_hint">Last saved: {format_time_ago(chat_thread_last_saved_at)}</div> : null}
                      {chat_thread_save_error ? (
                        <div className="chat_hint chat_hint_danger">
                          {chat_thread_save_error}
                        </div>
                      ) : null}
                      {saved_chat_thread_load_error ? (
                        <div className="chat_hint chat_hint_danger">
                          {saved_chat_thread_load_error}
                        </div>
                      ) : null}
                      {saved_chat_threads_error ? (
                        <div className="chat_hint chat_hint_danger">
                          {saved_chat_threads_error}
                        </div>
                      ) : null}
                      </div>
                    </details>

                    {chat_error ? (
                      <div className="log_item log_item_danger">
                        <div className="meta">
                          <span>error</span>
                          <span className="mono">{now_iso()}</span>
                        </div>
                        <div className="body mono">{chat_error}</div>
                      </div>
                    ) : null}
                    {chat_voice_error ? (
                      <div className="log_item log_item_danger">
                        <div className="meta">
                          <span>voice</span>
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

                {/* Status line only makes sense with a run on screen; without one
                  * it rendered an orphaned "Run: (none)" floating in the panel. */}
                {run_id.trim() ? (
                  <div className={`status_bar ${status_pulse ? "pulse" : ""}`}>
                    <strong>Run</strong>:{" "}
                    <span className="mono">{selected_run_status_label || selected_run_status_raw || "unknown"}</span>
                    {selected_run_is_scheduled_until && selected_next_in ? <span className="mono muted"> • next in {selected_next_in}</span> : null}
                    {status_text ? <span className="mono muted"> • {status_text}</span> : null}
                  </div>
                ) : null}
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
              /* Sticky footer holds the PRIMARY decisions; the destructive
               * Cancel run is demoted into the body (fable5 layout P0-4 —
               * the most destructive action was the only always-visible
               * one). Open ledger also dismisses: it used to open the page
               * UNDER the still-open modal. */
              <>
                <button
                  className="btn"
                  onClick={() => {
                    set_right_tab("ledger");
                    set_page("observe");
                    if (wait_key) set_dismissed_wait_key(wait_key);
                  }}
                  disabled={!run_id.trim()}
                >
                  Open ledger
                </button>
                <button className="btn" onClick={() => wait_key && set_dismissed_wait_key(wait_key)} disabled={resuming}>
                  Dismiss
                </button>
                {tool_calls_for_wait.length ? (
                  <>
                    <button className="btn danger" disabled={resuming} onClick={() => resume_wait({ approved: false })}>
                      Reject
                    </button>
                    <button className="btn" disabled={resuming} onClick={() => resume_wait({ approved: true })}>
                      Approve only
                    </button>
                    <button className="btn primary" disabled={!worker || resuming} onClick={() => execute_tools_via_worker(tool_calls_for_wait)}>
                      Approve and execute
                    </button>
                  </>
                ) : null}
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
                            <span key={label} className="chip mono muted" title={TOOL_RISK_INFERRED_TITLE}>{label}~</span>
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
                  <button className="btn danger" onClick={() => void cancel_visible_run(run_id.trim(), "Cancelled from wait prompt")} disabled={!run_id.trim() || resuming}>
                    Cancel whole run
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
                <div className="actions">
                  <button className="btn danger" onClick={() => void cancel_visible_run(run_id.trim(), "Cancelled from wait prompt")} disabled={!run_id.trim() || resuming}>
                    Cancel whole run
                  </button>
                </div>
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
    </div>
  );

}
