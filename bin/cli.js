#!/usr/bin/env node

/**
 * CLI entry point for AbstractObserver
 * Serves the built web application on a configurable port
 */

import * as http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createGatewaySessionProxy } from '@abstractframework/app-server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
// ONE app since the 2026-07-12 split: the entity view moved to its own
// package (abstractentity, :3007). The ABSTRACTOBSERVER_LANDING knob died
// with it — this server always lands on index.html.
const DEFAULT_GATEWAY_URL = String(process.env.ABSTRACTOBSERVER_GATEWAY_URL || process.env.ABSTRACTGATEWAY_URL || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '') || 'http://127.0.0.1:8080';
// Where the ENTITY app lives — drives the "Entities ↗" links in the UI.
// Normalized to origin+path (query/hash dropped): both consumers append
// their own query (`/entity.html` redirect here, deep links in the UI),
// so a configured value carrying `?` would produce malformed URLs.
const ENTITY_APP_URL = (() => {
  const raw = String(process.env.ABSTRACTOBSERVER_ENTITY_APP_URL || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/+$/, '');
  }
})();
const ARGV = process.argv.slice(2);
const MONITOR_GPU =
  ARGV.includes("--monitor-gpu") ||
  ["1", "true", "yes", "on"].includes(String(process.env.ABSTRACTOBSERVER_MONITOR_GPU || "").trim().toLowerCase());

// MIME types for common file extensions
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function inject_config_html(html) {
  const ui_config = {};
  if (MONITOR_GPU) ui_config.monitor_gpu = true;
  // THIS deployment's gateway (maintainer incident 2026-07-09: the sign-in
  // card showed a retired gateway's URL) — the UI's connect/sign-in surfaces
  // default to it instead of any hardcoded historical port.
  if (DEFAULT_GATEWAY_URL) ui_config.gateway_url = DEFAULT_GATEWAY_URL;
  if (ENTITY_APP_URL) ui_config.entity_app_url = ENTITY_APP_URL;
  if (!Object.keys(ui_config).length) return html;
  const marker = "window.__ABSTRACT_UI_CONFIG__";
  if (html.includes(marker)) return html;
  const snippet = `<script>${marker}=Object.assign(${marker}||{}, ${JSON.stringify(ui_config)});</script>`;
  if (html.includes("</head>")) return html.replace("</head>", `${snippet}\n</head>`);
  if (html.includes("</body>")) return html.replace("</body>", `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}

function serveFile(res, filePath) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return false;
    }
    const mimeType = getMimeType(filePath);

    if (mimeType === "text/html") {
      const html = readFileSync(filePath, "utf8");
      const content = inject_config_html(html);
      res.writeHead(200, {
        "Content-Type": `${mimeType}; charset=utf-8`,
        "Cache-Control": "no-cache",
      });
      res.end(content);
      return true;
    }

    const content = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch (err) {
    return false;
  }
}

// APP-ORIGIN GATEWAY SESSION PROXY - the shared @abstractframework/app-server
// module (extracted from this file's hardened copy; one source across
// observer/flow/abstractcode per the 2026-07-12 consolidation). Cookie names
// (abstractobserver_gateway_*), the x-abstractobserver-csrf header, and the
// ABSTRACTOBSERVER_* / ABSTRACTGATEWAY_* env gates are all derived from appId,
// so existing sessions and deployment security posture survive the swap.
const gatewaySessionProxy = createGatewaySessionProxy({
  appId: 'abstractobserver',
  defaultGatewayUrl: DEFAULT_GATEWAY_URL,
});

// ── LOCAL FOLDER REVEAL (operator 2026-07-15: a folder button on the run
// opens its workspace). Only meaningful when this server runs on the SAME
// machine as the gateway (the local-first posture). Gateway workspace roots
// are often RELATIVE to the gateway process cwd — resolve against
// ABSTRACTOBSERVER_GATEWAY_DIR (default: the workspace parent this repo
// lives in, matching the launcher layout).
const GATEWAY_DIR = String(process.env.ABSTRACTOBSERVER_GATEWAY_DIR || join(__dirname, '..', '..')).trim();

function resolveWorkspacePath(raw) {
  const p = String(raw || '').trim();
  if (!p || p.includes('\0')) return null;
  const abs = isAbsolute(p) ? p : resolve(GATEWAY_DIR, p);
  try {
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
  } catch {}
  return null;
}

function handleRevealRequest(req, res, pathname) {
  if (pathname !== '/api/local/reveal' || req.method !== 'POST') return false;
  // Loopback only: revealing Finder windows on a remotely-served observer
  // is someone else's desktop. The socket peer is the truth (Host spoofable).
  const peer = String(req.socket?.remoteAddress || '');
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (!loopback) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Folder reveal is only available on the machine running the observer.' }));
    return true;
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
  req.on('end', () => {
    let path = '';
    try { path = String(JSON.parse(body || '{}').path || ''); } catch {}
    const abs = resolveWorkspacePath(path);
    if (!abs) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Workspace folder not found on this machine: ${path || '(empty)'}` }));
      return;
    }
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      // `open <dir>` reveals a folder; never a shell, never arbitrary exec.
      spawn(cmd, [abs], { stdio: 'ignore', detached: true }).unref();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: abs }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
  });
  return true;
}

const server = http.createServer((req, res) => {
  // Remove query strings and normalize path
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Local-machine folder reveal (before the proxy: /api/local/* is OURS,
  // never forwarded to the gateway).
  if (handleRevealRequest(req, res, pathname)) {
    return;
  }

  // Connection endpoint + everything under /api/ (proxied to the gateway
  // with session cookies swapped for gateway headers).
  if (gatewaySessionProxy.handle(req, res, pathname)) {
    return;
  }
  
  // Security: prevent directory traversal
  if (pathname.includes('..')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  // Try to serve the requested file
  let filePath = join(DIST_DIR, pathname);
  
  if (serveFile(res, filePath)) {
    return;
  }

  // An EXPLICIT .html request that misses must fail loudly, never fall
  // through to the SPA fallback (maintainer incident 2026-07-09: the wrong
  // app wearing the right URL is worse than a 404). /entity.html was real
  // here before the 2026-07-12 split — send old bookmarks to the entity
  // app's own deployment when we know it, otherwise say where it went.
  if (pathname.endsWith('.html')) {
    if (pathname === '/entity.html' && ENTITY_APP_URL) {
      res.writeHead(302, { Location: `${ENTITY_APP_URL}/${url.search || ''}` });
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      pathname === '/entity.html'
        ? 'The entity app moved to its own package (abstractentity, default http://127.0.0.1:3007). '
          + 'Set ABSTRACTOBSERVER_ENTITY_APP_URL to make this a redirect.'
        : `${pathname} is not in this build (dist/). This server hosts the AbstractObserver app only.`
    );
    return;
  }

  // Try with .html extension
  if (serveFile(res, filePath + '.html')) {
    return;
  }

  // Try index.html in directory
  if (serveFile(res, join(filePath, 'index.html'))) {
    return;
  }

  // SPA fallback
  const indexPath = join(DIST_DIR, 'index.html');
  if (serveFile(res, indexPath)) {
    return;
  }

  // If nothing works, return 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║         AbstractObserver is running!               ║
╚════════════════════════════════════════════════════╝

  🌐 Local:   http://localhost:${PORT}
  🌐 Network: http://${HOST}:${PORT}

  📡 Connect to your AbstractGateway instance
  🚀 Start observing your workflows

  Press Ctrl+C to stop
`);
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down AbstractObserver...\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Shutting down AbstractObserver...\n');
  process.exit(0);
});
