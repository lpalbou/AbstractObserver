import { describe, expect, it } from "vitest";

import {
  active_run_status,
  clamp_preview,
  first_string,
  format_duration_ms,
  format_time_until_from_ms,
  number_or_null,
  parse_iso_ms,
  run_duration_ms,
  run_finished_at,
  run_started_at,
  safe_json_inline,
  sanitize_filename_part,
  short_id,
  terminal_run_status,
} from "./format";

describe("format.ts — the one pure format/time fold (ui-rethink P1 step 1)", () => {
  it("parse_iso_ms clamps sub-millisecond ISO fractions (THE drift the merge killed)", () => {
    // runtime_activity's private copy lacked this clamp — some backends
    // emit `.123456Z` and some JS engines refuse to parse it, so a
    // waiting run's age read "—" on one surface and a real age on
    // another. One source, one behavior.
    const micro = parse_iso_ms("2026-07-20T16:47:20.123456Z");
    const milli = parse_iso_ms("2026-07-20T16:47:20.123Z");
    expect(micro).not.toBeNull();
    expect(micro).toBe(milli);
    expect(parse_iso_ms("")).toBeNull();
    expect(parse_iso_ms(null)).toBeNull();
    expect(parse_iso_ms("not a date")).toBeNull();
    expect(parse_iso_ms(1234567890)).toBeNull(); // non-string stays null (verbatim app.tsx behavior)
  });

  it("run clock: started/finished/duration honor terminal-only finish times", () => {
    const running = { status: "running", created_at: "2026-07-20T10:00:00Z", updated_at: "2026-07-20T11:00:00Z" };
    // A non-terminal run has NO finish time — updated_at must not leak in
    // as an end timestamp (it would freeze a live run's clock).
    expect(run_finished_at(running)).toBe("");
    const now = Date.parse("2026-07-20T10:30:00Z");
    expect(run_duration_ms(running, now)).toBe(30 * 60 * 1000);

    const done = { status: "completed", created_at: "2026-07-20T10:00:00Z", updated_at: "2026-07-20T10:45:00Z" };
    expect(run_finished_at(done)).toBe("2026-07-20T10:45:00Z");
    expect(run_duration_ms(done)).toBe(45 * 60 * 1000);

    // started_at wins over created_at when present.
    expect(run_started_at({ status: "running", started_at: "2026-07-20T10:05:00Z", created_at: "2026-07-20T10:00:00Z" })).toBe(
      "2026-07-20T10:05:00Z",
    );
    // No start time = -1 (renders as "—"), never a fabricated 0s.
    expect(run_duration_ms({ status: "running" })).toBe(-1);
  });

  it("status predicates match the run lifecycle words", () => {
    for (const s of ["completed", "failed", "cancelled", " Completed "]) expect(terminal_run_status(s)).toBe(true);
    for (const s of ["running", "waiting", "scheduled", "", null]) expect(terminal_run_status(s)).toBe(false);
    for (const s of ["running", "waiting"]) expect(active_run_status(s)).toBe(true);
    for (const s of ["completed", "paused", ""]) expect(active_run_status(s)).toBe(false);
  });

  it("duration/time formatting stays compact and honest", () => {
    expect(format_duration_ms(null)).toBe("—");
    expect(format_duration_ms(-5)).toBe("—");
    expect(format_duration_ms(0)).toBe("0s");
    expect(format_duration_ms(61_000)).toBe("1m 1s");
    expect(format_duration_ms(3_661_000)).toBe("1h 1m");
    expect(format_duration_ms(90_000_000)).toBe("1d 1h");
    expect(format_time_until_from_ms(-1)).toBe("now");
    expect(format_time_until_from_ms(61_000)).toBe("1m 1s");
    expect(format_time_until_from_ms(NaN)).toBe("");
  });

  it("clamp_preview bounds by lines then chars with a visible marker", () => {
    expect(clamp_preview("one\ntwo\nthree")).toBe("one\ntwo…");
    expect(clamp_preview("short")).toBe("short");
    const long = "x".repeat(400);
    const out = clamp_preview(long);
    expect(out.length).toBeLessThanOrEqual(360);
    expect(out.endsWith("…")).toBe(true);
    // CRLF normalizes before the line split.
    expect(clamp_preview("a\r\nb\r\nc")).toBe("a\nb…");
  });

  it("small folds keep their verbatim quirks", () => {
    expect(short_id("abcdef", 4)).toBe("abc…"); // keep-1 chars + marker (verbatim)
    expect(short_id("ab", 4)).toBe("ab");
    expect(sanitize_filename_part("  héllo world!.txt ")).toBe("h-llo-world-.txt");
    expect(sanitize_filename_part("")).toBe("untitled");
    expect(first_string("", null, " x ", "y")).toBe("x");
    expect(first_string(undefined, "")).toBe("");
    // number_or_null preserves the Number() coercion quirk: null -> 0.
    expect(number_or_null(null, 5)).toBe(0);
    expect(number_or_null(undefined, "7")).toBe(7);
    expect(number_or_null("junk", undefined)).toBeNull();
    // safe_json_inline truncates with a marker at the cap.
    expect(safe_json_inline({ a: 1 }, 100)).toBe('{"a":1}');
    expect(safe_json_inline("x".repeat(50), 10).endsWith("…")).toBe(true);
  });
});
