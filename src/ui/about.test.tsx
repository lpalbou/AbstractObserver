import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AfAboutDialog, AfTopBarActions, aboutVersionsFromGateway } from "@abstractframework/ui-kit";

import { GatewayClient } from "../lib/gateway_client";
import { RuntimeInlinePreview } from "./artifact_previews";
import { ABOUT_VERSIONS_LOADING, app_version, load_gateway_about_versions, observer_identity } from "./about";

// Wrap the kit's helper (behaviour unchanged) so the tests can prove the
// versions come from it and not from a local copy.
vi.mock("@abstractframework/ui-kit", async (importOriginal) => {
  const kit = await importOriginal<typeof import("@abstractframework/ui-kit")>();
  return { ...kit, aboutVersionsFromGateway: vi.fn(kit.aboutVersionsFromGateway) };
});

/** A client whose `gateway_about` answers `body` (no network). */
function answering(body: any) {
  return { gateway_about: async () => body };
}

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
        about={{ identity: observer_identity(), versions: ABOUT_VERSIONS_LOADING }}
        connection={{ phase: "connected", onConnect: () => {}, onDisconnect: () => {} }}
      />
    );
    expect(html).toContain("af-topbar__btn--about");
    expect(html).toContain('aria-label="About AbstractObserver"');
    // Closed until the user clicks it.
    expect(html).not.toContain('role="dialog"');
  });

  it("shows name + version, framework + gateway versions, six links and the licence line; never a package list", async () => {
    const versions = await load_gateway_about_versions(answering({
      abstractframework: "0.3.3",
      abstractgateway: "0.4.4",
      packages: { abstractgateway: "0.4.4", abstractruntime: "0.4.36", abstractcore: "2.15.3" },
    }));
    const html = unescape(
      renderToStaticMarkup(<AfAboutDialog open onClose={() => {}} identity={observer_identity()} versions={versions} />)
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain(`AbstractObserver <span class="af-about-card__version">${PKG_VERSION}</span>`);
    expect(html).toContain("<dt>AbstractFramework</dt><dd>0.3.3</dd>");
    expect(html).toContain("<dt>AbstractGateway</dt><dd>0.4.4</dd>");
    expect(html).toContain("© 2023-2026 Laurent-Philippe Albou, PhD. Released under the MIT License.");

    const links = [...html.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/g)].map((m) => m[1]);
    expect(links).toEqual([
      "https://abstractframework.ai/observer",
      "https://github.com/lpalbou/AbstractObserver",
      "https://github.com/lpalbou/AbstractObserver#readme",
      "https://github.com/lpalbou/AbstractObserver/issues",
      "https://github.com/lpalbou/AbstractObserver/issues/new?labels=feedback",
    ]);
    expect(html).toContain('href="mailto:contact@abstractframework.ai"');

    // No package list (operator rule): no other package or its version.
    for (const banned of ["Gateway package", "abstractruntime", "0.4.36", "2.15.3"]) expect(html).not.toContain(banned);
    expect(versions).toEqual({ framework: "0.3.3", gateway: "0.4.4" });
  });

  it("says when AbstractFramework is not installed on the gateway host", async () => {
    const versions = await load_gateway_about_versions(answering({ abstractframework: null, abstractgateway: "0.4.4", packages: { abstractvoice: null } }));
    expect(versions.framework).toBeNull();
    expect(versions.gateway).toBe("0.4.4");
    const html = renderToStaticMarkup(<AfAboutDialog open onClose={() => {}} identity={observer_identity()} versions={versions} />);
    expect(html).toContain("<dt>AbstractFramework</dt><dd>not installed on the gateway host</dd>");
  });

  it("uses the kit helper", async () => {
    const body = { abstractframework: "0.3.3", abstractgateway: "0.4.4", packages: {} };
    vi.mocked(aboutVersionsFromGateway).mockClear();
    await load_gateway_about_versions(answering(body));
    expect(vi.mocked(aboutVersionsFromGateway)).toHaveBeenCalledWith(body);
    await load_gateway_about_versions({ gateway_about: async () => { throw new Error("HTTP 502"); } });
    expect(vi.mocked(aboutVersionsFromGateway)).toHaveBeenLastCalledWith(null, "HTTP 502");
  });

  it("fetches GET /api/gateway/about through the gateway client", async () => {
    const fetch_mock = vi.fn(async () =>
      new Response(JSON.stringify({ abstractframework: "0.3.3", abstractgateway: "0.4.4", packages: {} }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch_mock);
    const versions = await load_gateway_about_versions(new GatewayClient({ base_url: "http://gw.example:8080/", auth_token: "t" }));
    expect(fetch_mock).toHaveBeenCalledTimes(1);
    const [url, init] = fetch_mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gw.example:8080/api/gateway/about");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(versions).toEqual({ framework: "0.3.3", gateway: "0.4.4" });
  });

  it("says the gateway is unavailable with the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const versions = await load_gateway_about_versions(new GatewayClient({ base_url: "" }));
    expect(versions.gatewayNote).toBe("unavailable (HTTP 404)");
    const html = renderToStaticMarkup(<AfAboutDialog open onClose={() => {}} identity={observer_identity()} versions={versions} />);
    expect(html).toContain("<dd>unavailable (HTTP 404)</dd>");
  });

  it("says the gateway is unavailable with the network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect((await load_gateway_about_versions(new GatewayClient({ base_url: "" }))).gatewayNote).toBe("unavailable (Failed to fetch)");
  });

  it("app.tsx passes the versions (with a checking… note while loading), never rows", () => {
    const src = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    expect(src).toContain("about={{ identity: about_identity, versions: about_versions, onOpen: refresh_about_versions }}");
    expect(src).not.toMatch(/extraRows|gatewayVersionRows/);
    expect(ABOUT_VERSIONS_LOADING.gatewayNote).toBe("checking…");
  });
});

describe("audio artifacts play in the kit waveform player", () => {
  it("the inline preview renders AfAudioPlayer, not a bare <audio controls>", () => {
    const html = renderToStaticMarkup(
      <RuntimeInlinePreview
        artifact={{ artifact_id: "a1", content_type: "audio/wav", metadata: { filename: "voice.wav" } } as any}
        preview={{ loading: false, error: "", kind: "audio", url: "blob:x", text: "" } as any}
      />
    );
    expect(html).toContain('class="af-audio runtime_inline_preview audio"');
    expect(html).toContain('role="slider"');
    expect(html).not.toContain("controls");
  });

  it("the preview modal in app.tsx uses AfAudioPlayer", () => {
    const src = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    expect(src).toContain('<AfAudioPlayer className="runtime_preview_media" src={runtime_preview_url}');
    expect(src).not.toMatch(/<audio[^>]*controls/);
  });
});
