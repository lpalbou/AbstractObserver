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

## Lockfile check

`npm run check:lock` runs `scripts/check_lock.mjs`, and CI runs it before `npm ci`. It
fails when `package-lock.json` lags `package.json` (the lock's root entry records a different
dependency spec: `package.json` was edited without `npm install`), and when an
`@abstractframework/*` dependency (`ui-kit`, `panel-chat`, `app-server`, `monitor-*`) is missing
from the lock, resolves below the `package.json` floor or to another major.minor, comes from a
local `file:` tarball, or has a nested copy that differs from the top-level one. Fix it with
`npm install` (or `npm install @abstractframework/<name>@^<version>` to raise a floor) and commit
both files.

At release time, `npm run check:lock -- --latest` also fails when npm has a newer patch of an
`@abstractframework/*` dependency than the lock resolves (needs the network).

```bash
npm run check:lock
```

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
- Lockfile: `npm run check:lock` passes (see [Lockfile check](#lockfile-check))
- Release readiness (if applicable): `npm run build` passes
- Docs: updated if you changed UX, config, or API usage

## Reporting security issues
Please do **not** open public issues for suspected vulnerabilities.
See `SECURITY.md` for responsible disclosure instructions.
