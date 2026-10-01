# Getting started

AbstractObserver is a **gateway-only** observability UI (Web/PWA) for AbstractFramework runs.
It serves a static single-page app (`dist/`) via a small Node.js CLI (`bin/cli.js`) and talks to an AbstractGateway HTTP API from the browser (`src/lib/gateway_client.ts`).

## Prerequisites
- Node.js `>=18`
- A running **AbstractGateway** (base URL, e.g. `http://127.0.0.1:8080`)
- In hosted user-auth mode, a Gateway user id and that user's token

## Run AbstractObserver
The npm package is `@abstractframework/observer` and the installed CLI binary is `abstractobserver`.

Run the packaged UI server (no build step):
```bash
npx --yes --package @abstractframework/observer -- abstractobserver
```

By default the server listens on `127.0.0.1:3001` and talks to the gateway
installed on this computer. Choose another port or gateway with flags:
```bash
npx --yes --package @abstractframework/observer -- abstractobserver --port 3002 --gateway-url http://127.0.0.1:8080
```
On a remote server, open the Observer through the gateway instead:
`<gateway>/apps/observer/` (see `configuration.md`).

Open `http://localhost:3001`.

## Connect to a gateway
Sign-in uses the shared AbstractFramework connection dialog. It opens
automatically when this browser has no Gateway session, and is always one
click away on the header connection badge (**Settings → Manage connection…**
opens it too):
- **Gateway URL**: pre-filled from the server's `--gateway-url` (default: the gateway installed on this computer, else `http://127.0.0.1:8080`).
  - Leave it **blank** only if you deploy the UI and gateway **same-origin** (a reverse proxy routes `/api` to the gateway), or when using `npm run dev` (Vite dev proxy; see `vite.config.ts`).
- **Gateway user** and **Gateway token**: use the user id and token assigned by
  the Gateway admin. The token is exchanged for an app-scoped browser session
  and is not persisted in browser settings.

Click **Connect** (or keep **Auto-connect** enabled).
Direct bearer-token mode remains available for local development when no
Gateway user is set.

## The Board (landing page)
You land on **Board** — Mission Control: kanban columns
**Pending / Working / Review / Done** across every run, plus an entities
strip. Cards move themselves as run state changes (the list polls live);
the **Review** column is where a human is the blocker — approve/deny tool
requests or answer questions inline, or click any card to open the run.

## Observe a run
Go to **Observe** (or click a Board card):
- pick a run from **Runs**
- inspect:
  - **Ledger** (durable log; replay-first + streaming)
  - **Graph** (flow visualization from bundle/workflow flow data)
  - **Digest** (derived stats + summary)
  - **Ask** (ask about this run; optional voice PTT + TTS when the gateway exposes the endpoints in `api.md`)

Architecture and data flow: `architecture.md`.

## Ask about a run, or ask the Assistant
Two chats, for two different questions:

