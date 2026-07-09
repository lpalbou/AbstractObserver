import { describe, it, expect } from "vitest";

import { detectLookupClaims, toolClaimVerdict } from "./tool_claim_guard";

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
