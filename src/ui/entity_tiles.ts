// The Board's Entities strip: one shared kit `EntityCard` per entity (operator 2026-11-07: "there
// is zero information", "an ENTITY CARD should be a sharable component").
//
// Two ways to fill a card, chosen by what the gateway's roster (`GET /entities`) says:
//   - the TILE read (gateway 0.21.0, backlog 1012): the roster carries `reads.tile`, and each card
//     is one `GET /entities/{name}/tile` (about 2 KB: who, now, into lately, on its mind, last
//     moment, age, mind, counts), read again every 30 s. Nothing else is read per entity.
//   - the FALLBACK, only on an older gateway whose roster carries no `reads.tile`: the card +
//     cognition reads of 0.12.2 (cognition every 30 s, cards a few at a time, kept 5 minutes or
//     until the entity's state changed), turned into the same tile shape here, so one card draws
//     both.
// The roster draws every card at once (name and look, "loading" until its facts arrive); each card
// updates when its own answer arrives. Nothing blanks: a failed roster read keeps the last cards and
// says since when; a failed tile or card read keeps the older facts ("stale", with their read
// time), or says the details are unavailable when nothing was known. Everything known belongs to
// ONE gateway and signed-in account (the loader's scope). During a gateway auth-lockout window
// (429 courtesy) nothing is requested.

import { entityMomentWords, type EntityTile as KitEntityTile, type EntityTilePhase } from "@abstractframework/ui-kit";

import { ENTITY_TILES_MAX, type EntityTile, type EntityTileLook } from "./mission_control";

/** Roster + tile (or cognition) cadence. */
export const ENTITY_REFRESH_MS = 30_000;
/** Fallback only: a card is read again after 5 minutes even when the state did not change (what
 * it carries moves slowly; the live facts come from cognition every 30 s), or at the next tick
 * when the roster row's `state.changed_at` moved. */
export const ENTITY_CARD_TTL_MS = 5 * 60_000;
/** Reads in flight at once (tiles, or the fallback's cards). Browsers open ~6 connections per host
 * (HTTP/1.1): three leave three for the roster and every other Board read. A tile is usually a
 * cached projection (tens of ms); a grown life recomputes once and can take seconds. */
export const ENTITY_CARD_CONCURRENCY = 3;
/** Fallback on a gateway without the cognition wire (404): the card is read at every refresh. */
export const ENTITY_CARD_TTL_NO_COGNITION_MS = ENTITY_REFRESH_MS / 2;

const is_not_found = (msg: string) => /\b404\b|not found/i.test(msg);
const message_of = (e: any, fallback: string) => String(e?.message || e || fallback);

/** The gateway reads the strip makes (GatewayClient satisfies it). */
export type EntityTilesGateway = {
  list_entities(): Promise<{ entities: any[]; reads?: any }>;
  get_entity_tile(name: string): Promise<any>;
  get_entity_card(name: string): Promise<any>;
  get_entity_cognition(name: string): Promise<any>;
};

export type EntityTilesSink = {
  /** The strip's cards, roster order, a NEW array each time (never mutated in place); null = not
   * known yet (another gateway or account: the strip goes back to its placeholders). */
  tiles(tiles: EntityTile[] | null): void;
  /** The roster's full size (the head's "N of total"). */
  total(n: number): void;
  /** The strip's one-line error: "" when there is none (or the gateway has no entity door). When
   * the roster cannot be read again, the last cards stay and this line says since when. */
  error(message: string): void;
};

/** True when the roster advertises the tile read (gateway 0.21.0: `reads.tile.available`). */
export function roster_has_tile_read(roster: any): boolean {
  return roster?.reads?.tile?.available === true;
}

/** The state word of a roster row or a card: the state is an OBJECT {state, changed_at, reason,
 * written_by}; a bare string is accepted. */
function state_word(x: any): string {
  const s = x?.state;
  if (s && typeof s === "object") return String(s.state ?? "").trim();
  return typeof s === "string" ? s.trim() : "";
}

