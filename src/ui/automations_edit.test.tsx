// Operator 2026-09-28 (Observer 0.1.14 on a VPS): "when i click 'edit', i
// would expect to EDIT the automation. instead, it does NOTHING. i have to go
// to the right and click revise... not intuitive at all. edit => i can edit
// right now." Plus: icons on every action, the state as the kit label, one
// name per action, brief feedback.
//
// Against the contract-F stub gateway (real HTTP, the real kit client,
// controller and panel wiring). The click-through in a browser (row Edit →
// focused form → Save → PATCH → form closed) is exercised by the Playwright
// harness recorded in the CHANGELOG; these checks pin every link of that chain
// that runs without a DOM.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAutomationsClient, reviseChanges, reviseFormFrom, type AutomationsClient } from "@abstractframework/ui-kit";

// @ts-expect-error — plain ESM helper without type declarations
import { loadFixture, startAutomationsStub } from "../../scripts/automations_stub_server.mjs";
import { GatewayClient } from "../lib/gateway_client";
import { AutomationsController, observer_automations_host } from "./automations";
import { AutomationDetailView, AutomationsListView, automation_panel_props, route_row_action, type AutomationsHandlers, type PanelHostHandlers } from "./automations_page";

const NOW = Date.parse("2026-09-27T07:10:00Z");
const LIST = loadFixture("list");
const INBOX = LIST.items.find((s: any) => !s.legacy && s.status === "active" && s.trigger.source_id === "schedule" && s.workspace_root);
if (!INBOX) throw new Error("list.json has no active scheduled automation with a workspace");
const ID: string = INBOX.automation_id;

type Stub = Awaited<ReturnType<typeof startAutomationsStub>>;
let stub: Stub;
let client: AutomationsClient;
let ctl: AutomationsController;
let n = 0;

