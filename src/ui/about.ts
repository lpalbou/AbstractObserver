// About AbstractObserver: the shared ui-kit About dialog, fed with this app's
// build-time version and the versions the connected gateway reports.
import { appIdentity, gatewayVersionRows, type AboutRow, type AppIdentity } from "@abstractframework/ui-kit";

import type { GatewayClient } from "../lib/gateway_client";

export type { AboutRow };

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

/** Fetch the gateway versions and format them with the kit's
 * `gatewayVersionRows` (the same rows in every app). Never throws: on failure
 * the result is ONE "Gateway: unavailable (<reason>)" row. */
export async function load_gateway_about_rows(client: Pick<GatewayClient, "gateway_about">): Promise<AboutRow[]> {
  let about: Awaited<ReturnType<GatewayClient["gateway_about"]>>;
  try {
    about = await client.gateway_about();
  } catch (e) {
    return gatewayVersionRows({ error: e instanceof Error ? e.message || e.name : String(e) });
  }
  return gatewayVersionRows(about);
}
