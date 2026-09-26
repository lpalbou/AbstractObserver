# Documentation

Welcome! These docs are written for **users and deployers** of AbstractObserver.
The **source of truth is the code** (not the docs); where relevant we point to the implementing files.

## Start here
1) `getting-started.md` — run the UI and connect to a gateway
2) `faq.md` — common questions and gotchas

## I want to…
- **Run the UI locally** → `getting-started.md`
- **Deploy behind a reverse proxy (same-origin)** → `configuration.md` (recommended pattern)
- **Connect to a remote gateway (cross-origin/CORS)** → `configuration.md` + `troubleshooting.md`
- **See which gateway endpoints are required for each UI feature** → `api.md`
- **Understand how replay-first + SSE streaming works** → `architecture.md`
- **Understand Runtime Activity vs Artifact Explorer vs Observe** → `architecture.md` → "Runtime Boundary"
- **Troubleshoot common browser/network issues** → `troubleshooting.md`
- **See which version I run (About dialog)** → `faq.md`
- **Understand trust boundaries (process control, MCP worker, tokens)** → `security.md`
- **Contribute changes** → `../CONTRIBUTING.md`

## Core concepts
- `architecture.md` — component view + data flow diagrams
- `api.md` — AbstractGateway endpoints used by the UI (grounded in `src/lib/gateway_client.ts`)
- Project + ecosystem overview: `../README.md` (AbstractFramework / AbstractRuntime / AbstractCore)

## Artifacts, server files and local files
Observer’s Runtime views work with Gateway/Runtime artifact inventories, not
with browser-local files or arbitrary server filesystem browsing:

- `Artifact`: a saved runtime-owned payload that Runtime Activity / Artifact
  Explorer can inventory and open through Gateway.
- `Server File` / `Server Folder`: user-facing Gateway workspace paths used by
  import/export or file-helper flows elsewhere in the product. Observer does not
  treat them as artifacts until Gateway/Runtime actually store an artifact.
- `Local File` / `Local Folder`: client-device sources that higher apps may
  upload before a run. Observer inspects the resulting artifacts, not the local
  browser handle.

## Operate and extend
- `configuration.md` — CLI env vars, UI settings, deployment patterns
- `security.md` — trust boundaries (process manager, remote tool worker, cross-origin)
- `troubleshooting.md` — common issues (CORS, mixed content, stale service worker, blank Gateway URL, About shows the gateway unavailable)
- `development.md` — run from source, tests, build (includes workspace dependency notes)

## Project meta
- Changelog: `../CHANGELOG.md`
- Contributing: `../CONTRIBUTING.md`
- Security policy (vulnerability reporting): `../SECURITY.md`
- Acknowledgments: `../ACKNOWLEDGMENTS.md`
- Code of conduct: `../CODE_OF_CONDUCT.md`
- License: `../LICENSE`
