// The Board's Entities strip loads tile by tile (operator 2026-11-07): drawn from the roster at
// once, cognition and cards per entity, cards a few at a time and kept between refreshes.
// The gateway is a mock answering on fake timers (no network, no live gateway).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENTITY_CARD_CONCURRENCY,
  ENTITY_CARD_TTL_MS,
  ENTITY_REFRESH_MS,
  create_entity_tiles_loader,
  type EntityTilesGateway,
} from "./entity_tiles";
import { ENTITY_CARD_FAILED_NOTE, ENTITY_TILES_MAX, MissionControlPage, type EntityTile } from "./mission_control";

const T0 = Date.parse("2026-11-07T10:00:00Z");
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Row = { name: string; state: string; changed_at: string };

/** A gateway answering after fixed delays: the roster in 20 ms, cognition in 10 ms, each card
 * in `card_ms[name]` (default 15 ms). Calls are recorded in order. */
function mock_gateway(rows: Row[], card_ms: Record<string, number> = {}, fail_card: Set<string> = new Set()) {
  const calls = { roster: 0, card: [] as string[], cognition: [] as string[], cards_in_flight: 0, max_cards_in_flight: 0 };
  const state = { rows };
  const gw: EntityTilesGateway = {
    async list_entities() {
      calls.roster += 1;
      await delay(20);
      return {
        entities: state.rows.map((r) => ({
          name: r.name,
          entity_id: `entity:${r.name}`,
          identity: { rev: 1 },
          created_at: "2026-10-01T00:00:00Z",
          state: { state: r.state, changed_at: r.changed_at, reason: "", written_by: "test" },
        })),
      };
    },
    async get_entity_cognition(name: string) {
      calls.cognition.push(name);
      await delay(10);
      return { working: false, phase: "sleep", spend: { lifetime: { tokens_total: 1000 } }, warnings: [] };
    },
    async get_entity_card(name: string) {
      calls.card.push(name);
      calls.cards_in_flight += 1;
      calls.max_cards_in_flight = Math.max(calls.max_cards_in_flight, calls.cards_in_flight);
      try {
        await delay(card_ms[name] ?? 15);
        if (fail_card.has(name)) throw new Error("get_entity_card failed: HTTP 500");
        return {
          state: { state: "card-state", changed_at: "x" },
          age_days: 30,
          moments: [{ kind: `moment_of_${name}`, at: "2026-11-07T09:00:00Z" }],
          questions: {},
        };
      } finally {
        calls.cards_in_flight -= 1;
      }
    },
  };
  return { gw, calls, state };
}

function recorder() {
  const emissions: Array<{ at: number; tiles: EntityTile[] }> = [];
  const totals: number[] = [];
  const errors: string[] = [];
  return {
    emissions,
    totals,
    errors,
    last: () => emissions[emissions.length - 1]?.tiles ?? null,
    tile: (name: string) => emissions[emissions.length - 1]?.tiles.find((t) => t.name === name),
    sink: {
      tiles: (t: EntityTile[]) => emissions.push({ at: Date.now(), tiles: t }),
      total: (n: number) => totals.push(n),
      error: (m: string) => errors.push(m),
    },
  };
}

const rows = (...names: string[]): Row[] => names.map((name) => ({ name, state: "sleep", changed_at: "2026-11-07T08:00:00Z" }));
const sync = (fn: () => void) => fn();
/** A refresh on fake timers: the clock moves past the roster and cognition answers (30 ms). */
async function tick<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(30);
  return p;
}

const page = (entities: EntityTile[] | null, total: number) =>
  renderToStaticMarkup(
    React.createElement(MissionControlPage, {
      gateway_connected: true,
      runs: [],
      all_runs: [],
      runs_refreshed_at: T0,
      entities,
      entities_total: total,
      entities_error: "",
      on_open_run: () => {},
      on_resume_wait: async () => {},
      on_open_automation: () => {},
      entity_app_href: "",
    }),
  );

