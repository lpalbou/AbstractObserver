# Planned: Automations in the Observer (Automate mode, Automations page, transcript, discuss)

## Metadata
- Created: 2026-09-26
- Status: Completed — UNRELEASED (local commits on `main`; package still 0.1.13; the release is in the framework wave, root backlog 0941). Was: Planned (Automations v1, next minor wave; mission O)
- Completed: 2026-09-27
- Work id: abstractobserver-0002
- Design: untracked/design/automations-PLAN.md (2026-09-26)
- Related: abstractframework backlog 0928 (Automations v1, root item)

## ADR status
- Governing ADRs: None
- ADR impact: None

## Summary
Give the Observer a short path to create an automation and a place to see
and manage every automation of the signed-in gateway user:

1. **Automate mode on Launch** with three fields: What (workflow, including
   the gateway default `@default` + interface, and the prompt), When
   (presets mapped to `schedule@1`), Context (Independent / Growing).
   Everything else moves under Advanced; the duplicate skills picker goes.
2. **Automations page**: one row per automation from `GET /automations`,
   with its commands, and an occurrence transcript from
   `GET /automations/{id}/occurrences` rendered as chat pairs.
3. **Board / navigator tagging** by `session_kind` and occurrence
   attribution, not by the `scheduled:` workflow-id prefix.
4. **Legacy schedules** listed with `legacy:true`, today's controls, and
   "Recreate as automation".

The Observer executes nothing: every action is a gateway route (contract F).

## Why
Operator, 2026-09-26 (verbatim):

- "we have scheduled/triggered/recurrent tasks (eg observer -> launch) but i
  think it's too complicated to launch them"
- "we also need better ways to visualize them - how do we rapidly access the
  scheduled/recurrent/triggered tasks registered for a gateway user/runtime ?
  i wonder if we should not distinguish for instance the "regular" sessions
  and the sessions created for that type of "automated" tasks ?"
- "we need also to be able to alter the automation (eg change intervals,
  pause it, resume it, change the conditions, etc), as well as to dialogue
  with the context created by that automation (we have that in observer
  normally already)."
- "we also need to see the steps, what is done at each step - that's why a
  chat representation of an automated task is not a bad thing either, where
  you see the automated task triggered at some point, and the answer that
  comes with it."
- "when dialoguing with it however, it's more like a fork on that context at
  that time and it should not affect the normal process of the automated
  task."

