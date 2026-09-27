// Automations v1 in the Observer — against a contract-F stub gateway seeded
// from the ui-kit's canonical fixtures (scripts/automations_stub_server.mjs).
// Real HTTP, the real kit client, the real controller and panel wiring; only
// the gateway is a stub (mission G replaces it with the hermetic gateway).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SCHEDULE_PRESETS,
  TOOL_APPROVAL_CONSENT,
  attentionLabel,
  createAutomationsClient,
  formatUtc,
  occurrenceViews,
  triggerSummary,
  type AutomationSummary,
  type AutomationsClient,
} from "@abstractframework/ui-kit";

// @ts-expect-error — plain ESM helper without type declarations
import { LEGACY_ID, LEGACY_TARGET, loadFixture, startAutomationsStub } from "../../scripts/automations_stub_server.mjs";
import { GatewayClient } from "../lib/gateway_client";
import { AutomateAdvancedSchedule, AutomateWhenContext } from "./automate_form";
import {
  AutomationsController,
  DEFAULT_AUTOMATE_FORM,
  RequestIdMemo,
  automation_row_controls,
  automations_capability,
  build_automate_request_memo,
  default_agent_choices,
  legacy_recreate_prefill,
  normalize_run_summary,
  observer_automations_host,
  parse_workflow_choice,
  run_session_tag,
  wait_answer_payload,
  type AutomateForm,
  type WorkflowChoice,
} from "./automations";
import { AutomationDetailView, AutomationsListView, automation_panel_props, type AutomationsHandlers, type PanelHostHandlers } from "./automations_page";
import { board_card, board_columns } from "./mission_control";
import { extract_tool_calls_from_wait } from "../lib/runtime_extractors";
import { build_run_tree_sections } from "./run_tree";
import { build_runtime_activity_views, count_runtime_activity_queues } from "./runtime_activity";

const NOW = Date.parse("2026-09-27T07:10:00Z");
const LIST = loadFixture("list");
const OCC = loadFixture("occurrences");
const COMMANDS = loadFixture("commands");
// Roles picked by SHAPE (the fixtures are regenerated from gateway output; their order is not a contract).
function fixture(pred: (s: any) => boolean, what: string): any {
  const hit = LIST.items.find(pred);
  if (!hit) throw new Error(`list.json has no ${what}`);
  return hit;
}
const NEWS = fixture((s) => !s.legacy && s.status === "active" && s.attention.pending_waits === 0 && s.next_fire_at, "quiet active automation");
const INBOX = fixture((s) => !s.legacy && s.attention.pending_waits > 0 && s.attention.unseen_count > 0, "automation waiting for a person with unseen attention");
const JOURNAL = fixture((s) => !s.legacy && s.status === "paused", "paused automation");
const NEWS_ID: string = NEWS.automation_id;
const INBOX_ID: string = INBOX.automation_id;
const JOURNAL_ID: string = JOURNAL.automation_id;

type Stub = Awaited<ReturnType<typeof startAutomationsStub>>;
let stub: Stub;
let ids: string[];
let client: AutomationsClient;
let gateway: GatewayClient;
let ctl: AutomationsController;
let opened: { runs: string[]; sessions: Array<{ session_id: string; run_id: string }> };

function next_id(): string {
  const v = ids.shift();
  if (!v) throw new Error("test ran out of ids");
  return v;
}

const bundle_refs: Record<string, string> = { "news-agent": "news-agent@1.0.0", "mail-agent": "mail-agent@2.1.0", "journal-watch": "journal-watch@0.3.0" };
const bundle_ref_for = (bid: string) => bundle_refs[bid] || "";

const host_handlers: PanelHostHandlers = {
  on_open_run: (rid) => opened.runs.push(rid),
  on_open_session: (d) => opened.sessions.push(d),
};

const noop_handlers: AutomationsHandlers = {
  on_select: () => {},
  on_row_action: () => {},
  on_legacy_action: () => {},
  on_confirm_archive: () => {},
  on_cancel_archive: () => {},
  on_status_filter: () => {},
  on_refresh: () => {},
  on_new: () => {},
};

function requests_since(n: number): Array<{ method: string; path: string; body: any }> {
  return stub.requests.slice(n);
}

function last_request(method: string, path_prefix: string): { method: string; path: string; body: any } {
  const hit = [...stub.requests].reverse().find((r: any) => r.method === method && r.path.startsWith(path_prefix));
  if (!hit) throw new Error(`no ${method} ${path_prefix} request`);
  return hit;
}

function unescape(html: string): string {
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function list_html(): string {
  return unescape(renderToStaticMarkup(<AutomationsListView state={ctl.state} available={{ available: true, reason: "" }} h={noop_handlers} />));
}

function detail_html(): string {
  return unescape(renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={host_handlers} h={noop_handlers} />));
}

