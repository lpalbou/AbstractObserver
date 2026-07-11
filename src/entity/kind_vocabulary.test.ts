/**
 * Kind-vocabulary drift guard (the diary_type-clamp gotcha class, applied
 * to pixels): every canonical engine record kind must resolve to a real
 * color class — never the "unknown" gray. ENGINE_RECORD_KINDS mirrors the
 * root-exported `abstractmemory.MEMORY_RECORD_KINDS` (semantics c319
 * ruling: engine validation vocabulary is engine-owned; TS consumers keep
 * a mirrored copy with sync-on-widening). When memory widens the set,
 * extend the mirror + KIND_COLORS and this test keeps both honest.
 */

import { describe, expect, it } from "vitest";

import { ENGINE_RECORD_KINDS, IDENTITY_KINDS, KIND_COLORS } from "./graph_canvas";

describe("engine kind vocabulary", () => {
  it("every canonical record kind renders with a real color, never unknown-gray", () => {
    for (const kind of ENGINE_RECORD_KINDS) {
      const covered = IDENTITY_KINDS.has(kind) || Boolean(KIND_COLORS[kind]);
      expect(covered, `kind "${kind}" would render as unknown gray — extend KIND_COLORS`).toBe(true);
    }
  });

  it("identity kinds stay inside the canonical set", () => {
    for (const kind of IDENTITY_KINDS) {
      expect(ENGINE_RECORD_KINDS as readonly string[], `identity kind "${kind}" is not canonical`).toContain(kind);
    }
  });
});
