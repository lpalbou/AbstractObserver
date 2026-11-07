// The Board's Entities strip (0.12.3): one shared kit EntityCard per entity, filled by the gateway's
// tile read when the roster advertises it (`reads.tile`, gateway 0.21.0), by the card + cognition
// reads on an older gateway. The gateway is a mock answering on fake timers (no network, no live
// gateway); its tiles are shaped exactly like abstractgateway's entity_tile.py output (tile_version 1,
// see tests/test_gateway_entity_tile.py there).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENTITY_CARD_CONCURRENCY,
  ENTITY_CARD_TTL_MS,
  ENTITY_REFRESH_MS,
  card_facts,
  create_entity_tiles_loader,
  roster_has_tile_read,
  start_entity_tiles_poll,
  type EntityTilesGateway,
} from "./entity_tiles";
import { ENTITY_TILES_MAX, MissionControlPage, type EntityTile } from "./mission_control";
import { gateway_tile } from "./__fixtures__/entity_tile";

const T0 = Date.parse("2026-11-07T10:00:00Z");
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const READS = { tile: { available: true, version: 1, endpoint: "/api/gateway/entities/{name}/tile" } };

type Row = { name: string; state: string; changed_at: string };

/** A gateway answering after fixed delays: the roster in 20 ms, a tile in `tile_ms[name]` (default
 * 10 ms), cognition in 10 ms, a card in 15 ms. `with_tile_read` = gateway 0.21.0 (the roster
 * advertises `reads.tile`); false = an older gateway (no `reads`, no tile route). */
function mock_gateway(rows: Row[], opts: { with_tile_read?: boolean; tile_ms?: Record<string, number> } = {}) {
  const with_tile_read = opts.with_tile_read ?? true;
  const calls = { roster: 0, tile: [] as string[], card: [] as string[], cognition: [] as string[], in_flight: 0, max_in_flight: 0 };
  const state = {
    rows,
    roster_error: "",
    tile_error: {} as Record<string, string>,
    card_error: {} as Record<string, string>,
    cog_error: {} as Record<string, string>,
    busy: false,
    tile_over: {} as Record<string, Record<string, any>>,
  };
  const gw: EntityTilesGateway = {
    async list_entities() {
      calls.roster += 1;
      await delay(20);
      if (state.roster_error) throw new Error(state.roster_error);
      return {
        entities: state.rows.map((r) => ({
          name: r.name,
          slug: r.name.toLowerCase(),
          entity_id: `entity:${r.name.toLowerCase()}`,
          identity: { rev: 1, avatar: { style: "watch-shape-kitty", color: "#d06439", watch_code: null }, voice: null },
          state: { state: r.state, changed_at: r.changed_at, reason: "", written_by: "test" },
        })),
        ...(with_tile_read ? { reads: READS } : {}),
      };
    },
    async get_entity_tile(name: string) {
      calls.tile.push(name);
      calls.in_flight += 1;
      calls.max_in_flight = Math.max(calls.max_in_flight, calls.in_flight);
      try {
        await delay(opts.tile_ms?.[name] ?? 10);
        if (!with_tile_read) throw new Error("get_entity_tile failed: HTTP 404: Not Found");
        if (state.tile_error[name]) throw new Error(state.tile_error[name]);
        return gateway_tile(name, { now: { ...gateway_tile(name).now, busy: state.busy }, ...(state.tile_over[name] || {}) });
      } finally {
        calls.in_flight -= 1;
      }
    },
    async get_entity_cognition(name: string) {
      calls.cognition.push(name);
      await delay(10);
      if (state.cog_error[name]) throw new Error(state.cog_error[name]);
      return { working: state.busy, phase: "sleep", sleep_detail: "resting", state: { state: "awake" }, loop: { running: false }, spend: { lifetime: { tokens_total: 4_200_000 } }, warnings: [] };
    },
    async get_entity_card(name: string) {
      calls.card.push(name);
      await delay(15);
      if (state.card_error[name]) throw new Error(state.card_error[name]);
      return {
        state: { state: "awake", changed_at: "x" },
        age_days: 30,
        moments: [
          { kind: "session_closed", at: "2026-11-07T08:00:00Z" },
          { kind: "diary_read", at: "2026-11-07T09:30:00Z" }, // operator bookkeeping: never the last moment
          { kind: "identity_changed", at: "2026-11-07T09:40:00Z", details: { cause: "recorded_default" } }, // the birth recording
        ],
        discoveries: {
          interests: [
            { statement: "older interest", observed_at: "2026-11-01T00:00:00Z" },
            { statement: `${name} wonders about tides`, observed_at: "2026-11-06T00:00:00Z" },
          ],
        },
        questions: { open: [{ statement: "why do I dream of doors?", observed_at: "2026-11-06T01:00:00Z" }] },
        problems: { open: [{ statement: "the notes are lost", observed_at: "2026-11-05T00:00:00Z" }] },
        lessons: { lessons: [{ statement: "listen first", observed_at: "2026-11-04T00:00:00Z" }], total: 33 },
      };
    },
  };
  return { gw, calls, state };
}

