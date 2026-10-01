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
 * The run deep link: `#run/<run_id>` opens that run in Observe. A hash route,
 * so it works wherever the app is mounted (`/`, the gateway's `/apps/observer/`)
 * and the app server needs no route for it. Other apps link here (the gateway
 * console's account Logs: `/apps/observer/#run/<run_id>`).
 */
export const RUN_HASH_PREFIX = "#run/";

/** `#run/<run_id>` for a run id (url-encoded). */
export function run_hash(run_id: string): string {
  return `${RUN_HASH_PREFIX}${encodeURIComponent(String(run_id || "").trim())}`;
}

/** The run id of a `#run/<run_id>` hash (any id, not only a uuid); "" for any other hash. */
export function run_id_from_run_hash(hash: string): string {
  const h = String(hash || "");
  if (!h.startsWith(RUN_HASH_PREFIX)) return "";
  //  carries the run view's state (run_steps.ts run_view_hash); the id ends at "?".
  const raw = h.slice(RUN_HASH_PREFIX.length).split("?")[0];
  if (!raw || raw.includes("/")) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return "";
  }
}

/** What Observe says when a linked run cannot be opened (the gateway answers 404 for an unknown run and for another user's run). */
export function run_link_missing_message(run_id: string): string {
  return `Run ${run_id} cannot be opened: it does not exist on this gateway, or your account cannot see it.`;
}

/**
 * A run id from the address: `#run/<run_id>`, else the last hash segment,
 * else the last path segment (a uuid), wherever the app is mounted (`/`,
 * `/apps/observer/`).
 */
export function run_id_from_location(loc: { hash: string; pathname: string }): string {
  const linked = run_id_from_run_hash(loc.hash);
  if (linked) return linked;
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
