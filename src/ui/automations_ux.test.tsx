// Operator field reports 2026-09-28 (Observer 0.1.14 on a remote VPS):
// the automation's folder is browsable from the web UI; Discuss opens a chat
// with the fork in place (shared panel-chat stack); state reads word + icon.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationSummary } from "@abstractframework/ui-kit";

import { STATUS_ICONS, STATUS_LABELS } from "@abstractframework/ui-kit";
import { tabOpenPlan } from "@abstractframework/panel-chat";

import { GatewayClient } from "../lib/gateway_client";
import { discussion_turn_target, observer_workflow_transport } from "./automation_discussion";
import { AutomationDetailView, AutomationStateLabel, automation_panel_props, route_row_action, type AutomationsHandlers } from "./automations_page";
import { discuss_index } from "./automations";

function summary(over: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    automation_id: "a1",
    title: "Morning news",
    status: "active",
    trigger: { binding_id: "b", source_id: "schedule", source_version: 1, config: { every: "1d" } },
    context_mode: "independent",
    workspace_root: "/home/ubuntu/.local/share/abstractgateway/workspaces/session-automation-a1",
    current_occurrence: null,
    occurrence_count: 3,
    attention: { pending_waits: 0, unread: false, unseen_count: 0, cursor: "att1:0", items: [], waits: [] },
    legacy: false,
    revision: 1,
    updated_at: "2026-09-28T00:00:00Z",
    capabilities: ["revise", "pause", "resume", "run_now", "stop_current", "archive", "discuss"],
    session_kind: "automation",
    last_occurrence: { run_id: "r3", index: 3, status: "completed", attempts: 1, fired_at: "2026-09-28T00:00:00Z", excerpt: "news", notify: null },
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("state as word then icon (the kit's one rendering)", () => {
  it("renders 'Active' then the play icon, 'Paused' then the pause icon, in the row's state field", () => {
    for (const status of ["active", "paused"] as const) {
      const html = renderToStaticMarkup(<AutomationStateLabel status={status} />);
      expect(html).toContain('data-field="state"');
      expect(html).toMatch(new RegExp(`data-state="${status}"><span class="af-auto__status-word">${STATUS_LABELS[status]}</span><svg`));
    }
    expect(STATUS_ICONS.active).toBe("play");
    expect(STATUS_ICONS.paused).toBe("pause");
  });
});

describe("Discuss opens a chat in place", () => {
  it("a row Discuss forks at the latest FINISHED occurrence; other actions go to the app", () => {
    expect(route_row_action(summary(), "discuss")).toEqual({ kind: "discuss", index: 3 });
    const running = summary({ last_occurrence: { ...summary().last_occurrence!, status: "running" } });
    expect(route_row_action(running, "discuss")).toEqual({ kind: "discuss", index: 2 });
    expect(discuss_index(summary({ last_occurrence: { ...summary().last_occurrence!, index: 1, status: "running" } }))).toBeNull();
    expect(route_row_action(summary(), "pause")).toEqual({ kind: "forward" });
  });

  it("the next turn starts on the discussion's own workflow and session", () => {
    expect(discussion_turn_target("basic-agent@0.0.5:81795ea9")).toEqual({ bundle_id: "basic-agent@0.0.5", flow_id: "81795ea9" });
    expect(() => discussion_turn_target("controller")).toThrow(/bundle@version:flow/);
  });

  it("panel-chat's transport runs over the Observer's gateway client", async () => {
    const calls: string[] = [];
    const gw = {
      get_run: async (id: string) => (calls.push(`run:${id}`), { run_id: id }),
      get_run_history_bundle: async (id: string, o: any) => (calls.push(`history:${id}:${o.include_session}:${o.ledger_mode}`), {}),
      get_ledger: async (id: string, o: any) => (calls.push(`ledger:${id}:${o.after}`), { items: [], next_after: o.after }),
      stream_ledger: async (id: string, o: any) => {
        calls.push(`stream:${id}:${o.after}`);
        o.on_open?.();
      },
      submit_command: async (c: any) => (calls.push(`cmd:${c.type}`), {}),
    };
    const t = observer_workflow_transport(gw as any);
    let opened = false;
    await t.getRun("r1");
    await t.getHistory("r1");
    await t.getLedger("r1", 4);
    await t.streamLedger("r1", 5, () => {}, new AbortController().signal, () => (opened = true));
    await t.submitCommand({ command_id: "c", run_id: "r1", type: "cancel", payload: {} });
    expect(calls).toEqual(["run:r1", "history:r1:true:full", "ledger:r1:4", "stream:r1:5", "cmd:cancel"]);
    expect(opened).toBe(true);
  });

});

describe("the automation's folder in a web app: browse, open, download through the gateway", () => {
  it("fetch_gateway joins the base URL and carries this connection's bearer (the kit browser's transport)", async () => {
    const seen: Array<{ url: string; auth: string | null; accept: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      seen.push({ url, auth: init?.headers?.Authorization ?? null, accept: init?.headers?.Accept ?? null });
      return new Response("{}", { status: 200 });
    });
    const gw = new GatewayClient({ base_url: "http://vps:8080", auth_token: "tok" });
    await gw.fetch_gateway("/api/gateway/runs/a1/workspace/files?path=x", { headers: { Accept: "application/json" } });
    expect(seen).toEqual([{ url: "http://vps:8080/api/gateway/runs/a1/workspace/files?path=x", auth: "Bearer tok", accept: "application/json" }]);
  });

  it("a model-written HTML or SVG file never opens as a page in the app's origin", () => {
    expect(tabOpenPlan("text/html; charset=utf-8")).toEqual({ mode: "open", type: "text/plain;charset=utf-8" });
    expect(tabOpenPlan("image/svg+xml")).toEqual({ mode: "open", type: "text/plain;charset=utf-8" });
  });

  it("the panel's folder controls open the kit browser for that run, above the panel", () => {
    const s = summary();
    const ctl = { state: { selected_id: "a1", busy: false, trigger_sources: [], detail: { automation_id: "a1", summary: s, occurrences: [], next_cursor: null } } } as any;
    const opened: string[] = [];
    const host = { on_open_run: () => {}, on_open_session: () => {}, on_open_workspace: (id: string) => opened.push(id) };
    const p = automation_panel_props(ctl, host)!;
    p.onOpenWorkspace!("a1");
    expect(opened).toEqual(["a1"]);
    const html = renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={host} h={{} as AutomationsHandlers} browser={<div data-probe="browser" />} />);
    expect(html.indexOf('data-probe="browser"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-probe="browser"')).toBeLessThan(html.indexOf("af-auto"));
    // The kit panel shows its folder control only when the host can open it.
    expect(renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={host} h={{} as AutomationsHandlers} />)).toContain('data-action="open-workspace"');
    // The runs read as the shared chat cards (panel-chat ChatMessageCard).
    const occ = { run_id: "r3", index: 3, attempts: 1, fired_at: "2026-09-28T00:00:00Z", finished_at: "2026-09-28T00:01:00Z", status: "completed",
      trigger: { source_id: "schedule", summary: "every 1 day" }, user_turn: "Summarize the news", answer: "Three stories today.", notify: null, artifacts: [], waits: [], ledger_url: "/l" };
    const withRun = { ...ctl, state: { ...ctl.state, detail: { ...ctl.state.detail, occurrences: [occ] } } };
    const transcript = renderToStaticMarkup(<AutomationDetailView ctl={withRun} host={host} h={{} as AutomationsHandlers} />);
    expect(transcript).toMatch(/pc-chat-item pc-chat-item--[a-z]+[^>]*>[^]*Summarize the news/);
    expect(transcript).toMatch(/pc-chat-item[^]*Three stories today\./);
    const bare = { on_open_run: () => {}, on_open_session: () => {} };
    expect(automation_panel_props(ctl, bare)!.onOpenWorkspace).toBeUndefined();
  });
});
