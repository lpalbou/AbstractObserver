import { describe, expect, it } from "vitest";

import {
  buildKgGraph,
  buildKgLayout,
  forceSimulationPositions,
  hashStringToSeed,
  initForceSimulation,
  sanitizeViewport,
  stepForceSimulation,
  type KgAssertion,
} from "@abstractuic/monitor-active-memory";

function roundPositions(pos: Record<string, { x: number; y: number }>): Array<[string, number, number]> {
  return Object.entries(pos)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, p]) => [id, Number(p.x.toFixed(3)), Number(p.y.toFixed(3))]);
}

describe("KG layout helpers", () => {
  it("hashStringToSeed is stable", () => {
    expect(hashStringToSeed("mindmap:all:run:session")).toBe(hashStringToSeed("mindmap:all:run:session"));
  });

  it("grid layout matches stable alphabetical placement", () => {
    const items: KgAssertion[] = [
      { subject: "ex:concept-a", predicate: "schema:about", object: "ex:concept-b" },
      { subject: "ex:concept-b", predicate: "schema:about", object: "ex:concept-c" },
      { subject: "ex:concept-c", predicate: "schema:about", object: "ex:concept-a" },
    ];
    const graph = buildKgGraph(items);
    const pos = buildKgLayout(graph, { kind: "grid", seed: 0 });
    expect(pos["ex:concept-a"]).toEqual({ x: 0, y: 0 });
    expect(pos["ex:concept-b"]).toEqual({ x: 240, y: 0 });
    expect(pos["ex:concept-c"]).toEqual({ x: 0, y: 120 });
  });

  it("circle layout is deterministic given the same seed", () => {
    const items: KgAssertion[] = [
      { subject: "ex:concept-a", predicate: "schema:about", object: "ex:concept-b" },
      { subject: "ex:concept-b", predicate: "schema:about", object: "ex:concept-c" },
    ];
    const graph = buildKgGraph(items);
    const p1 = buildKgLayout(graph, { kind: "circle", seed: 123 });
    const p2 = buildKgLayout(graph, { kind: "circle", seed: 123 });
    expect(roundPositions(p1)).toEqual(roundPositions(p2));
    const p3 = buildKgLayout(graph, { kind: "circle", seed: 124 });
    expect(roundPositions(p3)).not.toEqual(roundPositions(p2));
  });

  it("force simulation produces deterministic positions for a fixed tick count", () => {
    const items: KgAssertion[] = [
      { subject: "ex:concept-a", predicate: "schema:about", object: "ex:concept-b" },
      { subject: "ex:concept-b", predicate: "schema:about", object: "ex:concept-c" },
      { subject: "ex:concept-c", predicate: "schema:about", object: "ex:concept-a" },
      { subject: "ex:concept-a", predicate: "schema:about", object: "ex:concept-d" },
    ];
    const graph = buildKgGraph(items);
    const seed = 4242;
    const initial = buildKgLayout(graph, { kind: "force", seed });

    const a = initForceSimulation(graph, { seed, positions: initial });
    stepForceSimulation(a, 64);
    const outA = roundPositions(forceSimulationPositions(a));

    const b = initForceSimulation(graph, { seed, positions: initial });
    stepForceSimulation(b, 64);
    const outB = roundPositions(forceSimulationPositions(b));

    expect(outA).toEqual(outB);
  });

  it("sanitizeViewport rejects invalid or extreme values", () => {
    expect(sanitizeViewport({ x: Number.POSITIVE_INFINITY, y: 0, zoom: 1 })).toBe(null);
    expect(sanitizeViewport({ x: 0, y: Number.NaN, zoom: 1 })).toBe(null);
    expect(sanitizeViewport({ x: 0, y: 0, zoom: Number.NaN })).toBe(null);
    expect(sanitizeViewport({ x: 2_000_000, y: 0, zoom: 1 }, { maxAbsTranslate: 1_000_000 })).toBe(null);
  });

  it("sanitizeViewport clamps zoom to configured bounds", () => {
    expect(sanitizeViewport({ x: 0, y: 0, zoom: 0 })?.zoom).toBe(0.025);
    expect(sanitizeViewport({ x: 0, y: 0, zoom: 999 })?.zoom).toBe(6);
    expect(sanitizeViewport({ x: 0, y: 0, zoom: 1 }, { minZoom: 0.5, maxZoom: 2 })?.zoom).toBe(1);
    expect(sanitizeViewport({ x: 0, y: 0, zoom: 0.1 }, { minZoom: 0.5, maxZoom: 2 })?.zoom).toBe(0.5);
  });
});
