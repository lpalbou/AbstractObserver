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

});
