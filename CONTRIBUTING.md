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
This repo’s dev/build configuration aliases several `@abstractuic/*` imports to sibling workspace paths under `../abstractuic/*/src` (see `vite.config.ts`).

If you only cloned this repo, you can either:
1) check out the expected sibling repos under `../abstractuic`, or
2) replace the Vite aliases and add proper package dependencies (if/when those packages are published).

Details: `docs/development.md`.

## Documentation changes
We treat docs as user-facing product surface.
When you change behavior or configuration:
- update the relevant docs under `docs/`
- keep language concise and actionable
- when practical, reference the implementing file(s) (source of truth)

Docs entrypoint: `README.md` → `docs/getting-started.md` → `docs/README.md`.

## Pull request checklist
- Scope: small and focused (avoid drive-by refactors)
- Quality: `npm test` passes
- Release readiness (if applicable): `npm run build` passes
- Docs: updated if you changed UX, config, or API usage

## Reporting security issues
Please do **not** open public issues for suspected vulnerabilities.
See `SECURITY.md` for responsible disclosure instructions.

