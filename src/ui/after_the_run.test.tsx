// After the run on a run's card (framework ADR-0041 "No hidden effects after a flow"): under each
// finished run's answer, what arrived, the note, the alert it raised (or why nothing rang) and each
// delivery with its channel, route and device, read from GET /runs/{id}/after. A spinner until the
// read answered; the error and Retry only after every try failed; nothing without a reader.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationsClient } from "@abstractframework/ui-kit";

import { AutomationsController, type AutomationsHost } from "./automations";
import { AutomationDetailView, type AutomationsHandlers, type PanelHostHandlers } from "./automations_page";
import { AfterTheRunView, delivery_sentence, quiet_sentence, read_with_tries, should_read_again, type RunAfter } from "./after_the_run";
import { GatewayClient } from "../lib/gateway_client";

const GMAIL: RunAfter = {
  run_id: "r1",
  trigger: { automation_title: "Gmail watch", text: "When mail arrives in me@example.org", arrived: { count: 4, noun: "new emails", line: "“O” from codex@athena.ovh and 3 more" } },
  run: { status: "completed", started: "2026-10-26T00:16:00Z", ended: "2026-10-26T00:16:09Z", note: "4 mails judged; 4 suspicious." },
  attention: { record_key: "k15", kind: "notify", title: "Suspicious credential emails received", raised_at: "2026-10-26T00:16:23Z", from: "flow_end" },
  deliveries: [
    { record_key: "k15", channel: "console", via: "stream", state: "sent", time: "2026-10-26T00:16:23Z" },
    { record_key: "k15", channel: "watch", via: "push", device: "506b", device_name: "Apple Watch", state: "sent", time: "2026-10-26T00:16:26Z" },
    { record_key: "k15", channel: "phone", via: "stream", device: "d81f", device_name: "iPhone", state: "sent", time: "2026-10-26T00:16:23Z" },
  ],
};

const render = (state: Parameters<typeof AfterTheRunView>[0]["state"]) => renderToStaticMarkup(<AfterTheRunView state={state} />);

describe("After the run", () => {
  it("what arrived, the note, the alert and its source, each delivery with channel, route and device", () => {
    const html = render({ status: "ready", after: GMAIL });
    expect(html).toContain('data-section="after-the-run"');
    expect(html).toContain("4 new emails: “O” from codex@athena.ovh and 3 more");
    expect(html).toContain("4 mails judged; 4 suspicious.");
    expect(html).toContain("“Suspicious credential emails received”");
    expect(html).toContain("On Flow End’s notify (older flows)");
    expect(html).toContain("Console · listed · sent");
    expect(html).toContain("Watch (Apple Watch) · push notification · sent");
    expect(html).toContain("Phone (iPhone) · shown by the app · sent");
    expect(html).not.toContain("Nothing to notify");
  });

  it("nothing rang: why, in words; an approval on a sub-run: what it is and whether it is open", () => {
    expect(render({ status: "ready", after: { ...GMAIL, attention: null, alerts: [], deliveries: [], quiet_reason: "empty title" } })).toContain("Nothing to notify: the title was empty.");
    expect(quiet_sentence("no notify")).toBe("Nothing to notify: this flow has no Notify me step.");
    const wait = render({
      status: "ready",
      after: { ...GMAIL, trigger: null, attention: { record_key: "f0", kind: "approval", from: "wait", open: true, run_id: "sub" }, deliveries: [{ record_key: "f0", channel: "email", via: "outbox", state: "failed", reason: "SMTP refused" }] },
    });
    expect(wait).toContain("An approval for you");
    expect(wait).toContain("waiting for your answer");
    expect(wait).toContain("Email · email · not delivered: SMTP refused");
    expect(delivery_sentence({ channel: "tray", via: "stream", state: "sent" })).toBe("Tray · shown by the app · sent");
  });

  it("a spinner until the read answered; the reason and Retry only once every try failed (ADR-0039)", async () => {
    const loading = render({ status: "loading" });
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Reading what happened after the run");
    expect(loading).not.toContain("Nothing to notify");
    const failed = render({ status: "failed", error: "HTTP 503", on_retry: () => {} });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("HTTP 503");
    expect(failed).toContain(">Retry</button>");
    let n = 0;
    await expect(read_with_tries(async () => { n += 1; if (n < 3) throw new Error("down"); return "ok"; }, [0, 0])).resolves.toBe("ok");
    n = 0;
    await expect(read_with_tries(async () => { n += 1; throw new Error(`down ${n}`); }, [0, 0])).rejects.toThrow("down 3");
  });

  it("reads again while deliveries are still being recorded, a bounded number of times", () => {
    expect(should_read_again({ ...GMAIL, attention: null, deliveries: [], quiet_reason: "not recorded yet" }, 1)).toBe(true);
    expect(should_read_again({ ...GMAIL, deliveries: [] }, 1)).toBe(true);
    expect(should_read_again(GMAIL, 1)).toBe(false);
    expect(should_read_again({ ...GMAIL, deliveries: [] }, 9)).toBe(false);
  });

  it("the client reads GET /api/gateway/runs/{id}/after", async () => {
    const calls: string[] = [];
    const fetch_spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      calls.push(String(url));
      return new Response(JSON.stringify(GMAIL), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      const client = new GatewayClient({ base_url: "http://gw.test", auth_token: "t" } as any);
      expect((await client.get_run_after("r 1")).run_id).toBe("r1");
      expect(calls[0]).toBe("http://gw.test/api/gateway/runs/r%201/after");
    } finally {
      fetch_spy.mockRestore();
    }
  });
});

