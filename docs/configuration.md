# Configuration & deployment

This project has two layers of configuration:
1) the **static UI server** (Node.js CLI); and
2) the **browser UI settings** (stored locally in your browser).

## CLI (static server)
Implemented in `bin/cli.js`. The Gateway session proxy (sign-in endpoint
`/api/connection/gateway`, session cookies, CSRF, `/api` forwarding) comes from
the shared `@abstractframework/app-server` package, a runtime dependency.

- The npm package is `@abstractframework/observer`; the installed CLI binary is `abstractobserver`.
- If you don’t want a global install, you can run the CLI via `npx --yes --package @abstractframework/observer -- abstractobserver`.

Launch flags (`abstractobserver --help`):

- `--gateway-url <url>` (aliases `--gateway`, `--url`) — the Gateway this server
  proxies `/api` to and pre-fills in the sign-in dialog. Default: the gateway
  installed on this computer (the local pointer `~/.abstractframework/gateway.json`,
  re-read when the gateway moves port), else `http://127.0.0.1:8080`. Injected
  as `__ABSTRACT_UI_CONFIG__.gateway_url`.
- `--port <n>` — HTTP port (default `3001`).
- `--host <addr>` — bind address (default `127.0.0.1`). Use `--host 0.0.0.0`
  only to reach this server directly from other machines; on a remote server,
  let the gateway serve the Observer at `/apps/observer/` instead.
- `--monitor-gpu` — injects `__ABSTRACT_UI_CONFIG__.monitor_gpu=true` (the GPU widget).
- `--entity-app-url <url>` — where the entity app lives (its own package,
  `@abstractframework/entity`, default port `3007`). Injected as
  `__ABSTRACT_UI_CONFIG__.entity_app_url`; drives the "Entities ↗" links and
  makes `/entity.html` redirect to the entity app. Unset: the UI links fall
  back to `http://127.0.0.1:3007`, and `/entity.html` answers 404 with a
  pointer to the entity app.
- `--gateway-dir <dir>` — directory used to resolve relative run workspace
  paths for the run workspace folder button (`POST api/local/reveal`, browsers
  on this machine only, signed in through this server's session: the request
  carries the session's CSRF header). Defaults to the parent of the package directory.

Environment variables are legacy aliases, below the flags: `PORT`, `HOST`,
`ABSTRACTOBSERVER_GATEWAY_URL` / `ABSTRACTGATEWAY_URL`,
`ABSTRACTOBSERVER_MONITOR_GPU`, `ABSTRACTOBSERVER_ENTITY_APP_URL`,
`ABSTRACTOBSERVER_GATEWAY_DIR`.

Examples:
```bash
abstractobserver --port 8090
abstractobserver --gateway-url http://127.0.0.1:8080 --monitor-gpu

# no global install:
npx --yes --package @abstractframework/observer -- abstractobserver --port 3001
```

## Served by the gateway at `/apps/observer/`
The gateway can serve the Observer through itself: one port and one address
for the console, the API and the apps, which is what you want on a remote
server. The gateway starts this server on `127.0.0.1` and relays
`/apps/observer/` to it. The server follows the app-server mount contract
(`@abstractframework/app-server`):

- every response carries `X-AbstractFramework-App: observer; mount=1`;
- the page gets `<base href="/apps/observer/">` and `base_path` in
  `__ABSTRACT_UI_CONFIG__`; every URL the app uses is relative (assets, the
  gateway API through its own session proxy, the service worker, whose scope
  is `/apps/observer/`), so the same build works at `/` and under the mount;
- the run deep link is a hash route, so it needs no server route:
  `/apps/observer/#run/<run_id>` (see getting-started.md, "Link to one run");
- session cookies are set at `Path=/apps/observer/`;
- "is this browser on this machine" (the folder reveal) is decided from the
  browser's address the gateway forwards, never the relaying connection.

## Browser UI settings (per device/browser)
Implemented in `src/ui/app.tsx` (see `load_settings()` / `save_settings()`).

- **Gateway URL** (`gateway_url`)
  - Blank means **same-origin** (calls `/api/...` on the same host serving the UI).
  - Set it to `http(s)://…` to target a remote gateway.
  - The packaged CLI (`bin/cli.js`) proxies same-origin `/api/...` calls to the
    configured gateway after browser-session sign-in.
  - On non-local hosted UI hostnames, the server-configured Gateway URL is
    authoritative. Browser-supplied Gateway URL changes are rejected unless
    `ABSTRACTOBSERVER_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` is enabled behind
    your own access control. If a reverse proxy rewrites `Host`, set
    `ABSTRACTOBSERVER_TRUST_PROXY_HEADERS=1` only when the proxy strips
    client-supplied forwarded headers.
- **Gateway user** (`gateway_user`) and **Gateway token** (`auth_token`) —
  hosted user-auth sign-in fields. The token is exchanged server-side for an
  app-scoped browser session; settings persistence strips `auth_token`.
  Direct bearer-token mode is retained for local development when
  `gateway_user` is blank.
- **Remote tool worker** (`worker_url`, `worker_token`) — optional MCP JSON-RPC over HTTP endpoint used to execute tool waits (see `src/lib/mcp_worker_client.ts`).
- UI preferences: theme, font scale, header density, auto-connect.

## Deployment patterns (recommended)
### 1) Same-origin (simplest)
Serve the UI and gateway under the same origin, and keep **Gateway URL blank**.
- Pros: no CORS issues; works well behind a reverse proxy.
- Cons: requires routing `/api` to the gateway.

### 2) Cross-origin (gateway on a different host)
Set **Gateway URL** in the UI settings.
- The gateway must allow browser access (CORS, auth, TLS).
- Avoid `http://localhost:…` when accessing from another device; the UI explicitly warns about this in discovery logic (`on_discover_gateway()` in `src/ui/app.tsx`).

## Dev server proxy
In dev (`npm run dev`), the Vite dev server mounts the same `@abstractframework/app-server` session proxy as the CLI; requests without a browser session fall through to a raw `/api` proxy targeting `ABSTRACTOBSERVER_GATEWAY_URL` / `ABSTRACTGATEWAY_URL` (default `http://127.0.0.1:8080`, see `vite.config.ts`).
If your gateway is elsewhere, update the `server.proxy` section.

## PWA / service worker
- Production builds register a service worker at `/sw.js` to cache the UI shell (see `src/main.tsx` and `public/sw.js`).
- In dev, the app **unregisters** any existing service workers and clears caches to avoid “stale UI” behavior (see `src/main.tsx`).

## See also
- Getting started: `getting-started.md`
- FAQ: `faq.md`
- API endpoints used by the UI: `api.md`
- Security & trust boundaries: `security.md`
- Development: `development.md`
