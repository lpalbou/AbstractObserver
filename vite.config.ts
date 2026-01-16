import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@abstractuic/monitor-flow": resolve(__dirname, "../abstractuic/monitor-flow/src"),
      "@abstractuic/panel-chat": resolve(__dirname, "../abstractuic/panel-chat/src"),
      "@abstractutils/monitor-gpu": resolve(__dirname, "../abstractuic/monitor-gpu/src"),
    },
  },
  server: {
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
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