function recorder() {
  const emissions: Array<{ at: number; tiles: EntityTile[] }> = [];
  const resets: number[] = [];
  const totals: number[] = [];
  const errors: string[] = [];
  return {
    emissions,
    resets,
    totals,
    errors,
    last: () => emissions[emissions.length - 1]?.tiles ?? null,
    tile: (name: string) => emissions[emissions.length - 1]?.tiles.find((t) => t.name === name),
    sink: {
      tiles: (t: EntityTile[] | null) => (t === null ? resets.push(Date.now()) : emissions.push({ at: Date.now(), tiles: t })),
      total: (n: number) => totals.push(n),
      error: (m: string) => errors.push(m),
    },
  };
}

const rows = (...names: string[]): Row[] => names.map((name) => ({ name, state: "awake", changed_at: "2026-11-07T08:00:00Z" }));
const sync = (fn: () => void) => fn();

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
      entity_app_href: "http://entity.test/",
    }),
  );
/** The Entities strip's markup only (the lanes below carry run metrics of their own). */
const strip = (html: string) => html.match(/<section class="mc_entities[\s\S]*?(?=<div class="mc_filters|<div class="mc_board|<div class="mc_status_line|$)/)![0];

describe("Board Entities strip: the tile read (gateway 0.21.0 `reads.tile`)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads one tile per entity when the roster advertises it — never /cognition or /card", async () => {
    const m = mock_gateway(rows("Castor", "Pollux"));
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    const p = loader.refresh();
    await vi.advanceTimersByTimeAsync(20); // the roster: every card at once, loading, look from the row
    expect(r.emissions.length).toBe(1);
    expect(r.last()!.map((t) => [t.name, t.status, t.tile])).toEqual([["Castor", "loading", null], ["Pollux", "loading", null]]);
    expect(r.tile("Castor")!.look).toEqual({ style: "watch-shape-kitty", color: "#d06439" });
    await vi.advanceTimersByTimeAsync(10);
    await p;
    expect(m.calls.tile).toEqual(["Castor", "Pollux"]);
    expect(m.calls.cognition).toEqual([]);
    expect(m.calls.card).toEqual([]);
    expect(r.tile("Castor")!.status).toBe("ready");
    expect(r.tile("Castor")!.tile).toEqual(gateway_tile("Castor"));
    loader.stop();
  });

  it("reads every tile again at each 30 s refresh (no card cache), and nothing blanks while they are in flight", async () => {
    const m = mock_gateway(rows("Castor", "Pollux"));
    const r = recorder();
    const stop = start_entity_tiles_poll(create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync }));
    await vi.advanceTimersByTimeAsync(30);
    expect(m.calls.tile.length).toBe(2);
    m.state.busy = true;
    const before = r.emissions.length;
    await vi.advanceTimersByTimeAsync(ENTITY_REFRESH_MS + 20); // the next roster answer
    expect(m.calls.roster).toBe(2);
    // The roster's emission keeps each card's last tile (ready), never back to loading.
    expect(r.emissions.slice(before).every((e) => e.tiles.every((t) => t.status === "ready" && t.tile))).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(m.calls.tile.length).toBe(4);
    expect(r.tile("Castor")!.tile!.now.busy).toBe(true);
    expect(m.calls.cognition.length + m.calls.card.length).toBe(0);
    stop();
  });

  it("a few tiles at a time; one slow tile does not hold the others back", async () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const m = mock_gateway(rows(...names), { tile_ms: { A: 6000 } });
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    const p = loader.refresh();
    await vi.advanceTimersByTimeAsync(20 + 10 * 3);
    expect(m.calls.max_in_flight).toBe(ENTITY_CARD_CONCURRENCY);
    expect(names.slice(1).map((n) => r.tile(n)!.status)).toEqual(["ready", "ready", "ready", "ready", "ready"]);
    expect(r.tile("A")!.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(r.tile("A")!.status).toBe("ready");
    loader.stop();
  });

  it("a failed tile read: unavailable when nothing was known (the reason kept for the tooltip), stale with its read time after a good read, ready again after", async () => {
    const m = mock_gateway(rows("Castor", "Pollux"));
    m.state.tile_error.Pollux = "get_entity_tile failed: HTTP 409: maintenance hold";
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    const p1 = loader.refresh();
    await vi.advanceTimersByTimeAsync(30);
    await p1;
    expect(r.tile("Pollux")).toMatchObject({ status: "unavailable", tile: null, reason: "get_entity_tile failed: HTTP 409: maintenance hold" });
    const castor_read_at = Date.now();
    m.state.tile_error.Castor = "get_entity_tile failed: HTTP 500";
    delete m.state.tile_error.Pollux;
    vi.setSystemTime(T0 + 12 * 60_000);
    const p2 = loader.refresh();
    await vi.advanceTimersByTimeAsync(30);
    await p2;
    expect(r.tile("Castor")).toMatchObject({ status: "stale", as_of_ms: castor_read_at, reason: "get_entity_tile failed: HTTP 500" });
    expect(r.tile("Castor")!.tile).toEqual(gateway_tile("Castor")); // the older tile stays
    expect(r.tile("Pollux")!.status).toBe("ready");
    // Rendered: the stale card says since when, in plain words; the unavailable one says so.
    const html = page(r.last(), 2);
    expect(html).toContain("Details from 12 minutes ago; newer ones could not be read");
    delete m.state.tile_error.Castor;
    const p3 = loader.refresh();
    await vi.advanceTimersByTimeAsync(30);
    await p3;
    expect(r.tile("Castor")).toMatchObject({ status: "ready", as_of_ms: null, reason: "" });
    loader.stop();
  });

  it("per-account scope: another account starts from nothing and the old account's late tiles are dropped", async () => {
    const m = mock_gateway(rows("Castor", "Pollux"), { tile_ms: { Pollux: 5000 } });
    const r = recorder();
    let scope = "http://gw|alice";
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync, scope: () => scope });
    void loader.refresh();
    await vi.advanceTimersByTimeAsync(40);
    expect(r.tile("Castor")!.status).toBe("ready");
    expect(r.tile("Pollux")!.status).toBe("loading"); // alice's Pollux still in flight
    scope = "http://gw|bob";
    const p = loader.refresh();
    expect(r.resets.length).toBe(1); // back to the placeholders at once
    await vi.advanceTimersByTimeAsync(20);
    expect(r.last()!.every((t) => t.status === "loading" && t.tile === null)).toBe(true); // nothing of alice's
    await vi.advanceTimersByTimeAsync(4970); // alice's Pollux answers now: dropped
    expect(r.tile("Pollux")!.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(r.tile("Pollux")!.status).toBe("ready");
    expect(m.calls.tile.filter((n) => n === "Castor").length).toBe(2); // read again as bob
    loader.stop();
  });

  it("rate-limit stand-down: no read while the window is open, a window that opens mid-way stops the rest; the poll resumes on its own", async () => {
    const m = mock_gateway(rows("A", "B", "C", "D", "E"));
    const r = recorder();
    let limited = true;
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync, is_rate_limited: () => limited });
    const stop = start_entity_tiles_poll(loader);
    await vi.advanceTimersByTimeAsync(100);
    expect(m.calls.roster + m.calls.tile.length).toBe(0);
    limited = false;
    await vi.advanceTimersByTimeAsync(ENTITY_REFRESH_MS - 100 + 20); // t = 30 020: the next tick's roster answers
    await vi.advanceTimersByTimeAsync(1); // the first reads are out
    expect(m.calls.tile.length).toBe(ENTITY_CARD_CONCURRENCY);
    limited = true; // the window opens while D and E wait their turn
    await vi.advanceTimersByTimeAsync(50);
    expect(m.calls.tile.length).toBe(ENTITY_CARD_CONCURRENCY);
    limited = false;
    await vi.advanceTimersByTimeAsync(ENTITY_REFRESH_MS + 100);
    expect(m.calls.tile.length).toBe(ENTITY_CARD_CONCURRENCY + 5);
    stop();
  });

  it("keeps the strip's rules: ENTITY_TILES_MAX cards of the full total, a failed roster keeps the last cards with a note, 404 = no entities, stop", async () => {
    const many = Array.from({ length: ENTITY_TILES_MAX + 3 }, (_, i) => `e${i}`);
    const m = mock_gateway(rows(...many));
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    const p1 = loader.refresh();
    await vi.advanceTimersByTimeAsync(200);
    await p1;
    expect(r.totals).toEqual([ENTITY_TILES_MAX + 3]);
    expect(r.last()!.length).toBe(ENTITY_TILES_MAX);
    expect(m.calls.tile.length).toBe(ENTITY_TILES_MAX);
    m.state.roster_error = "list_entities failed: HTTP 502";
    const p2 = loader.refresh();
    await vi.advanceTimersByTimeAsync(20);
    await p2;
    expect(r.last()!.length).toBe(ENTITY_TILES_MAX);
    expect(r.last()!.every((t) => t.status === "ready")).toBe(true);
    expect(r.errors[r.errors.length - 1]).toMatch(/^Could not refresh the entities; showing what was read at /);
    m.state.roster_error = "list_entities failed: HTTP 404: Not Found";
    const p3 = loader.refresh();
    await vi.advanceTimersByTimeAsync(20);
    await p3;
    expect(r.last()).toEqual([]);
    expect(r.errors[r.errors.length - 1]).toBe("");
    m.state.roster_error = "";
    const p4 = loader.refresh();
    loader.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(await p4).toBe(false);
    expect(r.last()).toEqual([]); // nothing reached the strip after stop
  });
});

