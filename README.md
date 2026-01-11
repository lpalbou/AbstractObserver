# AbstractObserver (Web/PWA)

This is a **gateway-only** observability UI for AbstractFramework:
- connect to a Run Gateway (`/api/gateway/*`)
- render by replaying/streaming the **ledger**
- act by submitting **durable commands**

## Docs
- Architecture: `docs/architecture.md`

## Installation

### Global CLI (recommended)
```bash
npm install -g abstractobserver
abstractobserver
```

This will start the UI server on `http://localhost:3001` (configurable via `PORT` env var).

### From source
```bash
git clone https://github.com/lpalbou/abstractobserver.git
cd abstractobserver
npm install
npm run dev
```

## Start a workflow
- Run a gateway (`abstractgateway`) with `ABSTRACTGATEWAY_WORKFLOW_SOURCE=bundle` and `ABSTRACTGATEWAY_FLOWS_DIR` pointing to a directory containing one or more `*.flow` bundles.
- For LLM/tool/agent workflows in bundle mode, configure:
  - `ABSTRACTGATEWAY_PROVIDER` and `ABSTRACTGATEWAY_MODEL`
  - `ABSTRACTGATEWAY_TOOL_MODE=passthrough` (default) or `ABSTRACTGATEWAY_TOOL_MODE=local` (dev only)
- In the UI:
  - click **Connect** to discover workflows/runs/tools/providers,
  - select a workflow (discovered) to load its entrypoint pin schema,
  - click **Start Workflow** and provide inputs in the modal, then **Start**.
