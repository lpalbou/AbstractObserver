// Operator field reports 2026-09-28 (Observer 0.1.14 on a remote VPS):
// the automation's folder is browsable from the web UI; Discuss opens a chat
// with the fork in place (shared panel-chat stack); state reads word + icon.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationSummary } from "@abstractframework/ui-kit";

import { GatewayClient, type WorkspaceListing } from "../lib/gateway_client";
import { discussion_interaction, discussion_turn_target, observer_workflow_transport } from "./automation_discussion";
import { AutomationDetailView, AutomationStateLabel, route_row_action, type AutomationsHandlers } from "./automations_page";
import { AUTOMATION_STATE_VIEW, discuss_index } from "./automations";
import { WorkspaceBrowserView, hidden_note, sorted_entries, workspace_crumbs } from "./workspace_browser";

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

describe("state as word then icon", () => {
  it("renders 'Active' then the play icon, 'Paused' then the pause icon", () => {
    for (const status of ["active", "paused"] as const) {
      const html = renderToStaticMarkup(<AutomationStateLabel status={status} />);
      expect(html).toMatch(new RegExp(`data-state="${status}"><span class="auto_state_word">${AUTOMATION_STATE_VIEW[status].label}</span><svg`));
    }
    expect(AUTOMATION_STATE_VIEW.active.icon).toBe("playCircle");
    expect(AUTOMATION_STATE_VIEW.paused.icon).toBe("pause");
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

  it("a discussion's tool approval and question are answerable in the chat", async () => {
    const approve = vi.fn(async () => ({}));
    const resume = vi.fn(async () => ({}));
    const ctl = { approve, resume } as any;
    const tool = discussion_interaction(
      { runId: "r9", stepId: "s", wait: { wait_key: "k1", reason: "user", details: { mode: "approval_required", tool_calls: [{ name: "write_file", arguments: { file_path: "x" } }] } } },
      ctl,
    );
    expect(tool?.kind).toBe("tool-approval");
    await (tool as any).onApprove();
    expect(approve).toHaveBeenCalledWith(true, { runId: "r9", waitKey: "k1", stepId: "s" });
    const ask = discussion_interaction({ runId: "r9", wait: { wait_key: "k2", reason: "ask_user", prompt: "Which one?", choices: ["a", "b"] } }, ctl);
    expect(ask).toMatchObject({ kind: "ask-user", prompt: "Which one?" });
    await (ask as any).onSubmit("a");
    expect(resume).toHaveBeenCalledWith("a");
    expect(discussion_interaction(null, ctl)).toBeNull();
  });
});

describe("the automation's folder in a web app: browse, open, download through the gateway", () => {
  const listing: WorkspaceListing = {
    path: "",
    truncated: false,
    hidden: { blocked: 2, outside_links: 0, other: 0 },
    entries: [
      { name: "digest.md", path: "digest.md", type: "file", size_bytes: 2048 },
      { name: "archive", path: "archive", type: "dir" },
    ],
  };

  it("lists folders first, offers Open and Download per file, and says what the gateway hid", () => {
    const html = renderToStaticMarkup(
      <WorkspaceBrowserView
        title="Automation files"
        where={{ run_id: "a1", workspace_root: "/srv/ws/a1", kind: "session", exists: true }}
        path=""
        listing={listing}
        error=""
        loading={false}
        file_busy=""
        on_navigate={() => {}}
        on_refresh={() => {}}
        on_file={() => {}}
      />,
    );
    expect(html).toContain('data-workspace-root="/srv/ws/a1"');
    expect(html.indexOf('data-path="archive"')).toBeLessThan(html.indexOf('data-path="digest.md"'));
    expect(html).toContain('data-action="open-file"');
    expect(html).toContain('data-action="download-file"');
    expect(html).toContain("2.0 KB");
    expect(html).toContain("2 entries hidden by the gateway&#x27;s workspace rules");
    expect(sorted_entries(listing.entries).map((e) => e.type)).toEqual(["dir", "file"]);
    expect(workspace_crumbs("a/b")).toEqual([{ label: "Workspace", path: "" }, { label: "a", path: "a" }, { label: "b", path: "a/b" }]);
    expect(hidden_note({ truncated: false, hidden: {} })).toBe("");
  });

  it("the gateway client reads the three workspace routes with this connection's bearer", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      seen.push({ url, auth: init?.headers?.Authorization ?? null });
      if (url.includes("/content")) return new Response("hello", { status: 200 });
      if (url.includes("/files")) return new Response(JSON.stringify(listing), { status: 200 });
      return new Response(JSON.stringify({ run_id: "a1", workspace_root: "/srv/ws/a1", kind: "session", exists: true }), { status: 200 });
    });
    const gw = new GatewayClient({ base_url: "http://vps:8080", auth_token: "tok" });
    expect((await gw.run_workspace("a1")).workspace_root).toBe("/srv/ws/a1");
    expect((await gw.run_workspace_files("a1", "archive")).entries).toHaveLength(2);
    expect(await (await gw.run_workspace_file("a1", "archive/x y.md")).text()).toBe("hello");
    expect(seen.map((s) => s.url)).toEqual([
      "http://vps:8080/api/gateway/runs/a1/workspace",
      "http://vps:8080/api/gateway/runs/a1/workspace/files?path=archive&recursive=false",
      "http://vps:8080/api/gateway/runs/a1/workspace/content?path=archive%2Fx+y.md",
    ]);
    expect(seen.every((s) => s.auth === "Bearer tok")).toBe(true);
  });

  it("a refused read shows the gateway's reason", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "the workspace folder '/x' is blocked" }), { status: 403 }));
    const gw = new GatewayClient({ base_url: "", auth_token: "" });
    await expect(gw.run_workspace_files("a1", "")).rejects.toThrow("The folder could not be listed (HTTP 403): the workspace folder '/x' is blocked");
  });

  it("the automation detail offers the folder as a Files button fed by workspace_root, and shows the browser when open", () => {
    const s = summary();
    const ctl = { state: { selected_id: "a1", busy: false, trigger_sources: [], detail: { automation_id: "a1", summary: s, occurrences: [], next_cursor: null } } } as any;
    const host = { on_open_run: () => {}, on_open_session: () => {} };
    const h = {} as AutomationsHandlers;
    const closed = renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={host} h={h} files={{ open: false, on_toggle: () => {}, render: () => <div data-probe="browser" /> }} />);
    expect(closed).toMatch(/data-action="files"[^>]*aria-pressed="false"/);
    expect(closed).toContain(s.workspace_root!);
    expect(closed).not.toContain('data-probe="browser"');
    const open = renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={host} h={h} files={{ open: true, on_toggle: () => {}, render: (id) => <div data-probe="browser" data-id={id} /> }} />);
    expect(open).toContain('data-probe="browser" data-id="a1"');
    const none = { ...ctl, state: { ...ctl.state, detail: { ...ctl.state.detail, summary: { ...s, workspace_root: undefined } } } };
    expect(renderToStaticMarkup(<AutomationDetailView ctl={none} host={host} h={h} files={{ open: true, on_toggle: () => {}, render: () => <div data-probe="browser" /> }} />)).not.toContain('data-action="files"');
  });
});