function state_changed_at(x: any): string {
  const s = x?.state;
  return s && typeof s === "object" ? String(s.changed_at ?? "") : "";
}

/** The look a roster row names (its identity record's design and colour), or null. */
export function roster_look(row: any): EntityTileLook | null {
  const avatar = row?.identity?.avatar;
  if (!avatar || typeof avatar !== "object") return null;
  const style = typeof avatar.style === "string" && avatar.style.trim() ? avatar.style.trim() : null;
  const color = typeof avatar.color === "string" && avatar.color.trim() ? avatar.color.trim() : null;
  return style || color ? { style, color } : null;
}

// --------------------------------------------------------------------------- the fallback's tile

const RULED_PHASES: ReadonlyArray<EntityTilePhase> = ["visit", "work", "personal", "sleep"];
/** The engraved spellings of the own-time moments (append-only streams carry both). */
const ENGRAVED_TWINS: Record<string, string> = {
  own_time_started: "personal_started",
  own_time_stop_requested: "personal_stop_requested",
  own_time_frozen: "personal_frozen",
};

type CardFacts = Pick<KitEntityTile, "age_days" | "into_lately" | "on_its_mind" | "latest_lesson" | "last_moment" | "counts">;
type CognitionFacts = { phase: EntityTilePhase; state: string | null; detail: KitEntityTile["now"]["detail"]; busy: boolean; trouble: KitEntityTile["now"]["trouble"] };

const text_of = (row: any): string => String(row?.statement || "").trim() || String(row?.title || "").trim();
const at_of = (row: any): string | null => String(row?.observed_at || "").trim() || null;
const rows_of = (v: any): any[] => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object" && text_of(r)) : []);
const newest = (rows: any[]): any | null => rows.reduce((best, r) => (best === null || String(r.observed_at || "") >= String(best.observed_at || "") ? r : best), null);

/** An older gateway's `/card` as the tile's facts (the same sections the gateway's tile projects):
 * newest interests, the newest open problem or question, the latest lesson, the last moment a
 * person recognises (one the kit has words for), age and counts. */
export function card_facts(card: any): CardFacts {
  const interests = rows_of(card?.discoveries?.interests).sort((a, b) => String(b.observed_at || "").localeCompare(String(a.observed_at || "")));
  const questions = Array.isArray(card?.questions?.open) ? card.questions.open.filter((r: any) => r && typeof r === "object") : [];
  const problems = Array.isArray(card?.problems?.open) ? card.problems.open.filter((r: any) => r && typeof r === "object") : [];
  const lessons = Array.isArray(card?.lessons?.lessons) ? card.lessons.lessons.filter((r: any) => r && typeof r === "object") : [];
  const problem = newest(rows_of(problems));
  const question = newest(rows_of(questions));
  // The newest of the two; a problem wins a tie (the gateway tile's rule).
  const mind_row = problem && (!question || String(problem.observed_at || "") >= String(question.observed_at || "")) ? { kind: "problem" as const, row: problem } : question ? { kind: "question" as const, row: question } : null;
  const lesson = newest(rows_of(lessons));
  const moments = (Array.isArray(card?.moments) ? card.moments : [])
    .filter((m: any) => m && typeof m === "object" && String(m.at || "").trim())
    .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
  let last_moment: KitEntityTile["last_moment"] = null;
  for (const m of moments) {
    const kind = ENGRAVED_TWINS[String(m.kind || "")] ?? String(m.kind || "");
    const details = m.details && typeof m.details === "object" ? m.details : {};
    // The birth recording of a default identity is not a change anyone made (ADR 0052 §7).
    if (kind === "identity_changed" && details.cause === "recorded_default") continue;
    const candidate = { kind, at: String(m.at), ...(typeof details.to === "string" ? { to: details.to } : {}), ...(typeof details.change === "string" ? { change: details.change } : {}) };
    if (!entityMomentWords(candidate)) continue; // a kind the kit has no words for is not a moment shown
    last_moment = candidate;
    break;
  }
  return {
    age_days: typeof card?.age_days === "number" ? card.age_days : null,
    into_lately: interests.slice(0, 3).map((r) => ({ text: text_of(r), at: at_of(r), explored: Boolean(r.explored) })),
    on_its_mind: mind_row ? { kind: mind_row.kind, text: text_of(mind_row.row), at: at_of(mind_row.row) } : null,
    latest_lesson: lesson ? { text: text_of(lesson), at: at_of(lesson) } : null,
    last_moment,
    counts: {
      open_questions: questions.length,
      open_problems: problems.length,
      lessons: typeof card?.lessons?.total === "number" ? card.lessons.total : lessons.length,
      interests: interests.length,
      sleeps: null,
    },
  };
}

