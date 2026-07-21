/**
 * Ledger-record folds (ui-rethink P1 slice 3b, 2026-07-21).
 *
 * Moved VERBATIM from app.tsx: pure readers over StepRecord/ledger rows —
 * human summaries, response-text extraction, and the provider-activity
 * fold the Calls surfaces render. No React, no app state.
 */
import { extract_wait_from_record } from "../lib/runtime_extractors";
import type { StepRecord } from "../lib/types";
import { clamp_preview, parse_iso_ms, safe_json_inline } from "./format";

export type ProviderActivity = {
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

export function ledger_record_effect_label(rec: any): string {
  const status = String(rec?.status || "").trim();
  const effect_type = String(rec?.effect?.type || "").trim();
  const emit = rec?.effect?.payload && typeof rec.effect.payload === "object" ? String(rec.effect.payload.name || "").trim() : "";
  if (effect_type === "emit_event" && emit) return emit;
  if (effect_type) return effect_type;
  return status || "record";
}

export function ledger_record_human_summary(rec: any): string {
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

export function extract_textish(payload: any): { text: string; duration: number } {
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

export function extract_response_text_from_record(rec: any): string {
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

export function format_step_summary(rec: StepRecord): string {
  const node = String(rec?.node_id || "");
  const st = String(rec?.status || "");
  const eff = String(rec?.effect?.type || "");
  return `${node || "(node?)"} • ${st || "(status?)"} • ${eff || "(effect?)"}`;
}

export function is_waiting_status(rec: StepRecord | null): boolean {
  return Boolean(rec && String(rec.status || "") === "waiting");
}

export function build_provider_activities_from_ledger(items: Array<{ run_id?: string; cursor: number; record: StepRecord }>): ProviderActivity[] {
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

