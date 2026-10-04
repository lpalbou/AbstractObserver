# FAQ

> Last updated: 2026-09-27

## What is AbstractObserver?
AbstractObserver is a **gateway-only** observability UI (Web/PWA) for AbstractFramework runs:
- it runs in the browser (`src/ui/app.tsx`)
- it fetches/streams run data from an AbstractGateway (`src/lib/gateway_client.ts`)
- it serves the built SPA from `dist/` via a small Node.js CLI (`bin/cli.js`)

## What is the difference between an Artifact, a Server File, and a Local File?
- `Artifact`: a durable Runtime-owned payload already stored by the platform.
  Observer can search, preview, and inspect these through Gateway artifact
  envelopes.
- `Server File` / `Server Folder`: user-facing wording for a Gateway
  workspace-scoped path. Observer does not inventory these as artifacts unless a
  workflow or helper first imports/stores them.
- `Local File` / `Local Folder`: a client-device source handled by other apps
  such as Flow or Assistant before execution. Observer sees the resulting stored
  artifacts, not the original browser-local handle.

## Does AbstractObserver execute workflows?
No. It is a UI client. Execution happens behind the gateway.

Evidence:
- the browser talks to the gateway via HTTP/SSE (`src/lib/gateway_client.ts`)
- the CLI only serves static files + SPA fallback (`bin/cli.js`)

## What do I need to use it?
- Node.js `>=18` (see `../package.json`, field `engines`)
- an AbstractGateway that implements the endpoints the UI calls (see `api.md`)

## How do I run it?
```bash
npx --yes --package @abstractframework/observer -- abstractobserver
```

For other install options and CLI flags/env vars, see `../README.md` and `configuration.md`.

## Why is the npm package name different from the CLI command?
The published npm package is scoped (`@abstractframework/observer`), but the installed CLI binary is `abstractobserver`.

Examples:
- no global install: `npx --yes --package @abstractframework/observer -- abstractobserver`
- global install: `npm install -g @abstractframework/observer && abstractobserver`

## How do I change the port / host?
With launch flags: `abstractobserver --port 3002 --host 127.0.0.1` (defaults
`3001` and `127.0.0.1`; `PORT` / `HOST` still work as legacy aliases). See
`configuration.md`.

## Does the CLI proxy `/api` to my gateway?
Yes, once you are signed in. The CLI serves `dist/` and mounts the shared
`@abstractframework/app-server` session proxy: after you sign in from the
connection dialog, same-origin `/api/...` calls go to the configured gateway
(`--gateway-url`, default: the gateway installed on this computer) with the
session attached server-side. Without a session the proxy answers
`401 Gateway sign-in required`.

If you leave **Gateway URL** blank, the UI calls `/api/...` on the UI origin:
the packaged CLI, the dev server (`npm run dev`, which mounts the same proxy)
or your own reverse proxy that routes `/api` to the gateway.

Evidence: `bin/cli.js` (static server + session proxy), `vite.config.ts` (dev proxy), `src/lib/gateway_client.ts` (fetches `/api/...` when `base_url=""`).

## Which version am I running?
Open **About** (the info button in the top bar). It is the shared compact
About card of every AbstractFramework app (ui-kit `AfAboutDialog`): the
AbstractObserver version (fixed at build time from `package.json`), the
AbstractFramework and AbstractGateway versions the connected gateway reports,
links to the website, source, documentation, issues, feedback and contact, and
the author/licence line. It does not list the gateway's packages. The versions
are read from `GET /api/gateway/about` each time the dialog opens:
"checking…" while the answer is on its way, then the two versions, or
"unavailable (…)" with the reason in place of the gateway version. See
`troubleshooting.md`.

## What should I put in “Gateway URL”?
Usually: your gateway base URL (e.g. `http://localhost:8080` for local dev).

