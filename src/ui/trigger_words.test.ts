// Triggers in words everywhere in the Observer (UX review 2026-10-25, defect #2): the Automations
// list, the Board's brief and state line read "When Release notes has a new item", never
// "feed.item@1"; the real email source id is `email.received` (the old check read `email_received`).
import { afterEach, describe, expect, it } from "vitest";
import type { AutomationSummary } from "@abstractframework/ui-kit";

import { automation_row_view } from "./automations";
import { fold_automation_brief, trigger_words } from "./state_line";
import { set_trigger_vocab, trigger_vocab } from "./trigger_vocab";

const connections = [{ connection_id: "c_feed", source_id: "feed.item", source_version: 1, label: "Release notes" }];
const mailboxes = [{ account_id: "default", primary: true, address: "me@example.test" }];

afterEach(() => set_trigger_vocab({ connections: null, mailboxes: null }));

const NOW = Date.parse("2026-10-25T14:00:00Z");
const summary = (trigger: any, extra: Partial<AutomationSummary> = {}): AutomationSummary =>
  ({
    automation_id: "a1",
    title: "Release digest",
    status: "active",
    trigger: { binding_id: "b", ...trigger },
    context_mode: "growing",
    time_zone: "Europe/Paris",
    schedule_text: "feed.item@1",
    schedule_rule_text: "feed.item@1",
    occurrence_count: 1,
    attention: { unread: false, unseen_count: 0, pending_waits: 0, items: [], waits: [], cursor: null },
    capabilities: [],
    revision: 1,
    last_occurrence: { index: 1, run_id: "r1", status: "completed", attempts: 1, fired_at: "2026-10-25T13:13:22Z", finished_at: "2026-10-25T13:13:40Z", excerpt: "Done." },
    current_occurrence: null,
    ...extra,
  }) as any;

const FEED = { source_id: "feed.item", source_version: 1, config: { connection_id: "c_feed" } };

describe("triggers in words", () => {
  it("the list row: the feed by name, 'runs when something new arrives', the last run's time", () => {
    const v = automation_row_view(summary(FEED), NOW, { connections, mailboxes });
    expect(v.cadence).toBe("When Release notes has a new item");
    expect(v.listening).toBe(true);
    expect(v.next_run).toBe("runs when something new arrives");
    expect(v.last_status).toBe("last: today 14:13 · #1 completed");
    // Without the vocabulary: generic words, still no id.
    expect(automation_row_view(summary(FEED), NOW).cadence).toBe("When a feed has a new item");
    // A schedule keeps its served next run and its plain last status.
    const sched = automation_row_view(summary({ source_id: "schedule", source_version: 2, config: { kind: "daily", at: "08:00" } }, { schedule_rule_text: "Every day at 08:00 (Europe/Paris)", next_run_at: "2026-10-26T07:00:00Z", next_run_local: "2026-10-26T08:00:00+01:00" }), NOW);
    expect(sched).toMatchObject({ cadence: "Every day at 08:00 (Europe/Paris)", listening: false, last_status: "#1 completed" });
    expect(sched.next_run).toMatch(/^2026-10-26 08:00 Europe\/Paris/);
  });

  it("the brief (Board, agent page): words from the vocabulary, the served rule only for a schedule, email.received is mail", () => {
    set_trigger_vocab({ connections: connections as any, mailboxes: mailboxes as any });
    expect(trigger_vocab().connections).toHaveLength(1);
    const feed = fold_automation_brief({ summary: summary(FEED), definition: null })!;
    expect(feed).toMatchObject({ cadence: "When Release notes has a new item", event_driven: true, schedule_rule_text: "", time_zone: "Europe/Paris" });
    const mail = fold_automation_brief({ summary: summary({ source_id: "email.received", source_version: 1, config: {} }), definition: null })!;
    expect(mail.cadence).toBe("When mail arrives in me@example.test");
    expect(mail.event_driven).toBe(true);
    const hand = fold_automation_brief({ summary: summary({ source_id: "manual", source_version: 1, config: {} }), definition: null })!;
    expect(hand).toMatchObject({ cadence: "By hand", event_driven: false });
    expect(trigger_words({ source_id: "schedule", source_version: 1, config: { every: "24h" } })).toBe("every 24h");
    expect(trigger_words({ source_id: "schedule", source_version: 2, config: {} }, "Every day at 08:00 (Europe/Paris)")).toBe("Every day at 08:00 (Europe/Paris)");
    expect(trigger_words(null)).toBe("");
  });

  it("the gateway's served trigger_text wins (AbstractGateway 1613d05c); without it, our words", () => {
    const served = summary(FEED, { trigger_text: "When Python news has a new item" } as any);
    expect(automation_row_view(served, NOW).cadence).toBe("When Python news has a new item");
    const b = fold_automation_brief({ summary: served, definition: null })!;
    expect(b).toMatchObject({ cadence: "When Python news has a new item", trigger_text: "When Python news has a new item" });
    expect(fold_automation_brief({ summary: summary(FEED), definition: null })!).toMatchObject({ cadence: "When a feed has a new item", trigger_text: "" });
  });
});