PLAN §1 principles this item implements on the Observer side: **Visible and
manageable** ("Users can inspect results and steps, edit definitions,
pause/resume, run manually, stop current work and archive"), **Conversation
representation** ("Each occurrence contributes a trigger/task turn and
answer"), **One system** (the Observer projects gateway/runtime truth; it
never schedules).

Operator rulings (PLAN appendix, 2026-09-26) that bind this item:
- Ruling 4: "Discuss is NOT read-only and NOT tool-restricted. A discussion
  is a new durable runtime session, forked/seeded from the automation's
  conversation through the chosen occurrence, replayable like any session,
  with the target's normal tools. Isolation means only that it never writes
  back into the automation's session/context (a fork)." The Observer
  therefore shows no "read-only" or "reader tools" wording on Discuss.
- Ruling 6: "App breadth for v1: Observer and Assistant only."
- Ruling 2: Independent is the default context mode.
- Ruling 5 (provisional): quiet results stay quiet; failures and human waits
  always surface.

## Scope

### In
- Launch page: a mode switch **Run now | Automate**. Automate shows:
  - **What**: workflow picker that accepts `@default` + interface (Gateway
    default agent) as well as `bundle:flow`; the prompt field.
  - **When**: presets — Once at…, Every hour, Every N hours, Daily at HH:MM,
    Weekly on <day> at HH:MM, Custom (every N `s|m|h|d`, optional until /
    count). Each maps to `schedule@1 {start_at, every, until?, count?}`:
    "Daily at 08:00" = `{start_at: <next 08:00 local, as UTC>, every: "1d"}`;
    "Weekly" = `every: "7d"`. The preview line states the next fire time in
    local time. Weekday-only rules are not expressible in `schedule@1` and
    are not offered (v3, PLAN §5).
  - **Context**: Independent (default) / Growing, one sentence of help each.
  - **Title**: prefilled from the prompt, editable.
  - **Advanced** (collapsed): workspace, input-data JSON, capabilities
    (skills), upload, raw trigger JSON for other sources listed by
    `GET /trigger-sources`.
  - The skills pin rendered inside the adaptive inputs and the separate
    Capabilities skills list collapse into ONE picker (under Advanced in
    Automate mode, unchanged position in Run-now mode).
  - Submit = `POST /automations {request_id, title, target, trigger, context}`;
    on success, navigate to the new automation's detail.
- New **Automations** page (top-level nav entry):
  - Rows: title, cadence (human text from the binding), next run, last
    status, last excerpt, attention (pending waits count, unread dot).
    Status filter (active / paused / completed / archived / failed), legacy
    rows marked `legacy`.
  - Actions per row / detail: Pause, Resume, Run now (allowed while paused;
    shows "stays paused"), Edit (PATCH with `expected_revision`), Stop
    current, Archive, Discuss.
  - Detail = transcript: each `OccurrenceRow` as a chat pair (trigger/task
    turn = `user_turn` with `trigger.summary` and `fired_at`; answer turn =
    `answer`, status, artifacts). Each pair has an expandable "Steps" panel
    that loads the occurrence ledger (`ledger_url`) through the Observer's
    existing ledger views. `waits[]` render in place with the existing
    wait-answer controls (prompt / choices) and resolve the actual pending
    wait. `onLoadMore` pages older occurrences by cursor.
  - Discuss: prompt box on an occurrence →
    `POST /automations/{id}/discuss {request_id, occurrence_index, prompt}`
    → open the returned `session_id` / `run_id` in the normal run view (a
    regular durable session with the target's tools).
  - Seen: opening the detail posts `POST /automations/{id}/seen` with the
    summary's `attention.cursor`.
  - Polling: `GET /automations?changed_since=<change_cursor>` while the page
    is visible (no SSE in v1).
- Board (`mission_control.tsx`) and navigator (`run_panels.tsx`): tag runs by
  `session_kind` (`automation` / `occurrence` / `discussion`) and occurrence
  attribution (`automation_id`, `occurrence_index`); an occurrence card links
  to its automation. The controller root parked in its wait is not a
  "pending" card.
- Runtime page (`runtime_page.tsx`): split the mixed "Scheduled/subflows"
  queue into "Automations" (by attribution) and "Subflows".
- Legacy schedules (`legacy:true` rows): today's controls (suspend/resume,
  run now, edit interval) plus "Recreate as automation", which prefills
  Automate mode from the legacy target, input data and interval. No
  automatic migration (PLAN §5).
- Capability check: the Automations page and Automate mode appear only when
  the gateway advertises the Automation API; otherwise the current Schedule
  section stays.

### Out
- Scheduling, execution, discuss tool ceilings: gateway/runtime (G, R).
- External triggers (file, email, run-finished): next phase (ruling 3);
  the Advanced raw-trigger field only passes through sources the gateway
  lists as `available`.
- Code WUI/TUI and gateway console surfaces (ruling 6).
- Rolling/automatic summaries for Growing mode (`unsupported_feature`).
- Weekday / cron / timezone rules (v3).
- Removing the legacy Schedule section while legacy schedules exist.

## Gateway contract consumed (PLAN §3 F, copied verbatim)

```text
AutomationSummary={
 automation_id,title,status,trigger:TriggerBinding,context_mode,next_fire_at?,
 occurrence_count,last_occurrence?:{
  run_id,index,status,fired_at,finished_at?,excerpt,notify},
 attention:{pending_waits:int,unread:bool,cursor:string},
 legacy:bool,revision:int|null,updated_at,capabilities:string[],
 session_kind:"automation"
}
OccurrenceRow={
 run_id,index,fired_at,finished_at?,status,
 trigger:{source_id,summary},user_turn,answer,notify,
 artifacts:[{artifact_id,name,mime_type,url}],
 waits:[{run_id,wait_key,reason,prompt?,choices?}],
 ledger_url,workspace_url?
}
CommandReceipt={command_id,accepted,duplicate,seq}
```

| Route | Request → response |
|---|---|
| `POST /automations` | `{request_id,title,target,trigger,context?,policy?}` → `{automation_id,revision,summary}` |
| `GET /automations` | `status,changed_since,cursor,limit` → `Page<AutomationSummary>` |
| `GET /automations/{id}` | → `{definition,active_revision,summary}` |
| `PATCH /automations/{id}` | `{command_id,expected_revision?,changes:{title?,target?,trigger?,context?}}` → receipt |
| `POST /automations/{id}/commands` | `{command_id,type,payload?}` → receipt |
| `GET /automations/{id}/occurrences` | `cursor,limit` → `Page<OccurrenceRow>` |
| `POST /automations/{id}/discuss` | `{request_id,occurrence_index,prompt}` → `{session_id,run_id,session_kind:"discussion"}` |
| `POST /automations/{id}/seen` | `{attention_cursor}` → `{attention_cursor}` |
| `GET /trigger-sources` | → `{items:[TriggerSource+{available,unavailable_reason?}]}` |

Command types: `automation.revise|automation.pause|automation.resume|automation.run_now|automation.stop_current|automation.archive`.
Status: `active|paused|completed|archived|failed`. Errors:

```text
{error:{code,message,field?,command_id?}}
404: automation_not_found|occurrence_not_found
409: revision_conflict|automation_busy|invalid_state|identity_conflict|cursor_expired
422: invalid_definition|unsupported_feature|unknown_trigger_source
```

Trigger binding sent by Automate mode: `schedule@1:{start_at?, every?, until?, count?, anchor?}`
(`every` = positive integer `[smhd]`; absent = one-shot; `count>1` requires
`every`; `until` exclusive). Note the "weeks" unit the current form offers
does not exist in `schedule@1`; weekly maps to `7d`.

Error handling the UI must show (never swallow): `revision_conflict` →
reload definition and re-offer the edit; `automation_busy` on Run now →
"an occurrence is running"; `invalid_state` → action disabled with reason;
`cursor_expired` → restart the list from the top; 422 → field-level message
using `field`.

## Current code reality (verified 2026-09-26 at bf33805)
- `src/ui/app.tsx:5097-5540` — the Launch page is one form for every case.
  Workflow picker `:5116` (`<select>` fed by `parse_namespaced_workflow_id`,
  `app.tsx:190`, which requires `bundle:flow`); adaptive inputs `:5185`,
  including a skills pin picker `:5238`; Capabilities skills list `:5352`
  (second skills picker for the same `input_data.skills`); Workspace
  `:5409`; Schedule `:5449-5498` (start now/at radio, cadence select
  once/forever/count/until, every N + unit incl. weeks, total runs, end
  date, "Share context across executions" checkbox). "Daily at 8" today
  costs ~12–14 interactions (pick workflow, prompt, open Schedule, Start=at,
  date-time, cadence=forever, N=1, unit=days, share-context decision,
  Launch).
- `src/ui/app.tsx:2884` `start_scheduled_run` → `gateway.schedule_run`
  (`:2996`, legacy `POST /runs/schedule`).
- `src/ui/app.tsx:3244` `run_scheduled_now` (legacy run-now).
- `src/ui/app.tsx:5832` edit-schedule button; interval validation regex at
  `:3299` (`ms|s|m|h|d`, decimals allowed — broader than `schedule@1`).
- `src/ui/app.tsx:3831` and `:3926` — scheduled detection by the
  `scheduled:` workflow-id prefix.
- `src/lib/gateway_client.ts:121` — `schedule_run` throws
  `bundle_id is required`, so the gateway default (`flow_id:"@default"` +
  `interface`, `abstractgateway/agent_defaults.py:53`) cannot be scheduled.
- `src/ui/mission_control.tsx:239` — `board_column`: a `scheduled` wait goes
  to the Pending column (a parked controller would sit there forever);
  `:730` card line `every {card.schedule_interval}`.
- `src/ui/run_panels.tsx:84-226` — `WorkflowRunNavigator`: group by
  status / workflow / session; no automation grouping.
- `src/ui/runtime_page.tsx:160` — one mixed "Scheduled/subflows" queue.
- `src/ui/app.tsx:1206-1208` — the run list is a client window of 200 root
  runs + 500 runs; automations must come from `GET /automations`, never
  from folding this window (older occurrences fall out of it).
- `src/ui/app.tsx:1182-1203` — `RunSummary` normalization keeps
  `is_scheduled`/`schedule` but drops `actor_id` and has no field for
  `session_kind` / `automation_id` / `occurrence_index`; these must be
  added for tagging.
- ui-kit: `package.json` declares no `@abstractframework/ui-kit`
  dependency, but the Observer already imports it (`app.tsx:29`,
  `mission_control.tsx:19`, `main.tsx:6`, `about.test.tsx:7`) through the
  source aliases in `vite.config.cjs`, `vitest.config.cjs:28` and
  `tsconfig.json:25` (`../abstractuic/ui-kit/src`), compiled into the
  Observer bundle.

## Decision: ui-kit `AutomationPanel`
**Adopt** `AutomationPanel` from `@abstractframework/ui-kit` through the
existing source alias; do not mirror it. The Observer already consumes the
kit this way (no npm dependency added, no version floor to publish for the
Observer), so adoption costs nothing extra and keeps the transcript, command
and error presentation identical to the Assistant. The Observer owns the
list page, the Launch Automate mode, the board/navigator tagging and the
wiring of the panel's callbacks (`onCommand`, `onRevise`, `onDiscuss`,
`onSeen`, `onAnswerWait`, `onOpenRun`, `onLoadMore`) to its gateway client;
the ledger "Steps" expansion uses the Observer's ledger views via
`onOpenRun` or a slot if U provides one. Tests use U's canonical fixtures
`fixtures/automations/{list,occurrences,trigger-sources,commands,errors}.json`.