function summary_of(id: string): AutomationSummary {
  const s = ctl.state.items.find((x) => x.automation_id === id);
  if (!s) throw new Error(`automation ${id} not listed`);
  return s;
}

async function automate(form: Partial<AutomateForm>, choice: WorkflowChoice, input_data: Record<string, any>, request_id: string) {
  const built = build_automate_request_memo({ ...DEFAULT_AUTOMATE_FORM, ...form }, { choice, bundle_ref_for, input_data }, new RequestIdMemo(() => request_id));
  if (!built.ok) throw new Error(built.errors.join("; "));
  return { body: built.body, res: await client.createAutomation(built.body) };
}

beforeEach(async () => {
  stub = await startAutomationsStub({ now: () => NOW, pageSize: 2 });
  ids = [];
  opened = { runs: [], sessions: [] };
  client = createAutomationsClient({ fetch: (u, i) => fetch(u, i), baseUrl: stub.url, newId: next_id });
  gateway = new GatewayClient({ base_url: stub.url, auth_token: "" });
  ctl = new AutomationsController(client, observer_automations_host(gateway, () => "cmd-host", () => "2026-09-27T07:10:00Z"), []);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await stub.close();
});

// --- Launch → Automate ------------------------------------------------------------

describe("Launch → Automate builds the exact POST /api/gateway/automations body", () => {
  const news: WorkflowChoice = { kind: "bundle", bundle_id: "news-agent", flow_id: "main" };

  it.each([
    ["every 8 hours", "8h"],
    ["every 24 hours", "24h"],
    ["every 7 days", "7d"],
  ])("preset %s", async (label, every) => {
    const preset = SCHEDULE_PRESETS.find((p) => p.label === label);
    expect(preset, `kit preset ${label}`).toBeTruthy();
    const w = preset!.when as { amount: number; unit: "m" | "h" | "d" };
    const { res } = await automate({ amount: String(w.amount), unit: w.unit }, news, { prompt: "  Search the AI news of the last hours  ", provider: "lmstudio" }, `req-${every}`);
    expect(last_request("POST", "/api/gateway/automations")).toEqual({
      method: "POST",
      path: "/api/gateway/automations",
      body: {
        request_id: `req-${every}`,
        title: "Search the AI news of the last hours",
        target: { bundle_ref: "news-agent@1.0.0", flow_id: "main", input_data: { provider: "lmstudio", prompt: "Search the AI news of the last hours" } },
        trigger: { source_id: "schedule", source_version: 1, config: { every } },
        context: { mode: "independent" },
        // Decision D1: creating the automation is the consent; "auto" by default.
        policy: { tool_approval: "auto" },
      },
    });
    expect(res.summary.trigger.config.every).toBe(every);
  });

  it("once at a UTC time, and custom count/until/first run under Advanced", async () => {
    await automate({ when: "once", once_at: "2026-09-28T08:00" }, news, { prompt: "One-off check" }, "req-once");
    expect(last_request("POST", "/api/gateway/automations").body.trigger).toEqual({ source_id: "schedule", source_version: 1, config: { start_at: "2026-09-28T08:00:00Z" } });
    await automate(
      { amount: "12", unit: "h", context: "growing", title: "Energy watch", start_at: "2026-09-27T09:00", count: "10", until: "2026-10-31T00:00" },
      news,
      { prompt: "Energy prices" },
      "req-custom",
    );
    const body = last_request("POST", "/api/gateway/automations").body;
    expect(body.title).toBe("Energy watch");
    expect(body.context).toEqual({ mode: "growing" });
    expect(body.trigger.config).toEqual({ every: "12h", start_at: "2026-09-27T09:00:00Z", count: 10, until: "2026-10-31T00:00:00Z" });
  });

  it("accepts the gateway default agent (@default + interface) and the gateway resolves it", async () => {
    const choices = default_agent_choices([{ label: "basic-agent · Basic", agent_default_interfaces: ["abstractcode.agent.v1"] }]);
    expect(choices[0].value).toBe("@default:abstractcode.agent.v1");
    const choice = parse_workflow_choice(choices[0].value);
    expect(choice).toEqual({ kind: "default", interface: "abstractcode.agent.v1" });
    const { res } = await automate({}, choice!, { prompt: "Monitor memory usage of this computer" }, "req-default");
    expect(last_request("POST", "/api/gateway/automations").body.target).toEqual({
      flow_id: "@default",
      interface: "abstractcode.agent.v1",
      input_data: { prompt: "Monitor memory usage of this computer" },
    });
    const detail = await client.getAutomation(res.automation_id);
    expect(detail.definition.target.flow_id).not.toBe("@default");
  });

  it("Run once starts @default with its interface (no bundle_id); the legacy schedule route is gone", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ run_id: "r1" }), { status: 200 });
    });
    const gw = new GatewayClient({ base_url: "http://gw", auth_token: "" });
    await gw.start_run("@default", { prompt: "hi" }, { interface: "abstractcode.agent.v1", session_id: "s1" });
    expect(calls[0]).toEqual({ url: "http://gw/api/gateway/runs/start", body: { input_data: { prompt: "hi" }, flow_id: "@default", session_id: "s1", interface: "abstractcode.agent.v1" } });
    await expect(gw.start_run("@default", {}, {})).rejects.toThrow(/interface/);
    expect((gw as any).schedule_run).toBeUndefined();
  });

  it("refuses to build without a prompt, a target, a valid interval, or a bundle_ref", () => {
    const memo = new RequestIdMemo(() => "x");
    const bad = (form: Partial<AutomateForm>, choice: WorkflowChoice | null, input: Record<string, any>) =>
      build_automate_request_memo({ ...DEFAULT_AUTOMATE_FORM, ...form }, { choice, bundle_ref_for, input_data: input }, memo);
    expect(bad({}, news, {})).toMatchObject({ ok: false });
    expect(bad({}, null, { prompt: "x" })).toMatchObject({ ok: false, errors: ["Choose what to run."] });
    expect(bad({ amount: "1.5" }, news, { prompt: "x" })).toMatchObject({ ok: false });
    expect(bad({}, { kind: "bundle", bundle_id: "unpublished", flow_id: "main" }, { prompt: "x" })).toMatchObject({ ok: false, errors: [expect.stringMatching(/bundle_ref/)] });
  });

  it("a retry of the same body reuses its request id; a changed body mints a new one", () => {
    let n = 0;
    const memo = new RequestIdMemo(() => `req-${++n}`);
    const build = (prompt: string) => build_automate_request_memo(DEFAULT_AUTOMATE_FORM, { choice: news, bundle_ref_for, input_data: { prompt } }, memo);
    const a = build("A");
    const b = build("A");
    const c = build("B");
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.body.request_id).toBe(b.body.request_id);
      expect(c.body.request_id).not.toBe(a.body.request_id);
    }
  });

  it("When/Context speak fixed UTC intervals, Growing discloses its bounded history, Advanced holds the schedule extras", () => {
    const html = unescape(renderToStaticMarkup(<AutomateWhenContext form={DEFAULT_AUTOMATE_FORM} on_change={() => {}} />));
    expect(html).toContain("When (UTC)");
    for (const p of SCHEDULE_PRESETS) expect(html).toContain(`data-preset="${p.label}"`);
    expect(html).toContain("Runs every 24 hours (UTC), first run now.");
    expect(html).toContain("most recent 40 messages");
    expect(html).not.toMatch(/daily at|local time|weekly on/i);
    const adv = unescape(renderToStaticMarkup(<AutomateAdvancedSchedule form={DEFAULT_AUTOMATE_FORM} on_change={() => {}} />));
    expect(adv).toContain("Title");
    expect(adv).toContain("Stop after this many runs");
    expect(adv).toContain("Stop at (UTC)");
    // D1: the consent line with the target's tools, and the "ask" option.
    const tools = unescape(renderToStaticMarkup(<AutomateWhenContext form={DEFAULT_AUTOMATE_FORM} tools={["fetch_url", "execute_command"]} on_change={() => {}} />));
    expect(tools).toContain(TOOL_APPROVAL_CONSENT);
    expect(tools).toContain("fetch_url, execute_command");
    expect(tools).toContain("Ask each time");
  });

  it("the Ask each time option sends policy.tool_approval \"ask\"", async () => {
    await automate({ tool_approval: "ask" }, news, { prompt: "Fetch the headlines" }, "req-ask");
    expect(last_request("POST", "/api/gateway/automations").body.policy).toEqual({ tool_approval: "ask" });
  });
});

