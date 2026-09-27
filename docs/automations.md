# Automations

An **automation** runs a workflow for you on a schedule: "search the AI news
every 8 hours", "triage my inbox every 30 minutes", "check the journals every
7 days". The gateway runs it and keeps every run; the Observer is where you
create it, watch it, change it and talk about its results. The Observer
executes nothing itself: every action is a gateway request.

Automations need a gateway that advertises the Automations API
(`capabilities.contracts.common.automations` in
`GET /api/gateway/discovery/capabilities`). On an older gateway the Automate
mode and the Automations page say so and stay disabled; schedules created
before automations keep working from their run view (see
[Legacy schedules](#legacy-schedules)).

## Create one: Launch → Automate

Open **Launch** and switch **Run once | Automate** to **Automate**. Three
things matter; everything else sits under **Advanced**.

1. **What**: the workflow and its inputs, usually the prompt. The picker lists
   the gateway's published workflows and, under **Gateway default**, the
   gateway's default agent for an interface (for example
   `Gateway default agent · abstractcode.agent.v1`). A default-agent
   automation is sent as `flow_id: "@default"` plus the interface; the gateway
   decides which workflow that is when the automation is created.
2. **When (UTC)**: **Repeat** every N minutes, hours or days (presets: every
   5 minutes, 30 minutes, hour, 8 hours, 24 hours, 7 days), or **Once at** a
   date and time. Intervals are fixed UTC intervals: "every 24 hours" means
   24 hours after the previous tick, whatever the time zone or daylight saving
   time. The line under the field says what will happen, for example
   "Runs every 24 hours (UTC), first run now."
3. **Context**:
   - **Independent** (default): each run starts fresh in its own session.
   - **Growing**: each run is a new turn of one conversation and sees the
     previous runs. The history is bounded: the most recent 40 messages (at
     most 24,000 characters) are replayed; older runs drop out.

4. **Tools**: by default "Tools run without asking (you approve them now by
   creating this automation)": an unattended run cannot stop to ask you every
   tick, so creating the automation is the approval. Choose **Ask each time**
   to make every tool call wait for your approval on the Automations page.
   Questions a workflow asks you (`ask_user`) always wait for you.

**Advanced** holds the title (default: the prompt's first line), the first run
time, "stop after this many runs", "stop at", the skills picker (one picker;
the gateway resolves skills through its trust gate), the workspace, and bundle
upload / reload.

**Create automation** sends `POST /api/gateway/automations` and opens the new
automation on the Automations page. If the request fails, the error is shown
with the gateway's reason (for example "every must match ^[1-9][0-9]*[smhd]$");
pressing the button again with the same fields is a safe retry.

## The Automations page

**Automations** (left navigation) lists every automation of the signed-in
gateway user. The list is read in full pages and refreshed every 30 seconds
while the page is visible. Filter by status: active, paused, completed,
failed, archived.

Each row shows the title, the cadence ("every 8 hours (UTC)"), the next run,
the state, the last run's status and an excerpt of its answer, and a badge
when something needs you ("2 unseen · 1 waiting for you"). Row controls:

- **Pause / Resume**: pause skips scheduled runs; resume re-arms the schedule
  without running the ticks that passed while paused.
- **Run now**: runs one occurrence immediately. It also works while paused and
  keeps the automation paused. It is refused while an occurrence is still
  running.
- **Edit** and **Discuss** open the automation's panel.
- **Archive…** (asks first): the automation stops for good; its history stays
  readable.

Select a row to open its panel:

- the definition (cadence, context, next run, revision) and the same
  controls, plus **Stop current** and **Revise…** (title, interval, context;
  changes apply from the next run);
- the runs as a conversation, oldest first: each occurrence is a trigger turn
  (what fired, when) and an answer turn. Quiet runs stay plain; runs that
  notified you, failed (with the reason and the number of attempts) or wait for
  you are marked. **Load earlier occurrences** pages back in time;
- a run waiting for you shows what it waits for, in place: a question
  (answer or pick a choice), a tool approval (the tool calls, then Approve or
  Deny) or an event (a JSON payload). The answer is sent as the kind of wait
  requires (`{response}`, `{approved}` or `{payload}`) with the same `resume`
  command the Board and the run view send; a wait the gateway does not type
  is shown but not answered here (open the run instead);
- **Run details** → **Open run ledger** opens that run in **Observe**;
  **Ledger (JSON)** and **Workspace** link to the gateway's raw views;
- **Discuss — forked session, read-only workspace** on a finished occurrence
  starts a new session seeded with the automation's conversation up to that
  occurrence, and opens it in **Observe**. The discussion never changes the
  automation or its next runs; the automation's workspace is mounted read-only
  there.

Opening an automation marks the attention items it shows as seen.

## Where automation runs appear elsewhere

The gateway tags every run it lists; the Observer shows those tags and never
guesses from a workflow name:

- **Board**: occurrence cards carry an `occurrence #N` tag and an
  **Automation** button that opens their automation. An automation itself
  waiting for its next run is not a card (it lives on the Automations page).
- **Observe**: occurrences are grouped under their automation in the run
  navigator (tag `automation`), discussions are tagged `discussion`, legacy
  schedules `legacy schedule`.
- **System → Activity**: **Scheduled** lists runs waiting for a time
  (automations between runs, legacy schedules); **Subflows / external events**
  lists runs waiting on a child workflow or an event.

## Legacy schedules

Schedules created before automations (`POST /runs/schedule`) are listed with a
`legacy` tag and keep their own controls: **Suspend / Resume**, **Run now**,
**Open run** (the run view also has **Edit schedule** and **Compact
context**). **Recreate as automation** (on the row and in the run view) opens
Launch → Automate prefilled with the legacy workflow, inputs, interval and
context; the legacy schedule is not changed, suspend it yourself once the
automation runs. Intervals an automation cannot express (milliseconds,
fractions, seconds that are not whole minutes) are left for you to choose.

## Gateway endpoints

All under `/api/gateway`, called through the ui-kit client
(`createAutomationsClient`, `src/lib/gateway_client.ts` →
`automations_client()`):

| Action | Request |
| --- | --- |
| list | `GET /automations?status=&cursor=&limit=` (every page) |
| create | `POST /automations` |
| open | `GET /automations/{id}`, `GET /automations/{id}/occurrences?cursor=&limit=` |
| pause, resume, run now, stop current, archive | `POST /automations/{id}/commands` (`automation.*`) |
| revise | `PATCH /automations/{id}` with `expected_revision` |
| discuss | `POST /automations/{id}/discuss` |
| mark seen | `POST /automations/{id}/seen` |
| trigger sources | `GET /trigger-sources` |
| answer a wait, legacy controls | `POST /commands` (`resume`, `pause`) |

Errors carry `{"detail": {"reason_code", "message", "field"?}}`; the Observer
shows the reason in words plus the gateway's message.

Code: `src/ui/automations.ts` (rules and page controller),
`src/ui/automations_page.tsx` (page), `src/ui/automate_form.tsx` (Automate
fields), `src/ui/run_tree.ts` (navigator grouping). Tests:
`src/ui/automations.test.tsx` against `scripts/automations_stub_server.mjs`, a
stub gateway serving the ui-kit's canonical fixtures.
