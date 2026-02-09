# FAQ

> Last updated: 2026-02-09

## What is AbstractObserver?
AbstractObserver is a **gateway-only** observability UI (Web/PWA) for AbstractFramework runs:
- it runs in the browser (`src/ui/app.tsx`)
- it fetches/streams run data from an AbstractGateway (`src/lib/gateway_client.ts`)
- it serves the built SPA from `dist/` via a small Node.js CLI (`bin/cli.js`)

## Does AbstractObserver execute workflows?
No. It is a UI client. Execution happens behind the gateway.

Evidence:
- the browser talks to the gateway via HTTP/SSE (`src/lib/gateway_client.ts`)
- the CLI only serves static files + SPA fallback (`bin/cli.js`)

## What do I need to use it?
- Node.js `>=18` (see `../package.json`, field `engines`)
- an AbstractGateway that implements the endpoints the UI calls (see `api.md`)

## How do I run it?
```bash
npx --yes --package @abstractframework/observer -- abstractobserver
```

For other install options and CLI flags/env vars, see `../README.md` and `configuration.md`.

## Why is the npm package name different from the CLI command?
The published npm package is scoped (`@abstractframework/observer`), but the installed CLI binary is `abstractobserver`.

Examples:
- no global install: `npx --yes --package @abstractframework/observer -- abstractobserver`
- global install: `npm install -g @abstractframework/observer && abstractobserver`

## How do I change the port / host?
The packaged CLI reads:
- `PORT` (default `3001`)
- `HOST` (default `0.0.0.0`)

Evidence: `bin/cli.js`.

## Does the CLI proxy `/api` to my gateway?
No. The CLI is a static server for `dist/` (it does not forward `/api`).

If you leave **Gateway URL** blank, the UI will call `/api/...` on the UI origin. That only works when:
- you are in dev (`npm run dev`), because Vite proxies `/api` (see `vite.config.ts`), or
- you deploy behind a reverse proxy that routes `/api` to the gateway.

Evidence: `bin/cli.js` (static server), `vite.config.ts` (dev proxy), `src/lib/gateway_client.ts` (fetches `/api/...` when `base_url=""`).

## What should I put in “Gateway URL”?
Usually: your gateway base URL (e.g. `http://localhost:8081` for local dev).

Rules enforced by the UI during discovery (see `on_discover_gateway()` in `src/ui/app.tsx`):
- must start with `http://` or `https://` (or be blank)
- `https://` UI pages cannot call an `http://` gateway (mixed content)
- when the UI is opened from a non-loopback host, `http://localhost:…` is treated as a common misconfiguration (it would resolve on the device, not your gateway machine)

## Do I need CORS?
Only if the UI origin and gateway origin differ.
- Same-origin deployments avoid CORS entirely.
- Cross-origin deployments require the gateway to allow your UI origin and headers.

See `configuration.md`.

## How does authentication work?
If you set a gateway token in Settings, the UI sends:
`Authorization: Bearer <token>`

Evidence: `_auth_headers()` in `src/lib/gateway_client.ts` and Settings storage in `src/ui/app.tsx` (`load_settings()` / `save_settings()`).

Operational guidance: `security.md`.

## What is the “ledger” and why “replay-first”?
The ledger is the durable sequence of step records for a run. The UI:
1) replays history via paged HTTP (`get_ledger()`), then
2) streams new steps via SSE (`stream_ledger()`).

Evidence: `src/lib/gateway_client.ts` and `src/lib/sse_parser.ts`. Diagram: `architecture.md`.

## Which gateway endpoints are required?
It depends on which UI pages/features you use.
For the authoritative list grouped by feature, see `api.md` (grounded in `src/lib/gateway_client.ts`).

## What are Backlog / Inbox / Processes?
They are maintainer-oriented pages that rely on additional gateway endpoints and are **high trust**:
- Backlog: maintenance items (create/edit/execute)
- Inbox: bug/feature reports + triage decisions + email mailbox (list/read/send)
- Processes: process manager controls + log tail

Evidence: `src/ui/backlog_browser.tsx`, `src/ui/report_inbox.tsx`, `src/ui/email_inbox.tsx`, `src/ui/processes_page.tsx`.
Security guidance: `security.md`.

## What is the “Remote tool worker (MCP)”?
If configured, AbstractObserver can execute tool waits via an MCP HTTP JSON-RPC endpoint and then resume the run.

Evidence:
- worker client: `src/lib/mcp_worker_client.ts`
- UI resume flow: `execute_tools_via_worker()` in `src/ui/app.tsx`

Security guidance: `security.md`.

## Does it support voice (PTT / TTS)?
Yes — in **Observe → Chat** and **Backlog → Advisor**, the UI can:
- record audio in the browser, upload it to the gateway, and request transcription (push-to-talk)
- request gateway-based text-to-speech audio and play it back (TTS)

Gateway endpoints: `api.md` (Voice section).

Evidence:
- voice hook: `src/ui/use_gateway_voice.ts`
- UI wiring: `src/ui/app.tsx`, `src/ui/backlog_browser.tsx`
- gateway client: `src/lib/gateway_client.ts` (`attachments_upload()`, `audio_transcribe()`, `voice_tts()`)

## What is “monitor-gpu” and how do I enable it?
It’s an optional GPU usage widget in the header. Enable it by starting the CLI with:
- `abstractobserver --monitor-gpu`, or
- `ABSTRACTOBSERVER_MONITOR_GPU=on`

Evidence:
- HTML config injection: `bin/cli.js`
- UI feature gate: `monitor_gpu_enabled` in `src/ui/app.tsx`

## Is this a PWA? Does it work offline?
The app registers a service worker in production to cache the UI shell (installability + faster reloads), but run data still comes from the gateway.

Evidence: `src/main.tsx`, `public/sw.js`.

## I updated the UI but my browser still shows an old version
Production builds use a service worker; clear site data/unregister the SW if needed.

See `troubleshooting.md`.

## I want to build from source but imports like `@abstractuic/*` fail
Dev/build uses Vite aliases to sibling workspace packages under `../abstractuic/*/src`.

Evidence: `vite.config.ts`. See `development.md`.

## See also
- Getting started: `getting-started.md`
- Docs index: `README.md`
- Architecture: `architecture.md`
- Configuration: `configuration.md`
- API (gateway endpoints used): `api.md`
- Security: `security.md`
- Troubleshooting: `troubleshooting.md`
