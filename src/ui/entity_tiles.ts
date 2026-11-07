// The Board's Entities strip, loaded tile by tile (operator 2026-11-07: "it is absurd for a tiny
// card about the entity to request so much data that you will never show").
//
// What a tile needs comes from three gateway reads of very different cost:
//   - the roster (`GET /entities`, ~20 ms for 17 entities) already names each entity, its look
//     and its state — the tiles are drawn from it at once;
//   - the cognition wire (`/entities/{name}/cognition`, 5-450 ms) carries the live facts (busy or
//     idle, phase, spend) — read for every tile on every refresh;
//   - the card (`/entities/{name}/card`) carries the slow facts (age, last moment, open questions
//     and problems, lessons, night signals) and can be large and slow (88 KB and 1-6 s for a long
//     life) — read a few at a time, kept between refreshes and read again only when it is old or
//     the entity's state changed.
// Each tile updates when its own answer arrives: one slow card never holds the others back.

import { entity_row_ref, type IdentityRef } from "./identity";
import { ENTITY_TILES_MAX, extract_dreams_brief, extract_open_briefs, type EntityTile } from "./mission_control";

/** Roster + cognition cadence (unchanged since the strip shipped). */
export const ENTITY_REFRESH_MS = 30_000;
/** A card is read again after 5 minutes even when the state did not change. What it carries moves
 * slowly — age in days, open questions/problems and lessons change on diary writes, night signals
 * on a sleep pass — and the live facts (busy/idle, phase, spend) come from cognition every 30 s.
 * A state change (the roster row's `state.changed_at`) refreshes the card at the next 30 s tick;
 * the 5-minute floor catches what changes without one (a new moment or question mid-phase) while
 * cutting the card traffic tenfold against the old every-30-s read. */
export const ENTITY_CARD_TTL_MS = 5 * 60_000;
/** Cards in flight at once. Browsers open ~6 connections per host (HTTP/1.1): three leave three
 * for the roster, cognition and every other Board read, and two long lives' slow cards (1-6 s
 * measured) can each hold a slot while the quick cards keep flowing through the third. */
export const ENTITY_CARD_CONCURRENCY = 3;

/** The gateway reads the strip makes (GatewayClient satisfies it). */
export type EntityTilesGateway = {
  list_entities(): Promise<{ entities: any[] }>;
  get_entity_card(name: string): Promise<any>;
  get_entity_cognition(name: string): Promise<any>;
};

export type EntityTilesSink = {
  /** The strip's tiles, roster order, a NEW array each time (never mutated in place). */
  tiles(tiles: EntityTile[]): void;
  /** The roster's full size (the head's "N of total"). */
  total(n: number): void;
  /** The strip's one-line error: "" when there is none (or the gateway has no entity door). */
  error(message: string): void;
};

type CardFields = Pick<
  EntityTile,
  | "age_days"
  | "last_moment"
  | "last_moment_at"
  | "open_questions"
  | "open_questions_total"
  | "open_problems"
  | "open_problems_total"
  | "lessons"
  | "lessons_total"
  | "dreams_brief"
>;
type CognitionFields = Pick<EntityTile, "working" | "tokens_total" | "live_visit_tokens" | "spend_warning" | "live_phase">;

const NO_CARD: CardFields = {
  age_days: null,
  last_moment: "",
  last_moment_at: "",
  open_questions: [],
  open_questions_total: 0,
  open_problems: [],
  open_problems_total: 0,
  lessons: [],
  lessons_total: 0,
  dreams_brief: null,
};
const NO_COGNITION: CognitionFields = { working: null, tokens_total: null, live_visit_tokens: null, spend_warning: "", live_phase: "" };

/** The state word of a roster row or a card: the state is an OBJECT {state, changed_at, reason,
 * written_by} (verified against castor 2026-07-12); a bare string is accepted. */
function state_word(x: any): string {
  const s = x?.state;
  if (s && typeof s === "object") return String(s.state ?? "").trim();
  return typeof s === "string" ? s.trim() : "";
}

function state_changed_at(x: any): string {
  const s = x?.state;
  return s && typeof s === "object" ? String(s.changed_at ?? "") : "";
}

/** The card's fields a tile shows (moments entries carry {kind, at}, no title). */
export function card_fields(card: any): CardFields {
  const moments = Array.isArray(card?.moments) ? card.moments : [];
  const last = moments.length ? moments[moments.length - 1] : null;
  // Access-hint lane (plan §observer 2): open questions/problems briefs off the card,
  // render-when-present — pre-M-A cards simply have no entry_id and the chips degrade to text.
  const briefs = extract_open_briefs(card);
  return {
    age_days: typeof card?.age_days === "number" ? card.age_days : null,
    last_moment: String(last?.kind || "").trim(),
    last_moment_at: String(last?.at || "").trim(),
    open_questions: briefs.questions,
    open_questions_total: briefs.questions_total,
    open_problems: briefs.problems,
    open_problems_total: briefs.problems_total,
    lessons: briefs.lessons,
    lessons_total: briefs.lessons_total,
    dreams_brief: extract_dreams_brief(card),
  };
}

