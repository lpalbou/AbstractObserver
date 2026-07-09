import React from "react";
import ReactDOM from "react-dom/client";

// The ui-kit theme MUST load here too (maintainer incident 2026-07-09: the
// sign-in card is the SAME component AbstractFlow renders, but this entry
// never imported its stylesheet — the card rendered as bare unstyled HTML).
import "@abstractframework/ui-kit/theme.css";
import "@abstractframework/panel-chat/panel_chat.css";

import { EntityView } from "./entity_view";
import { ErrorBoundary } from "./error_boundary";
import "./entity.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="the entity app">
      <EntityView />
    </ErrorBoundary>
  </React.StrictMode>,
);
