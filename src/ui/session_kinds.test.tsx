// Every session the gateway has, with simple filters (operator 2026-11-07: "Observer is for
// technical users, so we absolutely need to show anything running on the gateway. However be
// smart, we should have simple filters in the UI"). Gateway 0.21.0's turn listings hide Docs
// assistant chats and note sessions unless asked for `kind=all`; an older gateway refuses unknown
// parameters and reports no kinds (no filter then).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GatewayClient } from "../lib/gateway_client";
import { normalize_run_summary } from "./automations";
import { MissionControlPage } from "./mission_control";
import type { RunSummary } from "./run_status";
import { SessionFilterRow } from "./session_filter_row";
import {
  kinds_reported,
  list_session_roots,
  listing_kind,
  row_matches_query,
  runs_list_filters_of,
  session_filter_label,
  session_filter_options,
  session_filter_query,
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

describe("each chip asks the gateway for its own sessions (coordinator 2026-11-07: never a filtered slice of the mixed newest-200 window)", () => {
  const FILTERS = ["kind", "limit", "root_only", "session_kind", "archived_only"];
  const calls: any[] = [];
  const client = (filters: string[] | null, archived = 2) => ({
    runs_list_filters: async () => filters,
    list_runs: async (opts: any) => {
      calls.push(opts);
      return { items: [], archived_sessions: archived };
    },
  });

  it("All asks kind=all; a kind chip asks that kind; Conversations and Automations add the gateway's session_kind filter", async () => {
    const asked = async (filter: string) => {
      calls.length = 0;
      await list_session_roots(client(FILTERS), filter);
      return calls.map((c) => ({ kind: c.kind, session_kind: c.session_kind, archived_only: c.archived_only === true, limit: c.limit }));
    };
    expect(await asked("all")).toEqual([
      { kind: "all", session_kind: undefined, archived_only: false, limit: 200 },
      { kind: "all", session_kind: undefined, archived_only: true, limit: 200 },
    ]);
    expect((await asked("notes")).map((c) => [c.kind, c.session_kind])).toEqual([["notes", undefined], ["notes", undefined]]);
    expect((await asked("docs"))[0]).toMatchObject({ kind: "docs", limit: 200 });
    expect((await asked("conversations"))[0]).toMatchObject({ kind: "conversation", session_kind: "chat,discussion" });
    expect((await asked("automations"))[0]).toMatchObject({ kind: "conversation", session_kind: "automation,occurrence" });
  });

  it("the query is exactly what each chip means (one source for the request and the active rows)", () => {
    expect(session_filter_query("all", FILTERS)).toEqual({ kind: "all" });
    expect(session_filter_query("notes", FILTERS)).toEqual({ kind: "notes" });
    expect(session_filter_query("conversations", ["kind"])).toEqual({ kind: "conversation" });
    expect(session_filter_query("notes", null)).toEqual({});
  });

  it("a gateway without the kind filter is asked nothing new and gets no chips", async () => {
    calls.length = 0;
    await list_session_roots(client(["limit", "root_only"]), "notes");
    expect(calls.every((c) => !("kind" in c) && !("session_kind" in c))).toBe(true);
    expect(session_filter_options(["limit", "root_only"], ["notes"])).toEqual([]);
    expect(session_filter_options(null, ["notes"])).toEqual([]);
    expect(renderToStaticMarkup(<SessionFilterRow options={[]} value="all" on_change={() => {}} />)).toBe("");
  });

  it("chips: All, Conversations, Automations (when session_kind is advertised), then every other kind the gateway has reported on a row; no counts", () => {
    expect(session_filter_options(FILTERS, ["research_log", "notes", "docs"])).toEqual([
      { value: "all", label: "All" },
      { value: "conversations", label: "Conversations" },
      { value: "automations", label: "Automations" },
      { value: "notes", label: "Notes" },
      { value: "docs", label: "Docs assistant" },
      { value: "research_log", label: "Research log" },
    ]);
    expect(session_filter_options(["kind"], []).map((o) => o.value)).toEqual(["all", "conversations"]);
    expect(kinds_reported([row("a", { kind: "notes" }), row("b", { kind: "conversation" }), row("c"), row("d", { kind: "docs" })])).toEqual(["notes", "docs"]);
    expect(session_filter_label("research_log")).toBe("Research log");
  });

  it("the complete active listings (running, waiting) are matched by the same query; the window itself is never filtered here", () => {
    const q = session_filter_query("conversations", FILTERS);
    expect(row_matches_query(row("c", { kind: "conversation", session_kind: "chat" }), q)).toBe(true);
    expect(row_matches_query(row("o", { kind: "conversation", session_kind: "occurrence" }), q)).toBe(false);
    expect(row_matches_query(row("n", { kind: "notes", session_kind: "chat" }), q)).toBe(false);
    expect(row_matches_query(row("n", { kind: "notes" }), session_filter_query("all", FILTERS))).toBe(true);
    expect(row_matches_query(row("n", { kind: "notes" }), {})).toBe(true);
  });

  it("the app's sweep asks for the chip in use, and choosing a chip resets the Done rows and asks again", () => {
    const app = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    expect(app).toMatch(/const sweep_filter = session_filter_ref\.current;\s*void list_session_roots\(gateway_client, sweep_filter\)/);
    expect(app).toMatch(/if \(session_filter_ref\.current !== sweep_filter\) return;/);
    const choose = app.slice(app.indexOf("const choose_session_filter"), app.indexOf("const board_runs"));
    expect(choose).toContain("session_filter_ref.current = value;");
    expect(choose).toContain("runs_poll_peek(gateway)?.reset_sweep();");
    expect(choose).toContain("refresh_runs(gateway, { force: true })");
    // The rows are never a client-side slice of the mixed window: no grouping of rows by kind here.
    expect(app).not.toMatch(/filter_sessions\(|session_group\(/);
  });

  it("a chip no longer offered falls back to All for the sweep too, not only on screen (review 0.12.4)", () => {
    const app = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    const sync = app.slice(app.indexOf("One truth for the chip"), app.indexOf("const choose_session_filter"));
    expect(sync).toContain("if (shown_session_filter === session_filter_ref.current) return;");
    expect(sync).toContain("session_filter_ref.current = shown_session_filter;");
    expect(sync).toContain("runs_poll_peek(gateway)?.reset_sweep();");
    expect(sync).toMatch(/\}, \[shown_session_filter\]\);/);
  });

  it("renders kit filter chips with no counts; the one in use is pressed", () => {
    const html = renderToStaticMarkup(<SessionFilterRow options={session_filter_options(FILTERS, ["notes", "docs"])} value="notes" on_change={() => {}} />);
    expect(html).toContain('aria-label="Sessions"');
    expect(html).toMatch(/data-af-value="notes" aria-pressed="true"/);
    expect(html).toMatch(/data-af-value="all" aria-pressed="false"/);
    expect(html).not.toContain("af-filterbar__count");
    for (const word of ["All", "Conversations", "Automations", "Notes", "Docs assistant"]) expect(html).toContain(`>${word}<`);
  });

  it("the Board draws the chips above its lanes", () => {
    const html = renderToStaticMarkup(
      <MissionControlPage
        gateway_connected
        runs={[]}
        all_runs={[]}
        filters={<SessionFilterRow options={session_filter_options(["kind", "session_kind"], ["notes"])} value="all" on_change={() => {}} />}
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
