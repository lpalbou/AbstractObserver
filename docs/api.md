# API (AbstractGateway endpoints used by AbstractObserver)

This document lists the **HTTP endpoints AbstractObserver calls**, grouped by feature.
The **source of truth** for paths, query params, and request bodies is `src/lib/gateway_client.ts`.

> Authentication: in hosted user-auth mode, the UI server exchanges Gateway
> user credentials for an app-scoped browser session and proxies `/api/...`
> with `X-AbstractGateway-Session` plus CSRF headers for writes. Direct
> bearer-token mode remains available for local development when no Gateway user
> is configured.
>
> Base URL: the UI’s **Gateway URL** setting is passed as `GatewayClientConfig.base_url`. When blank, requests are same-origin (`/api/...`). Evidence: `_join()` in `src/lib/gateway_client.ts`.

## Minimum endpoints (core Observe + Launch)
Used by `src/ui/app.tsx` for basic discovery, run launch, and run observation.

- **Workflows / bundles**
  - `GET /api/gateway/bundles` — list bundles (workflow discovery)
  - `GET /api/gateway/bundles/{bundle_id}` — bundle details
  - `GET /api/gateway/bundles/{bundle_id}/flows/{flow_id}` — flow graph data (graph rendering + pin inference)
  - `GET /api/gateway/workflows/{workflow_id}/flow` — flow graph for a namespaced workflow id (bundle:flow)
- **Runs**
  - `GET /api/gateway/runs?limit=…&status=…&workflow_id=…&session_id=…&root_only=true|false` — list recent runs
  - `GET /api/gateway/runs/{run_id}` — run state (status, paused, waiting, schedule metadata, etc.)
  - `GET /api/gateway/runs/{run_id}/input_data` — inputs used for the run (shown in UI)
  - `POST /api/gateway/runs/start` — start a run (body includes `input_data` and optional `bundle_id`, `flow_id`, `session_id`)
  - `POST /api/gateway/runs/schedule` — schedule a run (interval/recurrence; body includes `bundle_id`, `flow_id`, `input_data`)
- **Ledger (durable source of truth)**
  - `GET /api/gateway/runs/{run_id}/ledger?after=…&limit=…` — paged replay
  - `GET /api/gateway/runs/{run_id}/ledger/stream?after=…` — SSE stream of `"step"` events
  - `POST /api/gateway/runs/ledger/batch` — fetch ledgers for multiple runs (digest/subrun support)
  - LLM/provider activity in the Observe UI is derived from `effect.type == "llm_call"` records in this ledger.
- **Run control**
  - `POST /api/gateway/commands` — submit durable commands (at minimum `pause`, `resume`, `cancel`; also used for schedule updates and wait/tool resume flows)

## Optional endpoints (feature-gated in the UI)
These power additional pages/drawers. If your gateway does not expose them, the corresponding UI areas will show errors or empty states.

- **Entities strip (Board page)** — cheap reads only, never replay folds
  - `GET /api/gateway/entities` — roster (names)
  - `GET /api/gateway/entities/{name}/card` — per-entity card (state object, age, moments, `as_of_seq`)
- **Gateway discovery helpers**
  - `GET /api/gateway/discovery/tools`
  - `GET /api/gateway/discovery/providers?include_models=true|false`
  - `GET /api/gateway/discovery/providers/{provider}/models`
- **Bundle management**
  - `POST /api/gateway/bundles/reload`
  - `POST /api/gateway/bundles/upload`
  - `DELETE /api/gateway/bundles/{bundle_id}?bundle_version=…&reload=true|false`
- **Knowledge graph (Runtime → Memory)**
  - `POST /api/gateway/kg/query`
- **Process manager** — moved to `abstractcontinuum` with the CI/CD dev
  lane (2026-07-12 split); the observer no longer has a Processes page.