// --- the Automations page -------------------------------------------------------------

describe("Automations page", () => {
  it("lists every page of GET /automations (never changed_since) and renders the fixture rows", async () => {
    await ctl.refresh();
    const gets = stub.requests.filter((r: any) => r.method === "GET" && r.path.startsWith("/api/gateway/automations?"));
    expect(gets.length).toBeGreaterThanOrEqual(2); // pageSize 2: the client followed next_cursor
    expect(gets.every((r: any) => !r.path.includes("changed_since"))).toBe(true);
    expect(ctl.state.items.map((s) => s.automation_id)).toEqual(LIST.items.map((s: any) => s.automation_id));
    const html = list_html();
    for (const s of LIST.items) {
      expect(html).toContain(s.title);
      expect(html).toContain(triggerSummary(s.trigger));
      if (s.last_occurrence) expect(html).toContain(s.last_occurrence.excerpt);
    }
    expect(html).toContain(`next: ${formatUtc(NEWS.next_fire_at)}`);
    expect(html).toContain("next: none while paused");
    const inboxRow = html.slice(html.indexOf(`data-automation-id="${INBOX_ID}"`));
    expect(inboxRow.slice(0, inboxRow.indexOf("</li>"))).toContain(`data-field="attention">${attentionLabel(INBOX)}`);
    const newsRow = html.slice(html.indexOf(`data-automation-id="${NEWS_ID}"`));
    expect(newsRow.slice(0, newsRow.indexOf("</li>"))).not.toContain('data-field="attention"'); // quiet stays quiet
  });

  it("opens the panel for a row: definition, occurrences as chat pairs with failure and wait states", async () => {
    await ctl.refresh();
    await ctl.select(NEWS_ID);
    const pending = ctl.select(INBOX_ID);
    expect(detail_html()).toContain("Loading…"); // never the previous automation's panel
    expect(detail_html()).not.toContain(NEWS.title);
    await pending;
    expect(ctl.state.detail?.definition?.revision).toBe(1);
    expect(ctl.state.detail!.occurrences).toHaveLength(2); // stub pages of 2, newest first
    expect(detail_html()).toContain("Load earlier occurrences (5 more)");
    const before = stub.requests.length;
    automation_panel_props(ctl, host_handlers)!.onLoadMore(); // the panel's button
    await vi.waitFor(() => expect(ctl.state.detail!.occurrences).toHaveLength(4));
    expect(requests_since(before).map((r) => r.path)).toContain(`/api/gateway/automations/${INBOX_ID}/occurrences?cursor=p2&limit=50`);
    while (ctl.state.detail!.next_cursor) await ctl.load_more();
    expect(ctl.state.detail!.occurrences).toHaveLength(OCC.items.length);
    const html = detail_html();
    for (const o of OCC.items) expect(html).toContain(o.user_turn);
    const failed = OCC.items.find((o: any) => o.status === "failed");
    expect(failed.failure, "fixture carries the failure field").toBeTruthy();
    expect(html).toContain(failed.failure.message);
    const waiting = OCC.items.find((o: any) => o.waits.length);
    expect(html).toContain(waiting.waits[0].prompt);
    expect(html).toContain("Discuss — forked session, read-only workspace");
    // Chat order: oldest first within what is loaded.
    const views = occurrenceViews(ctl.state.detail!.occurrences);
    expect(views.map((v) => v.row.index)).toEqual([...OCC.items].map((o: any) => o.index).sort((a: number, b: number) => a - b));
  });

  it("row and panel actions send the exact request bodies of commands.json", async () => {
    // A controller whose host mints the fixture's command ids (wait answers).
    ctl = new AutomationsController(client, observer_automations_host(gateway, next_id, () => "2026-09-27T07:10:00Z"), []);
    await ctl.refresh();
    const panel = () => automation_panel_props(ctl, host_handlers)!;
    const idOf = (path: string) => path.split("/")[4];
    // stop_current last: it would cancel the waits the answers resolve.
    const ordered = [...COMMANDS.items].sort((a: any, b: any) => Number(a.request.body.type === "automation.stop_current") - Number(b.request.body.type === "automation.stop_current"));
    const seenDup = new Set<string>();
    let covered = 0;
    for (const fx of ordered) {
      const { method, path, body } = fx.request;
      const before = stub.requests.length;
      if (method === "PATCH") {
        await ctl.select(idOf(path));
        await panel().onRevise(body.changes, body.expected_revision, { command_id: body.command_id });
      } else if (/^\/api\/gateway\/automations\/[^/]+\/commands$/.test(path)) {
        const id = idOf(path);
        const action = String(body.type).replace("automation.", "");
        const key = `${id}|${body.command_id}`;
        if (seenDup.has(key)) {
          // Same command_id again: the gateway answers it as a duplicate, not a new command.
          const r = await client.sendAutomationCommand(id, { type: body.type, command_id: body.command_id });
          expect(r, fx.name).toMatchObject({ command_id: fx.response.command_id, accepted: fx.response.accepted, duplicate: true });
        } else if (action === "stop_current") {
          stub.fire(id, { status: "running" });
          await ctl.refresh();
          await ctl.select(id);
          await panel().onCommand(body.type, undefined, { command_id: body.command_id });
        } else {
          ids.push(body.command_id);
          await ctl.row_action(summary_of(id), action as "pause" | "resume" | "run_now" | "archive");
          expect(ctl.state.error, fx.name).toBeNull();
        }
        seenDup.add(key);
      } else if (path.endsWith("/seen")) {
        await ctl.select(idOf(path));
        await panel().onSeen(body.attention_cursor);
      } else if (path.endsWith("/discuss")) {
        await ctl.select(idOf(path));
        await panel().onDiscuss(body.occurrence_index, body.prompt, { request_id: body.request_id });
      } else if (path === "/api/gateway/commands") {
        await ctl.select(INBOX_ID);
        ids.push(body.command_id);
        await panel().onAnswerWait(body.run_id, body.payload.wait_key, body.payload.payload);
      } else {
        throw new Error(`commands.json entry this test does not drive: ${fx.name}`);
      }
      const sent = requests_since(before).find((r) => r.method === method && r.path === path);
      expect(sent, fx.name).toEqual(fx.request);
      covered += 1;
    }
    expect(covered).toBe(COMMANDS.items.length);
  });

  it("Run now is enabled while paused and keeps the automation paused", async () => {
    await ctl.refresh();
    const journal = summary_of(JOURNAL_ID);
    expect(journal.status).toBe("paused");
    expect(automation_row_controls(journal, false).run_now.enabled).toBe(true);
    const html = list_html();
    const row = html.slice(html.indexOf(`data-automation-id="${JOURNAL_ID}"`));
    expect(row.slice(0, row.indexOf("</li>"))).toMatch(/data-action="run_now"(?![^>]*disabled)/);
    ids.push("cmd-run-now-paused");
    await ctl.row_action(journal, "run_now");
    expect(summary_of(JOURNAL_ID).status).toBe("paused");
    expect(summary_of(JOURNAL_ID).occurrence_count).toBe(journal.occurrence_count + 1);
    expect(ctl.state.notice).toContain("stays paused");
  });

  it("shows each contract error: a busy run now and a stale revision surface their reason codes", async () => {
    await ctl.refresh();
    await ctl.select(INBOX_ID); // its latest occurrence is waiting → busy
    ids.push("cmd-busy");
    await ctl.row_action(summary_of(INBOX_ID), "run_now");
    expect(ctl.state.error?.code).toBe("automation_busy");
    expect(list_html()).toContain("An occurrence is already running or queued");
    const p = automation_panel_props(ctl, host_handlers)!;
    await expect(p.onRevise({ title: "x" }, 7, { command_id: "cmd-stale" })).rejects.toMatchObject({ status: 409, code: "revision_conflict", field: "expected_revision" });
  });

  it("legacy rows expose only the legacy controls, through the legacy command types", async () => {
    await ctl.refresh();
    const legacy = summary_of(LEGACY_ID);
    const html = list_html();
    const row = html.slice(html.indexOf(`data-automation-id="${LEGACY_ID}"`));
    const li = row.slice(0, row.indexOf("</li>"));
    const actions = [...li.matchAll(/data-action="([a-z_]+)"/g)].map((m) => m[1]);
    expect(actions).toEqual(["legacy_pause", "legacy_run_now", "open_run", "recreate"]);
    await ctl.select(LEGACY_ID);
    expect(automation_panel_props(ctl, host_handlers)).toBeNull();
    expect(detail_html()).toContain("Recreate as automation");
    const before = stub.requests.length;
    await ctl.legacy_action(legacy, "legacy_pause");
    const sent = requests_since(before).filter((r) => r.method === "POST");
    expect(sent).toEqual([
      { method: "POST", path: "/api/gateway/commands", body: { command_id: "cmd-host", run_id: LEGACY_ID, type: "pause", payload: { reason: "Suspended from the Observer's Automations page" }, client_id: "web_pwa" } },
    ]);
    expect(summary_of(LEGACY_ID).status).toBe("paused");
    expect(sent.some((r) => r.path.includes("/automations/"))).toBe(false);
  });

  it("Recreate as automation prefills Automate mode from the legacy run", async () => {
    const run = await gateway.get_run(LEGACY_ID);
    const input = await gateway.get_run_input_data(LEGACY_ID);
    const prefill = legacy_recreate_prefill(run, input);
    const legacyRow = LIST.items.find((s: any) => s.legacy);
    const [, amount, unit] = /^([1-9][0-9]*)([mhd])$/.exec(legacyRow.trigger.config.every)!;
    expect(prefill.choice).toEqual({ kind: "bundle", bundle_id: LEGACY_TARGET.bundle_id, flow_id: LEGACY_TARGET.flow_id });
    expect(prefill.form).toMatchObject({ when: "every", amount, unit, context: legacyRow.context_mode });
    expect(prefill.input_data).toEqual({ prompt: input.input_data.prompt, provider: "lmstudio" }); // no workflow_selection, no _runtime
    expect(legacy_recreate_prefill({ schedule: { ...run.schedule, interval: "250ms" } }, input).notes[0]).toMatch(/250ms/);
    // The gateway's schedule names the target by target_bundle_ref only (observed at abstractgateway 2c8d8b3).
    expect(run.schedule.target_bundle_id).toBeUndefined();
    expect(legacy_recreate_prefill(run, { input_data: input.input_data }).choice).toEqual({ kind: "bundle", bundle_id: LEGACY_TARGET.bundle_id, flow_id: LEGACY_TARGET.flow_id });
  });

  it("answers each wait by its kind (decision D1): tool approval with {approved}, never a text guess", async () => {
    await ctl.refresh();
    await ctl.select(INBOX_ID);
    const waits = OCC.items[0].waits;
    const ask = waits.find((w: any) => w.kind === "ask_user");
    const tool = waits.find((w: any) => w.kind === "tool_approval");
    expect(detail_html()).toContain(tool.details[0].name); // the panel lists what it would approve
    const p = automation_panel_props(ctl, host_handlers)!;
    const before = stub.requests.length;
    await expect(p.onAnswerWait(ask.run_id, ask.wait_key, { approved: true })).rejects.toMatchObject({ message: expect.stringMatching(/ask_user/) });
    await expect(p.onAnswerWait(tool.run_id, tool.wait_key, { response: "yes" })).rejects.toMatchObject({ message: expect.stringMatching(/approved/) });
    expect(requests_since(before)).toEqual([]); // nothing mismatched reached the gateway
    await p.onAnswerWait(tool.run_id, tool.wait_key, { approved: true });
    expect(last_request("POST", "/api/gateway/commands").body).toEqual({
      command_id: "cmd-host",
      run_id: tool.run_id,
      type: "resume",
      payload: { wait_key: tool.wait_key, payload: { approved: true } },
      client_id: "web_pwa",
    });
    expect(wait_answer_payload("event", { payload: { ok: 1 } })).toEqual({ payload: { ok: 1 } });
    expect(() => wait_answer_payload(undefined, { response: "x" })).toThrow(/no known kind/);
  });

  it("tool-approval details in the typed shape reach the board and the run view", () => {
    const wait = { reason: "tool_approval", details: [{ name: "send_email", arguments: { to: "x" }, call_id: "c1" }] };
    expect(extract_tool_calls_from_wait(wait as any).map((c: any) => c.name)).toEqual(["send_email"]);
    expect(extract_tool_calls_from_wait({ reason: "user", details: { tool_calls: [{ name: "fetch_url", arguments: {} }] } } as any).map((c: any) => c.name)).toEqual(["fetch_url"]);
    const card = board_card(normalize_run_summary({ run_id: "r", status: "waiting", waiting: wait }));
    expect(card).toMatchObject({ column: "review", tool_names: ["send_email"] });
  });

  it("Discuss posts {request_id, occurrence_index, prompt} and opens the returned session", async () => {
    await ctl.refresh();
    await ctl.select(INBOX_ID);
    const p = automation_panel_props(ctl, host_handlers)!;
    const r = await p.onDiscuss(6, "Why was nothing urgent?", { request_id: "req-discuss-1" });
    expect(last_request("POST", `/api/gateway/automations/${INBOX_ID}/discuss`).body).toEqual({ request_id: "req-discuss-1", occurrence_index: 6, prompt: "Why was nothing urgent?" });
    expect(r.session_id).toBe("discussion-session:req-discuss-1");
    expect(opened.sessions).toEqual([{ session_id: r.session_id, run_id: r.run_id }]);
  });

  it("onSeen acknowledges the displayed cursor; Run details opens the Observe run view", async () => {
    await ctl.refresh();
    await ctl.select(INBOX_ID);
    const p = automation_panel_props(ctl, host_handlers)!;
    const items = summary_of(INBOX_ID).attention.items;
    await p.onSeen(items[items.length - 1].cursor);
    expect(last_request("POST", `/api/gateway/automations/${INBOX_ID}/seen`).body).toEqual({ attention_cursor: items[items.length - 1].cursor });
    await ctl.refresh();
    expect(summary_of(INBOX_ID).attention.unread).toBe(false);
    p.onOpenRun(OCC.items[1].run_id);
    expect(opened.runs).toEqual([OCC.items[1].run_id]);
  });
});

