# Getting started

AbstractObserver is a **gateway-only** observability UI (Web/PWA) for AbstractFramework runs.
It serves a static single-page app (`dist/`) via a small Node.js CLI (`bin/cli.js`) and talks to an AbstractGateway HTTP API from the browser (`src/lib/gateway_client.ts`).

## Prerequisites
- Node.js `>=18`
- A running **AbstractGateway** (base URL, e.g. `http://localhost:8081`)
- (Optional) a gateway auth token (sent as `Authorization: Bearer …`)

## Run AbstractObserver
The npm package is `@abstractframework/observer` and the installed CLI binary is `abstractobserver`.

Run the packaged UI server (no build step):
```bash
npx --yes --package @abstractframework/observer -- abstractobserver
```

By default the server listens on `0.0.0.0:3001` (see `bin/cli.js`). To bind to localhost only:
```bash
HOST=127.0.0.1 PORT=3001 npx --yes --package @abstractframework/observer -- abstractobserver
```

Open `http://localhost:3001`.

## Connect to a gateway
In **Settings → Gateway** (implemented in `src/ui/app.tsx`):
- **Gateway URL**: set it to your gateway base URL (for local dev commonly `http://localhost:8081`).
  - Leave it **blank** only if you deploy the UI and gateway **same-origin** (a reverse proxy routes `/api` to the gateway), or when using `npm run dev` (Vite dev proxy; see `vite.config.ts`).
- **Gateway token**: optional.

Click **Connect** (or keep **Auto-connect** enabled).

If you run the CLI server and leave Gateway URL blank, the UI will call `/api/...` on the UI origin — the CLI does **not** proxy `/api` (same-origin requires a reverse proxy).

## Observe a run
Go to **Observe**:
- pick a run from **Runs**
- inspect:
  - **Ledger** (durable log; replay-first + streaming)
  - **Graph** (flow visualization from bundle/workflow flow data)
  - **Digest** (derived stats + summary)
  - **Chat** (run-scoped chat; optional voice PTT + TTS when the gateway exposes the endpoints in `api.md`)

Architecture and data flow: `architecture.md`.

## Launch or schedule a run
Go to **Launch**:
- select a workflow (discovered from gateway bundles)
- click **Start Workflow** (or schedule via the cadence section)

The UI uses `POST /api/gateway/runs/start` and `POST /api/gateway/runs/schedule` (see `src/lib/gateway_client.ts` and `api.md`).

## Next
- Docs index: `README.md`
- FAQ: `faq.md`
- Configuration & deployment: `configuration.md`
- Gateway endpoints used by the UI: `api.md`
- Security & trust boundaries: `security.md`
- Development (from source): `development.md`
- Troubleshooting: `troubleshooting.md`
