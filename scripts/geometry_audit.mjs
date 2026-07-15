// Geometry audit — headless-chrome layout verifier for the observer UI.
// Reports, per page and viewport width:
//  - pane/card bounding-box intersections (collisions)
//  - pane headers inset from their pane edges (double-padding bug class)
//  - text/content bleeding outside its pane
//  - action rows (queue buttons) not filling their column (ragged rails)
//  - vertical gap under the section tab strip (< 8px = collision)
// Usage: node scripts/geometry_audit.mjs [base_url]
// Token: VQ_GATEWAY_TOKEN env or ~/.abstractassistant/gateway_connection.json.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const BASE = process.argv[2] || "http://127.0.0.1:3001/";
function token() {
  const env = String(process.env.VQ_GATEWAY_TOKEN || "").trim();
  if (env) return env;
  try {
    const raw = readFileSync(`${homedir()}/.abstractassistant/gateway_connection.json`, "utf8");
    const tok = String(JSON.parse(raw).token || "").trim();
    if (tok) return tok;
  } catch {}
  console.error("no gateway token (set VQ_GATEWAY_TOKEN or persist a connection)");
  process.exit(1);
}

const AUDIT = () => {
  const issues = [];
  const name = (el) => (typeof el.className === "string" && el.className ? el.className.split(" ").slice(0, 2).join(".") : el.tagName.toLowerCase());
  const visible = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;

  // 1. Pane-level collisions.
  const panes = [...document.querySelectorAll(".pane, .mc_column, .settings_advanced, .metric_tile, .raised")].filter(visible);
  const boxes = panes.map((e) => ({ e, r: e.getBoundingClientRect() }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 4 && y > 4) issues.push(`COLLIDE ${name(a.e)} x ${name(b.e)} (${Math.round(x)}x${Math.round(y)})`);
    }
  }

  // 2. Pane headers must span their pane (inset header = double padding).
  for (const p of document.querySelectorAll(".pane")) {
    if (!visible(p)) continue;
    const h = p.querySelector(":scope > .pane_header");
    if (!h) continue;
    const pr = p.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    const inset_l = hr.left - pr.left;
    const inset_r = pr.right - hr.right;
    if (inset_l > 3 || inset_r > 3) issues.push(`INSET-HEADER ${name(p)} (left ${Math.round(inset_l)}px right ${Math.round(inset_r)}px)`);
  }

  // 3. Content bleeding outside its pane (any descendant box crossing the
  //    pane's border by >4px on a non-scrolling axis).
  for (const p of document.querySelectorAll(".pane, .mc_column")) {
    if (!visible(p)) continue;
    const pr = p.getBoundingClientRect();
    for (const el of p.querySelectorAll("button, input, select, .chip, strong, h2, h3")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > pr.right + 4 || r.left < pr.left - 4) {
        issues.push(`X-BLEED ${name(el)} out of ${name(p)} (${Math.round(Math.max(r.right - pr.right, pr.left - r.left))}px)`);
      }
    }
  }

  // 4. Queue rail rows should fill the column (ragged content-width rows).
  const rail = document.querySelector(".runtime_ops_queue_list");
  if (rail && visible(rail)) {
    const rw = rail.clientWidth - parseFloat(getComputedStyle(rail).paddingLeft) - parseFloat(getComputedStyle(rail).paddingRight);
    for (const b of rail.querySelectorAll(".runtime_ops_filter")) {
      const w = b.getBoundingClientRect().width;
      if (rw - w > 12) { issues.push(`RAGGED-RAIL runtime_ops_filter ${Math.round(w)}px vs rail ${Math.round(rw)}px`); break; }
    }
  }

  // 5. Section tab strip needs air before the next block.
  for (const tabs of document.querySelectorAll(".runtime_mode_tabs")) {
    if (!visible(tabs)) continue;
    const tr = tabs.getBoundingClientRect();
    let next = tabs.nextElementSibling;
    while (next && !visible(next)) next = next.nextElementSibling;
    if (next) {
      const nr = next.getBoundingClientRect();
      const gap = nr.top - tr.bottom;
      if (gap < 8) issues.push(`TAB-GAP ${Math.round(gap)}px between tabs and ${name(next)}`);
    }
  }

  return issues;
};

const b = await chromium.launch();
let failures = 0;
for (const width of [1000, 1120, 1280, 1560]) {
  const ctx = await b.newContext({ viewport: { width, height: 940 } });
  const pg = await ctx.newPage();
  await pg.goto(BASE, { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(1500);
  const ov = pg.locator(".af-connect-overlay");
  // The app may auto-sign-in from a persisted browser session while we
  // type — every step tolerates the overlay vanishing mid-action.
  for (let i = 0; i < 3 && (await ov.isVisible().catch(() => false)); i++) {
    try {
      await ov.locator('input[type="password"]').fill(token(), { timeout: 4000 });
      await ov.getByRole("button", { name: /^sign in$/i }).click({ timeout: 4000 });
    } catch {}
    await pg.waitForTimeout(2600);
  }
  await pg.waitForSelector(".mc_card, .mc_empty", { timeout: 25000 }).catch(() => {});

  const pages = [["Board", "board"], ["Observe", "observe"], ["System", "system"], ["Launch", "launch"], ["Settings", "settings"]];
  for (const [label, slug] of pages) {
    await pg.locator(".shell_nav_item", { hasText: label }).first().click().catch(() => {});
    await pg.waitForTimeout(1400);
    const report = (issues, tag) => {
      for (const i of issues) { console.log(`[${width}/${tag}] ${i}`); failures++; }
    };
    report(await pg.evaluate(AUDIT), slug);
    if (slug === "system") {
      for (const tab of ["Artifacts", "Memory", "Logs", "Activity"]) {
        await pg.locator(".runtime_mode_tab", { hasText: tab }).first().click().catch(() => {});
        await pg.waitForTimeout(900);
        report(await pg.evaluate(AUDIT), `system/${tab.toLowerCase()}`);
      }
    }
    await pg.screenshot({ path: `/tmp/ga_${width}_${slug.replace("/", "_")}.png` });
  }
  await ctx.close();
}
await b.close();
console.log(failures ? `AUDIT: ${failures} issue(s)` : "AUDIT: clean");
process.exit(0);
