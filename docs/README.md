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
- **Troubleshoot common browser/network issues** → `troubleshooting.md`
- **Understand trust boundaries (process control, MCP worker, tokens)** → `security.md`
- **Contribute changes** → `../CONTRIBUTING.md`

## Core concepts
- `architecture.md` — component view + data flow diagrams
- `api.md` — AbstractGateway endpoints used by the UI (grounded in `src/lib/gateway_client.ts`)
- Project + ecosystem overview: `../README.md` (AbstractFramework / AbstractRuntime / AbstractCore)

## Operate and extend
- `configuration.md` — CLI env vars, UI settings, deployment patterns
- `security.md` — trust boundaries (process manager, remote tool worker, cross-origin)
- `troubleshooting.md` — common issues (CORS, mixed content, stale service worker, blank Gateway URL)
- `development.md` — run from source, tests, build (includes workspace dependency notes)

## Project meta
- Changelog: `../CHANGELOG.md`
- Contributing: `../CONTRIBUTING.md`
- Security policy (vulnerability reporting): `../SECURITY.md`
- Acknowledgments: `../ACKNOWLEDMENTS.md`
- License: `../LICENSE`
