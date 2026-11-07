// Every session the gateway has, with simple filters (operator 2026-11-07: "Observer is for
// technical users, so we absolutely need to show anything running on the gateway. However be
// smart, we should have simple filters in the UI"). Gateway 0.21.0's turn listings hide Docs
// assistant chats and note sessions unless asked for `kind=all`; an older gateway refuses unknown
// parameters and reports no kinds (no filter then).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GatewayClient } from "../lib/gateway_client";
import { normalize_run_summary } from "./automations";
import { MissionControlPage } from "./mission_control";
import type { RunSummary } from "./run_status";
import { SessionFilterRow } from "./session_filter_row";
import {
  filter_sessions,
  list_session_roots,
  listing_kind,
  reports_kinds,
  runs_list_filters_of,
  session_filter_label,
  session_filter_options,
  session_group,
} from "./session_kinds";

const CAPS_WITH_KIND = { capabilities: { contracts: { common: { runs: { list: { available: true, filters: ["archived_only", "kind", "limit", "root_only"] } } } } } };
const CAPS_WITHOUT_KIND = { capabilities: { contracts: { common: { runs: { list: { available: true, filters: ["archived_only", "limit", "root_only"] } } } } } };

function row(run_id: string, extra: Partial<RunSummary> = {}): RunSummary {
  return { run_id, session_id: `s-${run_id}`, status: "completed", ...extra };
}

