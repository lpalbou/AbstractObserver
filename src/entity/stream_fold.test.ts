/**
 * Fold contract tests.
 *
 * The invariants under test are general stream-consumer properties, not
 * demo-data specifics: prefix-fold truthfulness (state at T is the fold of
 * envelopes with seq <= T), determinism (same prefix twice = same state),
 * duplicate-delivery tolerance (SSE reconnect overlap), dual-channel
 * standing accumulation, standing peak resolution, belief closure, diary
 * redaction, and beat grouping by envelope-level correlation keys.
 */

import { describe, expect, it } from "vitest";

import { foldEnvelopes, foldUpToIndex, createFoldState, applyEnvelope, type FoldCache } from "./stream_fold";
import { ledgerLine } from "./ledger_lines";
import { parseNdjson } from "./stream_source";
import type { ReplayEnvelope } from "./stream_types";

let autoSeq = 0;

function env(partial: Partial<ReplayEnvelope> & { family: ReplayEnvelope["family"]; payload: Record<string, unknown> }): ReplayEnvelope {
  autoSeq += 1;
  return {
    stream: "abstractmemory.replay",
    stream_version: 1,
    seq: partial.seq ?? autoSeq,
    observed_at: "2026-07-07T00:00:00+00:00",
    scope: "life",
    owner_id: "entity:test",
    trace_id: null,
    turn_id: null,
    run_id: null,
    ...partial,
  } as ReplayEnvelope;
}

function bindingEnv(recordId: string, seq: number, over: Record<string, unknown> = {}, display?: Record<string, unknown>): ReplayEnvelope {
  return env({
    family: "binding",
    seq,
    payload: {
      record_id: recordId,
      scope: "life",
      owner_id: "entity:test",
      search_state: "indexed",
      prompt_state: "inactive",
      lifecycle: "none",
      source: "remember",
      reason: null,
      binding_id: `b-${seq}`,
      seq,
      ...over,
    },
    display: display as ReplayEnvelope["display"],
  });
}

function selectedEnv(recordId: string, seq: number, display?: Record<string, unknown>): ReplayEnvelope {
  return env({
    family: "event",
    seq,
    payload: { kind: "selected", scope: "life", owner_id: "entity:test", record_id: recordId, pair_ids: null, weight: 8, matched: true, event_id: `e-${seq}`, seq },
    display: display as ReplayEnvelope["display"],
  });
}

