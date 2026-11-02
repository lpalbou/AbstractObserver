// ADR 0048: the list draws the gateway's order and the `section` it serves — the active rows, then
// the paused ones folded under "Paused" (opened on a click) — and a gateway that serves no
// `section` (0.19.0 and earlier) or an explicit status filter draws every row as today.
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AutomationSummary } from "@abstractframework/ui-kit";

import { INITIAL_AUTOMATIONS_STATE, automation_sections, type AutomationsState } from "./automations";
import { AutomationsListView, type AutomationsHandlers } from "./automations_page";
import { served_summary } from "./served_summary";

const base = (): AutomationSummary => served_summary(JSON.parse(readFileSync(join(__dirname, "fixtures/list-gateway-0.13.json"), "utf8")).items[0]);
const row = (id: string, title: string, status: string, section?: string): AutomationSummary =>
  ({ ...base(), automation_id: id, title, status, ...(section ? { section } : {}) }) as AutomationSummary;
const noop = {
  on_select() {}, on_row_action() {}, on_legacy_action() {}, on_confirm_archive() {}, on_cancel_archive() {},
  on_status_filter() {}, on_refresh() {}, on_new() {}, on_show_archived() {},
} as AutomationsHandlers;
const state = (items: AutomationSummary[], patch: Partial<AutomationsState> = {}): AutomationsState =>
  ({ ...INITIAL_AUTOMATIONS_STATE, items, loaded: true, ...patch });
const html = (st: AutomationsState) => renderToStaticMarkup(
  <AutomationsListView state={st} available={{ available: true, reason: "" }} h={noop} />);

const served = [row("b", "Bravo digest", "active", "active"), row("a", "Alpha monitor", "completed", "active"),
  row("p", "Consolidate my notes", "paused", "paused")];

describe("automation sections (ADR 0048)", () => {
  it("keeps the served order and folds the paused ones", () => {
    const s = automation_sections(state(served));
    expect(s.main.map((r) => r.automation_id)).toEqual(["b", "a"]);
    expect(s.paused.map((r) => r.automation_id)).toEqual(["p"]);
    const folded = html(state(served));
    expect(folded).toContain("auto_paused_toggle");
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain("Consolidate my notes");
    expect(folded.indexOf("Bravo digest")).toBeLessThan(folded.indexOf("Alpha monitor"));
    // The label carries the gateway's figure when it serves one (ADR 0048).
    expect(html(state(served, { paused_count: 7 }))).toMatch(/Paused<\/span><span class="pane_count">7</);
    const opened = html(state(served, { show_paused: true }));
    expect(opened).toContain('aria-expanded="true"');
    expect(opened.indexOf("Alpha monitor")).toBeLessThan(opened.indexOf("Consolidate my notes"));
  });

  it("an older gateway or a status filter draws every row as served", () => {
    const older = served.map(({ section: _s, ...r }: any) => r as AutomationSummary);
    expect(automation_sections(state(older)).main.map((r) => r.automation_id)).toEqual(["b", "a", "p"]);
    expect(html(state(older))).not.toContain("auto_paused_toggle");
    expect(automation_sections(state([served[2]], { status_filter: "paused" })).main.map((r) => r.automation_id)).toEqual(["p"]);
  });
});
