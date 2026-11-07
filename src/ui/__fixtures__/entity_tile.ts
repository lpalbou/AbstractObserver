// A tile exactly as AbstractGateway 0.21.0 serves it (`GET /entities/{name}/tile`, entity_tile.py
// compose_tile, tile_version 1; shapes from its tests/test_gateway_entity_tile.py). Used by the
// strip's tests and the browser checks.
/** A tile as entity_tile.py's compose_tile serves it. */
export function gateway_tile(name: string, over: Record<string, any> = {}): any {
  return {
    tile_version: 1,
    name,
    slug: name.toLowerCase(),
    look: { style: "watch-lotus", color: "#3b82f6" },
    born: "2026-08-07T09:00:00+00:00",
    age_days: 92,
    mind: { model: "test-9b", source: "lived" },
    now: { phase: "sleep", state: "awake", detail: "resting", busy: false, since: "2026-11-07T09:12:00+00:00", trouble: null },
    into_lately: [
      { text: `How ${name} hears the sea at night`, at: "2026-11-06T22:00:00+00:00", explored: false },
      { text: "Why lighthouses blink in patterns", at: "2026-11-05T22:00:00+00:00", explored: true },
    ],
    on_its_mind: { kind: "problem", text: "the notes are lost", at: "2026-11-05T00:00:00+00:00" },
    latest_lesson: { text: "Listening before answering saves a second answer.", at: "2026-11-06T00:00:00+00:00" },
    last_moment: { kind: "session_closed", at: "2026-11-07T09:00:00+00:00" },
    counts: { open_questions: 78, open_problems: 29, lessons: 33, interests: 4, sleeps: 261 },
    as_of_seq: 4182,
    read_at: "2026-11-07T10:00:00+00:00",
    ...over,
  };
}

