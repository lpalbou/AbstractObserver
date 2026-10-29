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

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** The tools a wait asks for, as a phrase from the kit's nouns: "a web search and an email",
 * "2 web searches and a page fetch", "a web search, an email, a file write and 2 more". A tool
 * without a template reads "a <verb> call" ("a make report call"). Names or calls. */
export function tools_phrase(calls: readonly unknown[]): string {
  const counts = new Map<string, { n: number; one: string; many: string }>();
  for (const c of calls || []) {
    const call = typeof c === "string" ? { name: c } : c;
    const w = describeToolCall(kit_tool_call(call));
    const one = w.fallback ? `${w.verb.toLowerCase()} call` : w.noun[0];
    const many = w.fallback ? `${w.verb.toLowerCase()} calls` : w.noun[1];
    const prev = counts.get(many);
    if (prev) prev.n += 1;
    else counts.set(many, { n: 1, one, many });
  }
  const parts = [...counts.values()].map(({ n, one, many }) => (n === 1 ? article(one) : `${n} ${many}`));
  if (!parts.length) return "a tool call";
  const shown = parts.length > 4 ? [...parts.slice(0, 3), `${parts.length - 3} more`] : parts;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}
