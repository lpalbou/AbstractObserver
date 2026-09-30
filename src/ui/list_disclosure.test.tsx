// Collapsible list panels + phone space (DESIGN §12). Each test goes red when
// its part of the fix is removed (the disclosure's semantics, the remembered
// state, the wiring on every list + detail screen, the one-scroll phone CSS).
import React from "react";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayClient } from "../lib/gateway_client";
import { INITIAL_AUTOMATIONS_STATE } from "./automations";
import { AutomationsListView, AutomationsPage, type AutomationsHandlers } from "./automations_page";
import { ListDisclosure, list_open_key, read_list_open, write_list_open } from "./list_disclosure";
import { WorkflowRunNavigator } from "./run_panels";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const noop = () => {};
const h = new Proxy({}, { get: () => noop }) as unknown as AutomationsHandlers;

/** A Storage stand-in (Map-backed) or one whose every access throws. */
function memory_storage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}
const throwing_storage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

/** The first element with attribute `attr` in `html` (its whole start tag). */
function tag_with(html: string, attr: string): string {
  const m = new RegExp(`<[a-z]+[^>]*${attr}[^>]*>`).exec(html);
  if (!m) throw new Error(`no element with ${attr}`);
  return m[0];
}

afterEach(() => vi.unstubAllGlobals());

describe("list disclosure state (remembered per viewer)", () => {
  it("is open by default: nothing stored, no storage, or storage that throws", () => {
    expect(read_list_open("automations", memory_storage())).toBe(true);
    expect(read_list_open("automations", null)).toBe(true);
    expect(read_list_open("automations", throwing_storage)).toBe(true);
  });

  it("remembers a closed list and reopens it, under a per-list key", () => {
    const s = memory_storage();
    write_list_open("automations", false, s);
    expect(s.map.get(list_open_key("automations"))).toBe("0");
    expect(read_list_open("automations", s)).toBe(false);
    expect(read_list_open("observe_runs", s)).toBe(true);
    write_list_open("automations", true, s);
    expect(read_list_open("automations", s)).toBe(true);
  });

  it("never throws when storage is blocked or full", () => {
    expect(() => write_list_open("automations", false, throwing_storage)).not.toThrow();
  });
});

describe("the disclosure header", () => {
  it("is a native, focusable button (Enter and Space toggle it) with aria-expanded and aria-controls", () => {
    const html = renderToStaticMarkup(<ListDisclosure open on_toggle={noop} controls="auto_list_body" title="Automations" count={3} />);
    const btn = tag_with(html, 'aria-controls="auto_list_body"');
    expect(btn).toMatch(/^<button /);
    expect(btn).toContain('type="button"');
    expect(btn).toContain('aria-expanded="true"');
    expect(btn).not.toMatch(/tabindex="-1"|disabled/);
    expect(html).toContain(">Automations<");
    expect(html).toContain(">3<");
  });

  it("says collapsed when closed", () => {
    const html = renderToStaticMarkup(<ListDisclosure open={false} on_toggle={noop} controls="x" title="Runs" />);
    expect(tag_with(html, 'aria-controls="x"')).toContain('aria-expanded="false"');
  });
});

