import React from "react";
import ReactDOM from "react-dom/client";

// The ui-kit theme MUST load here too (maintainer incident 2026-07-09: the
// sign-in card is the SAME component AbstractFlow renders, but this entry
// never imported its stylesheet — the card rendered as bare unstyled HTML).
import "@abstractframework/ui-kit/theme.css";
import { applyTheme } from "@abstractframework/ui-kit";
import "@abstractframework/panel-chat/panel_chat.css";

import { EntityView } from "./entity_view";
import { ErrorBoundary } from "./error_boundary";
import "./entity.css";

// The entity app's palette is a REGISTERED kit theme (contributed to
// abstractuic 2026-07-10) — applying it here makes every kit component
// (sign-in card, pickers) match the app chrome instead of defaulting to
// another app's colors.
applyTheme("observer-night");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="the entity app">
      <EntityView />
    </ErrorBoundary>
  </React.StrictMode>,
);