describe("stream fold", () => {
  it("creates a node on its first binding and applies enrichment", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:memory-aaa", 1, {}, { record_id: "ex:memory-aaa", kind: "memory", title: "media server", token_estimate: 12 }),
    ]);
    expect(fold.nodes.size).toBe(1);
    const node = fold.nodes.get("ex:memory-aaa")!;
    expect(node.title).toBe("media server");
    expect(node.kind).toBe("memory");
    expect(node.first_seq).toBe(1);
  });

  it("merges the binding's graph-id node with the usage row id via display title", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:memory-aaa", 1, {}, { record_id: "ex:memory-aaa", kind: "memory", title: "media server", token_estimate: 12 }),
      selectedEnv("row-1", 2, { record_id: "row-1", kind: "memory", title: "ex:memory-aaa dcterms:abstract media server runs jellyfin" }),
    ]);
    // One node, keyed by the row id, carrying the graph id and the count.
    expect(fold.nodes.size).toBe(1);
    const node = fold.nodes.get("row-1")!;
    expect(node.graph_id).toBe("ex:memory-aaa");
    expect(node.selected_count).toBe(1);
    expect(node.title).toBe("media server");
    expect(fold.graph_to_row.get("ex:memory-aaa")).toBe("row-1");
  });

  it("the global count never decays and edges accumulate co-use", () => {
    const envelopes: ReplayEnvelope[] = [
      selectedEnv("a", 1),
      selectedEnv("a", 2),
      env({ family: "event", seq: 3, payload: { kind: "co_selected", scope: "life", owner_id: "e", record_id: null, pair_ids: ["a", "b"], weight: 4, event_id: "e-3", seq: 3 } }),
      env({ family: "event", seq: 4, payload: { kind: "co_selected", scope: "life", owner_id: "e", record_id: null, pair_ids: ["b", "a"], weight: 4, event_id: "e-4", seq: 4 } }),
    ];
    const fold = foldEnvelopes(envelopes);
    expect(fold.nodes.get("a")!.selected_count).toBe(2);
    expect(fold.edges.size).toBe(1); // canonical pair key: (a,b) == (b,a)
    expect(fold.edges.get("a|b")!.count).toBe(2);
  });

  it("scrub truth: state at T is the fold of the prefix at T", () => {
    const envelopes = [selectedEnv("a", 1), selectedEnv("a", 5), selectedEnv("a", 9)];
    expect(foldEnvelopes(envelopes, 4).nodes.get("a")!.selected_count).toBe(1);
    expect(foldEnvelopes(envelopes, 5).nodes.get("a")!.selected_count).toBe(2);
    expect(foldEnvelopes(envelopes, Infinity).nodes.get("a")!.selected_count).toBe(3);
  });

  it("is deterministic: folding the same prefix twice gives identical state", () => {
    const envelopes = [
      bindingEnv("ex:memory-aaa", 1, {}, { record_id: "ex:memory-aaa", kind: "memory", title: "m" }),
      selectedEnv("row-1", 2, { record_id: "row-1", title: "ex:memory-aaa dcterms:abstract m" }),
      env({ family: "valence", seq: 3, payload: { target_id: "tool:x", sign: 1, magnitude: 2, kind: "appraisal", scope: "self", owner_id: "e", reason: "ok", actor: "runtime", provenance: {}, event_id: "v-1", seq: 3 } }),
    ];
    const a = foldEnvelopes(envelopes);
    const b = foldEnvelopes(envelopes);
    expect(JSON.stringify([...a.nodes.entries()])).toBe(JSON.stringify([...b.nodes.entries()]));
    expect(JSON.stringify([...a.standings.entries()])).toBe(JSON.stringify([...b.standings.entries()]));
  });

  it("ignores duplicate seq delivery (SSE reconnect overlap)", () => {
    const state = createFoldState();
    const e1 = selectedEnv("a", 1);
    applyEnvelope(state, e1);
    applyEnvelope(state, e1); // duplicate
    expect(state.nodes.get("a")!.selected_count).toBe(1);
    expect(state.applied_count).toBe(1);
  });

  it("accumulates dual-channel standing: both channels stay visible", () => {
    const appraise = (seq: number, sign: number, magnitude: number) =>
      env({ family: "valence", seq, payload: { target_id: "tool:dns", sign, magnitude, kind: "appraisal", scope: "self", owner_id: "e", reason: "r", actor: "runtime", provenance: {}, event_id: `v-${seq}`, seq } });
    const fold = foldEnvelopes([appraise(1, 1, 1), appraise(2, 1, 1), appraise(3, -1, 10)]);
    const s = fold.standings.get("tool:dns")!;
    expect(s.positive).toBe(2);
    expect(s.negative).toBe(10);
    expect(s.positive_count).toBe(2);
    expect(s.negative_count).toBe(1);
  });

  it("scars stand until healed; healing resolves by event id", () => {
    const scar = env({ family: "valence", seq: 1, payload: { target_id: "tool:dns", sign: -1, magnitude: 8, kind: "scar", scope: "self", owner_id: "e", reason: "outage", actor: "entity-reflection", provenance: {}, event_id: "scar-1", seq: 1 } });
    const heal = env({ family: "valence", seq: 2, payload: { target_id: "tool:dns", sign: 1, magnitude: 8, kind: "healing", scope: "self", owner_id: "e", reason: "lesson", actor: "entity-reflection", provenance: { heals: "scar-1" }, event_id: "heal-1", seq: 2 } });
    const mid = foldEnvelopes([scar, heal], 1);
    expect(mid.standings.get("tool:dns")!.scars).toHaveLength(1);
    const done = foldEnvelopes([scar, heal], 2);
    expect(done.standings.get("tool:dns")!.scars).toHaveLength(0);
    expect(done.standings.get("tool:dns")!.healed_count).toBe(1);
  });

  it("closures ghost the belief with kind, reason, and replacements", () => {
    const fold = foldEnvelopes([
      selectedEnv("row-1", 1, { record_id: "row-1", kind: "memory", title: "dns" }),
      env({
        family: "closure",
        seq: 2,
        payload: { assertion_id: "row-1", kind: "supersede", reason: "migrated", replacement_ids: ["ex:memory-new"], closure_id: "c-1", seq: 2 },
        display: { record_id: "row-1", kind: "memory", title: "dns" },
      }),
    ]);
    const node = fold.nodes.get("row-1")!;
    expect(node.closed).not.toBeNull();
    expect(node.closed!.kind).toBe("supersede");
    expect(node.closed!.replacement_ids).toEqual(["ex:memory-new"]);
  });

  it("diary records stay content-free with DISTINCT act-only labels", () => {
    // Identical "diary entry" labels made distinct entries read as
    // duplicates (maintainer concern (d)); labels now carry date + id tail
    // — act metadata only, never content.
    const fold = foldEnvelopes([
      bindingEnv("ex:diary-abc123", 1, {}, { redacted: "diary" }),
      bindingEnv("ex:diary-def456", 2, {}, { redacted: "diary" }),
    ]);
    const a = fold.nodes.get("ex:diary-abc123")!;
    const b = fold.nodes.get("ex:diary-def456")!;
    expect(a.diary).toBe(true);
    expect(a.redacted).toBe(true);
    expect(a.title.startsWith("diary")).toBe(true);
    expect(a.title).toContain("#abc123");
    expect(b.title).toContain("#def456");
    expect(a.title).not.toBe(b.title);
  });

  it("groups a trace and its snapshot into one beat with admissions", () => {
    const fold = foldEnvelopes([
      env({
        family: "trace",
        seq: 1,
        trace_id: "t-1",
        payload: {
          trace_id: "t-1",
          trace_kind: "reconstruct",
          need: { cue_text: "the media server", turn_id: "turn-7", view: "working_set" },
          searched_scopes: [],
          channels: ["keyword"],
          candidates: [{ record_id: "a", scores: {} }, { record_id: "b", scores: {} }],
          selected: ["a"],
          dropped: [{ record_id: "b", score: 0, reason: "below_shelf" }],
          cues: [],
          stop_reason: "enough",
          warnings: [],
          admissions: { a: "self" },
          seq: 1,
        },
      }),
      env({
        family: "snapshot",
        seq: 2,
        trace_id: "t-1",
        payload: { snapshot_id: "s-1", trace_id: "t-1", used_record_ids: ["a"], display: [], prompt_token_estimate: 99, seq: 2 },
      }),
    ]);
    expect(fold.beats.size).toBe(1);
    const beat = fold.beats.get("t-1")!;
    expect(beat.cue_text).toBe("the media server");
    expect(beat.turn_id).toBe("turn-7");
    expect(beat.admissions).toEqual({ a: "self" });
    expect(beat.committed).toBe(true);
    expect(beat.used_record_ids).toEqual(["a"]);
    expect(beat.dropped[0].reason).toBe("below_shelf");
  });

  it("joins namespaces via display.graph_id first-class (0005 memory delta)", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:memory-aaa", 1, {}, { record_id: "ex:memory-aaa", kind: "memory", title: "media server", graph_id: "ex:memory-aaa" }),
      // Clean title, no canonical-text prefix — only graph_id can join.
      selectedEnv("row-1", 2, { record_id: "row-1", kind: "memory", title: "media server", graph_id: "ex:memory-aaa" }),
    ]);
    expect(fold.nodes.size).toBe(1);
    const node = fold.nodes.get("row-1")!;
    expect(node.graph_id).toBe("ex:memory-aaa");
    expect(node.selected_count).toBe(1);
    expect(fold.graph_to_row.get("ex:memory-aaa")).toBe("row-1");
  });

  it("maps co_selected edge members onto their SOURCE node and drops self-pairs", () => {
    // Formation order: source binding -> source used -> hop pairs
    // (source|edge) and (edge|target). Edge rows carry the SOURCE's
    // graph_id by construction (memory, 0005 052948Z).
    const sourceBinding = bindingEnv("ex:memory-src", 1, {}, { record_id: "ex:memory-src", kind: "memory", title: "reverse proxy", graph_id: "ex:memory-src" });
    const targetBinding = bindingEnv("ex:memory-tgt", 2, {}, { record_id: "ex:memory-tgt", kind: "memory", title: "media server", graph_id: "ex:memory-tgt" });
    const srcUsed = selectedEnv("row-src", 3, { record_id: "row-src", kind: "memory", title: "reverse proxy", graph_id: "ex:memory-src" });
    const tgtUsed = selectedEnv("row-tgt", 4, { record_id: "row-tgt", kind: "memory", title: "media server", graph_id: "ex:memory-tgt" });
    const hop1 = env({
      family: "event",
      seq: 5,
      payload: { kind: "co_selected", scope: "life", owner_id: "e", record_id: null, pair_ids: ["row-src", "row-edge"], weight: 4, event_id: "e-5", seq: 5 },
      display: {
        pair: [
          { record_id: "row-src", kind: "memory", title: "reverse proxy", graph_id: "ex:memory-src" },
          { record_id: "row-edge", kind: "memory", title: "ex:memory-src routes_to", graph_id: "ex:memory-src" },
        ],
      },
    });
    const hop2 = env({
      family: "event",
      seq: 6,
      payload: { kind: "co_selected", scope: "life", owner_id: "e", record_id: null, pair_ids: ["row-edge", "row-tgt"], weight: 4, event_id: "e-6", seq: 6 },
      display: {
        pair: [
          { record_id: "row-edge", kind: "memory", title: "ex:memory-src routes_to", graph_id: "ex:memory-src" },
          { record_id: "row-tgt", kind: "memory", title: "media server", graph_id: "ex:memory-tgt" },
        ],
      },
    });
    const fold = foldEnvelopes([sourceBinding, targetBinding, srcUsed, tgtUsed, hop1, hop2]);
    // hop1 collapses to source<->source (dropped); hop2 becomes the real
    // source<->target association between endpoint nodes.
    expect(fold.edges.size).toBe(1);
    const edge = [...fold.edges.values()][0];
    expect(new Set([edge.a, edge.b])).toEqual(new Set(["row-src", "row-tgt"]));
    // No standalone relation node was minted for the merged edge row.
    expect(fold.nodes.has("row-edge")).toBe(false);
  });

  it("diary display blocks with graph_id stay redacted and join by graph id", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:diary-abc", 1, {}, { redacted: "diary", graph_id: "ex:diary-abc" }),
      selectedEnv("row-9", 2, { redacted: "diary", graph_id: "ex:diary-abc" }),
    ]);
    expect(fold.nodes.size).toBe(1);
    const node = fold.nodes.get("row-9")!;
    expect(node.diary).toBe(true);
    expect(node.redacted).toBe(true);
    expect(node.title.startsWith("diary")).toBe(true);
    expect(node.title).toContain("#abc");
    expect(node.selected_count).toBe(1);
  });

  it("folds formation-time display edges as structural topology (0007 ask 2)", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:memory-src", 1, {}, {
        record_id: "ex:memory-src",
        kind: "episode",
        title: "second exchange",
        graph_id: "ex:memory-src",
        edges: [{ relation: "continues", target_graph_id: "ex:memory-prev" }],
      }),
    ]);
    expect(fold.structural_edges.size).toBe(1);
    const se = [...fold.structural_edges.values()][0];
    expect(se.relation).toBe("continues");
    expect(se.source_graph_id).toBe("ex:memory-src");
    expect(se.target_graph_id).toBe("ex:memory-prev");
    // Re-fold determinism holds with structural edges present.
    const again = foldEnvelopes([
      bindingEnv("ex:memory-src", 1, {}, {
        record_id: "ex:memory-src",
        kind: "episode",
        title: "second exchange",
        graph_id: "ex:memory-src",
        edges: [{ relation: "continues", target_graph_id: "ex:memory-prev" }],
      }),
    ]);
    expect(JSON.stringify([...again.structural_edges.entries()])).toBe(JSON.stringify([...fold.structural_edges.entries()]));
  });

  it("records host markers as session moments (fractional seqs preserved)", () => {
    const fold = foldEnvelopes([
      env({ family: "host", seq: 13.001, payload: { kind: "summon", session_id: "s-1" } }),
      selectedEnv("a", 14),
    ]);
    expect(fold.sessions).toHaveLength(1);
    expect(fold.sessions[0].kind).toBe("summon");
    expect(fold.sessions[0].seq).toBe(13.001);
    expect(fold.seq).toBe(14);
  });
});

