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
      // The kit and panel-chat come from the vendored packs in node_modules (responsive
      // workstream, ui-kit 0.3.0 / panel-chat 0.2.0); the monitor-* sources still come from the
      // sibling AbstractUIC checkout and must share this app's single kit + React copy.
      dedupe: ["@abstractframework/ui-kit", "@abstractframework/panel-chat", "react", "react-dom"],
      alias: [
        // Workspace imports (AbstractUIC packages) originate outside this project's
        // directory tree, so pin `reactflow` explicitly for both TS and Vite.
        { find: /^reactflow$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/esm/index.mjs") },
        { find: /^reactflow\/dist\/style\.css$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/style.css") },
        { find: /^reactflow\/dist\/base\.css$/, replacement: resolve(__dirname, "./node_modules/reactflow/dist/base.css") },

        { find: "@abstractframework/monitor-active-memory", replacement: resolve(__dirname, "../abstractuic/monitor-active-memory/src") },
        { find: "@abstractframework/monitor-flow", replacement: resolve(__dirname, "../abstractuic/monitor-flow/src") },
        { find: "@abstractframework/monitor-gpu", replacement: resolve(__dirname, "../abstractuic/monitor-gpu/src") },

        { find: "@abstractuic/monitor-active-memory", replacement: resolve(__dirname, "../abstractuic/monitor-active-memory/src") },
        { find: "@abstractuic/monitor-flow", replacement: resolve(__dirname, "../abstractuic/monitor-flow/src") },
        { find: "@abstractutils/monitor-gpu", replacement: resolve(__dirname, "../abstractuic/monitor-gpu/src") },
      ],
    },
    test: {
      environment: "node",
    },
  };
};
