# AbstractObserver

Gateway-only observability UI (Web/PWA) for AbstractFramework runs.

What it does (implemented in `src/ui/app.tsx` + `src/lib/gateway_client.ts`):
- **Discover** workflows/bundles exposed by an AbstractGateway
- **Launch** or **schedule** runs (durable)
- **Observe** runs and subruns by replaying + streaming the durable **ledger** (replay-first + SSE)
- **Inspect runtime state** across active runs, generated artifacts, provider calls, and gateway audit logs
- **Control** runs via durable commands (`pause`, `resume`, `cancel`)
- (Optional) **Voice** in run chat: gateway-based TTS + push-to-talk transcription (`src/ui/use_gateway_voice.ts`)

## Entity Memory view (`/entity.html`)

A standalone page (`src/entity/`) that visualizes a **summoned entity's
evolving memory graph** — memories appearing live, associations lighting on
use, feelings as visual state, and a timeline you can scrub. It consumes the
frozen memory replay stream v1 (one envelope shape; offline replay = bounded
read, realtime = the same read that doesn't stop):

- **Offline**: opens the bundled demo life, or drop any exported `.ndjson`
  stream onto the page.
- **Live**: connect a gateway and tail
  `/api/gateway/entities/{name}/replay/stream` (SSE; reconnects resume
  exactly via `Last-Event-ID`; cursors are floats because gateway host
  markers sit at fractional seq positions).
- **Why a memory entered context** is first-class: recall beats show
  identity records present by right, continuity carryover, and stimulus
  matches, plus what was considered and dropped (with reasons).
- **Feelings**: dual-channel standings per person/tool/concept with scar and
  bond halos, healings and breaks — presentation only, never gating.
- **The diary is its own lane**, and diary content stays private: the engine
  redacts diary display blocks at the source and the view renders the act,
  never the words.
- **Truthful scrubbing**: the state at any timeline position is a pure fold
  of the stream prefix at that seq — the same `as_of` semantics the memory
  engine itself uses. The view performs only reads (there is no write path
  in the module).

Regenerate the demo life (requires the Python monorepo checkout):

```bash
python abstractobserver/scripts/export_demo_entity.py
```

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
- **Gateway user** and that user's **Gateway token** in hosted user-auth mode,
  then click **Connect**

In hosted mode, Observer exchanges the user token for an app-scoped Gateway
browser session and does not persist the token in browser settings. Direct
bearer-token mode remains available for local development. When Observer is
served from a non-local hostname, the server-configured Gateway URL is
authoritative; browser-supplied Gateway URL changes are rejected unless
`ABSTRACTOBSERVER_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` is set behind your own
access control. If a reverse proxy rewrites `Host`, set
`ABSTRACTOBSERVER_TRUST_PROXY_HEADERS=1` only when the proxy strips
client-supplied forwarded headers.

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

- **Observe**: workflow/subworkflow navigator, overview, human timeline, raw ledger, provider calls, graph, digest, attachments, chat (optional voice: PTT + TTS)
- **Runtime**: Activity, Artifacts, and Logs modes for platform-level monitoring. The Artifact Explorer uses Gateway artifact envelopes and exact stats, separates Voice/Music/Sound/unclassified audio from render kinds such as Markdown/HTML/JSON, previews media inline, and links artifacts back to producing runs, ledgers, and trace/audit actions when metadata is available
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
- Acknowledgments: `ACKNOWLEDGMENTS.md`

## Development (from source)
```bash
npm install
npm run dev
```

Important: dev/build expects sibling “AbstractUIC” source packages because `vite.config.ts` aliases imports to `../abstractuic/*/src`.
See `docs/development.md` for details.
