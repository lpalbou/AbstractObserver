// 2026-10-09 operator report: a gateway before round 16 (0.13.x) serves no time_zone /
// next_run_at / next_run_local / schedule_text / schedule_rule_text — only next_fire_at —
// and a client that requires them fails the whole list. The row in
// fixtures/list-gateway-0.13.json is a COPY of that live summary's shape.
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationsClient } from "@abstractframework/ui-kit";

import { AutomationsController, automation_row_view } from "./automations";
import { AutomationsListView, type AutomationsHandlers } from "./automations_page";
import { served_summary } from "./served_summary";

const page = () => JSON.parse(readFileSync(join(__dirname, "fixtures/list-gateway-0.13.json"), "utf8"));
const NOW = Date.parse("2026-10-09T16:53:29Z");
const noop: AutomationsHandlers = {
  on_select: () => {},
  on_row_action: () => {},
  on_legacy_action: () => {},
  on_confirm_archive: () => {},
  on_cancel_archive: () => {},
  on_status_filter: () => {},
  on_refresh: () => {},
  on_new: () => {},
  on_show_archived: () => {},
};

describe("a pre-round-16 gateway row (served fields optional)", () => {
  it("normalizes: next run from next_fire_at (UTC), rule and sentence '—', served values never overridden", () => {
    const raw = page().items[0];
    const s = served_summary(raw);
    expect([s.next_run_at, s.next_run_local, s.time_zone, s.schedule_rule_text, s.schedule_text]).toEqual([
      "2026-10-09T19:53:29.622724+00:00", "2026-10-09T19:53:29.622724+00:00", "UTC", "—", "—"]);
    expect(automation_row_view(s, NOW)).toMatchObject({ cadence: "—", next_run: "2026-10-09 19:53 UTC (in 3 h)" });
    const bad = served_summary({ ...raw, time_zone: 5, schedule_rule_text: ["x"], next_run_local: null });
    expect([bad.time_zone, bad.schedule_rule_text]).toEqual(["UTC", "—"]);
    const { next_fire_at: _drop, ...no_next } = raw;
    expect(automation_row_view(served_summary(no_next), NOW).next_run).toBe("none scheduled");
    const r16 = served_summary({ ...raw, time_zone: "Europe/Paris", next_run_at: raw.next_fire_at, next_run_local: "2026-10-09T21:53:29.622724+02:00", schedule_rule_text: "Every 24 hours (UTC)" });
    expect(automation_row_view(r16, NOW)).toMatchObject({ cadence: "Every 24 hours (UTC)", next_run: "2026-10-09 21:53 Europe/Paris (in 3 h)" });
  });

  it("the controller lists and opens it, and the list view renders it", async () => {
    const p = page();
    const raw = p.items[0];
    const client = {
      listAutomations: vi.fn(async () => p),
      getAutomation: vi.fn(async () => ({ definition: { revision: 4 }, active_revision: 4, summary: raw })),
      listOccurrences: vi.fn(async () => ({ items: [], next_cursor: null })),
      listTriggerSources: vi.fn(async () => ({ items: [] })),
      getMyEmail: vi.fn(async () => ({ configured: false, effective_enabled: false })),
    } as unknown as AutomationsClient;
    const host = { answer_wait: vi.fn(), legacy_command: vi.fn(), now_iso: () => "2026-10-09T16:53:29Z" };
    const ctl = new AutomationsController(client, host as any, []);
    await ctl.refresh();
    expect(ctl.state.list_error).toBeNull();
    expect(ctl.state.items.map((s) => [s.title, s.time_zone, s.schedule_rule_text])).toEqual([["Daily price watch", "UTC", "—"]]);
    await ctl.select(raw.automation_id);
    expect(ctl.state.detail?.summary.next_run_at).toBe(raw.next_fire_at);
    const html = renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={noop} />);
    expect(html).toContain("Daily price watch");
    expect(html).toContain("—");
    expect(html).toContain("2026-10-09 19:53 UTC");
    expect(html).not.toContain("could not");
  });
});
