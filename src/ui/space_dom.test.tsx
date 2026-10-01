// One page scroll on phones, measured in a real browser (DESIGN §12). The list +
// detail screens are rendered from the real components (Automations, the
// Observe run list + run view, System → Activity, the Board) inside the app
// shell, styled by the CSS the app ships (a fresh `vite build` of this repo),
// laid out by Chromium at 390 x 844 on a touch profile. Any scrollable
// descendant of the page fails the test, whichever rule re-introduces it: the
// check reads the rendered DOM, not the stylesheet text. A second test proves
// the probe sees an inner scroll when one is added.
//
// Needs the Playwright Chromium (`npx playwright install chromium`; CI installs it).
import React from "react";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build } from "vite";

import { AfSwitch, type AutomationSummary } from "@abstractframework/ui-kit";

import { GatewayClient } from "../lib/gateway_client";
import { INITIAL_AUTOMATIONS_STATE } from "./automations";
import { AutomationsPage, type AutomationsHandlers } from "./automations_page";
import { MissionControlPage } from "./mission_control";
import { WorkflowRunNavigator } from "./run_panels";
import { RuntimeActivityConsole } from "./runtime_page";
import type { RunSummary } from "./run_status";
import { DEFAULT_RUN_VIEW_STATE, build_run_steps } from "./run_steps";
import { RunStepsView, StepCard } from "./run_steps_view";

const ROOT = resolve(__dirname, "../..");
const noop = () => {};
const h = new Proxy({}, { get: () => noop }) as unknown as AutomationsHandlers;
const LONG = "Every 8 hours, check the memory monitor and write a short report about what changed since the last run, listing the biggest processes and any model that stayed loaded.";

function summary(i: number): AutomationSummary {
  return {
    automation_id: `a${i}`,
    title: `${LONG} (${i})`,
    status: "active",
    trigger: { binding_id: "b", source_id: "schedule", source_version: 1, config: { every: "8h" } },
    context_mode: "independent",
    workspace_root: `/home/ubuntu/.local/share/abstractgateway/workspaces/session-automation-a${i}-9cb27afb-f6c3-59dd-9c1b-b29ed`,
    current_occurrence: null,
    occurrence_count: 12,
    attention: { pending_waits: 0, unread: false, unseen_count: 0, cursor: "att1:0", items: [], waits: [] },
    legacy: false,
    revision: 1,
    updated_at: "2026-09-28T00:00:00Z",
    capabilities: ["revise", "pause", "resume", "run_now", "stop_current", "archive", "discuss"],
    session_kind: "automation",
  } as AutomationSummary;
}

function occurrence(i: number) {
  return {
    run_id: `r${i}`, index: i, attempts: 1, fired_at: "2026-09-28T00:00:00Z", finished_at: "2026-09-28T00:01:00Z", status: "completed",
    trigger: { source_id: "schedule", summary: "every 8 hours" }, user_turn: LONG, answer: `${LONG} ${LONG}`, notify: null, artifacts: [], waits: [], ledger_url: "/l",
  };
}

function run(i: number, status: string): RunSummary {
  return { run_id: `run-${i}-2871a8d5-89d9-4712-a066`, workflow_id: "abstractcode-web-e2e:tool-approval", status, created_at: "2026-09-30T18:00:00Z", updated_at: "2026-09-30T18:01:00Z", session_id: `s${i % 3}` } as RunSummary;
}

const RUNS = Array.from({ length: 24 }, (_, i) => run(i, i % 4 === 0 ? "waiting" : i % 4 === 1 ? "running" : "completed"));

/** The app shell around one page (the same classes app.tsx renders). */
const shell = (page: string) => `<div id="root"><div class="app-shell shell"><div class="shell_main"><div class="app-body shell_content">${page}</div></div></div></div>`;