Rules enforced by the UI during discovery (see `on_discover_gateway()` in `src/ui/app.tsx`):
- must start with `http://` or `https://` (or be blank)
- `https://` UI pages cannot call an `http://` gateway (mixed content)
- when the UI is opened from a non-loopback host, `http://localhost:…` is treated as a common misconfiguration (it would resolve on the device, not your gateway machine)

## Do I need CORS?
Only if the UI origin and gateway origin differ.
- Same-origin deployments avoid CORS entirely.
- Cross-origin deployments require the gateway to allow your UI origin and headers.

See `configuration.md`.

## How does authentication work?
In hosted user-auth mode, sign in through the shared connection dialog (header badge) with the gateway URL, user id, and token.
Observer exchanges the token for an app-scoped browser session, then proxies
Gateway requests with `X-AbstractGateway-Session` and a CSRF header for writes.
The token is not persisted in browser settings.

Direct bearer-token mode remains available for local development when no
Gateway user is configured.

Operational guidance: `security.md`.

## What is the “ledger” and why “replay-first”?
The ledger is the durable sequence of step records for a run. The UI:
1) replays history via paged HTTP (`get_ledger()`), then
2) streams new steps via SSE (`stream_ledger()`).

Evidence: `src/lib/gateway_client.ts` and `src/lib/sse_parser.ts`. Diagram: `architecture.md`.

## Which gateway endpoints are required?
It depends on which UI pages/features you use.
For the authoritative list grouped by feature, see `api.md` (grounded in `src/lib/gateway_client.ts`).

## What is an automation, and who runs it?
A workflow the gateway runs for you on a schedule (every N minutes, hours or
days in UTC, or once at a time). The gateway and AbstractRuntime run it and
keep every run; the Observer creates it (**Launch → Automate**), manages it
(**Automations**) and reads its runs. Closing the browser changes nothing.
Guide: `automations.md`.

