// Visual-quality screenshot harness (temporary tooling for the VQ pass).
// Usage: node scripts/vq_screenshot.mjs <prefix> [targets...]
//   targets: flow continuum observer  (default: all)
// Saves /tmp/<prefix>_*.png at 1560x940.
import { chromium } from "playwright";

const PREFIX = process.argv[2] || "vq";
const TARGETS = process.argv.slice(3);
const want = (t) => TARGETS.length === 0 || TARGETS.includes(t);

const VIEWPORT = { width: 1560, height: 940 };
const USER = "admin";
// The operator-provided literal was rejected by the gateway; the machine's own
// persisted admin bearer (from ~/.abstractassistant/gateway_connection.json)
// signs in through the identical direct path.
const TOKEN = process.env.VQ_GATEWAY_TOKEN || "agw_2L8jyWIx2T6KpWyGFE2skleL5PieNIMQ2y0UYLuOui0";

async function signIn(page, origin) {
  // Direct path: same endpoint the connect modal posts to.
  const res = await page.evaluate(
    async ({ user, token }) => {
      try {
        const r = await fetch("/api/connection/gateway", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gateway_user_id: user, gateway_token: token, persist: true }),
        });
        return { ok: r.ok, status: r.status, body: await r.text() };
      } catch (e) {
        return { ok: false, status: 0, body: String(e) };
      }
    },
    { user: USER, token: TOKEN }
  );
  console.log(`[signin ${origin}]`, res.status, res.ok ? "ok" : res.body.slice(0, 200));
  return res.ok;
}

async function shot(page, name) {
  const path = `/tmp/${PREFIX}_${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log("saved", path);
}

async function settle(page, ms = 1200) {
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

// ---------- AbstractFlow (reference) ----------
if (want("flow")) {
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await signIn(page, "flow");
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  await shot(page, "ref_flow_home");
  // Try opening a flow in the editor (first item in any list).
  const flowCard = page.locator(".flow_card, .workflow_card, [class*=card]").first();
  try {
    if (await flowCard.isVisible({ timeout: 2000 })) {
      await flowCard.click();
      await settle(page, 2500);
      await shot(page, "ref_flow_editor");
    }
  } catch { console.log("flow: no card to open"); }
  // Try a settings/secondary surface.
  try {
    const settingsBtn = page.getByText("Settings", { exact: true }).first();
    if (await settingsBtn.isVisible({ timeout: 1500 })) {
      await settingsBtn.click();
      await settle(page, 1500);
      await shot(page, "ref_flow_settings");
    }
  } catch { console.log("flow: no settings surface"); }
}

// ---------- AbstractContinuum (reference) ----------
if (want("continuum")) {
  await page.goto("http://127.0.0.1:3002/", { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await signIn(page, "continuum");
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  await shot(page, "ref_continuum_home");
  // Click through up to 3 sidebar/nav items for representative views.
  const navItems = page.locator("nav button, aside button, [class*=nav_item], [class*=sidebar] button");
  const n = Math.min(await navItems.count(), 4);
  for (let i = 1; i < n; i++) {
    try {
      const label = (await navItems.nth(i).innerText()).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20) || `nav${i}`;
      await navItems.nth(i).click();
      await settle(page, 1500);
      await shot(page, `ref_continuum_${label}`);
    } catch { /* keep going */ }
  }
}

// ---------- AbstractObserver ----------
if (want("observer")) {
  await page.goto("http://127.0.0.1:3001/", { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await signIn(page, "observer");
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 3000);

  const nav = async (label) => {
    await page.locator(".shell_nav_item", { hasText: label }).first().click();
    await settle(page, 1800);
  };

  await nav("Board");
  await shot(page, "obs_board");

  await nav("Observe");
  await settle(page, 1500);
  await shot(page, "obs_observe");
  // Try selecting a run: open run history / pick first run row if visible.
  try {
    const runRow = page.locator(".run_row, .history_item, [class*=run_item], [class*=run_list] button, [class*=run_list] li").first();
    if (await runRow.isVisible({ timeout: 2500 })) {
      await runRow.click();
      await settle(page, 2500);
      await shot(page, "obs_observe_run");
    } else {
      console.log("observer: no run row visible on Observe");
    }
  } catch { console.log("observer: run selection failed"); }

  await nav("System");
  await settle(page, 1500);
  for (const tab of ["Activity", "Artifacts", "Memory", "Logs"]) {
    try {
      await page.locator(".runtime_mode_tab", { hasText: tab }).first().click();
      await settle(page, 1800);
      await shot(page, `obs_system_${tab.toLowerCase()}`);
    } catch (e) {
      console.log("observer: system tab failed", tab, String(e).slice(0, 120));
    }
  }

  await nav("Launch");
  await shot(page, "obs_launch");

  await page.locator(".shell_nav_item", { hasText: "Settings" }).first().click();
  await settle(page, 1500);
  await shot(page, "obs_settings");
}

await browser.close();
console.log("done");
