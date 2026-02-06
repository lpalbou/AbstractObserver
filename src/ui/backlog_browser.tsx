import React, { useEffect, useMemo, useRef, useState } from "react";

import { ChatComposer, ChatThread, Markdown, copyText, type ChatMessage } from "@abstractuic/panel-chat";
import { Icon as UiIcon } from "@abstractuic/ui-kit";

import { useGatewayVoice } from "./use_gateway_voice";

import type {
  BacklogExecConfigResponse,
  BacklogExecRequestListResponse,
  BacklogExecRequestSummary,
  BacklogItemSummary,
  BacklogListResponse,
  GatewayClient,
} from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import {
  classify_exec_event_status_kind,
  humanize_shell_command,
  infer_exec_event_main_text,
  infer_exec_event_time_label,
} from "./exec_event";
import { MultiSelect } from "./multi_select";
import { Modal } from "./modal";
import { Icon } from "@abstractuic/ui-kit";

type BacklogTab = "processing" | "planned" | "proposed" | "recurrent" | "completed" | "failed" | "deprecated" | "trash";
type BacklogFileKind = "planned" | "proposed" | "recurrent" | "completed" | "deprecated" | "trash";
type BacklogTaskType = "bug" | "feature" | "task";
type BacklogTaskTypeFilter = "all" | BacklogTaskType;

function is_backlog_file_kind(tab: BacklogTab): tab is BacklogFileKind {
  return tab !== "processing" && tab !== "failed";
}

function normalize_task_type(value: any): BacklogTaskType {
  const t = String(value || "")
    .trim()
    .toLowerCase();
  if (t === "bug" || t === "feature" || t === "task") return t;
  return "task";
}

function task_type_tag(tt: BacklogTaskType): string {
  return tt.toUpperCase();
}

function task_type_chip(tt: BacklogTaskType): string {
  return tt === "bug" ? "danger" : tt === "feature" ? "ok" : "task";
}

function strip_title_type_prefix(title: string): string {
  const s = String(title || "").trim();
  const out = s.replace(/^\[(bug|feature|task)\]\s*/i, "").trim();
  return out || s;
}

