/**
 * Run + wait labeling (ui-rethink P1 slice 3a, 2026-07-21).
 *
 * Moved VERBATIM from app.tsx: the pure folds that turn wire shapes
 * (RunSummary rows, WaitState blocks, conversation inputs) into the
 * words and pills every surface renders — one vocabulary, all pages.
 * RunStatusPill rides along because it IS the status word's render.
 */
import React from "react";

import { clamp_preview, safe_json_inline, terminal_run_status } from "./format";
import { run_status_class, type RunSummary } from "./run_status";
import { merge_runtime_metadata, split_runtime_metadata_envelope, type RuntimeMetadata } from "./runtime_metadata";
import type { ToolCall, WaitState } from "../lib/types";

export function raw_text_from_message_content(value: any): string {
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

export function message_text_and_metadata(value: any): { text: string; runtime_metadata: RuntimeMetadata | null } {
  const split = split_runtime_metadata_envelope(raw_text_from_message_content(value));
  return { text: split.text, runtime_metadata: split.metadata };
}

export function extract_last_user_request_detail(input: Record<string, any> | null): { text: string; runtime_metadata: RuntimeMetadata | null } {
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

export type ConversationContextItem = {
  role: string;
  text: string;
  ts: string;
  runtime_metadata?: RuntimeMetadata | null;
};

export function extract_conversation_context(input: Record<string, any> | null, limit = 6): ConversationContextItem[] {
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

export function is_generic_wait_prompt(prompt: string): boolean {
  const normalized = String(prompt || "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "please respond:" || normalized === "please respond" || normalized === "type response..." || normalized === "type response";
}

export function tool_call_names(tool_calls: ToolCall[]): string {
  const names = tool_calls.map((tc: any) => String(tc?.name || "tool").trim()).filter(Boolean);
  if (!names.length) return "";
  return `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
}

/** Tooltip for regex-derived risk labels (tool-tiers cycle 3, 2026-07-23):
 * until tools carry DECLARED risk tiers (the converged two-axis design),
 * these labels are argument-regex GUESSES — the defeatable-parser class.
 * The render says so instead of presenting inference as declaration; when
 * declared tiers ship on the wire, declared-first replaces this and the
 * regex demotes to a labeled legacy fallback (legacy_inferred precedent). */
export const TOOL_RISK_INFERRED_TITLE =
  "inferred from the call's arguments (regex heuristic) — not a declared risk tier; declared tiers replace this when the grant API ships";

export function tool_risk_labels(tool_call: ToolCall): string[] {
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

export function wait_blocker_title(wait: WaitState | null | undefined, tool_calls: ToolCall[]): string {
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

export function wait_expected_action(wait: WaitState | null | undefined, tool_calls: ToolCall[]): string {
  if (tool_calls.length) {
    return "Review the requested tool call, then approve and execute it, approve without local execution, reject it, or cancel the whole run.";
  }
  const choices = Array.isArray(wait?.choices) ? wait?.choices || [] : [];
  if (choices.length) return "Select one of the allowed responses, then submit it to resume this run.";
  if (wait?.allow_free_text === false) return "This wait does not allow free text. Use the available response control or inspect the ledger.";
  if (String(wait?.prompt || "").trim()) return "Answer the workflow question below. Submitting resumes only this wait.";
  return "No explicit question was emitted. Inspect the original request and recent ledger context before responding.";
}

export function wait_request_detail(wait: WaitState | null | undefined, input: Record<string, any> | null): { text: string; runtime_metadata: RuntimeMetadata | null } {
  const prompt = String(wait?.prompt || "").trim();
  const prompt_split = split_runtime_metadata_envelope(prompt);
  const last_request = extract_last_user_request_detail(input);
  if (prompt_split.text && !is_generic_wait_prompt(prompt_split.text)) return { text: prompt_split.text, runtime_metadata: prompt_split.metadata };
  if (last_request.text) return last_request;
  return { text: prompt_split.text || prompt, runtime_metadata: prompt_split.metadata };
}

export function wait_request_text(wait: WaitState | null | undefined, input: Record<string, any> | null): string {
  return wait_request_detail(wait, input).text;
}

export function wait_json_value(parsed: Record<string, any> | null, raw: string): unknown {
  if (parsed) return parsed;
  const text = String(raw || "").trim();
  return text || {};
}

export function run_workflow_label(run: RunSummary | null | undefined, labels: Record<string, string>): string {
  const wid = String(run?.schedule_target_workflow_id || run?.workflow_id || "").trim();
  if (!wid) return "(workflow unknown)";
  return labels[wid] || wid;
}

export function RunStatusPill(props: { status: any }): React.ReactElement {
  const status = String(props.status || "unknown").trim() || "unknown";
  return <span className={`run_status_pill ${run_status_class(status)}`}>{status}</span>;
}

export function run_wait_label(run: RunSummary | null | undefined): string {
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

export function run_error_label(run: RunSummary | null | undefined): string {
  const err: any = run?.error;
  if (!err) return "";
  if (typeof err === "string") return clamp_preview(err, { max_chars: 220, max_lines: 2 });
  return clamp_preview(safe_json_inline(err, 400), { max_chars: 220, max_lines: 2 });
}

export function run_activity_label(run: RunSummary | null | undefined): string {
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

