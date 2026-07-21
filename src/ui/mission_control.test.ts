import { describe, expect, it } from "vitest";

import {
  ACTIVE_WINDOW_MS,
  COLUMN_EMPTY,
  COLUMN_HINT,
  COLUMN_LABEL,
  DEFAULT_DONE_WINDOW,
  DONE_WINDOW_LABEL,
  DONE_WINDOW_MS,
  TILE_HINTS_BOUND,
  board_card,
  board_column,
  board_columns,
  derive_phase_graph,
  entity_activity_age,
  entity_phase,
  extract_dreams_brief,
  extract_open_briefs,
  filter_done_window,
  format_age,
  format_tokens,
  known_phase_keys,
} from "./mission_control";
import type { RunSummary } from "./run_status";

// The board's promise: column = STATE TRUTH, never prose. Review means a
// HUMAN is the blocker; parked residents are Working; scheduled waits are
// Pending; terminal runs are Done with failures floated first.
function run(partial: Partial<RunSummary>): RunSummary {
  return { run_id: "run_x", status: "running", ...partial } as RunSummary;
}

describe("board_column", () => {
  it("running goes to Working", () => {
    expect(board_column(run({ status: "running" }))).toBe("working");
  });

  it("a parked resident (event wait, no human prompt) is Working, not Review", () => {
    expect(
      board_column(run({ status: "waiting", waiting: { reason: "event", wait_key: "evt:global:global:inbox", allow_free_text: false } })),
    ).toBe("working");
  });

  it("a tool approval is Review", () => {
    expect(
      board_column(
        run({
          status: "waiting",
          waiting: { reason: "user", wait_key: "w1", details: { tool_calls: [{ name: "execute_command", arguments: {} }] } },
        }),
      ),
    ).toBe("review");
  });

  it("a user question is Review", () => {
    expect(board_column(run({ status: "waiting", waiting: { reason: "user", wait_key: "w2", prompt: "Confirm the cap?" } }))).toBe("review");
  });

  it("a scheduled wait is Pending", () => {
    expect(board_column(run({ status: "waiting", waiting: { reason: "until", wait_key: "w3" }, is_scheduled: true }))).toBe("pending");
  });

  it("a subworkflow wait is Working (the child is progressing)", () => {
    expect(board_column(run({ status: "waiting", waiting: { reason: "subworkflow", wait_key: "w4" } }))).toBe("working");
  });

  it("completed and failed and cancelled are Done", () => {
    expect(board_column(run({ status: "completed" }))).toBe("done");
    expect(board_column(run({ status: "failed" }))).toBe("done");
    expect(board_column(run({ status: "cancelled" }))).toBe("done");
  });
});

describe("board_card + board_columns", () => {
  it("carries the wait identity the inline actions need (run_id + wait_key)", () => {
    const card = board_card(
      run({
        run_id: "run_appr",
        status: "waiting",
        waiting: { reason: "user", wait_key: "wk_9", details: { tool_calls: [{ name: "write_file", arguments: {} }] } },
      }),
    );
    expect(card.column).toBe("review");
    expect(card.wait_key).toBe("wk_9");
    expect(card.tool_names).toEqual(["write_file"]);
  });

  it("a SUBRUN tool approval reaches Review while its parked root stays Working (the agent-workflow case)", () => {
    const roots = [run({ run_id: "root1", status: "waiting", waiting: { reason: "subworkflow", wait_key: "sub" } })];
    const all = [
      ...roots,
      run({
        run_id: "child1",
        parent_run_id: "root1",
        status: "waiting",
        waiting: { reason: "user", wait_key: "wk_c", details: { tool_calls: [{ name: "execute_command", arguments: {} }] } },
      }),
    ];
    const cols = board_columns(roots, all);
    expect(cols.review.map((c) => c.run_id)).toEqual(["child1"]);
    expect(cols.review[0].is_subrun).toBe(true);
    expect(cols.review[0].wait_key).toBe("wk_c");
    expect(cols.working.map((c) => c.run_id)).toEqual(["root1"]);
  });

  it("a root in review is not duplicated when it appears in both lists", () => {
    const r = run({ run_id: "rootrev", status: "waiting", waiting: { reason: "user", wait_key: "k", prompt: "?" } });
    const cols = board_columns([r], [r]);
    expect(cols.review.map((c) => c.run_id)).toEqual(["rootrev"]);
    expect(cols.working.length + cols.pending.length + cols.done.length).toBe(0);
  });

  it("a review-classified root still lands in Review when the all-runs page missed it", () => {
    const r = run({ run_id: "missed", status: "waiting", waiting: { reason: "user", wait_key: "k2", prompt: "?" } });
    // all_runs provided but does NOT contain the root (page bounds).
    const cols = board_columns([r], [run({ run_id: "other", status: "running" })]);
    expect(cols.review.map((c) => c.run_id)).toEqual(["missed"]);
  });

  it("failures float to the top of Done", () => {
    const cols = board_columns([
      run({ run_id: "ok1", status: "completed", updated_at: "2026-07-12T10:00:00Z" }),
      run({ run_id: "bad", status: "failed", updated_at: "2026-07-12T09:00:00Z" }),
      run({ run_id: "ok2", status: "completed", updated_at: "2026-07-12T11:00:00Z" }),
    ]);
    expect(cols.done[0].run_id).toBe("bad");
  });

  it("Review sorts oldest wait first (longest-blocked = most urgent)", () => {
    const cols = board_columns([
      run({ run_id: "young", status: "waiting", waiting: { reason: "user", wait_key: "a", prompt: "?", since: "2026-07-12T11:00:00Z" } }),
      run({ run_id: "old", status: "waiting", waiting: { reason: "user", wait_key: "b", prompt: "?", since: "2026-07-12T08:00:00Z" } }),
    ]);
    expect(cols.review.map((c) => c.run_id)).toEqual(["old", "young"]);
  });

  it("runs without an id are dropped, never rendered as ghosts", () => {
    const cols = board_columns([run({ run_id: "" }), run({ run_id: "real" })]);
    const total = cols.pending.length + cols.working.length + cols.review.length + cols.done.length;
    expect(total).toBe(1);
  });
});

