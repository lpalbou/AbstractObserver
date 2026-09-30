# Contributing

Thanks for your interest in improving AbstractObserver.

If you’re unsure where to start, open an issue describing what you want to do — we’re happy to help you shape a good PR.

## Development quickstart
Prereqs:
- Node.js `>=18`
- npm

```bash
npm install
npm test
npm run dev
```

Build the production bundle (served by the CLI):
```bash
npm run build
```

## Workspace dependencies (important)
`@abstractframework/ui-kit` and `@abstractframework/panel-chat` are npm dependencies (`npm install`). The monitor packages (`@abstractframework/monitor-active-memory`, `monitor-flow`, `monitor-gpu`) are aliased to the sibling AbstractUIC checkout under `../abstractuic/*/src` (see `vite.config.ts`), so check out AbstractUIC next to this repository.

Details: `docs/development.md`.

## Documentation changes
We treat docs as user-facing product surface.
When you change behavior or configuration:
- update the relevant docs under `docs/`
- keep language concise and actionable
- when practical, reference the implementing file(s) (source of truth)
- regenerate `llms-full.txt` with `npm run llms:full` (keeps agent context in sync)

Docs entrypoint: `README.md` → `docs/getting-started.md` → `docs/README.md`.

## Pull request checklist
- Scope: small and focused (avoid drive-by refactors)
- Quality: `npm test` passes
- Release readiness (if applicable): `npm run build` passes
- Docs: updated if you changed UX, config, or API usage

## Reporting security issues
Please do **not** open public issues for suspected vulnerabilities.
See `SECURITY.md` for responsible disclosure instructions.
