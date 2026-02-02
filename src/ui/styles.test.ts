import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AbstractObserver styles", () => {
  it("includes a mobile-safe header/nav layout (no overlapping tabs)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.nav_tab\s*\{[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.app-header\s*\{[\s\S]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.app_nav\s*\{[\s\S]*flex-wrap:\s*wrap;/);
  });

  it("includes a mobile-friendly Backlog layout (scrollable tabs, edge-mounted advisor)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.backlog_tabs\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.backlog_tabs\s*\{[^}]*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.advisor_toggle\s*\{[\s\S]*top:\s*50%;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.advisor_toggle_label\s*\{[\s\S]*writing-mode:\s*vertical-rl;/);
    expect(css).toMatch(/\.inbox_sidebar,\s*[\r\n]+\s*\.inbox_viewer\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.inbox_viewer\s+\.pc-md\s+:not\(pre\)\s*>\s*code\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.exec_log_scroll\s*\{[^}]*padding-bottom:\s*calc\(/);
    expect(css).toMatch(/\.exec_log_scroll\s*\{[^}]*env\(safe-area-inset-bottom/);
    expect(css).toMatch(/\.exec_event_summary\s*\{[^}]*display:\s*flex;/);
  });
});