/** The cognition wire's fields (gateway c1390). null = wire absent (pre-wire gateways 404 it):
 * the tile degrades to the moment-age heuristic, never fabricates. */
export function cognition_fields(cog: any): CognitionFields {
  if (!cog) return NO_COGNITION;
  const lifetime = cog?.spend?.lifetime;
  const live_visit = cog?.spend?.live_visit;
  const warnings = Array.isArray(cog?.warnings) ? cog.warnings.map((w: any) => String(w || "")).filter(Boolean) : [];
  return {
    working: typeof cog?.working === "boolean" ? cog.working : null,
    tokens_total: typeof lifetime?.tokens_total === "number" ? lifetime.tokens_total : null,
    live_visit_tokens: typeof live_visit?.tokens_total === "number" ? live_visit.tokens_total : null,
    spend_warning: warnings.join(" | "),
    live_phase: typeof cog?.phase === "string" ? cog.phase : "",
  };
}

type RosterRow = { name: string; identity_ref: IdentityRef | null; state: string; changed_at: string };

type CardEntry = {
  fields: CardFields;
  /** The card's own state word: the tile's fallback when the roster row carries none. */
  state: string;
  /** When the card was read (loader clock). */
  fetched_at: number;
  /** The roster row's `state.changed_at` when the read was queued: a different one means the
   * entity moved since, and the card is read again. */
  changed_at: string;
};

export type EntityTilesLoader = {
  /** One tick: the roster, then cognition for every tile, cards queued as needed. Resolves once the
   * roster and the cognition reads have settled (cards keep arriving after). Returns false when it
   * stood down (rate-limit window) or was stopped. */
  refresh(): Promise<boolean>;
  /** Ends the loader: nothing it receives afterwards reaches the sink. */
  stop(): void;
};

