import { describe, expect, it } from "vitest";
import { run_status_class, run_status_word, stop_reason_of } from "./run_status";

// Adversary 1 P0-2: four private status→color maps rendered contradictory
// chips for one run on one screen (waiting amber in the navigator, blue in
// the toolbar; "paused" in success-green on the board). This is THE map —
// every chip derives from it, and these cases are the contract.
describe("run_status_class (the one status→semantic map)", () => {
  it("terminal outcomes", () => {
    expect(run_status_class("completed")).toBe("ok");
    expect(run_status_class("failed")).toBe("danger");
    expect(run_status_class("cancelled")).toBe("danger");
  });

  it("needs-eyes states are warn (waiting, paused, suspended)", () => {
    expect(run_status_class("waiting")).toBe("warn");
    expect(run_status_class("paused")).toBe("warn");
    expect(run_status_class("suspended")).toBe("warn");
  });

  it("in-motion states are info", () => {
    expect(run_status_class("running")).toBe("info");
    expect(run_status_class("scheduled")).toBe("info");
  });

  it("unknown/absent states are muted, never a semantic color", () => {
    expect(run_status_class("")).toBe("muted");
    expect(run_status_class(null)).toBe("muted");
    expect(run_status_class(undefined)).toBe("muted");
    expect(run_status_class("something-new")).toBe("muted");
  });

  it("is case/whitespace tolerant (wire strings are not normalized upstream)", () => {
    expect(run_status_class(" Failed ")).toBe("danger");
    expect(run_status_class("RUNNING")).toBe("info");
  });
});

describe("run_status_word (one word on every surface)", () => {
  it("paused overrides non-terminal states", () => {
    expect(run_status_word({ status: "running", paused: true })).toBe("paused");
    expect(run_status_word({ status: "waiting", paused: true })).toBe("paused");
  });

  it("terminal states keep their word even when the paused flag lingers", () => {
    expect(run_status_word({ status: "completed", paused: true })).toBe("completed");
    expect(run_status_word({ status: "failed", paused: true })).toBe("failed");
    expect(run_status_word({ status: "cancelled", paused: true })).toBe("cancelled");
  });

  it("plain runs pass through; absent is 'unknown'", () => {
    expect(run_status_word({ status: "running", paused: false })).toBe("running");
    expect(run_status_word({ status: "" })).toBe("unknown");
    expect(run_status_word(null)).toBe("unknown");
  });

  it("word and color agree: paused wears warn everywhere", () => {
    expect(run_status_class(run_status_word({ status: "running", paused: true }))).toBe("warn");
  });
});

// 2026-08-21: a run's `status` is about the RUN, not the TURN. An agent turn
// stopped by the iteration budget or by the loop's stuck-streak guard still
// reports `status: "completed"`, so this map painted it success-green and
// called it done-well. The loop now says which it was in
// `output.stop_reason.finished`; nothing here derives it.
describe("a completed RUN whose TURN did not finish", () => {
  it("is warn, not ok", () => {
    expect(run_status_class("completed", { finished: false })).toBe("warn");
    expect(run_status_class("completed", { finished: true })).toBe("ok");
  });

  it("reads 'stopped', not 'completed'", () => {
    expect(run_status_word({ status: "completed", stop_reason: { finished: false } })).toBe("stopped");
    expect(run_status_word({ status: "completed", stop_reason: { finished: true } })).toBe("completed");
    expect(run_status_class("stopped")).toBe("warn");
  });

  it("changes nothing without the server's own boolean", () => {
    // Listing rows carry no output: they must keep behaving exactly as before
    // rather than guessing from `status` alone.
    expect(run_status_class("completed")).toBe("ok");
    expect(run_status_class("completed", null)).toBe("ok");
    expect(run_status_word({ status: "completed" })).toBe("completed");
    expect(run_status_word({ status: "completed", stop_reason: {} })).toBe("completed");
  });

  it("never overrides a failure or a cancel", () => {
    expect(run_status_class("failed", { finished: false })).toBe("danger");
    expect(run_status_class("cancelled", { finished: false })).toBe("danger");
  });

  it("extracts the reason from a run detail, and tolerates its absence", () => {
    expect(stop_reason_of({ output: { stop_reason: { finished: false, label: "stopped: repeated tool calls" } } }))
      .toEqual({ finished: false, label: "stopped: repeated tool calls" });
    expect(stop_reason_of({ output: {} })).toBe(null);
    expect(stop_reason_of(null)).toBe(null);
  });
});
