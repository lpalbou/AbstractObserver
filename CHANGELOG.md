# Changelog

## [Unreleased]

On/off settings are switches. Every setting that is either on or off now shows as one switch labelled by the
feature, highlighted when on, instead of a Pause/Resume button pair, an On/Off select or a checkbox. Built with
AbstractUIC ui-kit 0.3.3 (`AfSwitch`).

### Changed
- **Automations: an "Active" switch** on every automation row replaces the Pause / Resume buttons (on = runs on its
  schedule, off = paused; it sends `automation.pause` / `automation.resume`). Legacy scheduled runs get the same
  switch instead of Suspend / Resume. An automation that has ended, is archived or does not allow the change shows
  the switch unavailable, with the reason on hover and for screen readers; while a command is in flight the switch is
  busy. The feedback line states the new state ("“News” is paused: scheduled runs are skipped.").
- **Automations list:** "Show archived (n)" is an "Archived (n)" switch.
- **Observe toolbar, legacy scheduled run:** the schedule's "Active" switch replaces the "Suspend schedule" /
  "Resume schedule" button; switching it off still asks for a reason first. Pausing a running run stays a button
  (a one-shot action).
- **Edit schedule dialog:** "Apply immediately" is a switch; the dialog's single primary action saves it with the
  interval.
- **Settings:** "Auto-connect on load" is a switch (was an On/Off select); each assistant skill is a switch named by
  the skill (was a checkbox).
- **System → Memory map:** "Live" is a switch.
- The ledger's view toggle is always labelled "Condensed" (highlighted when on) instead of swapping to "All"; it and
  the Flow graph's Subflows / Path toggles announce their state (`aria-pressed`); artifact type filter chips name the filter rather than an Add / Remove verb.
- For contributors: `src/ui/state_toggles.test.tsx` runs the kit's `findVerbToggleLabels` over `src/` and checks
  every switch in both states.

## [0.4.0] - 2026-09-30

Responsive layout: AbstractObserver adapts to phones, tablets and resized desktop windows. Everyone who opens the
Observer on a phone, a tablet or a window narrower than a laptop screen is affected; on a desktop window at least
1440 px wide the layout and look stay as they were. Built with AbstractUIC ui-kit 0.3.2, panel-chat 0.2.1 and
monitor-active-memory 0.2.1.

### Changed
- **Navigation drawer below 1024 px.** The sidebar opens from the menu button at the left of the header and closes
  with Escape, a tap outside it, its close button, or when you pick a page; while it is open, keyboard focus stays
  inside it and returns to the menu button when it closes.
- **One pane at a time on phones** (below 768 px wide, or in landscape under 500 px tall): pages scroll as a whole;
  Observe shows the run list, or the selected run with a **Runs** button to go back; the run's Story / Ledger /
  Flow / Ask panel fills the screen, and **Open ledger** and the tabs bring it into view. Tablets and narrow windows
  keep the run list next to the run.
- **Dialogs as bottom sheets on phones**, with their action buttons always visible (wrapping on narrow screens, one row
  in landscape) and kept above the on-screen keyboard. App dialogs are announced as dialogs to assistive technology.
- **Touch sizes:** on touch screens, buttons, tabs, list rows, checkbox rows and form fields are at least 44 px tall;
  text fields and selects use 16 px text (no zoom on focus in iOS Safari); secondary text is one step larger; the
  ledger payloads, Story entries and dialog text use 14 px.
- **System page:** its panes stack and scroll below 1024 px; the Memory explorer becomes a full-screen panel with the
  graph on top; the three Activity panes share the width on 1024-1439 px windows; the section tabs keep their height.
- **Launch / Automate:** fields take the full width on phones.
- **Wide windows** (1800 px and more): Settings shows two columns and the Observe run list is wider.
- The app follows the visible viewport height on mobile browsers (address bar, on-screen keyboard) and pads for the
  notch and the home indicator.