const host: PanelHostHandlers = { on_open_run: () => {}, on_open_session: () => {}, on_open_workspace: () => {} };
const handlers: AutomationsHandlers = {
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

function unescape(html: string): string {
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function detail_html(edit?: { open: boolean; on_change(open: boolean): void }): string {
  const props = { ctl, host, h: handlers, ...(edit ? { edit } : {}) } as React.ComponentProps<typeof AutomationDetailView>;
  return unescape(renderToStaticMarkup(<AutomationDetailView {...props} />));
}

/** Every `<button …>…</button>` whose opening tag matches `attr`. */
function buttons(html: string, attr = ""): string[] {
  return [...html.matchAll(/<button\b[^>]*>[^]*?<\/button>/g)].map((m) => m[0]).filter((b) => b.includes(attr));
}

beforeEach(async () => {
  stub = await startAutomationsStub({ now: () => NOW });
  client = createAutomationsClient({ fetch: (u, i) => fetch(u, i), baseUrl: stub.url, newId: () => `id-${++n}` });
  const gateway = new GatewayClient({ base_url: stub.url, auth_token: "" });
  ctl = new AutomationsController(client, observer_automations_host(gateway, () => "cmd-host", () => "2026-09-27T07:10:00Z"), []);
  await ctl.refresh();
});

afterEach(async () => {
  await stub.close();
});

describe("Edit edits, right now", () => {
  it("a row's Edit is handled by the page (select + open the Edit form), not forwarded to the app", () => {
    expect(route_row_action(INBOX, "edit")).toEqual({ kind: "edit" });
    expect(route_row_action(INBOX, "pause")).toEqual({ kind: "forward" });
  });

  it("the detail shows the Edit form, prefilled from the current definition, exactly while the page has it open", async () => {
    await ctl.select(ID);
    const d = ctl.state.detail!;
    expect(d.definition).toBeTruthy();
    const open = detail_html({ open: true, on_change: () => {} });
    const form = /<form class="af-auto__revise"[^]*?<\/form>/.exec(open)?.[0] ?? "";
    expect(form, "the Edit form is open").not.toBe("");
    expect(form).toContain("Edit automation");
    expect(form).toMatch(new RegExp(`name="title"[^>]*value="${d.summary.title}"`));
    const prompt = (d.definition!.target.input_data as { prompt: string }).prompt;
    expect(form).toMatch(new RegExp(`<textarea[^>]*name="prompt"[^>]*>${prompt}</textarea>`));
    const every = /^(\d+)([mhd])$/.exec((d.summary.trigger.config as { every: string }).every)!;
    expect(form).toMatch(new RegExp(`name="every_amount"[^>]*value="${every[1]}"`));
    expect(form).toContain(`name="tool_approval"`);
    // Closed: no form, and the definition card is there instead.
    const closed = detail_html({ open: false, on_change: () => {} });
    expect(closed).not.toContain('class="af-auto__revise"');
    expect(closed).toContain('class="af-auto__definition"');
  });

  it("the panel is driven by the page: editOpen / onEditOpenChange come from the page's edit state", async () => {
    await ctl.select(ID);
    const seen: boolean[] = [];
    const p = automation_panel_props(ctl, host, { open: true, on_change: (o) => seen.push(o) })!;
    expect(p.editOpen).toBe(true);
    p.onEditOpenChange?.(false);
    expect(seen).toEqual([false]);
  });

  it("Save sends ONE revise with expected_revision: the task, interval and tool approval the form changed", async () => {
    await ctl.select(ID);
    const d = ctl.state.detail!;
    const form = { ...reviseFormFrom(d.summary, d.definition), prompt: "Only the urgent ones, please.", every: "1h", toolApproval: "ask" as const };
    const changes = reviseChanges(d.summary, form, d.definition);
    if (!changes || "errors" in changes) throw new Error(`no changes: ${JSON.stringify(changes)}`);
    const p = automation_panel_props(ctl, host, { open: true, on_change: () => {} })!;
    const before = stub.requests.length;
    await p.onRevise(changes, d.summary.revision, { command_id: "cmd-edit-1" });
    const sent = stub.requests.slice(before).filter((r: any) => r.method === "PATCH");
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe(`/api/gateway/automations/${ID}`);
    expect(sent[0].body.expected_revision).toBe(d.summary.revision);
    expect(sent[0].body.command_id).toBe("cmd-edit-1");
    expect(sent[0].body.changes.target).toEqual({
      bundle_ref: d.definition!.target.bundle_ref,
      flow_id: d.definition!.target.flow_id,
      input_data: { ...d.definition!.target.input_data, prompt: "Only the urgent ones, please." },
    });
    expect(sent[0].body.changes.trigger.config.every).toBe("1h");
    expect(sent[0].body.changes.policy).toEqual({ tool_approval: "ask" });
    expect(Object.keys(sent[0].body.changes).sort()).toEqual(["policy", "target", "trigger"]);
    // The next read shows the new revision and task.
    await ctl.select(ID);
    expect(ctl.state.detail!.summary.revision).toBe(d.summary.revision + 1);
    expect((ctl.state.detail!.definition!.target.input_data as { prompt: string }).prompt).toBe("Only the urgent ones, please.");
  });
});

describe("one name per action: Edit, never Revise", () => {
  it("the detail's control is Edit (row, panel and form agree)", async () => {
    await ctl.select(ID);
    const closed = detail_html({ open: false, on_change: () => {} });
    const open = detail_html({ open: true, on_change: () => {} });
    const list = unescape(renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={handlers} />));
    const edit = buttons(closed, 'data-action="edit"');
    expect(edit).toHaveLength(1);
    expect(edit[0]).toMatch(/<span>Edit<\/span><\/button>$/);
    expect(buttons(list, 'data-action="edit"')[0]).toMatch(/<span>Edit<\/span><\/button>$/);
    expect(buttons(open, 'type="submit"')[0]).toContain("Save changes");
    for (const html of [closed, open, list]) expect(html).not.toMatch(/Revis(e|ion sent)/);
  });
});

describe("icons on every action", () => {
  it("every button in the rows, the controls and the Edit form starts with a kit icon", async () => {
    await ctl.select(ID);
    const list = unescape(renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={handlers} />));
    const open = detail_html({ open: true, on_change: () => {} });
    const controls = /<div class="af-auto__controls"[^]*?<\/div>/.exec(open)?.[0] ?? "";
    const form = /<form class="af-auto__revise"[^]*?<\/form>/.exec(open)?.[0] ?? "";
    const rows = /<ul class="auto_rows">[^]*<\/ul>/.exec(list)?.[0] ?? "";
    const all = [...buttons(rows, "data-action="), ...buttons(controls), ...buttons(form)];
    expect(buttons(controls).length).toBeGreaterThanOrEqual(5);
    expect(buttons(form).length).toBe(2);
    for (const b of all) expect(b, b).toMatch(/^<button\b[^>]*><svg\b/);
    // The page's own actions: Refresh and New automation are icons too.
    expect(list).toMatch(/data-action="refresh"[^>]*><svg\b/);
    expect(list).toMatch(/data-action="new"[^>]*><svg\b/);
  });

  it("the state is the kit label (word then icon), never a lowercase pill", () => {
    const list = unescape(renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={handlers} />));
    expect(list).toMatch(/<span class="af-auto__status-word">Active<\/span><svg\b/);
    expect(list).not.toMatch(/>(active|paused)</);
  });

  it("the workspace is one control: folder icon + the whole path, wrapping at its separators", async () => {
    await ctl.select(ID);
    const open = detail_html({ open: false, on_change: () => {} });
    const ws = buttons(open, 'data-action="open-workspace"')[0] ?? "";
    expect(ws).toMatch(/^<button\b[^>]*><svg\b/);
    expect(ws.replace(/<[^>]+>/g, "")).toBe(INBOX.workspace_root);
    expect(ws).toContain("/<wbr/>");
  });
});

describe("action feedback is brief, not left lying around", () => {
  it("the list's feedback line is dismissible and the controller clears it", async () => {
    await ctl.row_action(INBOX, "pause");
    expect(ctl.state.notice).toMatch(/^Pause sent to/);
    let dismissed = 0;
    const list = unescape(
      renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={{ ...handlers, on_dismiss_notice: () => (dismissed += 1) }} />),
    );
    expect(buttons(list, 'data-action="dismiss-notice"')).toHaveLength(1);
    (ctl as unknown as { dismiss_notice(): void }).dismiss_notice();
    expect(ctl.state.notice).toBe("");
    expect(dismissed).toBe(0);
  });

  it("the panel's disabled-control reasons are one compact visible line, and each disabled button's tooltip", async () => {
    await ctl.select(ID);
    const html = detail_html({ open: false, on_change: () => {} });
    const reasons = /<p class="af-auto__reasons"><svg[^]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(reasons).toMatch(/<span id="[^"]+">[^<]+: [^<]+<\/span>/);
    expect(html).not.toContain("af-auto__sr-only");
    const controls = /<div class="af-auto__controls"[^]*?<\/div>/.exec(html)?.[0] ?? "";
    const disabled = buttons(controls, 'disabled=""');
    expect(disabled.length).toBeGreaterThan(0);
    for (const b of disabled) expect(b).toMatch(/title="[^"]+"/);
  });
});
