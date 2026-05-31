# Security & trust boundaries

AbstractObserver is “just a UI”, but it can become **high-trust** depending on what your gateway exposes and which optional features you enable.

## Network exposure (CLI default bind)
The packaged CLI binds to `0.0.0.0` by default (`HOST` in `bin/cli.js`), which can expose the UI on your LAN.

Guidance:
- Prefer `HOST=127.0.0.1` for local development.
- For shared deployments, put the UI behind an authenticated reverse proxy and use HTTPS.

## Tokens and browser sessions
In hosted user-auth mode, the UI server exchanges Gateway user credentials for
an app-scoped browser session. Browser settings persist the Gateway URL, Gateway
user, preferences, and optional tool worker configuration, but strip the
Gateway token (`auth_token`) when saving settings. The session id is kept in an
HTTP-only app cookie and writes require a CSRF token.

Direct bearer-token mode remains available for local development when no
Gateway user is configured. The optional MCP worker token (`worker_token`) is
still stored in browser settings.

When Observer is served from a non-local hostname, the server-configured
Gateway URL is authoritative. Browser-supplied Gateway URL changes are rejected
unless `ABSTRACTOBSERVER_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` is enabled
behind your own access control. If a reverse proxy rewrites `Host`, set
`ABSTRACTOBSERVER_TRUST_PROXY_HEADERS=1` only when the proxy strips
client-supplied forwarded headers.

Operational guidance:
- Treat the browser profile as a sensitive environment because session cookies
  and optional worker credentials are still present.
- Prefer private machines and locked-down profiles for production access.
- Prefer same-origin deployments and HTTPS to reduce leakage risk.

## Voice features (microphone + uploads)
If you use voice push-to-talk (PTT) or TTS:
- the UI may request **microphone permissions** (PTT) and upload audio recordings to the gateway
- generated TTS audio is downloaded from the gateway as a run artifact

Evidence: `src/ui/use_gateway_voice.ts` and related endpoints in `src/lib/gateway_client.ts` (`attachments_upload()`, `audio_transcribe()`, `voice_tts()`).

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
- direct bearer-token mode sends tokens from the browser to the gateway; hosted
  user-auth mode should prefer the app server proxy and browser-session path

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
