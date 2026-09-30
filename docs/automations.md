# Automations

An **automation** runs a workflow for you on a schedule: "search the AI news
every 8 hours", "triage my inbox every 30 minutes", "check the machine every
7 days". The gateway runs it and keeps every run. In the Observer you create
it (**Launch → Automate**), watch and change it (**Automations**), answer the
runs that wait for you, and discuss a result in a separate session. The
Observer executes nothing itself: every action is a gateway request.

This page is the user guide. The endpoints are listed in [api.md](api.md),
the component view is in [architecture.md](architecture.md), and common
problems are in [troubleshooting.md](troubleshooting.md#automations).

## Before you start

Automations need a gateway that advertises the Automations API:
`GET /api/gateway/discovery/capabilities` returns
`capabilities.contracts.common.automations.available: true`. When it does not,
**Launch → Automate** and the **Automations** page show why and stay disabled:

- "This gateway does not advertise the Automations API
  (capabilities.contracts.common.automations). Update AbstractGateway to use
  automations; legacy schedules stay manageable from their run view."
- "This gateway has the Automations API turned off." (the gateway reports
  `available: false`)

Schedules created with an older gateway keep working either way (see
[Legacy schedules](#legacy-schedules)).

## Create an automation: Launch → Automate

**Launch** has two modes, and the sentence under the switch says which one
is selected:

- **Run once**: start this workflow now, a single run you can watch in Observe.
- **Automate**: create an automation that runs this workflow on a schedule
  (every N minutes, hours or days) or when you ask; manage it on the
  Automations page.

Switch to **Automate**, or use **+ New automation** on the Automations page,
which opens Launch in Automate mode. The address `#launch/automate` opens it
directly (bookmarkable; `#launch` opens Run once, `#automations` the
Automations page).

### What

The workflow and its inputs, usually the prompt. The picker lists the
gateway's published workflows and, for each agent interface, **Gateway
default agent** (for example `Gateway default agent · abstractcode.agent.v1`,
followed by the workflow that is currently the default when the gateway
reports it). A default-agent automation is sent as `flow_id: "@default"` plus
the interface; the gateway resolves it when the automation is created.

The prompt becomes the automation's instruction; the other inputs are passed
to every run unchanged. Leading and trailing spaces are trimmed and empty
text inputs are left out, as in **Run once**.

### When (UTC)

- **Repeat** every N minutes, hours or days. Presets: every 5 minutes,
  every 30 minutes, every hour, every 8 hours, every 24 hours, every 7 days.
- **Once at…** a date and time.
- **When an email arrives** — see [Email](#email) (offered only when your
  gateway account has a working mailbox).

All times are UTC. Intervals are fixed: "every 24 hours" means 24 hours after
the previous tick, whatever your time zone or daylight saving time. The line
under the field states the result, for example "Runs every 24 hours (UTC),
first run now." or "Runs every minute (UTC), first run now."; it reads
"Incomplete schedule." until the fields are valid.

### Context

- **Independent** (default): each run starts fresh in its own session. Runs
  never see each other.
- **Growing**: each run is a new turn of one conversation and sees the
  previous runs. The history is bounded: the most recent 50,000 tokens of
  whole turns are replayed; older runs drop out.

The Context choice is the one history control of an automation. The gateway
sets the workflow's `use_context` input from it, so Automate mode does not
show the workflow's **Use Context** input (Run once still does).

### Tools

- **Tools run without asking (you approve them now by creating this
  automation)** (default). An unattended run cannot stop to ask you at every
  tick, so creating the automation is the approval. When the inputs name the
  workflow's tools (`tools`), they are listed next to this line.
- **Ask each time**: every tool call waits for your approval on the
  Automations page.

Questions a workflow asks you (`ask_user`) always wait for you, whichever
option you choose.

### Email

These options need a mailbox connected to your gateway account (the gateway
console's **My email**, in its Users tab). The Observer reads
`GET /api/gateway/me/email` with every Automations refresh and whenever Launch →
Automate opens. Without a usable account the options are off and the form says
**"Email isn't set up — open My email"**; the link opens the gateway console in
a new tab. Nothing email-related is sent without a usable account.

- **When an email arrives** (a When choice): the automation runs on new mail
  in your inbox (the runtime trigger `email.received@1`). Optional filters, all
  exact values, no patterns: **From these addresses**, **From these domains**,
  **Sent to these addresses**, **Subject contains** (one line) and
  **Attachments** (any / only with / only without). **Check for new mail every**
  defaults to 1 hour (an automation that runs a model) and is never under 60
  seconds; the form states that rule. **At most this many emails per run**
  (default 100, up to 1000): the rest wait for the next run. Each email is read
  once; mail that arrived before the automation existed, or while it was
  paused, is skipped. The Tools section adds that incoming mail is data, never
  instructions, and that link-opening tools always ask.
- **Email me the result**: a run that notifies you, or fails for good, is also
  emailed to you (`notify.channels: ["console", "email"]`).
- **May send email without asking to**: **Only me** (default) or **Me and
  these addresses** (`policy.email_allowed_recipients`). Mail to anyone else
  waits for your approval; your recipient policy in My email still applies.

The fields and their words are the kit's (`AfEmailTriggerFields`,
`AfEmailOptionsFields`, `AfEmailSetupNotice`), the same as in AbstractCode's
dialog.

### Advanced

- **Title** (at most 120 characters; defaults to the prompt's first line);
- for a repeating automation: **First run at (UTC; empty = now)**, **Stop
  after this many runs**, **Stop at (UTC)**;
- the skills picker (the gateway resolves the selected skills through its
  trust gate), the workspace, and bundle upload / reload.

Leave **Workspace Root** empty: the gateway then creates a folder of its own
for the automation. A folder the gateway made for another conversation, run or
automation is refused, and the Observer never copies one into a new form.

### Create

**Create automation** sends `POST /api/gateway/automations`, then opens the
new automation on the Automations page and resets the form. If the gateway
refuses the request, its reason is shown with the gateway's message, for
example "every must match ^[1-9][0-9]*[smhd]$". Pressing the button again
with the same fields is a safe retry: the same request id is reused, so the
gateway does not create a second automation. Changing any field makes a new
request.

## The Automations page

**Automations** (left navigation) lists every automation of the signed-in
gateway user. The list is read in full and refreshed every 30 seconds while
the page is visible; **Refresh** reads it at once. Filter by status: All,
Active, Paused, Completed, Failed, Archived. **+ New automation** opens Launch
in Automate mode.

Archived automations are hidden by default; the **Archived (N)** switch lists them
again, and the Archived filter shows only them. Their history stays
readable.

### Rows

Each row shows:

- the title, the state as a word followed by its icon ("Active ▶",
  "Paused ⏸", "Completed", "Failed", "Archived") and, when something needs
  you, a badge such as "2 unseen · 1 waiting for you";
- the run in progress, when there is one ("Run #7 running", "Run #7
  starting", "Run #7 waiting to retry (attempt 2)"), from the gateway's
  current occurrence;
- the cadence ("every 8 hours (UTC)", or "manual runs only"), the next run
  with how far away it is ("2026-09-27 08:00 UTC (in 25 min)"; shown also
  while a run is in progress; "none while paused" when paused), and the last
  finished run's number and status ("#3 completed", "#2 failed after 3
  attempts", or "no runs yet");
- an excerpt of the last answer.

Row controls, each an icon then its name. Hovering a control shows what it
does (the shared AbstractUIC hint, the same text in every AbstractFramework
client); a disabled control first says why. **Refresh** (↻) and **New automation** (+) sit in the
list's header; the result of a row action shows at the top of the list for a
few seconds, with a dismiss button:

| Control | What it does |
| --- | --- |
| **Active** switch | On: the automation runs on its schedule. Off: paused, scheduled runs are skipped; switching it on again re-arms the schedule, and the ticks that passed while paused are not run. Once the automation ended or is archived, the switch is unavailable and shows why (next to it on touch screens, in its tooltip with a mouse). |
| **Run now** (the play-in-a-circle icon) | Runs one occurrence immediately instead of waiting for the schedule. The schedule does not move: the next scheduled run keeps its time, and if that time comes while this run is still going, the scheduled run starts right after it. A manual run does not count toward a run limit. It also works while paused, and the automation stays paused ("Run now sent to “…”; it stays paused."). In a Growing automation, later runs see it in their history. It is disabled while a run is in progress (the gateway's current occurrence; the last run's status is never used for this). Its tooltip says all this, with the next scheduled time. |
| **Edit** | Opens the automation with its Edit form already open, prefilled and focused (see [Edit](#edit)). |
| **Discuss** | Opens a chat with a fork of the automation at its latest finished run, on this page (see [Discuss a result](#discuss-a-result)). |
| **Archive…** (the icon at the end of the row) | Asks first ("Its history stays readable; it will not run again."), then stops the automation for good. |

Commands are accepted by the gateway and applied moments later. The page
reads the list again right away and twice more over the next few seconds, so
a new state appears without a manual refresh.

### When the gateway refuses a command

Errors are shown as one sentence plus the gateway's own message. The ones you
are most likely to meet are conflicts (HTTP 409):

| Code | What the Observer says | What to do |
| --- | --- | --- |
| `automation_busy` | "An occurrence is already running or queued. Wait for it to finish." | Wait, or use **Stop current** in the panel. |
| `revision_conflict` | "The automation changed since this view loaded. Reload it, then try again." | Reopen the automation and edit it again. |
| `invalid_state` | "The automation's current state does not allow this." | For example resuming an archived automation. |
| `identity_conflict` | "This request id was already used for a different request." | Submit again; the form mints a new id for changed fields. |

Other codes: `unauthorized` ("Sign in to the gateway to manage
automations."), `forbidden`, `automation_not_found` ("This automation does
not exist (or is not yours)."), `occurrence_not_found`, `invalid_request`,
`invalid_definition`, `unsupported_feature`, `unknown_trigger_source`.

## The automation panel

Select a row to open its panel (the panel area reads "Loading…" until the
selected automation arrives).

### The automation's files

**Workspace** in the panel shows the folder's whole path (it wraps at its
`/` and `-`); clicking it browses the automation's folder on the gateway host, from any browser, above the panel: open a
sub-folder, **Open** a file in a new tab, or download it. **Workspace** in a
run's details does the same for that run's folder. HTML, SVG and other text
files open as plain text (their source), never as a page. The folder is read through the gateway
(`GET /api/gateway/runs/{automation_id}/workspace`, `/workspace/files`,
`/workspace/content`), with your gateway credentials and the gateway's
workspace policy: entries its deny rules keep out are counted under the list,
never shown.

### Definition and controls

The top of the panel shows **When**, **Context**, **Next run**, **Runs**,
**Workspace**, **Attention** and **Revision**, then the **Active** switch and the controls **Run now**, **Stop current**, **Edit** and **Archive…** (each an
icon then its name; the tooltip says what it does, and a disabled one first says why), then the
**Definition** card (one click opens it: workflow, task, trigger, context,
tools, retries). While paused, the panel reminds you: "Paused: scheduled runs
are skipped. Run now works and keeps it paused." What a control did ("Automation
paused.", "Run requested.") shows next to the controls for a few seconds, with
a dismiss button.

- **Stop current** cancels the occurrence in progress (or its pending
  retry); it ends as `cancelled`, quietly, and the schedule continues.

### Edit

**Edit** — on the row or in the panel — opens the Edit form in place of the
Definition card, prefilled with the automation as it is now and with the
title field focused:

| Field | What it changes |
| --- | --- |
| **Title** | The automation's name. |
| **Task** | The instruction every run receives (the workflow's `prompt` input). |
| **Repeat every (UTC)** | The interval, in minutes, hours or days (interval schedules only). For an email trigger: **Check for new mail every** (never under 60 seconds). |
| **Context** | Independent (each run starts fresh) or growing (each run sees the previous runs). |
| **Tools** | Run without asking, or ask before each tool call. |
| **Email** | **Email me the result** and **May send email without asking to** (with a usable account; an option already on can always be turned off). |

**Save changes** sends only what changed, once (`PATCH
/api/gateway/automations/{id}` with `expected_revision`), closes the form and
says "Saved; applies from the next run."; a new interval never fires ticks
that already passed. **Cancel** or Escape closes the form. A concurrent change
is refused with `revision_conflict` instead of being overwritten. The
automation's folder is the gateway's and is not editable.

### Runs as a conversation

Every run of the automation is an **occurrence**, shown as a chat pair, oldest
first:

- the **trigger turn**: `#N`, what fired it (for example
  "schedule: every 8 hours (UTC), tick 0"), when it fired, and the
  instruction the run received;
- the **answer turn**: the status and finish time, then the answer, any
  notification, the failure and any artifacts the run produced.

Occurrences are quiet unless they need you:

| State | Shown as |
| --- | --- |
| Quiet (completed normally) | plain answer; "completed after N attempts" when it was retried |
| Notified | a **Notified** badge and the notification's title and text |
| Failed | **Failed after N attempts**, with the reason code and message |
| Waiting | **Waiting for you**, with the wait in place (see below) |
| Running | **Running**, "Running…" instead of an answer |

A **Needs attention** section above the timeline lists the notifications,
failures and waits you have not seen yet. Opening an automation marks the
items it displays as seen (`POST /api/gateway/automations/{id}/seen` with the
last displayed item); anything beyond the displayed items stays unseen.
**Load earlier occurrences (N more)** pages back in time.

### Answering a run that waits for you

A waiting occurrence shows what it waits for, and the answer is sent in the
form its kind requires:

| Wait kind | Shown as | You answer with | Sent as |
| --- | --- | --- | --- |
| `ask_user` (**Question for you**) | the question and its choices | a choice or free text | `{response}` |
| `tool_approval` | the tool calls to approve, each with its name and JSON arguments | **Approve** or **Deny** | `{approved: true \| false}` |
| `event` | "The run waits for an event." | a JSON payload, **Send event** | `{payload}` |

When a tool approval does not list its tool calls, the panel says so and asks
you to open the run before approving. An event payload that is not valid JSON
is refused before anything is sent. A wait of any other kind is shown with "This kind of wait (…) cannot
be answered here; open the run."

The answer uses the same `resume` command
(`POST /api/gateway/commands`, `{wait_key, payload}`) that the Board and the
run view send. After "Answer sent.", the occurrence continues and the panel
refreshes.

### Run details, ledger and workspace

**Run details** under each occurrence shows the run id and the number of
attempts, with:

- **Open run ledger**: opens the run in **Observe** (timeline, ledger,
  provider calls, graph);
- **Ledger (JSON)**: the gateway's raw ledger for that run, opened in a new
  tab through your connection (artifacts open the same way; HTML and SVG as
  text);
- **Workspace**: browse the run's folder (see [The automation's files](#the-automations-files)).

### Discuss a result

**Discuss** on a row, or **Discuss — fork at this occurrence (own workspace,
automation files read-only)** on a finished occurrence, opens a chat in place
of the panel. Your first message creates a new session that forks the
automation at occurrence #N with its history (runs 1 to N) in context; every
later message is the next turn of that session, answered with the same model.
The chat is the shared AbstractUIC chat (the one AbstractCode uses): replies
stream in, tool approvals and questions are answered in the chat, and
**Stop** ends the turn in progress. The button with the automation's title
returns to its panel.

- The discussion works in its **own writable workspace**.
- The automation's folder is **mounted read-only** in it for the file tools,
  so it can read what the runs produced (shell commands are not sandboxed; see
  below).
- Nothing is written back into the automation's session: the automation and
  its next runs never see the discussion.

**Its files** and **Automation files** in the chat's header browse the
discussion's own workspace (`workspace_root`) and the automation's folder
mounted read-only (`mounted_workspace`), as described in
[The automation's files](#the-automations-files).

The read-only mount is enforced for file tools: they refuse to write into the
automation's folder. Shell commands are **not** sandboxed, so a command the
discussion runs could still change files there; approve such commands with
that in mind.

Discuss is available once the occurrence has finished, and also on an
archived automation (its history is kept).

## Automation runs elsewhere in the Observer

The gateway attributes every run it lists (`role`, `session_kind`,
`automation_id`, `occurrence_index`). The Observer tags runs from these fields
only; a workflow name never makes a run an automation run.

- **Board**: an occurrence card carries an `occurrence #N` tag and an
  **Automation** button that opens its automation on the Automations page. An
  automation between runs is not a card; it lives on the Automations page.
  Waits of an occurrence (questions, tool approvals with their tool calls)
  can be answered from the Review column as for any run.
- **Observe**: in the run navigator, occurrences are grouped under their
  automation, which reads as its title (tag `automation`); discussions are
  tagged `discussion` and legacy schedules `legacy schedule`.
- **System → Activity**: **Scheduled** lists runs waiting for a time
  (an automation waiting for its next run, legacy schedules); **Subflows /
  external events** lists runs waiting on a child workflow or an event.

## Legacy schedules

Schedules created with `POST /runs/schedule` before automations existed are
listed with a `legacy` tag and keep their own controls: an **Active** switch (off = suspended), **Run now** (while not suspended), **Open run**, and
**Recreate as automation**. Their run view also keeps **Edit schedule**.

**Recreate as automation** (on the row, in the legacy panel and in the run
view) opens **Launch → Automate** prefilled with the schedule's workflow,
inputs, interval, run limit, end time and context (a schedule that shared
context becomes **Growing**). The legacy schedule is not changed: it keeps
running until you suspend it. An interval that an automation cannot express
(milliseconds, fractions, seconds that are not whole minutes) is left for you
to choose, and a note above the form says so.

## Developing against a stub gateway

`scripts/automations_stub_server.mjs` is a stub gateway for the Automations
routes. It serves the ui-kit's canonical automation fixtures
(`../abstractuic/ui-kit/scripts/fixtures/automations/`), enforces the answer
shape of each wait kind, and applies commands, so you can work on the page
without a real gateway:

```bash
node scripts/automations_stub_server.mjs --port 18951
```

The automations tests (`src/ui/automations.test.tsx`) start it in-process.
See [development.md](development.md).

## Where the code lives

- `src/ui/automate_form.tsx`: the When, Context and Tools fields and the
  Advanced schedule fields;
- `src/ui/automations.ts`: the rules (workflow choice incl. `@default`, the
  create body, row controls, run tags, the capability gate, the legacy
  prefill, typed wait answers) and the page controller;
- `src/ui/automations_page.tsx`: the page, its rows and the panel wiring;
- `src/ui/automation_discussion.tsx`: the discussion chat (panel-chat's
  `WorkflowChat`, `WorkflowSessionController` and `presentInteraction` over
  the Observer's gateway client);
- the folder browser is panel-chat's `WorkspaceBrowser`, fed by
  `GatewayClient.fetch_gateway`;
- the panel itself is the ui-kit's `AutomationPanel`
  (`@abstractframework/ui-kit`), shared with AbstractAssistant;
- `src/ui/run_tree.ts`: navigator grouping.