function screens(): Record<string, string> {
  const items = Array.from({ length: 12 }, (_, i) => summary(i));
  const ctl = {
    state: { ...INITIAL_AUTOMATIONS_STATE, loaded: true, items, selected_id: "a0", detail: { automation_id: "a0", summary: items[0], occurrences: Array.from({ length: 8 }, (_, i) => occurrence(i + 1)), next_cursor: null } },
    subscribe: () => () => {},
    refresh: async () => {},
  } as any;
  const gw = new GatewayClient({ base_url: "", auth_token: "" });
  const automations = renderToStaticMarkup(
    <AutomationsPage ctl={ctl} gateway={gw} active={false} available={{ available: true, reason: "" }} host={{ on_open_run: noop, on_open_session: noop }} h={h} />,
  );
  const nav = renderToStaticMarkup(
    <WorkflowRunNavigator
      sections={[{ key: "all", label: "All", rows: RUNS.map((r) => ({ run: r, children: [] })) }] as any}
      selected_run_id={RUNS[0].run_id}
      root_run_id=""
      search=""
      filter="all"
      group_by="status"
      loading={false}
      connected
      on_sign_in={noop}
      total_runs={RUNS.length}
      workflow_label_by_id={{}}
      automation_titles={{}}
      on_search={noop}
      on_filter={noop}
      on_group_by={noop}
      on_refresh={noop}
      on_select={noop}
      list={{ open: true, on_toggle: noop }}
    />,
  );
  // The run view's containers, with the class names app.tsx renders (asserted below).
  // The REAL run view over a recorded ledger: the step list with every step, plus expanded LLM/tool cards.
  const fix = JSON.parse(readFileSync(resolve(__dirname, "__fixtures__", "runview_agent_ledger.json"), "utf8"));
  const ledger = (fix.child as any[]).map((record, i) => ({ run_id: fix.child_run_id, cursor: i + 1, record }));
  const run_steps = build_run_steps(ledger, fix.child_run_id);
  const steps =
    renderToStaticMarkup(
      <RunStepsView items={ledger} run_id={fix.child_run_id} run_options={[fix.child_run_id]} run_llm_counts={{}} on_select_run={noop} state={{ ...DEFAULT_RUN_VIEW_STATE, all_steps: true }} on_state={noop} node_label={(_r, n) => n} on_copy={noop} />,
    ) + run_steps.filter((x) => x.kind !== "event").map((x) => renderToStaticMarkup(<StepCard step={x} node_label={x.node_id} open on_toggle={noop} on_copy={noop} />)).join("");
  const observe = `<div class="page observe_page"><div class="observatory_layout">${nav}<div class="observatory_main"><div class="observe_toolbar"><div class="observe_toolbar_row">run</div></div><div class="card panel_card card_scroll observe_viewer observe_viewer_full"><div class="rs_page">${steps}</div></div></div></div></div>`;
  const system = `<div class="page runtime_page">${renderToStaticMarkup(
    <RuntimeActivityConsole
      gateway_connected
      runs={RUNS}
      artifacts={[]}
      selected_run_id={RUNS[0].run_id}
      workflow_label_by_id={{}}
      on_select_run={noop}
      on_open_run={noop}
      on_open_ledger={noop}
      on_filter_artifacts={noop}
      on_filter_session_artifacts={noop}
      on_open_logs={noop}
      on_refresh_runs={noop}
      on_reconnect={noop}
    />,
  )}</div>`;
  const board = renderToStaticMarkup(
    <MissionControlPage
      gateway_connected
      runs={RUNS}
      all_runs={RUNS}
      runs_refreshed_at={Date.now()}
      entities={[]}
      entities_total={0}
      entities_error=""
      refreshing={false}
      on_refresh={noop}
      on_open_run={noop}
      on_resume_wait={async () => {}}
      on_open_automation={noop}
      entity_app_href=""
    />,
  );
  // Launch → Automate's shape: a tall form card on a scrolling page, a kit switch
  // whose unavailable reason is visually hidden (absolutely positioned) near the bottom.
  const fields = Array.from({ length: 14 }, (_, i) => `<label class="launch_label">Field ${i}</label><div class="help_text">${LONG}</div>`).join("");
  const sw = renderToStaticMarkup(<AfSwitch label="Email me the result" checked={false} onChange={noop} unavailableReason="Connect a mailbox first." reasonVisible={false} variant="row" />);
  const launch = `<div class="page page_scroll"><div class="page_inner constrained"><div class="card"><div class="form_stack automate_fields">${fields}<fieldset><legend>Email</legend>${sw}</fieldset></div></div></div></div>`;
  return { automations, observe, system, board, launch };
}

/** In-page probe: the page scroller and every scrollable element inside it. */
const PROBE = () => {
  const page = document.querySelector(".page") as HTMLElement;
  const scrollable = (el: Element) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.tagName !== "TEXTAREA";
  };
  const inner = Array.from(page.querySelectorAll("*"))
    .filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed")
    .filter(scrollable)
    .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).trim().replace(/\s+/g, ".")} ${el.clientHeight}/${el.scrollHeight}`);
  return { page_scrolls: scrollable(page), doc_scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1, inner };
};

let browser: Browser;
let css = "";
let outDir = "";

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "observer-space-css-"));
  await build({ root: ROOT, configFile: resolve(ROOT, "vite.config.ts"), logLevel: "silent", build: { outDir, emptyOutDir: true, sourcemap: false, write: true } });
  const assets = join(outDir, "assets");
  css = readdirSync(assets).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

async function measure(markup: string, extra_css = "") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html class="theme-dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>${extra_css}</style></head><body>${shell(markup)}</body></html>`);
  const r = await page.evaluate(PROBE);
  await ctx.close();
  return r;
}

describe("phones (390 px): one page scroll on every list + detail screen (rendered DOM)", () => {
  it("the run view skeleton uses the class names app.tsx renders", () => {
    const app = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    expect(app).toContain('className="card panel_card card_scroll observe_viewer observe_viewer_full"');
    expect(app).toContain('<div className="rs_page">');
    expect(app).toContain('<div className="page observe_page">');
  });

  for (const name of ["automations", "observe", "system", "board", "launch"]) {
    it(`${name}: the page scrolls, nothing scrolls inside it, the document does not scroll under it`, async () => {
      const r = await measure(screens()[name]);
      expect(r.page_scrolls, "content must be taller than the screen for the check to mean anything").toBe(true);
      expect(r.inner).toEqual([]);
      expect(r.doc_scrolls).toBe(false);
    }, 60_000);
  }

  it("the probe catches an inner scroll re-introduced by a new rule that wins the cascade", async () => {
    const r = await measure(screens().automations, ".page.auto_page .auto_list .pane_body.scroll { max-height: 160px; overflow-y: auto; }");
    expect(r.inner.some((s) => s.startsWith("div.pane_body"))).toBe(true);
    const r2 = await measure(screens().board, ".mc_page .mc_column .mc_column_cards { max-height: 120px; overflow: auto; }");
    expect(r2.inner.length).toBeGreaterThan(0);
  }, 60_000);
});