/** An older gateway's `/cognition` as the tile's "now": the one composite phase (a phase that is
 * not a ruled word = stopped, the gateway tile's fold), busy, and the own-time-failed trouble. */
export function cognition_facts(cog: any): CognitionFacts {
  const phase: EntityTilePhase = RULED_PHASES.includes(cog?.phase) ? cog.phase : "stopped";
  const loop = cog?.loop && typeof cog.loop === "object" ? cog.loop : {};
  const detail = phase === "sleep" && ["resting", "dreaming", "bounded"].includes(cog?.sleep_detail) ? cog.sleep_detail : null;
  return {
    phase,
    state: state_word(cog) || null,
    detail,
    busy: cog?.working === true,
    trouble: !loop.running && loop.stopped_by === "failures" ? { kind: "own_time_failed", at: String(loop.updated_at || "") || null } : null,
  };
}

/** The tile's "now" when the gateway has no cognition wire: only what the state word says for
 * sure (stopped, asleep); "awake" alone does not say whether it is in a visit or resting. */
function now_from_state(word: string): KitEntityTile["now"] | null {
  if (word === "paused") return { phase: "stopped", state: word, detail: null, busy: false, since: null, trouble: null };
  if (word === "asleep") return { phase: "sleep", state: word, detail: null, busy: false, since: null, trouble: null };
  return null;
}

/** The kit tile drawn from an older gateway's card (+ cognition when the wire exists). */
export function fallback_tile(name: string, look: EntityTileLook | null, card: CardFacts, cognition: CognitionFacts | null, state: string): KitEntityTile {
  const now = cognition ? { ...cognition, since: null } : now_from_state(state);
  return {
    tile_version: 1,
    name,
    slug: name,
    look,
    born: null,
    mind: null,
    ...card,
    // `now` may be unknown (no cognition wire, state "awake"): the card then shows no now line.
    now: now as KitEntityTile["now"],
  };
}

// --------------------------------------------------------------------------- the loader

type RosterRow = { name: string; look: EntityTileLook | null; state: string; changed_at: string };

/** One entity's last tile read (tile path). */
type TileRead = { tile: KitEntityTile | null; read_at: number | null; error: string };

type CardEntry = { facts: CardFacts; state: string; fetched_at: number; changed_at: string };

export type EntityTilesLoader = {
  /** One tick: the roster, then the tiles (or, on an older gateway, cognition for every card and
   * the stale cards queued). Resolves once the roster and those reads have settled (fallback cards
   * keep arriving after). Returns false when it stood down (rate-limit window) or was stopped. */
  refresh(): Promise<boolean>;
  /** Ends the loader: nothing it receives afterwards reaches the sink. */
  stop(): void;
};

/** Everything the loader knows, for ONE gateway + signed-in account. A new scope starts empty:
 * no fact of another account is ever shown or reused, and answers to requests made under an older
 * scope are dropped. */
