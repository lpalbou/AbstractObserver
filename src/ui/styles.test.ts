import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AbstractObserver styles", () => {
  it("uses shared typography tokens for base sizing", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/font-size:\s*var\(--font-size-base\)/);
    expect(css).toMatch(/line-height:\s*var\(--line-height-base\)/);
    expect(css).toMatch(/\.btn\s*\{[^}]*font-size:\s*var\(--t-small\)/);
  });

  it("avoids fixed px font sizes (respects --font-scale)", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/font-size:\s*\d+px\b/);
  });

  it("ships the sidebar shell (redesign wave 1) with a mobile icon rail", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    // The shell: sidebar nav + slim header; accent as a CUE (2px inset
    // bar), never a fill — the retired solid-accent .nav_tab must not
    // return.
    expect(css).toMatch(/\.shell_sidebar\s*\{[^}]*flex:\s*0 0 208px/);
    expect(css).toMatch(/\.shell_nav_item\.active\s*\{[^}]*inset 2\.5px 0 0 var\(--accent\)/);
    expect(css).not.toMatch(/\.nav_tab\.active/);
    expect(css).toMatch(/\.shell_header_title\s*\{[^}]*font-size:\s*var\(--t-page\)/);
    // Narrow viewports collapse to an icon rail instead of wrapping tabs.
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*\.shell_sidebar\s*\{[\s\S]*flex-basis:\s*56px/);
    expect(css).toMatch(/\.page\.page_scroll\s*\{[^}]*overflow-x:\s*hidden;/);
    expect(css).toMatch(/\.gateway_led\.ok\s*\{[^}]*animation:\s*gateway_led_pulse/);
    expect(css).toMatch(/@keyframes\s+gateway_led_pulse/);
  });

  it("RATCHET: raw color literals only go DOWN (use kit tokens for new color)", () => {
    // The 2026-07-13 design wave found 428 raw rgba() literals bypassing the
    // kit tokens — the root cause of "two dark palettes on one screen" and
    // 21 broken themes. The semantic pass + the wave A/B dead-CSS purge
    // brought it to the counts below; new color belongs in tokens/color-mix,
    // never new literals. Lower the ceilings when you remove literals; never
    // raise them.
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const rgba_count = (css.match(/rgba\(/g) || []).length;
    const hex_count = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    expect(rgba_count).toBeLessThanOrEqual(189);
    expect(hex_count).toBeLessThanOrEqual(10);
  });

  it("board status chips ride the SHARED semantic states (no private color map)", () => {
    // Adversary 3 P0-1: the board's private mc_status_running/... palette
    // said running=green while every Observe chip said running=blue. The
    // board chip now renders `mc_status ${run_status_class(word)}`; the
    // state rules are the chip family's own.
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.mc_status_(running|waiting|failed|completed|paused)\b/);
    for (const state of ["ok", "danger", "warn", "info", "muted"]) {
      expect(css).toMatch(new RegExp(`\\.mc_status\\.${state}\\b`));
    }
    const mc = readFileSync(new URL("./mission_control.tsx", import.meta.url), "utf8");
    expect(mc).toContain("run_status_class(status_word)");
    // Approve must stay tinted — a second solid .btn.success block is how
    // the cascade shipped white-on-green once already.
    const success_blocks = css.match(/\.btn\.success\s*\{[^}]*\}/g) || [];
    expect(success_blocks.length).toBe(1);
    expect(success_blocks[0]).not.toMatch(/background:\s*var\(--success\)\s*;/);
  });

  it("RATCHET: no solid status pills (tinted-outline recipe only)", () => {
    // Solid white-on-green/red pills failed AA at 10px (fable5 P0-5). The
    // pin targets the LIVE pill classes (run_card_status died with the
    // duplicate RunPicker in wave A).
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.(run_status_pill|status_pill|mc_status|chip)[.\w]*\s*\{[^}]*background:\s*var\(--(ok|success|danger|error|warning|accent)\)\s*;/);
  });

  it("every var(--token) used in styles.css is DEFINED (styles.css or kit theme)", () => {
    // Adversary 1 P0-3: `var(--border-primary)` did not exist anywhere —
    // the border shorthand became invalid at computed-value time and the
    // declared design silently vanished from the pixels. An undefined
    // token must fail the suite, not the render.
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const kit = readFileSync(new URL("../../../abstractuic/ui-kit/src/theme.css", import.meta.url), "utf8");
    const defined = new Set<string>();
    for (const m of (css + "\n" + kit).matchAll(/--([\w-]+)\s*:/g)) defined.add(m[1]);
    const missing = new Set<string>();
    for (const m of css.matchAll(/var\(\s*--([\w-]+)\s*([,)])/g)) {
      const name = m[1];
      const has_fallback = m[2] === ",";
      if (!defined.has(name) && !has_fallback) missing.add(name);
    }
    expect(Array.from(missing).sort()).toEqual([]);
  });

  it("every chip semantic state used in the app has a .chip.<state> rule", () => {
    // Adversary 1 P0-1: `chip mono error` rendered NEUTRAL for a failed
    // run — the CSS vocabulary is danger/ok/warn/info/muted/task/scheduled
    // and nothing else. Any chip state referenced from tsx must exist.
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    const states = new Set<string>();
    for (const m of app.matchAll(/className=\{?["`]chip(?:\s+mono)?\s+([a-z_]+)/g)) states.add(m[1]);
    for (const state of states) {
      if (state === "mono") continue;
      expect(css, `missing .chip.${state} rule for a state used in app.tsx`).toMatch(new RegExp(`\\.chip\\.${state}\\s*[,{]`));
    }
  });

  it("chip family shares ONE metric recipe (2px 8px, 999px radius)", () => {
    // Wave A/B claim, pinned: status_pill / pill / mc_pill / mc_status /
    // mc_entity_phase / chip all wear the same chip metrics.
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    for (const sel of ["status_pill", "pill", "mc_pill", "mc_entity_phase", "chip"]) {
      const block = css.match(new RegExp(`\\.${sel}\\s*\\{[^}]*\\}`));
      expect(block, `.${sel} rule missing`).toBeTruthy();
      expect(block![0], `.${sel} padding drifted off the chip recipe`).toMatch(/padding:\s*2px 8px/);
      expect(block![0], `.${sel} radius drifted off the chip recipe`).toMatch(/border-radius:\s*999px/);
    }
    expect(css).toMatch(/\.mc_status\s*\{[^}]*padding:\s*2px 8px/);
  });

  it("observe ships exactly FOUR content tabs (Story/Ledger/Flow/Ask)", () => {
    // The nine-tab strip was the operator's core "not simple enough"
    // complaint; the collapse to four is pinned at the source level.
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/type ObserveRightTab = "overview" \| "ledger" \| "graph" \| "chat";/);
    for (const label of [">Story<", ">Ledger<", ">Flow<", ">Ask<"]) {
      expect(app.replace(/\s+/g, "")).toContain(label.replace(/\s+/g, ""));
    }
    for (const dead of ["Timeline</button>", "Replay</button>", "Digest</button>", "Attachments</button>", "Providers</button>"]) {
      expect(app).not.toContain(dead);
    }
  });

  it("no copy references removed UI (Advanced JSON, Settings-connect, Start Workflow)", () => {
    // Adversary 2: instructions pointing at controls that no longer exist
    // are dead ends dressed as help.
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(app).not.toContain("Fix it in Advanced JSON");
    expect(app).not.toContain("(connect in Settings)");
    expect(app).not.toContain("Start Workflow →");
  });

});
