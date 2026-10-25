// New automation uses the flow's own settings (UX review 2026-10-25, defect #1): a flow with
// published `automation_defaults` preselects "Use the flow's trigger: When Release notes has a
// new item", prefills Context and the inputs, never shows the raw `event` input, and still offers
// "Other trigger…" (feeds and webhooks by name, mailboxes by address, never ids).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseWorkflowListing, type Mailbox, type TriggerConnection } from "@abstractframework/ui-kit";

import { AutomateTitleLimits, AutomateWhenContext, WHEN_TEXT, defaults_trigger_words, local_to_utc_input, utc_to_local_input } from "./automate_form";
import {
  DEFAULT_AUTOMATE_FORM,
  TRIGGER_OWNED_INPUTS,
  arrival_choices,
  connection_problem,
  arrival_patch,
  automate_prefill,
  automate_preview_trigger,
  build_automate_request,
  defaults_trigger_spec,
  flow_automation_defaults,
  flow_entry_detail_words,
  type AutomateForm,
  type FlowAutomationDefaults,
} from "./automations";

const connections: TriggerConnection[] = [
  { connection_id: "c_feed", source_id: "feed.item", source_version: 1, label: "Release notes", status: "active" },
  { connection_id: "c_hook", source_id: "webhook.received", source_version: 1, label: "CI hook", status: "active" },
  { connection_id: "c_off", source_id: "feed.item", source_version: 1, label: "Old feed", status: "disabled" },
];
const mailboxes: Mailbox[] = [
  { account_id: "default", primary: true, address: "me@example.test", configured: true, can_read: true },
  { account_id: "work", primary: false, address: "work@example.test", configured: true, can_read: true },
  { account_id: "sendonly", primary: false, address: "out@example.test", configured: true, can_read: false },
];
const FEED_DEFAULTS: FlowAutomationDefaults = {
  schema_version: 1,
  title: "Release digest",
  trigger: { source_id: "feed.item", source_version: 1, config: {}, connection_id: "c_feed" },
  context: { mode: "growing", growing: { max_tokens: 100_000 } },
  input_data: { prompt: "Summarise what changed in this release in three bullets.", provider: "lmstudio" },
};
const BUNDLE = { bundle_id: "Release-digest", bundle_ref: "Release-digest@0.0.0", automation_defaults: { "4dee0431": FEED_DEFAULTS } };
const choice = { kind: "bundle" as const, bundle_id: "Release-digest", flow_id: "4dee0431" };
const build = (form: AutomateForm, input_data: Record<string, any>, extra: Record<string, any> = {}) =>
  build_automate_request(form, { choice, bundle_ref_for: () => "Release-digest@0.0.0", input_data, request_id: "rq", connections, mailboxes, ...extra });

