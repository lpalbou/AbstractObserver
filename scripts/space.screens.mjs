// Screens module for the shared responsive capture harness — the list + detail
// screens of DESIGN §12 ("Space on phones and tablets"), each with an item
// selected. Re-runnable check (the harness adds the space metrics text% /
// scroll / pad to every capture):
//
//   node <harness>/capture.mjs --app observer --url http://127.0.0.1:18786 \
//        --screens scripts/space.screens.mjs --out <dir> --viewports iphone-15pro,ipad,mbp-14 [--scheme light]
//
// Needs the Code e2e gateway fixture (user web-tester, token
// abstractcode-e2e-only, no model) at OBSERVER_E2E_GATEWAY_URL (default
// http://127.0.0.1:18785) allowing the dev server's origin. SPACE_THEME=light
// switches the app's own theme setting (the app ignores prefers-color-scheme).
//
// The Automations screen also drives the list disclosure with the keyboard
// (Enter closes, Space reopens) and fails the capture if aria-expanded does not
// follow.

const GATEWAY_URL = process.env.OBSERVER_E2E_GATEWAY_URL || "http://127.0.0.1:18785";
const USER = process.env.OBSERVER_E2E_USER || "web-tester";
const TOKEN = process.env.OBSERVER_E2E_TOKEN || "abstractcode-e2e-only";
const THEME = process.env.SPACE_THEME || "dark";
const WORKFLOW = "abstractcode-web-e2e:tool-approval";
const TASK =
  "Every 8 hours, check the memory monitor and write a short report about what changed since the last run, listing the biggest processes and any model that stayed loaded.";

