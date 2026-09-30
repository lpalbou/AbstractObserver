// State toggles (operator rule 2026-09-30, AbstractUIC docs/state-toggles.md):
// a persistent on/off setting is a switch labelled by the FEATURE, whose
// aria-checked shows the current state; never a verb label ("Pause"/"Resume",
// "Show archived", an On/Off select). These tests go red when a switch stops
// rendering its state, and the guard goes red on any verb-toggle label in src.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { findVerbToggleLabels, type AutomationSummary } from "@abstractframework/ui-kit";

import { ActiveSwitch, AutomationsListView, type AutomationsHandlers } from "./automations_page";
import { INITIAL_AUTOMATIONS_STATE, active_notice } from "./automations";
import { ApplyImmediatelySwitch, AssistantSkillSwitch, AutoConnectSwitch, MindmapLiveSwitch, ScheduleActiveSwitch } from "./state_switches";

const SRC = join(__dirname, "..");
const noop = () => {};
const h = new Proxy({}, { get: () => noop }) as unknown as AutomationsHandlers;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const sw = (markup: string, action: string) => new RegExp(`<button type="button" role="switch"[^>]*data-action="${action}"[^>]*>`).exec(markup)?.[0] ?? "";
const checked = (tag: string) => /aria-checked="(true|false)"/.exec(tag)?.[1] ?? null;
const label = (markup: string, action: string) => {
  const at = markup.indexOf(sw(markup, action));
  return /<span class="af-switch__label">([^]*?)<\/span>(?:<span class="af-switch__desc">|<\/span>)/.exec(markup.slice(at))?.[1]?.replace(/<[^>]+>/g, "") ?? null;
};

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

const list = (items: AutomationSummary[], over: Partial<typeof INITIAL_AUTOMATIONS_STATE> = {}) =>
  html(<AutomationsListView state={{ ...INITIAL_AUTOMATIONS_STATE, loaded: true, items, ...over }} available={{ available: true, reason: "" }} h={h} />);

describe("guard: no verb-toggle labels in src", () => {
  it("findVerbToggleLabels finds nothing in the Observer's sources", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const files = walk(SRC).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(20);
    const hits = files.flatMap((f) => findVerbToggleLabels(readFileSync(f, "utf8")).map((x) => `${f.slice(SRC.length + 1)}:${x.line} ${x.labels.join(" | ")}`));
    expect(hits).toEqual([]);
  });

  it("the guard itself flags the shape it exists for (not decoration)", () => {
    expect(findVerbToggleLabels('const l = paused ? "Resume schedule" : "Suspend schedule";')).toEqual([]); // different words: not a swap
    expect(findVerbToggleLabels('const l = paused ? "Resume" : "Pause";')).toHaveLength(1);
  });
});

describe("automation rows: the Active switch", () => {
  it("ON for an active automation, OFF for a paused one; the label stays the feature", () => {
    const on = list([summary()]);
    const off = list([summary({ status: "paused", next_fire_at: undefined })]);
    expect(checked(sw(on, "active"))).toBe("true");
    expect(checked(sw(off, "active"))).toBe("false");
    expect(label(on, "active")).toBe("Active");
    expect(label(off, "active")).toBe("Active");
    // No Pause/Resume verb buttons left in the row.
    expect(on).not.toMatch(/data-action="(pause|resume)"/);
    expect(off).not.toMatch(/data-action="(pause|resume)"/);
  });

  it("legacy schedules get the same switch (on = runs at its times)", () => {
    const legacy = { legacy: true, capabilities: [] as string[] };
    expect(checked(sw(list([summary(legacy)]), "active"))).toBe("true");
    expect(checked(sw(list([summary({ ...legacy, status: "paused" })]), "active"))).toBe("false");
    expect(list([summary(legacy)])).not.toMatch(/data-action="legacy_(pause|resume)"/);
  });

  it("an ended automation's switch is unavailable (focusable, aria-disabled, reason), not an actionable control", () => {
    const tag = sw(html(<ActiveSwitch summary={summary({ status: "completed" })} busy={false} ctl={{ enabled: false, reason: "The automation has ended." }} onChange={noop} />), "active");
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).not.toMatch(/\sdisabled=""/);
    expect(tag).toMatch(/aria-describedby="auto-active-a1-reason"/);
    expect(tag).toContain('title="The automation has ended.');
  });

  it("a command in flight makes it busy, not unavailable", () => {
    const tag = sw(html(<ActiveSwitch summary={summary()} busy={true} ctl={{ enabled: false, reason: "Working…" }} onChange={noop} />), "active");
    expect(tag).toContain('aria-busy="true"');
    expect(tag).not.toContain("aria-disabled");
  });

  it("the feedback line states the new state", () => {
    expect(active_notice("News", true)).toBe("“News” is active: it runs on its schedule.");
    expect(active_notice("News", false)).toBe("“News” is paused: scheduled runs are skipped.");
  });

  it("the Archived switch shows whether archived automations are listed", () => {
    const items = [summary(), summary({ automation_id: "a2", status: "archived" })];
    expect(checked(sw(list(items), "show-archived"))).toBe("false");
    expect(checked(sw(list(items, { show_archived: true }), "show-archived"))).toBe("true");
    expect(label(list(items), "show-archived")).toBe("Archived (1)");
  });
});

