/**
 * Headless fold digest — the observer's read-only arbiter for the item-10
 * A/B harness (ChatSession vs visit workflow on one fixture home).
 *
 * Folds an exported replay stream through the SHIPPED view code (the same
 * fold the entity page renders — never a re-implementation) and prints a
 * deterministic JSON digest of what a reader would SEE: session count,
 * nodes by kind, D2 (identity use counts), diary/election counts,
 * structural-edge relations, standings, bookkeeping acts.
 *
 * Usage:
 *   npx vite-node scripts/fold_digest.ts <export.ndjson>
 * A/B:
 *   npx vite-node scripts/fold_digest.ts arm_a.ndjson > a.json
 *   npx vite-node scripts/fold_digest.ts arm_b.ndjson > b.json
 *   diff a.json b.json   # pixel-plane equivalence, one command
 *
 * Pure read: consumes an export file, writes stdout, touches nothing.
 */

import { readFileSync } from "node:fs";

import { foldEnvelopes } from "../src/entity/stream_fold";
import { parseNdjson } from "../src/entity/stream_source";

const IDENTITY_KINDS = new Set(["value", "purpose", "trait", "claim"]);

function sortedCount<T>(items: Iterable<T>, keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = keyOf(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npx vite-node scripts/fold_digest.ts <export.ndjson>");
    process.exit(2);
  }
  const { envelopes, errors } = parseNdjson(readFileSync(path, "utf-8"));
  const fold = foldEnvelopes(envelopes);

  const nodes = [...fold.nodes.values()];
  const identity = nodes.filter((n) => !n.bookkeeping && !n.diary && IDENTITY_KINDS.has(n.kind));

  const digest = {
    envelopes: envelopes.length,
    parse_errors: errors.length,
    // Sessions: host summons when markers exist, else run_id inference —
    // the same "honest boundary" rule the header uses.
    sessions: {
      summons: fold.sessions.filter((s) => s.kind === "summon").length,
      closed: fold.sessions.filter((s) => s.kind === "session_closed").length,
      inferred_runs: fold.inferred_sessions.length,
      host_marker_kinds: sortedCount(fold.sessions, (s) => s.kind),
    },
    nodes_by_kind: sortedCount(nodes, (n) => (n.diary ? "diary" : n.bookkeeping ? `bookkeeping${n.maintenance ? `:${n.maintenance}` : ""}` : n.kind)),
    // D2 / presence-not-use: every identity record's lifetime use count.
    // Equal arms MUST produce equal maps (criterion 1's pixel twin).
    identity_use_counts: Object.fromEntries(
      identity.map((n) => [n.title || n.graph_id || n.id, n.selected_count]).sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
    diary: {
      entries: nodes.filter((n) => n.diary).length,
      redacted: nodes.filter((n) => n.diary && n.redacted).length,
    },
    structural_edges_by_relation: sortedCount(fold.structural_edges.values(), (e) => e.relation),
    co_use_edges: fold.edges.size,
    co_use_total: [...fold.edges.values()].reduce((acc, e) => acc + e.count, 0),
    standings: Object.fromEntries(
      [...fold.standings.values()]
        .map((s) => [s.target_id, { positive: s.positive, negative: s.negative, scars: s.scars.length, bonds: s.bonds.length }])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
    beats: { recalls: fold.beats.size, committed: [...fold.beats.values()].filter((b) => b.committed).length },
    closures: nodes.filter((n) => n.closed).length,
    // Interaction correlation (item 14): episodes grouped by the engraved
    // visit_id — for a two-legged moment, run the digest on BOTH homes'
    // exports and the same key must appear in each (correlate as data;
    // never a merged stream). Requires the display visit_id delta from
    // memory; absent until then (absent = nothing claimed, never zero).
    visit_ids: sortedCount(
      nodes.filter((n) => n.visit_id),
      (n) => n.visit_id as string,
    ),
  };

  console.log(JSON.stringify(digest, null, 2));
}

main();
