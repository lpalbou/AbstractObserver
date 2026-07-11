/**
 * Temporal activation parity tests.
 *
 * The invariants are the ENGINE's (abstractmemory/attention.py, 0018
 * contracts) — not demo-data specifics: rank-distance decay on the
 * activity axis, audit inertness (reading is not using), per-step clamp
 * with floor 0, refocus stretch applied once to older events, TTL expiry
 * on raw rank distance, per-(scope|owner) stream isolation, co_selected
 * crediting pairs only while occupying record-walk slots, and the
 * two-count separation (global never decays; temporal does).
 */

import { describe, expect, it } from "vitest";

import { applyEnvelope, createFoldState, foldEnvelopes } from "./stream_fold";
import {
  computeTemporalActivation,
  ENGINE_DEFAULT_CONFIG,
  eventWeight,
  nodeWarmth,
  pairWarmth,
  pushAttentionEvent,
  type AttentionEventLite,
} from "./temporal_activation";
import type { ReplayEnvelope } from "./stream_types";

function env(partial: Partial<ReplayEnvelope> & { seq: number; family: ReplayEnvelope["family"]; payload: Record<string, unknown> }): ReplayEnvelope {
  return {
    stream: "abstractmemory.replay",
    stream_version: 1,
    observed_at: "2026-07-10T00:00:00+00:00",
    scope: "life",
    owner_id: "entity:test",
    trace_id: null,
    turn_id: null,
    run_id: null,
    ...partial,
  } as ReplayEnvelope;
}

function usage(kind: string, recordId: string | null, seq: number, over: Record<string, unknown> = {}): ReplayEnvelope {
  return env({
    family: "event",
    seq,
    payload: {
      kind,
      scope: "life",
      owner_id: "entity:test",
      record_id: recordId,
      pair_ids: null,
      weight: 0, // journaled default resolution: eventWeight falls back per kind
      matched: true,
      event_id: `e-${seq}`,
      seq,
      ...over,
    },
  });
}

function pair(a: string, b: string, seq: number): ReplayEnvelope {
  return usage("co_selected", null, seq, { pair_ids: [a, b], weight: 4 });
}

