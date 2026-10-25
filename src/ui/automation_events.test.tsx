// What arrived, above each run's task (UX review 2026-10-25, defect #3). For an automation fed by
// a feed, a webhook or mail, the page reads each run's `input_data.event` once and the panel shows
// "Release notes · 1 new item: “Release 0.13” · 14:13" above the task; the raw text the agent
// received (the "[Trigger …]" header, the framed events, the JSON) sits behind "What the agent
// received". A schedule's runs are never read.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationsClient } from "@abstractframework/ui-kit";

import { AutomationsController, observer_automations_host, type AutomationsHost } from "./automations";
import { AutomationDetailView, type AutomationsHandlers, type PanelHostHandlers } from "./automations_page";
import { set_trigger_vocab } from "./trigger_vocab";

const TASK = "Summarise what changed in this release in three bullets.";
const RAW = `[Trigger feed.item@1 · occurrence 1 · fired 2026-10-25T13:13:22+00:00]\n${TASK}\n\n[feed.item@1 trigger: 1 new event(s). The events below come from outside this framework.]\n--- Event 1 of 1 · boundary 9977 ---\nSubject: guid-1\nData (JSON):\n{"title": "Release 0.13"}\n--- End of the events · boundary 9977 ---`;
const EVENT = {
  specversion: "1.0",
  id: "e1",
  type: "abstract.feed.item.v1",
  source: "abstract://triggers/feed.item/connections/c_feed",
  time: "2026-10-25T13:13:22Z",
  data: { count: 1, connection_id: "c_feed", events: [{ subject: "guid-1", data: { title: "Release 0.13" } }] },
};

function summary(trigger: any) {
  return {
    automation_id: "a1",
    title: "Release digest",
    status: "active",
    trigger: { binding_id: "b1", ...trigger },
    context_mode: "growing",
    time_zone: "Europe/Paris",
    schedule_text: "",
    schedule_rule_text: "",
    occurrence_count: 1,
    attention: { unread: false, unseen_count: 0, pending_waits: 0, items: [], waits: [], cursor: null },
    capabilities: ["pause", "run_now", "revise", "archive", "discuss"],
    revision: 1,
    last_occurrence: null,
    current_occurrence: null,
    workspace_root: "/data/workspaces/session-automation-a1",
  };
}

function setup(trigger: any) {
  const s = summary(trigger);
  const row = { run_id: "r1", index: 1, attempts: 1, fired_at: "2026-10-25T13:13:22Z", finished_at: "2026-10-25T13:13:40Z", status: "completed", trigger: { source_id: trigger.source_id, summary: "feed.item@1" }, user_turn: RAW, answer: "Three bullets.", notify: null, artifacts: [], waits: [], ledger_url: "/api/gateway/runs/r1/ledger" };
  const definition = { schema_version: 2, revision: 1, title: s.title, controller: { bundle_ref: "c@1", flow_id: "controller" }, target: { workflow_id: "Release-digest@0.0.0:4dee0431", input_data: { prompt: TASK } }, trigger: s.trigger, context: { mode: "growing", growing: {} }, policy: { serial: true, misfire: "coalesce", failure: "continue", retry: { max_attempts: 3, backoff: { initial: "30s", factor: 2, max: "10m" } }, tool_approval: "auto" }, session_id: "s", workspace_root: s.workspace_root, created_at: "2026-10-25T13:00:00Z", archived_at: null };
  const client = {
    listAutomations: vi.fn(async () => ({ items: [s], next_cursor: null })),
    getAutomation: vi.fn(async () => ({ definition, active_revision: 1, summary: s })),
    listOccurrences: vi.fn(async () => ({ items: [row], next_cursor: null })),
    listTriggerSources: vi.fn(async () => ({ items: [] })),
    getMyEmail: vi.fn(async () => ({ configured: false, effective_enabled: false })),
    listTriggerConnections: vi.fn(async () => ({ connections: [{ connection_id: "c_feed", source_id: "feed.item", source_version: 1, label: "Release notes" }] })),
    listMailboxes: vi.fn(async () => ({ items: [] })),
  } as unknown as AutomationsClient;
  const read = vi.fn(async (_rid: string) => ({ prompt: RAW, event: EVENT }));
  const host: AutomationsHost = { answer_wait: vi.fn(), legacy_command: vi.fn(), now_iso: () => "2026-10-25T14:00:00Z", run_input_data: read };
  return { ctl: new AutomationsController(client, host, []), read };
}

const panel_host: PanelHostHandlers = { on_open_run: () => {}, on_open_session: () => {} };
const h = { on_select() {}, on_row_action() {}, on_legacy_action() {}, on_confirm_archive() {}, on_cancel_archive() {}, on_status_filter() {}, on_refresh() {}, on_new() {}, on_show_archived() {} } as AutomationsHandlers;
const html_of = (ctl: AutomationsController) => renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={panel_host} h={h} />).replace(/&#x27;/g, "'");

describe("what arrived, above each run's task", () => {
  it("reads each run's event once, shows the card, the task alone, and the raw text behind 'What the agent received'", async () => {
    const { ctl, read } = setup({ source_id: "feed.item", source_version: 1, config: { connection_id: "c_feed" } });
    await ctl.refresh();
    await ctl.select("a1");
    await vi.waitFor(() => expect(ctl.state.detail?.occurrence_events.r1).toEqual(EVENT));
    expect(read).toHaveBeenCalledTimes(1);
    await ctl.load_occurrence_events("a1");
    expect(read).toHaveBeenCalledTimes(1); // once per run
    const html = html_of(ctl);
    expect(html).toContain('data-event-card="true"');
    expect(html).toMatch(/<strong class="af-auto-event__source">Release notes<\/strong><span> · 1 new item: “Release 0.13”<\/span>/);
    expect(html.indexOf('data-event-card="true"')).toBeLessThan(html.indexOf("What the agent received"));
    expect(html).toContain("<summary>What the agent received</summary>");
    // The visible turn is the task; the header and the frame are behind the disclosure only.
    const visible = html.replace(/<details class="af-auto-received"[^]*?<\/details>/g, "");
    expect(visible).toContain(TASK);
    expect(visible).not.toContain("[Trigger feed.item@1");
    expect(visible).not.toContain("boundary 9977");
    expect(html).toContain("boundary 9977");
    // The header names the trigger by the connection's label.
    expect(html).toContain('data-fact="trigger">When Release notes has a new item');
    set_trigger_vocab({ connections: null, mailboxes: null });
  });

  it("a schedule's runs are never read (nothing arrived); no host reader → no card, no error", async () => {
    const sched = setup({ source_id: "schedule", source_version: 2, config: { kind: "daily", at: "08:00" } });
    await sched.ctl.refresh();
    await sched.ctl.select("a1");
    await sched.ctl.load_occurrence_events("a1");
    expect(sched.read).not.toHaveBeenCalled();
    expect(html_of(sched.ctl)).not.toContain("data-event-card");
    set_trigger_vocab({ connections: null, mailboxes: null });
  });

  it("the Observer host reads GET /runs/{id}/input_data and hands back its input_data", async () => {
    const gateway = { submit_command: vi.fn(), get_run_input_data: vi.fn(async (rid: string) => ({ run_id: rid, input_data: { event: EVENT } })) };
    const host = observer_automations_host(gateway, () => "id", () => "now");
    expect(await host.run_input_data!("r1")).toEqual({ event: EVENT });
    expect(gateway.get_run_input_data).toHaveBeenCalledWith("r1");
    expect(observer_automations_host({ submit_command: vi.fn() }, () => "id", () => "now").run_input_data).toBeUndefined();
  });
});