- For contributors: breakpoints are 480 / 768 / 1024 / 1440 px plus a 500 px height query (`src/ui/responsive.css`,
  guarded by `src/ui/styles.test.ts` and `src/ui/responsive_layer.test.tsx`); `@abstractframework/ui-kit` and
  `@abstractframework/panel-chat` are npm dependencies; `scripts/responsive.screens.mjs` lists the screens used for
  layout checks at each screen size.

## [0.3.0] - 2026-09-30

Built with AbstractUIC ui-kit 0.2.0 (CI and release check out AbstractUIC v0.2.0). The email options need
AbstractGateway 0.8.0 or later (per-user email: `/api/gateway/me/email`, the `email.received@1` trigger).

### Added
- **Email automations in Launch → Automate.** **When an email arrives** (a When choice: from these
  addresses / domains, sent to these addresses, subject contains, attachments; **Check for new mail every**,
  1 hour by default for a model and never under 60 s, with the rule shown; **At most this many emails per
  run**), **Email me the result** (`notify.channels: ["console", "email"]`) and **May send email without
  asking to: Only me / Me and these addresses** (`policy.email_allowed_recipients`) — the kit's
  `AfEmailTriggerFields` / `AfEmailOptionsFields`. The Observer reads `GET /api/gateway/me/email` with every
  Automations refresh and when Launch → Automate opens; without a usable account the options are off, the
  form says "Email isn't set up — open My email" (opens `<gateway>/console#users` in a new tab) and nothing
  email-shaped is sent (an email trigger is refused with that sentence).
- The automation panel's Edit form and Definition card get the email status (the kit's email fields there).
- Tests: `src/ui/automations_email.test.tsx` (red before).

## [0.2.1] - 2026-09-28

Built with AbstractUIC ui-kit 0.1.16.

### Added
- Every automation row control has a tooltip and `aria-description` saying
  what it does: the shared AbstractUIC hint (`controlHint`, ui-kit 0.1.16),
  the same text as the panel and the other clients. **Run now**'s says it runs
  once now instead of waiting, that the next scheduled run keeps its time (or
  starts right after this run if its time comes first), that it does not
  count toward a run limit and works while paused, with the next scheduled
  time. A disabled control's tooltip first says why. Legacy rows use the
  kit's icons.

## [0.2.0] - 2026-09-28

Items marked (gateway) need AbstractGateway 0.7.0 or later (endpoint-profile
Ask, server-owned `use_context`, `input_data` without gateway-made folders).

### Added
- The folder button next to an automation's **Workspace** (and **Workspace**
  in a run's details) browses that folder on the gateway host and opens or
  downloads each file in the browser, through the gateway's workspace routes;
  a discussion's chat has **Its files** and **Automation files**. HTML, SVG and
  other text files open as plain text.
- **Discuss** opens a chat with a fork of the automation on the Automations
  page (row: latest finished run; panel: the chosen occurrence). Follow-ups
  are later turns of the same discussion session, with the same model. The
  chat is the shared AbstractUIC chat: live replies, tool approvals and
  questions answered in place, Stop.
- Automation states read as a word then its icon ("Active ▶", "Paused ⏸"),
  row actions and facts carry icons, and runs read as chat cards (shared
  AbstractUIC components).
- **Edit** opens the Edit form: a row's Edit selects the automation and opens its Edit form at
  once, prefilled and focused; the panel's Revise control is now **Edit** too.
  The form changes the title, the **task**, the interval, the context and the
  **tools** (ask / run without asking); Save sends one `PATCH` with
  `expected_revision` and closes the form, Cancel or Escape closes it
  (AbstractUIC ui-kit 0.1.15).

- The gateway can serve the Observer through itself at `/apps/observer/`
  (one port and one address for the console, the API and the apps): the
  server announces `X-AbstractFramework-App: observer; mount=1`, puts
  `<base href>` in the page, sets its session cookies at the mount's path and
  decides "browser on this machine" from the address the gateway forwards.
  The same build keeps working at `/`.
