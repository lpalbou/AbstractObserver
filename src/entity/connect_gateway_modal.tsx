/**
 * Sign in to the gateway — the SHARED card (ui-kit GatewaySessionSignInCard,
 * the same component AbstractFlow renders), wired for the observer.
 *
 * TWO POSTURES, decided by the HOST (entity_view detects them, the modal
 * never guesses — the 2026-07-10 regression was exactly a modal that
 * signed the browser in against a base the app then didn't use):
 *
 * - PROXY posture (the page is served by the observer CLI, which exposes
 *   POST /api/connection/gateway): the token is exchanged for a
 *   server-side gateway session + FIRST-PARTY HttpOnly cookies — the
 *   abstractflow shape. Nothing is persisted in localStorage; the cookie
 *   IS the signed-in state, and refresh re-verifies silently.
 * - DIRECT posture (a cross-origin gateway base, e.g. ?gateway= deep
 *   links): the token is verified against the operator probe and kept as
 *   the browser's Bearer credential, stored WITH the base it was verified
 *   against (a base-less credential replayed against a different base was
 *   the "asks me at every refresh" bug).
 */

import React, { useState } from "react";

import { GatewaySessionSignInCard } from "@abstractframework/ui-kit";

import { proxyConnectionLogin } from "./gateway_session";
import { classifyOperatorAuth } from "./stream_source";

export interface GatewayAuthState {
  mode: "session" | "bearer";
  userId: string;
  token: string | null; // bearer mode only
  remembered: boolean;
  /** The base this credential was VERIFIED against (bearer mode). A
   * credential without its base is a split-brain seed — never replay it
   * against a different gateway. */
  base?: string;
}

export const AUTH_STORAGE_KEY = "abstractobserver_gateway_auth";

export function loadStoredAuth(): GatewayAuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GatewayAuthState;
      // Session-mode states are NOT loaded: the proxy cookie is the truth
      // of a session sign-in (localStorage copies of it were the unusable
      // "session" credentials behind the visit-refused loop, audit V7).
      if (parsed && parsed.mode === "bearer" && parsed.token) return parsed;
      return null;
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
    // Only DIRECT-posture bearer credentials persist (the proxy session
    // lives in HttpOnly cookies — nothing to store, nothing to leak).
    if (state && state.remembered && state.mode === "bearer" && state.token) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // best-effort
  }
}

export interface ConnectGatewayModalProps {
  /** PROXY posture: sign in through the page origin's connection API;
   * the gateway base is server-pinned (no URL field). */
  proxyMode: boolean;
  /** The app's RESOLVED base (direct posture). The modal signs in against
   * exactly this — never a divergent internal default. Empty = first
   * connect with no base known yet (the URL field is shown). */
  baseUrl: string;
  onBaseUrlChange(value: string): void;
  onConnected(state: GatewayAuthState): void;
  onClose(): void;
}

export function ConnectGatewayModal({ proxyMode, baseUrl, onBaseUrlChange, onConnected, onClose }: ConnectGatewayModalProps): React.ReactElement {
  const [userId, setUserId] = useState("admin");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Direct posture only: when the app has no base yet, offer the injected
  // config, else the STANDARD gateway port — never this page's own origin
  // (the observer's static server port is not a gateway).
  const injected = (
    (window as unknown as { __ABSTRACT_UI_CONFIG__?: { gateway_url?: string } }).__ABSTRACT_UI_CONFIG__?.gateway_url || ""
  ).trim();
  const DEFAULT_GATEWAY = "http://127.0.0.1:8080";
  const effectiveUrl = proxyMode ? "" : (baseUrl || "").trim() || injected || DEFAULT_GATEWAY;

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      if (proxyMode) {
        // The abstractflow shape: one POST, server-side session, cookies.
        const login = await proxyConnectionLogin(userId.trim(), token.trim(), remember);
        if (login.ok) {
          onConnected({ mode: "session", userId: login.userId || userId.trim() || "operator", token: null, remembered: remember });
          return;
        }
        setError(login.detail || "The gateway refused this sign-in. Check the user id and token.");
        return;
      }
      // Direct posture: verify the bearer against the app's resolved base.
      const url = effectiveUrl.replace(/\/+$/, "");
      const probe = await classifyOperatorAuth(url, token.trim());
      if (probe.kind === "operator") {
        const state: GatewayAuthState = {
          mode: "bearer",
          userId: probe.probe.user_id || userId.trim() || "operator",
          token: token.trim(),
          remembered: remember,
          base: url,
        };
        storeAuth(state);
        onConnected(state);
        return;
      }
      if (probe.kind === "refused") {
        setError("The gateway refused this token (401). Check the token — and that the gateway URL is right.");
      } else {
        setError(`Could not reach the gateway: ${probe.error}`);
      }
    } catch (e) {
      setError(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
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
          description={
            proxyMode
              ? "Sign in with a Gateway user token. This browser gets an HTTP-only session on this app's own origin — you stay signed in until you disconnect."
              : "Sign in with a Gateway user token. The token stays in this browser as a Bearer credential for this gateway."
          }
          statusLabel="Signed out"
          statusTone="warn"
          tokenSourceLabel="token: missing"
          showGatewayUrl={!proxyMode}
          gatewayUrl={effectiveUrl}
          gatewayUrlPlaceholder={injected || DEFAULT_GATEWAY}
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
