/**
 * ONE derived life-state (maintainer ruling, 2026-07-09 02:02: "we have
 * categories/states issues"). The header used to render the lifecycle
 * badge AND the loop-phase badge INDEPENDENTLY, so it showed impossible
 * combinations — VISITING beside RESTING-BETWEEN-DAYS with own-time lit.
 *
 * The maintainer's model: an entity is in exactly ONE of these, and some
 * are mutually exclusive —
 *   - VISIT      (a human/entity is in the room)
 *   - WORKING    (a long run is executing)
 *   - OWN TIME   (the self-prompted loop is actively ticking)
 *   - SLEEPING   (resting / consolidating)
 * It can NOT be visiting AND sleeping, nor visiting AND on-its-time.
 *
 * The truth is split across three server reads (chat status, entity
 * state, loop status) that CAN transiently overlap — a visit auto-yields
 * the own-time loop, so the loop PROCESS stays alive (loopStatus.running
 * = true) while it is NOT ticking. So "on its time" is loop RUNNING AND
 * PHASE=day AND no visit — process-alive alone is not on-its-time. This
 * module collapses the three reads into one state with a fixed
 * precedence, so no surface can display (or offer a toggle for) a
 * forbidden combination.
 */

import type { EntityStateInfo, LoopStatus, ChatStatus, ServerLifeState } from "./stream_source";

export type LifePhase = "visiting" | "working" | "dreaming" | "sleeping" | "own_time" | "paused" | "resting" | "awake";

export interface DerivedLifeState {
  /** The single state to DISPLAY (one chip, never two). */
  phase: LifePhase;
  /** Human label for the chip. */
  label: string;
  /** CSS accent class suffix (eh_life_<accent>). */
  accent: string;
  /** Tooltip explaining the state. */
  detail: string;
  /** Is the own-time loop ACTIVELY ticking (not merely process-alive)? */
  ownTimeActive: boolean;
  /** Is he resting/consolidating right now? */
  sleeping: boolean;
  /** Is a visit in the room right now? (own-time + sleep are suppressed.) */
  visiting: boolean;
}

/**
 * Precedence (highest first): VISIT > WORKING > SLEEPING/DREAMING >
 * OWN-TIME(ticking) > PAUSED > RESTING(loop alive, between days) > AWAKE.
 * Visit wins because it is the one that MUST suppress the others.
 *
 * When the gateway's composite `/life_state` is available (commons seq 96)
 * its `phase` is the AUTHORITY — computed server-side with the same
 * precedence, immune to the three-reads-disagree race. The client then only
 * DECORATES (dreaming refines asleep via state_mode; written_by nuances the
 * sleep label). Without it (older gateway) the client derives from the trio
 * exactly as before — the #FALLBACK path.
 */
export function deriveLifeState(
  entityState: EntityStateInfo | null,
  loopStatus: LoopStatus | null,
  chatStatus: ChatStatus | null,
  server?: ServerLifeState | null,
): DerivedLifeState {
  // When the server answer is present its fields are used EXCLUSIVELY —
  // mixing a stale client read into a fresh server phase re-opens the
  // contradiction class this module exists to close.
  const mode = String((server ? server.state_mode : entityState?.mode) ?? "").toLowerCase();
  const state = String((server ? server.state : entityState?.state) ?? "").toLowerCase();
  const loopRunning = server ? Boolean(server.own_time_running) : Boolean(loopStatus?.running);
  const phase = String((server ? server.own_time_phase : loopStatus?.phase) || "").toLowerCase();
  const serverPhase = server ? String(server.phase || "").toLowerCase() : null;
  // A visit is present when the server phase says so; without the composite
  // endpoint, when the gateway state mode says so OR a chat is open.
  const visiting = serverPhase ? serverPhase === "visiting" : mode === "visiting" || Boolean(chatStatus?.open);
  // "working": a long run. No entity-run signal exists server-side yet
  // (deferred by the gateway as a run_id concern, commons seq 96);
  // represented so the state machine is complete the moment it arrives.
  const working = !serverPhase && (mode === "working" || state === "working");
  // Dreaming is sleeping-with-consolidation; both are "resting". The server
  // trio folds dreaming into asleep — state_mode carries the refinement,
  // and it may only DECORATE the asleep phase, never override another one
  // (a stale mode must not contradict the server's single answer).
  const dreaming = mode === "dreaming" && (serverPhase ? serverPhase === "asleep" : !visiting);
  const sleeping = serverPhase ? serverPhase === "asleep" : state === "asleep" || dreaming;
  // ON ITS TIME = the loop is ACTIVELY ticking: running AND a day is open
  // AND not gated (paused) AND no visit/sleep. A visit yields the loop
  // (process alive, phase drifts to between) and paused gates it, so
  // running-alone is never "on its time".
  const ownTimeTicking = serverPhase
    ? serverPhase === "own_time"
    : loopRunning && phase === "day" && state !== "paused" && !visiting && !sleeping;
  const paused = serverPhase ? serverPhase === "paused" : state === "paused";
  const resting = serverPhase ? serverPhase === "resting" : loopRunning;

  if (visiting) {
    return {
      phase: "visiting",
      label: "visiting",
      accent: "visiting",
      detail: "A visitor is in the room — his own time is yielded and he is not resting.",
      ownTimeActive: false,
      sleeping: false,
      visiting: true,
    };
  }
  if (working) {
    return {
      phase: "working",
      label: "working",
      accent: "working",
      detail: "A long run is executing.",
      ownTimeActive: false,
      sleeping: false,
      visiting: false,
    };
  }
  if (dreaming) {
    return {
      phase: "dreaming",
      label: "dreaming",
      accent: "dreaming",
      detail: "Asleep and consolidating — a dream pass runs over his recent life.",
      ownTimeActive: false,
      sleeping: true,
      visiting: false,
    };
  }
  if (sleeping) {
    return {
      phase: "sleeping",
      label: entityState?.written_by === "self" ? "sleeping (self)" : "asleep",
      accent: "sleeping",
      detail: entityState?.written_by === "self" ? "Resting by his own choice." : "Asleep by the operator.",
      ownTimeActive: false,
      sleeping: true,
      visiting: false,
    };
  }
  if (ownTimeTicking) {
    return {
      phase: "own_time",
      label: "on his own time",
      accent: "own_time",
      detail: "Living a day by himself — the self-prompted tick loop is running.",
      ownTimeActive: true,
      sleeping: false,
      visiting: false,
    };
  }
  if (paused) {
    return {
      phase: "paused",
      label: "paused",
      accent: "paused",
      detail: "His own time is gated (paused) — no ticks until resumed.",
      ownTimeActive: false,
      sleeping: false,
      visiting: false,
    };
  }
  if (resting) {
    // Loop alive but not ticking a day and no visit: resting between days.
    return {
      phase: "resting",
      label: "resting between days",
      accent: "resting",
      detail: "His day closed; he rests before the next one begins on its own.",
      ownTimeActive: false,
      sleeping: false,
      visiting: false,
    };
  }
  return {
    phase: "awake",
    label: state || "awake",
    accent: "awake",
    detail: "Awake, not currently living a day by himself.",
    ownTimeActive: false,
    sleeping: false,
    visiting: false,
  };
}