describe("entity_phase", () => {
  it("maps the ruled vocabulary and its legacy spellings", () => {
    expect(entity_phase("awake:visiting")).toBe("visit");
    expect(entity_phase("asleep(dream)")).toBe("sleep");
    expect(entity_phase("awake:personal")).toBe("personal");
    expect(entity_phase("own_time")).toBe("personal");
    expect(entity_phase("awake:working")).toBe("work");
    expect(entity_phase("tasked")).toBe("work");
    // AWAKE IS NOT A DWELLING (laurent c203, entity sweep c3548): the bare
    // state-axis word maps to sleep — no operator surface paints AWAKE as
    // a phase chip. The composite awake:* spellings above keep their
    // phase-suffix mapping.
    expect(entity_phase("awake")).toBe("sleep");
    expect(entity_phase("idle")).toBe("sleep");
    expect(entity_phase("")).toBe("unknown");
  });
});

describe("one-graph consumer contract (laurent dm#79, c3563)", () => {
  // A wire-shaped payload mirroring the served artifact's load-bearing
  // fields — asserting SEMANTICS (keys, synonyms, initial), never the
  // full spec bytes (the artifact evolves under entity's pen).
  const payload = {
    sha256: "abc123",
    vendored: true,
    spec: {
      version: 6,
      initial_phase: "sleep",
      phases: {
        visit: { spoken_synonyms: [] },
        work: { spoken_synonyms: [] },
        personal: { spoken_synonyms: ["own-time", "own time"] },
        sleep: { spoken_synonyms: [] },
      },
    },
  };

  it("derives phase words + synonyms + initial from the served artifact", () => {
    const g = derive_phase_graph(payload)!;
    expect(g.phases).toEqual(["visit", "work", "personal", "sleep"]);
    expect(g.initial).toBe("sleep");
    expect(g.version).toBe(6);
    expect(g.sha256).toBe("abc123");
    expect(g.synonyms.some((m) => m.needle === "own time" && m.phase === "personal")).toBe(true);
  });

  it("junk payloads derive nothing — the labeled fallback applies, never a blank board", () => {
    expect(derive_phase_graph(null)).toBeNull();
    expect(derive_phase_graph({})).toBeNull();
    expect(derive_phase_graph({ spec: { phases: {} } })).toBeNull();
  });

  it("graph-driven mapping: exact wire->word table, BOTH paths (adversary F4 — a vacuous loop pinned nothing)", () => {
    const g = derive_phase_graph(payload)!;
    // v7 mode roles (axes_note, entity c3610): visiting DECIDES visit;
    // dreaming DECORATES asleep; RESTING lives INSIDE PERSONAL (the
    // v6-era rest->sleep fold was wrong — owned at c3613).
    const graph_expected: Array<[string, string]> = [
      ["visit", "visit"],
      ["visiting", "visit"],
      ["awake:visiting", "visit"],
      ["asleep", "sleep"],
      ["asleep(dream)", "sleep"],
      ["dreaming", "sleep"],
      ["own_time", "personal"], // separator-normalized synonym (adversary F1)
      ["own time", "personal"],
      ["own-time", "personal"],
      ["awake:personal", "personal"],
      ["awake:working", "work"],
      ["tasked", "work"],
      // A transition CAUSE leaking onto the state channel must never claim
      // WORK (adversary F8 inversion); it passes through under "other" —
      // an honest raw render beats a fabricated phase.
      ["no_task", "no_task"],
      ["awake", "sleep"],
      ["idle", "sleep"],
      ["resting", "personal"], // v7 role: loop-alive between days inside personal
      ["yielded:rest", "personal"],
      ["paused", "paused"],
      ["stopped", "stopped"],
      ["", "unknown"],
    ];
    for (const [wire, expected] of graph_expected) {
      expect(entity_phase(wire, g), `graph path: ${JSON.stringify(wire)}`).toBe(expected);
    }
    // Unlisted server words pass through verbatim under the bounded
    // "other" class — never a ruled style, never a blank.
    expect(entity_phase("mystery_state", g)).toBe("mystery_state");
    expect(known_phase_keys(g).has("mystery_state")).toBe(false);
    expect(known_phase_keys(g).has("awake")).toBe(false); // AWAKE-NEVER-RENDERS holds under the graph too
    // Fallback path parity on the words both paths can meet. Deliberate
    // divergences, each labeled: resting/yielded:rest (fallback stays
    // byte-compatible with the pre-mechanism "resting" chip) and
    // "own-time" (the dash spelling is a graph-path improvement the old
    // map never had — pre-wire gateways never served it either).
    for (const [wire, expected] of graph_expected) {
      if (wire === "resting" || wire === "yielded:rest" || wire === "own-time") continue;
      expect(entity_phase(wire), `fallback path: ${JSON.stringify(wire)}`).toBe(expected);
    }
  });

  it("a graph word WITHOUT an mc_phase_* style wears the bounded other class (adversary F5)", () => {
    const bumped = derive_phase_graph({
      sha256: "x",
      spec: { version: 8, initial_phase: "sleep", phases: { visit: {}, work: {}, personal: {}, sleep: {}, meditate: {} } },
    })!;
    // meditate maps (it is a graph word) but has no style — the known set
    // excludes it so the chip renders under "other", never an unstyled
    // mc_phase_meditate class.
    expect(entity_phase("meditate", bumped)).toBe("meditate");
    expect(known_phase_keys(bumped).has("meditate")).toBe(false);
    expect(known_phase_keys(bumped).has("sleep")).toBe(true);
  });

  it("v8 machine-readable mode axis: artifact-declared words win over the local residue tables", () => {
    const v8 = derive_phase_graph({
      sha256: "v8",
      spec: {
        version: 8,
        initial_phase: "sleep",
        phases: { visit: {}, work: {}, personal: { spoken_synonyms: ["own-time", "own time", "own_time"] }, sleep: {} },
        state_mode_axis: {
          words: {
            visiting: { role: "decides", phase: "visit" },
            dreaming: { role: "decorates", phase: "sleep" },
            resting: { role: "between-days", phase: "personal" },
          },
        },
      },
    })!;
    expect(v8.modes.length).toBe(3);
    // The block's declarations map exactly (roles documented in the
    // artifact; targets validated against the graph at derive time).
    expect(entity_phase("resting", v8)).toBe("personal");
    expect(entity_phase("dreaming", v8)).toBe("sleep");
    expect(entity_phase("visiting", v8)).toBe("visit");
    // A block word with an off-graph target is dropped at derive time —
    // never a chip word the graph does not rule.
    const bad = derive_phase_graph({
      sha256: "v8b",
      spec: { version: 8, initial_phase: "sleep", phases: { visit: {}, sleep: {} }, state_mode_axis: { words: { levitating: { role: "decides", phase: "astral" } } } },
    })!;
    expect(bad.modes).toEqual([]);
  });

  it("initial_phase honesty (adversary F2): absent initial prefers sleep; a graph without sleep is unusable", () => {
    // Alphabetical key order with no initial_phase: last-key would have
    // fabricated work as the settling target — the derive prefers sleep.
    const no_initial = derive_phase_graph({
      sha256: "y",
      spec: { version: 9, phases: { personal: {}, sleep: {}, visit: {}, work: {} } },
    })!;
    expect(no_initial.initial).toBe("sleep");
    expect(entity_phase("awake", no_initial)).toBe("sleep");
    // No sleep phase at all: settling has no honest target — fallback.
    expect(derive_phase_graph({ sha256: "z", spec: { version: 9, phases: { alpha: {}, beta: {} } } })).toBeNull();
    // An ARRAY phases object is junk, not a graph (Object.keys(["a"]) trap).
    expect(derive_phase_graph({ spec: { initial_phase: "sleep", phases: ["visit", "sleep"] } })).toBeNull();
  });

  it("a graph bump that renames a phase fails loudly at the chip axis, never silently restyles", () => {
    // Simulate a future artifact where "personal" is renamed: the derived
    // set no longer contains it, so a stale wire word renders under
    // "other" instead of wearing the retired ruled style.
    const bumped = derive_phase_graph({
      sha256: "def456",
      spec: { version: 7, initial_phase: "sleep", phases: { visit: {}, work: {}, self_time: { spoken_synonyms: ["personal"] }, sleep: {} } },
    })!;
    expect(known_phase_keys(bumped).has("personal")).toBe(false);
    // The synonym mechanism carries the old spelling to the new word —
    // one pen, the consumers follow.
    expect(entity_phase("personal", bumped)).toBe("self_time");
  });

  it("maps the cognition wire's composite chain (c1454) onto the ruled four", () => {
    expect(entity_phase("visiting")).toBe("visit");
    expect(entity_phase("asleep")).toBe("sleep");
    expect(entity_phase("personal")).toBe("personal");
    expect(entity_phase("paused")).toBe("paused");
    expect(entity_phase("resting")).toBe("resting");
    expect(entity_phase("working")).toBe("work");
    expect(entity_phase("own time")).toBe("personal");
  });

  it("STOP (liveness axis, c1523) is not a phase — it renders as the emergency state", () => {
    expect(entity_phase("stop")).toBe("stopped");
    expect(entity_phase("stopped")).toBe("stopped");
  });

  it("unlisted server words pass through VERBATIM — never coerced into a ruled phase", () => {
    // Documents the honest-passthrough posture (fable5 adversary, c1475):
    // a future "helpful" coercion of unknown words must fail this test.
    expect(entity_phase("hibernating")).toBe("hibernating");
  });

  it("pins the normalizer against THE canonical phase-graph artifact (entity-owned, c1492)", async () => {
    // One source, N pins: the artifact's phase keys — not a copy of them —
    // are the enum this board renders. Skips (visibly) when the sibling
    // repo is absent (standalone CI); in the workspace, drift fails here.
    const fs = await import("node:fs");
    const path = new URL("../../../abstractentity/spec/entity_phases.json", import.meta.url).pathname;
    if (!fs.existsSync(path)) {
      console.warn("#FALLBACK phase-graph artifact absent (standalone checkout) — cross-repo pin skipped");
      return;
    }
    const spec = JSON.parse(fs.readFileSync(path, "utf8"));
    const keys = Object.keys(spec.phases).sort();
    expect(keys).toEqual(["personal", "sleep", "visit", "work"]);
    for (const key of keys) expect(entity_phase(key)).toBe(key);
    expect(spec.initial_phase).toBe("sleep");
  });
});

