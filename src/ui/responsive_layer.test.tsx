// Responsive layer (responsive workstream 2026-09-30, review A round 4): the
// navigation drawer's modal contract, the app dialog semantics, the phone
// single-pane Observe and the sheet/keyboard rules. Each test goes red when its
// fix is removed.
import React from "react";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Modal } from "./modal";
import { nav_drawer_attrs, nav_drawer_reducer, nav_trap_target } from "./nav_drawer";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const RCSS = read("./responsive.css");
const APP = read("./app.tsx");

/** The body of the first `@media <query> { ... }` block (brace-balanced). */
function media_block(css: string, query: string): string {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) throw new Error(`no @media ${query}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}

describe("navigation drawer (< 1024 px)", () => {
  it("closed drawer is inert and hidden from assistive tech; docked sidebar is neither", () => {
    expect(nav_drawer_attrs(true, false).aside).toMatchObject({ inert: "", "aria-hidden": "true" });
    expect(nav_drawer_attrs(true, false).aside.role).toBeUndefined();
    expect(nav_drawer_attrs(false, false).aside.inert).toBeUndefined();
    expect(nav_drawer_attrs(false, true).main.inert).toBeUndefined();
  });

  it("open drawer is a modal dialog and the rest of the shell is inert", () => {
    const a = nav_drawer_attrs(true, true);
    expect(a.aside).toMatchObject({ role: "dialog", "aria-modal": "true" });
    expect(a.aside.inert).toBeUndefined();
    expect(a.main).toMatchObject({ inert: "", "aria-hidden": "true" });
  });

  it("closes on page change and when the layout crosses 1024 px (resize-close)", () => {
    expect(nav_drawer_reducer(true, { type: "page_change" })).toBe(false);
    expect(nav_drawer_reducer(true, { type: "layout_change" })).toBe(false);
    expect(nav_drawer_reducer(false, { type: "open" })).toBe(true);
  });

  it("Escape closes it unless another handler took the key or another modal dialog is open", () => {
    expect(nav_drawer_reducer(true, { type: "escape", default_prevented: false, other_modal_open: false })).toBe(false);
    expect(nav_drawer_reducer(true, { type: "escape", default_prevented: true, other_modal_open: false })).toBe(true);
    expect(nav_drawer_reducer(true, { type: "escape", default_prevented: false, other_modal_open: true })).toBe(true);
  });

  it("Tab and Shift+Tab cycle inside the drawer (focus trap)", () => {
    expect(nav_trap_target(5, 4, false)).toBe(0); // last -> first
    expect(nav_trap_target(5, 0, true)).toBe(4); // first -> last
    expect(nav_trap_target(5, -1, false)).toBe(0); // focus outside -> first
    expect(nav_trap_target(5, -1, true)).toBe(4);
    expect(nav_trap_target(5, 2, false)).toBe(3); // always handled (WebKit skips buttons on Tab)
    expect(nav_trap_target(5, 2, true)).toBe(1);
    expect(nav_trap_target(0, -1, false)).toBe(-1);
  });

  it("the hook dispatches page_change / layout_change on page and 1024 px changes, and traps Tab", () => {
    const hook = read("./nav_drawer.ts");
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*dispatch\(\{ type: "page_change" \}\);\s*\}, \[opts\.page\]\);/);
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*dispatch\(\{ type: "layout_change" \}\);\s*\}, \[opts\.is_drawer\]\);/);
    expect(hook).toMatch(/if \(target >= 0\) \{\s*e\.preventDefault\(\);\s*items\[target\]\.focus\(\);/);
    expect(hook).toMatch(/default_prevented: e\.defaultPrevented, other_modal_open: other_modal_open\(/);
  });

  it("app.tsx wires the hook (page + 1024 px layout) and spreads its attributes", () => {
    expect(APP).toMatch(/use_nav_drawer\(\{\s*is_drawer:\s*nav_is_drawer,\s*page\s*\}\)/);
    expect(APP).toMatch(/const nav_is_drawer = useAfMedia\(AF_MEDIA\.md\)/);
    expect(APP).toMatch(/className="shell_sidebar"[\s\S]{0,200}\{\.\.\.nav\.attrs\.aside\}/);
    expect(APP).toMatch(/className="shell_main" \{\.\.\.nav\.attrs\.main\}/);
  });

  it("the closed drawer is off-canvas and invisible below 1024 px, visible when open", () => {
    const md = media_block(RCSS, "(max-width: 1023.98px)");
    expect(md).toMatch(/\.shell_sidebar\s*\{[^}]*position:\s*fixed;[^}]*transform:\s*translateX\(-105%\);[^}]*visibility:\s*hidden;/);
    expect(md).toMatch(/\.shell\.nav_open \.shell_sidebar\s*\{[^}]*transform:\s*none;[^}]*visibility:\s*visible;/);
  });
});

describe("single-pane Observe (< 768 px or < 500 px tall)", () => {
  it("hides the run list when a run is shown and the run when the list is shown", () => {
    const sm = media_block(RCSS, "(max-width: 767.98px), (max-height: 500px)");
    expect(sm).toMatch(/\.observatory_layout\.observe_pane_run \.observatory_sidebar,\s*\.observatory_layout\.observe_pane_runs \.observatory_main\s*\{\s*display:\s*none;/);
  });

  it("the layout class follows the phone query and the Runs back button exists only there", () => {
    expect(APP).toMatch(/const single_pane = useAfMedia\(`\$\{AF_MEDIA\.sm\}, \$\{AF_MEDIA\.short\}`\)/);
    expect(APP).toMatch(/observatory_layout observe_pane_\$\{single_pane \? observe_pane : "both"\}/);
    expect(APP).toMatch(/\{single_pane \? \(\s*<button type="button" className="btn observe_back_btn" onClick=\{\(\) => set_observe_pane\("runs"\)\}/);
  });
});

describe("app dialogs (Modal)", () => {
  it("are labelled modal dialogs", () => {
    const html = renderToStaticMarkup(
      <Modal open title="Approval required: write_file" onClose={() => {}} actions={<button>Dismiss</button>}>
        body
      </Modal>,
    );
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}">Approval required: write_file<`);
  });

  it("sheet footer is opaque, and the sheet sits above the on-screen keyboard", () => {
    expect(RCSS).toMatch(/\.modal_header,\s*\.modal_footer\s*\{\s*background:\s*color-mix\(in srgb, var\(--bg-primary\) 92%, var\(--pane-bg\)\);/);
    const sm = media_block(RCSS, "(max-width: 767.98px), (max-height: 500px)");
    expect(sm).toMatch(/\.modal_backdrop:not\(\.fullscreen\)\s*\{[^}]*padding:[^;]*var\(--keyboard-inset, 0px\);/);
    expect(sm).toMatch(/\.modal_panel:not\(\.fullscreen\)\s*\{[^}]*max-height:\s*calc\([^;]*- var\(--keyboard-inset, 0px\)/);
  });
});

describe("touch legibility", () => {
  it("reading surfaces use body size on coarse pointers", () => {
    const touch = media_block(RCSS, "(pointer: coarse)");
    expect(touch).toMatch(/\.observe_page \.lc_preview,\s*\.observe_page \.lc_body,\s*\.observe_page \.timeline_payload_grid p\s*\{\s*font-size:\s*var\(--font-size-body, 14px\);/);
    expect(touch).toMatch(/\.observe_viewer_full,\s*\.modal_body\s*\{[^}]*--t-small:\s*var\(--font-size-body, 14px\);/);
  });
});
