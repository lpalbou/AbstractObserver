// About AbstractObserver: the shared ui-kit About dialog, fed with this app's
// build-time version and the versions the connected gateway reports.
import { appIdentity, type AppIdentity } from "@abstractframework/ui-kit";

import type { GatewayAbout, GatewayClient } from "../lib/gateway_client";

export type AboutRow = [string, string];

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

/** Rows for the gateway half of the About dialog, in a stable order:
 * gateway, AbstractFramework on the gateway host, then every other package. */
export function gateway_about_rows(about: GatewayAbout): AboutRow[] {
  const rows: AboutRow[] = [["Gateway", `AbstractGateway ${String(about?.abstractgateway ?? "").trim() || "(version not reported)"}`]];
  const framework = about?.abstractframework;
  rows.push(["Gateway framework", framework ? `AbstractFramework ${framework}` : "AbstractFramework not installed on the gateway host"]);
  const packages = about?.packages && typeof about.packages === "object" ? about.packages : {};
  for (const name of Object.keys(packages).sort()) {
    if (name === "abstractgateway" || name === "abstractframework") continue;
    rows.push([name, String(packages[name])]);
  }
  return rows;
}

/** Fetch the gateway versions; on failure return ONE row that says why. */
export async function load_gateway_about_rows(client: Pick<GatewayClient, "gateway_about">): Promise<AboutRow[]> {
  try {
    return gateway_about_rows(await client.gateway_about());
  } catch (e) {
    const reason = e instanceof Error ? e.message || e.name : String(e);
    return [["Gateway", `unavailable (${reason})`]];
  }
}