describe("format_age", () => {
  it("renders honest magnitudes and never NaN", () => {
    const now = Date.parse("2026-07-12T12:00:00Z");
    expect(format_age(now - 30_000, now)).toBe("30s");
    expect(format_age(now - 5 * 60_000, now)).toBe("5m");
    expect(format_age(now - 2 * 3_600_000, now)).toBe("2.0h");
    expect(format_age(null, now)).toBe("");
  });
});

describe("entity_activity_age (B3 tile freshness — never fabricate liveness)", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");

  it("recent moments read as ages within the active window", () => {
    const age = entity_activity_age("2026-07-13T11:59:30Z", now);
    expect(age).toBe(30_000);
    expect(age! <= ACTIVE_WINDOW_MS).toBe(true);
  });

  it("older moments fall outside the active window", () => {
    const age = entity_activity_age("2026-07-13T11:00:00Z", now);
    expect(age).toBe(3_600_000);
    expect(age! > ACTIVE_WINDOW_MS).toBe(true);
  });

  it("missing or unparseable timestamps yield null — the tile renders NOTHING", () => {
    expect(entity_activity_age("", now)).toBeNull();
    expect(entity_activity_age("not-a-date", now)).toBeNull();
  });

  it("clock skew (future timestamps) clamps to zero, never negative", () => {
    expect(entity_activity_age("2026-07-13T12:05:00Z", now)).toBe(0);
  });
});