- Launch flags: `--gateway-url` (aliases `--gateway`, `--url`), `--port`,
  `--host`, `--monitor-gpu`, `--entity-app-url`, `--gateway-dir`, `--help`.
  Without `--gateway-url` the server talks to the gateway installed on this
  computer (`~/.abstractframework/gateway.json`) and follows it when it moves
  port.

### Changed
- Automations page, calmer and consistent: every action button is an icon
  then its name, in the rows and the panel (the kit's names and icons);
  **New automation** and **Refresh** are compact header buttons (was a
  full-width bar); Archive is the icon at the end of a row; the result of an
  action shows for a few seconds with a dismiss button instead of staying
  under the buttons; a disabled control's reason is its tooltip (was a line
  under the panel's buttons); the workspace is one control, folder icon and
  the whole path wrapping at its separators; the Definition is a card right
  under the panel's controls.
- The server binds `127.0.0.1` by default (was `0.0.0.0`); pass
  `--host 0.0.0.0` to reach it directly from other machines, or open it
  through the gateway at `/apps/observer/`. `PORT`, `HOST` and the
  `ABSTRACTOBSERVER_*` variables are legacy aliases below the flags.
- Every URL the app uses is relative to the page's base (assets, the gateway
  API, the session endpoint, the service worker and its scope, the manifest).
- The automation's **Context** choice is the one history control: Automate
  mode neither shows nor sends the workflow's **Use Context** input
  (gateway).
- Growing context copy: the most recent 50,000 tokens of whole turns are
  replayed.
- A run's **Ask** chat sends the whole conversation (it sent only the last
  20 messages). The gateway replays the newest whole messages up to 50,000
  tokens; when it drops older ones, the chat says so under the answer
  ("Earlier messages not replayed: N", with the token count) (gateway).
- The top-bar **Assistant** sends only the question (the documentation index
  is its system prompt). Earlier turns are replayed by the gateway from the
  conversation's own session (newest whole turns up to 50,000 tokens), not
  copied into the prompt as the last 6 turns cut to 1,200 characters each.
  **New conversation** in the drawer starts a fresh session; the drawer shows
  when earlier messages were not replayed (gateway).
- The top-bar **Assistant** runs with no tools (an explicit empty list), so a
  docs question can never write files or run commands; it ran with the basic
  agent's defaults, which include both.

### Security
- Requires `@abstractframework/app-server` 0.1.11 or later: a browser counts
  as on this machine only when its address is loopback and the page's host
  names loopback, so a DNS-rebinding page can neither reveal a folder nor
  change the Gateway URL.
- The folder reveal (`POST api/local/reveal`) follows the rule of every
  mutating route of the app's origin: it needs this browser session's CSRF
  token in `X-AbstractObserver-CSRF` (or `X-Abstract-CSRF`), and a request
  that names another site's `Origin` is refused. A cross-site POST could open
  a file-manager window on any folder that exists on the machine.

### Fixed
- A run's ledger and artifacts in the automation panel open through the
  Observer's own credentials (session or bearer; mounted or direct), never
  as raw gateway links; HTML and SVG open as text.
- An HTML artifact preview shows its source instead of opening it as a page
  in the app's origin.
- Ask and Summary show the gateway's reason when it cannot answer, instead of
  "(error: failed to generate answer)". The Ask chat's own "(error: …)" cards
  are no longer sent back to the model as history with the next question.
- Ask about an automation (or any run) answers on gateways whose default text
  model is an endpoint profile (gateway).
- CI and release build against a pinned AbstractUIC release (`v0.1.15`)
  instead of its default branch; the workflows no longer claim app-server is
  a `file:` link.
- A new automation or launch no longer inherits the workspace folder of a run
  viewed in Observe (gateway), and a reused gateway folder is refused with a
  message that says to leave the field empty.

## [0.1.14] - 2026-09-27

Automations need a gateway that advertises the Automations API
(`capabilities.contracts.common.automations`); on other gateways the Automate
mode and the Automations page explain why they are unavailable.

