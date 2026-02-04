# Development

## Prerequisites
- Node.js `>=18` (see `package.json#engines`)
- npm

## Run from source (local dev)
```bash
npm install
npm run dev
```

### Workspace dependencies (important)
The UI imports several “AbstractUIC” packages (examples in `src/ui/app.tsx`) and `vite.config.ts` aliases them to local source paths like `../abstractuic/*/src`.

That means `npm run dev` / `npm run build` expect the following to exist **next to** this repo:
- `../abstractuic/monitor-active-memory/src`
- `../abstractuic/monitor-flow/src`
- `../abstractuic/panel-chat/src`
- `../abstractuic/ui-kit/src`
- `../abstractuic/monitor-gpu/src`

If you only cloned `abstractobserver`, you have two options:
1) check out the required sibling repos under `../abstractuic`, or
2) replace the Vite aliases and add proper package dependencies (if/when those packages are published).

## Tests
```bash
npm test
```

Test suite is Vitest (see `vitest.config.cjs`) with unit tests under `src/**.test.ts(x)`.

## Build
```bash
npm run build
```

- Builds the SPA into `dist/` (Vite) and type-checks via `tsc`.
- The published CLI serves `dist/` (see `bin/cli.js`).
- `npm publish` runs `npm run build` via `prepublishOnly` (see `package.json`).

## Useful scripts
- `npm run dev` — Vite dev server (defaults to port `3001`; proxies `/api` to `http://localhost:8081` per `vite.config.ts`)
- `npm run preview` — preview the production build
- `npm test` — run unit tests

## See also
- Getting started: `getting-started.md`
- Configuration & deployment: `configuration.md`
- Architecture: `architecture.md`
- Security & trust boundaries: `security.md`