describe("Board Entities strip: tile by tile, cards kept (entity_tiles.ts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(a) draws every tile from the roster before any card answers: names, look and state, placeholders for the rest", async () => {
    const m = mock_gateway(rows("castor", "pollux", "ephemeral"), { castor: 6000, pollux: 6000, ephemeral: 6000 });
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    void loader.refresh();
    await vi.advanceTimersByTimeAsync(20); // the roster's answer, nothing else yet
    expect(r.emissions.length).toBe(1);
    expect(r.emissions[0].at - T0).toBe(20);
    expect(r.totals).toEqual([3]);
    const first = r.emissions[0].tiles;
    expect(first.map((t) => t.name)).toEqual(["castor", "pollux", "ephemeral"]);
    expect(first.every((t) => t.card_state === "pending" && t.cognition_pending === true)).toBe(true);
    expect(first[0].state).toBe("sleep"); // the roster row's state
    expect(first[0].identity_ref).toEqual({ of: "entity:castor", rev: 1 });

    // Rendered: real tiles (no skeleton row, no busy mark), each holding its unknown lines.
    const html = page(first, 3);
    expect((html.match(/<a class="mc_entity"/g) || []).length).toBe(3);
    expect(html).not.toContain("mc_entity_skeleton");
    expect(html).not.toContain('aria-busy="true"');
    expect(html).toContain("castor");
    expect((html.match(/class="mc_sk mc_entity_sk"/g) || []).length).toBe(9); // moment, liveness, spend × 3
    expect((html.match(/class="mc_sk mc_sk_hints"/g) || []).length).toBe(3);

    // Cognition lands next (10 ms later), cards still out.
    await vi.advanceTimersByTimeAsync(10);
    expect(r.last()!.every((t) => t.cognition_pending === false && t.working === false && t.card_state === "pending")).toBe(true);
    expect(m.calls.card.length).toBe(ENTITY_CARD_CONCURRENCY);
    loader.stop();
  });

  it("(b) one slow card does not delay the others; cards go out a few at a time, after cognition", async () => {
    const names = ["ephemeral", "castor", "pollux", "hypnos", "nyx"];
    const m = mock_gateway(rows(...names), { ephemeral: 6000 });
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    void loader.refresh();
    await vi.advanceTimersByTimeAsync(20);
    // Every cognition read is issued before the first card read.
    expect(m.calls.cognition).toEqual(names);
    await vi.advanceTimersByTimeAsync(200);
    for (const n of ["castor", "pollux", "hypnos", "nyx"]) {
      expect(r.tile(n)!.card_state).toBe("loaded");
      expect(r.tile(n)!.last_moment).toBe(`moment_of_${n}`);
    }
    expect(r.tile("ephemeral")!.card_state).toBe("pending");
    expect(r.tile("ephemeral")!.cognition_pending).toBe(false);
    expect(m.calls.max_cards_in_flight).toBe(ENTITY_CARD_CONCURRENCY);
    await vi.advanceTimersByTimeAsync(6000);
    expect(r.tile("ephemeral")!.card_state).toBe("loaded");
    loader.stop();
  });

  it("(c) a 30 s refresh re-reads roster and cognition but not fresh cards, and never blanks a tile", async () => {
    const m = mock_gateway(rows("castor", "pollux", "ephemeral"));
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    await tick(loader.refresh());
    await vi.advanceTimersByTimeAsync(100);
    expect([...m.calls.card].sort()).toEqual(["castor", "ephemeral", "pollux"]);
    expect(r.last()!.every((t) => t.card_state === "loaded")).toBe(true);

    for (let tick = 1; tick <= 3; tick++) {
      await vi.advanceTimersByTimeAsync(ENTITY_REFRESH_MS);
      const before = r.emissions.length;
      void loader.refresh();
      await vi.advanceTimersByTimeAsync(20);
      // The roster's tiles of the refresh carry the cached card and the last cognition.
      const at_roster = r.emissions[before].tiles;
      for (const t of at_roster) {
        expect(t.card_state).toBe("loaded");
        expect(t.last_moment).toBe(`moment_of_${t.name}`);
        expect(t.age_days).toBe(30);
        expect(t.cognition_pending).toBe(false);
        expect(t.tokens_total).toBe(1000);
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(m.calls.roster).toBe(1 + tick);
      expect(m.calls.cognition.length).toBe(3 * (1 + tick));
    }
    expect(m.calls.card.length).toBe(3); // 3 refreshes in 90 s: no card read again
    // Past the 5-minute floor every card is read again, once.
    await vi.advanceTimersByTimeAsync(ENTITY_CARD_TTL_MS);
    await tick(loader.refresh());
    await vi.advanceTimersByTimeAsync(100);
    expect(m.calls.card.length).toBe(6);
    loader.stop();
  });

  it("(d) a state change on the roster row reads that entity's card again at the next tick, only that one", async () => {
    const m = mock_gateway(rows("castor", "pollux", "ephemeral"));
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    await tick(loader.refresh());
    await vi.advanceTimersByTimeAsync(100);
    expect(m.calls.card.length).toBe(3);
    m.state.rows = m.state.rows.map((x) => (x.name === "pollux" ? { ...x, state: "awake", changed_at: "2026-11-07T10:00:10Z" } : x));
    await vi.advanceTimersByTimeAsync(ENTITY_REFRESH_MS);
    void loader.refresh();
    await vi.advanceTimersByTimeAsync(20);
    // The new state shows at once (from the roster), the old card fields stay meanwhile.
    expect(r.tile("pollux")!.state).toBe("awake");
    expect(r.tile("pollux")!.last_moment).toBe("moment_of_pollux");
    await vi.advanceTimersByTimeAsync(100);
    expect(m.calls.card.slice(3)).toEqual(["pollux"]);
    loader.stop();
  });

  it("a failed card leaves the tile with its roster facts and a short note, and is tried again at the next tick", async () => {
    const fail = new Set(["castor"]);
    const m = mock_gateway(rows("castor", "pollux"), {}, fail);
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    await tick(loader.refresh());
    await vi.advanceTimersByTimeAsync(100);
    const c = r.tile("castor")!;
    expect(c.card_state).toBe("failed");
    expect(c.state).toBe("sleep");
    expect(c.error).toContain("HTTP 500");
    expect(r.tile("pollux")!.card_state).toBe("loaded");
    const html = page(r.last()!, 2);
    expect(html).toContain(ENTITY_CARD_FAILED_NOTE);
    expect(html).not.toContain("HTTP 500</"); // the reason rides the tooltip, not the line
    fail.clear();
    await vi.advanceTimersByTimeAsync(ENTITY_REFRESH_MS);
    await tick(loader.refresh());
    await vi.advanceTimersByTimeAsync(100);
    expect(m.calls.card.filter((n) => n === "castor").length).toBe(2);
    expect(r.tile("castor")!.card_state).toBe("loaded");
    expect(r.tile("castor")!.error).toBe("");
    loader.stop();
  });

  it("keeps the strip's rules: ENTITY_TILES_MAX tiles of the full total, the roster error, 404 = no entities, rate-limit stand-down, stop", async () => {
    const many = Array.from({ length: 17 }, (_, i) => `e${i}`);
    const m = mock_gateway(rows(...many));
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    await tick(loader.refresh());
    expect(r.totals).toEqual([17]);
    expect(r.last()!.length).toBe(ENTITY_TILES_MAX);
    expect(m.calls.cognition.length).toBe(ENTITY_TILES_MAX);
    loader.stop();
    const after = r.emissions.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.emissions.length).toBe(after); // nothing reaches the sink after stop
    expect(m.calls.card.length).toBeLessThanOrEqual(ENTITY_CARD_CONCURRENCY); // the queue died with it

    const broken = (msg: string): EntityTilesGateway => ({
      list_entities: async () => {
        throw new Error(msg);
      },
      get_entity_card: async () => ({}),
      get_entity_cognition: async () => ({}),
    });
    const r404 = recorder();
    await create_entity_tiles_loader({ gateway: broken("list_entities failed: HTTP 404 Not Found"), sink: r404.sink, schedule: sync }).refresh();
    expect(r404.last()).toEqual([]);
    expect(r404.errors).toEqual([""]);
    const r500 = recorder();
    await create_entity_tiles_loader({ gateway: broken("list_entities failed: HTTP 500"), sink: r500.sink, schedule: sync }).refresh();
    expect(r500.last()).toEqual([]);
    expect(r500.errors).toEqual(["list_entities failed: HTTP 500"]);

    let limited = true;
    const m2 = mock_gateway(rows("castor"));
    const r2 = recorder();
    const l2 = create_entity_tiles_loader({ gateway: m2.gw, sink: r2.sink, schedule: sync, is_rate_limited: () => limited });
    expect(await l2.refresh()).toBe(false);
    expect(m2.calls.roster + m2.calls.cognition.length + m2.calls.card.length).toBe(0);
    limited = false;
    expect(await tick(l2.refresh())).toBe(true);
    expect(m2.calls.roster).toBe(1);
    l2.stop();
  });
});
