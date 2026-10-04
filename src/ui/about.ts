// About AbstractObserver: the shared ui-kit About (compact card, ui-kit
// 0.7.0), fed with this app's build-time version and the framework + gateway
// versions the connected gateway reports. No package list (operator rule).
import { aboutVersionsFromGateway, appIdentity, type AfAboutVersions, type AppIdentity } from "@abstractframework/ui-kit";

import type { GatewayClient } from "../lib/gateway_client";

export type { AfAboutVersions };

/** Shown while `GET /api/gateway/about` is in flight. */
export const ABOUT_VERSIONS_LOADING: AfAboutVersions = { framework: null, gateway: null, gatewayNote: "checking…" };

/** The package.json version injected at build time (`__APP_VERSION__`).
 * Throws when the build did not define it: the About dialog never shows a
 * made-up version. */
export function app_version(): string {
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__.trim() : "";
  if (!version) {
    throw new Error("AbstractObserver: __APP_VERSION__ is not defined; the vite/vitest config must inject it from package.json");
  }
  return version;
}

export function observer_identity(): AppIdentity {
  return appIdentity("abstractobserver", app_version());
}

/** Fetch the gateway's framework + gateway versions with the kit's
 * `aboutVersionsFromGateway` (the same facts in every app). Never throws: on
 * failure the gateway version reads "unavailable (<reason>)". */
export async function load_gateway_about_versions(client: Pick<GatewayClient, "gateway_about">): Promise<AfAboutVersions> {
  let about: Awaited<ReturnType<GatewayClient["gateway_about"]>>;
  try {
    about = await client.gateway_about();
  } catch (e) {
    return aboutVersionsFromGateway(null, e instanceof Error ? e.message || e.name : String(e));
  }
  return aboutVersionsFromGateway(about);
}
