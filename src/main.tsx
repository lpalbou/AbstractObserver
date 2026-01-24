import React from "react";
import ReactDOM from "react-dom/client";

import "reactflow/dist/style.css";

import { App } from "./ui/app";
import "./ui/styles.css";

// Register service worker (PWA shell cache).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Service workers are great for PWA installs, but they can make local dev feel "cached".
    // In dev we proactively unregister any existing SW and clear its caches.
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      }
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.update())
      .catch(() => {
        // Best-effort. On iOS/Safari this can fail in some contexts.
      });
  });

  // When a new SW takes control, reload once to ensure we pick up the newest UI bundle.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
