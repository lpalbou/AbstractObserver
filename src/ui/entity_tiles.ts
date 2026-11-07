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
// Nothing blanks: a failed roster, cognition or card read keeps what was last known (and says how
// old it is); everything known belongs to ONE gateway and signed-in account (the loader's scope).

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
/** On a gateway without the cognition wire (404), busy/idle comes from the card's last moment: the
 * card is then read at every 30 s refresh (any card older than half a refresh is stale), so that
 * fact is never older than it was before 0.12.2. */
export const ENTITY_CARD_TTL_NO_COGNITION_MS = ENTITY_REFRESH_MS / 2;

const is_not_found = (msg: string) => /\b404\b|not found/i.test(msg);
const message_of = (e: any, fallback: string) => String(e?.message || e || fallback);

/** The gateway reads the strip makes (GatewayClient satisfies it). */
export type EntityTilesGateway = {
  list_entities(): Promise<{ entities: any[] }>;
  get_entity_card(name: string): Promise<any>;
  get_entity_cognition(name: string): Promise<any>;
};

export type EntityTilesSink = {
  /** The strip's tiles, roster order, a NEW array each time (never mutated in place); null = not
   * known yet (another gateway or account: the strip goes back to its placeholders). */
  tiles(tiles: EntityTile[] | null): void;
  /** The roster's full size (the head's "N of total"). */
  total(n: number): void;
  /** The strip's one-line error: "" when there is none (or the gateway has no entity door). When
   * the roster cannot be read again, the last tiles stay and this line says since when. */
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

/** Everything the loader knows, for ONE gateway + signed-in account. A new scope starts empty:
 * no tile, card or cognition fact of another account is ever shown or reused, and answers to
 * requests made under an older scope are dropped. */
type ScopeState = {
  scope: string;
  /** Current tiles by name, roster order kept in `order`. */
  tiles: Map<string, EntityTile>;
  order: string[];
  /** When the roster was last read (loader clock): the stale note's time. */
  roster_at: number | null;
  /** Card cache by entity name, kept across refreshes. */
  cards: Map<string, CardEntry>;
  /** Last card failure per entity (cleared by a good read). */
  card_errors: Map<string, string>;
  roster_states: Map<string, string>;
  /** Entities whose cognition read answered 404 (pre-wire gateway): their cards are read every tick. */
  no_cognition: Set<string>;
  queue: Array<{ name: string; changed_at: string }>;
  queued: Set<string>;
  in_flight: Set<string>;
};

const new_scope = (scope: string): ScopeState => ({
  scope,
  tiles: new Map(),
  order: [],
  roster_at: null,
  cards: new Map(),
  card_errors: new Map(),
  roster_states: new Map(),
  no_cognition: new Set(),
  queue: [],
  queued: new Set(),
  in_flight: new Set(),
});

/** "10:42" for a time today, the date too otherwise: the stale note's "read at …". */
function clock_words(ms: number, now_ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return new Date(now_ms).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString()} ${time}`;
}

/** The strip's line when the roster could not be read again and the last tiles stay (plain words:
 * the gateway's error text is for the log, not the Board). */
export function stale_roster_note(read_at_ms: number, now_ms: number): string {
  return `Could not refresh the entities; showing what was read at ${clock_words(read_at_ms, now_ms)}.`;
}

export function create_entity_tiles_loader(opts: {
  gateway: EntityTilesGateway;
  sink: EntityTilesSink;
  /** The gateway + signed-in account the reads are made as (e.g. "<gateway url>|<user id>"), read
   * at every refresh. When it changes, everything known so far is dropped. */
  scope?: () => string;
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
  const scope_of = opts.scope ?? (() => "");
  const schedule = opts.schedule ?? ((fn: () => void) => void setTimeout(fn, 16));

  let stopped = false;
  let S = new_scope(scope_of());
  let flush_pending = false;

  const emit_now = () => {
    flush_pending = false;
    if (stopped) return;
    sink.tiles(S.order.map((n) => S.tiles.get(n)!).filter(Boolean));
  };
  const emit_soon = () => {
    if (flush_pending || stopped) return;
    flush_pending = true;
    schedule(emit_now);
  };

  /** Applies an answer to the current tile — only when it was asked under the current scope. */
  const patch = (st: ScopeState, name: string, fields: Partial<EntityTile>) => {
    if (stopped || st !== S) return;
    const t = S.tiles.get(name);
    if (!t) return;
    S.tiles.set(name, { ...t, ...fields });
    emit_soon();
  };

  /** The card part of a tile from what is known: the cached card (with its age when the last read
   * of it failed), else pending or failed. */
  const card_part = (st: ScopeState, name: string): Partial<EntityTile> => {
    const roster_state = st.roster_states.get(name) || "";
    const entry = st.cards.get(name);
    const err = st.card_errors.get(name) || "";
    if (entry) {
      return { ...entry.fields, state: roster_state || entry.state, card_state: "loaded", error: err, card_as_of_ms: err ? entry.fetched_at : null };
    }
    if (err) return { ...NO_CARD, state: roster_state, card_state: "failed", error: err, card_as_of_ms: null };
    return { ...NO_CARD, state: roster_state, card_state: "pending", error: "", card_as_of_ms: null };
  };

  const pump = () => {
    const st = S;
    while (!stopped && st.in_flight.size < concurrency && st.queue.length) {
      if (rate_limited()) {
        // Stand down: drop the queue; the next tick queues whatever is still stale.
        for (const q of st.queue) st.queued.delete(q.name);
        st.queue.length = 0;
        return;
      }
      const { name, changed_at } = st.queue.shift()!;
      st.queued.delete(name);
      st.in_flight.add(name);
      gateway
        .get_entity_card(name)
        .then(
          (card) => {
            if (stopped) return;
            st.cards.set(name, { fields: card_fields(card), state: state_word(card), fetched_at: now(), changed_at });
            st.card_errors.delete(name);
          },
          (e: any) => {
            if (stopped) return;
            // A failed read keeps what the tile knew (older card fields, shown with their age, or
            // the roster's) and is retried at the next tick: the cache entry keeps its old read time.
            st.card_errors.set(name, message_of(e, "card failed"));
          },
        )
        .finally(() => {
          st.in_flight.delete(name);
          if (stopped || st !== S) return;
          patch(st, name, card_part(st, name));
          pump();
        });
    }
  };

  const card_is_stale = (st: ScopeState, name: string, changed_at: string): boolean => {
    const entry = st.cards.get(name);
    if (!entry) return true;
    const limit = st.no_cognition.has(name) ? Math.min(ttl, ENTITY_CARD_TTL_NO_COGNITION_MS) : ttl;
    if (now() - entry.fetched_at >= limit) return true;
    return entry.changed_at !== changed_at;
  };

  const refresh = async (): Promise<boolean> => {
    if (stopped) return false;
    // Stand down during a gateway auth-lockout window (429 courtesy).
    if (rate_limited()) return false;
    // Another gateway or account: start from nothing (the old answers are dropped by `st !== S`).
    const scope = scope_of();
    if (scope !== S.scope) {
      S = new_scope(scope);
      flush_pending = false;
      sink.tiles(null);
    }
    const st = S;
    let rows: RosterRow[];
    try {
      const roster = await gateway.list_entities();
      if (stopped || st !== S) return false;
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
      if (stopped || st !== S) return false;
      const msg = message_of(e, "");
      // No entity door on this gateway is a normal deployment, not an error: no tiles.
      if (is_not_found(msg)) {
        st.tiles = new Map();
        st.order = [];
        sink.tiles([]);
        sink.error("");
        return true;
      }
      // Any other failure keeps the last tiles and says since when (never blanks the strip).
      if (st.order.length && st.roster_at !== null) {
        emit_now();
        sink.error(stale_roster_note(st.roster_at, now()));
      } else {
        sink.tiles([]);
        sink.error(msg);
      }
      return true;
    }

    // Tiles from the roster at once: what the previous tick knew (cognition, the cached card)
    // stays on the tile until the new answers replace it — nothing blanks on a refresh.
    const names = new Set(rows.map((r) => r.name));
    for (const r of rows) st.roster_states.set(r.name, r.state);
    for (const n of [...st.cards.keys()]) if (!names.has(n)) st.cards.delete(n);
    for (const n of [...st.card_errors.keys()]) if (!names.has(n)) st.card_errors.delete(n);
    for (const n of [...st.roster_states.keys()]) if (!names.has(n)) st.roster_states.delete(n);
    for (const n of [...st.no_cognition]) if (!names.has(n)) st.no_cognition.delete(n);
    const next = new Map<string, EntityTile>();
    for (const r of rows) {
      const prev = st.tiles.get(r.name);
      next.set(r.name, {
        name: r.name,
        identity_ref: r.identity_ref,
        ...(prev ? pick_cognition(prev) : { ...NO_COGNITION, cognition_pending: true }),
        ...card_part(st, r.name),
      } as EntityTile);
    }
    st.tiles = next;
    st.order = rows.map((r) => r.name);
    st.roster_at = now();
    flush_pending = false;
    sink.tiles(st.order.map((n) => st.tiles.get(n)!));
    sink.error("");

    // Cognition first (cheap, live): every request is issued before any card, so the browser's
    // per-host queue serves them first. A 404 means the wire is absent (the tile falls back to the
    // card's last moment); any other failure keeps the last busy/idle and spend facts.
    const cognition = rows.map((r) =>
      gateway.get_entity_cognition(r.name).then(
        (cog) => {
          if (st !== S) return;
          st.no_cognition.delete(r.name);
          patch(st, r.name, { ...cognition_fields(cog), cognition_pending: false });
        },
        (e: any) => {
          if (st !== S) return;
          if (is_not_found(message_of(e, ""))) {
            st.no_cognition.add(r.name);
            patch(st, r.name, { ...NO_COGNITION, cognition_pending: false });
          } else {
            patch(st, r.name, { cognition_pending: false });
          }
        },
      ),
    );
    // Cards: only the stale ones, never twice in the queue or while one is in flight.
    for (const r of rows) {
      if (st.queued.has(r.name) || st.in_flight.has(r.name)) continue;
      if (!card_is_stale(st, r.name, r.changed_at)) continue;
      st.queue.push({ name: r.name, changed_at: r.changed_at });
      st.queued.add(r.name);
    }
    pump();
    await Promise.all(cognition);
    return !stopped;
  };

  return {
    refresh,
    stop() {
      stopped = true;
      S.queue.length = 0;
      S.queued.clear();
    },
  };
}

/** The strip's poll: a refresh, then the next one 30 s after it settles — also after a refresh
 * that stood down (rate limit), so the strip resumes on its own. Returns the stop function. */
export function start_entity_tiles_poll(loader: EntityTilesLoader, interval_ms = ENTITY_REFRESH_MS): () => void {
  let stop = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    try {
      await loader.refresh();
    } finally {
      if (!stop) timer = setTimeout(() => void tick(), interval_ms);
    }
  };
  void tick();
  return () => {
    stop = true;
    loader.stop();
    if (timer !== null) clearTimeout(timer);
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
