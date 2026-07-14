import { describe, expect, it } from "vitest";
import { run_status_class, run_status_word } from "./run_status";

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
