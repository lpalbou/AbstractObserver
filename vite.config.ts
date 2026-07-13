import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { createGatewaySessionProxy } from "@abstractframework/app-server";

// Dev-server twin of bin/cli.js (pattern from continuum c1122, same root
// cause): mount the SAME app-origin gateway session proxy so sign-in works
// identically in dev and prod. Without this, POST /api/connection/gateway
// fell through Vite's raw /api proxy to the gateway, which has no such
// route -> 404 at the shared sign-in dialog.
//
// Fall-through contract: the connection endpoint is always ours; other
// /api/* requests ride the session proxy ONLY when a browser session
// exists (prod parity). With no session they fall through to Vite's raw
// /api proxy below, so no-auth dev gateways keep working unauthenticated.
function gatewaySessionDevProxy(): Plugin {
  const proxy = createGatewaySessionProxy({
    appId: "abstractobserver",
    defaultGatewayUrl:
      String(process.env.ABSTRACTOBSERVER_GATEWAY_URL || process.env.ABSTRACTGATEWAY_URL || "").trim() || "http://127.0.0.1:8080",
  });
  return {
    name: "abstractobserver-gateway-session-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname = "/";
        try {
          pathname = new URL(req.url || "/", "http://local").pathname;
        } catch {
          next();
          return;
        }
        if (pathname === proxy.connectionPath) {
          proxy.handle(req, res, pathname);
          return;
        }
        if (pathname.startsWith("/api/") && proxy.browserSession(req).sessionId) {
          proxy.handle(req, res, pathname);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [gatewaySessionDevProxy(), react()],
  resolve: {
    alias: [
      // Workspace imports (AbstractUIC packages) originate outside this project's
      // directory tree, so pin `reactflow` explicitly for both TS and Vite.
      { find: /^reactflow$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/esm/index.mjs") },
      { find: /^reactflow\/dist\/style\.css$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/style.css") },
      { find: /^reactflow\/dist\/base\.css$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/base.css") },

      { find: "@abstractframework/monitor-active-memory", replacement: resolve(__dirname, "../abstractuic/monitor-active-memory/src") },
      { find: "@abstractframework/monitor-flow", replacement: resolve(__dirname, "../abstractuic/monitor-flow/src") },
      { find: "@abstractframework/panel-chat", replacement: resolve(__dirname, "../abstractuic/panel-chat/src") },
      { find: "@abstractframework/ui-kit", replacement: resolve(__dirname, "../abstractuic/ui-kit/src") },
      { find: "@abstractframework/monitor-gpu", replacement: resolve(__dirname, "../abstractuic/monitor-gpu/src") },

    ],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    strictPort: false,
    cors: true,
    fs: {
      // Vite blocks serving files outside an allowlist. When we customize it to
      // include shared workspace packages (e.g. AbstractUIC), we must also include
      // this app's own root directory or Vite will 403 on `/index.html`.
      allow: [resolve(__dirname), resolve(__dirname, "../abstractuic")],
    },
    // In dev, sessionless /api requests fall through to a local gateway
    // (the standard :8080 — the :8081 night-watch gateway was retired
    // 2026-07-09; env overrides win).
    proxy: {
      "/api": {
        target: process.env.ABSTRACTOBSERVER_GATEWAY_URL || process.env.ABSTRACTGATEWAY_URL || "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // One app since 2026-07-12: the entity memory view moved to its own
    // package (../abstractentity, github.com/lpalbou/AbstractEntity).
  },
});