describe("Board Entities strip: the fallback on an older gateway (no `reads.tile`)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an older roster carries no `reads.tile`: the card + cognition path, never the tile route; the same card shape drawn from the card", async () => {
    expect(roster_has_tile_read({ entities: [] })).toBe(false);
    expect(roster_has_tile_read({ entities: [], reads: READS })).toBe(true);
    const m = mock_gateway(rows("Castor"), { with_tile_read: false });
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    const p = loader.refresh();
    await vi.advanceTimersByTimeAsync(20);
    expect(r.tile("Castor")!.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(15);
    await p;
    expect(m.calls.tile).toEqual([]);
    expect(m.calls.cognition).toEqual(["Castor"]);
    expect(m.calls.card).toEqual(["Castor"]);
    const t = r.tile("Castor")!;
    expect(t.status).toBe("ready");
    expect(t.tile).toMatchObject({
      name: "Castor",
      look: { style: "watch-shape-kitty", color: "#d06439" },
      age_days: 30,
      now: { phase: "sleep", state: "awake", detail: "resting", busy: false, since: null, trouble: null },
      into_lately: [{ text: "Castor wonders about tides" }, { text: "older interest" }],
      on_its_mind: { kind: "question", text: "why do I dream of doors?" },
      latest_lesson: { text: "listen first" },
      // The operator's diary read and the identity's birth recording are skipped.
      last_moment: { kind: "session_closed", at: "2026-11-07T08:00:00Z" },
      counts: { open_questions: 1, open_problems: 1, lessons: 33, interests: 2, sleeps: null },
    });
    loader.stop();
  });

  it("keeps 0.12.2's guarantees: cards kept 5 minutes or until the state changes, a failed card is stale (or unavailable), per-account scope", async () => {
    const m = mock_gateway(rows("Castor", "Pollux"), { with_tile_read: false });
    m.state.card_error.Pollux = "get_entity_card failed: HTTP 500";
    const r = recorder();
    let scope = "a";
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync, scope: () => scope });
    const run = async () => {
      const p = loader.refresh();
      await vi.advanceTimersByTimeAsync(60);
      await p;
    };
    await run();
    expect(r.tile("Pollux")).toMatchObject({ status: "unavailable", reason: "get_entity_card failed: HTTP 500" });
    await run(); // fresh: Castor's card is not read again (Pollux's failed one is)
    expect(m.calls.card.filter((n) => n === "Castor").length).toBe(1);
    expect(m.calls.cognition.length).toBe(4); // cognition every tick
    m.state.rows = [{ ...m.state.rows[0], changed_at: "2026-11-07T10:00:30Z" }, m.state.rows[1]];
    await run(); // Castor's state moved: its card is read again
    expect(m.calls.card.filter((n) => n === "Castor").length).toBe(2);
    m.state.card_error.Castor = "get_entity_card failed: HTTP 503";
    vi.setSystemTime(Date.now() + ENTITY_CARD_TTL_MS);
    await run();
    expect(r.tile("Castor")!.status).toBe("stale");
    expect(r.tile("Castor")!.tile!.into_lately[0].text).toBe("Castor wonders about tides");
    scope = "b";
    await run();
    expect(r.resets.length).toBe(1);
    expect(r.tile("Castor")!.status).toBe("unavailable"); // nothing of scope a's card carried over
    loader.stop();
  });

  it("on a gateway without the cognition wire, the card is read at every refresh and the now line only says what the state word says for sure", async () => {
    const m = mock_gateway([{ name: "Castor", state: "paused", changed_at: "x" }, { name: "Pollux", state: "awake", changed_at: "x" }], { with_tile_read: false });
    m.state.cog_error.Castor = m.state.cog_error.Pollux = "get_entity_cognition failed: HTTP 404: Not Found";
    const r = recorder();
    const loader = create_entity_tiles_loader({ gateway: m.gw, sink: r.sink, schedule: sync });
    for (let i = 0; i < 2; i++) {
      const p = loader.refresh();
      await vi.advanceTimersByTimeAsync(60);
      await p;
      vi.setSystemTime(Date.now() + ENTITY_REFRESH_MS);
    }
    expect(m.calls.card.filter((n) => n === "Castor").length).toBe(2);
    expect(r.tile("Castor")!.tile!.now).toMatchObject({ phase: "stopped" });
    expect(r.tile("Pollux")!.tile!.now).toBeNull(); // "awake" alone: a visit or resting? not said
    loader.stop();
  });

  it("card_facts takes the engraved own-time spelling and never shows a moment the kit has no words for", () => {
    expect(card_facts({ moments: [{ kind: "own_time_started", at: "2026-08-01T11:00:00Z" }, { kind: "queue_census", at: "2026-08-02T00:00:00Z" }] }).last_moment).toEqual({ kind: "personal_started", at: "2026-08-01T11:00:00Z" });
    expect(card_facts({ moments: [{ kind: "phase_changed", at: "2026-08-01T11:00:00Z", details: { to: "personal" } }] }).last_moment).toEqual({ kind: "phase_changed", at: "2026-08-01T11:00:00Z", to: "personal" });
    expect(card_facts({ moments: [{ kind: "work_order_changed", at: "2026-08-01T11:00:00Z", change: "set" }] }).last_moment).toEqual({ kind: "work_order_changed", at: "2026-08-01T11:00:00Z", change: "set" });
    expect(card_facts({ moments: [{ kind: "phase_changed", at: "2026-08-01T11:00:00Z", details: { to: "nowhere" } }] }).last_moment).toBeNull(); // no words for it
    expect(card_facts({}).last_moment).toBeNull();
    expect(card_facts(null).counts).toEqual({ open_questions: 0, open_problems: 0, lessons: 0, interests: 0, sleeps: null });
  });
});

