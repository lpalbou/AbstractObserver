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

- `PORT` — HTTP port to listen on (default `3001`)
- `HOST` — bind address (default `0.0.0.0`)
- `ABSTRACTOBSERVER_GATEWAY_URL` (fallback `ABSTRACTGATEWAY_URL`) — the Gateway
  this server proxies `/api` to and pre-fills in the sign-in dialog (default
  `http://127.0.0.1:8080`). Injected as `__ABSTRACT_UI_CONFIG__.gateway_url`.
- `ABSTRACTOBSERVER_GATEWAY_DIR` — directory used to resolve relative run
  workspace paths for the run workspace folder button (`POST /api/local/reveal`,
  loopback clients only). Defaults to the parent of the package directory.
- `--monitor-gpu` or `ABSTRACTOBSERVER_MONITOR_GPU=1|true|yes|on` — injects `window.__ABSTRACT_UI_CONFIG__.monitor_gpu=true` to enable the GPU widget in the UI (`src/ui/app.tsx`)
- `ABSTRACTOBSERVER_ENTITY_APP_URL` — where the entity app lives (its own
  package, `@abstractframework/entity`, default port `3007`). Injected as
  `__ABSTRACT_UI_CONFIG__.entity_app_url`; drives the "Entities ↗" links and
  makes `/entity.html` redirect to the entity app, so old `/entity.html`
  bookmarks keep working. Unset: the UI links fall back to
  `http://127.0.0.1:3007`, and `/entity.html` answers 404 with a pointer to
  the entity app.

Examples:
```bash
PORT=8080 abstractobserver
HOST=127.0.0.1 PORT=3001 abstractobserver
abstractobserver --monitor-gpu

# no global install:
HOST=127.0.0.1 PORT=3001 npx --yes --package @abstractframework/observer -- abstractobserver
```

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