- **Ask** (a run's tab) answers questions about **that run**, grounded in its
  ledger (subruns included). The model is the one in **Settings → Assistant**
  (blank = the gateway's default). Every message of the conversation is sent,
  whole; the gateway replays the newest whole messages up to 50,000 tokens.
  When it had to leave older messages out, a **History** note under the
  answer says so: "Earlier messages not replayed: 49 (~61,234 tokens). The
  model read the newest 12 messages (history window: the most recent 50,000
  tokens of whole messages)." When a request fails, the chat shows the
  gateway's reason as an "(error: …)" card; that card is the Observer's, and
  it is never sent back to the model with the next question.
- **Assistant** (the top bar) answers questions about **the Observer
  itself**, from its documentation index. Each conversation is one gateway
  session: only your question is sent, and the gateway replays the earlier
  turns of that conversation (newest whole turns up to 50,000 tokens); the
  same **History** note shows when some were left out. **New conversation**
  starts a new session and clears the thread, so nothing earlier is replayed.
  The Assistant runs with **no tools**: it cannot read or write files or run
  commands, whatever the gateway's default agent may do.

## Launch a run or create an automation
Go to **Launch**:
- **Run once**: select a workflow (discovered from gateway bundles, or the
  gateway's default agent), fill its inputs, click **Launch now**
  (`POST /api/gateway/runs/start`);
- **Automate**: the same workflow and prompt, plus **When** (every N
  minutes/hours/days in UTC, or once at a time), **Context** (independent
  or growing) and **Tools** (run without asking, which creating the
  automation approves, or ask each time); **Create automation** sends
  `POST /api/gateway/automations` and opens it on the **Automations** page.

On the **Automations** page you pause, resume, run now, edit or archive an
automation, read its runs as a conversation, answer runs that wait for you,
browse its files, and discuss a result in a chat with a fork of
the automation, on the same page. Automations need a gateway that
advertises the Automations API; otherwise the page says so.

Details: `automations.md`; endpoints: `api.md`.

## Responsive layout
AbstractObserver works on phones, tablets and desktop windows of any size:

- **Below 1024 px wide** (tablets, narrow windows) the sidebar becomes a drawer: open it with the menu
  button at the left of the header; it closes when you pick a page, press Escape, tap outside it or use its
  close button. Pages that show several panes stack them and scroll.
- **Below 768 px wide, or in landscape under 500 px tall** (phones), pages scroll as a whole and Observe shows
  the run list above the selected run; picking a run scrolls to it. Dialogs open as bottom sheets with their
  buttons always visible, above the on-screen keyboard.
- **Lists use the full width on phones.** Automations, Observe, the Board and System show their lists and details
  as flat sections with thin separators; only the page scrolls. Every list (Automations, Observe's runs, System's
  Queues and Runs, each Board column) has a header button with a chevron that hides it and gives the detail the
  whole screen; lists are open by default and your choice is remembered in this browser.
- **On touch screens** buttons, tabs, rows and fields are at least 44 px tall, text fields use 16 px text (iOS
  Safari does not zoom when you focus them), and reading text (ledger payloads, Story entries, dialog text)
  is 14 px.
- **On wide windows** (1800 px and more) Settings uses two columns and the Observe run list is wider.

You can still pinch to zoom on phones. The text size and theme follow the **Appearance** settings (the
half-filled circle in the top bar) on every screen size.

## Switches
Every setting that is either on or off is a switch named after what it controls: an automation's **Active**,
**Archived (N)** on the Automations page, **Apply immediately** in Edit schedule, **Auto-connect on load** and one
switch per assistant skill in Settings, **Live** in System → Memory map, and **Email me the result** in
Launch → Automate. A switch that is on is highlighted; one that cannot change right now is unavailable and says why
(next to it on touch screens, in its tooltip with a mouse). One-shot actions, such as pausing a running run, stay
buttons. See `automations.md` for the Active switch.

## Open the Observer from another computer over http
You can open the Observer from another computer at the gateway's plain http address, for example
`http://<host>:8080/apps/observer/` on your LAN or over Tailscale. Runs, automations and the ledger work there;
**Copy** uses the browser's copy command when the clipboard API is withheld and says "Copied to clipboard" or
"Copy failed — select and copy". Browsers offer the microphone and camera only on https or on the computer itself,
so over plain http the voice control in Ask stays off and says: "This page is loaded over http, so voice and camera
is unavailable — open it over https (for example through tailscale serve; the gateway console's Network page
explains how) or on the gateway's own computer." To use voice from another computer, open the Observer through an
https address such as `tailscale serve` or your own HTTPS reverse proxy (`configuration.md`).

## Next
- Docs index: `README.md`
- FAQ: `faq.md`
- Configuration & deployment: `configuration.md`
- Gateway endpoints used by the UI: `api.md`
- Security & trust boundaries: `security.md`
- Development (from source): `development.md`
- Troubleshooting: `troubleshooting.md`
