import { describe, expect, it } from "vitest";

import { gateway_error } from "./gateway_client";
import { ask_error_text } from "../ui/format";

describe("gateway_error: the gateway's reason, never a generic failure", () => {
  it("reads a FastAPI string detail (the Ask failure of the 2026-09-28 field report)", async () => {
    const r = new Response(JSON.stringify({ detail: "Failed to generate chat answer: Unknown provider: endpoint:vpsllm." }), { status: 400 });
    const e = await gateway_error(r, "The gateway could not answer");
    expect(e.status).toBe(400);
    expect(e.message).toBe("The gateway could not answer (HTTP 400): Failed to generate chat answer: Unknown provider: endpoint:vpsllm.");
    expect(ask_error_text(e)).toContain("Unknown provider: endpoint:vpsllm");
  });

  it("reads a structured {message, reason_code} detail", async () => {
    const r = new Response(JSON.stringify({ detail: { reason_code: "csrf_required", message: "Gateway browser session CSRF token missing or invalid" } }), { status: 403 });
    expect((await gateway_error(r, "x")).message).toBe("x (HTTP 403): Gateway browser session CSRF token missing or invalid");
  });

  it("falls back to the body text, then the status text", async () => {
    expect((await gateway_error(new Response("upstream down", { status: 502 }), "x")).message).toBe("x (HTTP 502): upstream down");
    expect((await gateway_error(new Response("", { status: 504, statusText: "Gateway Timeout" }), "x")).message).toBe("x (HTTP 504): Gateway Timeout");
  });
});

describe("an aborted fetch says WHY (operator 2026-10-16 01:59: three 'Fetch is aborted' banners read as the run's errors)", () => {
  it("a deadline becomes GatewayTimeout with the route and the seconds; our own abort becomes Superseded; other errors pass through", async () => {
    const { GatewayClient, GatewayTimeout, Superseded } = await import("./gateway_client");
    const original = globalThis.fetch;
    try {
      // The deadline: the signal's reason is a TimeoutError (WebKit and Chromium alike).
      globalThis.fetch = (async (_url: any, init: any) => {
        const reason = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
        Object.defineProperty(init.signal, "reason", { value: reason, configurable: true });
        throw Object.assign(new Error("Fetch is aborted"), { name: "AbortError" });
      }) as any;
      const c = new GatewayClient({ base_url: "http://127.0.0.1:8080", auth_token: "" } as any);
      const err = await c.list_runs({ status: "running", limit: 5 }).catch((e) => e);
      expect(err).toBeInstanceOf(GatewayTimeout);
      expect(err.name).toBe("GatewayTimeout");
      expect(err.message).toMatch(/^GET \/api\/gateway\/runs\?[^:]*status=running[^:]*: no answer within 30 s — the gateway is busy$/);
      // Our own abort: the reason is a plain AbortError.
      globalThis.fetch = (async () => {
        throw Object.assign(new Error("Fetch is aborted"), { name: "AbortError" });
      }) as any;
      const sup = await c.list_runs({ status: "waiting", limit: 5 }).catch((e) => e);
      expect(sup).toBeInstanceOf(Superseded);
      expect(sup.message).toMatch(/superseded$/);
      // Anything else is untouched.
      globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch");
      }) as any;
      const other = await c.list_runs({ status: "waiting", limit: 5 }).catch((e) => e);
      expect(other).toBeInstanceOf(TypeError);
    } finally {
      globalThis.fetch = original;
    }
  });
});
