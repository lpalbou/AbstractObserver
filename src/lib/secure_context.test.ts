import { afterEach, describe, expect, it, vi } from "vitest";

import { random_id } from "./ids";
import { clipboardWrite, mediaAvailable, MEDIA_NEEDS_HTTPS } from "./secure-context";

// Plain http from another machine (LAN, Tailscale) is not a secure context:
// the browser withholds crypto.randomUUID, crypto.subtle, navigator.clipboard
// and getUserMedia. These tests run the app's id, session-memory and copy
// paths with those APIs removed.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

function withoutSecureCrypto(): void {
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a) },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true, writable: true });
  vi.unstubAllGlobals();
});

describe("non-secure context (plain http)", () => {
  it("random_id returns distinct v4 UUIDs without crypto.randomUUID", () => {
    withoutSecureCrypto();
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined();
    const ids = Array.from({ length: 10000 }, () => random_id());
    expect(ids.every((x) => V4.test(x))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the session memory run id is the same without crypto.subtle", async () => {
    const { session_memory_run_id } = await import("../ui/app");
    const sid = "session id with spaces / and ✓";
    const withSubtle = await session_memory_run_id(sid);
    withoutSecureCrypto();
    expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined();
    expect(await session_memory_run_id(sid)).toBe(withSubtle);
    expect(withSubtle).toMatch(/^session_memory_sha_[0-9a-f]{32}$/);
  });

  it("clipboardWrite falls back to execCommand and reports its result", async () => {
    const textarea = { value: "", style: {}, setAttribute() {}, select() {}, setSelectionRange() {} };
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { body: { appendChild() {}, removeChild() {} }, activeElement: null, createElement: () => textarea, execCommand });
    expect(await clipboardWrite("run-123")).toBe(true);
    expect(textarea.value).toBe("run-123");
    execCommand.mockReturnValue(false);
    expect(await clipboardWrite("run-123")).toBe(false);
  });

  it("mediaAvailable is false without getUserMedia and the sentence says why", () => {
    vi.stubGlobal("navigator", {});
    expect(mediaAvailable()).toBe(false);
    // The sentence itself (http: the kit's; secure context: browser lacks it): media_sentence.test.ts.
    expect(MEDIA_NEEDS_HTTPS).toContain("getUserMedia unavailable");
  });
});
