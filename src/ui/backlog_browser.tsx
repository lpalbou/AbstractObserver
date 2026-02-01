import React, { useEffect, useMemo, useRef, useState } from "react";

import { ChatComposer, ChatMessageContent, Markdown, copyText, type PanelChatMessage } from "@abstractuic/panel-chat";

import type {
  BacklogExecConfigResponse,
  BacklogExecRequestListResponse,
  BacklogExecRequestSummary,
  BacklogItemSummary,
  BacklogListResponse,
  GatewayClient,
} from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import { Modal } from "./modal";

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

function first_line_snippet(text: string, max_len: number): string {
  const t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";
  const first = t.split("\n", 1)[0] || "";
  const s = first.trim();
  if (s.length <= max_len) return s;
  return `${s.slice(0, Math.max(0, max_len - 1))}…`;
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
};

export function BacklogBrowserPage(props: BacklogBrowserPageProps): React.ReactElement {
  const gateway = props.gateway;
  const can_use_gateway = props.gateway_connected;
  const maint_provider = String(props.maintenance_ai_provider || "").trim();
  const maint_model = String(props.maintenance_ai_model || "").trim();

  const [kind, set_kind] = useState<BacklogTab>("planned");
  const [items, set_items] = useState<BacklogItemSummary[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState("");

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

  const [maint_messages, set_maint_messages] = useState<PanelChatMessage[]>([]);
  const [maint_input, set_maint_input] = useState("");
  const [maint_loading, set_maint_loading] = useState(false);
  const [maint_error, set_maint_error] = useState("");

  const [advisor_open, set_advisor_open] = useState(false);
  const [advisor_messages, set_advisor_messages] = useState<PanelChatMessage[]>([]);
  const [advisor_input, set_advisor_input] = useState("");
  const [advisor_loading, set_advisor_loading] = useState(false);
  const [advisor_error, set_advisor_error] = useState("");
  const advisor_input_ref = useRef<HTMLTextAreaElement | null>(null);

  const edit_attach_input_ref = useRef<HTMLInputElement | null>(null);
  const [edit_attachments_uploading, set_edit_attachments_uploading] = useState(false);
  const [edit_attachments_error, set_edit_attachments_error] = useState("");
  const [edit_recent_attachments, set_edit_recent_attachments] = useState<string[]>([]);

  const [execute_confirm_open, set_execute_confirm_open] = useState(false);
  const [execute_target, set_execute_target] = useState<{ kind: BacklogFileKind; filename: string; title: string } | null>(null);

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

  const [exec_log_name, set_exec_log_name] = useState<"events" | "stderr" | "last_message">("events");
  const [exec_log_text, set_exec_log_text] = useState("");
  const [exec_log_loading, set_exec_log_loading] = useState(false);
  const [exec_log_error, set_exec_log_error] = useState("");
  const [exec_log_truncated, set_exec_log_truncated] = useState(false);
  const [exec_log_auto, set_exec_log_auto] = useState(true);
  const exec_log_scroll_el_ref = useRef<HTMLDivElement | null>(null);
  const exec_log_follow_ref = useRef(true);

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

  const [assist_messages, set_assist_messages] = useState<PanelChatMessage[]>([]);
  const [assist_input, set_assist_input] = useState("");
  const [assist_loading, set_assist_loading] = useState(false);

  const is_exec_view = kind === "processing" || kind === "failed" || (kind === "completed" && completed_view === "runs");

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
    if (tab === "processing") return "queued,running";
    if (tab === "failed") return "failed";
    if (tab === "completed" && completed_view === "runs") return "completed";
    return "";
  }

  function exec_summary_from_payload(payload: any, request_id: string): BacklogExecRequestSummary {
    const p = payload && typeof payload === "object" ? payload : {};
    const backlog = p.backlog && typeof p.backlog === "object" ? p.backlog : {};
    const result = p.result && typeof p.result === "object" ? p.result : {};
    const executor = p.executor && typeof p.executor === "object" ? p.executor : {};
    const last_msg = String(result.last_message || "").trim();
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
    const next = Array.isArray(res?.items) ? res.items : [];
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
          } else if (status2 === "completed") {
            set_completed_view("runs");
            set_kind("completed");
          }
          if (status2 === "failed" || status2 === "completed") {
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

  const filtered_exec_requests = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return exec_requests;
    return exec_requests.filter((r) => {
      const hay = `${r.request_id || ""} ${r.status || ""} ${r.backlog_filename || ""} ${r.backlog_relpath || ""} ${r.error || ""} ${r.last_message || ""}`.toLowerCase();
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
    set_exec_detail(null);
    set_exec_detail_error("");
    set_exec_detail_loading(true);
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
      const out = await gateway.backlog_execute({ kind: execute_target.kind, filename: execute_target.filename });
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
    const user_msg: PanelChatMessage = { id: random_id(), role: "user", content: msg, ts: new Date().toISOString() };
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
    const user_msg: PanelChatMessage = { id: random_id(), role: "user", content: msg, ts: new Date().toISOString() };
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
    set_advisor_error("");
    const msg = advisor_input.trim();
    if (!msg) return;
    const user_msg: PanelChatMessage = { id: random_id(), role: "user", content: msg, ts: new Date().toISOString() };
    const next_msgs = [...advisor_messages, user_msg];
    set_advisor_messages(next_msgs);
    set_advisor_input("");
    set_advisor_loading(true);
    try {
      const out = await gateway.backlog_advisor({
        messages: next_msgs.map((m) => ({ role: m.role, content: m.content })),
        provider: maint_provider || null,
        model: maint_model || null,
        focus_kind: kind,
        focus_type: type_filter,
      });
      const reply = String(out?.reply || "").trim();
      if (reply) set_advisor_messages((ms) => [...ms, { id: random_id(), role: "assistant", content: reply, ts: new Date().toISOString() }]);
    } catch (e: any) {
      set_advisor_error(String(e?.message || e || "Backlog advisor failed"));
    } finally {
      set_advisor_loading(false);
    }
  }

  const selected_task_type = selected && is_parsed(selected) ? normalize_task_type(selected.task_type) : null;

  const can_execute = Boolean(selected && kind === "planned");
  const can_elevate = Boolean(selected && kind === "proposed");
  const can_downgrade = Boolean(selected && kind === "planned");
  const can_deprecate = Boolean(selected && is_backlog_file_kind(kind) && kind !== "deprecated" && kind !== "trash");
  const can_trash = Boolean(selected && is_backlog_file_kind(kind) && kind !== "trash");
  const can_restore_from_trash = Boolean(selected && kind === "trash");
  const can_restore_from_deprecated = Boolean(selected && kind === "deprecated");

  return (
    <div className="page">
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
              >
                exec worker {exec_cfg.runner_alive ? "on" : "off"}
              </span>
            ) : null}
          </div>

          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div className="tab_bar" style={{ paddingBottom: 0, borderBottom: "none" }}>
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
            <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
              {kind === "completed" ? (
                <div className="row" style={{ gap: "6px" }}>
                  <button className={`btn ${completed_view === "tasks" ? "primary" : ""}`} onClick={() => set_completed_view("tasks")}>
                    Tasks
                  </button>
                  <button className={`btn ${completed_view === "runs" ? "primary" : ""}`} onClick={() => set_completed_view("runs")}>
                    Runs
                  </button>
                </div>
              ) : null}
              <button className="btn" onClick={() => set_new_task_open(true)} disabled={!can_use_gateway}>
                New task
              </button>
              <button className="btn" onClick={() => void refresh()} disabled={!can_use_gateway || (is_exec_view ? exec_loading : loading)}>
                {is_exec_view ? (exec_loading ? "Refreshing…" : "Refresh") : loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="row" style={{ marginTop: "10px", alignItems: "center", justifyContent: "space-between" }}>
            <div className="field" style={{ margin: 0, flex: "1 1 auto", minWidth: 240 }}>
              <input
                value={query}
                onChange={(e) => set_query(e.target.value)}
                placeholder={is_exec_view ? "Search exec requests (id/status/backlog/error…)" : "Search backlog (id/title/package/filename…)"}
              />
            </div>
            {!is_exec_view ? (
              <div className="field" style={{ margin: 0, flex: "0 0 auto", minWidth: 150, paddingLeft: "10px" }}>
                <select value={type_filter} onChange={(e) => set_type_filter(e.target.value as any)} title="Filter by type">
                  <option value="all">all types</option>
                  <option value="bug">bug</option>
                  <option value="feature">feature</option>
                  <option value="task">task</option>
                </select>
              </div>
            ) : null}
            <div className="mono muted" style={{ fontSize: "12px", paddingLeft: "10px" }}>
              {is_exec_view ? `${filtered_exec_requests.length}/${exec_requests.length}` : `${filtered_items.length}/${items.length}`}
            </div>
          </div>

          {!is_exec_view && error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", marginTop: "8px", fontSize: "12px" }}>
              {error}
            </div>
          ) : null}
          {is_exec_view && exec_error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", marginTop: "8px", fontSize: "12px" }}>
              {exec_error}
            </div>
          ) : null}
          {!is_exec_view && !error && !loading && !items.length ? (
            <div className="mono muted" style={{ marginTop: "8px", fontSize: "12px" }}>
              No items (or backlog browsing not configured on this gateway).
            </div>
          ) : null}
          {is_exec_view && !exec_error && !exec_loading && !exec_requests.length ? (
            <div className="mono muted" style={{ marginTop: "8px", fontSize: "12px" }}>
              No exec requests found.
            </div>
          ) : null}
        </div>

        <div className="inbox_layout">
          <div className="card inbox_sidebar">
            <div className="inbox_list">
              {is_exec_view ? (
                !filtered_exec_requests.length ? (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    No requests.
                  </div>
                ) : (
                  filtered_exec_requests.map((r) => {
                    const active = exec_selected?.request_id === r.request_id;
                    const st = String(r.status || "").trim().toLowerCase();
                    const status_chip =
                      st === "completed"
                        ? "ok"
                        : st === "failed"
                          ? "danger"
                          : st === "running"
                            ? "info"
                            : st === "queued"
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
                        {r.error ? <div className="inbox_item_meta mono" style={{ color: "rgba(239, 68, 68, 0.9)" }}>{short_id(r.error, 180)}</div> : null}
                      </button>
                    );
                  })
                )
              ) : !filtered_items.length ? (
                <div className="mono muted" style={{ fontSize: "12px" }}>
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

          <div className="card inbox_viewer">
            {is_exec_view ? (
              exec_selected ? (
                <div className="inbox_detail">
                  <div className="inbox_detail_header">
                    <div className="inbox_detail_title">
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {exec_selected.backlog_filename || exec_selected.backlog_relpath || exec_selected.request_id}
                      </span>
                      <span className="chip mono muted">{exec_selected.status || "unknown"}</span>
                      <span className="chip mono muted">{short_id(exec_selected.request_id, 16)}</span>
                    </div>
                    <div className="inbox_detail_actions">
                      <button className="btn" onClick={() => copyText(exec_selected.request_id)} disabled={exec_detail_loading}>
                        Copy request id
                      </button>
                      {exec_selected.backlog_relpath ? (
                        <button className="btn" onClick={() => copyText(exec_selected.backlog_relpath || "")} disabled={exec_detail_loading}>
                          Copy backlog path
                        </button>
                      ) : null}
                      {exec_selected.run_dir_relpath ? (
                        <button className="btn" onClick={() => copyText(exec_selected.run_dir_relpath || "")} disabled={exec_detail_loading}>
                          Copy run dir
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="inbox_detail_meta mono muted" style={{ fontSize: "12px" }}>
                    {exec_selected.created_at ? `created ${new Date(exec_selected.created_at).toLocaleString()}` : ""}
                    {exec_selected.started_at ? ` • started ${new Date(exec_selected.started_at).toLocaleString()}` : ""}
                    {exec_selected.finished_at ? ` • finished ${new Date(exec_selected.finished_at).toLocaleString()}` : ""}
                  </div>

                  {exec_selected.error ? (
                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                      {exec_selected.error}
                    </div>
                  ) : null}
                  {exec_detail_error ? (
                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                      {exec_detail_error}
                    </div>
                  ) : null}

                  <div style={{ marginTop: "12px" }}>
                    {exec_detail_loading ? (
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        Loading…
                      </div>
                    ) : (
                      <>
                        <div className="section_title">Execution</div>
                        <div className="mono" style={{ fontSize: "12px" }}>
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

                        {exec_selected.last_message ? (
                          <>
                            <div className="section_divider" />
                            <div className="section_title">Last message</div>
                            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "12px", marginTop: "8px" }}>
                              {exec_selected.last_message}
                            </pre>
                          </>
                        ) : null}

                        <div className="section_divider" />
                        <div className="section_title">Live logs</div>
                        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "8px" }}>
                          <div className="col" style={{ flex: "0 0 auto" }}>
                            <select value={exec_log_name} onChange={(e) => set_exec_log_name(e.target.value as any)}>
                              <option value="events">events</option>
                              <option value="stderr">stderr</option>
                              <option value="last_message">last_message</option>
                            </select>
                          </div>
                          <div className="col" style={{ flex: "1 1 auto" }} />
                          <div className="col" style={{ flex: "0 0 auto", display: "flex", gap: "6px" }}>
                            <button
                              className={`btn ${exec_log_auto ? "primary" : ""}`}
                              onClick={() => set_exec_log_auto((v) => !v)}
                              disabled={!exec_selected?.request_id}
                            >
                              {exec_log_auto ? "Auto on" : "Auto off"}
                            </button>
                            <button className="btn" onClick={() => void load_exec_log_tail()} disabled={exec_log_loading || !exec_selected?.request_id}>
                              {exec_log_loading ? "Loading…" : "Refresh"}
                            </button>
                          </div>
                        </div>
                        {exec_log_error ? (
                          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                            {exec_log_error}
                          </div>
                        ) : null}
                        {!exec_log_error && exec_log_truncated ? (
                          <div className="mono muted" style={{ fontSize: "12px", marginTop: "6px" }}>
                            (tail truncated)
                          </div>
                        ) : null}
                        {exec_log_name === "events" && parsed_exec_events ? (
                          <>
                            <div
                              ref={exec_log_scroll_el_ref}
                              style={{ marginTop: "8px", maxHeight: "320px", overflow: "auto" }}
                              onScroll={(e) => {
                                exec_log_follow_ref.current = _is_near_bottom(e.currentTarget, 28);
                              }}
                            >
                              {parsed_exec_events.events.length === 0 ? (
                                <div className="mono muted" style={{ fontSize: "12px" }}>
                                  (no events yet)
                                </div>
                              ) : (
                                parsed_exec_events.events.map((ev) => {
                                  const p = ev.payload as any;
                                  const item = p && typeof p.item === "object" ? p.item : null;
                                  const item_type = item ? String(item.type || "").trim() : "";
                                  const item_id = item ? String(item.id || "").trim() : "";
                                  const thread_id = p ? String(p.thread_id || "").trim() : "";

                                  const is_error = ev.type === "error" || ev.type === "turn.failed";
                                  const is_ok = ev.type === "turn.completed" || ev.type === "turn.succeeded" || ev.type === "turn.success";

                                  const badge_bg = is_error
                                    ? "rgba(239, 68, 68, 0.14)"
                                    : is_ok
                                      ? "rgba(34, 197, 94, 0.14)"
                                      : "rgba(59, 130, 246, 0.12)";
                                  const badge_border = is_error
                                    ? "rgba(239, 68, 68, 0.35)"
                                    : is_ok
                                      ? "rgba(34, 197, 94, 0.35)"
                                      : "rgba(59, 130, 246, 0.28)";

                                  const msg = String(p?.message || p?.error?.message || "").trim();
                                  const text = item ? String(item.text || "").trim() : "";
                                  const cmd = item ? String(item.command || "").trim() : "";
                                  const status = item ? String(item.status || "").trim() : "";
                                  const exit_code = item && item.exit_code != null ? String(item.exit_code) : "";
                                  const out = item ? String(item.aggregated_output || "").trim() : "";
                                  const todo_items = item && Array.isArray(item.items) ? item.items : [];

                                  return (
                                    <div
                                      key={`${ev.idx}-${ev.type}`}
                                      style={{
                                        padding: "8px 10px",
                                        borderTop: "1px solid rgba(255,255,255,0.06)",
                                      }}
                                    >
                                      <div className="row" style={{ alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                        <span
                                          className="mono"
                                          style={{
                                            fontSize: "11px",
                                            padding: "2px 8px",
                                            borderRadius: "999px",
                                            background: badge_bg,
                                            border: `1px solid ${badge_border}`,
                                          }}
                                        >
                                          {ev.type}
                                        </span>
                                        {item_type ? (
                                          <span className="mono muted" style={{ fontSize: "11px" }}>
                                            {item_type}
                                          </span>
                                        ) : null}
                                        {item_id ? (
                                          <span className="mono muted" style={{ fontSize: "11px" }}>
                                            {item_id}
                                          </span>
                                        ) : null}
                                        {thread_id ? (
                                          <span className="mono muted" style={{ fontSize: "11px" }}>
                                            thread {short_id(thread_id, 18)}
                                          </span>
                                        ) : null}
                                      </div>

                                      {msg ? (
                                        <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "12px", marginTop: "8px" }}>
                                          {msg}
                                        </pre>
                                      ) : null}

                                      {todo_items && todo_items.length > 0 ? (
                                        <div className="mono" style={{ fontSize: "12px", marginTop: "8px" }}>
                                          {todo_items.map((t: any, i: number) => (
                                            <div key={`${ev.idx}-todo-${i}`}>
                                              {(t && t.completed) === true ? "✓" : "○"} {String(t?.text || "").trim()}
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}

                                      {cmd ? (
                                        <div style={{ marginTop: "8px" }}>
                                          <div className="mono muted" style={{ fontSize: "11px" }}>
                                            command_execution {status ? `(${status})` : ""} {exit_code ? `exit=${exit_code}` : ""}
                                          </div>
                                          <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "12px", marginTop: "6px" }}>
                                            {cmd}
                                          </pre>
                                        </div>
                                      ) : null}

                                      {out ? (
                                        <details style={{ marginTop: "8px" }}>
                                          <summary className="mono muted" style={{ fontSize: "12px", cursor: "pointer" }}>
                                            output ({out.length.toLocaleString()} chars)
                                          </summary>
                                          <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "12px", marginTop: "8px" }}>
                                            {out}
                                          </pre>
                                        </details>
                                      ) : null}

                                      {text ? (
                                        <details style={{ marginTop: "8px" }}>
                                          <summary className="mono muted" style={{ fontSize: "12px", cursor: "pointer" }}>
                                            text: {first_line_snippet(text, 80) || "(open)"}
                                          </summary>
                                          <div style={{ marginTop: "8px" }}>
                                            <Markdown text={text} />
                                          </div>
                                        </details>
                                      ) : null}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                            <details style={{ marginTop: "8px" }}>
                              <summary className="mono muted" style={{ fontSize: "12px", cursor: "pointer" }}>
                                Raw JSONL
                                {parsed_exec_events.bad ? ` (${parsed_exec_events.bad} unparsable line(s))` : ""}
                              </summary>
                              <pre
                                className="mono"
                                style={{ whiteSpace: "pre-wrap", fontSize: "12px", marginTop: "8px", maxHeight: "240px", overflow: "auto" }}
                              >
                                {parsed_exec_events.raw || ""}
                              </pre>
                            </details>
                          </>
                        ) : (
                          <div
                            ref={exec_log_scroll_el_ref}
                            style={{ marginTop: "8px", maxHeight: "320px", overflow: "auto" }}
                            onScroll={(e) => {
                              exec_log_follow_ref.current = _is_near_bottom(e.currentTarget, 28);
                            }}
                          >
                            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
                              {exec_log_text || "(no logs yet)"}
                            </pre>
                          </div>
                        )}

                        {exec_detail?.result?.logs ? (
                          <>
                            <div className="section_divider" />
                            <div className="section_title">Logs</div>
                            <div className="mono" style={{ fontSize: "12px" }}>
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
                <div className="mono muted" style={{ fontSize: "12px" }}>
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
                    <span className="chip mono muted">{selected.filename}</span>
                  </div>
                  <div className="inbox_detail_actions">
                    <button className="btn" onClick={() => copyText(`docs/backlog/${String(kind)}/${selected.filename}`)} disabled={action_loading}>
                      Copy path
                    </button>
                    {can_execute ? (
                      <button
                        className="btn primary"
                        onClick={() => {
                          set_action_error("");
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
                      <button className="btn" onClick={() => void move_selected("trash")} disabled={action_loading}>
                        Trash
                      </button>
                    ) : null}
                    {!editing ? (
                      <button
                        className="btn"
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
                      >
                        Edit
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

                <div className="inbox_detail_meta mono muted" style={{ fontSize: "12px" }}>
                  {String(kind)}
                  {content_sha ? ` • sha ${short_id(content_sha, 10)}` : ""}
                </div>

                {action_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                    {action_error}
                  </div>
                ) : null}
                {edit_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                    {edit_error}
                  </div>
                ) : null}
                {content_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                    {content_error}
                  </div>
                ) : null}

                {content_loading ? (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
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
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        Ask the maintainer to refine this backlog item. Provider/model can be set in Settings (blank = gateway default).
                      </div>
                      <div className="mono muted" style={{ fontSize: "11px", marginTop: "6px" }}>
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
                          <div className="mono muted" style={{ fontSize: "11px" }}>
                            Last attached: {edit_recent_attachments[0]}
                          </div>
                        ) : null}
                      </div>
                      {edit_attachments_error ? (
                        <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                          {edit_attachments_error}
                        </div>
                      ) : null}

                      <div className="section_divider" style={{ marginTop: "10px" }} />
                      <div className="source_chat" style={{ maxHeight: "220px" }}>
                        {maint_messages.length ? (
                          maint_messages.map((m) => (
                            <div key={m.id || `${m.role}_${m.ts}`} className={`source_msg ${m.role === "user" ? "source_user" : "source_assistant"}`}>
                              <div className="source_msg_meta">
                                <span className="mono">{m.role}</span>
                                <span className="mono">{m.ts ? new Date(m.ts).toLocaleTimeString() : ""}</span>
                              </div>
                              <div className="source_msg_body">
                                <ChatMessageContent text={m.content} />
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="mono muted" style={{ fontSize: "12px" }}>
                            No messages yet.
                          </div>
                        )}
                      </div>

                      <div className="row" style={{ marginTop: "10px", alignItems: "center" }}>
                        <div className="col" style={{ flex: "1 1 auto", minWidth: 240 }}>
                          <input
                            value={maint_input}
                            onChange={(e) => set_maint_input(e.target.value)}
                            placeholder="Message to maintainer (e.g. improve acceptance criteria…)"
                          />
                        </div>
                        <div className="col" style={{ flex: "0 0 auto" }}>
                          <button
                            className="btn primary"
                            onClick={() => void send_maintain()}
                            disabled={!can_use_gateway || maint_loading || !maint_input.trim() || !selected || !is_backlog_file_kind(kind)}
                          >
                            {maint_loading ? "Thinking…" : "Send"}
                          </button>
                        </div>
                      </div>

                      {maint_error ? (
                        <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                          {maint_error}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : content ? (
                  <Markdown text={content} />
                ) : (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    No content loaded.
                  </div>
                )}
              </div>
            ) : (
              <div className="mono muted" style={{ fontSize: "12px" }}>
                Select a backlog item.
              </div>
            )}
          </div>
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
        <div className="mono" style={{ fontSize: "12px" }}>
          Target:{" "}
          <span className="mono" style={{ fontWeight: 700 }}>
            {execute_target ? execute_target.title : "(unknown)"}
          </span>
        </div>
        {exec_cfg_loading ? (
          <div className="mono muted" style={{ fontSize: "12px", marginTop: "10px" }}>
            Checking worker…
          </div>
        ) : null}
        {!exec_cfg_loading && exec_cfg?.can_execute !== true ? (
          <div style={{ marginTop: "10px" }}>
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px" }}>
              {exec_cfg?.runner_enabled !== true
                ? "Backlog exec runner is disabled on this gateway."
                : exec_cfg?.runner_alive === false
                  ? "Backlog exec runner is not running on this gateway."
                  : exec_cfg?.codex_available === false
                    ? `Codex not found on gateway: ${String(exec_cfg?.codex_bin || "codex")}`
                    : "Backlog exec is not available on this gateway."}
            </div>
            {exec_cfg?.runner_error ? (
              <div className="mono muted" style={{ fontSize: "12px", marginTop: "6px" }}>
                {exec_cfg.runner_error}
              </div>
            ) : null}
            <details style={{ marginTop: "8px" }}>
              <summary className="mono muted" style={{ fontSize: "12px", cursor: "pointer" }}>
                Setup
              </summary>
              <div className="mono" style={{ fontSize: "12px", marginTop: "8px" }}>
                <div>Docs: `docs/backlog/README.md`</div>
                <div style={{ marginTop: "6px" }}>Required env (example):</div>
                <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "12px", marginTop: "6px" }}>
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
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "10px" }}>
            {exec_cfg_error}
          </div>
        ) : null}
        {action_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "10px" }}>
            {action_error}
          </div>
        ) : null}
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
        <div className="mono muted" style={{ fontSize: "12px" }}>
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
        <div className="mono muted" style={{ fontSize: "12px" }}>
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
          <div className="mono" style={{ fontSize: "12px", marginTop: "6px" }}>
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
          <div className="mono muted" style={{ fontSize: "12px", marginTop: "8px" }}>
            Uploading attachments…
          </div>
        ) : null}
        {attachments_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
            {attachments_error}
          </div>
        ) : null}

        <div className="section_divider" />
        <div className="section_title">Draft (Markdown)</div>
        <div className="mono muted" style={{ fontSize: "12px" }}>
          Prefilled from `docs/backlog/template.md` (editable). AI assist can also refine the draft.
        </div>
        {template_loading ? (
          <div className="mono muted" style={{ fontSize: "12px", marginTop: "8px" }}>
            Loading template…
          </div>
        ) : null}
        {template_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
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
        <div className="mono muted" style={{ fontSize: "12px" }}>
          Use this to iteratively refine a backlog draft; assistant replies can also update the draft markdown.
        </div>

        <div className="source_chat" style={{ maxHeight: "220px" }}>
          {assist_messages.length ? (
            assist_messages.map((m) => (
              <div key={m.id || `${m.role}_${m.ts}`} className={`source_msg ${m.role === "user" ? "source_user" : "source_assistant"}`}>
                <div className="source_msg_meta">
                  <span className="mono">{m.role}</span>
                  <span className="mono">{m.ts ? new Date(m.ts).toLocaleTimeString() : ""}</span>
                </div>
                <div className="source_msg_body">
                  <ChatMessageContent text={m.content} />
                </div>
              </div>
            ))
          ) : (
            <div className="mono muted" style={{ fontSize: "12px" }}>
              No messages yet.
            </div>
          )}
        </div>

        <div style={{ marginTop: "10px" }}>
          <ChatComposer
            value={assist_input}
            onChange={set_assist_input}
            onSubmit={() => void send_assist()}
            placeholder="Message to AI (e.g. refine acceptance criteria…)"
            disabled={!new_title.trim()}
            busy={assist_loading}
            rows={3}
            sendButtonClassName="btn primary"
          />
        </div>

        {new_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
            {new_error}
          </div>
        ) : null}
      </Modal>

      <button
        className={`advisor_toggle ${advisor_open ? "open" : ""}`}
        onClick={() => set_advisor_open((v) => !v)}
        title="Open backlog advisor (read-only)"
        aria-label="Open backlog advisor"
      >
        <span className="advisor_toggle_label">Advisor</span>
      </button>

      {advisor_open ? (
        <div
          className="drawer_backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) set_advisor_open(false);
          }}
        >
          <div className="drawer_panel">
            <div className="drawer_header">
              <div className="col" style={{ gap: 2 }}>
                <div className="drawer_title">Backlog advisor</div>
                <div className="mono muted" style={{ fontSize: "11px" }}>
                  Read-only. Using: {maint_provider || "(gateway default)"} / {maint_model || "(gateway default)"}
                </div>
              </div>
              <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => set_advisor_messages([])} disabled={advisor_loading || !advisor_messages.length}>
                  Clear
                </button>
                <button className="btn" onClick={() => set_advisor_open(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className="drawer_body">
              <div className="source_chat" style={{ maxHeight: "unset", flex: "1 1 auto", width: "100%" }}>
                {advisor_messages.length ? (
                  advisor_messages.map((m) => (
                    <div key={m.id || `${m.role}_${m.ts}`} className={`source_msg ${m.role === "user" ? "source_user" : "source_assistant"}`}>
                      <div className="source_msg_meta">
                        <span className="mono">{m.role}</span>
                        <span className="mono">{m.ts ? new Date(m.ts).toLocaleTimeString() : ""}</span>
                      </div>
                      <div className="source_msg_body">
                        <ChatMessageContent text={m.content} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    Ask about the backlog, e.g. “What are the top 5 planned items to focus on next and why?”
                  </div>
                )}
              </div>

              <div className="drawer_footer">
                <ChatComposer
                  ref={advisor_input_ref}
                  value={advisor_input}
                  onChange={set_advisor_input}
                  onSubmit={() => void send_advisor()}
                  placeholder="Message to backlog advisor…"
                  disabled={!can_use_gateway}
                  busy={advisor_loading}
                  rows={3}
                  sendButtonClassName="btn primary"
                />
                {advisor_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                    {advisor_error}
                  </div>
                ) : null}
                {!can_use_gateway ? (
                  <div className="mono muted" style={{ fontSize: "12px", marginTop: "8px" }}>
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