type ScopeState = {
  scope: string;
  /** "tile" when the roster advertises the tile read, else "card" (older gateway). */
  mode: "tile" | "card";
  rows: Map<string, RosterRow>;
  order: string[];
  roster_at: number | null;
  // tile path
  reads: Map<string, TileRead>;
  // fallback path
  cards: Map<string, CardEntry>;
  card_errors: Map<string, string>;
  cognition: Map<string, CognitionFacts | null>;
  cognition_settled: Set<string>;
  no_cognition: Set<string>;
  queue: Array<{ name: string; changed_at: string }>;
  queued: Set<string>;
  in_flight: Set<string>;
};

const new_scope = (scope: string): ScopeState => ({
  scope,
  mode: "tile",
  rows: new Map(),
  order: [],
  roster_at: null,
  reads: new Map(),
  cards: new Map(),
  card_errors: new Map(),
  cognition: new Map(),
  cognition_settled: new Set(),
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

/** The strip's line when the roster could not be read again and the last cards stay (plain words:
 * the gateway's error text is for the log, not the Board). */
export function stale_roster_note(read_at_ms: number, now_ms: number): string {
  return `Could not refresh the entities; showing what was read at ${clock_words(read_at_ms, now_ms)}.`;
}

/** One strip card from what the scope knows. */
function board_tile(st: ScopeState, name: string): EntityTile {
  const row = st.rows.get(name);
  const look = row?.look ?? null;
  if (st.mode === "tile") {
    const r = st.reads.get(name);
    if (r?.tile) return { name, look, tile: r.tile, status: r.error ? "stale" : "ready", as_of_ms: r.error ? r.read_at : null, reason: r.error };
    if (r?.error) return { name, look, tile: null, status: "unavailable", as_of_ms: null, reason: r.error };
    return { name, look, tile: null, status: "loading", as_of_ms: null, reason: "" };
  }
  const entry = st.cards.get(name);
  const err = st.card_errors.get(name) || "";
  // A card waits for its first cognition answer too, so its "now" line does not change under the reader.
  if (entry && st.cognition_settled.has(name)) {
    const tile = fallback_tile(name, look, entry.facts, st.cognition.get(name) ?? null, row?.state || entry.state);
    return { name, look, tile, status: err ? "stale" : "ready", as_of_ms: err ? entry.fetched_at : null, reason: err };
  }
  if (!entry && err) return { name, look, tile: null, status: "unavailable", as_of_ms: null, reason: err };
  return { name, look, tile: null, status: "loading", as_of_ms: null, reason: "" };
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
   * pass a synchronous scheduler. The roster's cards are always emitted at once. */
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
    sink.tiles(S.order.map((n) => board_tile(S, n)));
  };
  const emit_soon = (st: ScopeState) => {
    if (flush_pending || stopped || st !== S) return;
    flush_pending = true;
    schedule(emit_now);
  };
  const live = (st: ScopeState) => !stopped && st === S;

  // ---- tile path: every tile read again at each tick, a few at a time.
  const read_tiles = async (st: ScopeState, names: string[]): Promise<void> => {
    const todo = [...names];
    const worker = async () => {
      while (todo.length && live(st)) {
        if (rate_limited()) {
          todo.length = 0; // stand down: the next tick reads them again
          return;
        }
        const name = todo.shift()!;
        try {
          const tile = await gateway.get_entity_tile(name);
          if (!live(st)) return;
          st.reads.set(name, { tile, read_at: now(), error: "" });
        } catch (e: any) {
          if (!live(st)) return;
          // A failed read keeps the older tile (shown as stale with its read time) and is tried
          // again at the next tick.
          const prev = st.reads.get(name);
          st.reads.set(name, { tile: prev?.tile ?? null, read_at: prev?.read_at ?? null, error: message_of(e, "tile failed") });
        }
        emit_soon(st);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  };

  // ---- fallback path (older gateway): cognition for every card, cards when stale.
  const pump = () => {
    const st = S;
    while (!stopped && st.in_flight.size < concurrency && st.queue.length) {
      if (rate_limited()) {
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
            st.cards.set(name, { facts: card_facts(card), state: state_word(card), fetched_at: now(), changed_at });
            st.card_errors.delete(name);
          },
          (e: any) => {
            if (stopped) return;
            st.card_errors.set(name, message_of(e, "card failed"));
          },
        )
        .finally(() => {
          st.in_flight.delete(name);
          if (!live(st)) return;
          emit_soon(st);
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

  const read_cards = async (st: ScopeState, rows: RosterRow[]): Promise<void> => {
    // Cognition first (cheap, live): every request is issued before any card. A 404 means the wire
    // is absent; any other failure keeps the last answer.
    const cognition = rows.map((r) =>
      gateway.get_entity_cognition(r.name).then(
        (cog) => {
          if (!live(st)) return;
          st.no_cognition.delete(r.name);
          st.cognition.set(r.name, cognition_facts(cog));
          st.cognition_settled.add(r.name);
          emit_soon(st);
        },
        (e: any) => {
          if (!live(st)) return;
          if (is_not_found(message_of(e, ""))) {
            st.no_cognition.add(r.name);
            st.cognition.set(r.name, null);
          }
          st.cognition_settled.add(r.name);
          emit_soon(st);
        },
      ),
    );
    for (const r of rows) {
      if (st.queued.has(r.name) || st.in_flight.has(r.name)) continue;
      if (!card_is_stale(st, r.name, r.changed_at)) continue;
      st.queue.push({ name: r.name, changed_at: r.changed_at });
      st.queued.add(r.name);
    }
    pump();
    await Promise.all(cognition);
  };

  const forget_missing = (st: ScopeState, names: Set<string>) => {
    for (const m of [st.reads, st.cards, st.card_errors, st.cognition] as Map<string, unknown>[]) {
      for (const n of [...m.keys()]) if (!names.has(n)) m.delete(n);
    }
    for (const s of [st.cognition_settled, st.no_cognition]) for (const n of [...s]) if (!names.has(n)) s.delete(n);
  };

  const refresh = async (): Promise<boolean> => {
    if (stopped) return false;
    if (rate_limited()) return false;
    // Another gateway or account: start from nothing (old answers are dropped by `live(st)`).
    const scope = scope_of();
    if (scope !== S.scope) {
      S = new_scope(scope);
      flush_pending = false;
      sink.tiles(null);
    }
    const st = S;
    let rows: RosterRow[];
    let has_tile_read: boolean;
    try {
      const roster = await gateway.list_entities();
      if (!live(st)) return false;
      sink.total(roster.entities.length);
      has_tile_read = roster_has_tile_read(roster);
      rows = roster.entities
        .map((e: any) => ({ name: String(e?.name || e?.slug || "").trim(), look: roster_look(e), state: state_word(e), changed_at: state_changed_at(e) }))
        .filter((r: RosterRow) => Boolean(r.name))
        .slice(0, ENTITY_TILES_MAX);
    } catch (e: any) {
      if (!live(st)) return false;
      const msg = message_of(e, "");
      // No entity door on this gateway is a normal deployment, not an error: no cards.
      if (is_not_found(msg)) {
        st.rows = new Map();
        st.order = [];
        sink.tiles([]);
        sink.error("");
        return true;
      }
      // Any other failure keeps the last cards and says since when (never blanks the strip).
      if (st.order.length && st.roster_at !== null) {
        emit_now();
        sink.error(stale_roster_note(st.roster_at, now()));
      } else {
        sink.tiles([]);
        sink.error(msg);
      }
      return true;
    }

    st.mode = has_tile_read ? "tile" : "card";
    const names = new Set(rows.map((r) => r.name));
    forget_missing(st, names);
    st.rows = new Map(rows.map((r) => [r.name, r]));
    st.order = rows.map((r) => r.name);
    st.roster_at = now();
    flush_pending = false;
    // Every card from the roster at once: what the previous tick knew stays until a new answer
    // replaces it — nothing blanks on a refresh.
    sink.tiles(st.order.map((n) => board_tile(st, n)));
    sink.error("");

    if (st.mode === "tile") await read_tiles(st, st.order);
    else await read_cards(st, rows);
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
