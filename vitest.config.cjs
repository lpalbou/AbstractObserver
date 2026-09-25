const { resolve } = require("path");

// Same build-time version define as vite.config.ts (the About dialog reads it).
function packageVersion() {
  const version = String(require("./package.json").version || "").trim();
  if (!version) throw new Error("package.json has no version; the About dialog needs one");
  return version;
}

module.exports = async () => {
  const react = (await import("@vitejs/plugin-react")).default;
  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion()),
    },
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

        { find: "@abstractuic/monitor-active-memory", replacement: resolve(__dirname, "../abstractuic/monitor-active-memory/src") },
        { find: "@abstractuic/monitor-flow", replacement: resolve(__dirname, "../abstractuic/monitor-flow/src") },
        { find: "@abstractuic/panel-chat", replacement: resolve(__dirname, "../abstractuic/panel-chat/src") },
        { find: "@abstractuic/ui-kit", replacement: resolve(__dirname, "../abstractuic/ui-kit/src") },
        { find: "@abstractutils/monitor-gpu", replacement: resolve(__dirname, "../abstractuic/monitor-gpu/src") },
      ],
    },
    test: {
      environment: "node",
    },
  };
};
