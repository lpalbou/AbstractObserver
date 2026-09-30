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
`@abstractframework/ui-kit` and `@abstractframework/panel-chat` are regular dependencies declared in `package.json`; `npm install` resolves them. The monitor packages (`@abstractframework/monitor-active-memory`, `monitor-flow`, `monitor-gpu`) are imported by their public names and Vite aliases them to the sibling `../abstractuic/*/src` packages, so clone [AbstractUIC](https://github.com/lpalbou/AbstractUIC) next to this repository:

```text
<workspace>/
  abstractobserver/
  abstractuic/
```

The CLI and the Vite dev server also import `@abstractframework/app-server` (the shared Gateway session proxy). It is a regular runtime dependency declared in `package.json`; `npm install` resolves it for you. GitHub Actions checks out `AbstractUIC` next to `AbstractObserver` before installing, testing, building, and publishing.

## Tests
```bash
npm test
```

Test suite is Vitest (see `vitest.config.cjs`) with unit tests under `src/**.test.ts(x)`.
The automations tests (`src/ui/automations.test.tsx`) start `scripts/automations_stub_server.mjs`
in-process: a stub gateway for the Automations routes that serves the ui-kit's canonical fixtures
(`../abstractuic/ui-kit/scripts/fixtures/automations/`). It can also run on its own:
`node scripts/automations_stub_server.mjs --port 18951`.

## Responsive layout rules
Layout rules for screen sizes live in `src/ui/responsive.css` (loaded last, after the page stylesheets). Use only
these breakpoints: `max-width: 479.98px`, `767.98px`, `1023.98px`, `1439.98px`, `min-width: 1440px` (and
`1800px` for very wide windows), plus `max-height: 500px` for phone landscape; `src/ui/styles.test.ts` fails on any
other value. The navigation drawer's state, attributes and focus trap are in `src/ui/nav_drawer.ts`, covered by
`src/ui/responsive_layer.test.tsx`. `scripts/responsive.screens.mjs` drives the app through its main screens
(sign-in, Launch, Automate, approval, Observe, Board, System, Memory, Settings, About) for layout checks at each
screen size.

## Build
```bash
npm run build
```

- Builds the SPA into `dist/` (Vite) and type-checks via `tsc`.
- The published CLI serves `dist/` (see `bin/cli.js`).
- `npm publish` runs `npm run build` via `prepublishOnly` (see `package.json`).
- GitHub Actions publishes through `.github/workflows/release.yml` using npm trusted publishing/provenance. Configure the npm package trusted publisher for `lpalbou/AbstractObserver` and the `npm` environment before running the workflow.

## Useful scripts
- `npm run dev` — Vite dev server (defaults to port `3001`; mounts the app-server session proxy and falls back to proxying `/api` to `http://127.0.0.1:8080` per `vite.config.ts`)
- `npm run preview` — preview the production build
- `npm test` — run unit tests

## See also
- Getting started: `getting-started.md`
- Configuration & deployment: `configuration.md`
- Architecture: `architecture.md`
- Security & trust boundaries: `security.md`
