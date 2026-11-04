// The Board's entity tiles drawn by their identity refs, in a real browser (React 18 in Chromium,
// the board bundled from this source, the kit's avatar renderer included). The host re-renders the
// page on every 30 s poll with NEW tile objects, as app.tsx does: a ref is read once, a new rev is
// read once more, a failed read shows the gateway's sentence on its tile and draws nothing there.
// Needs the Playwright Chromium (as mission_control.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build } from "vite";

const CASTOR_REV1 = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "identity_castor_rev1.json"), "utf8"));

describe("entity tiles drawn by their identity refs (framework ADR 0052)", () => {
  let browser: Browser | null = null;
  let bundle = "";
  beforeAll(async () => {
    const entry = "\0identity-board-probe";
    const mc = fileURLToPath(new URL("./mission_control.tsx", import.meta.url));
    const idn = fileURLToPath(new URL("./identity.tsx", import.meta.url));
    const src = `import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { MissionControlPage } from ${JSON.stringify(mc)}; import { IdentityLooks } from ${JSON.stringify(idn)}; window.__board = { React, createRoot, flushSync, MissionControlPage, IdentityLooks };`;
    const out: any = await build({
      configFile: false,
      root: fileURLToPath(new URL("../..", import.meta.url)),
      logLevel: "silent",
      mode: "production",
      esbuild: { jsx: "automatic", jsxDev: false },
      plugins: [{ name: "identity-board-probe", resolveId: (id: string) => (id.endsWith("identity-board-probe") ? entry : null), load: (id: string) => (id === entry ? src : null) }],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: { write: false, minify: false, sourcemap: false, lib: { entry: "identity-board-probe", formats: ["iife"], name: "identity_board_probe" } },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o: any) => o.output || []);
    bundle = outputs.find((o: any) => o.type === "chunk").code;
    browser = await chromium.launch();
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("one read per ref across polls; a new rev reads once; a failed read shows the sentence and no orb; a row without a ref is today's tile", async () => {
    const page = await (await browser!.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    // An http page (the kit resolves its inlined avatar module against the document's URL; about:blank
    // has none), with the kit's theme tokens the avatar palette reads (the app's theme CSS sets them).
    await page.route("http://identity.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><style>:root{--bg-primary:#16213e;--ui-border-2:rgba(255,255,255,.2);--warning:#f59e0b;--error:#ef4444;--text-primary:#e5e7eb;--text-secondary:#9ca3af}</style></head><body><div id="root"></div></body></html>',
      }),
    );
    await page.goto("http://identity.test/");
    await page.addScriptTag({ content: bundle });
    const r = await page.evaluate(async (castor_rev1: any) => {
      const { React, createRoot, flushSync, MissionControlPage, IdentityLooks } = (window as any).__board;
      const calls: string[] = [];
      const rev2 = { ...castor_rev1, identity: { ...castor_rev1.identity, rev: 2, avatar: { ...castor_rev1.identity.avatar, style: "watch-lotus", color: "#3b82f6" } }, identity_ref: { of: "entity:castor", rev: 2 } };
      const looks = new IdentityLooks(async (name: string, rev: number) => {
        calls.push(`${name}#${rev}`);
        if (name === "Pollux") throw new Error("Pollux's look could not be read (HTTP 404): pollux has no identity rev 1");
        return rev === 1 ? castor_rev1 : rev2;
      });
      const tile = (name: string, ref: any) => ({
        name, identity_ref: ref, state: "asleep", age_days: 0, last_moment: "", last_moment_at: "", working: false, tokens_total: 0, live_visit_tokens: null,
        spend_warning: "", live_phase: "", open_questions: [], open_questions_total: 0, open_problems: [], open_problems_total: 0, lessons: [], lessons_total: 0, dreams_brief: null, error: "",
      });
      const root = createRoot(document.getElementById("root"));
      const render = (castor_rev: number) =>
        flushSync(() =>
          root.render(
            React.createElement(MissionControlPage, {
              gateway_connected: true, runs: [], all_runs: [], runs_refreshed_at: 1, refreshing: false,
              entities: [tile("Castor", { of: "entity:castor", rev: castor_rev }), tile("Pollux", { of: "entity:pollux", rev: 1 }), tile("Legacy", null)],
              identity_looks: looks, entities_total: 3, entities_error: "",
              on_refresh: () => {}, on_open_run: () => {}, on_resume_wait: async () => {}, on_open_automation: () => {}, entity_app_href: "",
              on_rename_automation: async () => {}, on_revise_automation: async () => {}, on_automation_command: async () => {},
              on_resume_run: async () => null, on_cancel_run: async () => null, code_app: { url: "" }, done_loaded: true,
            }),
          ),
        );
      const settle = () => new Promise((res) => setTimeout(res, 300));
      const tiles = () =>
        Array.from(document.querySelectorAll(".mc_entity")).map((el) => ({
          name: el.querySelector(".mc_entity_name")?.textContent,
          orb_ref: el.querySelector('[data-testid="identity-orb"]')?.getAttribute("data-ref") ?? null,
          orb_color: el.querySelector('[data-testid="identity-orb"]')?.getAttribute("data-color") ?? null,
          canvas: Boolean(el.querySelector("canvas")),
          reading: Boolean(el.querySelector('[data-testid="identity-look-reading"]')),
          error: el.querySelector('[data-testid="identity-look-error"]')?.getAttribute("title") ?? null,
        }));
      render(1);
      await settle();
      const first = { calls: [...calls], tiles: tiles() };
      render(1); // two polls with new tile objects, the same refs
      await settle();
      render(1);
      await settle();
      const polled = { calls: [...calls], tiles: tiles() };
      render(2); // Castor's identity changed: rev 2
      await settle();
      return { first, polled, changed: { calls: [...calls], tiles: tiles() } };
    }, CASTOR_REV1);

    const [castor, pollux, legacy] = r.first.tiles;
    expect(castor).toMatchObject({ name: "Castor", orb_ref: "entity:castor#1", orb_color: "#d06439", canvas: true, error: null });
    expect(pollux).toMatchObject({ name: "Pollux", orb_ref: null, canvas: false, reading: false, error: "Pollux's look could not be read (HTTP 404): pollux has no identity rev 1" });
    expect(legacy).toEqual({ name: "Legacy", orb_ref: null, orb_color: null, canvas: false, reading: false, error: null });
    expect(r.first.calls.filter((c: string) => c === "Castor#1")).toHaveLength(1);
    // The polls read Castor's ref again: never. Pollux's failed read is not kept, but a poll with the
    // same ref does not ask again either (the tile keeps its sentence until the ref changes).
    expect(r.polled.calls.filter((c: string) => c === "Castor#1")).toHaveLength(1);
    expect(r.polled.tiles[0]).toMatchObject({ orb_ref: "entity:castor#1", canvas: true });
    expect(r.polled.tiles[1].error).toContain("pollux has no identity rev 1");
    expect(r.changed.calls.filter((c: string) => c === "Castor#2")).toHaveLength(1);
    expect(r.changed.tiles[0]).toMatchObject({ orb_ref: "entity:castor#2", orb_color: "#3b82f6", canvas: true, error: null });
  }, 60_000);
});
