/**
 * The Observer's tool calls in words: an adapter to the kit's `describeToolCall` /
 * `ToolCallWordsList` (ui-kit `tool_call_words`, uic 0068), so the approval panels, the runtime
 * page and Mission Control say "Fetch the page example.org/news" like every other client, never
 * the tool's raw name with its JSON (operator 2026-10-29). No local word templates here.
 */
import { describeToolCall, type ToolCallInput } from "@abstractframework/ui-kit";

function parsed_arguments(value: unknown): Record<string, unknown> | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A runtime tool call (`{name, arguments}`, arguments possibly a JSON string) as the kit's input. */
export function kit_tool_call(call: unknown): ToolCallInput {
  const c = (call && typeof call === "object" ? call : {}) as { name?: unknown; arguments?: unknown };
  return { name: String(c.name || "tool"), arguments: parsed_arguments(c.arguments) };
}

export function kit_tool_calls(calls: readonly unknown[]): ToolCallInput[] {
  return (calls || []).map(kit_tool_call);
}

/** One call as one sentence: the kit's sentence, or for a tool without a template its verb and
 * "Key: value" pairs. */
export function tool_call_sentence(call: unknown): string {
  const w = describeToolCall(kit_tool_call(call));
  if (!w.fallback) return w.sentence;
  return w.fallback.length ? `${w.verb}: ${w.fallback.map((f) => `${f.label}: ${f.value}`).join(", ")}` : w.verb;
}

/** The verb chip's word ("Fetch", "Search", "Email"). */
export function tool_call_verb(call: unknown): string {
  return describeToolCall(kit_tool_call(call)).verb;
}