### Added
- **Launch** says what each mode does in one sentence under the switch
  (**Run once**: one run now; **Automate**: an automation on a schedule or on
  demand, managed on the Automations page).
- **+ New automation** on the Automations page opens Launch in Automate mode;
  `#launch/automate` links there directly.
- Automation rows show the run in progress ("Run #7 running") and the next
  run with its distance ("in 25 min"), each from its own gateway field; Run
  now and Stop current follow the run in progress, never the last run's
  status.
- The Automations page hides archived automations until **Show archived** is
  ticked (or the Archived filter is chosen).
- **Launch → Automate**: create an automation from three fields: **What** (a
  workflow or the gateway's default agent, and the prompt), **When** (every
  N minutes, hours or days in UTC, or once at a time; presets from every
  5 minutes to every 7 days) and **Context** (independent, or growing with a
  bounded history). **Tools** states that tools run without asking because
  creating the automation approves them, and offers **Ask each time**.
  Title, first run, run limit, end time, skills, workspace and bundle
  upload / reload are under **Advanced**. Retrying the same request does not
  create a second automation.
- **Automations** page: every automation of the signed-in user with its
  cadence, next run, state, last result and what needs you, refreshed every
  30 seconds while visible and filterable by status. Controls: pause,
  resume, run now (also while paused; the automation stays paused), stop
  current, revise, archive. Conflicts (`automation_busy`,
  `revision_conflict`, `invalid_state`, `identity_conflict`) are explained
  in one sentence with the gateway's message.
- The automation panel shows the runs as a conversation (what fired, then
  the answer), quiet by default, with notifications, failures (reason and
  attempts) and waits marked, a **Needs attention** list, and **Load earlier
  occurrences**. Run details open the run in Observe or the raw ledger and
  workspace.
- Waiting runs are answered in place by the kind of wait: a question (text
  or a choice), a tool approval (the tool calls with their arguments, then
  Approve / Deny) or an event (a JSON payload). Tool approvals on the Board
  and in the run view list the tool calls too.
- **Discuss — fork at this occurrence (own workspace, automation files
  read-only)**: start a new session that forks the automation at a finished
  occurrence with its full history, and continue in Observe. It works in its
  own writable workspace with the automation's folder mounted read-only; the
  Observer shows both folders when it starts. File tools refuse writes into
  the mounted folder; shell commands are not sandboxed. The automation and
  its next runs are not affected.
- Board, Observe and System tag automation runs from the gateway's
  attribution: occurrence cards carry `occurrence #N` and an **Automation**
  button; the run navigator groups occurrences under their automation and
  tags discussions and legacy schedules; System → Activity lists
  **Scheduled** separately from **Subflows / external events**.
- **Run once** can start the gateway's default agent.
- Legacy schedules appear on the Automations page with their own controls
  (suspend, resume, run now, open run) and **Recreate as automation**, which
  opens Automate prefilled from the schedule and leaves the schedule itself
  unchanged.
- `scripts/automations_stub_server.mjs`: a stub gateway for the Automations
  routes, serving the ui-kit's canonical fixtures, for development and tests.

### Changed
- Launch creates schedules through **Automate**; the previous schedule form
  (start at, repeat modes, weeks and months) is removed. Existing schedules
  keep their suspend / resume / run now / edit controls in the run view.
- Launch has one skills picker (the trust-aware list); a workflow's `skills`
  input does not add a second one.
- A run is treated as scheduled only from the gateway's attribution, not
  from a workflow id starting with `scheduled:`. An automation waiting for
  its next run is shown on the Automations page rather than as a Board card.
- Run listings keep `actor_id`.

## [0.1.13] - 2026-09-26

### Added
- **About dialog**: the info button in the top bar opens the shared
  AbstractFramework About dialog, with the AbstractObserver version, links to
  its website, source, documentation, issue tracker and feedback page, and the
  versions the connected gateway reports (`GET /api/gateway/about`, read each
  time the dialog opens). If the gateway does not answer, the dialog says
  "Gateway: unavailable" with the reason.
