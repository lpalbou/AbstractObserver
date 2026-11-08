// The "…" control in a real browser (review 2026-11-08 R2: removing it left every test green, because
// the control is measured after layout and a static render never shows it). React 18 in Chromium, the
// board bundled from this source with its own CSS: a title longer than its lines gets the control, a
// short one does not, and the control expands the title in place.
// Needs the Playwright Chromium (as entity_cards_board.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build } from "vite";
import { fileURLToPath } from "node:url";

describe("ClampText's '…' control in a browser", () => {
  let browser: Browser | null = null;
  let bundle = "";
  let css = "";
  beforeAll(async () => {
    const entry = "\0board-clamp-probe";
    const mc = fileURLToPath(new URL("./mission_control.tsx", import.meta.url));
    const src = `import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { BoardCardView, build_board } from ${JSON.stringify(mc)}; window.__board = { React, createRoot, flushSync, BoardCardView, build_board };`;
    const out: any = await build({
      configFile: false,
      root: fileURLToPath(new URL("../..", import.meta.url)),
      logLevel: "silent",
      mode: "production",
      esbuild: { jsx: "automatic", jsxDev: false },
      plugins: [{ name: "board-clamp-probe", resolveId: (id: string) => (id.endsWith("board-clamp-probe") ? entry : null), load: (id: string) => (id === entry ? src : null) }],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: { write: false, minify: false, sourcemap: false, lib: { entry: "board-clamp-probe", formats: ["iife"], name: "board_clamp_probe" } },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o: any) => o.output || []);
    bundle = outputs.find((o: any) => o.type === "chunk").code;
    css = outputs.filter((o: any) => o.type === "asset" && String(o.fileName).endsWith(".css")).map((o: any) => String(o.source)).join("\n");
    browser = await chromium.launch();
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("a long title shows '…' (and expands in place); a short one shows none", async () => {
    const page = await (await browser!.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    await page.route("http://board.test/", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head></head><body><div id="a" style="width:300px"></div><div id="b" style="width:300px"></div></body></html>' }));
    await page.goto("http://board.test/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    const r = await page.evaluate(async () => {
      const { React, createRoot, flushSync, BoardCardView, build_board } = (window as any).__board;
      const now = Date.now();
      const iso = (min: number) => new Date(now - min * 60_000).toISOString();
      const card_of = (id: string, excerpt: string) =>
        build_board({ active: [{ run_id: id, workflow_id: "basic-agent@0.0.5:x", status: "running", session_id: `s-${id}`, created_at: iso(30), updated_at: iso(1) }], done: [], run_briefs: new Map([[id, { run_id: id, excerpt }]]), now_ms: now }).working[0];
      const long = "Summarise the inbox and draft replies for every thread that waits on me, newest first, in my usual tone of voice, and flag anything that needs a decision from me today";
      const props = (card: any) => ({ card, now_ms: now, stall_after_ms: 300_000, busy: false, on_open_run: () => {}, on_act: () => {} });
      flushSync(() => createRoot(document.getElementById("a")).render(React.createElement(BoardCardView, props(card_of("long", long)))));
      flushSync(() => createRoot(document.getElementById("b")).render(React.createElement(BoardCardView, props(card_of("short", "Fix the test")))));
      await new Promise((res) => setTimeout(res, 300));
      const more_long = document.querySelector("#a .mc_card_title .mc_clamp_more") as HTMLButtonElement | null;
      const more_short = document.querySelector("#b .mc_card_title .mc_clamp_more");
      const clamped = document.querySelector("#a .mc_card_title .mc_clamp_text") as HTMLElement;
      const before = { h: clamped.clientHeight, cut: clamped.scrollHeight > clamped.clientHeight + 1 };
      const label_long = more_long?.getAttribute("aria-label") || "";
      more_long?.click();
      await new Promise((res) => setTimeout(res, 100));
      const after = { open: Boolean(document.querySelector("#a .mc_clamp.is_open")), h: clamped.clientHeight, label: more_long?.textContent || "" };
      return { has_long: Boolean(more_long), label_long, has_short: Boolean(more_short), before, after, text: clamped.textContent };
    });
    expect(r.before.cut).toBe(true); // the title IS longer than its two lines…
    expect(r.has_long).toBe(true); // …so the control is there
    expect(r.label_long).toBe("Read the whole title");
    expect(r.has_short).toBe(false);
    expect(r.after.open).toBe(true);
    expect(r.after.h).toBeGreaterThan(r.before.h);
    expect(r.after.label).toBe("less");
    expect(r.text).toContain("needs a decision from me today");
  }, 60_000);
});
