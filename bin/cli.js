#!/usr/bin/env node

/**
 * CLI entry point for AbstractObserver
 * Serves the built web application on a configurable port
 */

import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const ARGV = process.argv.slice(2);
function parse_bool_env(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  console.warn(`#FALLBACK: ${name}="${raw}" is not a boolean; defaulting to false.`);
  return false;
}

const MONITOR_GPU =
  ARGV.includes("--monitor-gpu") ||
  ["1", "true", "yes", "on"].includes(String(process.env.ABSTRACTOBSERVER_MONITOR_GPU || "").trim().toLowerCase());
const ENABLE_BACKLOG = parse_bool_env("ABSTRACTOBSERVER_ENABLE_BACKLOG");
const ENABLE_INBOX_TRIAGE = parse_bool_env("ABSTRACTOBSERVER_ENABLE_INBOX_TRIAGE");

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
  if (ENABLE_BACKLOG !== undefined) ui_config.enable_backlog = ENABLE_BACKLOG;
  if (ENABLE_INBOX_TRIAGE !== undefined) ui_config.enable_inbox_triage = ENABLE_INBOX_TRIAGE;
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

const server = createServer((req, res) => {
  // Remove query strings and normalize path
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  
  // Security: prevent directory traversal
  if (pathname.includes('..')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Try to serve the requested file
  let filePath = join(DIST_DIR, pathname);
  
  if (serveFile(res, filePath)) {
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

  // SPA fallback: serve index.html for all other routes
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