## Seams
- **G (abstractgateway)**: read the live routes, response shapes and error
  codes above in `routes/gateway.py` before wiring; read the waits payload
  and the discuss response. The capability name advertising the Automation
  API and the `session_kind` / attribution fields on `GET /runs` rows are
  G's; if missing, the Observer fails loudly and raises a `blocked` ask to G
  (no fallback to the `scheduled:` prefix for new automations).
- **U (abstractuic)**: read `AutomationPanelProps` and the client module in
  the live ui-kit source, and the fixtures, before use. If a Steps slot or a
  prop the Observer needs is absent, ask U; do not fork the panel.
- **R (abstractruntime)**: no direct call; attribution shapes (`_meta.occurrence`,
  `_meta.discussion`) arrive through G.

## Tests
- `src/ui/automations.test.tsx` (vitest, fixtures from abstractuic):
  - Automate mode: each When preset produces the exact `schedule@1` binding
    (daily at 08:00 → `{start_at, every:"1d"}`; once → no `every`; custom
    count/until); `@default` + interface is accepted and sent as target;
    only one skills picker renders.
  - Automations page renders list fixture rows (cadence, next run, last
    status, excerpt, attention) and legacy rows with legacy controls.
  - Each command posts the right type with a fresh `command_id`; Run now on
    a paused row is enabled; each 409/422 fixture shows its message.
  - Occurrences render as chat pairs; Steps expand to the ledger; a pending
    wait answers the fixture's `run_id` + `wait_key`.
  - Discuss posts `{request_id, occurrence_index, prompt}` and opens the
    returned session.
  - Board tags by `session_kind`; a run with a `scheduled:` workflow id but
    no attribution is NOT tagged as an automation.
  - Check discipline: delete a fixture field the view depends on and watch
    the test go red.