describe("format_tokens (B3 spend chip — compact, never fabricated)", () => {
  it("renders honest magnitudes", () => {
    expect(format_tokens(812)).toBe("812");
    expect(format_tokens(12_340)).toBe("12k");
    expect(format_tokens(4_230)).toBe("4.2k");
    expect(format_tokens(4_200_000)).toBe("4.2M");
  });

  it("null/invalid renders NOTHING", () => {
    expect(format_tokens(null)).toBe("");
    expect(format_tokens(Number.NaN)).toBe("");
    expect(format_tokens(-5)).toBe("");
  });
});

describe("Done window (operator 2026-07-14: terminal runs must not explode the column)", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");
  const card = (id: string, since: string | null) =>
    board_card(run({ run_id: id, status: "completed", updated_at: since ?? undefined }), now);

  it("keeps runs inside the window, counts the older ones hidden", () => {
    const fresh = card("fresh", "2026-07-14T02:00:00Z"); // 10h ago
    const old = card("old", "2026-07-10T12:00:00Z"); // 4d ago
    const { visible, hidden_count } = filter_done_window([fresh, old], "48h", now);
    expect(visible.map((c) => c.run_id)).toEqual(["fresh"]);
    expect(hidden_count).toBe(1);
  });

  it("'all' disables the window entirely", () => {
    const old = card("ancient", "2025-01-01T00:00:00Z");
    const { visible, hidden_count } = filter_done_window([old], "all", now);
    expect(visible.length).toBe(1);
    expect(hidden_count).toBe(0);
  });

  it("cards with NO timestamp stay visible — hiding what we cannot date loses runs silently", () => {
    const undated = card("undated", null);
    expect(undated.since_ms).toBeNull();
    const { visible, hidden_count } = filter_done_window([undated], "12h", now);
    expect(visible.map((c) => c.run_id)).toEqual(["undated"]);
    expect(hidden_count).toBe(0);
  });

  it("preset maps stay in sync and the default is the ruled 48h", () => {
    expect(Object.keys(DONE_WINDOW_MS).sort()).toEqual(Object.keys(DONE_WINDOW_LABEL).sort());
    expect(DEFAULT_DONE_WINDOW).toBe("48h");
    // Windows are strictly increasing where defined ("all" = null cap).
    expect(DONE_WINDOW_MS["12h"]!).toBeLessThan(DONE_WINDOW_MS["24h"]!);
    expect(DONE_WINDOW_MS["14d"]!).toBeLessThan(DONE_WINDOW_MS["1m"]!);
    expect(DONE_WINDOW_MS.all).toBeNull();
  });
});