describe("asking the gateway for every session", () => {
  it("asks for kind=all only when the gateway advertises the kind filter", () => {
    expect(runs_list_filters_of(CAPS_WITH_KIND)).toContain("kind");
    expect(listing_kind(runs_list_filters_of(CAPS_WITH_KIND))).toEqual({ kind: "all" });
    expect(listing_kind(runs_list_filters_of(CAPS_WITHOUT_KIND))).toEqual({});
    expect(listing_kind(runs_list_filters_of({}))).toEqual({});
    expect(listing_kind(null)).toEqual({});
  });

  it("the sweep's root and archived listings carry kind=all on a gateway with kinds, nothing on one without", async () => {
    const calls: any[] = [];
    const client = (filters: string[] | null) => ({
      runs_list_filters: async () => filters,
      list_runs: async (opts: any) => {
        calls.push(opts);
        return { items: [], archived_sessions: 2 };
      },
    });
    await list_session_roots(client(["kind", "root_only"]));
    expect(calls).toEqual([
      { limit: 200, root_only: true, include_metrics: true, kind: "all" },
      { limit: 200, root_only: true, archived_only: true, include_metrics: true, kind: "all" },
    ]);
    calls.length = 0;
    await list_session_roots(client(null));
    expect(calls.every((c) => !("kind" in c))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("GatewayClient sends kind on the wire and reads the capabilities once for discovery and the sweep", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    try {
      globalThis.fetch = (async (url: any) => {
        urls.push(String(url));
        const body = String(url).includes("discovery/capabilities") ? CAPS_WITH_KIND : { items: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as any;
      const c = new GatewayClient({ base_url: "http://127.0.0.1:8080", auth_token: "" } as any);
      await c.capabilities_once();
      expect(await c.runs_list_filters()).toContain("kind");
      await c.list_runs({ limit: 5, root_only: true, kind: "all" });
      expect(urls.filter((u) => u.includes("discovery/capabilities"))).toHaveLength(1);
      const listing = new URL(urls.find((u) => u.includes("/runs?"))!);
      expect(listing.searchParams.get("kind")).toBe("all");
      expect(listing.searchParams.get("root_only")).toBe("true");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("a failed capabilities read is not kept and means no kind filter", async () => {
    const original = globalThis.fetch;
    let n = 0;
    try {
      globalThis.fetch = (async () => {
        n += 1;
        return new Response("down", { status: 503 });
      }) as any;
      const c = new GatewayClient({ base_url: "http://127.0.0.1:8080", auth_token: "" } as any);
      expect(await c.runs_list_filters()).toBeNull();
      expect(await c.runs_list_filters()).toBeNull();
      expect(n).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("the listing normalizer keeps the gateway's kind field", () => {
    expect(normalize_run_summary({ run_id: "r1", kind: "notes" }).kind).toBe("notes");
    expect(normalize_run_summary({ run_id: "r1" }).kind).toBeNull();
  });
});

describe("the Show filter", () => {
  const conversation = row("c1", { kind: "conversation", session_kind: "chat" });
  const conversation_turn2 = row("c2", { kind: "conversation", session_kind: "chat", session_id: "s-c1" });
  const automation = row("a1", { kind: "conversation", session_kind: "automation", role: "controller", automation_id: "a1" });
  const occurrence = row("o1", { kind: "conversation", session_kind: "occurrence", role: "occurrence", automation_id: "a1" });
  // A note automation's occurrence: a note session (the gateway says so), not an automation.
  const note_occurrence = row("n1", { kind: "notes", session_kind: "occurrence", role: "occurrence", automation_id: "a2" });
  const docs = row("d1", { kind: "docs", session_kind: "chat" });
  const later_kind = row("x1", { kind: "research_log" });
  const rows = [conversation, conversation_turn2, automation, occurrence, note_occurrence, docs, later_kind];

  it("groups by the gateway's kind first, then the automation attribution", () => {
    expect(rows.map(session_group)).toEqual(["conversations", "conversations", "automations", "automations", "notes", "docs", "research_log"]);
  });

  it("offers All, Conversations, Automations, then every other reported kind, with session counts", () => {
    expect(session_filter_options(rows)).toEqual([
      { value: "all", label: "All", count: 6 },
      { value: "conversations", label: "Conversations", count: 1 },
      { value: "automations", label: "Automations", count: 2 },
      { value: "notes", label: "Notes", count: 1 },
      { value: "docs", label: "Docs assistant", count: 1 },
      { value: "research_log", label: "Research log", count: 1 },
    ]);
    expect(session_filter_label("research_log")).toBe("Research log");
  });

  it("filters the rows; All shows everything", () => {
    expect(filter_sessions(rows, "notes").map((r) => r.run_id)).toEqual(["n1"]);
    expect(filter_sessions(rows, "conversations").map((r) => r.run_id)).toEqual(["c1", "c2"]);
    expect(filter_sessions(rows, "automations").map((r) => r.run_id)).toEqual(["a1", "o1"]);
    expect(filter_sessions(rows, "all")).toHaveLength(rows.length);
  });

  it("a gateway that reports no kinds gets no filter: every run shows, as before", () => {
    const old = [row("c1", { session_kind: "chat" }), row("a1", { session_kind: "automation", automation_id: "a1" })];
    expect(reports_kinds(old)).toBe(false);
    expect(session_filter_options(old)).toEqual([]);
    expect(filter_sessions(old, "automations")).toHaveLength(2);
    expect(renderToStaticMarkup(<SessionFilterRow options={[]} value="all" on_change={() => {}} />)).toBe("");
  });

  it("renders kit filter chips; the one in use is pressed", () => {
    const html = renderToStaticMarkup(<SessionFilterRow options={session_filter_options(rows)} value="notes" on_change={() => {}} />);
    expect(html).toContain('aria-label="Show"');
    expect(html).toMatch(/data-af-value="notes" aria-pressed="true"/);
    expect(html).toMatch(/data-af-value="all" aria-pressed="false"/);
    for (const word of ["All", "Conversations", "Automations", "Notes", "Docs assistant"]) expect(html).toContain(`>${word}<`);
  });

  it("the Board draws the chips above its lanes", () => {
    const html = renderToStaticMarkup(
      <MissionControlPage
        gateway_connected
        runs={[]}
        all_runs={[]}
        filters={<SessionFilterRow options={session_filter_options(rows)} value="all" on_change={() => {}} />}
        runs_refreshed_at={Date.now()}
        entities={[]}
        entities_total={0}
        entities_error=""
        on_open_run={() => {}}
        on_resume_wait={async () => {}}
        on_open_automation={() => {}}
        entity_app_href="/entity/"
      />,
    );
    expect(html.indexOf("mc_filters")).toBeGreaterThan(-1);
    expect(html.indexOf("mc_filters")).toBeLessThan(html.indexOf("mc_board"));
  });
});
