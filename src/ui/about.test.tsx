import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AfAboutDialog, AfTopBarActions } from "@abstractframework/ui-kit";

import { GatewayClient } from "../lib/gateway_client";
import { app_version, gateway_about_rows, load_gateway_about_rows, observer_identity } from "./about";

const PKG_VERSION: string = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")).version;

function unescape(html: string): string {
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

describe("About AbstractObserver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the package.json version injected at build time", () => {
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(app_version()).toBe(PKG_VERSION);
    expect(observer_identity().version).toBe(PKG_VERSION);
    expect(observer_identity().name).toBe("AbstractObserver");
  });

  it("adds an About action to the top bar", () => {
    const html = renderToStaticMarkup(
      <AfTopBarActions
        appearance={{ onOpen: () => {} }}
        about={{ identity: observer_identity(), extraRows: [] }}
        connection={{ phase: "connected", onConnect: () => {}, onDisconnect: () => {} }}
      />
    );
    expect(html).toContain("af-topbar__btn--about");
    expect(html).toContain('aria-label="About AbstractObserver"');
    // Closed until the user clicks it.
    expect(html).not.toContain('role="dialog"');
  });

  it("shows the app, framework, author, links and gateway rows", () => {
    const extra = gateway_about_rows({
      abstractframework: "0.3.3",
      abstractgateway: "0.4.4",
      packages: { abstractgateway: "0.4.4", abstractruntime: "0.4.36", abstractcore: "2.15.3" },
    });
    const html = unescape(
      renderToStaticMarkup(<AfAboutDialog open onClose={() => {}} identity={observer_identity()} extraRows={extra} />)
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("About AbstractObserver");
    expect(html).toContain(`AbstractObserver ${PKG_VERSION}`);
    expect(html).toContain("AbstractFramework — https://abstractframework.ai");
    expect(html).toContain("Laurent-Philippe Albou, PhD (2023-2026)");

    const links = [...html.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/g)].map((m) => m[1]);
    expect(links).toEqual([
      "https://abstractframework.ai/observer",
      "https://github.com/lpalbou/AbstractObserver",
      "https://github.com/lpalbou/AbstractObserver#readme",
      "https://github.com/lpalbou/AbstractObserver/issues",
      "https://github.com/lpalbou/AbstractObserver/issues/new?labels=feedback",
    ]);

    expect(html).toContain("AbstractGateway 0.4.4");
    expect(html).toContain("AbstractFramework 0.3.3");
    // Remaining packages sorted, the gateway not listed twice.
    expect(html.indexOf("abstractcore")).toBeLessThan(html.indexOf("abstractruntime"));
    expect(html).not.toContain(">abstractgateway<");
  });

  it("says when AbstractFramework is not installed on the gateway host", () => {
    const rows = gateway_about_rows({ abstractframework: null, abstractgateway: "0.4.4", packages: {} });
    expect(rows).toEqual([
      ["Gateway", "AbstractGateway 0.4.4"],
      ["Gateway framework", "AbstractFramework not installed on the gateway host"],
    ]);
  });

  it("fetches GET /api/gateway/about through the gateway client", async () => {
    const fetch_mock = vi.fn(async () =>
      new Response(JSON.stringify({ abstractframework: "0.3.3", abstractgateway: "0.4.4", packages: {} }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch_mock);
    const rows = await load_gateway_about_rows(new GatewayClient({ base_url: "http://gw.example:8080/", auth_token: "t" }));
    expect(fetch_mock).toHaveBeenCalledTimes(1);
    const [url, init] = fetch_mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gw.example:8080/api/gateway/about");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(rows[0]).toEqual(["Gateway", "AbstractGateway 0.4.4"]);
  });

  it("shows one 'unavailable' row with the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    expect(await load_gateway_about_rows(new GatewayClient({ base_url: "" }))).toEqual([["Gateway", "unavailable (HTTP 404)"]]);
  });

  it("shows one 'unavailable' row with the network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await load_gateway_about_rows(new GatewayClient({ base_url: "" }))).toEqual([["Gateway", "unavailable (Failed to fetch)"]]);
  });
});
