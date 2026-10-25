# Changelog

## [Unreleased]

Requires `@abstractframework/ui-kit` 0.8.8 (`triggerWords`, the connections and mailboxes client calls, the panel's `occurrenceEvents` / `workflowName` / `triggerConnections` / `mailboxes`).

### Changed

- **New automation uses the flow's own settings** (UX review 2026-10-25, defect #1). When the chosen flow publishes automation defaults (`/bundles/{id}` → `automation_defaults`), Automate preselects **Use the flow's trigger: When Release notes has a new item** (the connection's name, the mailbox's address, or the schedule's sentence from the gateway's preview in the account's zone), takes Context and its budget, the title and the inputs from the defaults (what was already typed is kept), and creates with that trigger. **Other trigger…** keeps the schedule kinds and adds **When something arrives** — your mailboxes by address and your feeds and webhooks by name (`GET /triggers/connections`, `GET /me/email/accounts`), never an id — and **By hand**. The raw **Event object {…}** input is no longer shown or sent in Automate mode: the trigger fills `event`.

## [0.8.0] - 2026-10-16

Requires AbstractGateway 0.15.0 (`GET /runs` coalesced per plane + query; `/host/runs` titles and waits) over AbstractRuntime 0.10.1 (the active-run index), and `@abstractframework/ui-kit` 0.8.7.

### Added

- **Board redesigned around the blocker, not the status word** (backlog 0003 "observe agents, not cards", wave 1). Five lanes: **Needs you** (inline Approve/Reject/Answer, and **Resume** for a paused run), **Working**, **Waiting on…**, **Scheduled**, **Done**. Every card reads title first (the automation's title, else the run's task excerpt from `GET /runs/{id}/input_data`, else the workflow id marked *untitled*), then the subject line (automation · occurrence #n · workflow, or session · workflow), then a **state sentence with its object and actor**: "needs your approval: send_email · 23m · you", "running subrun react loop · llm_call open 38m", "waiting for subrun X: asks a question", "sleeps until 02:00 UTC (in 1h 12m) · clock", "waiting for event inbox.message · external", "waiting, reason unknown (key) · inspect". A parent parked on its own running child reads **running** — the gateway's own reading of an occurrence — and inherits the child's open step and staleness; a running run always shows its last ledger touch and gets a **no progress** mark past the threshold you pick in the board header (5m / 15m / 1h, remembered per viewer). Automation controllers are the automation's own **Scheduled** card: next run, last run, number of turns, cadence and context mode. The **(i)** popover carries the full task, workflow, cadence, context mode, tools, model/provider, iterations, tool-approval policy, notify channels and workspace, **Name it** (an inline rename through `PATCH /automations/{id}` with the revision the board read) and **Open automation**. Run ids never print; ⧉ copies them.
- **Observe → Agent**, the view a board card opens on: the header (title, subject, state sentence, the one action it calls for, copy id), **Can do** (model/provider, tools, tool policy, workspace access — the automation's policy tagged as such), **Inputs → Outputs** as AbstractFlow's pins with their live values (start pins from the flow with `input_data`, end pins with the run's `output`; "not provided" and flow defaults said; a pin-less end node renders as one untyped output), **Context** (the history window replayed vs dropped, the token gauge against the run's limit, flow warnings), **Run tree** (controller → occurrence → children, each with its own sentence), **Spend** (tree-inclusive, labelled so) and **Ask**. The flow comes from `GET /bundles/{b@v}/flows/{f}`; the session's rows are re-listed when the subject moves and once a minute.
- **Agent profile** (Observe → Agent, operator 2026-10-14 11:13): "Can do" became a profile in five groups — **Who** (workflow, subject, role, model · provider, system prompt, the task), **Access** (tools it may call vs tools it did call, with counts and "called outside the declared list"; tool approval; untrusted-input tools; email recipients; workspace mode, root, allowed and ignored paths), **Does** (the state sentence, LLM/tool/subrun counts, delegated subruns, the outcome), **How long** (started, finished, duration, iterations used of max, token limit, cadence · next run · count, retry policy) and **After** (notify channels, context mode and growth, next occurrence or why none). Every row names its source — **used** (the ledger), **run** (the inputs), **flow default**, **automation** — and absent facts say why ("not on this wire", "not provided, no default").
- **No "…" anywhere on the Agent view** (operator 2026-10-14 11:11): every value — provided, flow default, output, "also sent" — renders through one value component: short scalars inline, long strings collapsed by size with **show all (N chars)** / **show less**, arrays and objects as a complete key/item list with the full JSON behind a disclosure. Every field has a **copy** button on hover or focus (the full raw value; JSON pretty-printed), as cards and messages do.
- **Flow tab** (operator 2026-10-14 11:15): a run-state banner (**ongoing** with the state sentence and "at <node>", or **finished** with the sentence and "N nodes visited in D"), AbstractFlow's run-status vocabulary on every node (running ring and pulse, waiting dashed ring, failed ring, done check; one **here** chip on the current node), a facts panel on hover or keyboard focus (visits, first/last, time in steps, the LLM line, the tools table, waits, subruns, the last result and error) with **Copy facts (JSON)**, **Copy records (JSONL)** and **Copy context** (the exact messages of the last LLM call), and a toolbar **Copy run state** that hands an AI one JSON document: where the run is and why.
- **No duplicate blockers** (operator 2026-10-15): a parent run that waits on a subrun which itself needs you is blocked by nothing else, so it no longer gets its own card in Waiting on…; the Needs-you card says **blocks <parent>** (a link) and, when the child's own name is a generated id, takes the nearest titled ancestor's title with "subrun · <workflow>" as its secondary line. Waiting on… now holds only runs blocked by something other than you.
- **Cancel all in a lane** (operator 2026-10-16): the heads of **Needs you**, **Working** and **Waiting on…** carry a cancel icon right after the title when the lane has cards and the host wired cancel; it asks in a band under the lane head (**Cancel all 53 runs in Needs you and the 36 tasks they belong to? Everything working under those tasks stops too; automation schedules are not touched. Cancel all / Keep**, never squeezed into the head's row), then cancels through the host's batch handler with a live count (**cancelling 3 / 36 · 1 refused**) and a receipt (**cancel asked for 35 tasks · 1 refused**). Scheduled (pause is its verb) and Done have none.
- **Task cards** (operator 2026-10-16 01:31: "we should be handling sessions (runs)… see their subsessions… see the parent… be able to cancel either"; design adversary GO, `untracked/redesign/TREE-CARD-adversary.md`). A board card is now one TASK — a parent-less run, an automation occurrence, or a child whose parent the listing lacks — in the lane of its deepest live blocker (an asking or stuck subrun → Needs you, a working subrun → Working, else the root's own wait). Inside: the task text as title, then the CHAIN root → leaf, one row per live run with its own words (**waits for ↓** above a live child, else its state sentence), a name that opens that run and, on every subrun row, a ✕ that stops that subrun only and says what follows (**Stop this subrun only: its parent continues and may delegate again**); then one ask block per asking subrun (**builder asks since …**, the request, Approve / Reject / Review & answer), or, when a row is stuck, the attention block: the stuck run's name (it opens that run), **stuck since <when> (<age>)**, the situation in a sentence built from the facts (**Its subrun builder was cancelled 1h 43m ago and this run was not resumed.**), then **Cancel task** and **Open the run →**; the card's status word says **stuck**. The footer's ✕ cancels the task. Children never get a card of their own, so "blocks <parent>" is gone; the Needs-you count counts tasks and its tooltip says **N tasks · M asks**; cancel-all counts tasks. Scheduled and Done cards are unchanged.
- **Readable names on the task card** (operator 2026-10-16 02:36: "multiagent-coding 0.0.13 waits for ↓ └ multiagent-coding 0.0.13 … absolutely not readable; at least use the label of the step"). A run now reads by its FLOW ("multiagent-coder", "multiagent-coding"), a generated subworkflow by the NODE it was spawned from ("builder", "scout_code"), the whole id on hover; a parked parent says which step waits (**waits at build ↓**), and a stuck run names its subrun by that step (**stuck: subrun builder was cancelled 1h 43m ago, this run was not resumed**); a lone stuck run (no chain) gets the same attention block in place of the ask actions. Hovering a card's title opens the task's full text in the elevated panel (the shared markdown renderer), never a native tooltip.
- **A Cancel cancels the task, not one run** (operator 2026-10-16 01:04, "there are still 10 items?"): the gateway runner cascades a cancel DOWN (root + every descendant at apply time) but nothing cascades UP — a child cancelled on its own hands its parent `{success: false, cancelled: true}` and the parent proceeds; a multi-agent parent delegates again and asks again (5 of the 10 cards that came back were children born within minutes of the wave, the other 5 were folded parents that resumed and asked again). Every Cancel on the board (a card's ✕, the (i) panel's, a lane's cancel-all) now sends ONE cancel per task root — the topmost parent below an automation controller — and lets the runner take the subtree down; the confirm says so: **Cancel this task? Its parents and everything working under them stop too**.
- **Board actions on one line** (operator 2026-10-15): Open in Code and Cancel are kit icon buttons on the footer row of EVERY ongoing card (Needs you, Working, Waiting on…), next to copy and (i); a Needs-you card's act zone keeps its one primary move.
- **Board polish** (operator 2026-10-14 11:33–11:41): lanes are always open (the fold chevron is gone) and their counts are readable pills; copy affordances appear only on hover or focus and are legible when they do; a Needs-you card reads **asks since Mar 29, 19:47 (198d 17h)** (or **needs approval for web_search since …**, **paused since …**) with the request quoted under it, names the person when the wire names one and nobody otherwise, and offers **Review & answer**, **Open in Code** (deep link `#session=…&run=…` into the AbstractCode web app when the gateway's app registry says it is installed and running; greyed out with an install hint otherwise) and **Cancel** with an inline two-step confirm; plain-run cards no longer print "session"; automation cards carry a trigger chip (**every 24h** / **on email** / **manual**) instead of "clock"; the (i) panel is a sectioned grid (Run · Spend · Where, or Automation · Schedule · Policy · After · Where) with ids in monospace, sources as tags, long text collapsed by size, copy on every row and the actions at the bottom; Done cards show the outcome glimpse and **24m · 99,921 tk · 11 tools · 3 artifacts** (answer and artifact count fetched once per terminal run).
- **Titles come back**: the cached brief of a run (its title and excerpt) is keyed anew, so a title that was once cached empty is fetched again instead of reading **untitled** for good.
- `src/ui/state_line.ts`: one vocabulary for what a run is doing (sentence, lane, subject, title order, pill word, automation brief and pulse folds), shared by the board and the Agent view and tested per wait kind × lane.

### Changed

- Board: hovering (or clicking) a card's answer or request glimpse opens the FULL text beside the card in an elevated panel — a header (Answer / Request, whose card, words · chars, copy, close), a reading-measure body rendered with the shared markdown renderer (panel-chat `Markdown`: headings, lists, quotes, code, tables at the board's type scale), and an "Open the run" footer — never a native tooltip of raw markdown (operator 2026-10-15 21:44, 23:54). The glimpse itself is unchanged: three clamped lines. The (i) brief shares the same elevated shell (depth, hairline highlight, backdrop blur, a 140 ms entrance that respects reduced motion). The "data Ns old · Refresh" line is gone (21:48); the board polls by itself, and only a one-sentence notice shows when the gateway is unreachable or before the first poll.
- **Board layout rework** (operator 2026-10-15 20:41): the stats strip is gone (its counts live on the lanes); data age and Refresh sit on one slim line above the lanes and the "no progress after" select in the Working lane's head; every card is one vertical flow whose footer — the always-visible kit icon buttons (automation: open · run now · pause/resume · info; run: open in Code · cancel · info) — is the last child inside the card, so the (i) can no longer fall outside it; only the copy icon appears on hover; a Scheduled card's lines wrap instead of clipping; Done cards carry the outcome glimpse with their metrics on the footer. Cards are memoized: an unchanged poll re-renders 0 cards (was 114 for 57 cards), commit time ~2 ms (was ~8.5 ms).
- **Loading feedback everywhere** (operator 2026-10-15): one `LoadingState` (spinner + "Loading <what>…", `role=status`, still under reduced motion) shows wherever a page has asked the gateway and has nothing yet — the Automations list and detail, the Observe run navigator, the System Artifacts, Logs and Activity panes — instead of an empty list, a "0" or a "nothing here" that is not yet true.
- Automations page: a card's controls (Active, Run now, Edit, Discuss, Archive) sit on ONE line; the page frame's dark margins shrink (10 × 12 px instead of 16 × 18 twice) to give the panels the space back.

- **Launch is a modal, not a page** (operator 2026-10-14): **+ New automation** on the Automations page opens it in Automate mode, the header's **Launch** button in Run once mode, and `#launch` / `#launch/automate` deep links open it over whatever page is showing. The Launch entry leaves the sidebar; the form, its modes and its fields are unchanged and scroll inside the modal. Creating an automation closes the modal on the Automations page; starting a run lands on the run.
- The board's poll carries no metrics and no ledger folds: `status=running` + `status=waiting` every 5 s; terminal rows (with metrics) come from a 60 s **background** sweep that never delays the tick. Automation records, task excerpts, last-record pulses (only for runs older than a minute) and wait details are fetched lazily through one pool (3 in flight) and cached for the session across page switches. The Done lane says "loading…" until the first sweep lands.
- The wait modal no longer covers the Agent view when a waiting run opens from the board; the header's **Answer** leads to the Ledger view's controls.
- Listing rows keep `is_draft` and `pause_reason`.

### Fixed

- **"Fetch is aborted" banners inside a run** (operator 2026-10-16 01:59: "apparently there are some errors and I have no easy way to check it"; adversary `untracked/redesign/ABORT-AND-SPEED-adversary.md`). Those three banners were the app's own 30 s listing deadlines, worded by WebKit exactly like our own aborts and rendered among the run's steps. Every gateway request now goes through one helper that tells the two apart: a deadline is a **GatewayTimeout** ("GET /api/gateway/runs?status=running: no answer within 30 s — the gateway is busy"), our own abort (a newer request replaced this one, the view went away) is **Superseded** and is never reported. Real failures are coalesced into ONE connection notice ("Refresh runs failed: … · 02:01 ×2") beside the connection label and on the board's status line, cleared by the next success; the run's Ledger shows the run's steps only.
- **Run header counts failed steps** of every kind ("6 LLM calls · 199,088 tokens · 19 tool calls · 2 failed steps"); before, only tool failures were summed, so a failed LLM or subworkflow step was invisible there.
- **The board paints the last known rows at once** (operator 2026-10-16 02:01: "the observer is extremely slow to load"; measured: the two active listings cost 4–5 s with one run and an idle GPU, minutes under load, and a reload started from nothing). The runs poll keeps a persisted snapshot per gateway and account; a reload paints it immediately as **board as of 02:00:41 — refreshing…** and the first real poll replaces it. One listing that lands is applied even when the other fails (a notice, not a blank board), and the archived-roots scan is skipped when the gateway says there are no archived conversations.
- Board: a parent parked on a subrun that the listing no longer has read **waiting for a subrun to finish** and nothing more (operator 2026-10-16 01:31: "waiting on what? from what?"). The board now reads the wait detail of every such parent (it names the subrun) and looks the subrun up once: **waiting for subrun coding-agent 0.2.4 to finish** while it lives beyond the listing's cap, **subrun coding-agent 0.2.4 completed 12s ago · resuming** (Working) within the minute the runner's repair pass gets, and **stuck: subrun coding-agent 0.2.4 ended cancelled 3h ago and the gateway could not resume this run · 77d 17h** past it (or **stuck: subrun 028f89e5 no longer exists…** when the gateway answers 404) — a stuck run is a **Needs you** card with a **stuck** pill, sorted after today's asks, its parents folded in as "blocks", and Cancel task as its one move. The ✕ on every card now says what it reaches: **Cancel this task: this run, its parents below the automation, and everything working under them**.
- Board: a run whose flow the gateway can no longer name (`pin_ids: []`, the bundle version is gone) showed **untitled** with its prompt sitting in the response; the prompt titles the card again.
- Board: cancelling many runs was extremely slow (operator 2026-10-16 01:04: 53 cancels took 6 minutes while the gateway accepted each command in 41 ms) — every cancel fired three forced listing refreshes (each listing stats ~10,000 run files in the runner's own process), the commands queued behind ~160 listings, and the runner's apply latency rose from 0.03 s to 10 s. A batch cancel path (`on_cancel_runs`) now sends one command per task root, four at a time, with ONE refresh for the batch and one more 2.4 s later.
- Run view: an LLM call made on the runtime's defaults showed no provider or model on its card — they are named only in the request as sent (`result.metadata._provider_request`); `llm_detail` now reads them there.
- Run view: a long outcome expanded with **More** grew past the viewport with no way to scroll back to **Less** — the run panel clips and its Ledger page was not a scrolling child. The Ledger page (and the new Agent view) now scroll inside the run panel; the toolbar and tabs stay put.
- Board: the **Entities** strip landed after the lanes had painted and pushed them down (operator 2026-10-15). It is now in the page at first paint, one reserved height in every state (`.mc_entities_reserved`, `flex: none` so the column flex never squeezes it): shimmering tile placeholders under its head until the roster and cards land (as many as the roster says, once known), the tiles after, and a one-line **Entities — no entities** head when the gateway has none. Measured in Chromium: the strip's height and the lanes' top are the same before and after the data.
- Run view: a tool call that needed approval showed as **waiting**, forever, beside a second, completed copy of the same call. The runtime records an approved call's execution under a new step with the same idempotency key; the steps are now merged, so each call is one step with its real status (root backlog 1016 tracks reading step state from the runtime instead).

## [0.7.1] - 2026-10-15

Requires AbstractGateway with `schedule@2`, the served schedule fields and `POST /api/gateway/automations/schedule-preview` (round 16) and `@abstractframework/ui-kit` 0.8.7.

### Added

- Launch → Automate: calendar schedules. **When** offers **Repeat** (fixed UTC interval, as before), **Daily**, **Weekly** (day chips that show their state), **Monthly** (day 1–31 or the last day) at a time of day, and **Once at**; every schedule is written as `schedule@2`. For every schedule (Repeat with its bounds too) the line under **When** is the gateway's own sentence; for Daily, Weekly, Monthly and Once the time zone reads "in Europe/Paris (your account's time zone)" with **Change in preferences** (the console's Accounts). Switching kinds keeps the picked days. The Edit form edits a calendar rule, keeping its time zone and limits.

### Changed

- The Automations page shows the gateway's served next run (`next_run_local`, cut to "2026-10-09 08:00 Europe/Paris", plus the relative time to `next_run_at`) and every schedule's `schedule_rule_text`; the Observer no longer reads `next_fire_at` or computes a next run. The stub gateway (`scripts/automations_stub_server.mjs`) accepts `schedule@2`, serves the schedule fields and `schedule-preview`.

- CI: `npm run check:lock` (also a CI step, before `npm ci`) fails when `package-lock.json` lags `package.json` or resolves an `@abstractframework/*` dependency below its floor, in another major.minor or from a local tarball; `--latest` also catches a published patch the lock has not taken. The lock now resolves `@abstractframework/app-server` 0.1.12 (floor `^0.1.12`). See [CONTRIBUTING](CONTRIBUTING.md#lockfile-check).

### Fixed

- The Automations page works with a gateway that does not serve the round-16 schedule fields (AbstractGateway 0.13.x serves only `next_fire_at`): `next_run_at`, `next_run_local`, `time_zone`, `schedule_text` and `schedule_rule_text` are optional on read (`src/ui/served_summary.ts`, applied to every summary the controller reads) — the schedule reads "—" and the next run is the gateway's `next_fire_at`, shown in UTC. A served value is always shown as served.

## [0.7.0] - 2026-10-05

### Added

- Run view: each command call's result shows the sandbox it ran under, from the ledger's `output.sandbox` (AbstractGateway round 12): one line `Sandbox: macOS sandbox-exec · 4 workspaces enforced` (the recorded label and the number of workspaces enforced) with the enforced paths and their mode, or `Sandbox: none — refused`. Uses panel-chat 0.4.1's `ToolSandboxLine` (the same line as AbstractCode); needs `@abstractframework/panel-chat` 0.4.1 and ui-kit 0.8.5.
- **Voice through the gateway's voice routes**, with the kit's shared voice stack:
  - **Read aloud**: a run's outcome has **Read aloud** / **Stop**; every reply in Observe → Ask and in Automations → Discuss has a speaker. Speech streams sentence by sentence from `POST /runs/{id}/voice/tts/stream` (the kit's `useGatewayVoice` + `streamTtsJsonl`), so a long answer starts speaking on its first sentence. Requests ride the session's media run, never the run being watched.
  - **Dictation** in Ask and in **Discuss** (also before the discussion's first message): hold the microphone, or tap to start and tap again to stop; the status line reads `Recording… 3 s`, then `Transcribing… 4 s · faster-whisper / large-v3` (your override, else the gateway default `input.voice` route). A transcription that has not answered after 180 s fails as a sentence.
  - **Settings → Voice** is the kit's `AfVoiceSection`: "Gateway default · supertonic / supertonic-3" from `GET /voice/defaults`, output device + Test + reply volume, microphone + level meter + Test + input level, spoken language, and **Read aloud** (speak each new reply). Preferences stay in this browser.
- **Archived conversations stay on the Board.** A conversation archived in AbstractCode leaves the gateway's `root_only` runs listing; Observer also asks for `archived_only=true` and appends those runs, each tagged **Archived**. Observer lists runs, not sessions, so it has no Archive button.

### Changed

- Launch → **Automate**: **Workspaces** is a visible section after Tools (no disclosure). It holds the run-level `WorkspaceChooser` (ui-kit 0.8.5), and its value is stored on the definition as `target.input_data.workspace`. The **Advanced** disclosure is gone: **Title and limits** (title, first run, stop after N runs, stop at) is a visible section with the kit dialog's words, and the skills picker and bundle tools follow as in Run once. **Run workspace** is a Run once field and never rides an automation (an automation always works in its own private workspace). In Run once mode, Workspaces is a visible section too.
- Automations page: each row shows **Workspaces: <summary>**, the gateway's dry-run summary for the stored choice (or for your default). While an automation's Edit form is open, its **Workspaces** chooser shows above the panel. Each change is checked by the gateway, then saved as one revision (`PATCH` with `expected_revision`), and **Use my default** removes the stored choice. The kit Edit form still saves after it: it moves past this page's own revisions, never past another client's. With the form closed, the detail shows the one line.
- Launch → **Workspace** is the kit `WorkspaceChooser` (ui-kit 0.8.3) at the run level: "Gateway: <the admin's eligible workspaces>" on top, **Use my default** (on by default), the posture, each workspace with Read-only / Read & write / Refused (a mode above the gateway's cap disabled), **Add a workspace path** and the effective line — the same words as the gateway console, AbstractCode, Flow and the AbstractAssistant. Each change is checked by the gateway (`POST /api/gateway/workspace/effective/me`, nothing stored); a refusal shows its sentence with "Not saved.". The choice is kept as `input_data.workspace` in the form: **Run once** sends it as the run-start body's `workspace`, **Create automation** stores it in the definition (`target.input_data.workspace`). Requires the AbstractGateway round-11 workspace model.
- A refused run start shows the gateway's sentence verbatim (was "start_run failed: 400").
- **About is the shared compact card** (ui-kit `AfAboutDialog`): the app name and version, the AbstractFramework and AbstractGateway versions, links to the website, source, docs, issues, feedback and contact, and one author/licence line. The gateway's package list is no longer shown.
- **Audio artifacts play in the kit's waveform player** (`AfAudioPlayer`) in the Artifact Explorer inline preview and the preview dialog.
- **Docs assistant is the kit's shared `DocsAssistantDrawer`** (panel-chat 0.4.0; the book icon in the top bar, the same drawer as the console and the other apps): your question on the right, the answer on the left with markdown, code, JSON and links rendered, streaming, copy, attachments, an icon-only New conversation and a one-line grounding footer. It answers from this app's `llms.txt` through the gateway's docs-qa workflow (`GET /docs/corpus?app=observer`), one gateway session per conversation. The build ships `llms.txt` in `dist/` and the app server serves it as `text/plain`. The basic-agent transport and its inlined docs index are gone.
- Dependencies: `@abstractframework/ui-kit` ^0.8.0 and `@abstractframework/panel-chat` ^0.4.0. Voice and archived runs need AbstractGateway 0.13.0 or later; with an older gateway the Board shows only active runs.

### Removed

- The launch form's **Access Mode**, **Allowed Paths** and **Ignored Paths** fields (the gateway no longer has access modes; refused workspaces are set by the gateway).

## [0.6.2] - 2026-10-03

- Change the workflow of an existing automation in Edit, alongside its tool selection and result-email recipients. Automation headers identify the selected workflow.

- Select automation tools at creation and editing with the shared searchable dropdown, including All/Clear controls and workflow defaults. Saved tool restrictions remain respected.

## [0.6.1] - 2026-10-02

- Configure the growing-context token budget at automation creation and editing (default 50,000); the field is shown only for Growing context.
- Email result delivers every completed result to the selected Recipients without changing email-tool permissions.

## [0.6.0] - 2026-10-01


### Changed

- **Launch / Automate: the workflow picker lists only what you can run.** It is the kit's `WorkflowPicker`
  (ui-kit, unreleased) in its any-interface mode over `GET /api/gateway/bundles`: "Gateway default" (the coding
  agent's), then **Shared** (made available by your admin) and **Mine** (your own), each with its interface and
  version. Bundles your admin made unavailable are no longer offered; runs of them still show by name.
- **Release:** a `v*` tag now also gets a GitHub release page carrying its CHANGELOG section (job
  `github-release`), like the framework's other packages. The page for `v0.5.0` was created by hand.
- **Observe: the run opens on the run view** (the Ledger tab), grouped by agent cycle. The **Story** tab is
  removed; what only it showed stays above the steps as one summary: status, duration, LLM calls, tokens, tool
  calls (and how many failed), the outcome in one paragraph (the error, or the final answer, or the saved
  summary), and **Artifacts**, **Folder** and **Answer** (when the run waits for you). Session files, the metric
  tiles, the chronology and the Summarize button are gone (artifacts stay reachable from System).
- **Steps are collapsed cards**: kind, node, status, duration, the model of an LLM call, and one line (tokens
  in · out, the tool and its arguments, the event name, the child run). Expanded, an LLM call shows System, Messages (as sent),
  Tools offered, Response, Reasoning and Raw JSON, each foldable (▸/▾) with Copy; a tool step shows its calls and
  results. Replaces the old ledger cards and the cycles panel.
- **Prompts stored once are shown in full**: a `$slim` placeholder in a finished step is rebuilt from the step's
  start record in the same ledger and checked against its sha256. When the start record is not loaded the step
  says "Prompt body not kept: <reason>"; when the checksum differs it says so.
- **Housekeeping hidden by default**: status/progress events, waits, subworkflow resumes, memory bookkeeping,
  model loads and effect-less steps appear only with the **All steps** switch (one table,
  `src/ui/run_step_kinds.ts`). A failed step is always shown; a tool step with a failed result counts as failed.
- **Filters and search**, in one toolbar row under the step count (wraps on phones): Cycles / Steps,
  All / LLM calls / Tools / Failed, a search over card text and expanded content
  (plain text, any case). The view, filter, All steps and search are kept in the address
  (`#run/<run_id>?only=llm&all=1&q=…`); `#run/<run_id>` links keep working.
- The run picker counts one LLM call per call (its start and end records were counted twice).

## [0.5.0] - 2026-10-01

On/off settings are switches. Every setting that is either on or off shows as one switch labelled by the
feature, highlighted when on, in place of a Pause/Resume button pair, an On/Off select or a checkbox. Requires
AbstractUIC ui-kit 0.4.0 (`AfSwitch`, `randomId()`, `insecureContextReason()`).

Screens that show a list next to a detail use the space they have on phones and tablets. Everyone who opens
Automations, Observe, the Board or System on a phone or a tablet is affected; desktop windows keep their layout,
except that each list can be collapsed and the Automations detail reads at 14 px.

### Added
- **Run deep link `#run/<run_id>`**: opens that run in Observe, in a new tab or while the Observer is open
  (hashchange), wherever it is mounted; under the gateway the address is `/apps/observer/#run/<run_id>` (the gateway
  console's account Logs links "Run started" events there). Run ids that are not uuids work. When the gateway answers
  404 or 403 (no such run, or another user's run) Observe says "Run <run_id> cannot be opened: it does not exist on
  this gateway, or your account cannot see it." in place of "No run selected", instead of an empty run view. On
  phones the link lands on the run view.

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
- **Launch → Automate, Email:** "Email me the result" is a switch (from the kit); while email is not set up it is
  unavailable, with the reason.
- The ledger's view toggle is always labelled "Condensed" (highlighted when on) instead of swapping to "All"; it and
  the Flow graph's Subflows / Path toggles announce their state (`aria-pressed`); artifact type filter chips name the filter rather than an Add / Remove verb.
- **Type scale:** settings row titles and skill names are no heavier than weight 600; a skill name is regular when its
  switch is off and bold when on.
- For contributors: `src/ui/state_toggles.test.tsx` runs the kit's `findVerbToggleLabels` over `src/`, checks every
  switch in both states and caps the settings label weights; `scripts/state_toggles.shots.mjs` captures the switch
  surfaces at 1440 / 834 / 390 px in light and dark and measures every label's size and weight.
- **Collapsible lists.** The Automations list, Observe's run list, System → Activity's Queues and Runs, and each
  Board column have a header button with a chevron that hides or shows the list. Lists are open by default, and the
  Observer remembers your choice in this browser. A hidden list leaves its header in place and gives the detail the
  whole width (on a phone, the whole screen).
- **Full width on phones and single-column tablets.** Below 1024 px (Automations, System) and below 768 px (Observe,
  Board), panes and list items are flat sections separated by thin lines instead of cards inside cards, and the page
  is the only thing that scrolls (lists, the automation detail, the Observe run list and ledger, and the Board columns
  do not scroll inside it). Text starts 12-16 px from the screen edge, and the automation transcript uses the full
  width.
- **Observe on phones** shows the run list above the selected run instead of one or the other; picking a run scrolls
  to it. The **Runs** back button is gone: collapse the list to read the run alone.
- **Automation details:** labels and values share a line ("When  every 24 hours (UTC)"); the workspace path, the
  trigger and the task take the full width; paths and JSON are plain monospace text without a box on phones; the
  control buttons fill the row.
- **Text size:** the automation panel and its transcripts use 14 px at every width. On phones and touch tablets, list
  titles, queue names, hints, ledger buttons and the wait details also use 14 px (chips, ids and times stay smaller).
- **Tablets:** Observe keeps the run list beside the run only when both get about 360 px or more.
- **Launch (Run once and Automate) on phones:** the form card and the "When" sections are flat, labels, help and
  skill descriptions are 14 px, and the page scrolls once (the document never scrolls under it). Help text is at least 13 px on desktops.
- **Desktop text floor:** dense text (run meta, ledger chips, board cards, System rows) is 12 px instead of 11 px, and
  secondary text 13 px instead of 12 px. On touch tablets the System → Memory explorer's help text is 14 px.
- For contributors: `src/ui/space.css` (loaded after `responsive.css`) and `src/ui/list_disclosure.tsx`, guarded by
  `src/ui/list_disclosure.test.tsx`; `scripts/space.screens.mjs` drives the list + detail screens through the shared
  capture harness (space metrics: text column, scroll containers, padding stack).
- For contributors: `src/ui/space_dom.test.tsx` lays Automations, Observe, System → Activity, the Board and a
  Launch-shaped form out in Chromium at 390 px with the CSS a fresh build ships, and fails on any element that scrolls
  inside the page or a document that scrolls under it; CI and the release workflow install the Playwright Chromium
  before the tests.
- An unavailable switch always says why: the automation row's and the Observe toolbar's "Active" switches show
  their reason ("The automation has ended.", "Archived: history is kept, nothing runs.") as text next to the
  switch on touch screens; with a mouse it is the tooltip. docs/automations.md describes the Active switch.
- Launch → Automate and the Edit form say "Connect a mailbox first — open My email" when no mailbox is usable,
  and the email section is titled "Mailbox" (ui-kit 0.4.0 wording).

### Fixed
- **Plain http from another machine** (LAN, Tailscale). Browsers withhold
  `crypto.randomUUID`, `crypto.subtle`, the clipboard API and the microphone
  outside https and localhost. Ids come from the kit's `randomId()`, the
  session memory run id falls back to a plain SHA-256 (same id), **Copy**
  says "Copied to clipboard" only when the copy worked (else "Copy failed —
  select and copy"), and over plain http the chat's voice control says "This
  page is loaded over http, so voice and camera is unavailable — open it over
  https (for example through tailscale serve; the gateway console's Network
  page explains how) or on the gateway's own computer." On https or
  localhost in a browser without the microphone API it says "Voice and camera
  are not supported in this browser (getUserMedia unavailable)." The manifest link
  sends the app's session cookie (`crossorigin="use-credentials"`), so the
  gateway answers it instead of returning 401.

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