## Definition of Done
The three operator scenarios are walkable in the Observer against a gateway
running the G acceptance flow (deterministic fixture flow, no provider):

1. **Three news monitors** — create three automations from Automate mode
   with different prompts and cadences (e.g. every 8h, every 12h, daily at
   08:00), one Independent and one Growing; all three appear on the
   Automations page with correct cadence and next run; pause one, run it
   now while paused (it stays paused), resume without catch-up, edit an
   interval (next run updates); read two occurrences as chat pairs and
   expand their steps.
2. **Email triage with a human-gated reply** — an occurrence stops on a
   human wait; the row shows attention; the wait is answered in place in the
   transcript and the occurrence completes; a quiet success
   (`notify:false`) shows no unread dot but is visible in the transcript.
3. **Weekly journal monitor** — created with the Weekly preset
   (`every:"7d"`); Discuss on an occurrence opens a normal durable session
   with the target's tools; two discussion turns do not appear in the
   automation's transcript nor change its next occurrence's context;
   Archive keeps the history visible.

Plus: `npm test` green; `npm run build` green; legacy schedules still
manageable; no remaining `scheduled:` prefix logic for new automations.

## Dependencies
- G — abstractgateway Automation API (contract F), attribution on run rows,
  capability flag, acceptance script.
- U — abstractuic ui-kit `AutomationPanel`, client module, fixtures.

## Related
- abstractframework backlog 0928 (Automations v1, root item).
- PLAN §4 mission O; §7 risk "Hidden/misleading activity" (attention vs
  change cursors — the Observer polls `changed_since` and posts `seen`).

## Contracts pass (2026-09-27)

Final contracts: untracked/design/automations-CONTRACTS.md (root repo; rev 2 with Astra turn-6 amendments 1–11). They supersede the contract text copied above; earlier text is kept as history. Concrete changes for this item:

