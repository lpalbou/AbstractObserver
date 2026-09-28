/**
 * The app server's own same-origin paths, RELATIVE to the document base.
 *
 * The Observer is served at `/` (standalone) or through the gateway at
 * `/apps/observer/`; the app server puts `<base href="<basePath>/">` in the
 * page (`injectShell`), so a relative path resolves under the right prefix in
 * both. A leading `/` would escape the mount and reach the gateway's own
 * routes instead. Gateway API paths are the kit's `gatewayApiPath(...)`,
 * joined by `joinBaseUrl` (ui-kit gateway_paths), in the Observer's client
 * as in every kit client.
 */

/** Local folder reveal (bin/cli.js; loopback browsers only). */
export const REVEAL_PATH = "api/local/reveal";
/** The service worker, registered relative so its scope is the app's base. */
export const SERVICE_WORKER_PATH = "sw.js";

/**
 * A run id from the address: the last hash segment, else the last path
 * segment (a uuid), wherever the app is mounted (`/`, `/apps/observer/`).
 */
export function run_id_from_location(loc: { hash: string; pathname: string }): string {
  const is_uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const last = (s: string) => {
    const parts = s.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1].trim() : "";
  };
  const from_hash = last(String(loc.hash || "").replace(/^#/, ""));
  if (is_uuid(from_hash)) return from_hash;
  const from_path = last(String(loc.pathname || ""));
  return is_uuid(from_path) ? from_path : "";
}
