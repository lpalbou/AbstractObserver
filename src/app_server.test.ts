// The app server (bin/server.js) follows the app-server mount contract: it
// serves at / and through the gateway at /apps/observer/.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error plain ESM module without types
import { createObserverHandler } from "../bin/server.js";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>AbstractObserver</title>
<script type="module" src="./assets/index-x.js"></script></head><body><div id="root"></div></body></html>`;

let dir = "";
let server: http.Server;
let base = "";
const spawned: Array<{ cmd: string; args: string[] }> = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "observer-app-server-"));
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dir, "ws", "run-folder"), { recursive: true });
  writeFileSync(join(dist, "index.html"), PAGE);
  writeFileSync(join(dist, "assets", "index-x.js"), "console.log('app');");
  writeFileSync(join(dist, "sw.js"), "// worker");
  const handler = createObserverHandler({
    distDir: dist,
    gatewayUrl: "http://127.0.0.1:9", // a dead port: nothing here may reach a real gateway
    gatewayDir: join(dir, "ws"),
    spawn: (cmd: string, args: string[]) => {
      spawned.push({ cmd, args });
      return { unref() {} };
    },
  });
  server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const MOUNT = { "X-Forwarded-Prefix": "/apps/observer", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "vps.example:8080" };
const CSRF = "csrf-token-of-this-browser-session";

describe("mounted at /apps/observer/ (through the gateway)", () => {
  it("announces itself on every response", async () => {
    for (const path of ["/", "/assets/index-x.js", "/nope.js", "/api/connection/gateway"]) {
      const r = await fetch(base + path, { headers: MOUNT });
      expect(r.headers.get("x-abstractframework-app"), path).toBe("observer; mount=1");
    }
  });

  it("the page gets <base href> and base_path; its asset URLs stay relative", async () => {
    const html = await (await fetch(base + "/", { headers: MOUNT })).text();
    expect(html).toMatch(/<head><base href="\/apps\/observer\/">/);
    expect(html).toContain('"base_path":"/apps/observer"');
    expect(html).toContain('"gateway_url":"http://127.0.0.1:9"');
    expect(html).toContain('src="./assets/index-x.js"');
    // A deep link (run id in the path) gets the same page under the same base.
    const deep = await (await fetch(base + "/0f3c2c55-8f9e-4bd5-9d7a-2b1f7c1e9a10", { headers: MOUNT })).text();
    expect(deep).toContain('<base href="/apps/observer/">');
  });

  it("standalone at / the base is /", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain('<base href="/">');
    expect(html).toContain('"base_path":""');
  });

  it("the folder reveal answers only a browser on this machine (the forwarded address and a loopback Host, not the socket peer)", async () => {
    const body = JSON.stringify({ path: "run-folder" });
    const remote = await fetch(base + "/api/local/reveal", { method: "POST", body, headers: { ...MOUNT, "X-Forwarded-For": "203.0.113.7" } });
    expect(remote.status).toBe(403);
    // A loopback address that names a non-loopback host (a DNS-rebinding page) is not "this machine".
    const rebound = await fetch(base + "/api/local/reveal", { method: "POST", body, headers: { ...MOUNT, "X-Forwarded-For": "127.0.0.1" } });
    expect(rebound.status).toBe(403);
    expect(spawned).toEqual([]);
    const LOCAL_MOUNT = { ...MOUNT, "X-Forwarded-Host": "127.0.0.1:8080", "X-Forwarded-For": "127.0.0.1", Cookie: `abstractobserver_gateway_csrf=${CSRF}` };
    const local = await fetch(base + "/api/local/reveal", { method: "POST", body, headers: { ...LOCAL_MOUNT, "X-AbstractObserver-CSRF": CSRF } });
    expect(local.status).toBe(200);
    expect(spawned.map((s) => s.args[0])).toEqual([join(dir, "ws", "run-folder")]);
  });

  it("the folder reveal follows the origin's CSRF rule: a cross-site POST cannot open a folder", async () => {
    spawned.length = 0;
    const body = JSON.stringify({ path: "run-folder" });
    const LOCAL = { ...MOUNT, "X-Forwarded-Host": "127.0.0.1:8080", "X-Forwarded-For": "127.0.0.1" };
    const withCookie = { ...LOCAL, Cookie: `abstractobserver_gateway_csrf=${CSRF}` };
    const post = (headers: Record<string, string>) => fetch(base + "/api/local/reveal", { method: "POST", body, headers });
    // A cross-site form/fetch carries the cookie but cannot read it into the header.
    const noHeader = await post(withCookie);
    expect(noHeader.status).toBe(403);
    expect((await noHeader.json()).reason_code).toBe("csrf_required");
    expect((await post({ ...withCookie, "X-AbstractObserver-CSRF": "guess" })).status).toBe(403);
    expect((await post({ ...LOCAL, "X-AbstractObserver-CSRF": CSRF })).status).toBe(403); // no session cookie
    // Another site's Origin is refused even with the token.
    expect((await post({ ...withCookie, "X-AbstractObserver-CSRF": CSRF, Origin: "http://evil.example" })).status).toBe(403);
    expect(spawned).toEqual([]);
    // This page (its own Origin, the token in the app or the canonical header) is served.
    expect((await post({ ...withCookie, "X-AbstractObserver-CSRF": CSRF, Origin: "http://127.0.0.1:8080" })).status).toBe(200);
    expect((await post({ ...withCookie, "X-Abstract-CSRF": CSRF })).status).toBe(200);
    expect(spawned).toHaveLength(2);
  });

  it("a malformed forwarded prefix is refused, never guessed", async () => {
    const r = await fetch(base + "/", { headers: { "X-Forwarded-Prefix": "/apps/../etc" } });
    expect(r.status).toBe(400);
  });

  it("a missing asset is a 404 (never the page), and nothing outside dist/ is served", async () => {
    expect((await fetch(base + "/assets/missing.js", { headers: MOUNT })).status).toBe(404);
    expect((await fetch(base + "/..%2f..%2fpackage.json")).status).toBe(404);
  });
});