## Independent or Growing context: which should I pick?
**Independent** (default) when every run stands alone ("check the machine").
**Growing** when each run should see the previous ones ("follow this market
and tell me what changed"): runs are turns of one conversation, and the
replayed history is bounded to the most recent 50,000 tokens of whole turns.
The Context choice also sets the workflow's `use_context` input, so there is
no second control for it. See `automations.md` → "Context".

## Does the Ask chat (or the Assistant) remember the whole conversation?
It sends it (Ask) or the gateway keeps it in the conversation's session
(Assistant); either way the model reads the newest whole messages up to
50,000 tokens. When older ones were left out, a **History** note under the
answer says how many. The Assistant's **New conversation** starts from
nothing. Error cards ("(error: …)") are never sent to the model. See
`getting-started.md` → "Ask about a run, or ask the Assistant".

## Can the Assistant change files or run commands?
No. The top-bar Assistant runs with no tools (an explicit empty tool list),
so a documentation question can never write files or run commands.

## Why do the tools of my automation run without asking?
Because an unattended run cannot stop at every tick, creating the automation
approves its tool calls. Choose **Ask each time** in Launch → Automate to make
each tool call wait for your approval on the Automations page. Questions a
workflow asks you always wait. See `automations.md` → "Tools".

## Why is there no time zone or calendar schedule (for example "every day at 9:00 local")?
Schedules are fixed UTC intervals: "every 24 hours" is 24 hours after the
previous tick. Set **First run at (UTC)** under Advanced to choose the anchor.

## Does "Run now" resume a paused automation?
No. Run now starts one occurrence and the automation stays paused. It is
refused while an occurrence is in progress (`automation_busy`).

## Does "Run now" change the next scheduled run?
No. The next scheduled run keeps its time. If that time comes while the manual
run is still going, the scheduled run starts as soon as the manual run ends.
A manual run does not count toward a schedule's run limit.

## Does discussing a result change the automation?
No. **Discuss** forks the automation at that occurrence: a new session with
the automation's history up to it (runs 1 to N), opened as a chat on the
Automations page. It works
in its own writable workspace, with the automation's folder mounted read-only
for the file tools (shell commands are not sandboxed); nothing is written back
into the automation's session or its next runs.

## How do I get the files an automation wrote, when the gateway runs on another machine?
Select the automation and press the folder button next to **Workspace**: the Observer lists its folder
through the gateway and opens or downloads each file in your browser. See
`automations.md` → "The automation's files".

## Why is my automation not on the Board?
An automation between runs is not a run you can act on, so it lives on the
Automations page. Its occurrences are Board cards (tag `occurrence #N`) with
an **Automation** button back to it.

## I archived a conversation in AbstractCode — is it gone from Observer?
No. Archiving only hides a conversation from chat lists; nothing is deleted.
The Board keeps its runs, with an **Archived** tag on the card, and the run view
and ledger read as before. Unarchive it from AbstractCode's **Archived · N** line.

## What happens to my legacy schedules?
They keep running with their controls (Suspend / Resume / Run now / Open run,
Edit schedule in the run view). **Recreate as automation** prefills Launch →
Automate from one; the legacy schedule is not changed until you suspend it.
See `automations.md` → "Legacy schedules".

## Where are Backlog / Inbox / Processes?

They live in AbstractContinuum (`@abstractframework/continuum`): AbstractObserver observes and discusses runs; AbstractContinuum develops and deploys.


## What is the “Remote tool worker (MCP)”?
If configured, AbstractObserver can execute tool waits via an MCP HTTP JSON-RPC endpoint and then resume the run.

Evidence:
- worker client: `src/lib/mcp_worker_client.ts`
- UI resume flow: `execute_tools_via_worker()` in `src/ui/app.tsx`

Security guidance: `security.md`.

## Does it support voice (PTT / TTS)?
Yes — in **Observe → Chat**, the UI can:
- record audio in the browser, upload it to the gateway, and request transcription (push-to-talk)
- request gateway-based text-to-speech audio and play it back (TTS)

Gateway endpoints: `api.md` (Voice section).

Evidence:
- voice hook: `src/ui/use_gateway_voice.ts`
- UI wiring: `src/ui/app.tsx`
- gateway client: `src/lib/gateway_client.ts` (`attachments_upload()`, `audio_transcribe()`, `voice_tts()`)

## What is “monitor-gpu” and how do I enable it?
It’s an optional GPU usage widget in the header. Enable it by starting the CLI with:
- `abstractobserver --monitor-gpu`, or
- `ABSTRACTOBSERVER_MONITOR_GPU=on`

Evidence:
- HTML config injection: `bin/cli.js`
- UI feature gate: `monitor_gpu_enabled` in `src/ui/app.tsx`

## How do I enable Backlog or Inbox triage?

These live in AbstractContinuum (`@abstractframework/continuum`): AbstractObserver observes and discusses runs; AbstractContinuum develops and deploys.


## Is this a PWA? Does it work offline?
The app registers a service worker in production to cache the UI shell (installability + faster reloads), but run data still comes from the gateway.

Evidence: `src/main.tsx`, `public/sw.js`.

## I updated the UI but my browser still shows an old version
Production builds use a service worker; clear site data/unregister the SW if needed.

See `troubleshooting.md`.

## I want to build from source but imports like `@abstractframework/monitor-*` fail
Dev/build aliases the monitor packages to the sibling AbstractUIC checkout under `../abstractuic/*/src`; clone AbstractUIC next to this repository. `@abstractframework/ui-kit` and `@abstractframework/panel-chat` come from `npm install`.

Evidence: `vite.config.ts`. See `development.md`.

## See also
- Getting started: `getting-started.md`
- Docs index: `README.md`
- Architecture: `architecture.md`
- Configuration: `configuration.md`
- API (gateway endpoints used): `api.md`
- Automations: `automations.md`
- Security: `security.md`
- Troubleshooting: `troubleshooting.md`
