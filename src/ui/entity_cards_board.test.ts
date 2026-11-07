// The Board's Entities strip in a real browser (React 18 in Chromium, the board bundled from this
// source with the kit's EntityCard and its avatar renderer): each card draws its look from what it
// was given (the tile's `look`, or the roster's before the tile arrives) — no per-card identity read
// — and the cards fit the strip at 1440 px and at a 400 px phone width.
// Needs the Playwright Chromium (as mission_control.test.ts).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build } from "vite";
import { fileURLToPath } from "node:url";

import { gateway_tile } from "./__fixtures__/entity_tile";

describe("Board entity cards in a browser (ui-kit EntityCard, compact)", () => {
  let browser: Browser | null = null;
  let bundle = "";
  let css = "";
  beforeAll(async () => {
    const entry = "\0entity-cards-board-probe";
    const mc = fileURLToPath(new URL("./mission_control.tsx", import.meta.url));
    const src = `import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { MissionControlPage } from ${JSON.stringify(mc)}; window.__board = { React, createRoot, flushSync, MissionControlPage };`;
    const out: any = await build({
      configFile: false,
      root: fileURLToPath(new URL("../..", import.meta.url)),
      logLevel: "silent",
      mode: "production",
      esbuild: { jsx: "automatic", jsxDev: false },
      plugins: [{ name: "entity-cards-board-probe", resolveId: (id: string) => (id.endsWith("entity-cards-board-probe") ? entry : null), load: (id: string) => (id === entry ? src : null) }],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: { write: false, minify: false, sourcemap: false, lib: { entry: "entity-cards-board-probe", formats: ["iife"], name: "entity_cards_board_probe" } },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o: any) => o.output || []);
    bundle = outputs.find((o: any) => o.type === "chunk").code;
    // The kit's theme (the EntityCard rules) + the board's own CSS.
    const kit = readFileSync(new URL("../../node_modules/@abstractframework/ui-kit/src/theme.css", import.meta.url), "utf8");
    if (!kit.includes(".af-entity-card")) throw new Error("the installed ui-kit has no EntityCard styles (needs ui-kit >= 0.9.17)");
    css = kit + "\n" + outputs.filter((o: any) => o.type === "asset" && String(o.fileName).endsWith(".css")).map((o: any) => String(o.source)).join("\n");
    browser = await chromium.launch();
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  for (const width of [1440, 400]) {
    it(`draws each look from the tile or the roster, never reads an identity, and fits at ${width} px`, async () => {
      const page = await (await browser!.newContext({ viewport: { width, height: 900 } })).newPage();
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.route("http://board.test/", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>' }));
      await page.goto("http://board.test/");
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle });
      const r = await page.evaluate(async (tiles: any[]) => {
        const { React, createRoot, flushSync, MissionControlPage } = (window as any).__board;
        const root = createRoot(document.getElementById("root"));
        flushSync(() =>
          root.render(
            React.createElement(MissionControlPage, {
              gateway_connected: true, runs: [], all_runs: [], runs_refreshed_at: 1,
              entities: tiles, entities_total: tiles.length, entities_error: "",
              on_open_run: () => {}, on_resume_wait: async () => {}, on_open_automation: () => {}, entity_app_href: "http://entity.test/",
              done_loaded: true,
            }),
          ),
        );
        await new Promise((res) => setTimeout(res, 400));
        const cards = Array.from(document.querySelectorAll(".mc_entities_row .af-entity-card")).map((el) => {
          const b = el.getBoundingClientRect();
          return {
            name: el.getAttribute("aria-label"),
            status: el.getAttribute("data-status"),
            canvas: Boolean(el.querySelector(".af-entity-card__orb canvas")),
            plain: el.querySelector(".af-entity-card__orb.is-plain")?.textContent ?? null,
            width: Math.round(b.width),
            overflow: Array.from(el.querySelectorAll("*")).some((c) => (c as HTMLElement).getBoundingClientRect().right > b.right + 0.5),
          };
        });
        return { cards, body_scrolls: document.documentElement.scrollWidth > window.innerWidth + 1 };
      }, [
        { name: "Castor", look: { style: "watch-shape-kitty", color: "#d06439" }, tile: gateway_tile("Castor"), status: "ready", as_of_ms: null, reason: "" },
        { name: "Pollux", look: { style: "watch-shape-kitty", color: "#d06439" }, tile: null, status: "loading", as_of_ms: null, reason: "" },
        { name: "Legacy", look: null, tile: null, status: "unavailable", as_of_ms: null, reason: "HTTP 500" },
      ]);
      expect(r.cards.map((c) => [c.name, c.status])).toEqual([["Castor", "ready"], ["Pollux", "loading"], ["Legacy", "unavailable"]]);
      expect(r.cards[0].canvas).toBe(true); // the tile's own look (watch-lotus)
      expect(r.cards[1].canvas).toBe(true); // the roster's look, before the tile arrives
      expect(r.cards[2]).toMatchObject({ canvas: false, plain: "L" }); // no look: its initial
      expect(r.cards.every((c) => !c.overflow && c.width > 150)).toBe(true);
      expect(r.body_scrolls).toBe(false);
      expect(requests.filter((u) => /\/identity\b/.test(u))).toEqual([]);
    }, 60_000);
  }
});