- **Runtime explorer, artifacts, and audit tail**
  - `GET /api/gateway/runs?limit=…&status=…&workflow_id=…&session_id=…&root_only=true|false` — loaded run page used by Runtime Activity queues. Activity counts are displayed as loaded-scope counts unless a future Gateway run-stats endpoint provides exact global queue totals.
  - `GET /api/gateway/artifacts/search?scope=all|session|run&session_id=…&run_id=…&artifact_kind=…&semantic_kind=…&render_kind=…&modality=…&content_type=…&query=…&tags=…&created_after=…&order_by=…&order=…&include_stats=true&limit=…&offset=…` — canonical artifact search used by the Runtime tab. Rows include legacy fields plus `artifact_envelope_v1`; stats/facets are used for exact filter chips and totals.
  - `GET /api/gateway/sessions/{session_id}/artifacts?limit=…` — session-scoped artifact listing
  - `GET /api/gateway/runs/{run_id}/artifacts?limit=…`
  - `GET /api/gateway/runs/{run_id}/artifacts/{artifact_id}/content?access_action=preview|download|content` — content/preview/download route; Observer labels access type so Runtime access stats remain useful
  - `GET /api/gateway/audit/tail?max_bytes=…` — gateway audit/log tail used by Runtime and Observe → Providers
- **Run summaries + run-scoped chat**
  - `POST /api/gateway/runs/{run_id}/summary`
  - `POST /api/gateway/runs/{run_id}/chat`
  - `POST /api/gateway/runs/{run_id}/chat_threads` — persist a discussion as an artifact
- **Voice (Observe → Chat; optional)**
  - `POST /api/gateway/attachments/upload` — upload an attachment (used for voice recordings; multipart form with `session_id` + `file`)
  - `POST /api/gateway/runs/{run_id}/audio/transcribe` — transcribe an uploaded audio artifact
  - `POST /api/gateway/runs/{run_id}/voice/tts` — text-to-speech (returns an audio artifact)
- **Bug/feature inbox + triage**
  - `GET /api/gateway/reports/bugs` / `GET /api/gateway/reports/features`
  - `GET /api/gateway/reports/bugs/{filename}/content` / `…/features/{filename}/content`
  - `POST /api/gateway/triage/run`
  - `GET /api/gateway/triage/decisions?status=…&limit=…`
  - `POST /api/gateway/triage/decisions/{decision_id}/apply`
  - `POST /api/gateway/bugs/report` / `POST /api/gateway/features/report`
- **Email inbox (multi-account)**
  - `GET /api/gateway/email/accounts`
  - `GET /api/gateway/email/messages?account=…&mailbox=…&since=…&status=…&limit=…`
  - `GET /api/gateway/email/messages/{uid}?account=…&mailbox=…&max_body_chars=…`
  - `POST /api/gateway/email/send`
- **Backlog maintenance (Backlog page; high trust)**
  - `GET /api/gateway/backlog/{kind}` (kind = planned/proposed/recurrent/completed/deprecated/trash)
  - `GET /api/gateway/backlog/{kind}/{filename}/content`
  - `POST /api/gateway/backlog/template`
  - `POST /api/gateway/backlog/move`
  - `POST /api/gateway/backlog/{kind}/{filename}/update`
  - `POST /api/gateway/backlog/create`
  - `POST /api/gateway/backlog/{kind}/{filename}/execute?execution_mode=…`
  - `POST /api/gateway/backlog/execute_batch`
  - `POST /api/gateway/backlog/merge`
  - `GET /api/gateway/backlog/exec/config`
  - `GET /api/gateway/backlog/exec/requests?status=…&limit=…`
  - `GET /api/gateway/backlog/exec/requests/{request_id}?include_prompt=true|false`
  - `POST /api/gateway/backlog/exec/requests/{request_id}/feedback`
  - `POST /api/gateway/backlog/exec/requests/{request_id}/promote`
  - `POST /api/gateway/backlog/exec/requests/{request_id}/uat/deploy`
  - `GET /api/gateway/backlog/exec/requests/{request_id}/logs/tail?name=…&max_bytes=…`
  - `GET /api/gateway/backlog/exec/active_items?status=…&limit=…`
  - `POST /api/gateway/backlog/{kind}/{filename}/attachments/upload`
  - `POST /api/gateway/backlog/assist`
  - `POST /api/gateway/backlog/maintain`
  - `POST /api/gateway/backlog/advisor`

## See also
- Docs index: `README.md`
- Getting started: `getting-started.md`
- Architecture: `architecture.md`
- Configuration & deployment: `configuration.md`
- Security & trust boundaries: `security.md`
