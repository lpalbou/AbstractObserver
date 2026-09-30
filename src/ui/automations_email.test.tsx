// Email automations in the Observer (framework backlog 0992 WP6): Launch →
// Automate offers "When an email arrives", "Email me the result" and allowed
// recipients through the kit's email fields, only with a usable account
// (GET /me/email); the Automations page hands the status to the kit panel's
// Edit form. Structure only; example.test addresses only.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationsClient, MyEmailStatus } from "@abstractframework/ui-kit";

import { AutomateWhenContext } from "./automate_form";
import {
  AutomationsController,
  DEFAULT_AUTOMATE_FORM,
  automate_preview,
  build_automate_request,
  my_email_console_url,
  type AutomateForm,
} from "./automations";
import { automation_panel_props } from "./automations_page";

const USABLE: MyEmailStatus = { configured: true, enabled: true, admin_enabled: true, effective_enabled: true };
const NOT_SET_UP: MyEmailStatus = { configured: false, effective_enabled: false };
const choice = { kind: "default" as const, interface: "abstractcode.agent.v1" };
const build = (form: AutomateForm, email_usable: boolean) =>
  build_automate_request(form, { choice, bundle_ref_for: () => "", input_data: { prompt: "Summarise new invoices" }, request_id: "rq", email_usable });

describe("Launch → Automate: email", () => {
  it("builds an email.received@1 body with filters, notify and allowed recipients", () => {
    const form: AutomateForm = {
      ...DEFAULT_AUTOMATE_FORM,
      when: "email",
      email: { ...DEFAULT_AUTOMATE_FORM.email, fromDomainIn: "example.test", subjectContains: "invoice" },
      notify_email: true,
      email_recipients: { mode: "list", addresses: "boss@example.test" },
    };
    const r = build(form, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.trigger).toEqual({ source_id: "email.received", source_version: 1, config: { uses_model: true, every: "1h", max_batch: 100, filter: { from_domain_in: ["example.test"], subject_contains: "invoice" } } });
    expect(r.body.notify).toEqual({ channels: ["console", "email"] });
    expect(r.body.policy).toEqual({ tool_approval: "auto", email_allowed_recipients: ["self", "boss@example.test"] });
  });

  it("refuses the email trigger without a usable account, and never sends email options then", () => {
    const r = build({ ...DEFAULT_AUTOMATE_FORM, when: "email" }, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("Email isn't set up — open My email");
    const s = build({ ...DEFAULT_AUTOMATE_FORM, notify_email: true, email_recipients: { mode: "list", addresses: "boss@example.test" } }, false);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.body.trigger.source_id).toBe("schedule");
    expect("notify" in s.body).toBe(false);
    expect(s.body.policy).toEqual({ tool_approval: "auto" });
  });

  it("previews the email trigger", () => {
    expect(automate_preview({ ...DEFAULT_AUTOMATE_FORM, when: "email" }, true)).toBe("Runs when an email arrives · checked every hour · up to 100 per run.");
  });

  const render = (status: MyEmailStatus | null, form: AutomateForm = DEFAULT_AUTOMATE_FORM) =>
    renderToStaticMarkup(<AutomateWhenContext form={form} on_change={() => {}} email_status={status} on_open_my_email={() => {}} />);

  it("disables the email options and says why without a usable account", () => {
    for (const status of [null, NOT_SET_UP]) {
      const html = render(status);
      expect(html).toMatch(/disabled="" value="email"\/> When an email arrives/);
      expect(html).toContain("Email isn&#x27;t set up — ");
      expect(html).toContain('data-action="open-my-email"');
      expect(html).toMatch(/<input type="checkbox" name="notify_email" disabled=""\/>/);
    }
  });

  it("offers them with a usable account, and shows the trigger fields when chosen", () => {
    const html = render(USABLE);
    expect(html).toMatch(/<input type="radio" name="automate_when" value="email"\/> When an email arrives/);
    expect(html).not.toContain('data-email-setup="missing"');
    const chosen = render(USABLE, { ...DEFAULT_AUTOMATE_FORM, when: "email" });
    expect(chosen).toContain('name="email_from_in"');
    expect(chosen).toContain('data-email-rule="interval"');
    expect(chosen).toContain('data-email-rule="untrusted"');
    expect(chosen).not.toContain('data-preset="every 5 minutes"');
  });

  it("opens My email in the gateway console's Users tab", () => {
    expect(my_email_console_url("http://127.0.0.1:18850")).toBe("http://127.0.0.1:18850/console#users");
    expect(my_email_console_url("https://gw.example.test/prefix/")).toBe("https://gw.example.test/prefix/console#users");
    expect(my_email_console_url("")).toBeNull();
    expect(my_email_console_url("javascript:alert(1)")).toBeNull();
  });
});

describe("the Automations page: email status", () => {
  const client = (getMyEmail: AutomationsClient["getMyEmail"]) =>
    ({ listAutomations: vi.fn(async () => ({ items: [], next_cursor: null })), getMyEmail } as unknown as AutomationsClient);
  const host = { answer_wait: vi.fn(), legacy_command: vi.fn(), now_iso: () => "2026-09-30T00:00:00Z" };

  it("reads GET /me/email with the list; an unreadable answer counts as not set up", async () => {
    const ctl = new AutomationsController(client(vi.fn(async () => USABLE)), host, []);
    await ctl.refresh();
    await Promise.resolve();
    expect(ctl.state.email_status?.effective_enabled).toBe(true);
    const bad = new AutomationsController(client(vi.fn(async () => Promise.reject(new Error("403")))), host, []);
    await bad.refresh();
    await Promise.resolve();
    expect(bad.state.email_status).toBeNull();
    expect(bad.state.list_error).toBeNull();
  });

  it("hands the status and My email to the panel's Edit form", async () => {
    const ctl = new AutomationsController(client(vi.fn(async () => USABLE)), host, []);
    await ctl.refresh();
    await Promise.resolve();
    const summary = { automation_id: "a1", title: "t", status: "active", trigger: { binding_id: "b", source_id: "manual", source_version: 1, config: {} }, context_mode: "independent", occurrence_count: 0, attention: { pending_waits: 0, unread: false, unseen_count: 0, cursor: "", items: [], waits: [] }, legacy: false, revision: 1, updated_at: "t", capabilities: [], session_kind: "automation" } as any;
    ctl.state = { ...ctl.state, detail: { automation_id: "a1", summary, definition: null, occurrences: [], next_cursor: null, error: null } };
    const open = vi.fn();
    const p = automation_panel_props(ctl, { on_open_run: vi.fn(), on_open_session: vi.fn(), on_open_my_email: open })!;
    expect(p.emailStatus?.effective_enabled).toBe(true);
    p.onOpenMyEmail?.();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
