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

Open **Launch** and switch **Run once | Automate** to **Automate** (the
**New automation** button on the Automations page opens the same form).

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

All times are UTC. Intervals are fixed: "every 24 hours" means 24 hours after
the previous tick, whatever your time zone or daylight saving time. The line
under the field states the result, for example "Runs every 24 hours (UTC),
first run now." or "Runs every minute (UTC), first run now."; it reads
"Incomplete schedule." until the fields are valid.

### Context

- **Independent** (default): each run starts fresh in its own session. Runs
  never see each other.
- **Growing**: each run is a new turn of one conversation and sees the
  previous runs. The history is bounded: the most recent 40 messages (at most
  24,000 characters) are replayed; older runs drop out.

### Tools

- **Tools run without asking (you approve them now by creating this
  automation)** (default). An unattended run cannot stop to ask you at every
  tick, so creating the automation is the approval. When the inputs name the
  workflow's tools (`tools`), they are listed next to this line.
- **Ask each time**: every tool call waits for your approval on the
  Automations page.

Questions a workflow asks you (`ask_user`) always wait for you, whichever
option you choose.

### Advanced

- **Title** (at most 120 characters; defaults to the prompt's first line);
- for a repeating automation: **First run at (UTC; empty = now)**, **Stop
  after this many runs**, **Stop at (UTC)**;
- the skills picker (the gateway resolves the selected skills through its
  trust gate), the workspace, and bundle upload / reload.

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
Active, Paused, Completed, Failed, Archived.

### Rows

Each row shows:

- the title, the state (active, paused, completed, failed, archived) and,
  when something needs you, a badge such as "2 unseen · 1 waiting for you";
- the cadence ("every 8 hours (UTC)", or "manual runs only"), the next run
  ("none while paused" when paused), and the last run's number and status
  ("#3 completed", "#2 failed after 3 attempts", or "no runs yet");
- an excerpt of the last answer.

Row controls (a disabled control explains why when you hover it):

| Control | What it does |
| --- | --- |
| **Pause** / **Resume** | Pause skips scheduled runs. Resume re-arms the schedule; the ticks that passed while paused are not run. |
| **Run now** | Runs one occurrence immediately. It also works while paused, and the automation stays paused ("Run now sent to “…”; it stays paused."). It is disabled while an occurrence is in progress. |
| **Edit**, **Discuss** | Open the automation's panel, where you revise it or pick the result to discuss. |
| **Archive…** | Asks first ("Its history stays readable; it will not run again."), then stops the automation for good. |

Commands are accepted by the gateway and applied moments later. The page
reads the list again right away and twice more over the next few seconds, so
a new state appears without a manual refresh.

### When the gateway refuses a command

Errors are shown as one sentence plus the gateway's own message. The ones you
are most likely to meet are conflicts (HTTP 409):

| Code | What the Observer says | What to do |
| --- | --- | --- |
| `automation_busy` | "An occurrence is already running or queued. Wait for it to finish." | Wait, or use **Stop current** in the panel. |
| `revision_conflict` | "The automation changed since this view loaded. Reload it, then try again." | Reopen the automation and revise again. |
| `invalid_state` | "The automation's current state does not allow this." | For example resuming an archived automation. |
| `identity_conflict` | "This request id was already used for a different request." | Submit again; the form mints a new id for changed fields. |

Other codes: `unauthorized` ("Sign in to the gateway to manage
automations."), `forbidden`, `automation_not_found` ("This automation does
not exist (or is not yours)."), `occurrence_not_found`, `invalid_request`,
`invalid_definition`, `unsupported_feature`, `unknown_trigger_source`.

## The automation panel

Select a row to open its panel (the panel area reads "Loading…" until the
selected automation arrives).

### Definition and controls

The top of the panel shows **When**, **Context**, **Next run**, **Runs**,
**Attention** and **Revision**, and the controls **Pause** / **Resume**,
**Run now**, **Stop current**, **Revise…** and **Archive…**. While paused, the
panel reminds you: "Paused: scheduled runs are skipped. Run now works and
keeps it paused."

- **Stop current** cancels the occurrence in progress (or its pending
  retry); it ends as `cancelled`, quietly, and the schedule continues.
- **Revise…** changes the title, the interval and the context. Changes apply
  from the next run; a new interval never fires ticks that already passed.
  The revision you edited is sent along, so a concurrent change is refused
  with `revision_conflict` instead of being overwritten.

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
- **Ledger (JSON)**: the gateway's raw ledger for that run;
- **Workspace**: the run's workspace, when it has one.

### Discuss a result

**Discuss — forked session, read-only workspace** on a finished occurrence
asks for your message ("Ask about this result…"), then **Start discussion**
creates a new session seeded with the automation's conversation up to that
occurrence and opens it in **Observe**, where you continue the chat.

The discussion never changes the automation or its next runs, and the
automation's workspace is mounted read-only there. Discuss is available once
the occurrence has finished, and also on an archived automation (its history
is kept).

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
listed with a `legacy` tag and keep their own controls: **Suspend** /
**Resume**, **Run now** (while not suspended), **Open run**, and
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
- the panel itself is the ui-kit's `AutomationPanel`
  (`@abstractframework/ui-kit`), shared with AbstractAssistant;
- `src/ui/run_tree.ts`: navigator grouping.
