// The run view's housekeeping table (one module, explicit, no text heuristics).
import { describe, expect, it } from "vitest";

import {
  HOUSEKEEPING_EVENT_NAMES,
  HOUSEKEEPING_KINDS,
  STEP_KIND_BY_EFFECT,
  STEP_KIND_LABEL,
  is_housekeeping,
  step_kind_of,
} from "./run_step_kinds";

// abstractruntime core/models.py EffectType (2026-10-01) + the "resume" record the
// runtime appends when a parent continues after its subworkflow.
const RUNTIME_EFFECT_TYPES = [
  "wait_event", "wait_until", "ask_user", "answer_user", "emit_event", "llm_call", "model_residency", "tool_calls",
  "tool_invoke", "memory_query", "memory_tag", "memory_compact", "memory_note", "memory_rehydrate", "memory_kg_assert",
  "memory_kg_query", "memory_kg_resolve", "memory_recall", "memory_access", "memory_form", "memory_adjust",
  "memory_appraise", "diary_write", "diary_read", "memory_consolidate", "memory_probe", "life_query", "memory_tend",
  "entity_tools_query", "entity_tools_execute", "vars_query", "start_subworkflow", "resume",
];

describe("run step kinds", () => {
  it("classifies every runtime effect type explicitly", () => {
    expect(Object.keys(STEP_KIND_BY_EFFECT).sort()).toEqual([...RUNTIME_EFFECT_TYPES].sort());
  });

  it("the housekeeping table: waits, resumes, memory bookkeeping, model loads, effect-less node steps", () => {
    expect([...HOUSEKEEPING_KINDS].sort()).toEqual(["memory", "model", "node", "resume", "wait"]);
    expect([...HOUSEKEEPING_EVENT_NAMES].sort()).toEqual(["abstract.progress", "abstract.status", "abstract.steer_seen", "abstract.summary"]);
  });

  it("what a person cares about is never housekeeping", () => {
    for (const t of ["llm_call", "tool_calls", "tool_invoke", "entity_tools_execute", "start_subworkflow", "ask_user", "answer_user"]) {
      expect(is_housekeeping(step_kind_of(t), "", false)).toBe(false);
    }
    expect(is_housekeeping("event", "abstract.message", false)).toBe(false);
    expect(is_housekeeping("event", "fixture.ping", false)).toBe(false);
  });

  it("status/progress events, waits, memory and effect-less steps are housekeeping", () => {
    expect(is_housekeeping("event", "abstract.progress", false)).toBe(true);
    expect(is_housekeeping(step_kind_of("wait_until"), "", false)).toBe(true);
    expect(is_housekeeping(step_kind_of("memory_note"), "", false)).toBe(true);
    expect(is_housekeeping(step_kind_of(""), "", false)).toBe(true);
    expect(is_housekeeping(step_kind_of("resume"), "", false)).toBe(true);
  });

  it("a failed step is never hidden; an unknown effect type is shown", () => {
    expect(is_housekeeping(step_kind_of("memory_note"), "", true)).toBe(false);
    expect(is_housekeeping("event", "abstract.status", true)).toBe(false);
    expect(step_kind_of("brand_new_effect")).toBe("other");
    expect(is_housekeeping("other", "", false)).toBe(false);
  });

  it("every kind has a label of at most two words", () => {
    for (const label of Object.values(STEP_KIND_LABEL)) expect(label.split(" ").length).toBeLessThanOrEqual(2);
  });
});
