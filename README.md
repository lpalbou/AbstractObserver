# AbstractObserver (Web/PWA)

This is a **gateway-only** observability UI for AbstractFramework:
- connect to a Run Gateway (`/api/gateway/*`)
- render by replaying/streaming the **ledger**
- act by submitting **durable commands**

See:
- Backlog: `docs/backlog/completed/317-abstractcode-react-thin-client-web-pwa-ios-dev-deploy.md`
- iPhone guide: `docs/guide/deployment-iphone.md`

## Local dev
```bash
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
  - click **New Run** and provide inputs in the modal, then **Start**.