describe("Board Entities strip: one compact chip per entity, the kit card on demand", () => {
  it("draws one chip per entity with the kit's words: who, now and for how long, the last moment — the kit EntityCard (every fact whole, the entity app link) opens from the chip; no tk, no phase chip, no counts badge", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const tiles: EntityTile[] = [
        { name: "Castor", look: null, tile: gateway_tile("Castor"), status: "ready", as_of_ms: null, reason: "" },
        { name: "Pollux", look: { style: null, color: "#d06439" }, tile: null, status: "unavailable", as_of_ms: null, reason: "HTTP 409" },
        { name: "Nyx", look: null, tile: null, status: "loading", as_of_ms: null, reason: "" },
      ];
      const html = strip(page(tiles, 3));
      // Redesign 2026-11-07: ONE row of chips (the tall compact cards left most of their body empty).
      expect((html.match(/<button type="button" class="mc_entity_chip"/g) || []).length).toBe(3);
      expect(html).toContain('data-status="ready"');
      expect(html).toContain("Resting");
      expect(html).toContain("for 48 minutes");
      expect(html).toContain("A visit ended · 1 hour ago");
      expect(html).toContain("Details unavailable right now");
      // "Into lately" and the entity app link live in the kit card the chip opens (hover / click):
      // nothing of it is drawn — or cut — on the strip.
      expect(html).not.toContain("How Castor hears the sea at night");
      expect(html).not.toContain("af-entity-card");
      expect((html.match(/aria-haspopup="dialog"/g) || []).length).toBe(3);
      // Gone from 0.12.2's strip: the token spend, the phase chip, the idle line, the counts badge
      // outside the card and its expandable panel.
      expect(html).not.toMatch(/\btk\b/);
      expect(html).not.toContain("mc_entity_phase");
      expect(html).not.toContain("idle ·");
      expect(html).not.toContain("mc_entity_hints");
      expect(html).not.toMatch(/\d+ questions? ·/);
      expect(html).not.toContain("night:");
      // Compact: the counts are not drawn at all on the strip (the full card in the entity app has them).
      expect(html).not.toContain("78 open questions");
    } finally {
      vi.useRealTimers();
    }
  });
});