describe("Automations list", () => {
  it("open: the rows are shown under the disclosure header", () => {
    const html = renderToStaticMarkup(
      <AutomationsListView state={INITIAL_AUTOMATIONS_STATE} available={{ available: true, reason: "" }} h={h} list={{ open: true, on_toggle: noop }} />,
    );
    expect(tag_with(html, 'aria-controls="auto_list_body"')).toContain('aria-expanded="true"');
    expect(tag_with(html, 'id="auto_list_body"')).not.toContain("hidden");
  });

  it("closed: the header stays, the body is hidden and the panel is marked collapsed", () => {
    const html = renderToStaticMarkup(
      <AutomationsListView state={INITIAL_AUTOMATIONS_STATE} available={{ available: true, reason: "" }} h={h} list={{ open: false, on_toggle: noop }} />,
    );
    expect(tag_with(html, 'aria-controls="auto_list_body"')).toContain('aria-expanded="false"');
    expect(tag_with(html, 'id="auto_list_body"')).toContain('hidden=""');
    expect(html).toMatch(/class="pane auto_list list_collapsed"/);
    expect(html).toContain('data-action="new"');
  });

  it("the page reads the viewer's remembered state (open by default, closed when stored)", () => {
    const ctl = { state: INITIAL_AUTOMATIONS_STATE, subscribe: () => () => {}, refresh: async () => {} } as any;
    const gw = new GatewayClient({ base_url: "", auth_token: "" });
    const page = () =>
      renderToStaticMarkup(
        <AutomationsPage ctl={ctl} gateway={gw} active={false} available={{ available: true, reason: "" }} host={{ on_open_run: noop, on_open_session: noop }} h={h} />,
      );
    vi.stubGlobal("localStorage", memory_storage());
    expect(tag_with(page(), 'aria-controls="auto_list_body"')).toContain('aria-expanded="true"');
    vi.stubGlobal("localStorage", memory_storage({ [list_open_key("automations")]: "0" }));
    const closed = page();
    expect(tag_with(closed, 'aria-controls="auto_list_body"')).toContain('aria-expanded="false"');
    expect(closed).toMatch(/class="page auto_page list_collapsed"/);
  });
});

describe("Observe run list", () => {
  const nav = (open: boolean) =>
    renderToStaticMarkup(
      <WorkflowRunNavigator
        sections={[]}
        selected_run_id=""
        root_run_id=""
        search=""
        filter="all"
        group_by="session"
        loading={false}
        connected
        on_sign_in={noop}
        total_runs={0}
        workflow_label_by_id={{}}
        automation_titles={{}}
        on_search={noop}
        on_filter={noop}
        on_group_by={noop}
        on_refresh={noop}
        on_select={noop}
        list={{ open, on_toggle: noop }}
      />,
    );

  it("has the disclosure; closed hides the filters and the tree, keeps the header", () => {
    expect(tag_with(nav(true), 'aria-controls="run_nav_controls run_nav_tree"')).toContain('aria-expanded="true"');
    const closed = nav(false);
    expect(tag_with(closed, 'aria-controls="run_nav_controls run_nav_tree"')).toContain('aria-expanded="false"');
    expect(tag_with(closed, 'id="run_nav_controls"')).toContain('hidden=""');
    expect(tag_with(closed, 'id="run_nav_tree"')).toContain('hidden=""');
  });
});

describe("wiring on every list + detail screen", () => {
  it("each list remembers its own state", () => {
    expect(read("./automations_page.tsx")).toMatch(/useListOpen\("automations"\)/);
    expect(read("./app.tsx")).toMatch(/useListOpen\("observe_runs"\)/);
    expect(read("./app.tsx")).toMatch(/list=\{\{ open: observe_list_open, on_toggle: toggle_observe_list \}\}/);
    const rt = read("./runtime_page.tsx");
    expect(rt).toMatch(/useListOpen\("system_queues"\)/);
    expect(rt).toMatch(/useListOpen\("system_runs"\)/);
    expect(rt).toMatch(/id="runtime_ops_runs" hidden=\{!runs_open\}/);
    expect(read("./mission_control.tsx")).toMatch(/useListOpen\(`board_\$\{props\.col\}`\)/);
  });
});

