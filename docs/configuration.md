# Configuration & deployment

This project has two layers of configuration:
1) the **static UI server** (Node.js CLI); and
2) the **browser UI settings** (stored locally in your browser).

## CLI (static server)
Implemented in `bin/cli.js`.

- The npm package is `@abstractframework/observer`; the installed CLI binary is `abstractobserver`.
- If you don’t want a global install, you can run the CLI via `npx --yes --package @abstractframework/observer -- abstractobserver`.

- `PORT` — HTTP port to listen on (default `3001`)
- `HOST` — bind address (default `0.0.0.0`)
- `--monitor-gpu` or `ABSTRACTOBSERVER_MONITOR_GPU=1|true|yes|on` — injects `window.__ABSTRACT_UI_CONFIG__.monitor_gpu=true` to enable the GPU widget in the UI (`src/ui/app.tsx`)

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
  - Note: the packaged CLI (`bin/cli.js`) serves static files only. If you leave Gateway URL blank when using the CLI, `/api` must be provided by a reverse proxy.
- **Auth token** (`auth_token`) — sent as `Authorization: Bearer …` to the gateway (see `src/lib/gateway_client.ts`).
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
In dev (`npm run dev`), Vite proxies `/api` to `http://localhost:8081` by default (see `vite.config.ts`).
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
