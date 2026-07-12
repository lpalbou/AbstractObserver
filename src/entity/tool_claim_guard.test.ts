import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { detectLookupClaims, TOOL_NAMES, toolClaimVerdict } from "./tool_claim_guard";

describe("toolClaimVerdict — fabricated lookups flagged, honest recall spared (seq 43 FAILURE 1)", () => {
  it("flags the live-session fetch claim from the actual visit", () => {
    // Near-verbatim shape from chat-08534d3ae2a0 t-0005: liveness claimed,
    // zero tools ran.
    const v = toolClaimVerdict(
      "Here is the World-State Report. The feed was fetched live during this session, so the headlines are current.",
      [],
    );
    expect(v.fabricated).toBe(true);
    expect(v.claims[0]?.rule).toBe("live_fetch");
  });

  it("flags first-person lookup claims against an empty tool record", () => {
    const v = toolClaimVerdict("I searched the web for the latest fusion results and summarized them below.", []);
    expect(v.fabricated).toBe(true);
    expect(v.claims[0]?.rule).toBe("first_person_lookup");
  });

  it("flags prose claims of running a real tool by name", () => {
    const v = toolClaimVerdict("I used web_search to confirm the dates before answering.", []);
    expect(v.fabricated).toBe(true);
    expect(v.claims[0]?.rule).toBe("tool_name_prose");
  });

  it("flags fetch_url prose claims (the stale-list miss this fix closes)", () => {
    // fetch_url was absent from the old TOOL_NAMES: this exact claim used
    // to pass silently against a zero-tools turn.
    const v = toolClaimVerdict("I called fetch_url on the article and read the whole thing.", []);
    expect(v.fabricated).toBe(true);
    expect(v.claims[0]?.rule).toBe("tool_name_prose");
  });

  it("flags hallucinated tool names when the sentence claims a tool ran", () => {
    // diary_search never existed; a zero-tools turn claiming ANY tool ran
    // is fabrication regardless of whether the named tool exists. The
    // generic pattern requires the explicit "tool" noun to stay
    // conservative.
    const v = toolClaimVerdict("I ran the diary_search tool to check my entries.", []);
    expect(v.fabricated).toBe(true);
    expect(v.claims[0]?.rule).toBe("tool_name_prose");
    // Without the "tool" noun an unknown name abstains (conservative).
    expect(toolClaimVerdict("I used diary_search to check.", []).fabricated).toBe(false);
    // The noun alone never flags ordinary prose.
    expect(toolClaimVerdict("I used caution when answering.", []).fabricated).toBe(false);
  });

  it("never flags a turn where tools actually ran", () => {
    const v = toolClaimVerdict("I searched the web and here is what came back.", ["web_search"]);
    expect(v.fabricated).toBe(false);
    expect(v.claims).toHaveLength(0);
  });

  it("does NOT flag named-source citations without a liveness claim (honest recall)", () => {
    // A headline honestly recalled from a memory formed by an earlier real
    // lookup cites its source without claiming a live fetch.
    const v = toolClaimVerdict("According to Reuters, the summit ended without an agreement.", []);
    expect(v.fabricated).toBe(false);
  });

  it("does NOT flag hypothetical or second-person phrasing", () => {
    expect(toolClaimVerdict("You could search the web to verify this yourself.", []).fabricated).toBe(false);
    expect(toolClaimVerdict("A web search would probably show newer numbers.", []).fabricated).toBe(false);
  });

  it("does NOT flag references to past-visit lookups", () => {
    expect(toolClaimVerdict("When I searched the web last visit, the numbers were lower.", []).fabricated).toBe(false);
    expect(toolClaimVerdict("Yesterday I checked the news and it said much the same.", []).fabricated).toBe(false);
  });

  it("does NOT flag ordinary reflection with no lookup language", () => {
    expect(toolClaimVerdict("I keep returning to the twelve bridges; let me tell you why they matter to me.", []).fabricated).toBe(false);
  });

  it("detectLookupClaims reports each claiming sentence with a snippet", () => {
    const claims = detectLookupClaims(
      "I pulled the RSS feed this morning. Also, I used read_file on my notes. The weather is nice.",
    );
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expect(c.snippet.length).toBeGreaterThan(0);
  });
});

describe("TOOL_NAMES drift pin against the runtime inventory", () => {
  // The entity_tokens.test.ts precedent applied cross-language: this exact
  // list already went stale once (a never-real diary_search, a missing
  // fetch_url), and staleness here can only ever MISS fabrications, never
  // false-positive — which is why the pin is worth the brittleness. The
  // runtime source is parsed directly (tuple literals of quoted strings
  // are stable); when the sibling checkout is absent (e.g. a standalone
  // clone), the pin skips rather than fabricates a failure.
  const RUNTIME_TOOLS_PY = resolve(
    __dirname,
    "../../../abstractruntime/src/abstractruntime/identity/tools.py",
  );

  function tupleNames(source: string, constant: string): string[] {
    const m = source.match(new RegExp(`${constant}[^=]*=\\s*\\(([^)]*)\\)`));
    if (!m) return [];
    return [...m[1].matchAll(/"([\w-]+)"/g)].map((x) => x[1]);
  }

  it.skipIf(!existsSync(RUNTIME_TOOLS_PY))(
    "matches TIER1_TOOL_NAMES + WORKSPACE_TOOL_NAMES exactly",
    () => {
      const src = readFileSync(RUNTIME_TOOLS_PY, "utf-8");
      const tier1 = tupleNames(src, "TIER1_TOOL_NAMES");
      const workspace = tupleNames(src, "WORKSPACE_TOOL_NAMES");
      expect(tier1.length).toBeGreaterThan(0);
      expect(workspace.length).toBeGreaterThan(0);
      expect([...TOOL_NAMES].sort()).toEqual([...tier1, ...workspace].sort());
    },
  );
});
