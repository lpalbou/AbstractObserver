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