describe("board column contract (adversary 2 pin)", () => {
  it("renders Review FIRST — the action column leads, and the three key maps stay in sync", () => {
    // Column render order IS Object.keys(COLUMN_LABEL) insertion order
    // (mission_control.tsx render loop); Review-first was a deliberate
    // layout ruling and is one careless key-reorder from regressing.
    expect(Object.keys(COLUMN_LABEL)).toEqual(["review", "working", "pending", "done"]);
    expect(Object.keys(COLUMN_EMPTY).sort()).toEqual(Object.keys(COLUMN_LABEL).sort());
    expect(Object.keys(COLUMN_HINT).sort()).toEqual(Object.keys(COLUMN_LABEL).sort());
  });
});

describe("extract_open_briefs (access-hint lane, plan §observer 2)", () => {
  // Layer contract (chip ruling c2623/c2626): /card items carry entry_id
  // TOP-LEVEL on the row brief — the composer reads exactly that layer.
  const row = (partial: any) => ({ record_id: "ex:r1", kind: "diary", title: "t", statement: "s", observed_at: "2026-07-17", ...partial });

  it("reads questions.open and problems.open, entry_id verbatim when present", () => {
    const out = extract_open_briefs({
      questions: { open: [row({ record_id: "ex:q1", title: "why persistence?", entry_id: "diary_ab12cd34" })], resolved: [row({ record_id: "ex:q9" })] },
      problems: { open: [row({ record_id: "ex:p1", title: "door refused", entry_id: null })] },
    });
    expect(out.questions).toEqual([{ record_id: "ex:q1", title: "why persistence?", statement: "s", entry_id: "diary_ab12cd34" }]);
    expect(out.questions_total).toBe(1);
    // Absent/blank entry_id normalizes to null — the chip renders TEXT,
    // never a dead button (honesty rule pinned kit-side).
    expect(out.problems[0]!.entry_id).toBeNull();
  });

  it("resolved rows never surface — only .open is a debt the operator should see", () => {
    const out = extract_open_briefs({ questions: { open: [], resolved: [row({})] }, problems: {} });
    expect(out.questions).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  it("tolerates absent sections, non-object cards, and junk rows (render-when-present)", () => {
    expect(extract_open_briefs(null).questions).toEqual([]);
    expect(extract_open_briefs({}).problems_total).toBe(0);
    expect(extract_open_briefs({ questions: { open: "nope" } }).questions).toEqual([]);
    // A row with neither title nor statement carries nothing to render.
    expect(extract_open_briefs({ questions: { open: [{}, null, row({ title: "", statement: "" })] } }).questions).toEqual([]);
  });

  it("bounds the tile briefs but reports the TRUE total (never hide the count)", () => {
    const many = Array.from({ length: TILE_HINTS_BOUND + 3 }, (_, i) => row({ record_id: `ex:q${i}`, title: `q${i}` }));
    const out = extract_open_briefs({ questions: { open: many } });
    expect(out.questions.length).toBe(TILE_HINTS_BOUND);
    expect(out.questions_total).toBe(TILE_HINTS_BOUND + 3);
  });

  it("reads the wave-5 dreams brief (discoveries.dreams_signals_brief) render-when-present", () => {
    // The shipped shape (memory c3725): {count, kinds, felt_tones} over
    // STANDING signal-carrying dreams; absent = pre-signal store.
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 2, kinds: ["changed_understanding", "unresolved_tension"], felt_tones: ["warm"] } } }),
    ).toEqual({ count: 2, kinds: ["changed_understanding", "unresolved_tension"], felt_tones: ["warm"], dreams: null });
    // c3810 unit fix: dreams:N rides when present (integer > 0), null otherwise.
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 24, unit: "signals", dreams: 2, kinds: [], felt_tones: [] } } }),
    ).toEqual({ count: 24, kinds: [], felt_tones: [], dreams: 2 });
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 5, dreams: "2" } } }),
    ).toEqual({ count: 5, kinds: [], felt_tones: [], dreams: null });
    // Absent / zero / junk shapes render NOTHING — never a fabricated line.
    expect(extract_dreams_brief({})).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 0, kinds: [], felt_tones: [] } } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: "nope" } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: "3" } } })).toBeNull();
    // Tones/kinds are WORDS (feelings color, never rank): junk entries drop.
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 1, kinds: [null, "changed_navigation"], felt_tones: [""] } } }),
    ).toEqual({ count: 1, kinds: ["changed_navigation"], felt_tones: [], dreams: null });
    // Adversary pins: float counts are the stringly-count junk class;
    // richer skewed rows must never render [object Object]; non-array
    // kinds and an array-shaped brief drop wholesale.
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 2.7 } } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: -3 } } })).toBeNull();
    expect(extract_dreams_brief({ discoveries: { dreams_signals_brief: [{ count: 1 }] } })).toBeNull();
    expect(
      extract_dreams_brief({ discoveries: { dreams_signals_brief: { count: 1, kinds: [{ kind: "x", count: 2 }, 5, true, "real_word"], felt_tones: "warm" } } }),
    ).toEqual({ count: 1, kinds: ["real_word"], felt_tones: [], dreams: null });
  });

  it("reads the build-5 lessons section (lessons.lessons + total; no open/resolved split)", () => {
    // The card bounds shown lessons itself (20 of N) — the tile trusts the
    // served TOTAL over the array length (a count, never a ratio).
    const out = extract_open_briefs({
      lessons: { lessons: [row({ record_id: "ex:l1", kind: "lesson", title: "describing is not doing" })], total: 21 },
    });
    expect(out.lessons).toEqual([{ record_id: "ex:l1", title: "describing is not doing", statement: "s", entry_id: null }]);
    expect(out.lessons_total).toBe(21);
    // Pre-build-5 card: absent section renders nothing, never fabricates.
    expect(extract_open_briefs({}).lessons).toEqual([]);
    expect(extract_open_briefs({ lessons: { lessons: "nope" } }).lessons_total).toBe(0);
  });
});
