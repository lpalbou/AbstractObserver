import { describe, it, expect } from "vitest";

import { deriveLifeState } from "./entity_state";
import type { EntityStateInfo, LoopStatus, ChatStatus, ServerLifeState } from "./stream_source";

const state = (s: Partial<EntityStateInfo>): EntityStateInfo => ({ state: "awake", ...s });
const loop = (l: Partial<LoopStatus>): LoopStatus => ({ phase: "stopped", running: false, ...l });
const chat = (c: Partial<ChatStatus>): ChatStatus => ({ open: false, ...c });
const server = (s: Partial<ServerLifeState>): ServerLifeState => ({ phase: "awake", ...s });

describe("deriveLifeState — the maintainer's mutually-exclusive state machine (2026-07-09)", () => {
  it("VISIT suppresses own-time even when the loop process is alive (auto-yield)", () => {
    // The bug: a visit auto-yields the loop, so running stays true; the
    // old UI showed VISITING + own-time-pressed at once.
    const life = deriveLifeState(state({ mode: "visiting" }), loop({ running: true, phase: "day" }), null);
    expect(life.phase).toBe("visiting");
    expect(life.ownTimeActive).toBe(false);
    expect(life.sleeping).toBe(false);
  });

  it("VISIT suppresses sleeping (cannot visit and sleep)", () => {
    const life = deriveLifeState(state({ state: "asleep", mode: "visiting" }), loop({}), null);
    expect(life.phase).toBe("visiting");
    expect(life.sleeping).toBe(false);
  });

  it("a chat open (no mode set) is still a visit", () => {
    const life = deriveLifeState(state({}), loop({ running: true, phase: "day" }), chat({ open: true }));
    expect(life.phase).toBe("visiting");
    expect(life.ownTimeActive).toBe(false);
  });

  it("ON ITS TIME requires running AND phase=day AND no visit", () => {
    const life = deriveLifeState(state({ state: "awake" }), loop({ running: true, phase: "day" }), null);
    expect(life.phase).toBe("own_time");
    expect(life.ownTimeActive).toBe(true);
  });

  it("a loop alive but between days is RESTING, not on-its-time", () => {
    const life = deriveLifeState(state({ state: "awake" }), loop({ running: true, phase: "between" }), null);
    expect(life.phase).toBe("resting");
    expect(life.ownTimeActive).toBe(false);
  });

  it("dreaming is a distinct sleeping sub-state, never own-time", () => {
    const life = deriveLifeState(state({ state: "asleep", mode: "dreaming" }), loop({ running: true, phase: "day" }), null);
    expect(life.phase).toBe("dreaming");
    expect(life.sleeping).toBe(true);
    expect(life.ownTimeActive).toBe(false);
  });

  it("operator sleep vs self sleep is labeled from written_by", () => {
    expect(deriveLifeState(state({ state: "asleep", written_by: "self" }), loop({}), null).label).toContain("self");
    expect(deriveLifeState(state({ state: "asleep", written_by: "operator" }), loop({}), null).label).toBe("asleep");
  });

  it("paused is its own state, not own-time", () => {
    const life = deriveLifeState(state({ state: "paused" }), loop({ running: true, phase: "day" }), null);
    expect(life.phase).toBe("paused");
    expect(life.ownTimeActive).toBe(false);
  });

  it("SERVER phase is the authority when /life_state is available (commons seq 96)", () => {
    // The gateway computed "visiting"; the stale client trio disagrees
    // (asleep + loop ticking). The server answer wins — no re-derivation.
    const life = deriveLifeState(
      state({ state: "asleep" }),
      loop({ running: true, phase: "day" }),
      null,
      server({ phase: "visiting", chat_open: true, state: "awake", own_time_running: true, own_time_phase: "between" }),
    );
    expect(life.phase).toBe("visiting");
    expect(life.ownTimeActive).toBe(false);
    expect(life.sleeping).toBe(false);
  });

  it("server asleep + state_mode=dreaming decorates as dreaming (still sleeping-class)", () => {
    const life = deriveLifeState(null, null, null, server({ phase: "asleep", state: "asleep", state_mode: "dreaming" }));
    expect(life.phase).toBe("dreaming");
    expect(life.sleeping).toBe(true);
    expect(life.ownTimeActive).toBe(false);
  });

  it("a stale dreaming mode never overrides a non-asleep server phase", () => {
    const life = deriveLifeState(null, null, null, server({ phase: "own_time", state: "awake", state_mode: "dreaming", own_time_running: true, own_time_phase: "day" }));
    expect(life.phase).toBe("own_time");
    expect(life.ownTimeActive).toBe(true);
    expect(life.sleeping).toBe(false);
  });

  it("server phases map one-to-one and stay mutually exclusive", () => {
    const phases: Array<[string, string]> = [
      ["visiting", "visiting"],
      ["paused", "paused"],
      ["asleep", "sleeping"],
      ["own_time", "own_time"],
      ["resting", "resting"],
      ["awake", "awake"],
    ];
    for (const [serverPhase, expected] of phases) {
      const life = deriveLifeState(null, null, null, server({ phase: serverPhase }));
      expect(life.phase).toBe(expected);
      const active = [life.visiting, life.sleeping, life.ownTimeActive].filter(Boolean).length;
      expect(active).toBeLessThanOrEqual(1);
    }
  });

  it("a null server (older gateway) falls back to client derivation unchanged", () => {
    const life = deriveLifeState(state({ state: "awake" }), loop({ running: true, phase: "day" }), null, null);
    expect(life.phase).toBe("own_time");
    expect(life.ownTimeActive).toBe(true);
  });

  it("no two states are ever simultaneously active", () => {
    // Exhaustive-ish: for any combination, at most one of visiting/sleeping/
    // ownTimeActive is true (visiting excludes the other two).
    const modes = [undefined, "visiting", "dreaming"];
    const states = ["awake", "asleep", "paused"];
    const phases = ["stopped", "between", "day"];
    for (const m of modes)
      for (const s of states)
        for (const p of phases)
          for (const running of [false, true]) {
            const life = deriveLifeState(
              state({ state: s, mode: m as string | undefined }),
              loop({ running, phase: p }),
              null,
            );
            const active = [life.visiting, life.sleeping, life.ownTimeActive].filter(Boolean).length;
            expect(active).toBeLessThanOrEqual(1);
            if (life.visiting) {
              expect(life.sleeping).toBe(false);
              expect(life.ownTimeActive).toBe(false);
            }
          }
  });
});
