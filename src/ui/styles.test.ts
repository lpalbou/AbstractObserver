import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AbstractObserver styles", () => {
  it("uses shared typography tokens for base sizing", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/font-size:\s*var\(--font-size-base\)/);
    expect(css).toMatch(/line-height:\s*var\(--line-height-base\)/);
    expect(css).toMatch(/\.btn\s*\{[^}]*font-size:\s*var\(--font-size-md\)/);
  });

  it("avoids fixed px font sizes (respects --font-scale)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/font-size:\s*\d+px\b/);
  });

  it("includes a mobile-safe header/nav layout (no overlapping tabs)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.nav_tab\s*\{[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.page\.page_scroll\s*\{[^}]*overflow-x:\s*hidden;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.app-header\s*\{[\s\S]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.app_nav\s*\{[\s\S]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.gateway_led\.ok\s*\{[^}]*animation:\s*gateway_led_pulse/);
    expect(css).toMatch(/@keyframes\s+gateway_led_pulse/);
    expect(css).toMatch(/\.header_icon_btn\s*\{/);
  });

  it("includes a mobile-friendly Backlog layout (scrollable tabs, edge-mounted advisor)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.backlog_tabs\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.backlog_tabs\s*\{[^}]*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/\.row\.backlog_toolbar\s*\{[^}]*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/\.row\.backlog_toolbar_actions\s*\{[^}]*align-items:\s*center;/);
    expect(css).toMatch(/\.row\.backlog_filters\s*\{[^}]*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/\.backlog_filters_left\s*\{[^}]*flex:\s*1\s+1\s+0;/);
    expect(css).toMatch(/\.backlog_completed_meta_row\s*\{[^}]*display:\s*flex;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.backlog_search_field\s*\{[\s\S]*flex:\s*1\s+1\s+auto;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.advisor_toggle\s*\{[\s\S]*top:\s*50%;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.advisor_toggle_label\s*\{[\s\S]*writing-mode:\s*vertical-rl;/);
    expect(css).toMatch(/\.drawer_panel\s*\{[^}]*width:\s*clamp\(/);
    expect(css).toMatch(/\.inbox_sidebar,\s*[\r\n]+\s*\.inbox_viewer\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.inbox_viewer\s+\.pc-md\s+:not\(pre\)\s*>\s*code\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.exec_log_scroll\s*\{[^}]*padding-bottom:\s*calc\(/);
    expect(css).toMatch(/\.exec_log_scroll\s*\{[^}]*env\(safe-area-inset-bottom/);
    expect(css).toMatch(/\.exec_event_summary\s*\{[^}]*display:\s*flex;/);
    expect(css).toMatch(/\.chip\.backlog_path_chip\s*\{/);
    expect(css).toMatch(/\.chip_icon_btn\s*\{/);
  });
});
