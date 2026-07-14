import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("hosted Gateway auth UX", () => {
  it("does not persist the Gateway token in observer settings", () => {
    const src = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(src).toContain('JSON.stringify({ ...s, auth_token: "" })');
  });

  it("sign-in rides the SHARED uic modal (flow/console parity), never a local token form", () => {
    const src = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(src).toContain("GatewayConnectModal");
    expect(src).toContain("handle_connection_status");
    // The settings copy states the contract in words.
    expect(src).toContain("exchanges for an HTTP-only browser");
    // B5 (2026-07-13): the uic hook IS the connection machine — the app
    // never hand-rolls boot-probe/auto-open/close-on-status again.
    expect(src).toContain("useGatewayConnection");
    expect(src).toContain("gateway_connection.modalProps");
  });
});
