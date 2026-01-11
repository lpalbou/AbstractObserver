# AbstractObserver — Architecture (Living)

> Updated: 2026-01-11

## Purpose
**AbstractObserver** is a lightweight **observability-first** web/PWA UI for the AbstractFramework runtime, viewed through the **AbstractGateway**.

It is intentionally **not** a workflow editor:
- authoring stays in **AbstractFlow**
- durable execution stays in **AbstractRuntime**
- network control-plane stays in **AbstractGateway**

AbstractObserver’s job is to make it easy to:
- discover available workflows/bundles exposed by a gateway
- start a workflow run with typed inputs
- attach to any existing run
- observe ledger + graph + digest in real time (replay-first + streaming)
- submit durable run commands (pause/resume/cancel) and resume waits when applicable

## Dependencies and Contracts
### AbstractGateway API (primary)
AbstractObserver talks only to the gateway HTTP API:
- `GET /api/gateway/bundles` (workflow discovery)
- `GET /api/gateway/runs` (recent run listing)
- `GET /api/gateway/runs/{run_id}` + `.../input_data` (attach context)
- `GET /api/gateway/ledger` (replay)
- `GET /api/gateway/ledger/stream` (stream)
- `POST /api/gateway/runs/start` (start run)
- `POST /api/gateway/commands` (pause/resume/cancel/resume-wait)

The UI treats the **ledger as the source of truth**:
- it replays before streaming (replay-first)
- UI status is derived from durable `emit_event` records (e.g. `abstract.status`)

### Optional: Remote Tool Worker (advanced)
For deployments where tool execution is delegated to a client-controlled environment, AbstractObserver can be configured with an **MCP HTTP tool worker** endpoint.

This is optional and should be treated as **high trust / potentially dangerous**, because it can execute tools on behalf of a run.

## Where it fits in the framework
AbstractObserver is a **host app** focused on **observability**, alongside:
- AbstractFlow Web (authoring + inspection)
- AbstractCode (CLI host)
- AbstractAssistant (desktop host)

It is designed to work even when:
- workflows are complex and nested (subflows/subruns)
- runs are long-lived
- multiple clients attach/detach over time

## Related docs
- Framework overview: `docs/architecture.md`
- Gateway architecture: `abstractgateway/docs/architecture.md`
- Runtime architecture: `abstractruntime/docs/architecture.md`

