/**
 * The entity-semantic token DRIFT PIN (the c594 harmonization contract's
 * observer half, committed when uic shipped the kit tokens — commons c680).
 *
 * ONE visual vocabulary: the seven entity-semantic colors (identity, memory,
 * diary, standing, scar, bond, accent) must read identically in this app's
 * graph/legend and in every ui-kit consumer (gateway console, flow). The kit
 * adopted our shipped dark values BYTE-VERBATIM under semantic names
 * (--entity-*); this pin asserts neither copy wanders silently — the
 * one-source-imported-never-copied rule applied to pixels. The kit file is
 * parsed DIRECTLY (uic deliberately ships theme.css as plain importable CSS
 * so this test needs no build step on their side).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const OBSERVER_CSS = resolve(__dirname, "entity.css");
const KIT_CSS = resolve(__dirname, "../../../abstractuic/ui-kit/src/theme.css");

/** observer entity.css :root name -> ui-kit semantic token name. */
const TOKEN_MAP: Record<string, string> = {
  "--identity": "--entity-identity",
  "--memory": "--entity-memory",
  "--diary": "--entity-diary",
  "--standing": "--entity-standing",
  "--scar": "--entity-scar",
  "--bond": "--entity-bond",
  "--accent": "--entity-accent",
};

/** First :root block's declarations (the dark set — both files lead with it). */
function rootTokens(css: string): Record<string, string> {
  const root = css.match(/:root\s*\{([^}]*)\}/);
  if (!root) return {};
  const out: Record<string, string> = {};
  for (const line of root[1].split(";")) {
    const m = line.match(/(--[\w-]+)\s*:\s*([^;]+)/);
    if (m) out[m[1].trim()] = m[2].trim().toLowerCase();
  }
  return out;
}

describe("entity-semantic tokens: observer == ui-kit (drift pin)", () => {
  it("the seven dark values match byte-for-byte across both sources", () => {
    const ours = rootTokens(readFileSync(OBSERVER_CSS, "utf-8"));
    const kit = rootTokens(readFileSync(KIT_CSS, "utf-8"));
    for (const [ourName, kitName] of Object.entries(TOKEN_MAP)) {
      expect(ours[ourName], `observer ${ourName} must exist`).toBeTruthy();
      expect(kit[kitName], `ui-kit ${kitName} must exist`).toBeTruthy();
      expect(kit[kitName], `${kitName} drifted from observer's ${ourName}`).toBe(ours[ourName]);
    }
  });

  it("the kit carries the full seven-token vocabulary (no partial set)", () => {
    const kit = rootTokens(readFileSync(KIT_CSS, "utf-8"));
    const entityTokens = Object.keys(kit).filter((k) => k.startsWith("--entity-"));
    for (const name of Object.values(TOKEN_MAP)) {
      expect(entityTokens, `kit is missing ${name}`).toContain(name);
    }
  });
});
