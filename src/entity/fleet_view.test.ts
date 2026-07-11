/**
 * Fleet tile contract tests: the wall is presentation over N independent
 * folds, and each tile's facts must agree with what the single view would
 * say about the same stream (no second derivation drifting).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { summarize } from "./fleet_view";
import { foldEnvelopes } from "./stream_fold";
import { parseNdjson } from "./stream_source";

describe("fleet tile summary", () => {
  it("derives tile facts from the demo life exactly as the single view does", () => {
    const path = new URL("../../public/demo/castor.ndjson", import.meta.url).pathname;
    const { envelopes, errors } = parseNdjson(readFileSync(path, "utf-8"));
    expect(errors).toHaveLength(0);
    const fold = foldEnvelopes(envelopes);
    const s = summarize(fold);
    // Diary is its own count, never inflating "memories"; engine acts
    // (engram + reembed bookkeeping) are excluded from both.
    const diary = [...fold.nodes.values()].filter((n) => n.diary).length;
    const bookkeeping = [...fold.nodes.values()].filter((n) => n.bookkeeping).length;
    expect(s.diary).toBe(diary);
    expect(s.memories).toBe(fold.nodes.size - diary - bookkeeping);
    // Session boundary rule identical to the header: host summons vs
    // inferred run boundaries, whichever is larger (honest, never zero
    // for a home-direct life).
    const summons = fold.sessions.filter((m) => m.kind === "summon").length;
    expect(s.sessions).toBe(Math.max(summons, fold.inferred_sessions.length));
    expect(s.feelings).toBe(fold.standings.size);
  });
});