describe("incremental fold cache", () => {
  function snapshot(state: ReturnType<typeof createFoldState>): string {
    return JSON.stringify({
      nodes: [...state.nodes.entries()],
      edges: [...state.edges.entries()],
      standings: [...state.standings.entries()],
      sessions: state.sessions,
      inferred: state.inferred_sessions,
      seq: state.seq,
    });
  }

  function life(): ReplayEnvelope[] {
    return [
      bindingEnv("ex:memory-a", 1, {}, { record_id: "ex:memory-a", kind: "memory", title: "a", graph_id: "ex:memory-a" }),
      env({ family: "host", seq: 1.001, payload: { kind: "summon", session_id: "s1" } }),
      selectedEnv("row-a", 2, { record_id: "row-a", kind: "memory", title: "a", graph_id: "ex:memory-a" }),
      env({ family: "valence", seq: 3, run_id: "run-1", payload: { target_id: "tool:x", sign: 1, magnitude: 2, kind: "appraisal", scope: "self", owner_id: "e", reason: "ok", actor: "runtime", provenance: {}, event_id: "v-1", seq: 3 } }),
      selectedEnv("row-a", 4, { record_id: "row-a", kind: "memory", title: "a", graph_id: "ex:memory-a" }),
      env({ family: "valence", seq: 5, run_id: "run-2", payload: { target_id: "tool:x", sign: -1, magnitude: 1, kind: "appraisal", scope: "self", owner_id: "e", reason: "meh", actor: "runtime", provenance: {}, event_id: "v-2", seq: 5 } }),
    ];
  }

  it("forward extension equals a full refold at every prefix", () => {
    const envelopes = life();
    let cache: FoldCache | null = null;
    for (let i = 0; i < envelopes.length; i++) {
      cache = foldUpToIndex(envelopes, i, cache);
      expect(snapshot(cache.state)).toBe(snapshot(foldEnvelopes(envelopes, envelopes[i].seq)));
    }
  });

  it("live appends (new array identity) extend without a rebuild", () => {
    const envelopes = life();
    let cache = foldUpToIndex(envelopes.slice(0, 4), 3, null);
    const stateBefore = cache.state;
    const extended = [...envelopes.slice(0, 4), envelopes[4]]; // new identity, pure extension
    cache = foldUpToIndex(extended, 4, cache);
    expect(cache.state).toBe(stateBefore); // extended in place, not rebuilt
    expect(snapshot(cache.state)).toBe(snapshot(foldEnvelopes(envelopes, envelopes[4].seq)));
  });

  it("backward scrub rebuilds the truthful prefix", () => {
    const envelopes = life();
    let cache = foldUpToIndex(envelopes, envelopes.length - 1, null);
    cache = foldUpToIndex(envelopes, 2, cache);
    expect(snapshot(cache.state)).toBe(snapshot(foldEnvelopes(envelopes, envelopes[2].seq)));
  });

  it("source replacement (different first seq) invalidates the cache", () => {
    const envelopes = life();
    let cache = foldUpToIndex(envelopes, 3, null);
    const other = [selectedEnv("row-z", 10, { record_id: "row-z", kind: "memory", title: "z" })];
    cache = foldUpToIndex(other, 0, cache);
    expect(snapshot(cache.state)).toBe(snapshot(foldEnvelopes(other, 10)));
  });

  it("infers session boundaries from run_id changes", () => {
    const fold = foldEnvelopes(life());
    expect(fold.inferred_sessions.map((s) => s.run_id)).toEqual(["run-1", "run-2"]);
    expect(fold.sessions).toHaveLength(1); // the host summon stays separate
  });
});

