# AbstractObserver

Gateway-only observability UI (Web/PWA) for AbstractFramework runs.

What it does (implemented in `src/ui/app.tsx` + `src/lib/gateway_client.ts`):
- **Discover** workflows/bundles exposed by an AbstractGateway
- **Launch** or **schedule** runs (durable)
- **Observe** runs by replaying + streaming the durable **ledger** (replay-first + SSE)
- **Control** runs via durable commands (pause/resume/cancel/resume-wait)

## Quickstart (npm)
Prereqs:
- Node.js `>=18`
- An AbstractGateway that exposes the endpoints listed in `docs/api.md`

Run the UI server:
```bash
npx abstractobserver
```

Open `http://localhost:3001`, then go to **Settings** and configure:
- **Gateway URL** (usually your gateway base URL, e.g. `http://localhost:8081`)
  - Leave it blank only for same-origin deployments (reverse proxy routes `/api`) or when using `npm run dev` (Vite `/api` proxy).
- optional **Auth token**, then click **Connect**

## Install options
### Global install
```bash
npm install -g abstractobserver
abstractobserver
```

### Pin a version (recommended for deployments)
```bash
npx abstractobserver@0.1.4
```

### CLI configuration
The CLI is a static file server implemented in `bin/cli.js`.
- `PORT` (default `3001`)
- `HOST` (default `0.0.0.0`)
- `--monitor-gpu` or `ABSTRACTOBSERVER_MONITOR_GPU=on` (enables the optional GPU widget)

## Features (UI pages)
All pages share the same gateway connection settings.

- **Observe**: ledger, graph, digest, attachments, chat
- **Launch**: start runs, schedule runs, bundle upload/reload
- **Mindmap**: knowledge-graph query UI (requires `POST /api/gateway/kg/query`)
- **Backlog / Inbox (reports + email) / Processes**: maintainer tooling (high trust; requires additional gateway endpoints)

## Documentation
- Start here: `docs/getting-started.md`
- Docs index: `docs/README.md`
- FAQ: `docs/faq.md`
- Architecture (with diagrams): `docs/architecture.md`
- Configuration & deployment: `docs/configuration.md`
- API (gateway endpoints used): `docs/api.md`
- Development: `docs/development.md`
- Security & trust boundaries: `docs/security.md`

## Project
- Changelog: `CHANGELOG.md`
- Contributing: `CONTRIBUTING.md`
- Security policy (vulnerability reporting): `SECURITY.md`
- Acknowledments: `ACKNOWLEDMENTS.md`

## Development (from source)
```bash
npm install
npm run dev
```

Important: dev/build expects sibling “AbstractUIC” source packages because `vite.config.ts` aliases imports to `../abstractuic/*/src`.
See `docs/development.md` for details.
