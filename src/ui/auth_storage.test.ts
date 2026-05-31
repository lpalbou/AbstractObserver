import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("hosted Gateway auth UX", () => {
  it("does not persist the Gateway token in observer settings", () => {
    const src = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(src).toContain('JSON.stringify({ ...s, auth_token: "" })');
    expect(src).toContain("Hosted sign-in exchanges this token for a browser session");
  });
});