describe("ledger lines", () => {
  it("phrases a recall with the WHY in human words", () => {
    const line = ledgerLine(
      env({
        family: "trace",
        seq: 1,
        payload: {
          trace_id: "t",
          trace_kind: "reconstruct",
          need: { cue_text: "backups" },
          candidates: [{ record_id: "a", scores: {} }],
          selected: ["a", "b", "c"],
          dropped: [],
          admissions: { a: "self", b: "stm", c: "both" },
          searched_scopes: [],
          channels: [],
          cues: [],
          stop_reason: "enough",
          warnings: [],
          seq: 1,
        },
      }),
    );
    expect(line.title).toContain("backups");
    expect(line.detail).toContain("1 present by right");
    expect(line.detail).toContain("1 from continuity");
    expect(line.detail).toContain("1 matched");
  });

  it("never leaks diary content through display blocks", () => {
    const line = ledgerLine(
      env({
        family: "event",
        seq: 1,
        payload: { kind: "selected", scope: "diary", owner_id: "e", record_id: "row-9", pair_ids: null, weight: 8, event_id: "e", seq: 1 },
        display: { redacted: "diary" },
      }),
    );
    expect(line.detail).toContain("a diary entry");
    expect(line.detail).toContain("content private");
  });

  it("phrases summon markers as session moments", () => {
    const line = ledgerLine(env({ family: "host", seq: 1.001, payload: { kind: "summon", session_id: "abc" } }));
    expect(line.title).toBe("Summoned");
    expect(line.tone).toBe("session");
  });

  it("names the reembed host marker with the space change (item 3 visibility)", () => {
    // The SHIPPED gateway marker shape: old_pin/new_pin objects.
    const line = ledgerLine(
      env({
        family: "host",
        seq: 2.001,
        payload: {
          kind: "reembed",
          session_id: null,
          old_pin: { model_id: "qwen3-embedding-0.6b", dimension: 1024 },
          new_pin: { model_id: "qwen3-embedding-4b", dimension: 2560 },
          reason: "operator reembed",
        },
      }),
    );
    expect(line.title).toContain("Reembed");
    expect(line.detail).toContain("qwen3-embedding-0.6b (1024d) → qwen3-embedding-4b (2560d)");
    expect(line.tone).toBe("session");
  });

  it("tolerates the flat old/new model-id marker shape (older exports)", () => {
    const line = ledgerLine(
      env({
        family: "host",
        seq: 3.001,
        payload: { kind: "reembed", session_id: null, old_model_id: "a", new_model_id: "b" },
      }),
    );
    expect(line.detail).toContain("a → b");
  });

  it("phrases observation grant/revoke markers with the DECLARED payload keys (0017 pin 2)", () => {
    const granted = ledgerLine(
      env({
        family: "host",
        seq: 4.001,
        payload: {
          kind: "observation_granted",
          session_id: null,
          grantee: "person:laurent",
          granted_by: "entity:castor",
          scope: ["replay", "live"],
          reason: "he asked to watch",
        },
      }),
    );
    expect(granted.title).toContain("watch");
    expect(granted.detail).toContain("person:laurent");
    expect(granted.detail).toContain("replay, live");
    expect(granted.detail).toContain("granted by entity:castor");
    const revoked = ledgerLine(
      env({ family: "host", seq: 5.001, payload: { kind: "observation_revoked", session_id: null, grantee: "person:x", granted_by: "operator" } }),
    );
    expect(revoked.title).toContain("observation ended");
    expect(revoked.detail).toContain("revoked by operator");
  });

  it("phrases the reembed journal marker as an engine act, not a memory", () => {
    const line = ledgerLine(
      bindingEnv("ex:claim-re1", 3, {}, {
        record_id: "ex:claim-re1",
        kind: "claim",
        title: "reembed: embedding space migrated",
      }),
    );
    expect(line.title).toContain("Retrieval geometry changed");
    expect(line.tone).toBe("session");
  });

  it("phrases the engram marker as the spark being planted", () => {
    const line = ledgerLine(
      bindingEnv("ex:claim-eng", 4, {}, { record_id: "ex:claim-eng", kind: "claim", title: "spark-engram v1" }),
    );
    expect(line.title).toContain("spark was engrammed");
    expect(line.tone).toBe("session");
  });
});

