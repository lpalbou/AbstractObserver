# API (AbstractGateway endpoints used by AbstractObserver)

This document lists the **HTTP endpoints AbstractObserver calls**, grouped by feature.
The **source of truth** for paths, query params, and request bodies is `src/lib/gateway_client.ts`.

> Authentication: when configured, the UI sends `Authorization: Bearer <token>` (see `_auth_headers()` in `src/lib/gateway_client.ts`).

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
- **Run control**
  - `POST /api/gateway/commands` — submit durable commands (pause/resume/cancel/resume-wait)

## Optional endpoints (feature-gated in the UI)
These power additional pages/drawers. If your gateway does not expose them, the corresponding UI areas will show errors or empty states.

- **Gateway discovery helpers**
  - `GET /api/gateway/discovery/tools`
  - `GET /api/gateway/discovery/providers?include_models=true|false`
  - `GET /api/gateway/discovery/providers/{provider}/models`
- **Bundle management**
  - `POST /api/gateway/bundles/reload`
  - `POST /api/gateway/bundles/upload`
  - `DELETE /api/gateway/bundles/{bundle_id}?bundle_version=…&reload=true|false`
- **Knowledge graph (Mindmap page)**
  - `POST /api/gateway/kg/query`
- **Process manager (Processes page; high trust)**
  - `GET /api/gateway/processes`
  - `GET /api/gateway/processes/env` — list managed environment variables
  - `POST /api/gateway/processes/env` — set/unset managed environment variables
  - `POST /api/gateway/processes/{id}/start|stop|restart|redeploy`
  - `GET /api/gateway/processes/{id}/logs/tail?max_bytes=…`
- **Run artifacts (attachments + saved chat threads)**
  - `GET /api/gateway/runs/{run_id}/artifacts?limit=…`
  - `GET /api/gateway/runs/{run_id}/artifacts/{artifact_id}/content`
- **Run summaries + run-scoped chat**
  - `POST /api/gateway/runs/{run_id}/summary`
  - `POST /api/gateway/runs/{run_id}/chat`
  - `POST /api/gateway/runs/{run_id}/chat_threads` — persist a discussion as an artifact
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
