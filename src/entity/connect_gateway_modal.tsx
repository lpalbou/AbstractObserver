/**
 * Sign in to the gateway — the SHARED card (ui-kit GatewaySessionSignInCard,
 * the same component AbstractFlow renders), wired for the observer:
 *
 * - USERS-MODE gateways (same-origin deployments): exchanges the token for
 *   the HTTP-only browser session via /api/gateway/session/login.
 * - LEGACY-TOKEN gateways (dev; and any cross-origin setup where the
 *   session cookie cannot travel): verifies the token against the operator
 *   probe and keeps it as the browser's Bearer credential.
 *
 * "Keep this browser signed in" persists the credential in localStorage;
 * Disconnect clears it (and logs the session out where one exists).
 */

import React, { useState } from "react";

import { GatewaySessionSignInCard } from "@abstractframework/ui-kit";

import { probeOperatorAuth } from "./stream_source";

export interface GatewayAuthState {
  mode: "session" | "bearer";
  userId: string;
  token: string | null; // bearer mode only
  remembered: boolean;
}

export const AUTH_STORAGE_KEY = "abstractobserver_gateway_auth";

export function loadStoredAuth(): GatewayAuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GatewayAuthState;
      if (parsed && (parsed.mode === "bearer" || parsed.mode === "session")) return parsed;
    }
    // Legacy migration: the old controls-strip token field persisted under
    // its own key — adopt it as a remembered bearer credential so nobody is
    // signed out by the upgrade.
    const legacy = (localStorage.getItem("abstractobserver_entity_token") || "").trim();
    if (legacy) return { mode: "bearer", userId: "operator", token: legacy, remembered: true };
  } catch {
    // presentation state only
  }
  return null;
}

export function storeAuth(state: GatewayAuthState | null): void {
  try {
    if (state && state.remembered) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

async function sessionLogin(baseUrl: string, userId: string, token: string, remember: boolean): Promise<boolean> {
  const res = await fetch(`${baseUrl}/api/gateway/session/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ user_id: userId, token, remember }),
  });
  return res.ok;
}

export async function sessionLogout(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/gateway/session/logout`, { method: "POST", credentials: "include" });
  } catch {
    // signing out of a dead gateway is still signing out
  }
}

export interface ConnectGatewayModalProps {
  baseUrl: string;
  onBaseUrlChange(value: string): void;
  onConnected(state: GatewayAuthState): void;
  onClose(): void;
}

export function ConnectGatewayModal({ baseUrl, onBaseUrlChange, onConnected, onClose }: ConnectGatewayModalProps): React.ReactElement {
  const [userId, setUserId] = useState("admin");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The gateway URL must default to THIS deployment's gateway (maintainer
  // incident 2026-07-09: a retired gateway's URL survived as the visible
  // default). Same-origin proxy first (the AbstractFlow shape), the
  // cli-injected config next; a hardcoded historical port never.
  const injected = (
    (window as unknown as { __ABSTRACT_UI_CONFIG__?: { gateway_url?: string } }).__ABSTRACT_UI_CONFIG__?.gateway_url || ""
  ).trim();
  const effectiveUrl = (baseUrl || "").trim() || injected || window.location.origin;

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    const url = effectiveUrl.replace(/\/+$/, "");
    try {
      // Same-origin gateways get the HTTP-only session (the flow shape);
      // cross-origin (the observer's usual posture) keeps the Bearer path —
      // a Lax cookie never travels cross-site, honesty over pretense.
      const sameOrigin = new URL(url, window.location.href).origin === window.location.origin;
      if (sameOrigin && (await sessionLogin(url, userId.trim(), token.trim(), remember))) {
        const state: GatewayAuthState = { mode: "session", userId: userId.trim(), token: null, remembered: remember };
        storeAuth(state);
        onConnected(state);
        return;
      }
      const probe = await probeOperatorAuth(url, token.trim());
      if (probe?.operator) {
        const state: GatewayAuthState = {
          mode: "bearer",
          userId: probe.user_id || userId.trim() || "operator",
          token: token.trim(),
          remembered: remember,
        };
        storeAuth(state);
        onConnected(state);
        return;
      }
      setError("The gateway refused this token (401). Check the token — and that the gateway URL is right.");
    } catch (e) {
      setError(`Could not reach the gateway: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="ev_backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ev_panel cgm_panel">
        <GatewaySessionSignInCard
          kicker="Observer connection"
          title="Connect this browser to AbstractGateway"
          description="Sign in with a Gateway user token. Same-origin gateways get an HTTP-only browser session; otherwise the token stays in this browser as a Bearer credential."
          statusLabel="Signed out"
          statusTone="warn"
          tokenSourceLabel="token: missing"
          showGatewayUrl
          gatewayUrl={effectiveUrl}
          gatewayUrlPlaceholder={injected || window.location.origin}
          onGatewayUrlChange={onBaseUrlChange}
          userId={userId}
          onUserIdChange={setUserId}
          token={token}
          onTokenChange={setToken}
          showToken={showToken}
          onShowTokenChange={setShowToken}
          remember={remember}
          rememberLabel="Keep this browser signed in"
          onRememberChange={setRemember}
          submitting={submitting}
          error={error}
          showClose
          onClose={onClose}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}
