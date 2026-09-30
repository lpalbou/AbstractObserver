// CI and release build against a PINNED AbstractUIC (the kit source is
// bundled from the sibling checkout), and their comments tell the truth
// about how app-server is installed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/release.yml"];

function uicCheckout(yml: string): string {
  const m = /- name: Check out AbstractUIC\n([\s\S]*?)(?=\n\s*- name:)/.exec(yml);
  if (!m) throw new Error("no 'Check out AbstractUIC' step");
  return m[1];
}

describe("workflows", () => {
  it("check out AbstractUIC at a release tag (not the default branch), the same in CI and release", () => {
    const refs = WORKFLOWS.map((p) => {
      const step = uicCheckout(read(p));
      expect(step, p).toContain("repository: lpalbou/AbstractUIC");
      const ref = /\n\s*ref: (\S+)/.exec(step)?.[1];
      expect(ref, `${p} pins no ref`).toMatch(/^v\d+\.\d+\.\d+$/);
      return ref;
    });
    expect(new Set(refs).size).toBe(1);
  });

  it("no stale claim that app-server is a file: link", () => {
    const dep = JSON.parse(read("package.json")).dependencies["@abstractframework/app-server"];
    expect(dep).not.toMatch(/^file:/);
    for (const p of WORKFLOWS) expect(read(p), p).not.toMatch(/file:\.\.\/abstractuic/);
  });

  it("install the Playwright Chromium before the tests (the phone layout test needs it)", () => {
    for (const p of WORKFLOWS) {
      const src = read(p);
      const install = src.indexOf("npx playwright install --with-deps chromium");
      expect(install, p).toBeGreaterThan(0);
      expect(install, p).toBeLessThan(src.indexOf("run: npm test"));
    }
  });
});
