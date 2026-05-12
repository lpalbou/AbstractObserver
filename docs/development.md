# Development

## Prerequisites
- Node.js `>=18` (see `package.json#engines`)
- npm

## Run from source (local dev)
```bash
npm install
npm run dev
```

### Shared UI dependencies
The UI imports the public `@abstractframework/*` UI package names, and Vite aliases them to sibling `../abstractuic/*/src` packages for source builds. GitHub Actions checks out `AbstractUIC` next to `AbstractObserver` before testing, building, and publishing.

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
- GitHub Actions publishes through `.github/workflows/release.yml` using npm trusted publishing/provenance. Configure the npm package trusted publisher for `lpalbou/abstractobserver` and the `npm` environment before running the workflow.

## Useful scripts
- `npm run dev` — Vite dev server (defaults to port `3001`; proxies `/api` to `http://localhost:8081` per `vite.config.ts`)
- `npm run preview` — preview the production build
- `npm test` — run unit tests

## See also
- Getting started: `getting-started.md`
- Configuration & deployment: `configuration.md`
- Architecture: `architecture.md`
- Security & trust boundaries: `security.md`
