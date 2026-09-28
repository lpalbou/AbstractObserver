// Operator request 2026-09-28: "Run now" uses the shared icon and a tooltip saying
// it runs the automation now rather than later, and what that does (or not) to the
// next scheduled run. The row button uses the KIT's icon and hint, never a local copy.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CONTROL_HINTS, CONTROL_ICONS, RUN_NOW_GLYPH, controlHint, type AutomationSummary } from "@abstractframework/ui-kit";

import { AutomationsListView, ROW_ICONS, type AutomationsHandlers } from "./automations_page";
import { INITIAL_AUTOMATIONS_STATE } from "./automations";

const noop = () => {};
const h = new Proxy({}, { get: () => noop }) as unknown as AutomationsHandlers;

function summary(over: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    automation_id: "a1",
    title: "Morning news",
    status: "active",
    trigger: { binding_id: "b", source_id: "schedule", source_version: 1, config: { start_at: "2026-09-28T06:00:00Z", every: "1d" } },
    context_mode: "growing",
    next_fire_at: "2026-09-29T06:00:00+00:00",
    current_occurrence: null,
    occurrence_count: 3,
    attention: { pending_waits: 0, unread: false, unseen_count: 0, cursor: "att1:0", items: [], waits: [] },
    legacy: false,
    revision: 1,
    updated_at: "2026-09-28T00:00:00Z",
    capabilities: ["revise", "pause", "resume", "run_now", "stop_current", "archive", "discuss"],
    session_kind: "automation",
    ...over,
  };
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function row_button(s: AutomationSummary, action: string): string {
  const html = unescape(renderToStaticMarkup(<AutomationsListView state={{ ...INITIAL_AUTOMATIONS_STATE, items: [s] }} available={{ available: true, reason: "" }} h={h} />));
  const m = new RegExp(`<button[^>]*data-action="${action}"[^>]*>[^]*?</button>`).exec(html);
  if (!m) throw new Error(`no ${action} button`);
  return m[0];
}

describe("Run now: the kit's icon and hint", () => {
  it("the row button's tooltip and aria-description are the kit's hint, with the next scheduled time and the Growing line", () => {
    const s = summary();
    const b = row_button(s, "run_now");
    const hint = controlHint("run_now", s);
    expect(hint.startsWith(CONTROL_HINTS.run_now)).toBe(true);
    expect(hint).toContain("Next scheduled run: 2026-09-29 06:00 UTC.");
    expect(hint).toContain("Growing context: later runs see this run in their history.");
    expect(b).toContain(`title="${hint}"`);
    expect(b).toContain(`aria-description="${hint}"`);
    expect(b).toContain("the next scheduled run keeps its time");
  });

  it("a disabled Run now keeps its reason first, then the hint", () => {
    const s = summary({ current_occurrence: { index: 4, run_id: "r4", attempt: 1, status: "running" } });
    const b = row_button(s, "run_now");
    expect(b).toContain(' disabled=""');
    expect(b).toContain(`title="An occurrence is in progress.\n${controlHint("run_now", s)}"`);
  });

  it("draws the kit's playCircle glyph (the same markup the Assistant vendors)", () => {
    expect(ROW_ICONS.run_now).toBe(CONTROL_ICONS.run_now);
    expect(CONTROL_ICONS.run_now).toBe("playCircle");
    expect(row_button(summary(), "run_now")).toContain(RUN_NOW_GLYPH.svg);
  });

  it("every row control carries its own kit hint", () => {
    const s = summary();
    for (const [action, id] of [["pause", "pause"], ["edit", "revise"], ["discuss", "discuss"], ["archive", "archive"]] as const) {
      expect(row_button(s, action)).toContain(`aria-description="${CONTROL_HINTS[id]}"`);
    }
    expect(row_button(summary({ status: "paused", next_fire_at: undefined }), "resume")).toContain(`title="${CONTROL_HINTS.resume}"`);
  });
});
