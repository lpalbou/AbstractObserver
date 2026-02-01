import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Workspace imports (AbstractUIC packages) originate outside this project's
      // directory tree, so pin `reactflow` explicitly for both TS and Vite.
      { find: /^reactflow$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/esm/index.mjs") },
      { find: /^reactflow\/dist\/style\.css$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/style.css") },
      { find: /^reactflow\/dist\/base\.css$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/base.css") },

      { find: "@abstractuic/monitor-active-memory", replacement: resolve(__dirname, "../abstractuic/monitor-active-memory/src") },
      { find: "@abstractuic/monitor-flow", replacement: resolve(__dirname, "../abstractuic/monitor-flow/src") },
      { find: "@abstractuic/panel-chat", replacement: resolve(__dirname, "../abstractuic/panel-chat/src") },
      { find: "@abstractuic/ui-kit", replacement: resolve(__dirname, "../abstractuic/ui-kit/src") },
      { find: "@abstractutils/monitor-gpu", replacement: resolve(__dirname, "../abstractuic/monitor-gpu/src") },
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
    // In dev, you can proxy /api to a local gateway host (AbstractFlow backend).
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