// --- board / navigator / runtime ----------------------------------------------------

describe("run attribution tags", () => {
  const rows = [
    { run_id: "ctl-1", workflow_id: "abstractframework.automation-controller@1.0.0:controller", status: "waiting", waiting: { reason: "event" }, role: "controller", session_kind: "automation", automation_id: "ctl-1", actor_id: "alice" },
    { run_id: "occ-3", workflow_id: "news-agent@1.0.0:main", status: "completed", parent_run_id: "ctl-1", role: "occurrence", session_kind: "occurrence", automation_id: "ctl-1", occurrence_index: 3 },
    { run_id: "occ-9", workflow_id: "news-agent@1.0.0:main", status: "running", parent_run_id: "ctl-x", role: "occurrence", session_kind: "automation", automation_id: "ctl-x", occurrence_index: 9 },
    { run_id: "disc-1", workflow_id: "news-agent@1.0.0:main", status: "completed", session_kind: "discussion", role: "discussion" },
    { run_id: "legacy-1", workflow_id: "scheduled:legacy-1", status: "waiting", is_scheduled: true, waiting: { reason: "until" } },
    { run_id: "prefix-only", workflow_id: "scheduled:looks-like-one", status: "completed" },
  ].map(normalize_run_summary);

  it("keeps actor_id and the attribution fields on RunSummary", () => {
    expect(rows[0]).toMatchObject({ actor_id: "alice", role: "controller", session_kind: "automation", automation_id: "ctl-1" });
    expect(rows[1].occurrence_index).toBe(3);
  });

  it("tags by role/session_kind; a scheduled: workflow id without attribution is NOT tagged", () => {
    expect(rows.map(run_session_tag)).toEqual(["automation", "occurrence", "occurrence", "discussion", "legacy", null]);
  });

  it("the board carries no controller card and links occurrences to their automation", () => {
    const cols = board_columns(rows, rows);
    const all = [...cols.pending, ...cols.working, ...cols.review, ...cols.done];
    expect(all.map((c) => c.run_id)).not.toContain("ctl-1");
    const occ = all.find((c) => c.run_id === "occ-3")!;
    expect(occ).toMatchObject({ tag: "occurrence", tag_label: "occurrence #3", automation_id: "ctl-1" });
    expect(all.find((c) => c.run_id === "prefix-only")!.tag).toBeNull();
  });

  it("the navigator groups occurrences under their automation (placeholder root when the controller is not loaded)", () => {
    const sections = build_run_tree_sections(rows, { query: "", filter: "all", group_by: "session", workflow_label_by_id: {} });
    const tree = sections.flatMap((s) => s.rows);
    const ctl_row = tree.find((r) => r.run.run_id === "ctl-1")!;
    expect(ctl_row.children.map((c) => c.run_id)).toEqual(["occ-3"]);
    const placeholder = tree.find((r) => r.run.run_id === "ctl-x")!;
    expect(placeholder.run.role).toBe("controller");
    expect(placeholder.children.map((c) => c.run_id)).toEqual(["occ-9"]);
    expect(tree.map((r) => r.run.run_id)).not.toContain("occ-9");
  });

  it("the Runtime page splits Scheduled from subflows / external events", () => {
    const views = build_runtime_activity_views([
      ...rows,
      normalize_run_summary({ run_id: "sub", status: "waiting", waiting: { reason: "subworkflow" } }),
      normalize_run_summary({ run_id: "ext", status: "waiting", waiting: { reason: "event" } }),
    ]);
    const q = Object.fromEntries(views.map((v) => [v.run_id, v.queue]));
    expect(q).toMatchObject({ "ctl-1": "scheduled", "legacy-1": "scheduled", sub: "subflows", ext: "subflows" });
    expect(count_runtime_activity_queues(views)).toMatchObject({ scheduled: 2, subflows: 2 });
  });

  it("the Automations API is used only when the gateway advertises it", () => {
    expect(automations_capability({ capabilities: { contracts: { common: { automations: { available: true } } } } }).available).toBe(true);
    const off = automations_capability({ capabilities: { contracts: { common: {} } } });
    expect(off.available).toBe(false);
    expect(off.reason).toMatch(/does not advertise/);
  });
});

