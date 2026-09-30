// State-toggle screenshots for AbstractObserver: 1440x900, 834x1194, 390x844, light + dark.
//
// Needs the Code e2e gateway fixture (sign-in, runs, System) and the automations stub
// (scripts/automations_stub_server.mjs, canonical kit fixtures) for a deterministic
// automation list: active, paused, completed (ended), archived and a legacy schedule.
//
//   OBSERVER_E2E_GATEWAY_URL=http://127.0.0.1:18140 node scripts/state_toggles.shots.mjs \
//     --url http://127.0.0.1:18141 --stub http://127.0.0.1:18143 --out <dir> [--only a,b] [--pw <node_modules with playwright-core>]
//
// Output: <dir>/<screen>.<viewport>.<light|dark>.png (viewport) and .full.png, plus
// type-scale.json: the largest font size / weight of every label, switch label and field
// caption inside dialogs and settings panels per screen (DESIGN §3: <= 15 px, <= 600).
// Works on the pre-switch build too (clicks the Pause button / checkbox where there is
// no switch), so the same script takes the BEFORE and AFTER captures.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import screensMod from "./responsive.screens.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PW_ROOT = args.pw || "/Users/albou/tmp/abstractframework/abstractcode/web/node_modules";
const pw = createRequire(path.join(PW_ROOT, "noop.js"))("playwright-core");
const OUT = path.resolve(args.out);
const STUB = args.stub;
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900, touch: false },
  { name: "834", width: 834, height: 1194, touch: true },
  { name: "390", width: 390, height: 844, touch: true },
];
const by = (n) => screensMod.screens.find((s) => s.name === n);

async function nav(page, label) {
  const item = page.locator(".shell_nav_item", { hasText: label }).first();
  if (!(await item.isVisible())) {
    await page.locator("[data-nav-toggle]").first().click();
    await item.waitFor({ state: "visible", timeout: 5000 });
  }
  await item.click();
  await page.waitForTimeout(500);
}

