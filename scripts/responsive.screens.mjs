// Screens module for the shared responsive capture harness
// (untracked/responsive/harness/capture.mjs). Re-runnable check:
//
//   node <harness>/capture.mjs --app observer --url http://127.0.0.1:18786 \
//        --screens scripts/responsive.screens.mjs --out <dir> [--sweep] [--browser webkit]
//
// Needs a gateway the dev server can reach (the Code e2e fixture: user web-tester,
// token abstractcode-e2e-only, no model) and its URL in OBSERVER_E2E_GATEWAY_URL
// (default http://127.0.0.1:18785). The gateway must allow the dev server's origin.
// Each viewport is a fresh browser context: the first screen shows the sign-in
// dialog, the second signs in through the same endpoint the dialog posts to.

const GATEWAY_URL = process.env.OBSERVER_E2E_GATEWAY_URL || "http://127.0.0.1:18785";
const USER = process.env.OBSERVER_E2E_USER || "web-tester";
const TOKEN = process.env.OBSERVER_E2E_TOKEN || "abstractcode-e2e-only";
const WORKFLOW = "abstractcode-web-e2e:tool-approval";

async function signIn(page) {
  if (await page.locator(".shell_connection_label", { hasText: USER }).count()) return;
  const status = await page.evaluate(
    async ({ url, user, token }) => {
      const r = await fetch("/api/connection/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateway_url: url, gateway_user_id: user, gateway_token: token, persist: true }),
      });
      return r.status;
    },
    { url: GATEWAY_URL, user: USER, token: TOKEN },
  );
  if (status !== 200) throw new Error(`sign-in failed: HTTP ${status}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".shell_connection_label", { hasText: USER }).waitFor({ state: "attached", timeout: 15000 });
}

// Navigate through the sidebar (or the navigation drawer, when the sidebar is one).
async function nav(page, label) {
  const item = page.locator(".shell_nav_item", { hasText: label }).first();
  if (!(await item.isVisible())) {
    const toggle = page.locator("[data-nav-toggle]").first();
    if (await toggle.count()) {
      await toggle.click();
      await item.waitFor({ state: "visible", timeout: 5000 });
    }
  }
  await item.click();
  await page.waitForTimeout(300);
}

async function closeDialogs(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator("[role=dialog]:visible, .modal_backdrop:visible").count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

async function launchRun(page) {
  await openLaunch(page, "once");
  await page.getByRole("button", { name: "Launch now" }).click();
  await page.getByRole("button", { name: "Open ledger" }).waitFor({ timeout: 20000 });
}

async function openLaunch(page, mode) {
  await closeDialogs(page);
  await nav(page, "Launch");
  await page.locator(".launch_mode_switch").getByRole("radio", { name: mode === "automate" ? "Automate" : "Run once" }).click();
  await page.selectOption(".launch_workflow_select", WORKFLOW);
  await page.waitForTimeout(500);
}

export default {
  async setup(page) {
    await page.waitForSelector(".app-shell", { timeout: 20000 });
  },
  screens: [
    {
      name: "signin",
      async run(page) {
        await page.locator(".af-connect-modal").waitFor({ timeout: 15000 });
      },
    },
    {
      name: "launch",
      async run(page) {
        await signIn(page);
        await openLaunch(page, "once");
      },
    },
    {
      name: "automate",
      async run(page) {
        await openLaunch(page, "automate");
      },
      settle: 900,
    },
    {
      name: "approval",
      async run(page) {
        await launchRun(page);
      },
      settle: 900,
    },
    {
      name: "observe",
      async run(page) {
        // Self-sufficient for the resize sweep (fresh context, only this screen runs).
        await signIn(page);
        if (!(await page.getByRole("button", { name: "Open ledger" }).count())) await launchRun(page);
        // DOM click: on phones the modal's action row can sit below the fold (a finding, not a script bug).
        await page.getByRole("button", { name: "Open ledger" }).evaluate((b) => b.click());
        await page.waitForTimeout(800);
      },
      settle: 900,
    },
    {
      name: "board",
      async run(page) {
        await closeDialogs(page);
        await nav(page, "Board");
      },
      settle: 900,
    },
    {
      name: "system",
      async run(page) {
        await closeDialogs(page);
        await nav(page, "System");
      },
      settle: 1200,
    },
    {
      name: "system-memory",
      async run(page) {
        // System → Memory (the monitor-active-memory explorer).
        await page.locator(".runtime_mode_tab", { hasText: "Memory" }).click();
      },
      settle: 1500,
    },
    {
      name: "settings",
      async run(page) {
        await closeDialogs(page);
        await nav(page, "Settings");
      },
    },
    {
      name: "about",
      async run(page) {
        await closeDialogs(page);
        await page.locator(".af-topbar__btn--about").first().click();
        await page.locator("[role=dialog]").first().waitFor({ timeout: 5000 });
      },
    },
  ],
  sweepScreen: "observe",
};