describe("temporal activation (engine parity)", () => {
  it("a fresh selection carries its full weight; distance decays it hyperbolically", () => {
    // selected a, then 20 selections of b: a sits at rank 20 in the DESC
    // window -> 8 / (1 + 20/20) = 4.0 (the engine's math block).
    const envelopes = [usage("selected", "a", 1)];
    for (let i = 0; i < 20; i++) envelopes.push(usage("selected", "b", 2 + i));
    const fold = foldEnvelopes(envelopes);
    const t = computeTemporalActivation(fold.attention);
    expect(t.records.get("a")).toBeCloseTo(4.0, 5);
    // b saturates by per-step clamp at the ceiling.
    expect(t.records.get("b")).toBe(ENGINE_DEFAULT_CONFIG.max_activation);
  });

  it("audit kinds never occupy window slots (reading is not using)", () => {
    const base = [usage("selected", "a", 1)];
    for (let i = 0; i < 20; i++) base.push(usage("selected", "b", 2 + i));
    const withAudit = [usage("selected", "a", 1)];
    for (let i = 0; i < 20; i++) {
      // Interleave a flood of listed/shown events between the selections.
      withAudit.push(usage("listed", "a", 100 + i * 3));
      withAudit.push(usage("shown", "b", 101 + i * 3));
      withAudit.push(usage("selected", "b", 102 + i * 3));
    }
    const ta = computeTemporalActivation(foldEnvelopes(base).attention);
    const tb = computeTemporalActivation(foldEnvelopes(withAudit).attention);
    expect(tb.records.get("a")).toBeCloseTo(ta.records.get("a")!, 5);
  });

  it("per-step clamp: repeated selection saturates at max_activation, never beyond", () => {
    const envelopes = Array.from({ length: 10 }, (_, i) => usage("selected", "a", i + 1));
    const t = computeTemporalActivation(foldEnvelopes(envelopes).attention);
    expect(t.records.get("a")).toBe(25.0);
  });

  it("temporal decays while the global count holds — the two-count model", () => {
    const envelopes = [usage("selected", "a", 1), usage("selected", "a", 2), usage("selected", "a", 3)];
    for (let i = 0; i < 300; i++) envelopes.push(usage("selected", `filler-${i}`, 10 + i));
    const fold = foldEnvelopes(envelopes);
    const t = computeTemporalActivation(fold.attention);
    // Global: never decays.
    expect(fold.nodes.get("a")!.selected_count).toBe(3);
    // Temporal: 300 events of distance later, nearly cold.
    // ranks 300..302: 8/(1+300/20) + 8/(1+301/20) + 8/(1+302/20) ~ 1.49
    expect(t.records.get("a")!).toBeLessThan(1.6);
    expect(t.records.get("a")!).toBeGreaterThan(1.3);
  });

  it("refocus stretches the distance of strictly older events, once", () => {
    const envelopes = [
      usage("selected", "a", 1),
      usage("refocus", null, 2),
      ...Array.from({ length: 5 }, (_, i) => usage("selected", "b", 3 + i)),
    ];
    const t = computeTemporalActivation(foldEnvelopes(envelopes).attention);
    // Window DESC: b at ranks 0-4, refocus holds rank 5 (slot, no weight),
    // a at rank 6 stretched x6 -> 8 / (1 + 36/20) = 2.857...
    expect(t.records.get("a")).toBeCloseTo(8 / (1 + 36 / 20), 5);
  });

  it("events past the window contribute nothing (activity cliff, engine semantics)", () => {
    const envelopes = [usage("selected", "a", 1)];
    for (let i = 0; i < 6; i++) envelopes.push(usage("selected", "b", 2 + i));
    const t = computeTemporalActivation(foldEnvelopes(envelopes).attention, {
      ...ENGINE_DEFAULT_CONFIG,
      window_limit: 4,
    });
    expect(t.records.has("a")).toBe(false);
    expect(t.records.get("b")).toBeGreaterThan(0);
  });

  it("ttl-bounded deliberate acts expire by raw rank distance", () => {
    const envelopes = [
      usage("pinned", "a", 1, { weight: 8, ttl_activity: 2 }),
      ...Array.from({ length: 5 }, (_, i) => usage("selected", "b", 2 + i)),
    ];
    const t = computeTemporalActivation(foldEnvelopes(envelopes).attention);
    // The pin sits at rank 5 > ttl 2: contributes 0 (entry exists at 0).
    expect(t.records.get("a")).toBe(0);
  });

  it("silenced contributes negatively with a floor of zero per step", () => {
    const envelopes = [usage("selected", "a", 1), usage("silenced", "a", 2, { weight: 8 })];
    const t = computeTemporalActivation(foldEnvelopes(envelopes).attention);
    // DESC walk: silenced first (0 - 8 -> floor 0), then selected at rank 1:
    // 8 / (1 + 1/20) = 7.619...
    expect(t.records.get("a")).toBeCloseTo(8 / (1 + 1 / 20), 5);
  });

  it("pair trails decay on the same axis and key by the rendered edge key", () => {
    const envelopes = [pair("a", "b", 1), pair("b", "a", 2)];
    const fold = foldEnvelopes(envelopes);
    const t = computeTemporalActivation(fold.attention);
    // Canonical key matches the fold's edge map.
    expect(fold.edges.has("a|b")).toBe(true);
    // Newest at rank 0 (4.0) + older at rank 1 (4/(1+1/20)) — per-step sum.
    expect(t.pairs.get("a|b")).toBeCloseTo(4 + 4 / (1 + 1 / 20), 5);
  });

  it("pair warmth follows a node re-key (graph id -> row id merge)", () => {
    const envelopes: ReplayEnvelope[] = [
      env({
        family: "binding",
        seq: 1,
        payload: {
          record_id: "ex:memory-aaa",
          scope: "life",
          owner_id: "entity:test",
          search_state: "indexed",
          prompt_state: "inactive",
          lifecycle: "none",
          source: "remember",
          reason: null,
          binding_id: "b-1",
          seq: 1,
        },
        display: { record_id: "ex:memory-aaa", kind: "memory", title: "media server" },
      }),
      pair("ex:memory-aaa", "other-row", 2),
      // Title reveal re-keys the graph node under its usage row id.
      usage("selected", "row-1", 3, { weight: 8 }),
    ];
    envelopes[2] = { ...envelopes[2], display: { record_id: "row-1", title: "ex:memory-aaa dcterms:abstract media server runs jellyfin" } };
    const fold = foldEnvelopes(envelopes);
    const t = computeTemporalActivation(fold.attention);
    // The edge re-keyed to (row-1, other-row); warmth must follow.
    const key = [...fold.edges.keys()][0];
    expect(key).toContain("row-1");
    expect(t.pairs.get(key)).toBeGreaterThan(0);
  });

  it("scope streams are isolated: a busy life scope never flushes the self scope", () => {
    const envelopes = [usage("selected", "self-rec", 1, { scope: "self" })];
    for (let i = 0; i < 600; i++) envelopes.push(usage("selected", `life-${i}`, 2 + i, { scope: "life" }));
    const t = computeTemporalActivation(foldEnvelopes(envelopes).attention);
    // In a shared window the self record would have fallen off the cliff
    // (600 > 512); in its own stream it is still at rank 0.
    expect(t.records.get("self-rec")).toBeCloseTo(8.0, 5);
  });

  it("prefix truth: temporal state at scrub T equals the fold of the prefix at T", () => {
    const envelopes = [
      usage("selected", "a", 1),
      usage("selected", "b", 2),
      pair("a", "b", 3),
      usage("selected", "c", 4),
    ];
    const atT = computeTemporalActivation(foldEnvelopes(envelopes, 2).attention);
    expect(atT.records.has("c")).toBe(false);
    expect(atT.pairs.size).toBe(0);
    expect(atT.records.get("b")).toBeCloseTo(8.0, 5);

    // Incremental application matches the batch fold envelope-for-envelope.
    const inc = createFoldState();
    for (const e of envelopes) applyEnvelope(inc, e);
    const a = computeTemporalActivation(inc.attention);
    const b = computeTemporalActivation(foldEnvelopes(envelopes).attention);
    expect([...a.records.entries()].sort()).toEqual([...b.records.entries()].sort());
    expect([...a.pairs.entries()].sort()).toEqual([...b.pairs.entries()].sort());
  });

  it("buffer trim keeps at least the window tail intact", () => {
    const buffers = new Map<string, AttentionEventLite[]>();
    for (let i = 0; i < 20; i++) {
      pushAttentionEvent(buffers, "life|e", { kind: "selected", record_id: `r-${i}`, pair_key: null, weight: 8, ttl_activity: null, seq: i + 1 }, 4);
    }
    const buf = buffers.get("life|e")!;
    expect(buf.length).toBeGreaterThanOrEqual(4);
    // The tail is exactly the most recent events, in order.
    const tail = buf.slice(-4).map((e) => e.record_id);
    expect(tail).toEqual(["r-16", "r-17", "r-18", "r-19"]);
  });

  it("weights: journaled weight wins; zero/absent falls back to the engine default", () => {
    expect(eventWeight("selected", 3.5)).toBe(3.5);
    expect(eventWeight("selected", 0)).toBe(8.0);
    expect(eventWeight("co_selected", undefined)).toBe(4.0);
    expect(eventWeight("silenced", null)).toBe(8.0);
  });

  it("presentation intensities saturate at twice the fresh weight", () => {
    expect(nodeWarmth(0)).toBe(0);
    expect(nodeWarmth(8)).toBeCloseTo(0.5, 5);
    expect(nodeWarmth(16)).toBe(1);
    expect(nodeWarmth(25)).toBe(1);
    expect(pairWarmth(4)).toBeCloseTo(0.5, 5);
    expect(pairWarmth(8)).toBe(1);
  });

  it("tracks the wall-clock moment of the newest attention event (staleness cue)", () => {
    const a = usage("selected", "a", 1);
    const audit = usage("listed", "a", 2);
    (a as { observed_at: string }).observed_at = "2026-07-09T04:40:09+00:00";
    (audit as { observed_at: string }).observed_at = "2026-07-10T09:00:00+00:00";
    const fold = foldEnvelopes([a, audit]);
    // Audit reads are not attention: the anchor stays at the last SELECTION.
    expect(fold.last_attention_at).toBe("2026-07-09T04:40:09+00:00");
  });

  it("keys align with the fold on a REAL engine export (demo life)", async () => {
    // The render joins temporal maps to fold nodes/edges by id — a key
    // mismatch silently renders everything cold. Pin against the genuine
    // engine export, not hand-written fixtures.
    const fs = await import("node:fs");
    const { parseNdjson } = await import("./stream_source");
    const path = new URL("../../public/demo/castor.ndjson", import.meta.url).pathname;
    const { envelopes } = parseNdjson(fs.readFileSync(path, "utf-8"));
    const fold = foldEnvelopes(envelopes);
    const t = computeTemporalActivation(fold.attention);
    expect(t.records.size).toBeGreaterThan(0);
    for (const rid of t.records.keys()) {
      expect(fold.nodes.has(rid)).toBe(true);
    }
    for (const key of t.pairs.keys()) {
      expect(fold.edges.has(key)).toBe(true);
    }
    // The demo life ends with recent activity: something must be warm.
    const warm = [...t.records.values()].filter((a) => a > 0.8);
    expect(warm.length).toBeGreaterThan(0);
  });
});
