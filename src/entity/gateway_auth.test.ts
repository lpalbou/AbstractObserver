/**
 * Sign-in-once contract tests (the abstractflow parity audit, 2026-07-10).
 *
 * The invariants are the CONTRACT's, not implementation details:
 * - the proxy status probe distinguishes "proxy absent" / "signed out" /
 *   "signed in" and never throws;
 * - refused (401/403) and unreachable (network/5xx) are DIFFERENT answers
 *   from the operator probe — a down gateway must never read as a revoked
 *   credential (audit V5/W1);
 * - session-mode localStorage credentials are dead (the proxy cookie is
 *   the truth); bearer credentials persist WITH their base (audit V3/V7).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadStoredAuth, storeAuth, AUTH_STORAGE_KEY, type GatewayAuthState } from "./connect_gateway_modal";
import { proxyConnectionLogin, proxyConnectionStatus, sameGatewayTarget } from "./gateway_session";
import { classifyOperatorAuth } from "./stream_source";

function mockFetchOnce(status: number, body: unknown, contentType = "application/json") {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// jsdom-free localStorage stub (tests run in node).
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy connection status (the ONE silent check)", () => {
  it("signed in: ok + principal user id", async () => {
    mockFetchOnce(200, { ok: true, has_session: true, gateway_url: "http://127.0.0.1:8080", gateway: { principal: { user_id: "albou" } } });
    const s = await proxyConnectionStatus();
    expect(s.available).toBe(true);
    expect(s.ok).toBe(true);
    expect(s.userId).toBe("albou");
  });

  it("signed out through a live proxy: available, not ok — sign-in is the answer", async () => {
    mockFetchOnce(200, { ok: false, has_session: false, gateway_url: "http://127.0.0.1:8080", gateway: { ok: false, error: "Gateway sign-in required" } });
    const s = await proxyConnectionStatus();
    expect(s.available).toBe(true);
    expect(s.ok).toBe(false);
    expect(s.hasSession).toBe(false);
  });

  it("no proxy on this origin (SPA fallback HTML): unavailable, never throws", async () => {
    mockFetchOnce(200, {}, "text/html");
    const s = await proxyConnectionStatus();
    expect(s.available).toBe(false);
  });

  it("network failure: unavailable (direct posture applies), never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const s = await proxyConnectionStatus();
    expect(s.available).toBe(false);
  });
});

describe("proxy login", () => {
  it("ok:true with principal", async () => {
    mockFetchOnce(200, { ok: true, gateway: { principal: { user_id: "albou" } } });
    const r = await proxyConnectionLogin("albou", "agw_x", true);
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("albou");
  });

  it("refused login carries the gateway's detail", async () => {
    mockFetchOnce(401, { ok: false, detail: "Invalid token" });
    const r = await proxyConnectionLogin("albou", "bad", true);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Invalid token");
  });
});

describe("operator probe classification (refused ≠ unreachable)", () => {
  it("401 = refused (sign in again)", async () => {
    mockFetchOnce(401, { detail: "Unauthorized" });
    const r = await classifyOperatorAuth("http://127.0.0.1:8080", "tok");
    expect(r.kind).toBe("refused");
  });

  it("network error = unreachable (keep the credential, no sign-in demand)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r = await classifyOperatorAuth("http://127.0.0.1:8080", "tok");
    expect(r.kind).toBe("unreachable");
  });

  it("5xx = unreachable, not a credential verdict", async () => {
    mockFetchOnce(502, { detail: "bad gateway" });
    const r = await classifyOperatorAuth("http://127.0.0.1:8080", "tok");
    expect(r.kind).toBe("unreachable");
  });

  it("200 with operator:true = operator", async () => {
    mockFetchOnce(200, { operator: true, user_id: "albou" });
    const r = await classifyOperatorAuth("http://127.0.0.1:8080", "tok");
    expect(r.kind).toBe("operator");
    if (r.kind === "operator") expect(r.probe.user_id).toBe("albou");
  });
});

describe("stored credential shape (base-bound bearer only)", () => {
  it("bearer credentials persist WITH their base and round-trip", () => {
    stubStorage();
    const state: GatewayAuthState = { mode: "bearer", userId: "op", token: "tok", remembered: true, base: "http://10.0.0.2:8080" };
    storeAuth(state);
    const loaded = loadStoredAuth();
    expect(loaded?.token).toBe("tok");
    expect(loaded?.base).toBe("http://10.0.0.2:8080");
  });

  it("session-mode states are never loaded (the proxy cookie is the truth)", () => {
    const store = stubStorage();
    store.set(AUTH_STORAGE_KEY, JSON.stringify({ mode: "session", userId: "op", token: null, remembered: true }));
    expect(loadStoredAuth()).toBeNull();
  });

  it("session-mode states are never persisted", () => {
    const store = stubStorage();
    storeAuth({ mode: "session", userId: "op", token: null, remembered: true });
    expect(store.has(AUTH_STORAGE_KEY)).toBe(false);
  });

  it("legacy token key migrates as a remembered bearer", () => {
    const store = stubStorage();
    store.set("abstractobserver_entity_token", "legacy-tok");
    const loaded = loadStoredAuth();
    expect(loaded?.mode).toBe("bearer");
    expect(loaded?.token).toBe("legacy-tok");
  });
});

describe("gateway target equivalence (loopback aliases, audit G3)", () => {
  it("localhost and 127.0.0.1 on the same port are one target", () => {
    expect(sameGatewayTarget("http://localhost:8080", "http://127.0.0.1:8080")).toBe(true);
  });

  it("different ports are different gateways", () => {
    expect(sameGatewayTarget("http://127.0.0.1:8080", "http://127.0.0.1:8081")).toBe(false);
  });

  it("different remote hosts never fold together", () => {
    expect(sameGatewayTarget("http://10.0.0.2:8080", "http://10.0.0.3:8080")).toBe(false);
  });

  it("identical origins match; malformed input never throws", () => {
    expect(sameGatewayTarget("http://10.0.0.2:8080", "http://10.0.0.2:8080")).toBe(true);
    expect(sameGatewayTarget("not a url", "http://127.0.0.1:8080")).toBe(false);
  });
});
