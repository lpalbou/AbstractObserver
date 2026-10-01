/**
 * Run view step kinds and the HOUSEKEEPING table (operator 2026-10-01 13:05:
 * "140 steps or what?").
 *
 * One explicit table, no text heuristics: a step's kind comes from the
 * runtime's effect type (abstractruntime core/models.py EffectType), and a
 * kind is housekeeping only when it is listed below. Housekeeping steps are
 * hidden until "All steps" is on; a FAILED step is never hidden.
 * Unknown effect types are shown (kind "other"): hiding what we do not know
 * would make a new effect invisible.
 */

export type StepKind =
  | "llm_call"
  | "tool"
  | "subflow"
  | "event"
  | "wait"
  | "resume"
  | "ask"
  | "answer"
  | "memory"
  | "model"
  | "node"
  | "other";

/** Runtime effect type → run view kind. */
export const STEP_KIND_BY_EFFECT: Readonly<Record<string, StepKind>> = {
  llm_call: "llm_call",
  tool_calls: "tool",
  tool_invoke: "tool",
  entity_tools_execute: "tool",
  start_subworkflow: "subflow",
  emit_event: "event",
  wait_event: "wait",
  wait_until: "wait",
  // The parent's step that continues after a subworkflow finished.
  resume: "resume",
  ask_user: "ask",
  answer_user: "answer",
  model_residency: "model",
  memory_query: "memory",
  memory_tag: "memory",
  memory_compact: "memory",
  memory_note: "memory",
  memory_rehydrate: "memory",
  memory_kg_assert: "memory",
  memory_kg_query: "memory",
  memory_kg_resolve: "memory",
  memory_recall: "memory",
  memory_access: "memory",
  memory_form: "memory",
  memory_adjust: "memory",
  memory_appraise: "memory",
  memory_consolidate: "memory",
  memory_probe: "memory",
  memory_tend: "memory",
  diary_write: "memory",
  diary_read: "memory",
  life_query: "memory",
  entity_tools_query: "memory",
  vars_query: "memory",
};

/** Kinds hidden by default: waits, subworkflow resumes, memory bookkeeping, model loads, effect-less node steps. */
export const HOUSEKEEPING_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(["wait", "resume", "memory", "model", "node"]);

/** Events hidden by default: status lines, progress ticks, steer acks, saved summaries. Other events are shown. */
export const HOUSEKEEPING_EVENT_NAMES: ReadonlySet<string> = new Set([
  "abstract.status",
  "abstract.progress",
  "abstract.steer_seen",
  "abstract.summary",
]);

/** Short label shown on the card (≤ 2 words). */
export const STEP_KIND_LABEL: Readonly<Record<StepKind, string>> = {
  llm_call: "LLM call",
  tool: "Tools",
  subflow: "Subflow",
  event: "Event",
  wait: "Wait",
  resume: "Resume",
  ask: "Question",
  answer: "Answer",
  memory: "Memory",
  model: "Model",
  node: "Node",
  other: "Effect",
};

export function step_kind_of(effect_type: string): StepKind {
  const t = String(effect_type || "").trim();
  if (!t) return "node";
  return STEP_KIND_BY_EFFECT[t] || "other";
}

export function is_housekeeping(kind: StepKind, event_name: string, failed: boolean): boolean {
  if (failed) return false;
  if (kind === "event") return HOUSEKEEPING_EVENT_NAMES.has(String(event_name || "").trim());
  return HOUSEKEEPING_KINDS.has(kind);
}