- When presets are fixed UTC intervals labelled "every N hours/days" ("every 24 hours", "every 7 days"); a chosen start time only sets `start_at`; never "Daily at 08:00 local"/"Weekly on <day>" wording. Validator `^[1-9][0-9]*[smhd]$`; no months.
- Target sent as `{bundle_ref,flow_id}` or `{flow_id:"@default",interface}`; the gateway resolves `@default`.
- Poll full paginated `GET /api/gateway/automations` (no `changed_since`, no `cursor_expired` path). Attention via `GET …/attention`; `/seen` posts the cursor of the last displayed item.
- Quiet is the default: unread comes only from a `notify` output, a final failure (after retries), or an interactive wait; drop the `notify:false` wording. Rows show `attempts`.
- Discuss copy: "forked session, read-only workspace" (writes and command execution are refused there).
- Errors: `ApiError.code` from `detail.reason_code` via the ui-kit client; 401/403/`invalid_request` fixtures.

## Completion report (2026-09-27)

**Status: completed — UNRELEASED.** Local commits on `main`, no version bump, not pushed. Umbrella record:
abstractframework backlog 0928 (completed); release: root 0941 (Observer relocks after the kit publishes).

**Commits:** `56af9b4` … `9685fe0` (9 commits; docs `588b6ac`, `bb5c694`, `8f41b63`).
- **`56af9b4`:** Launch "Run once | Automate" (`src/ui/automate_form.tsx`), the Automations page
  (`src/ui/automations_page.tsx`, the kit `AutomationPanel`), attribution tags from `role` / `session_kind` only,
  controllers hidden from the Board, occurrences grouped under their automation, split Runtime queues. The old
  `start_scheduled_run` / `schedule_run` launch path is removed.
- **`21e3b6b`:** tests. The Automate bodies, the page, commands, legacy rows, tags, and the three operator scenarios
  against the contract stub (`scripts/automations_stub_server.mjs`).
- **`554e5c1`:** never show the previous automation's panel while the selected one loads.
- **`a48a4a1`:** reconciled with the real gateway (`2c8d8b3`) and decision D1. Waits are answered by `kind`, and the
  form states the tools consent.
- **`9199901`:** the stub's legacy row carries `binding_id` / `last_occurrence` (gateway D6).
- **`9685fe0`:** the tests follow the kit fixtures regenerated from real gateway output (abstractuic `a9b73ab`; review
  54 O-1).

**Tests and walk:**
- vitest **159/159** on kit `2081d6a` (review 54). `9685fe0` realigns the 6 tests that failed against kit `a9b73ab`.
- `tsc --noEmit` clean; `vite build` OK.
- A headless-Chromium walk against a hermetic real gateway: **17/17 on `5161785`** (14/15 earlier on `2c8d8b3`; the
  blocked step was answering waits before D1). Captures are in root `untracked/missions-2026-09-27/E2E/observer-captures/`.
- Mutations 3/3 RED (review 54).

**Review:** 54 GO for deploying on the operator's machine (root
`untracked/missions-2026-09-25/REVIEW/54-observer-automations.md`). O-1 → fixed `9685fe0`.

**Definition of Done, against what shipped:**
- **The three scenarios:** walked against the stub (`21e3b6b`) and, for the core flows, against the real gateway:
  create, pause, run now while paused, resume, revise, archive, discuss, and answering waits by kind.
- **Wording:** "daily at 08:00" and "weekly on <day>" wording is gone (fixed UTC intervals, per the contracts pass).
- **Quiet successes:** they read as quiet by default; there is no `notify:false` wording.
- **Legacy schedules:** still manageable (Suspend / Resume / Run now / Open run / Recreate as automation).

**Residuals:**
- **O-2.** The Automate form's Advanced JSON passes `_meta`, the read-only keys and every `_runtime` key through
  `clean_input_data` (`src/ui/automations.ts:117`). The gateway allowlist (gateway `4ece2f5`, R52-1) removes the harm;
  the form should refuse those keys visibly → root backlog **0940**.
- **O-3 (notes).** Event answers pass non-object payloads to the gateway, which answers 422 and the page shows it
  (R52-2 is the kit-side fix). Recreate shows `3600s` as "60 minutes".
- **Revise from a row.** Opening the panel's Revise form from a row needs a kit prop (abstractuic 0029 residual).
- **Board.** The Board keeps occurrence turns because they carry `parent_run_id`; this is by design.