describe("the run card carries it", () => {
  function setup() {
    const s = {
      automation_id: "a1", title: "Gmail watch", status: "active",
      trigger: { binding_id: "b1", source_id: "email.received", source_version: 1, config: {} },
      context_mode: "growing", time_zone: "Europe/Paris", schedule_text: "", schedule_rule_text: "", occurrence_count: 1,
      attention: { unread: false, unseen_count: 0, pending_waits: 0, items: [], waits: [], cursor: null },
      capabilities: ["pause", "run_now", "revise", "archive", "discuss"], revision: 1, last_occurrence: null, current_occurrence: null,
      workspace_root: "/data/workspaces/session-automation-a1",
    };
    const row = { run_id: "r1", index: 1, attempts: 1, fired_at: "2026-10-26T00:15:59Z", finished_at: "2026-10-26T00:16:09Z", status: "completed", trigger: { source_id: "email.received", summary: "email.received@1" }, user_turn: "A new mail arrived.", answer: "Four emails look like keys.", notify: null, artifacts: [], waits: [], ledger_url: "/api/gateway/runs/r1/ledger" };
    const definition = { schema_version: 2, revision: 1, title: s.title, controller: { bundle_ref: "c@1", flow_id: "controller" }, target: { workflow_id: "j@1:8ee07990", input_data: {} }, trigger: s.trigger, context: { mode: "growing", growing: {} }, policy: { serial: true, misfire: "coalesce", failure: "continue", retry: { max_attempts: 3, backoff: { initial: "30s", factor: 2, max: "10m" } }, tool_approval: "auto" }, session_id: "s", workspace_root: s.workspace_root, created_at: "2026-10-25T13:00:00Z", archived_at: null };
    const client = {
      listAutomations: vi.fn(async () => ({ items: [s], next_cursor: null })),
      getAutomation: vi.fn(async () => ({ definition, active_revision: 1, summary: s })),
      listOccurrences: vi.fn(async () => ({ items: [row], next_cursor: null })),
      listTriggerSources: vi.fn(async () => ({ items: [] })),
      getMyEmail: vi.fn(async () => ({ configured: false, effective_enabled: false })),
      listTriggerConnections: vi.fn(async () => ({ connections: [] })),
      listMailboxes: vi.fn(async () => ({ items: [] })),
    } as unknown as AutomationsClient;
    const host: AutomationsHost = { answer_wait: vi.fn(), legacy_command: vi.fn(), now_iso: () => "2026-10-26T01:00:00Z" };
    return new AutomationsController(client, host, []);
  }
  const h = { on_select() {}, on_row_action() {}, on_legacy_action() {}, on_confirm_archive() {}, on_cancel_archive() {}, on_status_filter() {}, on_refresh() {}, on_new() {}, on_show_archived() {} } as AutomationsHandlers;

  it("each finished run's answer is followed by After the run (spinner first) when the host reads it; none without a reader", async () => {
    const ctl = setup();
    await ctl.refresh();
    await ctl.select("a1");
    const read = vi.fn(async () => GMAIL);
    const with_reader: PanelHostHandlers = { on_open_run: () => {}, on_open_session: () => {}, read_run_after: read };
    const html = renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={with_reader} h={h} />);
    expect(html).toContain("Four emails look like keys.");
    expect(html).toContain('data-section="after-the-run"');
    expect(html.indexOf("Four emails look like keys.")).toBeLessThan(html.indexOf('data-section="after-the-run"'));
    expect(html).toContain("Reading what happened after the run");
    const without: PanelHostHandlers = { on_open_run: () => {}, on_open_session: () => {} };
    expect(renderToStaticMarkup(<AutomationDetailView ctl={ctl} host={without} h={h} />)).not.toContain("after-the-run");
  });
});
