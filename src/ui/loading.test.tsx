import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LoadingState, loading_sentence } from "./loading";

describe("LoadingState — the one 'please wait' (operator 2026-10-15)", () => {
  it("renders a live status with a spinner and 'Loading <what>…'", () => {
    const html = renderToStaticMarkup(<LoadingState what="automations" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading automations…");
    expect(html).toContain('class="af_loading_spin"');
    expect(html).toContain("<svg");
  });
  it("block size centres in an empty pane; a label overrides the sentence", () => {
    expect(renderToStaticMarkup(<LoadingState what="runs" size="block" />)).toContain("af_loading_block");
    expect(loading_sentence("runs", "Reading the ledger…")).toBe("Reading the ledger…");
    expect(loading_sentence("")).toBe("Loading data…");
  });
  it("the spin stops under prefers-reduced-motion (styles.css)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const i = css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".af_loading_spin"));
    expect(i).toBeGreaterThan(0);
    expect(css.slice(i, i + 200)).toMatch(/\.af_loading_spin\s*\{\s*animation:\s*none/);
  });
});