describe("settings, Observe toolbar and memory map switches", () => {
  const both = (render: (on: boolean) => React.ReactElement, action: string) => [checked(sw(html(render(true)), action)), checked(sw(html(render(false)), action))];

  it("Auto-connect on load", () => {
    expect(both((on) => <AutoConnectSwitch checked={on} onChange={noop} />, "auto-connect")).toEqual(["true", "false"]);
    expect(label(html(<AutoConnectSwitch checked={false} onChange={noop} />), "auto-connect")).toBe("Auto-connect on load");
  });

  it("assistant skills: one switch per skill, named by the skill", () => {
    expect(both((on) => <AssistantSkillSwitch name="git" version="1.2" checked={on} onChange={noop} />, "assistant-skill")).toEqual(["true", "false"]);
    expect(sw(html(<AssistantSkillSwitch name="git" checked onChange={noop} />), "assistant-skill")).toContain('aria-label="git"');
  });

  it("legacy schedule: Active switch in the Observe toolbar", () => {
    expect(both((on) => <ScheduleActiveSwitch active={on} unavailableReason={null} busy={false} onChange={noop} />, "schedule-active")).toEqual(["true", "false"]);
    const ended = sw(html(<ScheduleActiveSwitch active={false} unavailableReason="The schedule has ended." busy={false} onChange={noop} />), "schedule-active");
    expect(ended).toContain('aria-disabled="true"');
  });

  it("edit schedule dialog: Apply immediately (form state, busy while submitting)", () => {
    expect(both((on) => <ApplyImmediatelySwitch checked={on} busy={false} onChange={noop} />, "apply-immediately")).toEqual(["true", "false"]);
    expect(label(html(<ApplyImmediatelySwitch checked busy={false} onChange={noop} />), "apply-immediately")).toBe("Apply immediately");
    expect(sw(html(<ApplyImmediatelySwitch checked busy onChange={noop} />), "apply-immediately")).toContain('aria-busy="true"');
  });

  it("no checkbox is left in the edit schedule dialog", () => {
    const src = readFileSync(join(SRC, "ui/app.tsx"), "utf8");
    const dialog = src.slice(src.indexOf('title="Edit schedule"'), src.indexOf("{compact_open ? ("));
    expect(dialog.length).toBeGreaterThan(200);
    expect(dialog).toContain("<ApplyImmediatelySwitch");
    expect(dialog).not.toMatch(/type="checkbox"/);
  });

  it("memory map: Live", () => {
    expect(both((on) => <MindmapLiveSwitch checked={on} onChange={noop} />, "mindmap-live")).toEqual(["true", "false"]);
  });
});

describe("type scale: settings labels (DESIGN §3: labels <= 15 px, weight <= 600)", () => {
  const css = readFileSync(join(SRC, "ui/forms.css"), "utf8");
  const rule = (sel: string) => new RegExp(`\\n${sel.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  it.each([".settings_row_title", ".settings_choice_name", ".launch_skill_name"])("%s is not heavier than 600", (sel) => {
    const body = rule(sel);
    expect(body, `${sel} rule missing`).toMatch(/font-weight:/);
    const w = /font-weight:\s*([a-z0-9]+)/.exec(body)![1];
    expect(w === "inherit" || Number(w) <= 600, `${sel} font-weight ${w}`).toBe(true);
  });
  it("a skill name follows the switch weight (regular off, bold on)", () => {
    expect(rule(".settings_choice_name")).toMatch(/font-weight:\s*inherit/);
  });
});