describe("bookkeeping markers (plan item 3, observer half)", () => {
  it("classifies the reembed marker off the identity set via title convention", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:claim-re1", 1, {}, { record_id: "ex:claim-re1", kind: "claim", title: "reembed: embedding space migrated" }),
    ]);
    const node = fold.nodes.get("ex:claim-re1")!;
    expect(node.kind).toBe("claim");
    expect(node.bookkeeping).toBe(true);
    expect(node.maintenance).toBe("reembed");
  });

  it("classifies via explicit display fields when the stream carries them", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:claim-x", 1, {}, { record_id: "ex:claim-x", kind: "claim", title: "anything", bookkeeping: true, maintenance: "reembed" }),
    ]);
    const node = fold.nodes.get("ex:claim-x")!;
    expect(node.bookkeeping).toBe(true);
    expect(node.maintenance).toBe("reembed");
  });

  it("classifies the engram marker as bookkeeping without a maintenance act", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:claim-eng", 1, {}, { record_id: "ex:claim-eng", kind: "claim", title: "spark-engram v1" }),
    ]);
    const node = fold.nodes.get("ex:claim-eng")!;
    expect(node.bookkeeping).toBe(true);
    expect(node.maintenance).toBeNull();
  });

  it("never flags an ordinary identity claim as bookkeeping", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:claim-id", 1, {}, { record_id: "ex:claim-id", kind: "claim", title: "I keep my promises" }),
    ]);
    const node = fold.nodes.get("ex:claim-id")!;
    expect(node.bookkeeping).toBe(false);
    expect(node.maintenance).toBeNull();
  });

  it("folds the interaction correlation key from the display delta (item 14)", () => {
    const fold = foldEnvelopes([
      bindingEnv("ex:episode-leg", 1, {}, { record_id: "ex:episode-leg", kind: "episode", title: "a shared moment", visit_id: "visit-abc123" }),
      bindingEnv("ex:episode-solo", 2, {}, { record_id: "ex:episode-solo", kind: "episode", title: "a solo moment" }),
    ]);
    expect(fold.nodes.get("ex:episode-leg")!.visit_id).toBe("visit-abc123");
    // ABSENT stays absent: a solo visit fakes no correlation.
    expect(fold.nodes.get("ex:episode-solo")!.visit_id).toBeNull();
  });

  it("classifies the REAL engine output in the demo life (both planes of the act)", async () => {
    // The demo NDJSON is a genuine engine export (export_demo_entity.py runs
    // a real reembed_store over a real home) — this pins the classifier
    // against engine-authored shapes, not hand-written fixtures.
    const fs = await import("node:fs");
    const path = new URL("../../public/demo/castor.ndjson", import.meta.url).pathname;
    const { envelopes, errors } = parseNdjson(fs.readFileSync(path, "utf-8"));
    expect(errors).toHaveLength(0);
    const fold = foldEnvelopes(envelopes);
    const reembedNodes = [...fold.nodes.values()].filter((n) => n.maintenance === "reembed");
    expect(reembedNodes).toHaveLength(1);
    expect(reembedNodes[0].bookkeeping).toBe(true);
    const engramNodes = [...fold.nodes.values()].filter((n) => n.bookkeeping && n.maintenance === null);
    expect(engramNodes.length).toBeGreaterThanOrEqual(1); // the spark-engram marker
    // The door's half: the host reembed marker is in the session stream.
    expect(fold.sessions.some((s) => s.kind === "reembed")).toBe(true);
    // No real identity record got swept into bookkeeping: values/purposes/
    // traits from the spark stay clean.
    for (const n of fold.nodes.values()) {
      if (["value", "purpose", "trait"].includes(n.kind)) expect(n.bookkeeping).toBe(false);
    }
  });
});

describe("ndjson parsing", () => {
  it("parses valid lines and surfaces bad ones", () => {
    const text = `${JSON.stringify(selectedEnv("a", 1))}\nnot json\n${JSON.stringify(selectedEnv("b", 2))}\n`;
    const { envelopes, errors } = parseNdjson(text);
    expect(envelopes).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });
});
