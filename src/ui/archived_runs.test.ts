// Round 6 (DESIGN R6.2): Observer lists RUNS (no sessions list, so no Archive button here). An
// archived conversation leaves the gateway's root_only listing; Observer is the audit view, so it
// fetches `archived_only=true` too and keeps those runs on the board, marked "Archived".
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { normalize_run_summary, with_archived_roots } from "./automations";
import { board_card } from "./mission_control";
import { GatewayClient } from "../lib/gateway_client";

const appSource = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const boardSource = readFileSync(new URL("./mission_control.tsx", import.meta.url), "utf8");

describe("archived conversations stay observable", () => {
  it("appends archived roots after the active ones, never twice", () => {
    const active = [{ run_id: "a" }, { run_id: "b" }];
    const archived = [{ run_id: "b", archived: true }, { run_id: "c", archived: true }, { run_id: "" }];
    expect(with_archived_roots(active, archived).map((r) => r.run_id)).toEqual(["a", "b", "c"]);
    expect(with_archived_roots([], [])).toEqual([]);
  });
  it("keeps the gateway's archived flag (only when the gateway says so)", () => {
    expect(normalize_run_summary({ run_id: "c", archived: true }).archived).toBe(true);
    expect(normalize_run_summary({ run_id: "a" }).archived).toBe(false);
    expect(board_card(normalize_run_summary({ run_id: "c", status: "completed", archived: true })).archived).toBe(true);
    expect(board_card(normalize_run_summary({ run_id: "a", status: "completed" })).archived).toBe(false);
  });
  it("the board marks an archived run with an Archived pill", () => {
    expect(boardSource).toMatch(/\{card\.archived \? <span className="mc_pill" data-tag="archived"[^>]*>Archived<\/span> : null\}/);
  });
  it("refresh_runs also asks for archived roots and merges them", () => {
    expect(appSource).toMatch(/list_runs\(\{ limit: 200, root_only: true, archived_only: true, include_metrics: true \}\)/);
    expect(appSource).toMatch(/const root_items = with_archived_roots\(/);
  });
  it("list_runs sends archived_only=true", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const real = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    try {
      const client = new GatewayClient({ base_url: "http://127.0.0.1:1", auth_token: "t" } as any);
      await client.list_runs({ limit: 5, root_only: true, archived_only: true });
    } finally {
      (globalThis as any).fetch = real;
    }
    expect(calls[0]).toMatch(/runs\?limit=5&root_only=true&archived_only=true/);
  });
});