describe("phone space CSS (space.css)", () => {
  const CSS = read("./space.css");
  /** The body of the first `@media <query> { ... }` block (brace-balanced). */
  function media_block(query: string): string {
    const start = CSS.indexOf(`@media ${query} {`);
    if (start < 0) throw new Error(`no @media ${query}`);
    let depth = 0;
    for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) return CSS.slice(start, i + 1);
    }
    throw new Error("unbalanced");
  }

  it("is loaded after the responsive layer", () => {
    const main = read("../main.tsx");
    expect(main.indexOf('import "./ui/space.css"')).toBeGreaterThan(main.indexOf('import "./ui/responsive.css"'));
  });

  it("a collapsed panel hides its body even where a rule sets display", () => {
    expect(CSS).toMatch(/\.list_collapsed \[hidden\]\s*\{\s*display:\s*none !important;/);
  });

  it("below 1024 px: one page scroll (the list and the detail do not scroll inside it), the page owns the gutter", () => {
    const md = media_block("(max-width: 1023.98px)");
    expect(md).toMatch(/\.app-body\.shell_content\s*\{\s*padding:\s*0;/);
    expect(md).toMatch(/\.page\.auto_page \.pane_body\.scroll,\s*\.page\.auto_page \.auto_detail,[^{]*\{\s*overflow:\s*visible;\s*max-height:\s*none;/);
    expect(md).toMatch(/\.page\.auto_page > \.pane\s*\{\s*flex:\s*0 0 auto;/);
  });

  it("below 1024 px: panes and automation cards are flat sections with hairlines", () => {
    const md = media_block("(max-width: 1023.98px)");
    expect(md).toMatch(/\.page\.auto_page > \.pane,[^{]*\{\s*background:\s*none;\s*border:\s*0;/);
    expect(md).toMatch(/\.auto_row\s*\{\s*padding:\s*10px 0;\s*border:\s*0;/);
    expect(md).toMatch(/\.auto_detail \.af-auto-occ\s*\{\s*padding:\s*12px 0;\s*border:\s*0;/);
    expect(md).toMatch(/\.auto_detail \.pc-chat-item,\s*\.auto_discussion \.pc-chat-item\s*\{\s*padding:\s*0;\s*border:\s*0;/);
    expect(md).toMatch(/\.auto_detail \.af-auto__facts\s*\{\s*grid-template-columns:\s*max-content minmax\(0, 1fr\);/);
    expect(md).toMatch(/\.auto_detail \.af-auto__path\s*\{[^}]*border:\s*0;[^}]*background:\s*none;/);
  });

  it("phones: the Observe rail, the ledger and the Board columns do not scroll inside the page", () => {
    const sm = media_block("(max-width: 767.98px)");
    expect(sm).toMatch(/\.observe_page \.observatory_sidebar\.pane\s*\{[^}]*overflow:\s*visible;/);
    expect(sm).toMatch(/\.observe_page \.run_tree\s*\{\s*overflow:\s*visible;/);
    expect(sm).toMatch(/\.observe_page \.observe_viewer_full \.log_scroll,[^{]*\{\s*overflow:\s*visible;/);
    expect(sm).toMatch(/\.mc_page \.mc_column_cards\s*\{\s*max-height:\s*none;\s*overflow:\s*visible;/);
  });

  it("desktop floor (DESIGN §12.1): dense text 12 px, prose/labels 13 px; touch tablets raise the memory explorer's help text", () => {
    expect(CSS).toMatch(/:root\s*\{\s*--t-micro:\s*calc\(12px \* var\(--font-scale, 1\)\);\s*--t-small:\s*calc\(13px \* var\(--font-scale, 1\)\);\s*--font-size-xxs:\s*calc\(11px[^;]*;\s*--font-size-xs:\s*calc\(12px[^;]*;\s*--font-size-sm:\s*calc\(13px/);
    expect(media_block("(max-width: 767.98px), (pointer: coarse)")).toMatch(/\.runtime_memory_panel \.amx-small\s*\{\s*font-size:\s*var\(--font-size-body, 14px\);/);
  });

  it("tablets: Observe keeps two columns only with ~360 px each", () => {
    expect(media_block("(min-width: 768px) and (max-width: 1023.98px)")).toMatch(/grid-template-columns:\s*minmax\(340px, 42%\) minmax\(360px, 1fr\);/);
  });
});
