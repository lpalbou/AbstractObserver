# Security & trust boundaries

AbstractObserver is “just a UI”, but it can become **high-trust** depending on what your gateway exposes and which optional features you enable.

## Network exposure (CLI default bind)
The packaged CLI binds to `127.0.0.1` by default. `--host 0.0.0.0` exposes it
on your network.

Guidance:
- On a remote server, open the Observer through the gateway at
  `/apps/observer/`: the gateway relays to this server on `127.0.0.1` and
  forwards the browser's address, which the server uses to decide whether a
  browser is on this machine (the folder reveal is refused otherwise).
- A browser counts as "on this machine" only when its address is loopback
  **and** the page's host names loopback (`localhost`, `127.0.0.1`, `::1`).
  A page from another site whose name resolves to `127.0.0.1` (DNS
  rebinding) is refused, for the folder reveal and for browser-supplied
  Gateway URL changes alike.
- For shared deployments, put the gateway behind an authenticated reverse proxy and use HTTPS.

## Tokens and browser sessions
Sign-in is the shared AbstractFramework connection dialog
(`GatewayConnectModal` from `@abstractframework/ui-kit` — the same component
AbstractFlow and the gateway console use), backed by the
`@abstractframework/app-server` session proxy: the Gateway user token is
exchanged server-side for an app-scoped browser session; the session id is
kept in an HTTP-only app cookie, writes require a CSRF token, and the raw
token is never persisted (settings strip `auth_token` when saving). The
session is origin-wide for this app. The entity app, AbstractEntity, is a
separate deployment with its own session cookies.

With `@abstractframework/app-server` 0.1.10 or newer, every request the proxy
sends to the Gateway carries `X-Forwarded-For` set to the address of the
browser's connection (browser-supplied `X-Forwarded-For`, `Forwarded` and
`X-Real-IP` headers are dropped) and the marker
`X-AbstractFramework-App-Proxy: abstractobserver`. The Gateway uses them to
tell whether the browser runs on the Gateway's own machine. A connection whose
address cannot be determined is refused with HTTP 400.

A direct bearer-token mode remains for local development (Settings →
Advanced). Bearer credentials live in memory for the tab's lifetime only and
never rest client-side: reloading a direct-dev tab re-prompts, and a token
left in browser storage by an older build is removed on load. The optional MCP worker token (`worker_token`) is
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

## Process manager

These live in AbstractContinuum (`@abstractframework/continuum`): AbstractObserver observes and discusses runs; AbstractContinuum develops and deploys.


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
