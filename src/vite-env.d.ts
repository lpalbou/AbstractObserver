/// <reference types="vite/client" />

import type React from "react";

declare global {
  /** AbstractObserver's package.json version, injected at build time by the
   * vite/vitest configs (`define`). Read it through `app_version()`. */
  const __APP_VERSION__: string;

  interface Window {
    __ABSTRACT_UI_CONFIG__?: {
      monitor_gpu?: boolean;
      /** THIS deployment's gateway (bin/cli.js injection) — a DISPLAY
       * default for direct-posture connect surfaces; through the app-origin
       * proxy the browser never dials it directly. */
      gateway_url?: string;
      /** Where the entity app lives (its own package since 2026-07-12);
       * drives the "Entities ↗" links. bin/cli.js injects it from
       * ABSTRACTOBSERVER_ENTITY_APP_URL. */
      entity_app_url?: string;
    };
  }

  namespace JSX {
    interface IntrinsicElements {
      "monitor-gpu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        mode?: string;
        "base-url"?: string;
        "tick-ms"?: string;
        "history-size"?: string;
        endpoint?: string;
      };
    }
  }
}

export {};