// --- the three operator scenarios -------------------------------------------------------

describe("operator scenarios (walked against the stub gateway)", () => {
  it("1. three news monitors at different intervals, independent: pause, run now while paused, resume without catch-up, edit interval, read as chat", async () => {
    const news: WorkflowChoice = { kind: "bundle", bundle_id: "news-agent", flow_id: "main" };
    const a = await automate({ amount: "8", unit: "h" }, news, { prompt: "AI news digest" }, "req-n1");
    const b = await automate({ amount: "12", unit: "h" }, news, { prompt: "Energy market news" }, "req-n2");
    const c = await automate({ amount: "24", unit: "h", context: "growing" }, news, { prompt: "Space industry news" }, "req-n3");
    await ctl.refresh();
    const html = list_html();
    expect(html).toContain("every 8 hours (UTC)");
    expect(html).toContain("every 12 hours (UTC)");
    expect(html).toContain("every 24 hours (UTC)");
    for (const x of [a, b]) expect(summary_of(x.res.automation_id).context_mode).toBe("independent");
    expect(summary_of(c.res.automation_id).context_mode).toBe("growing");

    const id = a.res.automation_id;
    ids.push("cmd-s1-pause", "cmd-s1-run", "cmd-s1-resume");
    await ctl.row_action(summary_of(id), "pause");
    expect(summary_of(id).status).toBe("paused");
    await ctl.row_action(summary_of(id), "run_now");
    expect(summary_of(id)).toMatchObject({ status: "paused", occurrence_count: 1 });
    await ctl.row_action(summary_of(id), "resume");
    expect(summary_of(id)).toMatchObject({ status: "active", occurrence_count: 1 }); // no catch-up fire

    await ctl.select(id);
    const before_next = summary_of(id).next_fire_at;
    const p = automation_panel_props(ctl, host_handlers)!;
    await p.onRevise({ trigger: { source_id: "schedule", source_version: 1, config: { ...summary_of(id).trigger.config, every: "6h" } } }, summary_of(id).revision, { command_id: "cmd-s1-rev" });
    expect(summary_of(id).trigger.config.every).toBe("6h");
    expect(summary_of(id).next_fire_at).not.toBe(before_next);
    expect(list_html()).toContain("every 6 hours (UTC)");

    stub.fire(id, { answer: "Two model releases today." });
    await ctl.refresh();
    const detail = detail_html();
    expect(detail).toContain("manual: run now (cmd-s1-run)");
    expect(detail).toContain("Two model releases today.");
    expect(ctl.state.detail!.occurrences).toHaveLength(2);
  });

  it("2. email triage every 30 minutes, growing, with a human wait answered from the panel; quiet success stays quiet", async () => {
    const mail: WorkflowChoice = { kind: "bundle", bundle_id: "mail-agent", flow_id: "triage" };
    const { res } = await automate({ amount: "30", unit: "m", context: "growing" }, mail, { prompt: "Triage my inbox" }, "req-mail");
    const id = res.automation_id;
    stub.fire(id, { answer: "Nothing needs a reply." });
    await ctl.refresh();
    expect(summary_of(id).attention).toMatchObject({ unread: false, pending_waits: 0 });
    stub.fire(id, { wait: { wait_key: "ask_user:reply-landlord", prompt: "Reply to the landlord now?", choices: ["Yes", "Later"] } });
    await ctl.refresh();
    expect(summary_of(id).attention.pending_waits).toBe(1);
    expect(list_html()).toContain("1 waiting for you");

    await ctl.select(id);
    expect(detail_html()).toContain("Reply to the landlord now?");
    expect(detail_html()).toContain("Nothing needs a reply."); // quiet success visible in the transcript
    const waiting = ctl.state.detail!.occurrences.find((o) => o.waits.length)!;
    const p = automation_panel_props(ctl, host_handlers)!;
    await p.onAnswerWait(waiting.run_id, "ask_user:reply-landlord", { response: "Yes" });
    expect(last_request("POST", "/api/gateway/commands").body).toEqual({
      command_id: "cmd-host",
      run_id: waiting.run_id,
      type: "resume",
      payload: { wait_key: "ask_user:reply-landlord", payload: { response: "Yes" } },
      client_id: "web_pwa",
    });
    expect(summary_of(id).attention.pending_waits).toBe(0);
    expect(ctl.state.detail!.occurrences.find((o) => o.run_id === waiting.run_id)!.status).toBe("completed");
  });

  it("3. weekly journal monitor (every 7 days, growing): discuss twice without touching the transcript, archive keeps history", async () => {
    const journal: WorkflowChoice = { kind: "bundle", bundle_id: "journal-watch", flow_id: "main" };
    const preset = SCHEDULE_PRESETS.find((x) => x.label === "every 7 days")!.when as { amount: number; unit: "d" };
    const { res } = await automate({ amount: String(preset.amount), unit: preset.unit, context: "growing" }, journal, { prompt: "New sparse-attention papers" }, "req-journal");
    const id = res.automation_id;
    expect(res.summary.trigger.config.every).toBe("7d");
    stub.fire(id, { answer: "Three new papers.", notify: { title: "3 new papers", body: "Sparse attention" } });
    await ctl.refresh();
    expect(summary_of(id).attention.unread).toBe(true);
    await ctl.select(id);
    const p = automation_panel_props(ctl, host_handlers)!;
    await p.onDiscuss(1, "Summarise the second paper", { request_id: "req-d1" });
    await p.onDiscuss(1, "Compare it with last week's", { request_id: "req-d2" });
    expect(opened.sessions.map((s) => s.session_id)).toEqual(["discussion-session:req-d1", "discussion-session:req-d2"]);
    expect(stub.discussions(id)).toHaveLength(2);
    await ctl.refresh();
    expect(ctl.state.detail!.occurrences).toHaveLength(1);
    expect(detail_html()).not.toContain("Summarise the second paper");

    ids.push("cmd-archive");
    await ctl.row_action(summary_of(id), "archive");
    expect(summary_of(id).status).toBe("archived");
    expect(ctl.state.detail!.occurrences).toHaveLength(1);
    expect(detail_html()).toContain("Three new papers.");
    const c = automation_row_controls(summary_of(id), false);
    expect([c.pause.enabled, c.run_now.enabled, c.archive.enabled]).toEqual([false, false, false]);
  });
});