export function create_entity_tiles_loader(opts: {
  gateway: EntityTilesGateway;
  sink: EntityTilesSink;
  /** True during a gateway auth-lockout window (429 courtesy): nothing is requested. */
  is_rate_limited?: () => boolean;
  now?: () => number;
  card_ttl_ms?: number;
  card_concurrency?: number;
  /** How per-entity updates reach the sink: the app batches them to one render per frame. Tests
   * pass a synchronous scheduler. The roster's tiles are always emitted at once. */
  schedule?: (fn: () => void) => void;
}): EntityTilesLoader {
  const { gateway, sink } = opts;
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.card_ttl_ms ?? ENTITY_CARD_TTL_MS;
  const concurrency = Math.max(1, opts.card_concurrency ?? ENTITY_CARD_CONCURRENCY);
  const rate_limited = opts.is_rate_limited ?? (() => false);
  const schedule = opts.schedule ?? ((fn: () => void) => void setTimeout(fn, 16));

  let stopped = false;
  /** Current tiles by name, roster order kept in `order`. */
  let tiles = new Map<string, EntityTile>();
  let order: string[] = [];
  /** Card cache, per entity, across refreshes. Lives as long as the loader: a sign-out or a
   * gateway switch ends the loader (the app's effect), so nothing crosses a trust boundary. */
  const cards = new Map<string, CardEntry>();
  /** Last card failure per entity (cleared by a good read). */
  const card_errors = new Map<string, string>();
  const queue: Array<{ name: string; changed_at: string }> = [];
  const queued = new Set<string>();
  const in_flight = new Set<string>();
  let flush_pending = false;

  const emit_now = () => {
    flush_pending = false;
    if (stopped) return;
    sink.tiles(order.map((n) => tiles.get(n)!).filter(Boolean));
  };
  const emit_soon = () => {
    if (flush_pending || stopped) return;
    flush_pending = true;
    schedule(emit_now);
  };

  const patch = (name: string, fields: Partial<EntityTile>) => {
    const t = tiles.get(name);
    if (!t || stopped) return;
    tiles.set(name, { ...t, ...fields });
    emit_soon();
  };

  /** The card part of a tile from what is known: the cached card, else pending or failed. */
  const card_part = (name: string, roster_state: string): Partial<EntityTile> => {
    const entry = cards.get(name);
    const err = card_errors.get(name) || "";
    if (entry) return { ...entry.fields, state: roster_state || entry.state, card_state: "loaded", error: err };
    if (err) return { ...NO_CARD, state: roster_state, card_state: "failed", error: err };
    return { ...NO_CARD, state: roster_state, card_state: "pending", error: "" };
  };

  const pump = () => {
    while (!stopped && in_flight.size < concurrency && queue.length) {
      if (rate_limited()) {
        // Stand down: drop the queue; the next tick queues whatever is still stale.
        for (const q of queue) queued.delete(q.name);
        queue.length = 0;
        return;
      }
      const { name, changed_at } = queue.shift()!;
      queued.delete(name);
      in_flight.add(name);
      gateway
        .get_entity_card(name)
        .then(
          (card) => {
            if (stopped) return;
            cards.set(name, { fields: card_fields(card), state: state_word(card), fetched_at: now(), changed_at });
            card_errors.delete(name);
          },
          (e: any) => {
            if (stopped) return;
            // A failed read keeps what the tile knew (older card fields, or the roster's) and is
            // retried at the next tick: the cache entry, if any, keeps its old read time.
            card_errors.set(name, String(e?.message || e || "card failed"));
          },
        )
        .finally(() => {
          in_flight.delete(name);
          if (stopped) return;
          const t = tiles.get(name);
          if (t) patch(name, card_part(name, roster_state_of(name)));
          pump();
        });
    }
  };

  const roster_states = new Map<string, string>();
  const roster_state_of = (name: string) => roster_states.get(name) || "";

  const card_is_stale = (name: string, changed_at: string): boolean => {
    const entry = cards.get(name);
    if (!entry) return true;
    if (now() - entry.fetched_at >= ttl) return true;
    return entry.changed_at !== changed_at;
  };

  const refresh = async (): Promise<boolean> => {
    if (stopped) return false;
    // Stand down during a gateway auth-lockout window (429 courtesy).
    if (rate_limited()) return false;
    let rows: RosterRow[];
    try {
      const roster = await gateway.list_entities();
      if (stopped) return false;
      sink.total(roster.entities.length);
      // Each tile keeps its row's identity ref (framework ADR 0052): the board draws the look it names.
      rows = roster.entities
        .map((e: any) => ({
          name: String(e?.name || e?.slug || "").trim(),
          identity_ref: entity_row_ref(e),
          state: state_word(e),
          changed_at: state_changed_at(e),
        }))
        .filter((r: RosterRow) => Boolean(r.name))
        .slice(0, ENTITY_TILES_MAX);
    } catch (e: any) {
      // No entity door on this gateway is a normal deployment, not an error.
      if (stopped) return false;
      tiles = new Map();
      order = [];
      sink.tiles([]);
      const msg = String(e?.message || e || "");
      sink.error(/404|not found/i.test(msg) ? "" : msg);
      return true;
    }

    // Tiles from the roster at once: what the previous tick knew (cognition, the cached card)
    // stays on the tile until the new answers replace it — nothing blanks on a refresh.
    const next = new Map<string, EntityTile>();
    for (const r of rows) {
      roster_states.set(r.name, r.state);
      const prev = tiles.get(r.name);
      next.set(r.name, {
        name: r.name,
        identity_ref: r.identity_ref,
        ...(prev ? pick_cognition(prev) : { ...NO_COGNITION, cognition_pending: true }),
        ...(card_part(r.name, r.state) as CardFields & Pick<EntityTile, "state" | "error" | "card_state">),
      } as EntityTile);
    }
    const names = new Set(rows.map((r) => r.name));
    for (const n of [...cards.keys()]) if (!names.has(n)) cards.delete(n);
    for (const n of [...card_errors.keys()]) if (!names.has(n)) card_errors.delete(n);
    for (const n of [...roster_states.keys()]) if (!names.has(n)) roster_states.delete(n);
    tiles = next;
    order = rows.map((r) => r.name);
    flush_pending = false;
    sink.tiles(order.map((n) => tiles.get(n)!));
    sink.error("");

    // Cognition first (cheap, live): every request is issued before any card, so the browser's
    // per-host queue serves them first.
    const cognition = rows.map((r) =>
      gateway
        .get_entity_cognition(r.name)
        .catch(() => null)
        .then((cog) => patch(r.name, { ...cognition_fields(cog), cognition_pending: false })),
    );
    // Cards: only the stale ones, never twice in the queue or while one is in flight.
    for (const r of rows) {
      if (queued.has(r.name) || in_flight.has(r.name)) continue;
      if (!card_is_stale(r.name, r.changed_at)) continue;
      queue.push({ name: r.name, changed_at: r.changed_at });
      queued.add(r.name);
    }
    pump();
    await Promise.all(cognition);
    return !stopped;
  };

  return {
    refresh,
    stop() {
      stopped = true;
      queue.length = 0;
      queued.clear();
    },
  };
}

function pick_cognition(t: EntityTile): CognitionFields & Pick<EntityTile, "cognition_pending"> {
  return {
    working: t.working,
    tokens_total: t.tokens_total,
    live_visit_tokens: t.live_visit_tokens,
    spend_warning: t.spend_warning,
    live_phase: t.live_phase,
    cognition_pending: t.cognition_pending,
  };
}
