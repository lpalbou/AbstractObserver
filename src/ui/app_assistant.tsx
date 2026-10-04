// The observer's Docs assistant (round 8, R8.3): the kit's shared
// DocsAssistantDrawer — the same chat the console and every app mount —
// grounded on THIS app's llms.txt (the gateway reads it from this app's own
// build: `GET api/gateway/docs/corpus?app=observer`) through the gateway's
// docs-qa workflow. Conversation, attachments, streaming, history (one
// gateway session per conversation) and the replay receipt are the kit's.
//
// NOT the same surface as the run page's "Ask" tab: Ask is grounded in a
// RUN's ledger; this assistant answers questions about the APP itself.
import React, { useRef } from "react";
import { DocsAssistantDrawer, type DocsAssistantSource, type GatewayFetch } from "@abstractframework/panel-chat";
import type { GatewayClient } from "../lib/gateway_client";

export const OBSERVER_DOCS_SOURCE: DocsAssistantSource = { app: "observer", name: "AbstractObserver" };

export const OBSERVER_DOCS_SUGGESTIONS = [
  "How do I see why a run failed?",
  "Where do I find the artifacts a run produced?",
  "What does the Board's Review column mean?",
  "How do I launch a workflow on a schedule?",
];

export function AppAssistantDrawer(props: {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  topOffset: number;
  gateway: GatewayClient;
}): React.ReactElement {
  // Every request goes through the CURRENT client (auth mode can change
  // between questions): its fetch_gateway carries the bearer token or the
  // session proxy's CSRF header, joined to the configured gateway base.
  const gateway_ref = useRef(props.gateway);
  gateway_ref.current = props.gateway;
  const fetch_gateway: GatewayFetch = (path, init) => gateway_ref.current.fetch_gateway(path, init);
  return (
    <DocsAssistantDrawer
      open={props.open}
      onClose={props.onClose}
      source={OBSERVER_DOCS_SOURCE}
      fetchGateway={fetch_gateway}
      connected={props.connected}
      topOffset={props.topOffset}
      placeholder="Ask about the observer…"
      suggestions={OBSERVER_DOCS_SUGGESTIONS}
    />
  );
}