async function signIn(page) {
  if (await page.locator(".shell_connection_label", { hasText: USER }).count()) return;
  const status = await page.evaluate(
    async ({ url, user, token }) =>
      (
        await fetch("/api/connection/gateway", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gateway_url: url, gateway_user_id: user, gateway_token: token, persist: true }),
        })
      ).status,
    { url: GATEWAY_URL, user: USER, token: TOKEN },
  );
  if (status !== 200) throw new Error(`sign-in failed: HTTP ${status}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".shell_connection_label", { hasText: USER }).waitFor({ state: "attached", timeout: 15000 });
}

async function nav(page, label) {
  await closeDialogs(page);
  const item = page.locator(".shell_nav_item", { hasText: label }).first();
  if (!(await item.isVisible())) {
    const t = page.locator("[data-nav-toggle]").first();
    if (await t.count()) {
      await t.click();
      await item.waitFor({ state: "visible", timeout: 5000 });
    }
  }
  await item.click();
  await page.waitForTimeout(400);
}

async function closeDialogs(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator("[role=dialog]:visible, .modal_backdrop:visible").count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

async function ensureAutomation(page) {
  await nav(page, "Automations");
  await page.waitForTimeout(800);
  if (await page.locator(".auto_row").count()) return;
  await nav(page, "Launch");
  await page.locator(".launch_mode_switch").getByRole("radio", { name: "Automate" }).click();
  await page.selectOption(".launch_workflow_select", WORKFLOW);
  await page.getByPlaceholder("What do you want the workflow/agent to do?").fill(TASK);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Create automation" }).click();
  await page.locator(".auto_row").first().waitFor({ timeout: 20000 });
}

/** A run waiting on a tool approval (Observe, Board Review, System activity). */
async function ensureWaitingRun(page) {
  await nav(page, "Board");
  await page.waitForTimeout(1200);
  if (await page.locator(".mc_column_review .mc_card").count()) return;
  await nav(page, "Launch");
  await page.locator(".launch_mode_switch").getByRole("radio", { name: "Run once" }).click();
  await page.selectOption(".launch_workflow_select", WORKFLOW);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Launch now" }).click();
  await page.getByRole("button", { name: "Open ledger" }).waitFor({ timeout: 20000 });
  await closeDialogs(page);
}

/** Opens a list panel that a previous screen (or the viewer) collapsed. */
async function openList(page, scope) {
  const btn = page.locator(`${scope} .list_disclosure`).first();
  if ((await btn.count()) && (await btn.getAttribute("aria-expanded")) === "false") await btn.click();
}

async function keyboardDisclosureCheck(page) {
  const btn = page.locator(".auto_list .list_disclosure").first();
  if (!(await btn.count())) return; // 0.4.0 (before) has no disclosure
  if ((await btn.getAttribute("aria-expanded")) !== "true") throw new Error("list disclosure is not open by default");
  await btn.focus();
  await page.keyboard.press("Enter");
  if ((await btn.getAttribute("aria-expanded")) !== "false") throw new Error("Enter did not collapse the list");
  if (await page.locator(".auto_list .auto_rows").isVisible()) throw new Error("collapsed list still shows its rows");
  await page.keyboard.press(" ");
  if ((await btn.getAttribute("aria-expanded")) !== "true") throw new Error("Space did not reopen the list");
}

export default {
  async setup(page) {
    await page.waitForSelector(".app-shell", { timeout: 20000 });
    await page.evaluate((theme) => {
      try {
        const k = "af_appearance_abstractobserver_v1";
        const cur = JSON.parse(localStorage.getItem(k) || "{}");
        localStorage.setItem(k, JSON.stringify({ ...cur, theme }));
      } catch {}
    }, THEME);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 20000 });
    await signIn(page);
  },
  screens: [
    {
      // The operator's case (DESIGN §12): list + the selected automation's detail.
      name: "automations-detail",
      async run(page) {
        await signIn(page);
        await ensureAutomation(page);
        await nav(page, "Automations");
        await openList(page, ".auto_list");
        await page.locator(".auto_row_main").first().click();
        await page.waitForTimeout(600);
        if ((await page.locator(".af-auto-occ").count()) < 2) {
          const run = page.getByRole("button", { name: "Run now" }).first();
          if (await run.count()) {
            await run.click().catch(() => {});
            await page.waitForTimeout(2500);
          }
        }
        await page.locator(".auto_row_main").first().click();
        await page.waitForTimeout(1200);
        await keyboardDisclosureCheck(page);
      },
      settle: 1200,
    },
    {
      // The same automation with the list collapsed and an occurrence's
      // transcript + details open (the reading surface of §12).
      name: "automations-occurrence",
      async run(page) {
        await nav(page, "Automations");
        await openList(page, ".auto_list");
        await page.locator(".auto_row_main").first().click();
        await page.waitForTimeout(800);
        const btn = page.locator(".auto_list .list_disclosure").first();
        if (await btn.count()) await btn.click();
        const details = page.locator(".af-auto-occ__details > summary").first();
        if (await details.count()) {
          await details.click();
          await details.scrollIntoViewIfNeeded();
        } else {
          await page.locator(".af-auto-occ").first().scrollIntoViewIfNeeded();
        }
        await page.waitForTimeout(600);
      },
      settle: 1000,
    },
    {
      // Observe: the run list + the selected run (ledger tab).
      name: "observe-run",
      async run(page) {
        await openList(page, ".auto_list");
        await ensureWaitingRun(page);
        await nav(page, "Observe");
        const back = page.locator(".observe_back_btn");
        if (await back.isVisible().catch(() => false)) await back.click();
        await openList(page, ".observatory_sidebar");
        await page.locator(".run_tree_item").first().click();
        await page.waitForTimeout(900);
        // Selecting a waiting run opens its approval sheet: dismiss it to read the run.
        await page.waitForTimeout(600);
        await closeDialogs(page);
        const ledger = page.getByRole("tab", { name: /ledger/i }).first();
        if (await ledger.count()) await ledger.click().catch(() => {});
        await page.waitForTimeout(600);
      },
      settle: 1200,
    },
    {
      // Observe grouped by session (the Sessions view of the run list).
      name: "observe-sessions",
      async run(page) {
        await nav(page, "Observe");
        const back = page.locator(".observe_back_btn");
        if (await back.isVisible().catch(() => false)) await back.click();
        await openList(page, ".observatory_sidebar");
        await page.locator(".run_nav_filter_row .seg_select").selectOption("session");
        await page.locator(".run_nav_segments .seg_btn", { hasText: "all" }).click();
        await page.waitForTimeout(600);
        await page.locator(".run_tree_item").first().click();
        await page.waitForTimeout(900);
        await closeDialogs(page);
        // Phones stack the list above the run: bring the session groups into view.
        await page.locator(".observatory_sidebar").evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(400);
      },
      settle: 900,
    },
    {
      // Board: the Review column carries the tool approval (Approve / Reject).
      name: "board-approvals",
      async run(page) {
        await nav(page, "Board");
        await page.waitForTimeout(800);
        const review = page.locator(".mc_card", { hasText: /approv/i }).first();
        if (await review.count()) await review.scrollIntoViewIfNeeded();
      },
      settle: 1200,
    },
    {
      // System → Activity: queues + runs list + the run inspector of the selected run.
      name: "system-activity",
      async run(page) {
        await nav(page, "System");
        await page.locator(".runtime_mode_tab", { hasText: "Activity" }).click();
        await page.waitForTimeout(600);
        await openList(page, ".runtime_ops_table_panel");
        const all = page.locator(".runtime_ops_filter", { hasText: "All loaded" }).first();
        if (await all.count()) await all.click();
        const row = page.locator(".runtime_ops_row").first();
        if (await row.count()) await row.click();
        await page.waitForTimeout(600);
      },
      settle: 1000,
    },
    {
      // System → Memory (the monitor-active-memory explorer).
      name: "system-memory",
      async run(page) {
        await nav(page, "System");
        await page.locator(".runtime_mode_tab", { hasText: "Memory" }).click();
      },
      settle: 1500,
      // The graph canvas is a documented exception (DESIGN §12: a canvas, a graph).
      spaceIgnore: [".react-flow", ".amx-graph"],
    },
    {
      // Launch → Run once (a form page; §12 applies to its card too).
      name: "launch-once",
      async run(page) {
        await nav(page, "Launch");
        await page.locator(".launch_mode_switch").getByRole("radio", { name: "Run once" }).click();
        await page.selectOption(".launch_workflow_select", WORKFLOW);
        await page.waitForTimeout(500);
      },
      settle: 900,
    },
    {
      // Launch → Automate, with the task filled in.
      name: "launch-automate",
      async run(page) {
        await nav(page, "Launch");
        await page.locator(".launch_mode_switch").getByRole("radio", { name: "Automate" }).click();
        await page.selectOption(".launch_workflow_select", WORKFLOW);
        await page.getByPlaceholder("What do you want the workflow/agent to do?").fill(TASK);
        await page.waitForTimeout(500);
      },
      settle: 900,
    },
  ],
  sweepScreen: "automations-detail",
};
