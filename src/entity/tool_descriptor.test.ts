/**
 * Render-consumer pins for the tool-inventory descriptor contract v6
 * (commons fs plans/tool-inventory-descriptor-contract.md). Built ahead
 * of the served payload per the completion directive (c916) — these pin
 * the CONSUMER duties the contract assigns to the observer: pair-keyed
 * views, deny-safe absence, the both-fields derivation rule, containment
 * prose, labeled-unknown rendering, total order.
 */

import { describe, expect, it } from "vitest";

import {
  boundaryClass,
  crossesWorldBoundary,
  descriptorKey,
  hasEffect,
  keyedDescriptors,
  laneBadge,
  proseName,
  remoteWriteCue,
  sortDescriptors,
  type ToolDescriptor,
} from "./tool_descriptor";

const walledWebSearch: ToolDescriptor = {
  name: "web_search",
  owner: "runtime",
  executes_via: "entity_walled",
  grant_lane: "tier1",
  capability_class: "tier2_world",
  mutating: false,
  remote_write_capable: false,
};

const registryWebSearch: ToolDescriptor = {
  name: "web_search",
  owner: "core",
  executes_via: "core_registry",
  grant_lane: null,
  mutating: false,
};

const registryFetchUrl: ToolDescriptor = {
  name: "fetch_url",
  owner: "core",
  executes_via: "core_registry",
  grant_lane: null,
  mutating: false,
  remote_write_capable: true,
};

const walledDiaryRead: ToolDescriptor = {
  name: "diary_read",
  owner: "runtime",
  executes_via: "entity_walled",
  grant_lane: "tier1",
  capability_class: "tier1_self",
  act_only: true,
};

describe("pair identity (rule 2 serialization)", () => {
  it("a keyed view keeps BOTH containments of a colliding name", () => {
    const keyed = keyedDescriptors([walledWebSearch, registryWebSearch]);
    expect(keyed.size).toBe(2);
    expect(keyed.get(descriptorKey(walledWebSearch))).toBe(walledWebSearch);
    expect(keyed.get(descriptorKey(registryWebSearch))).toBe(registryWebSearch);
  });
});

describe("lane badges (rule 5)", () => {
  it("walled rows badge their grant lane", () => {
    expect(laneBadge(walledWebSearch)).toEqual({ label: "● tier-1", kind: "lane" });
  });

  it("core_registry rows badge the containment, never a lane", () => {
    expect(laneBadge(registryWebSearch)).toEqual({ label: "core registry", kind: "containment" });
  });

  it("unknown lane/containment values render labeled-unknown, never guessed", () => {
    expect(laneBadge({ ...walledWebSearch, grant_lane: "turbo" }).kind).toBe("unknown");
    expect(laneBadge({ ...walledWebSearch, executes_via: "mcp" }).kind).toBe("unknown");
  });
});

describe("capability_class deny-safe absence (v6)", () => {
  it("absent reads as tier2_world, marked undeclared", () => {
    expect(boundaryClass(registryWebSearch)).toEqual({ value: "tier2_world", declared: false, known: true });
  });

  it("declared values pass through; the tier1-lane world-crossing pair is visible", () => {
    expect(boundaryClass(walledWebSearch)).toEqual({ value: "tier2_world", declared: true, known: true });
    expect(crossesWorldBoundary(walledWebSearch)).toBe(true); // egress honesty: tier1 lane, world boundary
    expect(crossesWorldBoundary(walledDiaryRead)).toBe(false);
  });
});

describe("the both-fields derivation rule (core c901)", () => {
  it("fetch_url has effect despite mutating=false — remote_write_capable decides", () => {
    expect(registryFetchUrl.mutating).toBe(false);
    expect(hasEffect(registryFetchUrl)).toBe(true);
    expect(remoteWriteCue(registryFetchUrl)).toContain("remotely");
  });

  it("a genuinely read-only tool has no effect and no cue", () => {
    expect(hasEffect(walledWebSearch)).toBe(false);
    expect(remoteWriteCue(walledWebSearch)).toBeNull();
  });
});

describe("human-facing prose names containment when ambiguous (rule 2)", () => {
  it("colliding names carry the containment; unique names stay bare", () => {
    const rows = [walledWebSearch, registryWebSearch, walledDiaryRead];
    expect(proseName(walledWebSearch, rows)).toBe("web_search (entity-walled)");
    expect(proseName(registryWebSearch, rows)).toBe("web_search (core registry)");
    expect(proseName(walledDiaryRead, rows)).toBe("diary_read");
  });
});

describe("total order (rule 4)", () => {
  it("sorts (executes_via, owner, name) ascending", () => {
    const sorted = sortDescriptors([walledWebSearch, registryFetchUrl, walledDiaryRead, registryWebSearch]);
    expect(sorted.map((d) => descriptorKey(d))).toEqual([
      descriptorKey(registryFetchUrl),
      descriptorKey(registryWebSearch),
      descriptorKey(walledDiaryRead),
      descriptorKey(walledWebSearch),
    ]);
  });
});
