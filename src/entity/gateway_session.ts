/**
 * The app-origin gateway session (the abstractflow shape, maintainer
 * ruling 2026-07-10 22:5x: "it should ask only after i disconnect or on
 * first connect — like ../abstractflow/. BUT once i am signed in, stop
 * asking me again!").
 *
 * When the entity app is served by the observer CLI (bin/cli.js), the
 * SAME ORIGIN exposes a session proxy:
 *
 *   GET    /api/connection/gateway  -> {ok, gateway_url, has_session, gateway:{principal}}
 *   POST   /api/connection/gateway  {gateway_user_id, gateway_token, persist}
 *   DELETE /api/connection/gateway  (sign out)
 *
 * The proxy signs into the gateway server-side, keeps the gateway session
 * + CSRF, and sets FIRST-PARTY cookies (HttpOnly session id + a readable
 * CSRF cookie). Every subsequent /api/gateway/* call rides the page
 * origin with cookies; the proxy attaches the gateway session and CSRF
 * headers and STRIPS any Authorization header — which is exactly why the
 * entity app's old direct-bearer flow could never work through it: the
 * browser was verified against one base while every data call targeted
 * another (the split-brain the maintainer hit as "asking me every time" +
 * "did not accept this session for the visit").
 *
 * Sign-in-once semantics come from the cookie, not localStorage: on
 * refresh, ONE silent GET answers "still signed in?" and the modal opens
 * only on a definitive no.
 */

export interface ProxyConnectionStatus {
  /** The proxy route exists on this origin (served by the observer CLI). */
  available: boolean;
  /** A server-side gateway session exists AND the gateway confirmed it. */
  ok: boolean;
  hasSession: boolean;
  gatewayUrl: string;
  userId: string | null;
  detail: string | null;
}

function principalUserId(payload: unknown): string | null {
  const p = payload as { gateway?: { principal?: { user_id?: unknown } }; principal?: { user_id?: unknown } } | null;
  const raw = p?.gateway?.principal?.user_id ?? p?.principal?.user_id;
  const id = typeof raw === "string" ? raw.trim() : "";
  return id || null;
}

/** ONE wording for door refusals across the entity app (adversary find,
 * 2026-07-11: three components carried three different conflations of
 * 401/403). 401 = the credential is missing/dead (sign in). 403 = the door
 * KNOWS who you are and refuses anyway (authorization — CSRF today; the
 * config-object plan's N1 admin-gating will add "non-admin on an entity
 * mutation"). Conflating them reads as a credential failure and sends the
 * operator to a pointless re-login. The gateway's own 403s always carry a
 * human-written detail; a no-detail 403 is an intermediary's — say only
 * what we know, never diagnose a body we didn't get. */
export function authRefusedMsg(status: number | undefined, detail?: string): string {
  if (status === 403) {
    const text = (detail ?? "").trim();
    // An HTML error page from a proxy is not a sentence — don't banner it.
    if (text && !text.startsWith("<") && text.length <= 240) {
      return `The door refused: ${text}`;
    }
    return "The door refused this action (HTTP 403) — your sign-in is valid, but the door did not allow the change.";
  }
  return "The door refused: operator sign-in required.";
}

/** One silent check: is this browser already signed in through the
 * app-origin proxy? `available:false` means the route does not exist here
 * (direct-gateway posture applies); never throws. */
export async function proxyConnectionStatus(): Promise<ProxyConnectionStatus> {
  const none: ProxyConnectionStatus = { available: false, ok: false, hasSession: false, gatewayUrl: "", userId: null, detail: null };
  try {
    const res = await fetch("/api/connection/gateway", { credentials: "include", headers: { Accept: "application/json" } });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return none; // SPA fallback page = no proxy
    const payload = (await res.json()) as { ok?: boolean; gateway_url?: string; has_session?: boolean; detail?: string; gateway?: unknown };
    if (!res.ok && res.status !== 200) {
      // The route exists (it answered JSON) but refused — treat as signed out.
      return { available: true, ok: false, hasSession: false, gatewayUrl: String(payload.gateway_url || ""), userId: null, detail: String(payload.detail || "") || null };
    }
    return {
      available: true,
      ok: payload.ok === true,
      hasSession: payload.has_session === true,
      gatewayUrl: String(payload.gateway_url || ""),
      userId: principalUserId(payload),
      detail: typeof payload.detail === "string" ? payload.detail : null,
    };
  } catch {
    return none;
  }
}

/** Establish the server-side gateway session (the ONE sign-in). The proxy
 * pins its own gateway URL (a browser cannot redirect it without an
 * explicit allow flag), so no URL rides the request. */
export async function proxyConnectionLogin(
  userId: string,
  token: string,
  persist: boolean,
): Promise<{ ok: boolean; userId: string | null; detail: string | null }> {
  try {
    const res = await fetch("/api/connection/gateway", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ gateway_user_id: userId, gateway_token: token, persist }),
    });
    const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; gateway?: unknown };
    if (!res.ok || payload.ok !== true) {
      return { ok: false, userId: null, detail: String(payload.detail || `sign-in failed (HTTP ${res.status})`) };
    }
    return { ok: true, userId: principalUserId(payload) ?? userId, detail: null };
  } catch (e) {
    return { ok: false, userId: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Sign out of the proxy session (clears the first-party cookies and logs
 * the server-side gateway session out). NOTE: the main observer app and
 * the entity app share this origin's cookies — one browser, one session
 * (the ONE-LOGIN consolidation); disconnecting here disconnects both. */
export async function proxyConnectionLogout(): Promise<void> {
  try {
    await fetch("/api/connection/gateway", { method: "DELETE", credentials: "include" });
  } catch {
    // signing out of a dead proxy is still signing out
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Do two ABSOLUTE gateway URLs name the same target? Origin equality,
 * plus loopback-alias equivalence (localhost vs 127.0.0.1 resolve to the
 * same interface — refresh-audit gap G3: string comparison silently
 * dropped ?gateway=http://localhost:8080 out of the proxy posture the
 * injected http://127.0.0.1:8080 config covers). */
export function sameGatewayTarget(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.origin === ub.origin) return true;
    if (ua.protocol !== ub.protocol) return false;
    const portOf = (u: URL) => u.port || (u.protocol === "https:" ? "443" : "80");
    return LOOPBACK_HOSTS.has(ua.hostname) && LOOPBACK_HOSTS.has(ub.hostname) && portOf(ua) === portOf(ub);
  } catch {
    return false;
  }
}
