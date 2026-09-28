// The Observer is served at / and through the gateway at /apps/observer/:
// every same-origin URL it makes is relative to the document base.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { REVEAL_PATH, SERVICE_WORKER_PATH, run_id_from_location } from "./app_paths";
import { joinBaseUrl } from "@abstractframework/ui-kit";

import { GatewayClient } from "./gateway_client";

const ROOT = join(__dirname, "..", "..");
const RUN = "0f3c2c55-8f9e-4bd5-9d7a-2b1f7c1e9a10";

/** `"/api/…`, `'/assets/…`, `` `/sw.js` `` …: an absolute URL of this app (its API, assets, worker, manifest, icon). */
const ABSOLUTE_LITERAL = /(["'`])\/(api\/|assets\/|sw\.js|manifest\.webmanifest|icon\.svg)/g;

function files(dir: string, keep: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

function absolute_literals(path: string): string[] {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(ABSOLUTE_LITERAL)].map((m) => `${relative(ROOT, path)}: ${text.slice(m.index!, m.index! + 48)}`);
}

describe("same-origin URLs are relative to the document base", () => {
  it("no absolute /api/ or /assets/ literal in the app's sources, page, worker or manifest", () => {
    const sources = files(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));
    const shell = ["index.html", "public/sw.js", "public/manifest.webmanifest"].map((p) => join(ROOT, p));
    expect(sources.length).toBeGreaterThan(20);
    expect([...sources, ...shell].flatMap(absolute_literals)).toEqual([]);
  });

  it("the built app (Observer + kit) has none either", async () => {
    const { build } = await import("vite");
    const out = mkdtempSync(join(tmpdir(), "observer-dist-"));
    try {
      await build({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
      const index = readFileSync(join(out, "index.html"), "utf8");
      expect(index).toMatch(/src="\.\/assets\/index-[^"]+\.js"/); // Vite base "./"
      const bundle = files(out, (p) => /\.(js|html|css|webmanifest)$/.test(p));
      const text = bundle.map((p) => readFileSync(p, "utf8")).join("\n");
      expect(text).toContain('"api/gateway/'); // the scan reads the real bundle (relative gateway paths)
      expect(bundle.flatMap(absolute_literals)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it("the app's own paths and gateway paths are relative; a direct gateway URL is absolute", () => {
    for (const p of [REVEAL_PATH, SERVICE_WORKER_PATH]) expect(p.startsWith("/")).toBe(false);
    // Resolved against a mounted page's <base href>, a relative gateway path stays under the mount.
    expect(new URL(joinBaseUrl("", "api/gateway/runs/x"), "http://gw:8080/apps/observer/").pathname).toBe("/apps/observer/api/gateway/runs/x");
  });

  async function urls_of(base_url: string): Promise<string[]> {
    const urls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: any) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
    }) as any;
    try {
      const gw = new GatewayClient({ base_url, auth_token: "" });
      await gw.get_run("r1").catch(() => {});
      await gw.fetch_gateway("api/gateway/runs/r1/workspace");
      await gw.automations_client().listAutomations({}).catch(() => {});
    } finally {
      globalThis.fetch = real;
    }
    return urls;
  }

  it("mounted (same origin): every gateway call of the client is relative to the base", async () => {
    expect(await urls_of("")).toEqual(["api/gateway/runs/r1", "api/gateway/runs/r1/workspace", "api/gateway/automations"]);
  });

  it("direct gateway URL: every call is <base>/api/gateway/… (never http://hostapi/…)", async () => {
    const want = ["http://gw:8080/api/gateway/runs/r1", "http://gw:8080/api/gateway/runs/r1/workspace", "http://gw:8080/api/gateway/automations"];
    expect(await urls_of("http://gw:8080")).toEqual(want);
    expect(await urls_of("http://gw:8080/")).toEqual(want);
  });

  it("a run id is read from the hash or the last path segment, wherever the app is mounted", () => {
    expect(run_id_from_location({ hash: "", pathname: `/apps/observer/${RUN}` })).toBe(RUN);
    expect(run_id_from_location({ hash: `#observe/${RUN}`, pathname: "/apps/observer/" })).toBe(RUN);
    expect(run_id_from_location({ hash: "", pathname: `/${RUN}` })).toBe(RUN);
    expect(run_id_from_location({ hash: "#automations", pathname: "/apps/observer/" })).toBe("");
  });
});
