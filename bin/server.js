/**
 * The AbstractObserver app server: serves the built app (dist/), the local
 * folder reveal and the app-origin gateway session proxy, standalone at `/`
 * or through the gateway at `/apps/observer/` (the app-server mount
 * contract: @abstractframework/app-server README, "Serving under the gateway").
 *
 * - Every response announces `X-AbstractFramework-App: observer; mount=1`
 *   (`createMountedHandler`), so the gateway may serve it.
 * - "Who is asking" is `ctx.clientAddress` / `ctx.clientIsLoopback`, never the
 *   socket peer (behind the gateway the socket peer is always loopback).
 * - The page gets `<base href="<basePath>/">` and `base_path` in
 *   `window.__ABSTRACT_UI_CONFIG__` (`injectShell`); the app's URLs are
 *   relative, so they resolve under the base.
 * - The session proxy sets its cookies at `Path=<basePath>/`.
 */

import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, normalize, resolve, sep } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";

import { createGatewaySessionProxy, createMountedHandler, injectShell } from "@abstractframework/app-server";

/** The gateway catalog id this app announces. */
export const APP_ID = "observer";
/** Cookie / CSRF prefix of the session proxy (kept: existing sessions survive). */
export const COOKIE_APP_ID = "abstractobserver";

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function mimeType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Origin + path of a configured app URL (query and hash dropped). */
export function normalizeAppUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return value.split(/[?#]/)[0].replace(/\/+$/, "");
  }
}

/**
 * @param {object} options
 * @param {string} options.distDir          the built app
 * @param {string | {current(): string, refresh(): boolean}} options.gatewayUrl  the server-pinned gateway
 * @param {boolean} [options.monitorGpu]
 * @param {string} [options.entityAppUrl]   where the entity app lives (Entities ↗ links)
 * @param {string} options.gatewayDir       base for RELATIVE workspace roots (folder reveal)
 * @param {Function} [options.spawn]        child_process.spawn (tests inject a recorder)
 * @returns {(req, res) => void} the request handler
 */
export function createObserverHandler(options) {
  const distDir = resolve(options.distDir);
  const entityAppUrl = normalizeAppUrl(options.entityAppUrl);
  const spawn = options.spawn || nodeSpawn;
  const proxy = createGatewaySessionProxy({ appId: COOKIE_APP_ID, defaultGatewayUrl: options.gatewayUrl });

  function uiConfig() {
    const config = { gateway_url: proxy.defaultGatewayUrl };
    if (options.monitorGpu) config.monitor_gpu = true;
    if (entityAppUrl) config.entity_app_url = entityAppUrl;
    return config;
  }

  /** A file under dist/, or null (never outside it). */
  function distFile(pathname) {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    const abs = resolve(distDir, rel);
    if (abs !== distDir && !abs.startsWith(distDir + sep)) return null;
    try {
      return existsSync(abs) && statSync(abs).isFile() ? abs : null;
    } catch {
      return null;
    }
  }

  function serve(res, filePath, ctx) {
    const type = mimeType(filePath);
    if (type === "text/html") {
      const page = injectShell(readFileSync(filePath, "utf8"), { basePath: ctx.basePath, config: uiConfig() });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(page);
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(readFileSync(filePath));
  }

  function servePage(res, ctx) {
    const index = distFile("index.html");
    if (!index) return json(res, 500, { detail: "dist/index.html is missing: build the app (npm run build)." });
    return serve(res, index, ctx);
  }

  function resolveWorkspacePath(raw) {
    const p = String(raw || "").trim();
    if (!p || p.includes("\0")) return null;
    const abs = isAbsolute(p) ? p : resolve(options.gatewayDir, p);
    try {
      return existsSync(abs) && statSync(abs).isDirectory() ? abs : null;
    } catch {
      return null;
    }
  }

  /**
   * The rule of every mutating route of this origin (the session proxy's):
   * the request presents the browser session's CSRF token in the app CSRF
   * header (`X-AbstractObserver-CSRF`, or the canonical `X-Abstract-CSRF`),
   * which a cross-site page can neither read nor send; and a request that
   * names its `Origin` names this one. Returns the refusal, or null.
   */
  function crossSiteRefusal(req, ctx) {
    const origin = String(req.headers.origin || "").trim();
    if (origin && origin !== `${ctx.proto}://${ctx.host}`) return "Cross-site request refused.";
    const expected = proxy.browserSession(req).csrfToken;
    const presented = String(proxy.csrfHeaderNames.map((h) => req.headers[h]).find((v) => v) || "").trim();
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(String(expected || ""), "utf8");
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return "Browser session CSRF token missing or invalid.";
    return null;
  }

  /** Open a run's folder on THIS machine: only for a browser on this machine, from this app's own page. */
  function reveal(req, res, ctx) {
    if (!ctx.clientIsLoopback) {
      json(res, 403, { ok: false, error: "Folder reveal is only available on the machine running the observer." });
      return;
    }
    const refused = crossSiteRefusal(req, ctx);
    if (refused) {
      json(res, 403, { ok: false, error: refused, reason_code: "csrf_required" });
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 8192) req.destroy();
    });
    req.on("end", () => {
      let path = "";
      try {
        path = String(JSON.parse(body || "{}").path || "");
      } catch {
        path = "";
      }
      const abs = resolveWorkspacePath(path);
      if (!abs) {
        json(res, 404, { ok: false, error: `Workspace folder not found on this machine: ${path || "(empty)"}` });
        return;
      }
      try {
        // `open <dir>` / `xdg-open <dir>`: never a shell, never arbitrary exec.
        spawn(process.platform === "darwin" ? "open" : "xdg-open", [abs], { stdio: "ignore", detached: true }).unref();
        json(res, 200, { ok: true, path: abs });
      } catch (e) {
        json(res, 500, { ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  return createMountedHandler({ appId: APP_ID }, (req, res, ctx) => {
    const url = new URL(req.url || "/", "http://observer.invalid");
    const pathname = url.pathname;

    // /api/local/* is OURS (never forwarded to the gateway).
    if (pathname === "/api/local/reveal" && req.method === "POST") return reveal(req, res, ctx);
    // Connection endpoint + everything under /api/ (session swapped for gateway credentials).
    if (proxy.handle(req, res, pathname)) return;

    if (pathname === "/" || pathname === "/index.html") return servePage(res, ctx);
    const file = distFile(pathname);
    if (file) return serve(res, file, ctx);

    // An explicit .html that misses fails loudly, never the SPA fallback.
    if (pathname.endsWith(".html")) {
      if (pathname === "/entity.html" && entityAppUrl) {
        res.writeHead(302, { Location: `${entityAppUrl}/${url.search || ""}` });
        res.end();
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        pathname === "/entity.html"
          ? "The entity app moved to its own package (abstractentity, default http://127.0.0.1:3007). Start the observer with --entity-app-url to make this a redirect."
          : `${pathname} is not in this build (dist/). This server hosts the AbstractObserver app only.`
      );
      return;
    }
    // An asset that is not in the build is a 404, never the page.
    if (extname(pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    // SPA fallback (deep links such as /<run id>): the page, under the same base.
    return servePage(res, ctx);
  });
}