function short_id(value: string, keep: number): string {
  const s = String(value || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

function is_parsed(item: BacklogItemSummary): boolean {
  if (typeof (item as any)?.parsed === "boolean") return Boolean((item as any).parsed);
  return typeof item.item_id === "number" && item.item_id > 0;
}

function infer_backlog_package(item: BacklogItemSummary | null): string {
  const p = String(item?.package || "").trim();
  if (p) return p;
  const fn = String(item?.filename || "").trim();
  const parts = fn.split("-");
  if (parts.length >= 2) return String(parts[1] || "").trim();
  return "";
}

function format_created_at(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${hh}${mm}`;
}

function safe_json_parse(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function _is_near_bottom(el: HTMLElement, threshold_px: number): boolean {
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  return remaining <= threshold_px;
}

function _summary_preview_markdown(text: string): string {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const lines = raw.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const s = String(line || "");
    if (!s.trim()) {
      if (out.length) break;
      continue;
    }
    out.push(s);
    if (out.length >= 6) break;
  }
  return out.join("\n").trim();
}

function _parse_iso_ms(ts: any): number | null {
  const s = typeof ts === "string" ? ts.trim() : "";
  if (!s) return null;
  const normalized = s.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function _format_duration_ms(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const total_s = Math.max(0, Math.floor(ms / 1000));
  const s = total_s % 60;
  const total_m = Math.floor(total_s / 60);
  const m = total_m % 60;
  const total_h = Math.floor(total_m / 60);
  const h = total_h % 24;
  const d = Math.floor(total_h / 24);
  if (d > 0) return `${d}d ${h}h`;
  if (total_h > 0) return `${total_h}h ${m}m`;
  if (total_m > 0) return `${total_m}m ${s}s`;
  return `${total_s}s`;
}

async function sha256_hex(text: string): Promise<string> {
  const payload = String(text || "");
  const enc = new TextEncoder().encode(payload);
  const c: any = (globalThis as any).crypto;
  if (!c || !c.subtle || typeof c.subtle.digest !== "function") return "";
  const digest = await c.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const _SAFE_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function _is_safe_run_id(value: string): boolean {
  return _SAFE_RUN_ID_PATTERN.test(String(value || "").trim());
}

async function session_memory_run_id(session_id: string): Promise<string> {
  const sid = String(session_id || "").trim();
  if (!sid) throw new Error("session_id is required");
  if (_is_safe_run_id(sid)) {
    const rid = `session_memory_${sid}`;
    if (_is_safe_run_id(rid)) return rid;
  }
  const digest = await sha256_hex(sid);
  return `session_memory_sha_${digest.slice(0, 32)}`;
}

function use_media_query(query: string): boolean {
  const get_matches = (): boolean => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  };

  const [matches, set_matches] = useState<boolean>(get_matches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on_change = () => set_matches(mql.matches);
    on_change();
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", on_change);
    else (mql as any).addListener?.(on_change);
    return () => {
      if (typeof mql.removeEventListener === "function") mql.removeEventListener("change", on_change);
      else (mql as any).removeListener?.(on_change);
    };
  }, [query]);

  return matches;
}

function render_backlog_template_draft(
  template_md: string,
  opts: { package_name: string; title: string; summary: string; created_at: string; task_type: BacklogTaskType }
): string {
  const pkg = String(opts.package_name || "").trim() || "{Package}";
  const title = strip_title_type_prefix(String(opts.title || "").trim() || "{Title}");
  const summary = String(opts.summary || "").trim();
  const tt = normalize_task_type(opts.task_type);

  const header = `# {ID}-${pkg}: [${task_type_tag(tt)}] ${title}`.trim();
  let out = String(template_md || "");
  out = out.split("{Package}").join(pkg).split("{Title}").join(title);

  // Force first H1.
  const lines = out.split(/\r?\n/);
  let replaced_h1 = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = String(lines[i] || "");
    if (raw.trim().startsWith("# ")) {
      lines[i] = header;
      replaced_h1 = true;
      break;
    }
    if (raw.trim()) break;
  }
  if (!replaced_h1) {
    lines.unshift("", header);
    lines.shift();
  }

  // Ensure Created line.
  const created_line = `> Created: ${String(opts.created_at || "").trim()}`.trim();
  let found_created = false;
  for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
    const raw = String(lines[i] || "");
    if (raw.trim().toLowerCase().startsWith("> created:")) {
      lines[i] = created_line;
      found_created = true;
      break;
    }
  }
  if (!found_created) {
    const insert_at = lines.length > 1 && !String(lines[1] || "").trim() ? 2 : 1;
    lines.splice(insert_at, 0, created_line, "");
  }

  // Ensure Type line.
  const type_line = `> Type: ${tt}`.trim();
  let found_type = false;
  for (let i = 0; i < Math.min(lines.length, 60); i += 1) {
    const raw = String(lines[i] || "");
    if (raw.trim().toLowerCase().startsWith("> type:")) {
      lines[i] = type_line;
      found_type = true;
      break;
    }
  }
  if (!found_type) {
    let created_idx = -1;
    for (let i = 0; i < Math.min(lines.length, 60); i += 1) {
      const raw = String(lines[i] || "");
      if (raw.trim().toLowerCase().startsWith("> created:")) {
        created_idx = i;
        break;
      }
    }
    if (created_idx >= 0) {
      const insert_at = created_idx + 1;
      if (insert_at < lines.length && !String(lines[insert_at] || "").trim()) {
        lines.splice(insert_at, 0, type_line);
      } else {
        lines.splice(insert_at, 0, type_line, "");
      }
    } else {
      const insert_at = lines.length > 1 && !String(lines[1] || "").trim() ? 2 : 1;
      lines.splice(insert_at, 0, type_line, "");
    }
  }

  if (summary) {
    for (let i = 0; i < lines.length; i += 1) {
      if (String(lines[i] || "").trim().toLowerCase() === "## summary") {
        let j = i + 1;
        while (j < lines.length && !String(lines[j] || "").trim()) j += 1;
        const placeholder = j < lines.length ? String(lines[j] || "") : "";
        if (placeholder.trim().toLowerCase().startsWith("one paragraph describing")) {
          lines[j] = summary;
        } else {
          lines.splice(i + 1, 0, summary, "");
        }
        break;
      }
    }
  }

  out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

function _lines_list(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function generate_backlog_draft_from_guided(opts: {
  package_name: string;
  title: string;
  task_type: BacklogTaskType;
  summary: string;
  diagram: string;
  context: string;
  included: string[];
  excluded: string[];
  plan: string[];
  dependencies: string[];
  acceptance: string[];
  tests_a: string[];
  tests_b: string[];
  tests_c: string[];
  created_at: string;
  attachments: string[];
}): string {
  const pkg = String(opts.package_name || "").trim() || "{Package}";
  const title = strip_title_type_prefix(String(opts.title || "").trim() || "{Title}");
  const tt = normalize_task_type(opts.task_type);
  const created = String(opts.created_at || "").trim() || format_created_at();
  const diagram = String(opts.diagram || "").trim();
  const context = String(opts.context || "").trim();

  const md: string[] = [];
  md.push(`# {ID}-${pkg}: [${task_type_tag(tt)}] ${title}`);
  md.push("");
  md.push(`> Created: ${created}`);
  md.push(`> Type: ${tt}`);
  md.push("");
  md.push("## Summary");
  md.push(opts.summary.trim() || "One paragraph describing what this task accomplishes (user value + outcome).");
  md.push("");
  md.push("## Diagram");
  md.push("```");
  md.push(diagram || "ASCII diagram of the system change.\nShow inputs/outputs and where code lives.");
  md.push("```");
  md.push("");
  md.push("## Context");
  md.push(context || "(why is this needed? link to evidence: bug/feature report paths, discussions, etc.)");
  md.push("");
  md.push("## Scope");
  md.push("### Included");
  if (opts.included.length) md.push(...opts.included.map((s) => `- ${s}`));
  else md.push("- ");
  md.push("");
  md.push("### Excluded");
  if (opts.excluded.length) md.push(...opts.excluded.map((s) => `- ${s}`));
  else md.push("- ");
  md.push("");
  md.push("## Implementation Plan");
  if (opts.plan.length) md.push(...opts.plan.map((s, i) => `${i + 1}. ${s}`));
  else md.push("1. ");
  md.push("");
  md.push("## Dependencies");
  if (opts.dependencies.length) md.push(...opts.dependencies.map((s) => `- ${s}`));
  else md.push("- Related backlog items / ADRs");
  md.push("");
  md.push("## Acceptance Criteria");
  if (opts.acceptance.length) md.push(...opts.acceptance.map((s) => `- [ ] ${s}`));
  else md.push("- [ ] Criterion 1 (clear, testable)");
  md.push("");
  md.push("## Testing (ADR-0019)");
  md.push("- Level A:");
  if (opts.tests_a.length) md.push(...opts.tests_a.map((s) => `  - \`${s}\``));
  else md.push("  - `...`");
  md.push("- Level B:");
  if (opts.tests_b.length) md.push(...opts.tests_b.map((s) => `  - \`${s}\``));
  else md.push("  - `...`");
  md.push("- Level C (optional / opt-in):");
  if (opts.tests_c.length) md.push(...opts.tests_c.map((s) => `  - \`${s}\``));
  else md.push("  - n/a");
  md.push("");
  md.push("## Related");
  md.push("- ADRs:");
  md.push("- Code:");
  md.push("- Reports:");
  if (opts.attachments.length) {
    md.push("- Attachments:");
    md.push(...opts.attachments.map((p) => `  - ${p}`));
  }
  md.push("");
  md.push("---");
  md.push("## Report (added when completed)");
  md.push("");
  md.push("> Completed: YYYY-MM-DD");
  md.push("");
  md.push("### What changed");
  md.push("- ");
  md.push("");
  md.push("### Security / hardening");
  md.push("- ");
  md.push("");
  md.push("### Testing (ADR-0019)");
  md.push("Levels executed:");
  md.push("- A:");
  md.push("- B:");
  md.push("- C (if any):");
  md.push("");
  md.push("Commands run:");
  md.push("- `...`");
  md.push("");
  md.push("### Follow-ups");
  md.push("- ");
  md.push("");
  return md.join("\n");
}

function insert_attachment_links(md: string, relpaths: string[]): string {
  const paths = relpaths.map((p) => String(p || "").trim()).filter(Boolean);
  if (!paths.length) return md;
  const lines = String(md || "").split(/\r?\n/);
  const lower = lines.map((l) => l.toLowerCase());

  const related_idx = lower.findIndex((l) => l.trim() === "## related");
  if (related_idx < 0) {
    const out = String(md || "").trimEnd();
    return `${out}\n\n## Related\n- Attachments:\n${paths.map((p) => `  - ${p}`).join("\n")}\n`;
  }

  let attach_idx = -1;
  for (let i = related_idx + 1; i < lines.length; i += 1) {
    const l = lower[i].trim();
    if (l.startsWith("## ") || l.startsWith("---")) break;
    if (l.startsWith("- attachments:")) {
      attach_idx = i;
      break;
    }
  }

  const attach_block = ["- Attachments:", ...paths.map((p) => `  - ${p}`)];
  if (attach_idx >= 0) {
    // Append new entries after existing attachment block.
    let insert_at = attach_idx + 1;
    while (insert_at < lines.length) {
      const l = lower[insert_at].trim();
      if (!l.startsWith("  -")) break;
      insert_at += 1;
    }
    lines.splice(insert_at, 0, ...paths.map((p) => `  - ${p}`));
  } else {
    // Insert before the next section or divider.
    let insert_at = related_idx + 1;
    for (let i = related_idx + 1; i < lines.length; i += 1) {
      const l = lower[i].trim();
      if (l.startsWith("## ") || l.startsWith("---")) {
        insert_at = i;
        break;
      }
      insert_at = i + 1;
    }
    lines.splice(insert_at, 0, ...attach_block, "");
  }
  return lines.join("\n");
}

export type BacklogBrowserPageProps = {
  gateway: GatewayClient;
  gateway_connected: boolean;
  maintenance_ai_provider?: string;
  maintenance_ai_model?: string;
  backlog_advisor_agent?: string;
  voice_session_id?: string;
};

export function BacklogBrowserPage(props: BacklogBrowserPageProps): React.ReactElement {
  const gateway = props.gateway;
  const can_use_gateway = props.gateway_connected;
  const maint_provider = String(props.maintenance_ai_provider || "").trim();
  const maint_model = String(props.maintenance_ai_model || "").trim();
  const advisor_agent = String(props.backlog_advisor_agent || "").trim();

  const [kind, set_kind] = useState<BacklogTab>("planned");
  const is_compact_layout = use_media_query("(max-width: 900px)");
  const [compact_pane, set_compact_pane] = useState<"list" | "detail">("list");
  const [items, set_items] = useState<BacklogItemSummary[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState("");
  const [planned_hidden_filenames, set_planned_hidden_filenames] = useState<string[]>([]);

  const [query, set_query] = useState("");
  const [type_filter, set_type_filter] = useState<BacklogTaskTypeFilter>("all");

  const [selected, set_selected] = useState<BacklogItemSummary | null>(null);
  const [content, set_content] = useState("");
  const [content_sha, set_content_sha] = useState("");
  const [content_loading, set_content_loading] = useState(false);
  const [content_error, set_content_error] = useState("");

  const [action_loading, set_action_loading] = useState(false);
  const [action_error, set_action_error] = useState("");

  const [editing, set_editing] = useState(false);
  const [edit_text, set_edit_text] = useState("");
  const [edit_loading, set_edit_loading] = useState(false);
  const [edit_error, set_edit_error] = useState("");

  const [maint_messages, set_maint_messages] = useState<ChatMessage[]>([]);
  const [maint_input, set_maint_input] = useState("");
  const [maint_loading, set_maint_loading] = useState(false);
  const [maint_error, set_maint_error] = useState("");

  const [advisor_open, set_advisor_open] = useState(false);
  const [advisor_messages, set_advisor_messages] = useState<ChatMessage[]>([]);
  const [advisor_input, set_advisor_input] = useState("");
  const [advisor_loading, set_advisor_loading] = useState(false);
  const [advisor_error, set_advisor_error] = useState("");
  const [advisor_show_tools, set_advisor_show_tools] = useState(false);
  const [advisor_recent_attachments, set_advisor_recent_attachments] = useState<string[]>([]);
  const advisor_input_ref = useRef<HTMLTextAreaElement | null>(null);
  const advisor_attach_input_ref = useRef<HTMLInputElement | null>(null);

  const advisor_voice_session_id = String(props.voice_session_id || "").trim() || "abstractobserver_backlog_advisor";
  const [advisor_voice_run_id, set_advisor_voice_run_id] = useState<string>("");
  const [advisor_voice_error, set_advisor_voice_error] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const rid = await session_memory_run_id(advisor_voice_session_id);
        set_advisor_voice_run_id(rid);
      } catch {
        set_advisor_voice_run_id("");
      }
    })();
  }, [advisor_voice_session_id]);

  const advisor_voice = useGatewayVoice({
    gateway: can_use_gateway ? gateway : null,
    session_id: advisor_voice_session_id,
    run_id: advisor_voice_run_id,
    on_error: set_advisor_voice_error,
    on_transcript: (text) => {
      const t = String(text || "").trim();
      if (!t) return;
      set_advisor_input((prev) => {
        const cur = String(prev || "");
        if (!cur.trim()) return t;
        return `${cur.trimEnd()}\n${t}`;
      });
      window.setTimeout(() => advisor_input_ref.current?.focus(), 0);
    },
  });

  const edit_attach_input_ref = useRef<HTMLInputElement | null>(null);
  const [edit_attachments_uploading, set_edit_attachments_uploading] = useState(false);
  const [edit_attachments_error, set_edit_attachments_error] = useState("");
  const [edit_recent_attachments, set_edit_recent_attachments] = useState<string[]>([]);

  const [execute_confirm_open, set_execute_confirm_open] = useState(false);
  const [execute_target, set_execute_target] = useState<{ kind: BacklogFileKind; filename: string; title: string } | null>(null);
  const [execute_mode, set_execute_mode] = useState<"uat" | "inplace">("uat");

  const [batch_filenames, set_batch_filenames] = useState<string[]>([]);
  const [batch_execute_open, set_batch_execute_open] = useState(false);
  const [batch_execute_loading, set_batch_execute_loading] = useState(false);
  const [batch_execute_error, set_batch_execute_error] = useState("");
  const [batch_execute_mode, set_batch_execute_mode] = useState<"uat" | "inplace">("uat");

  const [merge_open, set_merge_open] = useState(false);
  const [merge_title, set_merge_title] = useState("");
  const [merge_package, set_merge_package] = useState("framework");
  const [merge_task_type, set_merge_task_type] = useState<BacklogTaskType>("task");
  const [merge_summary, set_merge_summary] = useState("");
  const [merge_loading, set_merge_loading] = useState(false);
  const [merge_error, set_merge_error] = useState("");

  const [exec_cfg, set_exec_cfg] = useState<BacklogExecConfigResponse | null>(null);
  const [exec_cfg_loading, set_exec_cfg_loading] = useState(false);
  const [exec_cfg_error, set_exec_cfg_error] = useState("");

  const [exec_requests, set_exec_requests] = useState<BacklogExecRequestSummary[]>([]);
  const [exec_loading, set_exec_loading] = useState(false);
  const [exec_error, set_exec_error] = useState("");
  const [exec_selected, set_exec_selected] = useState<BacklogExecRequestSummary | null>(null);
  const [exec_detail, set_exec_detail] = useState<any>(null);
  const [exec_detail_loading, set_exec_detail_loading] = useState(false);
  const [exec_detail_error, set_exec_detail_error] = useState("");
  const [exec_qa_feedback, set_exec_qa_feedback] = useState("");
  const [exec_qa_loading, set_exec_qa_loading] = useState(false);
  const [exec_qa_error, set_exec_qa_error] = useState("");

  const [exec_log_name, set_exec_log_name] = useState<"events" | "stderr" | "last_message">("events");
  const [exec_log_text, set_exec_log_text] = useState("");
  const [exec_log_loading, set_exec_log_loading] = useState(false);
  const [exec_log_error, set_exec_log_error] = useState("");
  const [exec_log_truncated, set_exec_log_truncated] = useState(false);
  const [exec_log_auto, set_exec_log_auto] = useState(true);
  const exec_log_scroll_el_ref = useRef<HTMLDivElement | null>(null);
  const exec_log_follow_ref = useRef(true);

  const [exec_full_open, set_exec_full_open] = useState(false);
  const [exec_full_backlog_filename, set_exec_full_backlog_filename] = useState("");
  const [exec_full_requests, set_exec_full_requests] = useState<BacklogExecRequestSummary[]>([]);
  const [exec_full_request_id, set_exec_full_request_id] = useState("");
  const [exec_full_log_name, set_exec_full_log_name] = useState<"events" | "stderr" | "last_message">("events");
  const [exec_full_text, set_exec_full_text] = useState("");
  const [exec_full_loading, set_exec_full_loading] = useState(false);
  const [exec_full_error, set_exec_full_error] = useState("");
  const [exec_full_truncated, set_exec_full_truncated] = useState(false);
  const [exec_full_search, set_exec_full_search] = useState("");
  const exec_full_textarea_ref = useRef<HTMLTextAreaElement | null>(null);

  const [completed_view, set_completed_view] = useState<"tasks" | "runs">("tasks");

  const [new_task_open, set_new_task_open] = useState(false);
  const [backlog_template_md, set_backlog_template_md] = useState("");
  const [template_loading, set_template_loading] = useState(false);
  const [template_error, set_template_error] = useState("");

  const [new_kind, set_new_kind] = useState<"planned" | "proposed" | "recurrent">("proposed");
  const [new_task_type, set_new_task_type] = useState<BacklogTaskType>("feature");
  const [new_package, set_new_package] = useState("framework");
  const [new_title, set_new_title] = useState("");
  const [new_summary, set_new_summary] = useState("");
  const [new_draft, set_new_draft] = useState("");
  const [new_error, set_new_error] = useState("");
  const [new_loading, set_new_loading] = useState(false);

  const [guided_diagram, set_guided_diagram] = useState("");
  const [guided_context, set_guided_context] = useState("");
  const [guided_included, set_guided_included] = useState("");
  const [guided_excluded, set_guided_excluded] = useState("");
  const [guided_plan, set_guided_plan] = useState("");
  const [guided_dependencies, set_guided_dependencies] = useState("");
  const [guided_acceptance, set_guided_acceptance] = useState("");
  const [guided_tests_a, set_guided_tests_a] = useState("");
  const [guided_tests_b, set_guided_tests_b] = useState("");
  const [guided_tests_c, set_guided_tests_c] = useState("");

  const [new_attachments, set_new_attachments] = useState<File[]>([]);
  const [attachments_uploading, set_attachments_uploading] = useState(false);
  const [attachments_error, set_attachments_error] = useState("");

  const [assist_messages, set_assist_messages] = useState<ChatMessage[]>([]);
  const [assist_input, set_assist_input] = useState("");
  const [assist_loading, set_assist_loading] = useState(false);

  const is_exec_view = kind === "processing" || kind === "failed" || (kind === "completed" && completed_view === "runs");

  useEffect(() => {
    if (!is_compact_layout) return;
    set_compact_pane("list");
  }, [is_compact_layout, kind, completed_view]);

  useEffect(() => {
    if (!advisor_open) return;
    const on_keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") set_advisor_open(false);
    };
    window.addEventListener("keydown", on_keydown);
    // Focus the input (best-effort).
    setTimeout(() => advisor_input_ref.current?.focus(), 0);
    return () => window.removeEventListener("keydown", on_keydown);
  }, [advisor_open]);

  const parsed_exec_events = useMemo(() => {
    if (exec_log_name !== "events") return null;
    const raw = String(exec_log_text || "");
    const lines = raw.split(/\r?\n/).filter((l) => String(l || "").trim().length > 0);
    const events: Array<{ idx: number; type: string; payload: any; raw: string }> = [];
    let bad = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] || "").trim();
      const obj = safe_json_parse(line);
      if (!obj || typeof obj !== "object") {
        bad += 1;
        events.push({ idx: i, type: "raw", payload: null, raw: line });
        continue;
      }
      const t = String((obj as any).type || (obj as any).event || "event");
      events.push({ idx: i, type: t, payload: obj, raw: line });
    }
    return { total: lines.length, bad, events, raw };
  }, [exec_log_text, exec_log_name]);

  const exec_event_stats = useMemo(() => {
    if (!parsed_exec_events) return null;
    let input_tokens = 0;
    let cached_input_tokens = 0;
    let output_tokens = 0;
    let command_count = 0;
    let command_fail_count = 0;
    for (const ev of parsed_exec_events.events) {
      const p: any = ev.payload;
      const usage = p && typeof p.usage === "object" ? p.usage : null;
      if (usage) {
        if (Number.isFinite(Number(usage.input_tokens))) input_tokens += Number(usage.input_tokens);
        if (Number.isFinite(Number(usage.cached_input_tokens))) cached_input_tokens += Number(usage.cached_input_tokens);
        if (Number.isFinite(Number(usage.output_tokens))) output_tokens += Number(usage.output_tokens);
      }
      const item = p && typeof p.item === "object" ? p.item : null;
      if (item && String(item.type || "").trim() === "command_execution") {
        command_count += 1;
        const st = String(item.status || "").trim().toLowerCase();
        if (st === "failed") command_fail_count += 1;
      }
    }
    const has_tokens = input_tokens > 0 || output_tokens > 0 || cached_input_tokens > 0;
    return {
      has_tokens,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      total_tokens: input_tokens + output_tokens,
      command_count,
      command_fail_count,
    };
  }, [parsed_exec_events]);

  const exec_time_stats = useMemo(() => {
    const created_ms = _parse_iso_ms(exec_selected?.created_at);
    const started_ms = _parse_iso_ms(exec_selected?.started_at);
    const finished_ms = _parse_iso_ms(exec_selected?.finished_at);
    const now_ms = Date.now();
    const st = String(exec_selected?.status || "").trim().toLowerCase();
    const end_ms = finished_ms ?? (st === "running" ? now_ms : null);
    const is_done = finished_ms != null;
    const queue_delay_ms = created_ms != null && started_ms != null ? Math.max(0, started_ms - created_ms) : null;
    const run_ms = started_ms != null && end_ms != null ? Math.max(0, end_ms - started_ms) : null;
    const total_ms = created_ms != null && end_ms != null ? Math.max(0, end_ms - created_ms) : null;
    const age_ms = !is_done && created_ms != null ? Math.max(0, now_ms - created_ms) : null;
    return { is_done, queue_delay_ms, run_ms, total_ms, age_ms };
  }, [exec_selected?.created_at, exec_selected?.started_at, exec_selected?.finished_at, exec_selected?.status]);

  function exec_status_filter_for_view(tab: BacklogTab): string {
    if (tab === "processing") return "queued,running,awaiting_qa";
    if (tab === "failed") return "failed";
    if (tab === "completed" && completed_view === "runs") return "completed,promoted";
    return "";
  }

  function exec_summary_from_payload(payload: any, request_id: string): BacklogExecRequestSummary {
    const p = payload && typeof payload === "object" ? payload : {};
    const backlog = p.backlog && typeof p.backlog === "object" ? p.backlog : {};
    const result = p.result && typeof p.result === "object" ? p.result : {};
    const executor = p.executor && typeof p.executor === "object" ? p.executor : {};
    const last_msg = String(result.last_message || "").trim();
    const target_model = String(p.target_model || executor.model || "").trim();
    const target_reasoning_effort = String(p.target_reasoning_effort || executor.reasoning_effort || "").trim();
    return {
      request_id,
      status: String(p.status || "unknown"),
      created_at: p.created_at ?? null,
      started_at: p.started_at ?? null,
      finished_at: p.finished_at ?? null,
      backlog_relpath: backlog.relpath ?? null,
      backlog_kind: backlog.kind ?? null,
      backlog_filename: backlog.filename ?? null,
      target_agent: p.target_agent ?? null,
      target_model: target_model || null,
      target_reasoning_effort: target_reasoning_effort || null,
      executor_type: executor.type ?? null,
      ok: typeof result.ok === "boolean" ? result.ok : null,
      exit_code: typeof result.exit_code === "number" ? result.exit_code : result.exit_code ?? null,
      error: typeof result.error === "string" ? result.error : result.error ?? null,
      run_dir_relpath: p.run_dir_relpath ?? null,
      last_message: last_msg ? last_msg.slice(0, 1200) : null,
    };
  }

  async function refresh_backlog_list(target_kind?: BacklogFileKind): Promise<BacklogItemSummary[]> {
    const k = (target_kind || (is_backlog_file_kind(kind) ? kind : "planned")) as any;
    const res = (await gateway.backlog_list(k)) as BacklogListResponse;
    let next = Array.isArray(res?.items) ? res.items : [];
    if (k === "planned") {
      try {
        const active = await gateway.backlog_exec_active_items({ status: "queued,running,awaiting_qa", limit: 1200 });
        const active_items = Array.isArray((active as any)?.items) ? ((active as any).items as any[]) : [];
        const processing = new Set(
          active_items
            .filter((it) => String(it?.kind || "").trim() === "planned")
            .map((it) => String(it?.filename || "").trim())
            .filter(Boolean)
        );
        const hidden = Array.from(processing);
        hidden.sort();
        set_planned_hidden_filenames(hidden);
        if (processing.size) {
          next = next.filter((it) => !processing.has(String(it.filename || "").trim()));
        }
      } catch {
        set_planned_hidden_filenames([]);
      }
    } else {
      set_planned_hidden_filenames([]);
    }

    set_items(next);
    if (selected && target_kind === undefined && !next.some((it) => it.filename === selected.filename)) {
      set_selected(null);
      set_content("");
      set_content_sha("");
      set_content_error("");
      set_editing(false);
      set_edit_text("");
      set_edit_error("");
    }
    return next;
  }

  async function refresh_exec_list(target_tab?: BacklogTab): Promise<BacklogExecRequestSummary[]> {
    if (exec_loading) return exec_requests;
    set_exec_error("");
    set_exec_loading(true);
    const tab = target_tab || kind;
    try {
      const status = exec_status_filter_for_view(tab);
      const res = (await gateway.backlog_exec_requests({ status, limit: 200 })) as BacklogExecRequestListResponse;
      const next = Array.isArray(res?.requests) ? res.requests : [];
      set_exec_requests(next);

      // Auto-transfer the selected request out of Processing when it completes.
      if (tab === "processing" && exec_selected?.request_id && !next.some((r) => r.request_id === exec_selected.request_id)) {
        try {
          const detail = await gateway.backlog_exec_request(exec_selected.request_id);
          const payload = detail?.payload;
          const status2 = String(payload?.status || "").trim().toLowerCase();
          if (status2 === "failed") {
            set_kind("failed");
          } else if (status2 === "completed" || status2 === "promoted") {
            set_completed_view("runs");
            set_kind("completed");
          }
          if (status2 === "failed" || status2 === "completed" || status2 === "promoted") {
            set_exec_detail(payload);
            set_exec_selected(exec_summary_from_payload(payload, exec_selected.request_id));
          }
        } catch {
          // ignore
        }
      }

      // Keep selection in sync.
      if (exec_selected?.request_id) {
        const match = next.find((r) => r.request_id === exec_selected.request_id) || null;
        if (match) set_exec_selected(match);
      }

      return next;
    } catch (e: any) {
      set_exec_requests([]);
      set_exec_error(String(e?.message || e || "Failed to load backlog exec requests"));
      return [];
    } finally {
      set_exec_loading(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!can_use_gateway) return;
    if (is_exec_view) {
      await refresh_exec_list();
      return;
    }
    if (loading) return;
    set_error("");
    set_loading(true);
    try {
      await refresh_backlog_list();
    } catch (e: any) {
      set_items([]);
      set_error(String(e?.message || e || "Failed to load backlog list"));
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, completed_view, can_use_gateway]);

  useEffect(() => {
    if (kind !== "planned") {
      set_batch_filenames([]);
      return;
    }
    const allowed = new Set(items.map((it) => String(it.filename || "").trim()).filter(Boolean));
    set_batch_filenames((prev) => prev.filter((fn) => allowed.has(fn)));
  }, [kind, items]);

  useEffect(() => {
    if (!new_task_open) return;
    if (!can_use_gateway) return;
    void apply_template_to_draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new_task_open, can_use_gateway]);

  useEffect(() => {
    if (!execute_confirm_open) return;
    if (!can_use_gateway) return;
    void load_exec_config();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute_confirm_open, can_use_gateway]);

  useEffect(() => {
    if (!batch_execute_open) return;
    if (!can_use_gateway) return;
    void load_exec_config();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch_execute_open, can_use_gateway]);

  useEffect(() => {
    if (!can_use_gateway) return;
    if (!is_exec_view) return;
    void load_exec_config();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is_exec_view, can_use_gateway]);

  useEffect(() => {
    if (!can_use_gateway) return;
    if (!is_exec_view) return;
    const ms = kind === "processing" ? 2000 : 5000;
    const t = setInterval(() => void refresh_exec_list(kind), ms);
    return () => clearInterval(t);
  }, [kind, completed_view, can_use_gateway, is_exec_view, exec_selected?.request_id]);

  useEffect(() => {
    if (!can_use_gateway) return;
    if (!is_exec_view) return;
    if (!exec_selected?.request_id) return;
    void load_exec_log_tail({ request_id: exec_selected.request_id, name: exec_log_name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec_selected?.request_id, exec_log_name, is_exec_view, can_use_gateway]);

  useEffect(() => {
    // When switching request or log kind, default to following the newest content.
    exec_log_follow_ref.current = true;
  }, [exec_selected?.request_id, exec_log_name]);

  useEffect(() => {
    const el = exec_log_scroll_el_ref.current;
    if (!el) return;
    if (!exec_log_follow_ref.current) return;
    const raf = window.requestAnimationFrame(() => {
      const node = exec_log_scroll_el_ref.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [exec_log_text, exec_log_name, exec_selected?.request_id]);

  useEffect(() => {
    if (!can_use_gateway) return;
    if (!is_exec_view) return;
    if (!exec_selected?.request_id) return;
    const st = String(exec_selected.status || "").trim().toLowerCase();
    // Always poll while running. Optionally poll when Auto is enabled (useful for queued → running).
    if (st !== "running" && exec_log_auto !== true) return;
    const ms = st === "running" ? 1500 : 2500;
    const t = setInterval(() => {
      void load_exec_log_tail({ request_id: exec_selected.request_id, name: exec_log_name });
    }, ms);
    return () => clearInterval(t);
  }, [exec_selected?.request_id, exec_selected?.status, exec_log_name, is_exec_view, can_use_gateway, exec_log_auto]);

  useEffect(() => {
    // Keep selection scoped to the active view.
    set_compact_pane("list");
    if (is_exec_view) {
      if (selected) {
        set_selected(null);
        set_content("");
        set_content_sha("");
        set_content_error("");
        set_editing(false);
        set_edit_text("");
        set_edit_error("");
        set_maint_messages([]);
        set_maint_input("");
        set_maint_loading(false);
        set_maint_error("");
        set_edit_attachments_uploading(false);
        set_edit_attachments_error("");
        set_edit_recent_attachments([]);
      }
    } else {
      if (exec_selected) {
        set_exec_selected(null);
        set_exec_detail(null);
        set_exec_detail_error("");
        set_exec_log_text("");
        set_exec_log_error("");
        set_exec_log_truncated(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is_exec_view]);

  async function load_item(item: BacklogItemSummary, opts?: { kind?: BacklogFileKind }): Promise<void> {
    const k = (opts?.kind || (is_backlog_file_kind(kind) ? kind : "planned")) as any;
    set_selected(item);
    if (is_compact_layout) set_compact_pane("detail");
    set_editing(false);
    set_edit_text("");
    set_edit_error("");
    set_maint_messages([]);
    set_maint_input("");
    set_maint_loading(false);
    set_maint_error("");
    set_edit_attachments_uploading(false);
    set_edit_attachments_error("");
    set_edit_recent_attachments([]);
    set_action_error("");
    set_content("");
    set_content_sha("");
    set_content_error("");
    set_content_loading(true);
    try {
      const res = await gateway.backlog_content(k as any, item.filename);
      const text = String(res?.content || "");
      set_content(text);
      set_content_sha(await sha256_hex(text));
    } catch (e: any) {
      set_content_error(String(e?.message || e || "Failed to load backlog item"));
    } finally {
      set_content_loading(false);
    }
  }

  const filtered_items = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    const tf = String(type_filter || "all").trim().toLowerCase();
    return items.filter((it) => {
      if (tf && tf !== "all") {
        const tt = normalize_task_type(it.task_type);
        if (tt !== tf) return false;
      }
      if (!q) return true;
      const hay = `${it.item_id || ""} ${it.package || ""} ${it.title || ""} ${it.task_type || ""} ${it.summary || ""} ${it.filename || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, type_filter]);

  const batch_selected_items = useMemo(() => {
    if (kind !== "planned") return [] as BacklogItemSummary[];
    const wanted = new Set(batch_filenames.map((x) => String(x || "").trim()).filter(Boolean));
    const out = items.filter((it) => wanted.has(String(it.filename || "").trim()));
    out.sort((a, b) => String(a.filename || "").localeCompare(String(b.filename || "")));
    return out;
  }, [items, batch_filenames, kind]);

  const filtered_exec_requests = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
	    if (!q) return exec_requests;
	    return exec_requests.filter((r) => {
	      const hay =
	        `${r.request_id || ""} ${r.status || ""} ${r.backlog_filename || ""} ${r.backlog_relpath || ""} ${r.target_model || ""} ${r.target_reasoning_effort || ""} ${r.error || ""} ${r.last_message || ""}`.toLowerCase();
	      return hay.includes(q);
	    });
	  }, [exec_requests, query]);

  async function move_selected(to_kind: BacklogFileKind): Promise<void> {
    if (!selected) return;
    if (!is_backlog_file_kind(kind)) return;
    if (action_loading) return;
    set_action_error("");
    set_action_loading(true);
    try {
      await gateway.backlog_move({ from_kind: kind, to_kind, filename: selected.filename });
      set_kind(to_kind);
      set_query("");
      const next = await refresh_backlog_list(to_kind);
      const moved = next.find((i) => i.filename === selected.filename) || null;
      set_selected(moved);
      set_content("");
      set_content_sha("");
      set_content_error("");
      if (moved) await load_item(moved, { kind: to_kind });
    } catch (e: any) {
      set_action_error(String(e?.message || e || "Backlog move failed"));
    } finally {
      set_action_loading(false);
    }
  }

  async function save_edit(): Promise<void> {
    if (!selected) return;
    if (!is_backlog_file_kind(kind)) return;
    if (edit_loading) return;
    set_edit_error("");
    set_edit_loading(true);
    try {
      const updated = await gateway.backlog_update({
        kind,
        filename: selected.filename,
        content: edit_text,
        expected_sha256: content_sha || null,
      });
      const next_text = edit_text.endsWith("\n") ? edit_text : `${edit_text}\n`;
      set_content(next_text);
      set_content_sha(String(updated?.sha256 || ""));
      set_editing(false);
      await refresh();
    } catch (e: any) {
      set_edit_error(String(e?.message || e || "Save failed"));
    } finally {
      set_edit_loading(false);
    }
  }

  async function load_exec_config(): Promise<BacklogExecConfigResponse | null> {
    if (!can_use_gateway) return null;
    if (exec_cfg_loading) return exec_cfg;
    set_exec_cfg_error("");
    set_exec_cfg_loading(true);
    try {
      const out = await gateway.backlog_exec_config();
      set_exec_cfg(out);
      return out;
    } catch (e: any) {
      const msg = String(e?.message || e || "Failed to load backlog exec config");
      set_exec_cfg_error(msg);
      set_exec_cfg(null);
      return null;
    } finally {
      set_exec_cfg_loading(false);
    }
  }

  async function load_exec_request(req: BacklogExecRequestSummary): Promise<void> {
    if (!can_use_gateway) return;
    set_exec_selected(req);
    if (is_compact_layout) set_compact_pane("detail");
    set_exec_detail(null);
    set_exec_detail_error("");
    set_exec_detail_loading(true);
    set_exec_qa_error("");
    set_exec_qa_feedback("");
    set_exec_log_text("");
    set_exec_log_error("");
    set_exec_log_truncated(false);
    try {
      const out = await gateway.backlog_exec_request(req.request_id);
      set_exec_detail(out?.payload ?? null);
    } catch (e: any) {
      set_exec_detail_error(String(e?.message || e || "Failed to load request"));
    } finally {
      set_exec_detail_loading(false);
    }
  }

  async function exec_send_feedback(): Promise<void> {
    if (!can_use_gateway) return;
    const rid = String(exec_selected?.request_id || "").trim();
    if (!rid) return;
    if (exec_qa_loading) return;
    const text = String(exec_qa_feedback || "");
    if (!text.trim()) {
      set_exec_qa_error("Feedback is required.");
      return;
    }
    set_exec_qa_error("");
    set_exec_qa_loading(true);
    try {
      const out = await gateway.backlog_exec_feedback({ request_id: rid, feedback: text });
      const payload = out?.payload ?? null;
      set_exec_detail(payload);
      if (payload) set_exec_selected(exec_summary_from_payload(payload, rid));
      set_exec_qa_feedback("");
      set_kind("processing");
      await refresh_exec_list("processing");
    } catch (e: any) {
      set_exec_qa_error(String(e?.message || e || "Failed to send feedback"));
    } finally {
      set_exec_qa_loading(false);
    }
  }

  async function exec_promote_to_prod(): Promise<void> {
    if (!can_use_gateway) return;
    const rid = String(exec_selected?.request_id || "").trim();
    if (!rid) return;
    if (exec_qa_loading) return;
    set_exec_qa_error("");
    set_exec_qa_loading(true);
    try {
      const out = await gateway.backlog_exec_promote({ request_id: rid, redeploy: true });
      const payload = out?.payload ?? null;
      set_exec_detail(payload);
      if (payload) set_exec_selected(exec_summary_from_payload(payload, rid));
      set_exec_qa_feedback("");
      set_completed_view("runs");
      set_kind("completed");
      await refresh_exec_list("completed");
      // Also refresh processing in the background so remaining awaiting_qa requests stay visible.
      await refresh_exec_list("processing");
    } catch (e: any) {
      set_exec_qa_error(String(e?.message || e || "Failed to promote to prod"));
      // Best-effort: reload request detail so blocked promotion info (conflicts) becomes visible.
      try {
        const out = await gateway.backlog_exec_request(rid);
        const payload = out?.payload ?? null;
        set_exec_detail(payload);
        if (payload) set_exec_selected(exec_summary_from_payload(payload, rid));
      } catch {
        // ignore
      }
    } finally {
      set_exec_qa_loading(false);
    }
  }

  async function exec_deploy_uat_now(): Promise<void> {
    if (!can_use_gateway) return;
    const rid = String(exec_selected?.request_id || "").trim();
    if (!rid) return;
    if (exec_qa_loading) return;
    set_exec_qa_error("");
    set_exec_qa_loading(true);
    try {
      const out = await gateway.backlog_exec_deploy_uat({ request_id: rid });
      const payload = out?.payload ?? null;
      set_exec_detail(payload);
      if (payload) set_exec_selected(exec_summary_from_payload(payload, rid));
      set_kind("processing");
      await refresh_exec_list("processing");
    } catch (e: any) {
      set_exec_qa_error(String(e?.message || e || "Failed to deploy to UAT"));
    } finally {
      set_exec_qa_loading(false);
    }
  }

  async function load_exec_log_tail(opts?: { request_id?: string; name?: "events" | "stderr" | "last_message"; max_bytes?: number }): Promise<void> {
    if (!can_use_gateway) return;
    const rid = String(opts?.request_id || exec_selected?.request_id || "").trim();
    if (!rid) return;
    const name = (opts?.name || exec_log_name) as any;
    const max_bytes = typeof opts?.max_bytes === "number" && Number.isFinite(opts.max_bytes) ? Number(opts.max_bytes) : 160_000;
    if (exec_log_loading) return;
    set_exec_log_error("");
    set_exec_log_loading(true);
    try {
      const out = await gateway.backlog_exec_log_tail({ request_id: rid, name: String(name), max_bytes });
      set_exec_log_text(String(out?.content || ""));
      set_exec_log_truncated(Boolean(out?.truncated));
    } catch (e: any) {
      set_exec_log_error(String(e?.message || e || "Failed to load logs"));
    } finally {
      set_exec_log_loading(false);
    }
  }

  function _artifact_id_from_ref(ref: any): string {
    if (!ref || typeof ref !== "object") return "";
    const v = (ref as any)["$artifact"];
    return typeof v === "string" ? v.trim() : "";
  }

  async function load_exec_full_log(opts?: { request_id?: string; name?: "events" | "stderr" | "last_message" }): Promise<void> {
    if (!can_use_gateway) return;
    const rid = String(opts?.request_id || exec_full_request_id || "").trim();
    if (!rid) return;
    const name = (opts?.name || exec_full_log_name) as any;
    if (exec_full_loading) return;
    set_exec_full_error("");
    set_exec_full_loading(true);
    set_exec_full_truncated(false);
    try {
      const detail = await gateway.backlog_exec_request(rid);
      const payload = detail?.payload;
      const ledger = payload?.result?.ledger;
      const ledger_run_id = String(ledger?.ledger_run_id || "").trim();
      const artifacts = ledger?.log_artifacts;
      const ref = artifacts ? (artifacts as any)[String(name)] : null;
      const aid = _artifact_id_from_ref(ref);
      if (ledger_run_id && aid) {
        const blob = await gateway.download_run_artifact_content(ledger_run_id, aid);
        const text = await blob.text();
        set_exec_full_text(text);
        return;
      }

      // Legacy fallback: tail API (bounded; may truncate).
      const out = await gateway.backlog_exec_log_tail({ request_id: rid, name: String(name), max_bytes: 400_000 });
      set_exec_full_text(String(out?.content || ""));
      set_exec_full_truncated(Boolean(out?.truncated));
      if (Boolean(out?.truncated)) {
        set_exec_full_error("Legacy fallback: log is truncated (this exec request predates ledger log capture).");
      }
    } catch (e: any) {
      set_exec_full_error(String(e?.message || e || "Failed to load execution log"));
    } finally {
      set_exec_full_loading(false);
    }
  }

  async function open_exec_full_log_for_backlog(backlog_filename: string): Promise<void> {
    if (!can_use_gateway) return;
    const fn = String(backlog_filename || "").trim();
    if (!fn) return;

    set_exec_full_open(true);
    set_exec_full_backlog_filename(fn);
    set_exec_full_requests([]);
    set_exec_full_request_id("");
    set_exec_full_log_name("events");
    set_exec_full_text("");
    set_exec_full_error("");
    set_exec_full_truncated(false);
    set_exec_full_search("");

    try {
      const res = await gateway.backlog_exec_requests({ status: "completed,failed", limit: 500 });
      const reqs = Array.isArray(res?.requests) ? res.requests : [];
      const matches = reqs.filter((r) => String(r.backlog_filename || "").trim() === fn);
      matches.sort((a, b) => {
        const ta = String(a.finished_at || a.started_at || a.created_at || "");
        const tb = String(b.finished_at || b.started_at || b.created_at || "");
        return tb.localeCompare(ta);
      });
      set_exec_full_requests(matches);
      if (!matches.length) {
        set_exec_full_error("No execution logs found for this backlog item.");
        return;
      }
      const rid = String(matches[0].request_id || "").trim();
      set_exec_full_request_id(rid);
      await load_exec_full_log({ request_id: rid, name: "events" });
      setTimeout(() => exec_full_textarea_ref.current?.focus(), 0);
    } catch (e: any) {
      set_exec_full_error(String(e?.message || e || "Failed to load execution logs"));
    }
  }

  function exec_full_find_next(dir: 1 | -1): void {
    const q = String(exec_full_search || "");
    if (!q) return;
    const text = String(exec_full_text || "");
    if (!text) return;
    const el = exec_full_textarea_ref.current;
    if (!el) return;

    const sel_start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
    const sel_end = typeof el.selectionEnd === "number" ? el.selectionEnd : 0;
    let idx = -1;
    if (dir === 1) {
      const start = Math.min(text.length, Math.max(0, sel_end));
      idx = text.indexOf(q, start);
      if (idx < 0 && start > 0) idx = text.indexOf(q, 0);
    } else {
      const start = Math.min(text.length, Math.max(0, sel_start - 1));
      idx = text.lastIndexOf(q, start);
      if (idx < 0 && start < text.length - 1) idx = text.lastIndexOf(q, text.length);
    }
    if (idx < 0) return;
    try {
      el.focus();
      el.setSelectionRange(idx, idx + q.length);
    } catch {
      // ignore
    }
  }

  async function confirm_execute(): Promise<void> {
    if (!execute_target) return;
    if (action_loading) return;
    set_action_error("");
    set_action_loading(true);
    try {
      const cfg = exec_cfg || (await load_exec_config());
      if (!cfg) {
        set_action_error("Could not load gateway exec config.");
        return;
      }
      const alive = cfg.runner_alive !== false;
      const codex_ok = cfg.codex_available !== false;
      if (cfg.runner_enabled !== true) {
        set_action_error("Backlog exec runner is disabled on this gateway.");
        return;
      }
      if (!alive) {
        set_action_error(cfg.runner_error ? `Backlog exec runner not running: ${cfg.runner_error}` : "Backlog exec runner is not running.");
        return;
      }
      if (!codex_ok) {
        const bin = String(cfg.codex_bin || "codex");
        set_action_error(`Codex not found on gateway: ${bin}`);
        return;
      }
      if (cfg.can_execute !== true) {
        set_action_error("Backlog exec is not available on this gateway (misconfigured executor).");
        return;
      }
      const out = await gateway.backlog_execute({ kind: execute_target.kind, filename: execute_target.filename, execution_mode: execute_mode });
      const request_id = String(out?.request_id || "").trim();
      if (!request_id) throw new Error("No request_id returned");
      set_execute_confirm_open(false);
      set_execute_target(null);

      // Switch to Processing for immediate observability.
      set_kind("processing");
      set_completed_view("tasks");
      set_query("");
      set_selected(null);
      set_content("");
      set_content_sha("");
      set_content_error("");
      set_editing(false);
      set_edit_text("");
      set_edit_error("");
      set_maint_messages([]);
      set_maint_input("");
      set_maint_loading(false);
      set_maint_error("");
      set_edit_attachments_uploading(false);
      set_edit_attachments_error("");
      set_edit_recent_attachments([]);

      const provisional: BacklogExecRequestSummary = { request_id, status: "queued" };
      set_exec_selected(provisional);
      set_exec_detail(null);
      set_exec_detail_error("");
      const next_exec = await refresh_exec_list("processing");
      const match = next_exec.find((r) => r.request_id === request_id) || null;
      if (match) await load_exec_request(match);
      else await load_exec_request(provisional);
    } catch (e: any) {
      set_action_error(String(e?.message || e || "Execute failed"));
    } finally {
      set_action_loading(false);
    }
  }

  async function confirm_execute_batch(): Promise<void> {
    if (batch_execute_loading) return;
    if (!batch_selected_items.length) return;
    if (batch_selected_items.length < 2) {
      set_batch_execute_error("Select at least 2 planned backlog items.");
      return;
    }
    set_batch_execute_error("");
    set_batch_execute_loading(true);
    try {
      const cfg = exec_cfg || (await load_exec_config());
      if (!cfg) {
        set_batch_execute_error("Could not load gateway exec config.");
        return;
      }
      const alive = cfg.runner_alive !== false;
      const codex_ok = cfg.codex_available !== false;
      if (cfg.runner_enabled !== true) {
        set_batch_execute_error("Backlog exec runner is disabled on this gateway.");
        return;
      }
      if (!alive) {
        set_batch_execute_error(cfg.runner_error ? `Backlog exec runner not running: ${cfg.runner_error}` : "Backlog exec runner is not running.");
        return;
      }
      if (!codex_ok) {
        const bin = String(cfg.codex_bin || "codex");
        set_batch_execute_error(`Codex not found on gateway: ${bin}`);
        return;
      }
      if (cfg.can_execute !== true) {
        set_batch_execute_error("Backlog exec is not available on this gateway (misconfigured executor).");
        return;
      }

      const out = await gateway.backlog_execute_batch({
        items: batch_selected_items.map((it) => ({ kind: "planned", filename: it.filename })),
        execution_mode: batch_execute_mode,
      });
      const request_id = String(out?.request_id || "").trim();
      if (!request_id) throw new Error("No request_id returned");

      set_batch_execute_open(false);
      set_batch_filenames([]);

      // Switch to Processing for immediate observability.
      set_kind("processing");
      set_completed_view("tasks");
      set_query("");
      set_selected(null);
      set_content("");
      set_content_sha("");
      set_content_error("");
      set_editing(false);
      set_edit_text("");
      set_edit_error("");

      const provisional: BacklogExecRequestSummary = { request_id, status: "queued" };
      set_exec_selected(provisional);
      set_exec_detail(null);
      set_exec_detail_error("");
      const next_exec = await refresh_exec_list("processing");
      const match = next_exec.find((r) => r.request_id === request_id) || null;
      if (match) await load_exec_request(match);
      else await load_exec_request(provisional);
    } catch (e: any) {
      set_batch_execute_error(String(e?.message || e || "Execute batch failed"));
    } finally {
      set_batch_execute_loading(false);
    }
  }

  async function submit_merge_master(): Promise<void> {
    if (merge_loading) return;
    if (batch_selected_items.length < 2) {
      set_merge_error("Select at least 2 planned backlog items.");
      return;
    }
    const title = merge_title.trim();
    if (!title) {
      set_merge_error("Title is required.");
      return;
    }
    const pkg = merge_package.trim().toLowerCase();
    if (!pkg) {
      set_merge_error("Package is required.");
      return;
    }
    set_merge_error("");
    set_merge_loading(true);
    try {
      const out = await gateway.backlog_merge({
        kind: "planned",
        package: pkg,
        title,
        task_type: merge_task_type,
        summary: merge_summary.trim() || null,
        items: batch_selected_items.map((it) => ({ kind: "planned", filename: it.filename })),
      });
      const created_kind = String(out?.kind || "").trim() as BacklogFileKind;
      const filename = String(out?.filename || "").trim();
      if (!created_kind || !filename) throw new Error("Merge succeeded but returned an invalid response");

      set_merge_open(false);
      set_merge_title("");
      set_merge_summary("");
      set_batch_filenames([]);

      set_kind(created_kind as any);
      set_query("");
      const next = await refresh_backlog_list(created_kind);
      const it = next.find((i) => i.filename === filename) || null;
      if (it) await load_item(it, { kind: created_kind });
    } catch (e: any) {
      set_merge_error(String(e?.message || e || "Merge failed"));
    } finally {
      set_merge_loading(false);
    }
  }

  function reset_new_task(): void {
    set_new_kind("proposed");
    set_new_task_type("feature");
    set_new_package("framework");
    set_new_title("");
    set_new_summary("");
    set_new_draft("");
    set_new_error("");
    set_new_loading(false);
    set_guided_diagram("");
    set_guided_context("");
    set_guided_included("");
    set_guided_excluded("");
    set_guided_plan("");
    set_guided_dependencies("");
    set_guided_acceptance("");
    set_guided_tests_a("");
    set_guided_tests_b("");
    set_guided_tests_c("");
    set_new_attachments([]);
    set_attachments_uploading(false);
    set_attachments_error("");
    set_assist_messages([]);
    set_assist_input("");
    set_assist_loading(false);
  }

  async function ensure_backlog_template(): Promise<string> {
    const existing = String(backlog_template_md || "").trim();
    if (existing) return existing;
    if (template_loading) return "";
    set_template_error("");
    set_template_loading(true);
    try {
      const out = await gateway.backlog_template();
      const text = String(out?.content || "");
      set_backlog_template_md(text);
      return text;
    } catch (e: any) {
      set_template_error(String(e?.message || e || "Failed to load backlog template"));
      return "";
    } finally {
      set_template_loading(false);
    }
  }

  async function apply_template_to_draft(opts?: { force?: boolean }): Promise<void> {
    if (!can_use_gateway) return;
    const force = opts?.force === true;
    if (!force && new_draft.trim()) return;
    const template_md = await ensure_backlog_template();
    if (!template_md.trim()) return;
    const pkg = String(new_package || "").trim().toLowerCase() || "{Package}";
    const created_at = format_created_at();
    const rendered = render_backlog_template_draft(template_md, {
      package_name: pkg,
      title: new_title,
      task_type: new_task_type,
      summary: new_summary,
      created_at,
    });
    set_new_draft((prev) => (force || !String(prev || "").trim() ? rendered : prev));
  }

  function regenerate_draft_from_guided(opts?: { force?: boolean }): void {
    const force = opts?.force === true;
    if (!force && new_draft.trim()) {
      const ok = globalThis.confirm("Overwrite the current draft markdown with a guided draft?");
      if (!ok) return;
    }
    const pkg = String(new_package || "").trim().toLowerCase() || "{Package}";
    const created_at = format_created_at();
    const draft = generate_backlog_draft_from_guided({
      package_name: pkg,
      title: new_title,
      task_type: new_task_type,
      summary: new_summary,
      diagram: guided_diagram,
      context: guided_context,
      included: _lines_list(guided_included),
      excluded: _lines_list(guided_excluded),
      plan: _lines_list(guided_plan),
      dependencies: _lines_list(guided_dependencies),
      acceptance: _lines_list(guided_acceptance),
      tests_a: _lines_list(guided_tests_a),
      tests_b: _lines_list(guided_tests_b),
      tests_c: _lines_list(guided_tests_c),
      created_at,
      attachments: [],
    });
    set_new_draft(draft);
  }

  async function submit_new_task(): Promise<void> {
    if (new_loading) return;
    set_new_error("");
    set_new_loading(true);
    set_attachments_error("");
    let attachment_warning = "";
    try {
      const pkg = String(new_package || "")
        .trim()
        .toLowerCase();
      const out = await gateway.backlog_create({
        kind: new_kind,
        package: pkg,
        title: new_title,
        task_type: new_task_type,
        summary: new_summary || null,
        content: new_draft || null,
      });
      const created_kind = String(out?.kind || "").trim() as BacklogFileKind;
      const filename = String(out?.filename || "").trim();

      const attachments = [...(new_attachments || [])];
      if (created_kind && filename && attachments.length) {
        set_attachments_uploading(true);
        try {
          const uploaded: string[] = [];
          for (const f of attachments) {
            const res = await gateway.backlog_upload_attachment({ kind: created_kind, filename, file: f, overwrite: false });
            const relpath = String(res?.stored?.relpath || "").trim();
            if (relpath) uploaded.push(relpath);
          }
          if (uploaded.length) {
            const current = await gateway.backlog_content(created_kind as any, filename);
            const cur_text = String(current?.content || "");
            const cur_sha = await sha256_hex(cur_text);
            const next_text = insert_attachment_links(cur_text, uploaded);
            await gateway.backlog_update({ kind: created_kind, filename, content: next_text, expected_sha256: cur_sha || null });
          }
        } catch (e: any) {
          attachment_warning = String(e?.message || e || "Attachment upload failed");
          set_attachments_error(attachment_warning);
        } finally {
          set_attachments_uploading(false);
        }
      }

      set_new_task_open(false);
      reset_new_task();
      if (created_kind) set_kind(created_kind);
      const next = await refresh_backlog_list(created_kind);
      const it = next.find((i) => i.filename === filename) || null;
      if (it) await load_item(it, { kind: created_kind });
      if (attachment_warning) set_action_error(`Created task, but attachments failed: ${attachment_warning}`);
    } catch (e: any) {
      set_new_error(String(e?.message || e || "Create failed"));
    } finally {
      set_new_loading(false);
    }
  }

  async function send_assist(): Promise<void> {
    if (assist_loading) return;
    set_new_error("");
    const msg = assist_input.trim();
    if (!msg) return;
    if (!new_title.trim()) {
      set_new_error("Title is required before using AI assist.");
      return;
    }
    const pkg = String(new_package || "")
      .trim()
      .toLowerCase();
    if (!pkg) {
      set_new_error("Package is required before using AI assist.");
      return;
    }
    const user_msg: ChatMessage = { id: random_id(), role: "user", content: msg, ts: new Date().toISOString() };
    const next_msgs = [...assist_messages, user_msg];
    set_assist_messages(next_msgs);
    set_assist_input("");
    set_assist_loading(true);
    try {
      const out = await gateway.backlog_assist({
        kind: new_kind,
        package: pkg,
        title: new_title,
        summary: new_summary || null,
        draft_markdown: new_draft || null,
        messages: next_msgs.map((m) => ({ role: m.role, content: m.content })),
        provider: maint_provider || null,
        model: maint_model || null,
      });
      const reply = String(out?.reply || "").trim();
      const draft = String(out?.draft_markdown || "").trim();
      if (reply) set_assist_messages((ms) => [...ms, { id: random_id(), role: "assistant", content: reply, ts: new Date().toISOString() }]);
      if (draft) set_new_draft(draft);
    } catch (e: any) {
      set_new_error(String(e?.message || e || "AI assist failed"));
    } finally {
      set_assist_loading(false);
    }
  }

  async function upload_edit_attachments(files: File[]): Promise<void> {
    if (!selected) return;
    if (!is_backlog_file_kind(kind)) return;
    if (!files.length) return;
    if (!can_use_gateway) return;
    if (edit_attachments_uploading) return;
    set_edit_attachments_error("");
    set_edit_attachments_uploading(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        const res = await gateway.backlog_upload_attachment({ kind, filename: selected.filename, file: f, overwrite: false });
        const relpath = String(res?.stored?.relpath || "").trim();
        if (relpath) uploaded.push(relpath);
      }
      if (uploaded.length) {
        set_edit_recent_attachments((prev) => [...uploaded, ...prev].slice(0, 12));
        set_edit_text((prev) => insert_attachment_links(String(prev || ""), uploaded));
      }
    } catch (e: any) {
      set_edit_attachments_error(String(e?.message || e || "Attachment upload failed"));
    } finally {
      set_edit_attachments_uploading(false);
    }
  }

  async function send_maintain(): Promise<void> {
    if (maint_loading) return;
    if (!selected) return;
    if (!is_backlog_file_kind(kind)) return;
    if (!can_use_gateway) return;
    const can_maintain = kind === "planned" || kind === "proposed" || kind === "recurrent" || kind === "deprecated";
    if (!can_maintain) {
      set_maint_error("Maintenance chat is only available for planned/proposed/recurrent/deprecated items.");
      return;
    }
    set_maint_error("");
    const msg = maint_input.trim();
    if (!msg) return;
    const user_msg: ChatMessage = { id: random_id(), role: "user", content: msg, ts: new Date().toISOString() };
    const next_msgs = [...maint_messages, user_msg];
    set_maint_messages(next_msgs);
    set_maint_input("");
    set_maint_loading(true);
    try {
      const pkg = infer_backlog_package(selected);
      if (!pkg) throw new Error("Backlog item missing package (cannot maintain)");
      const out = await gateway.backlog_maintain({
        kind,
        filename: selected.filename,
        package: pkg,
        title: selected.title || selected.filename,
        summary: selected.summary || null,
        draft_markdown: edit_text || null,
        messages: next_msgs.map((m) => ({ role: m.role, content: m.content })),
        provider: maint_provider || null,
        model: maint_model || null,
      });
      const reply = String(out?.reply || "").trim();
      const draft = String(out?.draft_markdown || "").trim();
      if (reply) set_maint_messages((ms) => [...ms, { id: random_id(), role: "assistant", content: reply, ts: new Date().toISOString() }]);
      if (draft) set_edit_text(draft);
    } catch (e: any) {
      set_maint_error(String(e?.message || e || "Maintenance AI failed"));
    } finally {
      set_maint_loading(false);
    }
  }

  async function send_advisor(): Promise<void> {
    if (advisor_loading) return;
    if (!can_use_gateway) return;
    if (advisor_voice.voice_ptt_busy) {
      set_advisor_voice_error("Wait for transcription to finish.");
      return;
    }
    set_advisor_error("");
    set_advisor_voice_error("");
    const msg = advisor_input.trim();
    if (!msg) return;
    const user_msg: ChatMessage = { id: random_id(), role: "user", content: msg, ts: new Date().toISOString() };
    const next_msgs = [...advisor_messages, user_msg];
    set_advisor_messages(next_msgs);
    set_advisor_input("");
    set_advisor_loading(true);
    try {
      const out = await gateway.backlog_advisor({
        messages: next_msgs.map((m) => ({ role: m.role, content: m.content })),
        provider: maint_provider || null,
        model: maint_model || null,
        agent: advisor_agent || null,
        include_trace: advisor_show_tools,
        focus_kind: kind,
        focus_type: type_filter,
      });
      const tool_trace = advisor_show_tools && Array.isArray((out as any)?.tool_trace) ? ((out as any).tool_trace as any[]) : [];
      const run_id = String((out as any)?.run_id || "").trim();
      const reply = String(out?.reply || "").trim();
      if (advisor_show_tools && tool_trace.length) {
        const trace_msg: ChatMessage = {
          id: random_id(),
          role: "system",
          title: "Tool execution",
          level: "info",
          ts: new Date().toISOString(),
          content: JSON.stringify({ run_id: run_id || null, tool_trace }, null, 2),
        };
        set_advisor_messages((ms) => [...ms, trace_msg]);
      }
      if (reply) set_advisor_messages((ms) => [...ms, { id: random_id(), role: "assistant", content: reply, ts: new Date().toISOString() }]);
    } catch (e: any) {
      set_advisor_error(String(e?.message || e || "Backlog advisor failed"));
    } finally {
      set_advisor_loading(false);
    }
  }

  async function attach_advisor_files(files: File[]): Promise<void> {
    const list = Array.from(files || []);
    if (!list.length) return;

    const chunks: string[] = [];
    const picked: string[] = [];
    const max_files = 6;
    const max_chars_per_file = 20_000;
    for (const f of list.slice(0, max_files)) {
      const name = String(f?.name || "").trim() || "attachment";
      picked.push(name);
      try {
        const raw = await f.text();
        const text = raw.length > max_chars_per_file ? `${raw.slice(0, max_chars_per_file)}\n…(truncated)…\n` : raw;
        chunks.push(`[attached file: ${name}]\n\n\`\`\`\n${text}\n\`\`\``);
      } catch {
        chunks.push(`[attached file: ${name}] (unreadable in browser)`);
      }
    }

    set_advisor_recent_attachments((prev) => [...picked, ...prev].slice(0, 12));
    set_advisor_input((prev) => {
      const base = String(prev || "").trim();
      const addition = chunks.join("\n\n");
      return base ? `${base}\n\n${addition}` : addition;
    });

    try {
      advisor_input_ref.current?.focus();
    } catch {
      // ignore
    }
  }

  function toggle_advisor_tts(m: ChatMessage): void {
    const key = String(m.id || m.ts || "").trim();
    const text = String(m.content || "").trim();
    if (!key || !text) return;
    set_advisor_voice_error("");
    void advisor_voice.toggle_tts(key, text);
  }

  function advisor_tts_state_for(m: ChatMessage): "idle" | "loading" | "playing" | "paused" {
    const key = String(m.id || m.ts || "").trim();
    const cur = advisor_voice.tts_playback;
    if (!key || !cur.key || cur.key !== key) return "idle";
    return cur.status;
  }

  function stop_advisor_voice(): void {
    advisor_voice.stop_voice_ptt_recording();
    advisor_voice.stop_tts();
  }

  const selected_task_type = selected && is_parsed(selected) ? normalize_task_type(selected.task_type) : null;

  const can_execute = Boolean(selected && kind === "planned");
  const can_elevate = Boolean(selected && kind === "proposed");
  const can_downgrade = Boolean(selected && kind === "planned");
  const can_deprecate = Boolean(selected && is_backlog_file_kind(kind) && kind !== "deprecated" && kind !== "trash");
  const can_trash = Boolean(selected && is_backlog_file_kind(kind) && kind !== "trash");
  const can_restore_from_trash = Boolean(selected && kind === "trash");
  const can_restore_from_deprecated = Boolean(selected && kind === "deprecated");

  const show_compact_list = !is_compact_layout || compact_pane === "list";
  const show_compact_detail = !is_compact_layout || compact_pane === "detail";

  return (
    <div className="page backlog_page">
      <div className="page_inner">
        <div className="card">
          <div className="title">
            <h1>Backlog</h1>
	            {can_use_gateway && exec_cfg ? (
	              <span
	                className="badge"
	                style={{
	                  background: exec_cfg.runner_alive ? "rgba(34, 197, 94, 0.14)" : "rgba(239, 68, 68, 0.14)",
	                  borderColor: exec_cfg.runner_alive ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)",
	                }}
	                title={
	                  exec_cfg.codex_model || exec_cfg.codex_reasoning_effort
	                    ? `codex: ${String(exec_cfg.codex_model || "").trim() || "?"}${exec_cfg.codex_reasoning_effort ? ` (reasoning ${exec_cfg.codex_reasoning_effort})` : ""}`
	                    : undefined
	                }
	              >
	                exec worker {exec_cfg.runner_alive ? "on" : "off"}
	                {!is_compact_layout && exec_cfg.codex_model ? ` · ${exec_cfg.codex_model}` : ""}
	                {!is_compact_layout && exec_cfg.codex_reasoning_effort ? ` · ${exec_cfg.codex_reasoning_effort}` : ""}
	              </span>
	            ) : null}
          </div>

          <div className="row backlog_toolbar" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div className="tab_bar backlog_tabs" style={{ paddingBottom: 0, borderBottom: "none" }}>
              <button className={`tab ${kind === "processing" ? "active" : ""}`} onClick={() => set_kind("processing")}>
                Processing
              </button>
              <button className={`tab ${kind === "planned" ? "active" : ""}`} onClick={() => set_kind("planned")}>
                Planned
              </button>
              <button className={`tab ${kind === "proposed" ? "active" : ""}`} onClick={() => set_kind("proposed")}>
                Proposed
              </button>
              <button className={`tab ${kind === "recurrent" ? "active" : ""}`} onClick={() => set_kind("recurrent")}>
                Recurrent
              </button>
              <button className={`tab ${kind === "completed" ? "active" : ""}`} onClick={() => set_kind("completed")}>
                Completed
              </button>
              <button className={`tab ${kind === "failed" ? "active" : ""}`} onClick={() => set_kind("failed")}>
                Failed
              </button>
              <button className={`tab ${kind === "deprecated" ? "active" : ""}`} onClick={() => set_kind("deprecated")}>
                Deprecated
              </button>
              <button className={`tab ${kind === "trash" ? "active" : ""}`} onClick={() => set_kind("trash")}>
                Trash
              </button>
            </div>
            <div className="row backlog_toolbar_actions" style={{ gap: "8px", justifyContent: "flex-end" }}>
              <button
                className="btn btn_icon"
                onClick={() => set_new_task_open(true)}
                disabled={!can_use_gateway}
                title="New task"
                aria-label="New task"
              >
                <Icon name="plus" size={16} />
                <span className="btn_label">New</span>
              </button>
              <button
                className={`btn btn_icon ${(is_exec_view ? exec_loading : loading) ? "is_loading" : ""}`}
                onClick={() => void refresh()}
                disabled={!can_use_gateway || (is_exec_view ? exec_loading : loading)}
                title="Refresh"
                aria-label="Refresh"
              >
                <Icon name="refresh" size={16} />
                <span className="btn_label">{is_exec_view ? (exec_loading ? "Refreshing" : "Refresh") : loading ? "Refreshing" : "Refresh"}</span>
              </button>
            </div>
          </div>

          <div
            className={`row backlog_filters ${kind === "completed" ? "backlog_filters_completed" : ""}`}
            style={{
              marginTop: "10px",
              alignItems: kind === "completed" ? "flex-start" : "center",
              justifyContent: "space-between",
            }}
          >
            {kind === "completed" ? (
              <>
                <div className="backlog_filters_left">
                  <div className="field backlog_search_field">
                    <input
                      value={query}
                      onChange={(e) => set_query(e.target.value)}
                      placeholder={is_exec_view ? "Search exec requests (id/status/backlog/error…)" : "Search backlog (id/title/package/filename…)"}
                    />
                  </div>
                </div>

                <div className="backlog_filters_right">
                  <div className="tab_bar backlog_completed_view_tabs" style={{ paddingBottom: 0, borderBottom: "none" }}>
                    <button className={`tab ${completed_view === "tasks" ? "active" : ""}`} onClick={() => set_completed_view("tasks")}>
                      Tasks
                    </button>
                    <button className={`tab ${completed_view === "runs" ? "active" : ""}`} onClick={() => set_completed_view("runs")}>
                      Runs
                    </button>
                  </div>
                  <div className="backlog_completed_meta_row">
                    {!is_exec_view ? (
                      <div className="field backlog_type_filter_field">
                        <select value={type_filter} onChange={(e) => set_type_filter(e.target.value as any)} title="Filter by type">
                          <option value="all">all</option>
                          <option value="task">task</option>
                          <option value="bug">bug</option>
                          <option value="feature">feature</option>
                        </select>
                      </div>
                    ) : null}
                    <div className="mono muted backlog_count" style={{ fontSize: "var(--font-size-sm)" }}>
                      {is_exec_view ? `${filtered_exec_requests.length}/${exec_requests.length}` : `${filtered_items.length}/${items.length}`}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="field backlog_search_field">
                  <input
                    value={query}
                    onChange={(e) => set_query(e.target.value)}
                    placeholder={is_exec_view ? "Search exec requests (id/status/backlog/error…)" : "Search backlog (id/title/package/filename…)"}
                  />
                </div>
                {!is_exec_view ? (
                  <div className="field backlog_type_filter_field">
                    <select value={type_filter} onChange={(e) => set_type_filter(e.target.value as any)} title="Filter by type">
                      <option value="all">all</option>
                      <option value="task">task</option>
                      <option value="bug">bug</option>
                      <option value="feature">feature</option>
                    </select>
                  </div>
                ) : null}
                <div className="mono muted backlog_count" style={{ fontSize: "var(--font-size-sm)" }}>
                  {is_exec_view ? `${filtered_exec_requests.length}/${exec_requests.length}` : `${filtered_items.length}/${items.length}`}
                </div>
              </>
            )}
          </div>

          {!is_exec_view && kind === "planned" && planned_hidden_filenames.length ? (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
              {planned_hidden_filenames.length} planned item{planned_hidden_filenames.length === 1 ? "" : "s"} hidden while queued/running.{" "}
              <button
                className="btn"
                style={{ padding: "4px 10px", marginLeft: "6px" }}
                onClick={() => set_kind("processing")}
                disabled={!can_use_gateway}
              >
                View processing
              </button>
            </div>
          ) : null}

          {!is_exec_view && kind === "planned" ? (
            <details style={{ marginTop: "10px" }}>
              <summary className="mono muted" style={{ cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
                Batch actions (shared context)
              </summary>
              <div style={{ marginTop: "10px" }}>
                <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                  Select multiple planned backlog items to either execute them sequentially in a single exec worker (one Codex run) or merge them into a
                  master backlog item.
                </div>
                <div style={{ marginTop: "10px" }}>
                  <MultiSelect
                    options={items.map((it) => String(it.filename || "").trim()).filter(Boolean)}
                    value={batch_filenames}
                    disabled={!can_use_gateway || loading}
                    placeholder="(no items selected)"
                    onChange={(next) => set_batch_filenames(next)}
                  />
                </div>
                <div className="row" style={{ gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  <button
                    className="btn primary"
                    disabled={!can_use_gateway || batch_selected_items.length < 2}
                    onClick={() => {
                      set_batch_execute_error("");
                      set_batch_execute_mode("uat");
                      set_batch_execute_open(true);
                    }}
                  >
                    Execute batch
                  </button>
                  <button
                    className="btn"
                    disabled={!can_use_gateway || batch_selected_items.length < 2}
                    onClick={() => {
                      const inferred_pkg = (() => {
                        const pkgs = batch_selected_items.map((it) => String(it.package || "").trim()).filter(Boolean);
                        if (!pkgs.length) return "framework";
                        const first = pkgs[0];
                        return pkgs.every((p) => p === first) ? first : "framework";
                      })();
                      set_merge_package(inferred_pkg);
                      set_merge_task_type("task");
                      set_merge_title(`Master backlog (${batch_selected_items.length} items)`);
                      set_merge_summary("");
                      set_merge_error("");
                      set_merge_open(true);
                    }}
                  >
                    Merge → master
                  </button>
                </div>
              </div>
            </details>
          ) : null}

          {!is_exec_view && error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", marginTop: "8px", fontSize: "var(--font-size-sm)" }}>
              {error}
            </div>
          ) : null}
          {is_exec_view && exec_error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", marginTop: "8px", fontSize: "var(--font-size-sm)" }}>
              {exec_error}
            </div>
          ) : null}
          {!is_exec_view && !error && !loading && !items.length ? (
            <div className="mono muted" style={{ marginTop: "8px", fontSize: "var(--font-size-sm)" }}>
              No items (or backlog browsing not configured on this gateway).
            </div>
          ) : null}
          {is_exec_view && !exec_error && !exec_loading && !exec_requests.length ? (
            <div className="mono muted" style={{ marginTop: "8px", fontSize: "var(--font-size-sm)" }}>
              No exec requests found.
            </div>
          ) : null}
        </div>

        <div className="inbox_layout">
          {show_compact_list ? (
            <div className="card inbox_sidebar">
              <div className="inbox_list">
                {is_exec_view ? (
                  !filtered_exec_requests.length ? (
                    <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                      No requests.
                    </div>
                  ) : (
                    filtered_exec_requests.map((r) => {
                      const active = exec_selected?.request_id === r.request_id;
                      const st = String(r.status || "").trim().toLowerCase();
                      const status_chip =
                        st === "completed" || st === "promoted"
                          ? "ok"
                          : st === "failed"
                            ? "danger"
                          : st === "running"
                            ? "info"
                            : st === "queued" || st === "awaiting_qa"
                              ? "warn"
                              : "muted";
                      return (
                        <button
                          key={`exec:${r.request_id}`}
                          className={`inbox_item ${active ? "active" : ""}`}
                          onClick={() => void load_exec_request(r)}
                        >
                          <div className="inbox_item_title">
                            <span className={`chip ${status_chip} mono`}>{st || "unknown"}</span>
                            <span className="item_title_text">{short_id(r.backlog_filename || r.backlog_relpath || "request", 56)}</span>
                          </div>
                          <div className="inbox_item_meta mono muted">{short_id(r.request_id, 80)}</div>
                          {r.error ? (
                            <div className="inbox_item_meta mono" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                              {short_id(r.error, 180)}
                            </div>
                          ) : null}
                        </button>
                      );
                    })
                  )
                ) : !filtered_items.length ? (
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    No items.
                  </div>
                ) : (
                  filtered_items.map((it) => {
                    const active = selected?.filename === it.filename;
                    const parsed = is_parsed(it);
                    const tt = normalize_task_type(it.task_type);
                    return (
                      <button key={`${kind}:${it.filename}`} className={`inbox_item ${active ? "active" : ""}`} onClick={() => void load_item(it)}>
                        <div className="inbox_item_title">
                          {!parsed ? <span className="pill unparsed">unparsed</span> : null}
                          {it.item_id ? <span className="chip info mono">#{it.item_id}</span> : null}
                          {parsed ? <span className={`chip ${task_type_chip(tt)} mono`}>{tt}</span> : null}
                          {it.package ? <span className="chip muted mono">{it.package}</span> : null}
                          <span className="item_title_text">{short_id(it.title || it.filename, 56)}</span>
                        </div>
                        {it.summary ? (
                          <div className="item_summary_text">
                            <Markdown text={_summary_preview_markdown(it.summary)} className="backlog_summary_md" />
                          </div>
                        ) : null}
                        <div className="inbox_item_meta mono muted">{it.filename}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {show_compact_detail ? (
            <div className="card inbox_viewer">
            {is_exec_view ? (
              exec_selected ? (
                <div className="inbox_detail">
                  <div className="inbox_detail_header">
                    <div className="inbox_detail_title">
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {exec_selected.backlog_filename || exec_selected.backlog_relpath || exec_selected.request_id}
                      </span>
                      {(() => {
                        const st = String(exec_selected.status || "").trim().toLowerCase();
                        const status_chip =
                          st === "completed" || st === "promoted"
                            ? "ok"
                            : st === "failed"
                              ? "danger"
                              : st === "running"
                                ? "info"
                                : st === "queued" || st === "awaiting_qa"
                                  ? "warn"
                                  : "muted";
                        return <span className={`chip mono ${status_chip}`}>{st || "unknown"}</span>;
                      })()}
                      <span className="chip mono muted">{short_id(exec_selected.request_id, 16)}</span>
                    </div>
	                    <div className="inbox_detail_actions">
	                      {is_compact_layout ? (
	                        <button className="btn" onClick={() => set_compact_pane("list")} disabled={exec_detail_loading}>
	                          Back
	                        </button>
	                      ) : null}
	                      <button
	                        className="btn btn_icon"
	                        onClick={() => copyText(exec_selected.request_id)}
	                        disabled={exec_detail_loading}
	                        aria-label="Copy request id"
	                        title="Copy request id"
	                      >
	                        <Icon name="copy" size={16} />
	                        {is_compact_layout ? null : "Copy request id"}
	                      </button>
	                      {exec_selected.backlog_relpath ? (
	                        <button
	                          className="btn btn_icon"
	                          onClick={() => copyText(exec_selected.backlog_relpath || "")}
	                          disabled={exec_detail_loading}
	                          aria-label="Copy backlog path"
	                          title="Copy backlog path"
	                        >
	                          <Icon name="copy" size={16} />
	                          {is_compact_layout ? null : "Copy backlog path"}
	                        </button>
	                      ) : null}
	                      {(() => {
	                        const items = Array.isArray(exec_detail?.backlog_queue?.items) ? (exec_detail.backlog_queue.items as any[]) : [];
	                        const rels = items
	                          .map((it) => String(it?.relpath || "").trim())
	                          .filter(Boolean);
	                        if (!rels.length) return null;
	                        return (
	                          <button
	                            className="btn btn_icon"
	                            onClick={() => copyText(rels.join("\n"))}
	                            disabled={exec_detail_loading}
	                            aria-label="Copy backlog paths"
	                            title="Copy backlog paths"
	                          >
	                            <Icon name="copy" size={16} />
	                            {is_compact_layout ? null : "Copy backlog paths"}
	                          </button>
	                        );
	                      })()}
	                      {exec_selected.run_dir_relpath ? (
	                        <button
	                          className="btn btn_icon"
	                          onClick={() => copyText(exec_selected.run_dir_relpath || "")}
	                          disabled={exec_detail_loading}
	                          aria-label="Copy run dir"
	                          title="Copy run dir"
	                        >
	                          <Icon name="copy" size={16} />
	                          {is_compact_layout ? null : "Copy run dir"}
	                        </button>
	                      ) : null}
	                    </div>
	                  </div>

                  <div className="inbox_detail_meta mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    {exec_selected.created_at ? `created ${new Date(exec_selected.created_at).toLocaleString()}` : ""}
                    {exec_selected.started_at ? ` • started ${new Date(exec_selected.started_at).toLocaleString()}` : ""}
                    {exec_selected.finished_at ? ` • finished ${new Date(exec_selected.finished_at).toLocaleString()}` : ""}
                  </div>

                  {exec_selected.error ? (
                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                      {exec_selected.error}
                    </div>
                  ) : null}
                  {exec_detail_error ? (
                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                      {exec_detail_error}
                    </div>
                  ) : null}

                  <div style={{ marginTop: "12px" }}>
                    {exec_detail_loading ? (
                      <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                        Loading…
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const st = String(exec_selected.status || "").trim().toLowerCase();
                          if (st !== "awaiting_qa") return null;
                          const exec_mode = String((exec_detail as any)?.execution_mode || "").trim().toLowerCase() || "uat";
                          const candidate_rel = String((exec_detail as any)?.candidate_relpath || "").trim();
                          const patch_rel = String((exec_detail as any)?.candidate_patch_relpath || "").trim();
                          const manifest_rel = String((exec_detail as any)?.candidate_manifest_relpath || "").trim();
                          const uat_rel = String((exec_detail as any)?.uat_current_relpath || "").trim();
                          const uat_lock_owner = String((exec_detail as any)?.uat_lock_owner_request_id || "").trim();
                          const uat_lock_acquired = Boolean((exec_detail as any)?.uat_lock_acquired);
                          const uat_pending = Boolean((exec_detail as any)?.uat_pending);
                          const uat_deploy = (exec_detail as any)?.uat_deploy ?? null;
                          const uat_deploy_err = String((exec_detail as any)?.uat_deploy_error || "").trim();
                          const attempt = (exec_detail as any)?.attempt;
                          const promotion_report = (exec_detail as any)?.promotion_report ?? null;
                          const promo_blocked = Boolean((promotion_report as any)?.blocked);
                          const promo_reason = String((promotion_report as any)?.reason || "").trim();
                          const promo_conflicts = Array.isArray((promotion_report as any)?.conflicts)
                            ? ((promotion_report as any)?.conflicts as any[]).slice(0, 8)
                            : [];
                          const promo_conflicts_total =
                            typeof (promotion_report as any)?.conflicts_total === "number"
                              ? Number((promotion_report as any).conflicts_total)
                              : promo_conflicts.length;

                          let uat_deploy_status = "";
                          let uat_deploy_reason = "";
                          const uat_probe_failed: string[] = [];
                          try {
                            const procs = (uat_deploy as any)?.processes;
                            if (procs && typeof procs === "object" && !Array.isArray(procs)) {
                              if (typeof (procs as any).status === "string") uat_deploy_status = String((procs as any).status || "").trim();
                              if (typeof (procs as any).reason === "string") uat_deploy_reason = String((procs as any).reason || "").trim();
                              for (const [pid, st] of Object.entries(procs as any)) {
                                if (!st || typeof st !== "object" || Array.isArray(st)) continue;
                                const probe = (st as any).probe;
                                if (!probe || typeof probe !== "object") continue;
                                if ((probe as any).ok === false) uat_probe_failed.push(String(pid));
                              }
                            }
                          } catch {
                            // ignore
                          }
                          return (
                            <>
                              <div className="section_title">QA decision</div>
                              <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
                                <div>
                                  <span className="mono muted">mode:</span> {exec_mode}
                                </div>
                                {typeof attempt === "number" ? (
                                  <div>
                                    <span className="mono muted">attempt:</span> {attempt}
                                  </div>
                                ) : null}
                                {candidate_rel ? (
                                  <div>
                                    <span className="mono muted">candidate:</span> {candidate_rel}
                                  </div>
                                ) : null}
                                {manifest_rel ? (
                                  <div>
                                    <span className="mono muted">manifest:</span> {manifest_rel}
                                  </div>
                                ) : null}
                                {patch_rel ? (
                                  <div>
                                    <span className="mono muted">patch:</span> {patch_rel}
                                  </div>
                                ) : null}
                                {uat_rel ? (
                                  <div>
                                    <span className="mono muted">uat_current:</span> {uat_rel}
                                  </div>
                                ) : null}
                                {exec_mode === "uat" && uat_lock_owner ? (
                                  <div>
                                    <span className="mono muted">uat_lock:</span> {uat_lock_owner}
                                    {uat_lock_acquired ? " (owned)" : uat_pending ? " (pending)" : ""}
                                  </div>
                                ) : null}
                              </div>
                              {exec_mode === "inplace" ? (
                                <div
                                  className="mono"
                                  style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}
                                >
                                  Inplace mode: prod may already be mutated. Approving only finalizes the request status.
                                </div>
                              ) : exec_mode === "uat" && uat_pending && uat_lock_owner && !uat_lock_acquired ? (
                                <div
                                  className="mono"
                                  style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}
                                >
                                  UAT currently points to {short_id(uat_lock_owner, 16)}. Click “Restart UAT” to switch the shared UAT stack to this request.
                                </div>
                              ) : exec_mode === "uat" && uat_lock_acquired ? (
                                <>
                                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                                    UAT URLs: gateway `http://localhost:6081`, observer `http://localhost:6082`, code `http://localhost:6083`, flow
                                    `http://localhost:6084`
                                  </div>
                                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                                    UAT is intentionally short-lived: promoting or iterating will stop the shared UAT services.
                                  </div>
                                  {uat_probe_failed.length ? (
                                    <div
                                      className="mono"
                                      style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}
                                    >
                                      UAT may be unreachable: URL probe failed for {uat_probe_failed.slice(0, 4).join(", ")}
                                      {uat_probe_failed.length > 4 ? "…" : ""}. Click “Restart UAT” and check process logs.
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                              {exec_mode === "uat" && uat_deploy_status === "skipped" && uat_deploy_reason === "process_manager_disabled" ? (
                                <div
                                  className="mono"
                                  style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}
                                >
                                  UAT services were not started: process manager is disabled. Restart the gateway with `ABSTRACTGATEWAY_ENABLE_PROCESS_MANAGER=1`.
                                </div>
                              ) : null}
                              {uat_deploy_err ? (
                                <div
                                  className="mono"
                                  style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}
                                >
                                  UAT deploy failed: {uat_deploy_err}
                                </div>
                              ) : null}
                              {promo_blocked && promo_reason === "conflicts" ? (
                                <div
                                  className="mono"
                                  style={{
                                    color: "rgba(239, 68, 68, 0.9)",
                                    fontSize: "var(--font-size-sm)",
                                    marginTop: "8px",
                                  }}
                                >
                                  Promotion blocked: prod diverged from the candidate base ({promo_conflicts_total} conflict
                                  {promo_conflicts_total === 1 ? "" : "s"}). Use “Iterate” to re-run the request on top of
                                  current prod, or resolve conflicts manually.
                                  {promo_conflicts.length ? (
                                    <ul style={{ marginTop: "8px", paddingLeft: "18px" }}>
                                      {promo_conflicts.map((c, idx) => (
                                        <li key={`c:${idx}`}>
                                          {String((c as any)?.repo || "")}/{String((c as any)?.path || "")} (
                                          {String((c as any)?.reason || "conflict")})
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                              ) : null}
                              <div className="row" style={{ flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                                {patch_rel ? (
                                  <button className="btn btn_icon" onClick={() => copyText(patch_rel)} disabled={exec_qa_loading}>
                                    <Icon name="copy" size={16} />
                                    Copy patch path
                                  </button>
                                ) : null}
                                {manifest_rel ? (
                                  <button className="btn btn_icon" onClick={() => copyText(manifest_rel)} disabled={exec_qa_loading}>
                                    <Icon name="copy" size={16} />
                                    Copy manifest path
                                  </button>
                                ) : null}
                                {candidate_rel ? (
                                  <button className="btn btn_icon" onClick={() => copyText(candidate_rel)} disabled={exec_qa_loading}>
                                    <Icon name="copy" size={16} />
                                    Copy candidate path
                                  </button>
                                ) : null}
                              </div>
                              <div style={{ marginTop: "10px" }}>
                                <textarea
                                  value={exec_qa_feedback}
                                  onChange={(e) => set_exec_qa_feedback(e.target.value)}
                                  rows={3}
                                  placeholder="QA feedback (what to change / fix)…"
                                  style={{ width: "100%", resize: "vertical", minHeight: "72px" }}
                                  disabled={exec_qa_loading}
                                />
                              </div>
                              {exec_qa_error ? (
                                <div
                                  className="mono"
                                  style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}
                                >
                                  {exec_qa_error}
                                </div>
                              ) : null}
                              <div className="row" style={{ flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                                {exec_mode === "uat" ? (
                                  <button className="btn" onClick={() => void exec_deploy_uat_now()} disabled={exec_qa_loading}>
                                    Restart UAT
                                  </button>
                                ) : null}
                                <button className="btn primary" onClick={() => void exec_promote_to_prod()} disabled={exec_qa_loading}>
                                  {exec_mode === "inplace" ? "Approve (finalize)" : "Approve → promote to prod"}
                                </button>
                                <button className="btn" onClick={() => void exec_send_feedback()} disabled={exec_qa_loading}>
                                  Iterate (send feedback)
                                </button>
                              </div>
                              <div className="section_divider" />
                            </>
                          );
                        })()}
                        {(() => {
                          const st = String(exec_selected.status || "").trim().toLowerCase();
                          if (st !== "promoted") return null;
                          const promoted_at = String((exec_detail as any)?.promoted_at || "").trim();
                          const promotion = (exec_detail as any)?.promotion ?? null;
                          const promotion_report = (exec_detail as any)?.promotion_report ?? null;
                          const copied = typeof (promotion as any)?.copied === "number" ? Number((promotion as any)?.copied) : null;
                          const deleted = typeof (promotion as any)?.deleted === "number" ? Number((promotion as any)?.deleted) : null;
                          const manifest_sha = String((promotion as any)?.manifest_sha256 || "").trim();
                          const mode = String((promotion as any)?.mode || "").trim();
                          const redeploy = (promotion_report as any)?.redeploy ?? null;
                          const redeploy_status = String((redeploy as any)?.status || "").trim();
                          const redeploy_reason = String((redeploy as any)?.reason || "").trim();
                          const redeploy_error = String((promotion_report as any)?.redeploy_error || "").trim();

                          return (
                            <>
                              <div className="section_title">Promotion</div>
                              <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
                                {promoted_at ? (
                                  <div>
                                    <span className="mono muted">promoted_at:</span> {new Date(promoted_at).toLocaleString()}
                                  </div>
                                ) : null}
                                {mode ? (
                                  <div>
                                    <span className="mono muted">mode:</span> {mode}
                                  </div>
                                ) : null}
                                {manifest_sha ? (
                                  <div>
                                    <span className="mono muted">manifest_sha256:</span> {manifest_sha.slice(0, 16)}…
                                  </div>
                                ) : null}
                                {copied != null ? (
                                  <div>
                                    <span className="mono muted">files_copied:</span> {copied}
                                  </div>
                                ) : null}
                                {deleted != null ? (
                                  <div>
                                    <span className="mono muted">files_deleted:</span> {deleted}
                                  </div>
                                ) : null}
                                {redeploy_status ? (
                                  <div>
                                    <span className="mono muted">redeploy:</span> {redeploy_status}
                                    {redeploy_reason ? ` (${redeploy_reason})` : ""}
                                  </div>
                                ) : null}
                                {redeploy_error ? (
                                  <div style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                                    <span className="mono muted">redeploy_error:</span> {redeploy_error}
                                  </div>
                                ) : null}
                              </div>
                              <div className="section_divider" />
                            </>
                          );
                        })()}
                        <div className="section_title">Execution</div>
                        <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
                          <div>
                            <span className="mono muted">status:</span> {exec_selected.status || "unknown"}
                          </div>
                          {exec_selected.executor_type ? (
                            <div>
                              <span className="mono muted">executor:</span> {exec_selected.executor_type}
                            </div>
                          ) : null}
                          {exec_selected.target_agent ? (
                            <div>
                              <span className="mono muted">target_agent:</span> {exec_selected.target_agent}
                            </div>
                          ) : null}
                          {exec_selected.target_model ? (
                            <div>
                              <span className="mono muted">model:</span> {exec_selected.target_model}
                              {exec_selected.target_reasoning_effort ? ` (reasoning ${exec_selected.target_reasoning_effort})` : ""}
                            </div>
                          ) : null}
                          {exec_selected.exit_code != null ? (
                            <div>
                              <span className="mono muted">exit_code:</span> {String(exec_selected.exit_code)}
                            </div>
                          ) : null}
                          {exec_selected.run_dir_relpath ? (
                            <div>
                              <span className="mono muted">run_dir:</span> {exec_selected.run_dir_relpath}
                            </div>
                          ) : null}
                          {exec_time_stats.age_ms != null ? (
                            <div>
                              <span className="mono muted">age:</span> {_format_duration_ms(exec_time_stats.age_ms)}
                            </div>
                          ) : null}
                          {exec_time_stats.queue_delay_ms != null ? (
                            <div>
                              <span className="mono muted">queue_delay:</span> {_format_duration_ms(exec_time_stats.queue_delay_ms)}
                            </div>
                          ) : null}
                          {exec_time_stats.run_ms != null ? (
                            <div>
                              <span className="mono muted">run_time:</span> {_format_duration_ms(exec_time_stats.run_ms)}
                            </div>
                          ) : null}
                          {exec_time_stats.total_ms != null && exec_time_stats.is_done ? (
                            <div>
                              <span className="mono muted">total_time:</span> {_format_duration_ms(exec_time_stats.total_ms)}
                            </div>
                          ) : null}
                          {exec_event_stats ? (
                            <div>
                              <span className="mono muted">commands:</span> {exec_event_stats.command_count.toLocaleString()}
                              {exec_event_stats.command_fail_count ? ` (${exec_event_stats.command_fail_count.toLocaleString()} failed)` : ""}
                            </div>
                          ) : null}
                          <div>
                            <span className="mono muted">tokens:</span>{" "}
                            {exec_event_stats?.has_tokens ? (
                              <>
                                in {exec_event_stats.input_tokens.toLocaleString()}
                                {exec_event_stats.cached_input_tokens ? ` (cached ${exec_event_stats.cached_input_tokens.toLocaleString()})` : ""}
                                , out {exec_event_stats.output_tokens.toLocaleString()}, total {exec_event_stats.total_tokens.toLocaleString()}
                              </>
                            ) : (
                              <span className="mono muted">{exec_log_name === "events" ? "n/a" : 'select "events"'}</span>
                            )}
                          </div>
                        </div>

                        {(() => {
                          const promo = exec_detail && typeof (exec_detail as any).promotion === "object" ? ((exec_detail as any).promotion as any) : null;
                          if (!promo) return null;
                          const rep = exec_detail && typeof (exec_detail as any).promotion_report === "object" ? ((exec_detail as any).promotion_report as any) : null;
                          const mode = String(promo?.mode || "").trim();
                          const copied = promo?.copied != null ? String(promo.copied) : "";
                          const deleted = promo?.deleted != null ? String(promo.deleted) : "";
                          const sha = String(promo?.manifest_sha256 || "").trim();
                          const redeploy = rep && typeof rep.redeploy === "object" ? rep.redeploy : null;
                          const redeploy_status = redeploy ? String(redeploy.status || "").trim() : "";
                          return (
                            <>
                              <div className="section_divider" />
                              <div className="section_title">Promotion</div>
                              <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
                                {mode ? (
                                  <div>
                                    <span className="mono muted">mode:</span> {mode}
                                  </div>
                                ) : null}
                                {copied ? (
                                  <div>
                                    <span className="mono muted">copied:</span> {copied} files
                                  </div>
                                ) : null}
                                {deleted ? (
                                  <div>
                                    <span className="mono muted">deleted:</span> {deleted} files
                                  </div>
                                ) : null}
                                {sha ? (
                                  <div className="row" style={{ gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                    <div style={{ minWidth: "180px" }}>
                                      <span className="mono muted">manifest_sha256:</span> {sha.slice(0, 16)}…
                                    </div>
                                    <button className="btn btn_icon" onClick={() => copyText(sha)} disabled={exec_qa_loading}>
                                      <Icon name="copy" size={16} />
                                      Copy sha
                                    </button>
                                  </div>
                                ) : null}
                                {redeploy_status ? (
                                  <div>
                                    <span className="mono muted">redeploy:</span> {redeploy_status}
                                  </div>
                                ) : null}
                              </div>
                            </>
                          );
                        })()}

                        {(() => {
                          const items = Array.isArray(exec_detail?.backlog_queue?.items) ? (exec_detail.backlog_queue.items as any[]) : [];
                          const rels = items
                            .map((it) => String(it?.relpath || "").trim())
                            .filter(Boolean);
                          if (!rels.length) return null;
                          return (
                            <>
                              <div className="section_divider" />
                              <div className="section_title">Backlog queue</div>
                              <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
                                {rels.map((rel) => (
                                  <div key={`bq:${rel}`}>{rel}</div>
                                ))}
                              </div>
                            </>
                          );
                        })()}

                        {(() => {
                          const last = String((exec_detail as any)?.result?.last_message || exec_selected.last_message || "").trim();
                          if (!last) return null;
                          return (
                            <>
                              <div className="section_divider" />
                              <div className="section_title">Last message</div>
                              <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                                {last}
                              </pre>
                            </>
                          );
                        })()}

                        <div className="section_divider" />
                        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "8px" }}>
                          <div className="section_title" style={{ marginTop: 0 }}>
                            Live logs
                          </div>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <select value={exec_log_name} onChange={(e) => set_exec_log_name(e.target.value as any)}>
                              <option value="events">events</option>
                              <option value="stderr">stderr</option>
                              <option value="last_message">last message</option>
                            </select>
                            <button
                              className={`btn ${exec_log_auto ? "primary" : ""}`}
                              onClick={() => set_exec_log_auto((v) => !v)}
                              disabled={!exec_selected?.request_id}
                            >
                              {exec_log_auto ? "Auto on" : "Auto off"}
                            </button>
                            <button
                              className={`btn btn_icon ${exec_log_loading ? "is_loading" : ""}`}
                              onClick={() => void load_exec_log_tail()}
                              disabled={exec_log_loading || !exec_selected?.request_id}
                              aria-label="Refresh logs"
                              title="Refresh logs"
                            >
                              <Icon name="refresh" size={16} />
                              {is_compact_layout ? null : exec_log_loading ? "Loading…" : "Refresh"}
                            </button>
                          </div>
                        </div>
                        {exec_log_error ? (
                          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                            {exec_log_error}
                          </div>
                        ) : null}
                        {!exec_log_error && exec_log_truncated ? (
                          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                            (tail truncated)
                          </div>
                        ) : null}
                        {exec_log_name === "events" && parsed_exec_events ? (
                          <>
                            <div
                              className="exec_log_scroll"
                              ref={exec_log_scroll_el_ref}
                              onScroll={(e) => {
                                exec_log_follow_ref.current = _is_near_bottom(e.currentTarget, 12);
                              }}
                            >
                              {parsed_exec_events.events.length === 0 ? (
                                <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                                  (no events yet)
                                </div>
                              ) : (
                                parsed_exec_events.events.map((ev) => {
                                  const p = ev.payload as any;
                                  const item = p && typeof p.item === "object" ? p.item : null;
                                  const item_type = item ? String(item.type || "").trim() : "";
                                  const item_id = item ? String(item.id || "").trim() : "";
                                  const thread_id = p ? String(p.thread_id || "").trim() : "";

                                  const status_kind = classify_exec_event_status_kind(ev.type, p);
                                  const badge_class = status_kind === "error" ? "danger" : status_kind === "ok" ? "ok" : "info";
                                  const time_label = infer_exec_event_time_label(p);
                                  const main_text = infer_exec_event_main_text(ev.type, p);

                                  const msg = String(p?.message || p?.error?.message || "").trim();
                                  const text = item ? String(item.text || "").trim() : "";
                                  const cmd = item ? String(item.command || "").trim() : "";
                                  const status = item ? String(item.status || "").trim() : "";
                                  const exit_code = item && item.exit_code != null ? String(item.exit_code) : "";
                                  const out = item ? String(item.aggregated_output || "").trim() : "";
                                  const todo_items = item && Array.isArray(item.items) ? item.items : [];

                                  const short_cmd = cmd ? humanize_shell_command(cmd) || cmd : "";

                                  return (
                                    <details key={`${item_id || ev.idx}-${ev.type}`} className={`exec_event ${status_kind}`}>
                                      <summary className="exec_event_summary">
                                        {time_label ? <span className="exec_event_when mono muted">{time_label}</span> : null}
                                        {time_label ? <span className="exec_event_sep mono muted">|</span> : null}
                                        <span className="exec_event_main mono" title={main_text}>
                                          {main_text}
                                        </span>
                                        <span className={`chip mono ${badge_class}`}>{item_type || ev.type}</span>
                                        {exit_code ? <span className="mono muted exec_event_right">exit={exit_code}</span> : null}
                                      </summary>
                                      <div className="exec_event_body">
                                        <div className="row exec_event_meta">
                                          <span className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
                                            {ev.type}
                                          </span>
                                          {item_id ? (
                                            <span className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
                                              {item_id}
                                            </span>
                                          ) : null}
                                          {thread_id ? (
                                            <span className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
                                              thread {short_id(thread_id, 18)}
                                            </span>
                                          ) : null}
                                        </div>

                                        {msg ? (
                                          <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                                            {msg}
                                          </pre>
                                        ) : null}

                                        {todo_items && todo_items.length > 0 ? (
                                          <div className="mono" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                                            {todo_items.map((t: any, i: number) => (
                                              <div key={`${ev.idx}-todo-${i}`}>
                                                {(t && t.completed) === true ? "✓" : "○"} {String(t?.text || "").trim()}
                                              </div>
                                            ))}
                                          </div>
                                        ) : null}

                                        {cmd ? (
                                          <div style={{ marginTop: "8px" }}>
                                            <div className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
                                              command_execution {status ? `(${status})` : ""} {exit_code ? `exit=${exit_code}` : ""}
                                            </div>
                                            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                                              {short_cmd}
                                            </pre>
                                          </div>
                                        ) : null}

                                        {out ? (
                                          <details style={{ marginTop: "8px" }}>
                                            <summary className="mono muted" style={{ fontSize: "var(--font-size-sm)", cursor: "pointer" }}>
                                              output ({out.length.toLocaleString()} chars)
                                            </summary>
                                            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                                              {out}
                                            </pre>
                                          </details>
                                        ) : null}

                                        {text ? (
                                          <div style={{ marginTop: "8px" }}>
                                            <Markdown text={text} />
                                          </div>
                                        ) : null}
                                      </div>
                                    </details>
                                  );
                                })
                              )}
                            </div>
                            <details style={{ marginTop: "8px" }}>
                              <summary className="mono muted" style={{ fontSize: "var(--font-size-sm)", cursor: "pointer" }}>
                                Raw JSONL
                                {parsed_exec_events.bad ? ` (${parsed_exec_events.bad} unparsable line(s))` : ""}
                              </summary>
                              <pre
                                className="mono"
                                style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", marginTop: "8px", maxHeight: "240px", overflow: "auto" }}
                              >
                                {parsed_exec_events.raw || ""}
                              </pre>
                            </details>
                          </>
                        ) : (
                          <div
                            className="exec_log_scroll"
                            ref={exec_log_scroll_el_ref}
                            onScroll={(e) => {
                              exec_log_follow_ref.current = _is_near_bottom(e.currentTarget, 12);
                            }}
                          >
	                            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)" }}>
	                              {(() => {
	                                const t = String(exec_log_text || "").trim();
	                                if (t) return exec_log_text;
	                                if (exec_log_name === "last_message") {
	                                  const last = String((exec_detail as any)?.result?.last_message || exec_selected.last_message || "").trim();
	                                  if (last) return last;
	                                  const st = String(exec_selected.status || "").trim().toLowerCase();
	                                  if (st === "queued" || st === "running") {
	                                    return "(last message is written when the run finishes — use events for live output)";
	                                  }
	                                  return "(no last message yet)";
	                                }
	                                if (exec_log_name === "stderr") return "(no stderr yet)";
	                                return "(no logs yet)";
	                              })()}
	                            </pre>
	                          </div>
	                        )}

                        {exec_detail?.result?.logs ? (
                          <>
                            <div className="section_divider" />
                            <div className="section_title">Logs</div>
                            <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
                              {exec_detail.result.logs.events_relpath ? (
                                <div>
                                  <span className="mono muted">events:</span> {exec_detail.result.logs.events_relpath}
                                </div>
                              ) : null}
                              {exec_detail.result.logs.stderr_relpath ? (
                                <div>
                                  <span className="mono muted">stderr:</span> {exec_detail.result.logs.stderr_relpath}
                                </div>
                              ) : null}
                              {exec_detail.result.logs.last_message_relpath ? (
                                <div>
                                  <span className="mono muted">last_message:</span> {exec_detail.result.logs.last_message_relpath}
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                  Select an exec request.
                </div>
              )
            ) : selected ? (
              <div className="inbox_detail">
                <div className="inbox_detail_header">
                  <div className="inbox_detail_title">
                    <span className="mono" style={{ fontWeight: 700 }}>
                      {selected.title || selected.filename}
                    </span>
                    {selected.item_id ? <span className="chip mono muted">#{selected.item_id}</span> : null}
                    {selected.package ? <span className="chip mono muted">{selected.package}</span> : null}
                    {selected_task_type ? <span className={`chip ${task_type_chip(selected_task_type)} mono`}>{selected_task_type}</span> : null}
                    {!is_parsed(selected) ? <span className="chip mono muted">unparsed</span> : null}
                    <span className="chip mono muted backlog_path_chip">
                      <span className="mono">{selected.filename}</span>
                      <button
                        className="chip_icon_btn"
                        type="button"
                        onClick={() => copyText(`docs/backlog/${String(kind)}/${selected.filename}`)}
                        aria-label="Copy path"
                        title="Copy path"
                        disabled={action_loading}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                    </span>
                  </div>
                  <div className="inbox_detail_actions">
                    {is_compact_layout ? (
                      <button className="btn" onClick={() => set_compact_pane("list")} disabled={action_loading}>
                        Back
                      </button>
                    ) : null}
                    {kind === "completed" && completed_view === "tasks" ? (
                      <button
                        className="btn"
                        onClick={() => void open_exec_full_log_for_backlog(selected.filename)}
                        disabled={action_loading || !can_use_gateway}
                      >
                        Execution log
                      </button>
                    ) : null}
                    {can_execute ? (
                      <button
                        className="btn primary"
                        onClick={() => {
                          set_action_error("");
                          set_execute_mode("uat");
                          set_execute_target({ kind: "planned", filename: selected.filename, title: selected.title || selected.filename });
                          set_execute_confirm_open(true);
                        }}
                        disabled={action_loading}
                      >
                        Execute
                      </button>
                    ) : null}
                    {can_elevate ? (
                      <button className="btn primary" onClick={() => void move_selected("planned")} disabled={action_loading}>
                        Elevate → planned
                      </button>
                    ) : null}
                    {can_downgrade ? (
                      <button className="btn" onClick={() => void move_selected("proposed")} disabled={action_loading}>
                        Downgrade → proposed
                      </button>
                    ) : null}
                    {can_restore_from_deprecated ? (
                      <button className="btn" onClick={() => void move_selected("proposed")} disabled={action_loading}>
                        Restore → proposed
                      </button>
                    ) : null}
                    {can_restore_from_trash ? (
                      <button className="btn" onClick={() => void move_selected("proposed")} disabled={action_loading}>
                        Restore → proposed
                      </button>
                    ) : null}
                    {can_deprecate ? (
                      <button className="btn" onClick={() => void move_selected("deprecated")} disabled={action_loading}>
                        Deprecate
                      </button>
                    ) : null}
                    {can_trash ? (
                      <button
                        className="btn btn_icon"
                        onClick={() => void move_selected("trash")}
                        disabled={action_loading}
                        aria-label="Trash"
                        title="Trash"
                      >
                        <Icon name="trash" size={16} />
                        {is_compact_layout ? null : "Trash"}
                      </button>
                    ) : null}
                    {!editing ? (
                      <button
                        className="btn btn_icon"
                        onClick={() => {
                          set_editing(true);
                          set_edit_text(content);
                          set_edit_error("");
                          set_maint_messages([]);
                          set_maint_input("");
                          set_maint_error("");
                          set_edit_attachments_error("");
                          set_edit_recent_attachments([]);
                        }}
                        disabled={content_loading || edit_loading}
                        aria-label="Edit"
                        title="Edit"
                      >
                        <Icon name="edit" size={16} />
                        {is_compact_layout ? null : "Edit"}
                      </button>
                    ) : (
                      <>
                        <button className="btn" onClick={() => set_editing(false)} disabled={edit_loading}>
                          Cancel
                        </button>
                        <button className="btn primary" onClick={() => void save_edit()} disabled={edit_loading}>
                          {edit_loading ? "Saving…" : "Save"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="inbox_detail_meta mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                  {String(kind)}
                  {content_sha ? ` • sha ${short_id(content_sha, 10)}` : ""}
                </div>

                {action_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                    {action_error}
                  </div>
                ) : null}
                {edit_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                    {edit_error}
                  </div>
                ) : null}
                {content_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                    {content_error}
                  </div>
                ) : null}

                {content_loading ? (
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    Loading…
                  </div>
                ) : editing ? (
                  <>
                    <div className="field" style={{ marginTop: "8px" }}>
                      <textarea value={edit_text} onChange={(e) => set_edit_text(e.target.value)} rows={18} className="mono" />
                    </div>

                    <div className="backlog_edit_sticky">
                      <div className="section_title" style={{ marginTop: 0 }}>
                        Maintenance AI (chat)
                      </div>
                      <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                        Ask the maintainer to refine this backlog item. Provider/model can be set in Settings (blank = gateway default).
                      </div>
                      <div className="mono muted" style={{ fontSize: "var(--font-size-xs)", marginTop: "6px" }}>
                        Using:{" "}
                        <span className="mono">
                          {maint_provider || "(gateway default)"} / {maint_model || "(gateway default)"}
                        </span>
                      </div>

                      <div className="row" style={{ marginTop: "10px", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                        <input
                          ref={edit_attach_input_ref}
                          type="file"
                          multiple
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (!files.length) return;
                            void upload_edit_attachments(files);
                            e.currentTarget.value = "";
                          }}
                        />
                        <button
                          type="button"
                          className="btn"
                          onClick={() => edit_attach_input_ref.current?.click()}
                          disabled={!can_use_gateway || !selected || !is_backlog_file_kind(kind) || edit_attachments_uploading}
                        >
                          {edit_attachments_uploading ? "Uploading…" : "Attach files"}
                        </button>
                        {edit_recent_attachments.length ? (
                          <div className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
                            Last attached: {edit_recent_attachments[0]}
                          </div>
                        ) : null}
                      </div>
                      {edit_attachments_error ? (
                        <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                          {edit_attachments_error}
                        </div>
                      ) : null}

                      <div className="section_divider" style={{ marginTop: "10px" }} />
                      <ChatThread
                        messages={maint_messages}
                        className="backlog_chat_thread_small"
                        empty={
                          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                            No messages yet.
                          </div>
                        }
                      />

                      <div style={{ marginTop: "10px" }}>
                        <ChatComposer
                          value={maint_input}
                          onChange={set_maint_input}
                          onSubmit={() => void send_maintain()}
                          placeholder="Message to maintainer (e.g. improve acceptance criteria…)"
                          disabled={!can_use_gateway || maint_loading || !selected || !is_backlog_file_kind(kind)}
                          busy={maint_loading}
                          rows={3}
                          sendButtonClassName="btn primary"
                        />
                      </div>

                      {maint_error ? (
                        <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                          {maint_error}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : content ? (
                  <Markdown text={content} />
                ) : (
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    No content loaded.
                  </div>
                )}
              </div>
            ) : (
              <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                Select a backlog item.
              </div>
            )}
          </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={execute_confirm_open}
        title="Execute backlog item?"
        onClose={() => {
          set_execute_confirm_open(false);
          set_execute_target(null);
        }}
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                set_execute_confirm_open(false);
                set_execute_target(null);
              }}
              disabled={action_loading}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void confirm_execute()}
              disabled={action_loading || exec_cfg_loading || !execute_target || exec_cfg?.can_execute !== true}
            >
              {action_loading ? "Executing…" : "Execute"}
            </button>
          </>
        }
      >
        <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
          Target:{" "}
          <span className="mono" style={{ fontWeight: 700 }}>
            {execute_target ? execute_target.title : "(unknown)"}
          </span>
        </div>
        <div style={{ marginTop: "10px" }}>
          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginBottom: "6px" }}>
            Execution mode
          </div>
          <select
            className="input"
            value={execute_mode}
            onChange={(e) => set_execute_mode(e.target.value as any)}
            disabled={action_loading}
            style={{ width: "100%" }}
          >
            <option value="uat">UAT (staged, safe)</option>
            <option value="inplace">Inplace (dangerous, edits prod)</option>
          </select>
          {execute_mode === "inplace" ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
              Warning: inplace runs directly in the prod workspace. Use only when you understand the risk.
            </div>
          ) : (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
              The run will execute in a candidate workspace. When it reaches “awaiting QA”, click “Restart UAT” to deploy it to the shared UAT stack. After you
              promote or iterate, UAT services are stopped automatically.
            </div>
          )}
        </div>
        {exec_cfg_loading ? (
          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            Checking worker…
          </div>
        ) : null}
        {!exec_cfg_loading && exec_cfg?.can_execute !== true ? (
          <div style={{ marginTop: "10px" }}>
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)" }}>
              {exec_cfg?.runner_enabled !== true
                ? "Backlog exec runner is disabled on this gateway."
                : exec_cfg?.runner_alive === false
                  ? "Backlog exec runner is not running on this gateway."
                  : exec_cfg?.codex_available === false
                    ? `Codex not found on gateway: ${String(exec_cfg?.codex_bin || "codex")}`
                    : "Backlog exec is not available on this gateway."}
            </div>
            {exec_cfg?.runner_error ? (
              <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                {exec_cfg.runner_error}
              </div>
            ) : null}
            <details style={{ marginTop: "8px" }}>
              <summary className="mono muted" style={{ fontSize: "var(--font-size-sm)", cursor: "pointer" }}>
                Setup
              </summary>
              <div className="mono" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                <div>Docs: `docs/backlog/README.md`</div>
                <div style={{ marginTop: "6px" }}>Required env (example):</div>
                <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                  {[
                    "ABSTRACTGATEWAY_BACKLOG_EXEC_RUNNER=1",
                    "ABSTRACTGATEWAY_BACKLOG_EXECUTOR=codex_cli",
                    "ABSTRACTGATEWAY_BACKLOG_CODEX_BIN=codex",
                    "ABSTRACTGATEWAY_BACKLOG_CODEX_MODEL=gpt-5.2",
                  ].join("\n")}
                </pre>
                <button
                  className="btn"
                  style={{ marginTop: "8px" }}
                  onClick={() =>
                    copyText(
                      [
                        "ABSTRACTGATEWAY_BACKLOG_EXEC_RUNNER=1",
                        "ABSTRACTGATEWAY_BACKLOG_EXECUTOR=codex_cli",
                        "ABSTRACTGATEWAY_BACKLOG_CODEX_BIN=codex",
                        "ABSTRACTGATEWAY_BACKLOG_CODEX_MODEL=gpt-5.2",
                      ].join("\n")
                    )
                  }
                >
                  Copy setup
                </button>
              </div>
            </details>
          </div>
        ) : null}
        {exec_cfg_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            {exec_cfg_error}
          </div>
        ) : null}
        {action_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            {action_error}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={batch_execute_open}
        title="Execute batch (single context)?"
        onClose={() => {
          set_batch_execute_open(false);
          set_batch_execute_error("");
        }}
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                set_batch_execute_open(false);
                set_batch_execute_error("");
              }}
              disabled={batch_execute_loading}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void confirm_execute_batch()}
              disabled={batch_execute_loading || exec_cfg_loading || batch_selected_items.length < 2 || exec_cfg?.can_execute !== true}
            >
              {batch_execute_loading ? "Executing…" : "Execute batch"}
            </button>
          </>
        }
      >
        <div className="mono" style={{ fontSize: "var(--font-size-sm)" }}>
          Items:{" "}
          <span className="mono" style={{ fontWeight: 700 }}>
            {batch_selected_items.length}
          </span>
        </div>
        <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
          This queues a single exec request whose prompt includes all selected backlog items (in order), so the agent keeps a shared growing context.
        </div>
        <div style={{ marginTop: "10px" }}>
          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginBottom: "6px" }}>
            Execution mode
          </div>
          <select
            className="input"
            value={batch_execute_mode}
            onChange={(e) => set_batch_execute_mode(e.target.value as any)}
            disabled={batch_execute_loading}
            style={{ width: "100%" }}
          >
            <option value="uat">UAT (staged, safe)</option>
            <option value="inplace">Inplace (dangerous, edits prod)</option>
          </select>
          {batch_execute_mode === "inplace" ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
              Warning: inplace runs directly in the prod workspace (for the entire batch). Use only when you understand the risk.
            </div>
          ) : (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
              The batch will execute in a candidate workspace. When it reaches “awaiting QA”, click “Restart UAT” to deploy it to the shared UAT stack. After you
              promote or iterate, UAT services are stopped automatically.
            </div>
          )}
        </div>
        {batch_selected_items.length ? (
          <div className="mono" style={{ fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            {batch_selected_items.map((it) => (
              <div key={`batchitem:${it.filename}`}>- docs/backlog/planned/{it.filename}</div>
            ))}
          </div>
        ) : null}

        {exec_cfg_loading ? (
          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            Checking worker…
          </div>
        ) : null}
        {!exec_cfg_loading && exec_cfg?.can_execute !== true ? (
          <div style={{ marginTop: "10px" }}>
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)" }}>
              {exec_cfg?.runner_enabled !== true
                ? "Backlog exec runner is disabled on this gateway."
                : exec_cfg?.runner_alive === false
                  ? "Backlog exec runner is not running on this gateway."
                  : exec_cfg?.codex_available === false
                    ? `Codex not found on gateway: ${String(exec_cfg?.codex_bin || "codex")}`
                    : "Backlog exec is not available on this gateway."}
            </div>
            {exec_cfg?.runner_error ? (
              <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                {exec_cfg.runner_error}
              </div>
            ) : null}
          </div>
        ) : null}
        {exec_cfg_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            {exec_cfg_error}
          </div>
        ) : null}
        {batch_execute_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            {batch_execute_error}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={merge_open}
        title="Merge planned items into master backlog?"
        onClose={() => {
          set_merge_open(false);
          set_merge_error("");
        }}
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                set_merge_open(false);
                set_merge_error("");
              }}
              disabled={merge_loading}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void submit_merge_master()}
              disabled={merge_loading || batch_selected_items.length < 2 || !merge_title.trim() || !merge_package.trim()}
            >
              {merge_loading ? "Merging…" : "Create master"}
            </button>
          </>
        }
      >
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <div className="col" style={{ minWidth: 220 }}>
            <div className="field">
              <label>Package</label>
              <input value={merge_package} onChange={(e) => set_merge_package(e.target.value)} placeholder="framework" />
            </div>
          </div>
          <div className="col" style={{ minWidth: 220 }}>
            <div className="field">
              <label>Type</label>
              <select value={merge_task_type} onChange={(e) => set_merge_task_type(e.target.value as any)}>
                <option value="task">task</option>
                <option value="feature">feature</option>
                <option value="bug">bug</option>
              </select>
            </div>
          </div>
        </div>
        <div className="field" style={{ marginTop: "10px" }}>
          <label>Title</label>
          <input value={merge_title} onChange={(e) => set_merge_title(e.target.value)} placeholder="Master backlog" />
        </div>
        <div className="field" style={{ marginTop: "10px" }}>
          <label>Summary (optional)</label>
          <textarea value={merge_summary} onChange={(e) => set_merge_summary(e.target.value)} rows={3} />
        </div>

        {batch_selected_items.length ? (
          <div style={{ marginTop: "10px" }}>
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
              Referenced backlog items:
            </div>
            <div className="mono" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
              {batch_selected_items.map((it) => (
                <div key={`mergeitem:${it.filename}`}>- docs/backlog/planned/{it.filename}</div>
              ))}
            </div>
          </div>
        ) : null}

        {merge_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
            {merge_error}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={exec_full_open}
        title={exec_full_backlog_filename ? `Execution log — ${exec_full_backlog_filename}` : "Execution log"}
        variant="fullscreen"
        onClose={() => {
          set_exec_full_open(false);
          set_exec_full_backlog_filename("");
          set_exec_full_requests([]);
          set_exec_full_request_id("");
          set_exec_full_text("");
          set_exec_full_error("");
          set_exec_full_truncated(false);
          set_exec_full_search("");
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="row" style={{ alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }}>
            <div className="col" style={{ minWidth: 420, flex: "0 0 auto" }}>
              <div className="field">
                <label>Execution</label>
                <select
                  value={exec_full_request_id}
                  onChange={(e) => {
                    const rid = String(e.target.value || "").trim();
                    set_exec_full_request_id(rid);
                    set_exec_full_text("");
                    set_exec_full_error("");
                    set_exec_full_truncated(false);
                    if (rid) void load_exec_full_log({ request_id: rid, name: exec_full_log_name });
                    setTimeout(() => exec_full_textarea_ref.current?.focus(), 0);
                  }}
                  disabled={exec_full_loading || !exec_full_requests.length}
                >
                  {exec_full_requests.length ? null : <option value="">(none)</option>}
                  {exec_full_requests.map((r) => {
                    const ts = String(r.finished_at || r.started_at || r.created_at || "").trim();
                    const label = ts ? `${ts} • ${short_id(r.request_id, 16)} • ${String(r.status || "").trim()}` : `${short_id(r.request_id, 16)} • ${String(r.status || "").trim()}`;
                    return (
                      <option key={`execfull:${r.request_id}`} value={r.request_id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="col" style={{ minWidth: 180, flex: "0 0 auto" }}>
              <div className="field">
                <label>Log</label>
                <select
                  value={exec_full_log_name}
                  onChange={(e) => {
                    const name = e.target.value as any;
                    set_exec_full_log_name(name);
                    set_exec_full_text("");
                    set_exec_full_error("");
                    set_exec_full_truncated(false);
                    if (exec_full_request_id) void load_exec_full_log({ request_id: exec_full_request_id, name });
                    setTimeout(() => exec_full_textarea_ref.current?.focus(), 0);
                  }}
                  disabled={exec_full_loading || !exec_full_request_id}
                >
                  <option value="events">events</option>
                  <option value="stderr">stderr</option>
                  <option value="last_message">last_message</option>
                </select>
              </div>
            </div>

            <div className="col" style={{ minWidth: 240, flex: "1 1 240px" }}>
              <div className="field">
                <label>Search</label>
                <input
                  value={exec_full_search}
                  onChange={(e) => set_exec_full_search(e.target.value)}
                  placeholder="Find…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      exec_full_find_next(e.shiftKey ? -1 : 1);
                    }
                  }}
                />
              </div>
            </div>

            <div className="col" style={{ flex: "0 0 auto", display: "flex", gap: "6px" }}>
              <button className="btn" onClick={() => exec_full_find_next(-1)} disabled={!exec_full_search.trim() || !exec_full_text.trim()}>
                Prev
              </button>
              <button className="btn" onClick={() => exec_full_find_next(1)} disabled={!exec_full_search.trim() || !exec_full_text.trim()}>
                Next
              </button>
              <button className="btn" onClick={() => void load_exec_full_log()} disabled={exec_full_loading || !exec_full_request_id}>
                {exec_full_loading ? "Loading…" : "Refresh"}
              </button>
              <button className="btn" onClick={() => copyText(exec_full_text)} disabled={!exec_full_text.trim()}>
                Copy
              </button>
            </div>
          </div>

          {exec_full_error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
              {exec_full_error}
            </div>
          ) : null}
          {!exec_full_error && exec_full_truncated ? (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
              Showing only the tail of this log.
            </div>
          ) : null}

          <div style={{ flex: "1 1 auto", marginTop: "10px" }}>
            <textarea
              ref={exec_full_textarea_ref}
              value={exec_full_text || "(no log loaded)"}
              readOnly
              className="mono"
              style={{
                width: "100%",
                height: "100%",
                resize: "none",
                borderRadius: "12px",
                border: "1px solid var(--border)",
                background: "rgba(0, 0, 0, 0.18)",
                color: "var(--text)",
                padding: "12px",
                fontSize: "var(--font-size-sm)",
                lineHeight: "16px",
              }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={new_task_open}
        title="New backlog task"
        onClose={() => {
          set_new_task_open(false);
          reset_new_task();
        }}
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                set_new_task_open(false);
                reset_new_task();
              }}
              disabled={new_loading || assist_loading}
            >
              Cancel
            </button>
            <button className="btn primary" onClick={() => void submit_new_task()} disabled={new_loading || !new_title.trim() || !new_package.trim()}>
              {new_loading ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <div className="row">
          <div className="col" style={{ minWidth: 220 }}>
            <div className="field">
              <label>Kind</label>
              <select value={new_kind} onChange={(e) => set_new_kind(e.target.value as any)}>
                <option value="proposed">proposed</option>
                <option value="planned">planned</option>
                <option value="recurrent">recurrent</option>
              </select>
            </div>
          </div>
          <div className="col" style={{ minWidth: 220 }}>
            <div className="field">
              <label>Type</label>
              <select value={new_task_type} onChange={(e) => set_new_task_type(e.target.value as any)}>
                <option value="feature">feature</option>
                <option value="bug">bug</option>
                <option value="task">task</option>
              </select>
            </div>
          </div>
          <div className="col" style={{ minWidth: 220 }}>
            <div className="field">
              <label>Package</label>
              <input value={new_package} onChange={(e) => set_new_package(e.target.value)} placeholder="framework" />
            </div>
          </div>
        </div>

        <div className="field">
          <label>Title</label>
          <input value={new_title} onChange={(e) => set_new_title(e.target.value)} placeholder="Short descriptive title" />
        </div>
        <div className="field">
          <label>Summary (optional)</label>
          <textarea value={new_summary} onChange={(e) => set_new_summary(e.target.value)} rows={3} placeholder="One paragraph summary" />
        </div>

        <div className="section_divider" />
        <div className="section_title">Guided fields (optional)</div>
        <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
          Use this to generate a structured draft without editing markdown directly. One item per line for list fields.
        </div>
        <div style={{ marginTop: "8px" }}>
          <details>
            <summary className="mono" style={{ cursor: "pointer" }}>
              Show guided fields
            </summary>
            <div className="field" style={{ marginTop: "10px" }}>
              <label>Diagram (ASCII)</label>
              <textarea value={guided_diagram} onChange={(e) => set_guided_diagram(e.target.value)} rows={4} className="mono" placeholder="(optional) ascii diagram" />
            </div>
            <div className="field">
              <label>Context</label>
              <textarea value={guided_context} onChange={(e) => set_guided_context(e.target.value)} rows={4} placeholder="Why is this needed? Link to evidence (reports, discussions, etc.)." />
            </div>
            <div className="row">
              <div className="col" style={{ minWidth: 260 }}>
                <div className="field">
                  <label>Scope: Included (1 per line)</label>
                  <textarea value={guided_included} onChange={(e) => set_guided_included(e.target.value)} rows={4} className="mono" placeholder="..." />
                </div>
              </div>
              <div className="col" style={{ minWidth: 260 }}>
                <div className="field">
                  <label>Scope: Excluded (1 per line)</label>
                  <textarea value={guided_excluded} onChange={(e) => set_guided_excluded(e.target.value)} rows={4} className="mono" placeholder="..." />
                </div>
              </div>
            </div>
            <div className="field">
              <label>Implementation Plan (1 per line)</label>
              <textarea value={guided_plan} onChange={(e) => set_guided_plan(e.target.value)} rows={4} className="mono" placeholder="..." />
            </div>
            <div className="field">
              <label>Dependencies (1 per line)</label>
              <textarea value={guided_dependencies} onChange={(e) => set_guided_dependencies(e.target.value)} rows={3} className="mono" placeholder="Related backlog items / ADRs / external libs…" />
            </div>
            <div className="field">
              <label>Acceptance Criteria (1 per line)</label>
              <textarea value={guided_acceptance} onChange={(e) => set_guided_acceptance(e.target.value)} rows={4} className="mono" placeholder="..." />
            </div>
            <div className="row">
              <div className="col" style={{ minWidth: 260 }}>
                <div className="field">
                  <label>Testing Level A (1 per line)</label>
                  <textarea value={guided_tests_a} onChange={(e) => set_guided_tests_a(e.target.value)} rows={3} className="mono" placeholder="cd pkg && pytest -q ..." />
                </div>
              </div>
              <div className="col" style={{ minWidth: 260 }}>
                <div className="field">
                  <label>Testing Level B (1 per line)</label>
                  <textarea value={guided_tests_b} onChange={(e) => set_guided_tests_b(e.target.value)} rows={3} className="mono" placeholder="run local gateway + manual verification..." />
                </div>
              </div>
            </div>
            <div className="field">
              <label>Testing Level C (1 per line)</label>
              <textarea value={guided_tests_c} onChange={(e) => set_guided_tests_c(e.target.value)} rows={2} className="mono" placeholder="(optional / opt-in)" />
            </div>
            <div className="row" style={{ marginTop: "10px", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => regenerate_draft_from_guided()} disabled={new_loading || assist_loading}>
                Generate draft from guided fields
              </button>
            </div>
          </details>
        </div>

        <div className="section_divider" />
        <div className="section_title">Attachments (optional)</div>
        <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
          Upload screenshots/diagrams to `docs/backlog/assets/&lt;id&gt;/` and link them under `## Related` after the task is created.
        </div>
        <div className="field" style={{ marginTop: "8px" }}>
          <input
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (!files.length) return;
              set_new_attachments((prev) => [...prev, ...files]);
              e.currentTarget.value = "";
            }}
          />
        </div>
        {new_attachments.length ? (
          <div className="mono" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
            {new_attachments.map((f, idx) => (
              <div key={`${f.name}_${f.size}_${idx}`} className="row" style={{ alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                <span className="mono muted" style={{ paddingRight: "10px" }}>
                  {f.name} ({Math.round(f.size / 1024)} KB)
                </span>
                <button className="btn" onClick={() => set_new_attachments((prev) => prev.filter((_, i) => i !== idx))} disabled={new_loading || attachments_uploading}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {attachments_uploading ? (
          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
            Uploading attachments…
          </div>
        ) : null}
        {attachments_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
            {attachments_error}
          </div>
        ) : null}

        <div className="section_divider" />
        <div className="section_title">Draft (Markdown)</div>
        <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
          Prefilled from `docs/backlog/template.md` (editable). AI assist can also refine the draft.
        </div>
        {template_loading ? (
          <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
            Loading template…
          </div>
        ) : null}
        {template_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
            {template_error}
          </div>
        ) : null}
        <div className="row" style={{ marginTop: "10px", justifyContent: "flex-end", gap: "8px" }}>
          <button
            className="btn"
            onClick={() => {
              if (new_draft.trim()) {
                const ok = globalThis.confirm("Reset the draft markdown to the backlog template?");
                if (!ok) return;
              }
              void apply_template_to_draft({ force: true });
            }}
            disabled={new_loading || assist_loading || template_loading || !can_use_gateway}
          >
            Reset from template
          </button>
        </div>
        <div className="field">
          <textarea value={new_draft} onChange={(e) => set_new_draft(e.target.value)} rows={10} className="mono" placeholder="(optional) full markdown draft" />
        </div>

        <div className="section_divider" />
        <div className="section_title">AI Assist (chat)</div>
        <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
          Use this to iteratively refine a backlog draft; assistant replies can also update the draft markdown.
        </div>

        <ChatThread
          messages={assist_messages}
          className="backlog_chat_thread_small"
          empty={
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
              No messages yet.
            </div>
          }
        />

        <div style={{ marginTop: "10px" }}>
          <ChatComposer
            value={assist_input}
            onChange={set_assist_input}
            onSubmit={() => void send_assist()}
            placeholder="Message to AI (e.g. refine acceptance criteria…)"
            disabled={!can_use_gateway || !new_title.trim()}
            busy={assist_loading}
            rows={3}
            sendButtonClassName="btn primary"
          />
        </div>

        {new_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
            {new_error}
          </div>
        ) : null}
      </Modal>

      <button
        className={`advisor_toggle ${advisor_open ? "open" : ""}`}
        onClick={() => {
          set_advisor_open((v) => {
            const next = !v;
            if (!next) {
              stop_advisor_voice();
            }
            return next;
          });
        }}
        title="Open backlog advisor (read-only)"
        aria-label="Open backlog advisor"
      >
        <span className="advisor_toggle_label">Advisor</span>
      </button>

      {advisor_open ? (
        <div
          className="drawer_backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              stop_advisor_voice();
              set_advisor_open(false);
            }
          }}
        >
          <div className="drawer_panel">
            <div className="drawer_header">
              <div className="col" style={{ gap: 2 }}>
                <div className="drawer_title">Backlog advisor</div>
                <div className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
                  Read-only. Agent: {advisor_agent || "basic-agent"} • Using: {maint_provider || "(gateway default)"} / {maint_model || "(gateway default)"}
                </div>
              </div>
              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button
                  className={`btn btn_icon ${advisor_show_tools ? "primary" : ""}`}
                  onClick={() => set_advisor_show_tools((v) => !v)}
                  disabled={advisor_loading}
                  title={advisor_show_tools ? "Hide tool execution" : "Show tool execution"}
                  aria-label={advisor_show_tools ? "Hide tool execution" : "Show tool execution"}
                >
                  <Icon name="terminal" size={16} />
                  {is_compact_layout ? null : advisor_show_tools ? "Tools on" : "Tools"}
                </button>
                <button className="btn" onClick={() => set_advisor_messages([])} disabled={advisor_loading || !advisor_messages.length}>
                  Clear
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    stop_advisor_voice();
                    set_advisor_open(false);
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="drawer_body">
              <ChatThread
                messages={advisor_messages}
                className="drawer_chat_thread"
                messageProps={
                  advisor_voice.tts_supported && can_use_gateway && Boolean(advisor_voice_run_id.trim())
                    ? {
                        onSpeakToggle: toggle_advisor_tts,
                        getSpeakState: advisor_tts_state_for,
                        jsonCollapseAfterDepth: 4,
                      }
                    : { jsonCollapseAfterDepth: 4 }
                }
                empty={
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    Ask about the backlog, e.g. “What are the top 5 planned items to focus on next and why?”
                  </div>
                }
              />

              <div className="drawer_footer">
                <input
                  ref={advisor_attach_input_ref}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.currentTarget.files || []);
                    e.currentTarget.value = "";
                    if (!files.length) return;
                    void attach_advisor_files(files);
                  }}
                />
                <ChatComposer
                  ref={advisor_input_ref}
                  value={advisor_input}
                  onChange={set_advisor_input}
                  onSubmit={() => void send_advisor()}
                  placeholder="Message to backlog advisor…"
                  disabled={!can_use_gateway}
                  busy={advisor_loading || advisor_voice.voice_ptt_busy}
                  rows={3}
                  sendButtonClassName="btn primary"
                  busyLabel={advisor_voice.voice_ptt_busy ? "Transcribing…" : "Thinking…"}
                  actions={
                    <>
                      <button
                        className={`btn btn_icon voice_btn${advisor_voice.voice_ptt_recording ? " danger" : ""}`}
                        type="button"
                        disabled={
                          !can_use_gateway ||
                          !advisor_voice_run_id.trim() ||
                          advisor_loading ||
                          advisor_voice.voice_ptt_busy ||
                          !advisor_voice.voice_ptt_supported
                        }
                        title={
                          !advisor_voice.voice_ptt_supported
                            ? "Voice recording is not supported in this browser"
                          : advisor_voice.voice_ptt_busy
                              ? "Transcribing…"
                              : advisor_voice.voice_ptt_recording
                                ? "Recording… release to transcribe"
                                : "Hold to talk (record + transcribe)"
                        }
                        aria-label="Voice input"
                        onPointerDown={(e) => {
                          if (!can_use_gateway || !advisor_voice_run_id.trim() || advisor_loading || advisor_voice.voice_ptt_busy || !advisor_voice.voice_ptt_supported)
                            return;
                          e.preventDefault();
                          try {
                            (e.currentTarget as any)?.setPointerCapture?.(e.pointerId);
                          } catch {
                            // ignore
                          }
                          void advisor_voice.start_voice_ptt_recording();
                        }}
                        onPointerUp={(e) => {
                          e.preventDefault();
                          advisor_voice.stop_voice_ptt_recording();
                        }}
                        onPointerCancel={(e) => {
                          e.preventDefault();
                          advisor_voice.stop_voice_ptt_recording();
                        }}
                      >
                        <UiIcon name={advisor_voice.voice_ptt_recording ? "x" : "mic"} size={16} />
                        {is_compact_layout ? null : advisor_voice.voice_ptt_busy ? "Transcribing…" : advisor_voice.voice_ptt_recording ? "Recording…" : "Voice"}
                      </button>
                      <button
                        className="btn btn_icon"
                        type="button"
                        onClick={() => advisor_attach_input_ref.current?.click()}
                        disabled={advisor_loading}
                        title="Attach a local file to your message"
                        aria-label="Attach file"
                      >
                        <UiIcon name="paperclip" size={16} />
                        {is_compact_layout ? null : "Attach"}
                      </button>
                    </>
                  }
                />
                {advisor_recent_attachments.length ? (
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "6px" }}>
                    Last attached: {advisor_recent_attachments[0]}
                  </div>
                ) : null}
                {advisor_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                    {advisor_error}
                  </div>
                ) : null}
                {advisor_voice_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                    {advisor_voice_error}
                  </div>
                ) : null}
                {!can_use_gateway ? (
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "8px" }}>
                    Connect the gateway in Settings to use the advisor.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
