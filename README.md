# AbstractObserver

Gateway-only observability UI (Web/PWA) for AbstractFramework runs.

What it does (implemented in `src/ui/app.tsx` + `src/lib/gateway_client.ts`):
- **Discover** workflows/bundles exposed by an AbstractGateway
- **Launch** or **schedule** runs (durable)
- **Observe** runs by replaying + streaming the durable **ledger** (replay-first + SSE)
- **Control** runs via durable commands (`pause`, `resume`, `cancel`)
- (Optional) **Voice** in run chat: gateway-based TTS + push-to-talk transcription (`src/ui/use_gateway_voice.ts`)

## Where it fits (AbstractFramework ecosystem)
AbstractObserver is one of the browser UIs in the **AbstractFramework** ecosystem:
- AbstractFramework (ecosystem entrypoint): https://github.com/lpalbou/AbstractFramework
- AbstractRuntime (durable runtime + ledger behind the gateway): https://github.com/lpalbou/abstractruntime
- AbstractCore (LLM + tools integration used by runtime/workflows): https://github.com/lpalbou/abstractcore

```mermaid
flowchart LR
  U[User] --> O[AbstractObserver<br/>browser UI]
  O -->|HTTP fetch + SSE| G[AbstractGateway<br/>/api/gateway/*]
  G --> R[AbstractRuntime<br/>durable runs + append-only ledger]
  R --> C[AbstractCore<br/>LLM + tools (optional)]
```

## Quickstart (npm)
Prereqs:
- Node.js `>=18`
- An AbstractGateway that exposes the endpoints listed in `docs/api.md`

Run the UI server:
```bash
npx --yes --package @abstractframework/observer -- abstractobserver
```

Note: the npm package is `@abstractframework/observer`, and the CLI binary is `abstractobserver`.

Open `http://localhost:3001`, then go to **Settings** and configure:
- **Gateway URL** (usually your gateway base URL, e.g. `http://localhost:8081`)
  - Leave it blank only for same-origin deployments (reverse proxy routes `/api`) or when using `npm run dev` (Vite `/api` proxy).
- optional **Auth token**, then click **Connect**

## Install options
### Global install
```bash
npm install -g @abstractframework/observer
abstractobserver
```

### Pin a version (recommended for deployments)
```bash
npx --yes --package @abstractframework/observer@0.1.6 -- abstractobserver
```

### CLI configuration
The CLI is a static file server implemented in `bin/cli.js`.
- `PORT` (default `3001`)
- `HOST` (default `0.0.0.0`)
- `--monitor-gpu` or `ABSTRACTOBSERVER_MONITOR_GPU=on` (enables the optional GPU widget)

## Features (UI pages)
All pages share the same gateway connection settings.

- **Observe**: ledger, graph, digest, attachments, chat (optional voice: PTT + TTS)
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
- Acknowledgments: `ACKNOWLEDMENTS.md`

## Development (from source)
```bash
npm install
npm run dev
```

Important: dev/build expects sibling “AbstractUIC” source packages because `vite.config.ts` aliases imports to `../abstractuic/*/src`.
See `docs/development.md` for details.
