// No jargon in the person's view (UX review 2026-10-25, defects #4–#6): the empty list says
// where automations come from; the flow is named, never "Release-digest@0.0.0:4dee0431"; no
// workspace policy, folder path or revision on the cards or the header (they are under Details
// and the Workspaces disclosure); "run #1", never "occurrence #1"; "conversation", never "session".
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationsClient } from "@abstractframework/ui-kit";

import { AutomationsController, INITIAL_AUTOMATIONS_STATE, LAUNCH_MODE_HELP, CONTEXT_HELP, run_session_tag_label, type AutomationsHost } from "./automations";
import { AutomationDetailView, AutomationsListView, workflow_name_of, type AutomationsHandlers, type PanelHostHandlers } from "./automations_page";

const h = { on_select() {}, on_row_action() {}, on_legacy_action() {}, on_confirm_archive() {}, on_cancel_archive() {}, on_status_filter() {}, on_refresh() {}, on_new() {}, on_show_archived() {} } as AutomationsHandlers;
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const ENTRIES = [{ value: "Release-digest@0.0.0:4dee0431", bundleId: "Release-digest", flowId: "4dee0431", name: "Release digest" }];

describe("no jargon in the person's view", () => {
  it("the empty list says where automations come from", () => {
    const html = unescape(renderToStaticMarkup(<AutomationsListView state={{ ...INITIAL_AUTOMATIONS_STATE, loaded: true }} available={{ available: true, reason: "" }} h={h} />));
    expect(html).toContain("No automations yet. Make one in Flow, or press New automation.");
    expect(html).not.toContain("Launch → Automate");
  });

  it("the flow's name from the gateway's list, never its id", () => {
    expect(workflow_name_of("Release-digest@0.0.0:4dee0431", ENTRIES)).toBe("Release digest");
    expect(workflow_name_of("Release-digest@0.0.1:4dee0431", ENTRIES)).toBe("Release digest"); // another version, same flow
    expect(workflow_name_of("Other@1:x", ENTRIES)).toBeUndefined();
    expect(workflow_name_of("", ENTRIES)).toBeUndefined();
    expect(workflow_name_of("Release-digest@0.0.0:4dee0431", null)).toBeUndefined();
  });

  it("the card and the header carry no workspace policy, folder path, revision or target id", async () => {
    const s = {
      automation_id: "a1", title: "Release digest", status: "active", trigger: { binding_id: "b", source_id: "manual", source_version: 1, config: {} }, context_mode: "independent",
      time_zone: "Europe/Paris", schedule_text: "", schedule_rule_text: "", occurrence_count: 0, attention: { unread: false, unseen_count: 0, pending_waits: 0, items: [], waits: [], cursor: null },
      capabilities: ["pause", "run_now", "revise", "archive", "discuss"], revision: 3, last_occurrence: null, current_occurrence: null, workspace_root: "/data/workspaces/session-automation-a1",
    };
    const definition = { schema_version: 2, revision: 3, title: s.title, controller: { bundle_ref: "c@1", flow_id: "controller" }, target: { workflow_id: "Release-digest@0.0.0:4dee0431", input_data: { prompt: "Digest", workspace: { mode: "default" } } }, trigger: s.trigger, context: { mode: "independent", growing: {} }, policy: { serial: true, misfire: "coalesce", failure: "continue", retry: { max_attempts: 3, backoff: { initial: "30s", factor: 2, max: "10m" } }, tool_approval: "auto" }, session_id: "s", workspace_root: s.workspace_root, created_at: "2026-10-25T13:00:00Z", archived_at: null };
    const client = {
      listAutomations: vi.fn(async () => ({ items: [s], next_cursor: null })),
      getAutomation: vi.fn(async () => ({ definition, active_revision: 3, summary: s })),
      listOccurrences: vi.fn(async () => ({ items: [], next_cursor: null })),
      listTriggerSources: vi.fn(async () => ({ items: [] })),
      getMyEmail: vi.fn(async () => ({ configured: false, effective_enabled: false })),
    } as unknown as AutomationsClient;
    const host: AutomationsHost = { answer_wait: vi.fn(), legacy_command: vi.fn(), now_iso: () => "2026-10-25T14:00:00Z" };
    const ctl = new AutomationsController(client, host, []);
    await ctl.refresh();
    await ctl.select("a1");
    const list = unescape(renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={h} />));
    expect(list).not.toContain("Workspaces:");
    expect(list).toContain("By hand");
    const panel_host: PanelHostHandlers = { on_open_run: () => {}, on_open_session: () => {}, on_open_workspace: () => {} };
    const workflows = { status: "ready", data: { interfaceId: null, entries: ENTRIES, gatewayDefault: null }, error: "", reload: () => {} } as any;
    const detail = unescape(renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={panel_host} h={h} workflowPickerOptions={{ interfaceId: null, workflows } as any} workspaces={{ request: (async () => ({})) as any, connected: false, revisions: { expected: () => 3, changes: (_id: string, c: any) => c, note: () => {} } as any }} />));
    const header = detail.slice(0, detail.indexOf('<details class="af-auto__definition"'));
    expect(header).toContain('<dt>Flow</dt><dd data-fact="workflow">Release digest</dd>');
    expect(header).not.toContain("Release-digest@0.0.0");
    expect(header.replace(/<[^>]+>/g, " ")).not.toContain(s.workspace_root); // the path is only the Files button's tooltip
    expect(header).not.toContain('data-fact="revision"');
    // The workspace policy is folded under "Workspaces"; the target id, folder and revision under Details.
    expect(detail).toMatch(/<details class="auto_workspaces_details" data-field="workspaces-details"><summary>Workspaces<\/summary>/);
    expect(detail).toContain('data-def="target"><code>Release-digest@0.0.0:4dee0431</code>');
    expect(detail).toContain('<span class="af-auto__definition-title">Details</span>');
  });

  it("run #1, never occurrence #1; conversation, never session; flow, never workflow", () => {
    expect(run_session_tag_label({ role: "occurrence", session_kind: "occurrence", is_scheduled: null, occurrence_index: 1 })).toBe("run #1");
    expect(CONTEXT_HELP.independent).toContain("conversation");
    expect(CONTEXT_HELP.independent).not.toMatch(/\bsession\b/);
    expect(LAUNCH_MODE_HELP.once + LAUNCH_MODE_HELP.automate).not.toMatch(/workflow/);
  });
});