async function escapeAll(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator("[role=dialog]:visible, .modal_backdrop:visible").count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

// Extra rows so every state shows: an ended automation and an archived one.
async function routeAutomations(ctx) {
  await ctx.route(/\/api\/gateway\/(automations|trigger-sources)(\/|\?|$)/, async (route) => {
    const u = new URL(route.request().url());
    const res = await route.fetch({ url: STUB + u.pathname + u.search });
    if (route.request().method() === "GET" && u.pathname.endsWith("/api/gateway/automations")) {
      const body = await res.json();
      const base = body.items.find((s) => !s.legacy);
      body.items.push(
        { ...base, automation_id: "ended-0001", title: "Launch countdown", status: "completed", next_fire_at: null, current_occurrence: null },
        { ...base, automation_id: "archived-0001", title: "Old digest", status: "archived", next_fire_at: null, current_occurrence: null },
      );
      return route.fulfill({ response: res, json: body });
    }
    return route.fulfill({ response: res });
  });
}

const row = (page, title) => page.locator(".auto_row", { hasText: title }).first();

const ALL_SCREENS = [
  {
    name: "automations",
    async run(page, info) {
      await by("launch").run(page, info);
      await escapeAll(page);
      await nav(page, "Automations");
      await row(page, "Inbox triage").waitFor({ timeout: 10000 });
    },
  },
  {
    name: "automations-paused",
    async run(page) {
      const r = row(page, "Inbox triage");
      const sw = r.locator('[role="switch"][data-action="active"]');
      if (await sw.count()) await sw.click();
      else await r.locator('[data-action="pause"]').click();
      await page.waitForTimeout(900);
    },
  },
  {
    name: "automations-archived",
    async run(page) {
      await page.locator('[data-action="show-archived"]').first().click();
      await row(page, "Old digest").waitFor({ timeout: 5000 });
    },
  },
  {
    // An ended and an archived automation: the switch is unavailable, with the reason on hover.
    name: "automations-ended",
    async run(page) {
      await row(page, "Old digest").scrollIntoViewIfNeeded();
      await row(page, "Launch countdown").scrollIntoViewIfNeeded();
    },
  },
  {
    name: "automation-detail",
    async run(page) {
      await row(page, "AI news monitor").locator(".auto_row_main").click();
      await page.locator(".af-auto__controls").first().waitFor({ timeout: 10000 });
    },
  },
  {
    // Launch → Automate, Email section: "Email me the result" (kit switch; unavailable while email is not set up).
    name: "automate-email",
    async run(page, info) {
      await escapeAll(page);
      await by("launch").run(page, info); // signs in when needed
      await by("automate").run(page, info);
      await page.locator('fieldset[data-section="email"]').scrollIntoViewIfNeeded();
    },
  },
  {
    name: "settings",
    async run(page) {
      await escapeAll(page);
      await nav(page, "Settings");
    },
  },
  {
    name: "system-memory",
    async run(page) {
      await escapeAll(page);
      await nav(page, "System");
      await page.locator(".runtime_mode_tab", { hasText: "Memory" }).click();
      await page.waitForTimeout(1200);
    },
  },
];

// --only a,b: capture just these screens (the automations screens need --stub).
const SCREENS = args.only ? ALL_SCREENS.filter((x) => args.only.split(",").includes(x.name)) : ALL_SCREENS;

// DESIGN §3 type scale: labels inside dialogs and settings panels.
async function typeScale(page) {
  return page.evaluate(() => {
    const sel = "[role=dialog] label, [role=dialog] .af-switch__label, .settings_body label, .settings_body .af-switch__label, .settings_row_title, .auto_row_actions .af-switch__label, .auto_show_archived label, .auto_show_archived .af-switch__label, .af-auto__controls .af-switch__label";
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      out.push({ text: (el.textContent || "").trim().slice(0, 40), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) });
    }
    const max = (k) => out.reduce((m, x) => Math.max(m, x[k]), 0);
    return { count: out.length, maxSize: max("size"), maxWeight: max("weight"), over: out.filter((x) => x.size > 15 || x.weight > 600) };
  });
}

const scale = {};
const browser = await pw.chromium.launch({ headless: true });
try {
  for (const scheme of ["light", "dark"]) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        hasTouch: vp.touch,
        isMobile: vp.touch,
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      const theme = scheme === "light" ? "light" : "observer-night";
      await ctx.addInitScript((t) => {
        try {
          const key = "af_appearance_abstractobserver_v1";
          const cur = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(key, JSON.stringify({ ...cur, theme: t }));
        } catch {}
      }, theme);
      if (STUB) await routeAutomations(ctx);
      // The stub keeps state: every context starts with "Inbox triage" active again.
      const inbox = !STUB ? null : (await (await fetch(`${STUB}/api/gateway/automations?limit=50`)).json()).items.find((x) => x.title === "Inbox triage");
      if (inbox) await fetch(`${STUB}/api/gateway/automations/${inbox.automation_id}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command_id: `shots-reset-${scheme}-${vp.name}-${Date.now()}`, type: "automation.resume" }),
      });
      const page = await ctx.newPage();
      const info = { baseUrl: args.url, viewport: vp, browser: "chromium" };
      await page.goto(args.url, { waitUntil: "domcontentloaded" });
      await screensMod.setup(page, info);
      for (const s of SCREENS) {
        const base = path.join(OUT, `${s.name}.${vp.name}.${scheme}`);
        try {
          await s.run(page, info);
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${base}.png` });
          await page.screenshot({ path: `${base}.full.png`, fullPage: true });
          scale[path.basename(base)] = await typeScale(page);
          process.stdout.write(`ok ${path.basename(base)}\n`);
        } catch (e) {
          process.stdout.write(`FAIL ${path.basename(base)}: ${String(e.message || e).split("\n")[0]}\n`);
          await page.screenshot({ path: `${base}.error.png` }).catch(() => {});
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  const file = path.join(OUT, "type-scale.json");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...scale }, null, 2));
}
