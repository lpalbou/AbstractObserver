# Security & trust boundaries

AbstractObserver is “just a UI”, but it can become **high-trust** depending on what your gateway exposes and which optional features you enable.

## Network exposure (CLI default bind)
The packaged CLI binds to `0.0.0.0` by default (`HOST` in `bin/cli.js`), which can expose the UI on your LAN.

Guidance:
- Prefer `HOST=127.0.0.1` for local development.
- For shared deployments, put the UI behind an authenticated reverse proxy and use HTTPS.

## Tokens and local storage
The UI stores settings in your browser (see `load_settings()` / `save_settings()` in `src/ui/app.tsx`), including:
- gateway auth token (`auth_token`)
- optional MCP worker auth token (`worker_token`)

Operational guidance:
- Treat the browser profile as a secret-bearing environment.
- Prefer private machines and locked-down profiles for production tokens.
- Prefer same-origin deployments and HTTPS to reduce leakage risk.

## Process manager (high trust)
The **Processes** page (`src/ui/processes_page.tsx`) can call endpoints that start/stop/restart/redeploy services and tail logs.

Guidance:
- Do not expose process-manager endpoints on a public gateway.
- Enforce strong authn/authz and network restrictions.
- Assume “whoever can access the UI + token can control processes”.

## Remote tool worker (high trust)
If configured, AbstractObserver can execute tool waits via an MCP HTTP worker (`src/lib/mcp_worker_client.ts`) and then resume the run via `POST /api/gateway/commands` (`src/lib/gateway_client.ts`).

Guidance:
- Only point to trusted workers (they can run tools on your behalf).
- Use per-environment tokens and audit logs where possible.
- Prefer running the worker on the same machine/network as the user controlling it.

## Cross-origin + CORS
If the UI origin differs from the gateway origin:
- the gateway must support browser access (CORS, TLS, auth)
- tokens will be sent from the browser to the gateway (and potentially exposed to browser extensions)

Guidance:
- Prefer a reverse proxy so the UI and gateway are same-origin (`configuration.md`).
- If CORS is required, restrict origins and headers; avoid permissive wildcards.

## See also
- Getting started: `getting-started.md`
- FAQ: `faq.md`
- Configuration & deployment: `configuration.md`
- API (gateway endpoints used): `api.md`
- Architecture: `architecture.md`
- Security policy (vulnerability reporting): `../SECURITY.md`