describe("New automation: the flow's own settings", () => {
  it("reads the defaults of the chosen flow only", () => {
    expect(flow_automation_defaults(BUNDLE, "Release-digest", "4dee0431")).toEqual(FEED_DEFAULTS);
    expect(flow_automation_defaults(BUNDLE, "Release-digest", "other")).toBeNull();
    expect(flow_automation_defaults(BUNDLE, "Another-bundle", "4dee0431")).toBeNull();
    expect(flow_automation_defaults(null, "Release-digest", "4dee0431")).toBeNull();
    expect(flow_automation_defaults({ bundle_id: "Release-digest", automation_defaults: { "4dee0431": { trigger: {} } } }, "Release-digest", "4dee0431")).toBeNull();
  });

  it("prefills the trigger choice, Context, its budget, the title and the inputs (what was typed is kept)", () => {
    const { form, input_data } = automate_prefill(DEFAULT_AUTOMATE_FORM, { provider: "ollama", model: "", prompt: "" }, FEED_DEFAULTS);
    expect(form.when).toBe("defaults");
    expect(form.context).toBe("growing");
    expect(form.growing_max_tokens).toBe("100000");
    expect(form.title).toBe("Release digest");
    expect(input_data).toEqual({ prompt: FEED_DEFAULTS.input_data!.prompt, provider: "ollama" });
    // A typed title wins.
    expect(automate_prefill({ ...DEFAULT_AUTOMATE_FORM, title: "Mine" }, {}, FEED_DEFAULTS).form.title).toBe("Mine");
  });

  it("creates with the flow's trigger (its connection folded into the config) and never sends the event input", () => {
    const { form, input_data } = automate_prefill(DEFAULT_AUTOMATE_FORM, {}, FEED_DEFAULTS);
    const r = build(form, { ...input_data, event: { stale: true } }, { defaults: FEED_DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.trigger).toEqual({ source_id: "feed.item", source_version: 1, config: { connection_id: "c_feed" } });
    expect(r.body.title).toBe("Release digest");
    expect(r.body.context).toEqual({ mode: "growing", growing: { max_tokens: 100_000 } });
    expect(r.body.target).toEqual({ bundle_ref: "Release-digest@0.0.0", flow_id: "4dee0431", input_data: { prompt: FEED_DEFAULTS.input_data!.prompt, provider: "lmstudio" } });
    expect(TRIGGER_OWNED_INPUTS).toContain("event");
    expect(defaults_trigger_spec(FEED_DEFAULTS)).toEqual(r.body.trigger);
    // The flow's trigger without defaults (another flow picked) is refused with a sentence.
    const refused = build(form, input_data, { defaults: null });
    expect(refused.ok).toBe(false);
  });

  it("previews a schedule default through the gateway (its words in the account's zone); other defaults have no clock", () => {
    const daily: FlowAutomationDefaults = { schema_version: 1, trigger: { source_id: "schedule", source_version: 2, config: { kind: "daily", at: "08:00" } } };
    expect(automate_preview_trigger({ ...DEFAULT_AUTOMATE_FORM, when: "defaults" }, daily)).toEqual({ source_id: "schedule", source_version: 2, config: { kind: "daily", at: "08:00" } });
    expect(automate_preview_trigger({ ...DEFAULT_AUTOMATE_FORM, when: "defaults" }, FEED_DEFAULTS)).toBeNull();
    expect(automate_preview_trigger({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "c_feed" })).toBeNull();
    const served = { phase: "ok" as const, description: { trigger: daily.trigger as any, time_zone: "Europe/Paris", schedule_rule_text: "Every day at 08:00 (Europe/Paris)", schedule_text: "", next_run_at: null, next_run_local: null, first_run_sentence: "Runs every day at 08:00 (Europe/Paris), first run Mon 26 Oct 08:00." } };
    expect(defaults_trigger_words(daily, {}, served)).toBe("Every day at 08:00 (Europe/Paris)");
    expect(defaults_trigger_words(daily, {}, { phase: "loading" })).toBe("On a schedule");
  });

  const render = (form: AutomateForm, defaults: FlowAutomationDefaults | null, extra: Record<string, any> = {}) =>
    renderToStaticMarkup(<AutomateWhenContext served={{ phase: "idle" }} form={form} on_change={() => {}} defaults={defaults} connections={connections} mailboxes={mailboxes} {...extra} />).replace(/&#x27;/g, "'");

  it("shows 'Use the flow's trigger: When Release notes has a new item' preselected, and 'Other trigger…'", () => {
    const html = render({ ...DEFAULT_AUTOMATE_FORM, when: "defaults" }, FEED_DEFAULTS);
    expect(html).toMatch(/checked="" value="defaults"\/> Use the flow's trigger: <strong data-field="flow-trigger">When Release notes has a new item<\/strong>/);
    expect(html).toContain(`value="other"/> ${WHEN_TEXT.other}`);
    // The schedule kinds hide behind "Other trigger…"; no raw ids anywhere.
    expect(html).not.toContain('name="automate_when"');
    expect(html).not.toMatch(/feed\.item|c_feed|@1/);
    expect(html).toContain(WHEN_TEXT.event_help);
    const other = render({ ...DEFAULT_AUTOMATE_FORM, when: "every" }, FEED_DEFAULTS);
    expect(other).toContain('checked="" value="other"');
    expect(other).toContain('value="arrives"/> When something arrives');
  });

  it("without the vocabulary the flow's trigger still reads in words", () => {
    const html = render({ ...DEFAULT_AUTOMATE_FORM, when: "defaults" }, FEED_DEFAULTS, { connections: null, mailboxes: null });
    expect(html).toContain(">When a feed has a new item</strong>");
  });

  it("offers feeds and webhooks by name and mailboxes by address under 'When something arrives' (never ids, never disabled ones)", () => {
    const choices = arrival_choices(mailboxes, connections);
    expect(choices.map((c) => c.label)).toEqual(["Mail arrives in me@example.test", "Mail arrives in work@example.test", "Release notes has a new item", "CI hook is called"]);
    expect(choices.map((c) => c.value)).toEqual(["mail:default", "mail:work", "conn:c_feed", "conn:c_hook"]);
    expect(arrival_patch("conn:c_hook")).toEqual({ when: "connection", connection_id: "c_hook" });
    expect(arrival_patch("mail:work")).toEqual({ when: "email", email_account: "work" });
    const html = render({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "c_hook" }, null);
    expect(html).toMatch(/<option value="conn:c_hook" data-group="webhook" selected="">CI hook is called<\/option>/);
    expect(html).not.toContain("Old feed");
  });

  it("builds a feed, a webhook, a named mailbox and a by-hand trigger", () => {
    const feed = build({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "c_feed" }, { prompt: "Digest" });
    expect(feed.ok && feed.body.trigger).toEqual({ source_id: "feed.item", source_version: 1, config: { connection_id: "c_feed" } });
    const hook = build({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "c_hook" }, { prompt: "Digest" });
    expect(hook.ok && hook.body.trigger).toEqual({ source_id: "webhook.received", source_version: 1, config: { connection_id: "c_hook" } });
    const work = build({ ...DEFAULT_AUTOMATE_FORM, when: "email", email_account: "work" }, { prompt: "Triage" });
    expect(work.ok && work.body.trigger.source_id).toBe("email.received");
    expect(work.ok && (work.body.trigger.config as any).account).toBe("work");
    const hand = build({ ...DEFAULT_AUTOMATE_FORM, when: "manual" }, { prompt: "Digest" });
    expect(hand.ok && hand.body.trigger).toEqual({ source_id: "manual", source_version: 1, config: {} });
    // Refusals: no connection chosen, a mailbox that cannot be read.
    expect(build({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "" }, { prompt: "x" }).ok).toBe(false);
    expect(build({ ...DEFAULT_AUTOMATE_FORM, when: "email", email_account: "sendonly" }, { prompt: "x" }).ok).toBe(false);
  });

  it("lists a flow made to run by itself (no interface) by its trigger, and preselects that trigger", () => {
    // GET /bundles (any interface) as the gateway serves it: the triggered flow declares no interface
    // (AbstractFlow 77b0c1d) and carries its automation defaults on the row.
    const listing = {
      items: [
        { bundle_id: "Python-digest", bundle_version: "0.0.0", owner: { kind: "user" }, shipped: false, automation_defaults: { "92abf314": FEED_DEFAULTS }, entrypoints: [{ flow_id: "92abf314", name: "Python digest", interfaces: [] }] },
        { bundle_id: "scratch", bundle_version: "0.0.1", owner: { kind: "user" }, shipped: false, automation_defaults: {}, entrypoints: [{ flow_id: "dev", name: "Scratch", interfaces: [] }] },
      ],
    };
    const entries = parseWorkflowListing(listing, null).entries;
    expect(entries.map((e) => e.name)).toEqual(["Python digest"]);
    expect(flow_entry_detail_words(entries[0], { connections })).toBe("When Release notes has a new item · @0.0.0");
    expect(flow_entry_detail_words(entries[0], {})).toBe("When a feed has a new item · @0.0.0");
    expect(flow_entry_detail_words({ interfaces: ["abstractcode.agent.v1"], bundleVersion: "1" }, { connections })).toBeNull();
    // The gateway's `triggerable` mark without the trigger on the row (AbstractGateway 1613d05c).
    expect(flow_entry_detail_words({ interfaces: [], triggerable: true, bundleVersion: "0.0.0" }, {})).toBe("Runs by itself · @0.0.0");
    const marked = parseWorkflowListing({ items: [{ ...listing.items[1], entrypoints: [{ flow_id: "dev", name: "Marked", interfaces: [], triggerable: true }] }] }, null).entries;
    expect(marked.map((e) => e.name)).toEqual(["Marked"]);
    // Picking it reads the same defaults from /bundles/{id}: the trigger is preselected.
    const d = flow_automation_defaults({ bundle_id: "Python-digest", automation_defaults: listing.items[0].automation_defaults }, "Python-digest", "92abf314");
    expect(automate_prefill(DEFAULT_AUTOMATE_FORM, {}, d!).form.when).toBe("defaults");
  });

  it("no developer words and no premature sentence in the form; a broken feed is flagged (re-review #16)", () => {
    const status = { configured: true, enabled: true, admin_enabled: true, effective_enabled: true };
    const mail = render({ ...DEFAULT_AUTOMATE_FORM, when: "email", email_account: "default" }, null, { email_status: status });
    expect(mail).not.toContain("Incomplete email trigger");
    const every = render(DEFAULT_AUTOMATE_FORM, null, { email_status: status });
    const limits = renderToStaticMarkup(<AutomateTitleLimits form={DEFAULT_AUTOMATE_FORM} on_change={() => {}} />);
    for (const html of [mail, every, limits]) expect(html).not.toMatch(/fetch_url|browser_probe|\(UTC; empty = now\)|Stop at \(UTC\)|Use Context input|Workflow bundles/);
    // A feed whose last read failed: flagged in the list, and said when chosen.
    const broken = [{ ...connections[0], last_error: { code: "http_404", cause: "The feed answered HTTP 404.", fix: "Check the feed address." } }];
    expect(connection_problem(broken[0])).toBe("not working: The feed answered HTTP 404. Check the feed address.");
    expect(connection_problem(connections[0])).toBe("");
    expect(arrival_choices([], broken)[0].label).toBe("Release notes has a new item — not working");
    const chosen = render({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "c_feed" }, null, { connections: broken });
    expect(chosen).toContain('data-note="arrival-problem"');
    expect(chosen).toContain("The feed answered HTTP 404.");
    expect(render({ ...DEFAULT_AUTOMATE_FORM, when: "connection", connection_id: "c_feed" }, null)).not.toContain("arrival-problem");
  });

  it("the limits are typed in this browser's clock and kept as the UTC wall time the kit reads", () => {
    const local = "2026-11-02T09:30";
    const utc = local_to_utc_input(local);
    expect(utc).toBe(new Date(local).toISOString().slice(0, 16));
    expect(utc_to_local_input(utc)).toBe(local);
    expect([local_to_utc_input(""), utc_to_local_input("")]).toEqual(["", ""]);
    expect(local_to_utc_input("garbage")).toBe("garbage");
  });
});