- `package.json` now lists the project website as `homepage` and the issue
  tracker as `bugs`.

### Changed
- Requires `@abstractframework/app-server` 0.1.10 or newer (was 0.1.9), so the
  forwarding-header protection below is always present.

### Security
- With `@abstractframework/app-server` 0.1.10 or newer, the sign-in proxy
  sends the browser's connection address as `X-Forwarded-For` (browser-supplied
  forwarding headers are dropped) and the marker
  `X-AbstractFramework-App-Proxy: abstractobserver` on every gateway-bound
  request; a connection whose address is unknown is refused with HTTP 400.

### Documentation
- The FAQ and troubleshooting pages describe the packaged CLI's `/api` session
  proxy and the About dialog.

## [0.1.12] - 2026-09-23

This release consolidates the dated development entries below (2026-07-08 to
2026-07-23) into one published version.

### Added
- **Board (Mission Control) is the landing page**: kanban columns Pending /
  Working / Review / Done across every run. Cards move themselves as run state
  changes; the Review column lets you approve or deny tool requests and answer
  questions inline, including waits held by child runs. Run lists poll live
  (5 s while visible, 30 s when hidden).
- **Entities strip** on the Board: each entity's phase, age, and latest moment,
  with links into the separate entity app,
  [AbstractEntity](https://github.com/lpalbou/AbstractEntity)
  (`npx @abstractframework/entity`, default `http://127.0.0.1:3007`; override
  with `ABSTRACTOBSERVER_ENTITY_APP_URL`).
- **Runtime → Memory**: the knowledge-graph (active memory) explorer now lives
  as a Runtime mode next to Activity, Artifacts, and Logs.
- **Run workspace folder button**: when the observer runs on the same machine as
  the gateway, a run's workspace folder can be opened from the UI
  (`POST /api/local/reveal`, loopback clients only; relative paths resolve
  against `ABSTRACTOBSERVER_GATEWAY_DIR`).
- **Launch capabilities**: skills and MCP pickers and run-level skills
  attachment on the Launch page.
- `ABSTRACTOBSERVER_GATEWAY_URL` (fallback `ABSTRACTGATEWAY_URL`) sets the
  Gateway the server proxies to and pre-fills in the sign-in dialog; the
  default is `http://127.0.0.1:8080`.

### Changed
- **One sign-in dialog**: sign-in uses the shared AbstractFramework connection
  dialog (`@abstractframework/ui-kit`), the same one AbstractFlow and the
  gateway console use. It opens automatically when the browser has no Gateway
  session; Settings shows connection status and a "Manage connection…" button
  instead of raw URL/user/token fields.
- **Shared session proxy**: the CLI and the Vite dev server both mount the
  app-origin Gateway session proxy from the new runtime dependency
  `@abstractframework/app-server`. Cookie names, the CSRF header and the
  `ABSTRACTOBSERVER_*` security switches are unchanged, so existing sessions and
  deployment settings keep working.
- **Redesigned UI**: sidebar shell, a run page reduced to four tabs, one status
  vocabulary and chip style across every surface, and a refreshed visual
  system.
- Tool-approval risk labels are marked as inferred (`~` suffix with an
  explanatory tooltip) because they are derived from tool arguments rather than
  declared tool tiers.
- Steering acknowledgements render as readable text in the run view.
- Background pollers pause while the Gateway reports an authentication lockout
  (HTTP 429) instead of adding to it.

### Removed
- The Backlog, Inbox, and Processes pages moved to AbstractContinuum; the
  observer focuses on observing runs and answering waits.

### Dependencies
- New runtime dependency: `@abstractframework/app-server` (`^0.1.9`).

## Development builds, 2026-06-14 to 2026-07-23 (released in 0.1.12)

These development builds shipped together in 0.1.12; see that entry for the user-visible changes. The detailed
maintainer log of those builds is kept in `docs/reports/2026-07_development-log.md`.

## 0.1.11 (2026-06-14)

- UI: redesign runtime monitoring around explicit overview/timeline/replay/ledger/providers/graph/digest/attachments/chat surfaces, with clearer wait-state rendering and richer runtime metadata display.
- UI: add reusable runtime artifact rendering, activity, and metadata helpers so reports, HTML/Markdown/text payloads, and generated media previews render consistently from Gateway artifact descriptors.
- Gateway client: extend artifact listing/search/download support with pagination, richer filters, stats, and access modes so the observer can inspect larger artifact inventories without lossy client-side assumptions.

## 0.1.10 (2026-05-31)

- Security: hosted mode now follows the Gateway URL/session policy used by Flow so remote browser clients cannot turn the app into a user-directed Gateway proxy.
- Package hygiene: ignore and remove `.DS_Store` files from the published source tree.

## 0.1.9 (2026-05-26)

- UI: add scoped provider/model pin legend entries for text, image, and voice routes.
- UI: treat `provider_text` and `model_text` launch fields like provider/model selectors in the Gateway observer launch form.

- Docs: align npm install/run commands with the scoped package name (`@abstractframework/observer`) and refresh core docs for ecosystem context and voice endpoints.

## 0.1.7
- Package: migrate source imports to the public `@abstractframework/*` UI package names while building against the sibling AbstractUIC source checkout.
- CI/CD: add GitHub Actions CI and npm release workflow with trusted publishing/provenance support.

## 0.1.6 (2026-02-05)
- Package: publish as `@abstractframework/observer` (CLI binary remains `abstractobserver`).
- UI: Mindmap: layout toolbar (algorithm + spread + apply + force simulation play/pause), Search KG panel is inside the canvas, and blank/offscreen views auto-recover.
- UI: Chat: unify chat UX (cards + composer) across Backlog → Advisor and Observe → Chat (shared `@abstractuic/panel-chat` styling).
- UI: Voice: gateway-based TTS + push-to-talk transcription (matches AbstractCode) and available in Observe → Chat and Backlog → Advisor.

## 0.1.4 (2026-02-04)
- Docs: refresh documentation for public release (README, getting started, docs index, API contract, FAQ).
- Docs: add security policy (`SECURITY.md`), contributing guide, and acknowledgments.
- Docs: align `llms.txt` with the `llms.txt` spec and keep `llms-full.txt` in sync.
- UI: align theme with AbstractFlow (tokens, typography, inputs/buttons, scrollbars).
- UI: new header with status pills; run picker and ledger cards use clearer labels + relative time.
- UI: digest and chat timestamps use relative time (falls back to date after 3d).
- Fix: Mindmap UI: resilient render (auto-recovers blank/offscreen view), legend toggle in graph controls, minimap toggle near the preview, and timeline reaches the latest snapshot.
- Tests: `npm test`
- Build: `npm run build`

## 0.1.3 (2026-01-11)
- UI: Digest stays up to date and includes per-subflow stats (polls discovered subrun ledgers).
- UI: Digest adds a ledger-based SUMMARY section with Generate/Regenerate and an “outdated” indicator.

## 0.1.2 (2026-01-11)
- UI: run picker dropdown is wider and viewport-safe (opens up when needed; never clipped).
- UI: “Existing Runs” shows only parent runs (filters out subruns) and uses the improved run picker.

## 0.1.1 (2026-01-11)
- UI: replace bundle-info block with a single **Start Workflow** primary action (modal-based start).
- UI: simplify Run controls (run picker + refresh; pause/resume; cancel).
- UI: upgrade run picker to a badge-based, aligned list (readable + status color coding).
- UI: move Remote Tool Worker (MCP) settings into the Start Workflow modal (advanced).
- Docs: add `abstractobserver/docs/architecture.md` and link it from the framework architecture overview.

## 0.1.0
- Initial release.
