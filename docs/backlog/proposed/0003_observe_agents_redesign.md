# Proposed: Observer redesign — observe agents, not cards

## Metadata
- Created: 2026-10-14
- Status: Proposed — waves 1 and 3 BUILT 2026-10-14 (uncommitted, see Progress); operator decisions taken: D1 inline rename only; D2/D5 defaults; D3/D4 open; wave 2 (runtime/gateway) not started — the operator wants an explanation before any change there
- Work id: abstractobserver-0003
- Origin: operator brief 2026-10-14 (Board screenshots); design v1 + adversarial review in `untracked/redesign/` (DESIGN-v1.md, ADVERSARY-1.md: 2 P0 / 8 P1 / 6 P2, GO-with-changes — all folded in below)
- Related: `proposed/2026-07-12_ui_rethink_redesign.md` (partially superseded; its app.tsx restructure is wave 5 here); root backlog 1015 (memory blocs — the search W2 needs); abstractgateway / abstractruntime asks in §8

## ADR status
- Governing ADRs: none in this repo. Operator rules applied as policy: no regex/NLP heuristics on prose (2026-09-27); one word per run across apps; a client tolerates the previously released gateway (optional fields).
- ADR impact: P3/P5 below ("a state is a sentence with an object and an actor"; "one truth per run") should become an ADR when wave 1 lands — they bind every AbstractFramework client, not only the Observer.

## Context

The operator's brief (verbatim points):
1. A card must say WHAT the run is for: title first, workflow id secondary, the uuid off the card (copy button only).
2. Automations: a sharable icon identity; last occurrence, next occurrence, number of turns on the card; on open: total time, the workflow parameters, the input/output pins "as AbstractFlow draws them" — "we have access to the data sent, so we know exactly the context".
3. An (i) affordance with a themed mouseover: title/task + automation parameters.
4. "waiting" with no object "is not actionable neither by a human nor an AI": be explicit; structure hints, badges and actions.
5. Show what is happening on a runtime/gateway: which agents work and on what; which wait and why (trigger? schedule? user gating? an ongoing task first?).
6. Observability of agents (context/memory, workflows, states) and of entities with the deep memory system: access and query their memories and states.
7. Question the context and work of agents and entities.
8. "Free to redesign it entirely."

Evidence base: live gateway 0.13.1 on :8080 (read-only GETs, 2026-10-13 23:00–23:50 UTC) and code (GW = abstractgateway/src/abstractgateway/, RT = abstractruntime/src/abstractruntime/, OBS = abstractobserver/src/).

## Current code reality (why the Board reads the way it does)

| # | Symptom | Cause |
|---|---|---|
| 1 | Title = `basic-agent@0.0.5`, identity = `db0805…89b8fc` | `board_card()` titles with `workflow_short(workflow_id)` (OBS ui/mission_control.tsx:741). Run rows are index projections (GW routes/gateway.py:9771-9817) and carry no task, prompt, title or excerpt; vars are never returned (GW service.py:1395, gateway.py:9634). |
| 2 | `waiting`, nothing else | The client computes six wait kinds and a label (`runtime_wait_kind`, OBS ui/runtime_activity.ts:100-131), stores both on the card, and prints the label only inside `is_review` (mission_control.tsx:798). |
| 3 | What those two cards were | Occurrences #4/#5 `waiting {reason: subworkflow}` while their child (role `descendant`, workflow `visual_react_agent_…_node-2`) was `running`. The Automations API reads the same occurrence as **running** (`_live_status`, GW routes/automations.py:246-253: waiting only when a person is waited on). Same run, two words. |
| 4 | …and the child was not working either | Child `6defd6b2`: status `running`, ONE ledger record — `llm_call` started 23:12:51 UTC, never ended — still so at 23:50 (38 min). Its sibling the same for 43 min. Rows carry `updated_at` (= 23:12:50); the open step's `started_at` is on the ledger. Nothing on any surface says "no progress for 38 min". |
| 5 | `subrun` on an occurrence | `is_subrun = Boolean(parent_run_id)` (mission_control.tsx:291); an occurrence's parent is the controller run whose id IS the automation id (RT automations/controller.py:805-814). The tree controller → occurrence → agent child → delegate grandchild is never drawn. |
| 6 | `Automation` is a button, not an identity | The card never fetches the automation. Title, cadence, `next_fire_at`, `last_occurrence`, `occurrence_count`, `current_occurrence`, `attention`, and the whole definition (task, tools, model, context mode, policy) come back from ONE call, `GET /automations/{id}` (GW routes/automations.py:303-356, 748-755). |
| 7 | Paused runs look like questions | Rows hard-code `paused: False` (gateway.py:9781-9785); a paused run's row is `{reason: user}` (live `6e43339d`: detail `wait_key pause:…`, `details.kind pause`) — indistinguishable from an ask_user or a tool approval on rows; the classifier files it as *user response* (runtime_activity.ts:109). |
| 8 | Approvals on rows read as "user response" | Rows reduce `waiting` to `{reason, until}` because the runtime index memoizes only `wait_reason`/`wait_until` (RT storage/json_files.py:241-263); approval detection needs `details.tool_calls` (detail only, service.py:1540-1549). |
| 9 | Board stalls / stale data age | The board polls THREE listings every 5 s (OBS ui/app.tsx:1209-1212: roots 200 + all 500 + archived 200, `include_metrics`) and aborts at 30 s (OBS lib/gateway_client.ts:335). Measured per-request wall time for the SAME query (`runs?limit=200&root_only=true`) over 30 min: 46.5 s, then 4.3 s, then 0.29 s (adversary's read); `status=running` (2 rows) 3.9 s in the 4 s window. The cost is a FIXED per-request overhead that varies with gateway busyness (the window coincided with the two open local-provider `llm_call` steps of row 4), not per-row work. Per-row costs that do exist: `ledger_len` line-counts each listed ledger (json_files.py:1521-1532); `include_metrics` parses the FULL ledgers of each subtree (GW run_metrics.py:60-80; ledgers reach 64 MB here); `/automations` summaries walk every descendant of each controller (RT automations/attention.py:216-238). |

Conclusion: the card design is wrong AND the wire under it is too thin for the card the operator wants. Today's wire supports most of the asked card (title/last/next/turns/parameters via the automation detail; state sentences via rows + client-side tree join); the rest is index fields the runtime owns.

## Problem or opportunity

The Observer shows runs, not agents. It cannot say what a run is for, who it belongs to, what it is waiting on, or whether a "running" agent has made progress. Entities get a phase tile. Nothing can be questioned except one run's ledger. The operator wants an observability tool for agents, automations and entities: what they are doing, on what, why they wait, what they know, and a way to ask.

## Proposed direction

### Principles

- P1 **Subject first.** The unit is a subject — an *agent* (a session's or an occurrence's run tree), an *automation* (a schedule and its occurrences), an *entity* (a persistent life). Runs are evidence under a subject.
- P2 **Every card answers WHAT · WHO/WHERE · WHY-NOW**, in that order. Identifiers never take a line.
- P3 **A state is a sentence with an object and an actor.** The bare word `waiting` is forbidden. `waiting for <object>` + who ends it (**you** · **run X** · **the clock** · **external** · **unknown**) + the one action that follows.
- P4 **Columns group by blocker**, not by status word.
- P5 **One truth per run.** Board and Automations page use the gateway's reading (automations.py:246-253): a parent parked on its OWN child is *working* — **conditioned on the child's own liveness** (a parent of a stalled child is stalled).
- P6 **Progress is data, shown always.** A running card always shows the age of its last ledger touch and the open step's name and age ("running · llm_call open 38m"). No "stalled" word is inferred; the column sorts stale-first so stalls float. The attention mark's threshold is a visible user setting (default 5 min), shown on the card's tooltip.
- P7 **Honesty survives.** Wire truth only (status + wait object + automation record + ledger + card); no prose heuristics; data age visible; partial renders as partial.
- P8 **Progressive, not hidden.** Hover/(i) = the brief; click = the subject page; the card is understandable alone.
- P9 **Question everything.** Ask on every subject (run tree, automation history, entity memory), window stated.
- P10 **Cheap to watch.** The poll path carries no metrics and no ledger folds; everything per-card is lazy and cached.

### Vocabulary (the sharable identity)

⟳ automation · ◉ agent (session) · ☗ entity · ▭ plain workflow run — same glyph, colour token and pill on every page; kit components `AfSubjectMark` and `AfStateLine` so AbstractCode / Assistant / console draw the same mark.

### Pages

```
Now          the board — Needs you · Working · Waiting on… · Scheduled · Done
Agents       subjects (sessions, occurrences) → Agent page
Automations  today's page, same card vocabulary; detail: parameters as pins, occurrence timeline, totals, Discuss
Entities     tiles → Entity page: now, card sections, memory timeline, (search, Ask when the wire allows)
Workflows    definitions with input/output pins; Launch and Automate are actions here
Runtime      what is loaded (providers/models/GPU), activity, artifacts, KG query, logs (today's System)
```

### Now (the board)

| Column | Membership (row fields only) | Verb line |
|---|---|---|
| **Needs you** | `waiting.reason ∈ {user}` on any run of the tree, or detail-confirmed approval | `reason=user` rows render "needs you — question, approval or pause: opening…" and resolve on first paint with ONE detail call per such card (bounded, cached by run_id + updated_at); then "needs your approval: web_search, send_email" / "asks: <prompt>" / "paused by <actor>" + Approve / Deny / Answer / Resume inline |
| **Working** | status `running`; or `waiting subworkflow` whose child row is `running` (P5) | "running · <node> · <open step> open <age>" / "running subrun <child title> · <child's own line>" — stale-first sort, attention mark per P6 |
| **Waiting on…** | `waiting event` (external, incl. controller-less `on_event` waits), `job` (delegated tool), `until` (clock, any distance), `subworkflow` whose child row is itself waiting (the child's own sentence, read from the child's row — never from the parent's park-time `details.sub_waiting` snapshot, RT core/runtime.py:4880-4902), or unclassifiable | "waiting for event · 23m · external" / "sleeps until 02:00 UTC (in 1h 12m) · clock" / "waiting for subrun X: <X's sentence>" / "waiting, reason unknown · Inspect" |
| **Scheduled** | automation controllers (`session_kind=automation`, `role=controller`, `waiting {reason: event, until}` = the wake wait, controller.py:14-16), legacy schedules, drafts | "next in 1h 12m · every 24h · last #4 completed 9m5s · 5 turns" |
| **Done** | terminal, time-windowed (today's rule) | "completed in 9m5s · 88,888 tk" / "failed: <error excerpt>" / "cancelled" |

Header subtitles become blocker sentences: *only you can move these* · *an agent is on it* · *something else must happen first* · *will start by itself* · *read the outcome*.

### Card anatomy (one skeleton, every column, every page)

```
┌────────────────────────────────────────────────────────────────────┐
│ ⟳ Daily international political & economic digest       ● running  │  WHAT · state pill (one word, one colour map)
│   Nightly digest · occurrence #5 · basic-agent 0.0.5          (i)  │  WHO: automation title (or session), workflow secondary
│   running subrun react loop · llm_call open 38m · ⚠                │  WHY-NOW: object · open step · age · actor · [action]
│   23m54s · 54,205 tk · 14 tools · 2 subruns                   ⧉    │  metrics (lazy) · copy run id
└────────────────────────────────────────────────────────────────────┘
```

- **Title source order** (labelled by source in the (i); never inferred): (a) automation `definition.title` for occurrences and discussions; (b) the row's `brief.title` when the wire has one (W1); (c) for plain runs only, the `prompt` from `GET /runs/{id}/input_data`, 80 chars, lazily once per run (immutable, cached) — occurrence prompts carry a `[Trigger …]` framing header and are never excerpted; (d) `workflow_id`, visibly marked *untitled*.
- **Name it inline.** An automation's title can be changed today (`revise` in `capabilities`; `PATCH /automations/{id}` with `changes`, GW automations.py:815-820, 908): the (i) popover offers "Name it" for titles that equal the task's first line.
- **State pill** = one word from `run_status_word` (kept). The sentence under it carries the object; when the sentence says "running subrun", the pill says running.
- **Actor badge**: `you` (accent; the only clickable one), `run <child>` (link), `clock` (time shown), `external` (event name), `unknown` (warning + Inspect).
- **(i) popover** = kit `AfTooltip`: full task; workflow + version; occurrences: cadence, context mode + growing cap, tools, model/provider, max_iterations, tool_approval policy, notify channels, workspace (from the cached automation detail); plain runs: input pins (name = value, truncated).
- **Uuid**: never as text. ⧉ copies; the tooltip shows it.
- **Metrics line**: lazy per card (hover/open, Done only by default) — never on the poll.
- **Automation card** (Scheduled column and Automations page): WHAT = title; WHO = "every 24h · growing context (100k)"; WHY-NOW = "next in 1h 12m · last #4 completed 9m5s · 5 turns"; on open: totals (below).

### Agent page (today's Observe grows into it)

Header: title · subject mark + automation/session line · workflow · state sentence · actions (Approve/Answer/Pause/Resume/Cancel/Ask) · copy id.

1. **Can do** — model/provider, tools held, tool policy (`definition.target.input_data.model/provider/tools`, `_runtime.allowed_tools`, `policy.tool_approval/untrusted_input_tools/email_allowed_recipients`), workspace access mode: "what the agent can and cannot do", one line each.
2. **Inputs → Outputs as pins.** Start pins (`on_flow_start` outputs; abstractflow src/types/nodes.ts:43-66; `Pin {id,label,type,…}` flow.ts:113-126, colours `PIN_COLORS` flow.ts:47) with values from `GET /runs/{id}/input_data` (GW gateway.py:10044-10249 → `{pin_ids, input_data, workspace}`; live occurrence `02c4a311`: 200 in 10 ms, 13 pin ids). End pins from the flow JSON (`GET /workflows/{id}/flow`, gateway.py:8737; no output-schema endpoint exists) with values from the detail's bounded `output` when terminal; a pin-less `on_flow_end` passes `_last_output` through (RT visualflow_compiler/compiler.py:2781-2795) and renders as one untyped output. Kit `AfPinList`, read-only, same shapes as the editor (abstractflow components/pins/PinShape.tsx).
3. **Context** — `session_history` (policy, max_tokens, replayed vs dropped messages/tokens, oversize_turn_kept), `limits.tokens` (used/max/pct/warn), `flow_warnings` (all on the detail, GW service.py:1394-1556); and the CONTENT: a "latest LLM call" link into the timeline card whose expanded body is the exact request sent (OBS ui/run_steps_view.tsx; ledger `llm_call` payloads).
4. **Run tree** — controller → occurrence → children → grandchildren from `GET /runs?parent_run_id=` (GW gateway.py:9727-9762; note it ignores `root_only`/archive filters), each node with its own state sentence from its own row.
5. **Timeline** — today's cycle-grouped steps, filters, search (unchanged).
6. **Spend** — time, tokens, LLM/tool calls per node (`include_metrics` totals are tree-inclusive, gateway.py:9960-9964 — labelled so).
7. **Ask** — `POST /runs/{id}/chat` with `include_subruns: true` (GW gateway.py:3008-3042; grounded in run + descendant ledgers, 11609-11635); window note kept.

### Automations page

Rows as the card skeleton. Detail adds: **Can do** (as above), parameters as pins (target flow start pins × `definition.target.input_data`), the occurrence timeline with each occurrence's sentence, `attempts`/`failure`/`artifacts` per occurrence (`GET /automations/{id}/occurrences`, GW automations.py:948-994), **totals** = wall time from `fired_at`/`finished_at` + tokens from `GET /runs?session_id=automation:{id}&include_metrics=true` (one session-index read, RT json_files.py:1056-1062; on open only), **memory growth** = `session_history.replayed/dropped_tokens` per occurrence (one detail per occurrence, lazily, as the timeline scrolls), Discuss (kept).

### Entity page

Tile → page: **Now** (composite phase, open visit / loop day, last moment age, lifetime + live-visit spend — all on today's tile wire); **card sections** as served (abstractmemory entity_card.py:533-546 + GW entities.py:589-618: identity, age and context, current state, likes/dislikes, open questions, problems, key moments, discoveries incl. dream signals, lessons, sleep stats, warnings); **memory timeline** from `GET /entities/{name}/replay` (NDJSON; `since_seq`/`until_seq`/`families`/`enrich`, GW routes/entity_replay.py:90-125 — seq-bounded, not count-bounded: the page walks seq windows sized by a client cap) with live tail `/replay/stream` (SSE, :436), diary bodies redacted as the engine redacts them, verbatim via `/records/{graph_id}/verbatim` (:128); **memory search** and **Ask this entity's memory**: NOT POSSIBLE on today's wire (no search/recall/listing-by-kind over an entity home; `POST /kg/query`, gateway.py:14925, is the gateway's KG store with run/session/global scopes) — the page says so and offers the replay filters labelled "browse, not search" until W2. Link to the entity app for the graph (kept).

### Workflows and Runtime

Workflows: `GET /bundles` entrypoints + per-flow `input_schema` (gateway.py:8673-8734) as pins; Launch/Automate as actions. Runtime: today's System page with "what is loaded now" first; "Memory" tab renamed "KG query".

### Data contract

**W0 — Observer only, today's wire.**
- The poll (every 5 s): (a) `GET /runs?status=running&limit=200`, (b) `GET /runs?status=waiting&limit=500` — no `root_only`, no `include_metrics`, no `include_ledger_len`; controllers, occurrences and children all arrive and the tree is joined client-side by `parent_run_id`. (c) Done window: `status=completed|failed|cancelled` with `created_after` every 60 s. Archived on demand. Metrics lazy per card. Data-age chip kept; the abort stays 30 s.
- Automation detail: fetched on first sight of an `automation_id` and again only when that controller's row `updated_at` changes (never on a timer — a summary walks every descendant, RT attention.py:216-238). Cached for the session.
- Titles/excerpts: `input_data` lazily for visible plain-run cards; cached by run_id.
- `reason=user` cards: one detail call on first paint to split question / approval / pause.
- Agent and Automation pages: the calls named above, all on open.

**W1 — runtime (index) + gateway (projection): a brief on the row.** Owner: **runtime first** (index fields live in `_index_fields_of`, RT storage/json_files.py:241-263 and sqlite.py:701-733), gateway second (rows, gateway.py:9771-9817).
1. `brief {title, task_excerpt, subject {kind, id, title}}` computed at index time from `vars` — for occurrences the title must be stamped INTO the child's vars at dispatch (RT controller.py:746-766), since the index sees only vars. 160-char excerpt, no NLP. Absent ⇒ W0 fallback.
2. Row `waiting` gains `wait_key`, `details.kind`/`mode`, `details.sub_run_id`, `details.tool_calls[].name`, `prompt` (bounded); row `paused`, `current_node`, `error` from the index. Fixes rows 7–8.
3. Liveness: `ticked_at` (last host tick) on rows, so "running with an open step for 38 min" and "orphaned by a gateway restart" (the runtime dir shows three restarts) are told apart. A `since` on the wait is a nicety (the park write already sets `updated_at`).
4. Performance: hand the gateway seat the reproduction — same query 0.29 s / 4.3 s / 46.5 s within 30 min, `status=running` (2 rows) 3.9 s — with the ask to capture gateway CPU and provider state; the Observer's own mitigation is W0's metric-free poll. No fleet SSE stream is asked for while active listings answer sub-second when idle (revisit after the measurement).

**W2 — gateway + memory: entity memory access.** `GET /entities/{name}/records?kind=&since=&q=&limit=` (kinds per abstractmemory records.py:65-98; `q` = hybrid search once root 1015 lands, filters before); `POST /entities/{name}/ask` — grounded Q&A over card + a bounded replay window, same response shape as `/runs/{id}/chat`, window stated.

**W3 — kit.** `AfSubjectMark`, `AfStateLine`, `AfPinList` (pin colours moved from abstractflow into the kit so Flow and Observer draw the same pin). `AfTooltip` exists (ui-kit 0.8.5).

### Delivery plan

| Wave | Scope | Owner | Size | Gate |
|---|---|---|---|---|
| 1 | Board on today's wire: blocker columns, state sentences with object + actor, P5 with the liveness guard and P6 ages, subject-first title with automation join + copy id, metric-free active poll (W0), Scheduled column from controllers, automation card fields (last/next/turns) | observer | 3–4 d (two-day cut: drop the (i) parameter popover beyond title/cadence/next/last, lazy excerpts for plain runs, the Done-window change) | vitest: one case per wait kind × column (6×5), paused run, stalled running run (open step > threshold), controller in Scheduled, two-truths check (board word == Automations word for the same run); skew: rows with `waiting: null` from 0.13.1; p95 poll wall time on the 10k-run store with two active agents, reported not gated |
| 2 | W1 (runtime index fields + gateway rows); Observer consumes with fallback | runtime (2–3 d) → gateway (1–2 d) → observer (2 d) | 5–7 d | skew matrix: runtime-old/gateway-new, gateway-old/observer-new; a paused and an approval wait classified from rows alone |
| 3 | Agent page (Can do, pins, context, tree, spend, Ask) + Automations detail (pins, timeline, totals, memory growth) + Workflows page; `AfPinList` | observer (+ kit) | 5–6 d | basic-agent 0.0.5 pins: 13 start pins with live values and the end pins as the flow JSON declares them; tree shows controller→occurrence→child→grandchild on a delegate_agent run |
| 4 | Entity page on today's wire (card + replay timeline + live tail); W2 endpoints; search + Ask once they land | observer (3 d) + gateway/memory (4–5 d) | 7–8 d | replay seq-window paging + SSE `Last-Event-ID` resume; `records?kind=lesson` count == card's lessons total; Ask cites records |
| 5 | Runtime page reorder; app.tsx split and token unification (the 2026-07-12 rethink's open P0/P1) | observer | 3 d | styles test; no page code left in app.tsx |

Order: wave 1 removes the three visible complaints (title, waiting-on-what, automation identity) and the hidden one (stalled agents shown green) with no cross-seat dependency; wave 2 is the smallest runtime/gateway change that makes it complete; 3–5 deliver the agents/entities/workflows promise.

## Why it might matter

The Board is the landing page of the one tool meant to answer "what are my agents doing and does anything need me". Today it answers neither (rows 1–4 above), and it polls in a way that can stall under the exact load it exists to watch (row 9).

## Decisions for the operator

- D1 **Titles at creation.** The Automate form's Title field defaults to the task's first line (OBS ui/automate_form.tsx:211, placeholder "Defaults to the task's first line") — hence titles that are truncated prompts. Options: keep + "Name it" inline (exists via `revise`), or add an opt-in model-written title at creation (one LLM call, stored, editable). No display-time heuristics either way.
- D2 **Column names**: Needs you / Working / Waiting on… / Scheduled / Done.
- D3 **Observer vs entity app**: Observer = observe + browse + ask; entity app = graph + visits.
- D4 **W2 sequencing**: after root 1015 (hybrid search) or filters-only first.
- D5 **Stall threshold default** (P6): 5 min, a user setting; and whether `ticked_at` (W1.3) is asked of the runtime now.

## Promotion criteria
- Operator answers D1–D5 (D2 and D5 can default); then wave 1 moves to `planned/` as its own item with the two-day cut as the first slice.

## Validation ideas
- The gates per wave above; plus a Chromium walk on a scratch gateway seeded with: a parked occurrence with a running child, a stalled child (open `llm_call`), a paused run, an approval wait, a sleeping controller — every card must state its object and actor, and no card may read `waiting` alone.

## Non-goals
- No replacement of the entity app's graph; no drag-and-drop; no new runtime semantics (the Observer renders, never decides); no regex/NLP on prose; no per-card detail calls on the 5 s poll path; no fleet SSE stream in this item.

## Asks to other seats (facts with reproduction)
- **gateway**: fixed per-request listing cost varying 0.29 s → 4.3 s → 46.5 s within 30 min for `GET /runs?limit=200&root_only=true`; `status=running` with 2 rows 3.9 s in the same window; `GET /automations?limit=5` > 60 s twice in that window, 0.75 s later. Coincided with two local-provider `llm_call` steps open for 30+ min. Please capture CPU and provider state under that condition.
- **runtime**: W1.1–1.3 (index fields; occurrence title stamped into child vars at dispatch; `ticked_at`). Also: `GET /runs?parent_run_id=` ignores `root_only`/archive filters (gateway.py:9727-9762) — document or fix.
- **agent/runtime**: two agent children with ONE open `llm_call` step for 38 and 43 min on the `mlx` provider (Jundot/Qwen3.8-27B) — stalled or orphaned; nothing surfaces it today.
- **memory/gateway**: W2 endpoints.

## Progress (2026-10-14)

Built, uncommitted in this repo (the operator checkpoints the nested repos themselves): wave 1 (the Board on today's wire) and wave 3's Observer-only part (the Agent view). Suite 497/497, `tsc` clean, `npm run build` clean. Design v1 + adversarial review `untracked/redesign/{DESIGN-v1,ADVERSARY-1}.md`; lane reports `LANE-A.md` / `LANE-B.md`; the merged-build gate `GATE-1.md` (0 P0 / 7 P1 / 11 P2, GO-with-fixes — P1s 1–7 fixed except 7, see follow-ups); read-only Chromium walks against the live gateway with screenshots under `untracked/redesign/captures2/` (board desktop/phone, (i) popover, Agent view desktop/phone; no uuid as text, no bare "waiting", zero horizontal overflow at 400 px).

What landed: `src/ui/state_line.ts` (+ tests) · `src/ui/board_data.ts` (+ tests) · `src/ui/mission_control.tsx` rewritten board half + `board.css` · `src/ui/agent_page.tsx`, `agent_facts.ts`, `pins.tsx`, `pin_palette.ts`, `agent_page.css` (+ tests, fixtures under `src/ui/__fixtures__/`) · `app.tsx` (the poll, the board site, the Agent tab and its on-open fetches, the wait modal kept off the Agent view) · `automations.ts` rows keep `is_draft`/`pause_reason` · README, docs/architecture, docs/getting-started, docs/automations, CHANGELOG Unreleased, llms-full regenerated.

Not built (by decision or scope): wave 2 (runtime index fields + gateway rows; the operator asked for an explanation before any change there); the Automations detail (pins, timeline, totals) and the Workflows page; the Entity page (wave 4); kit promotion of `AfSubjectMark` / `AfStateLine` / `AfPinList` (the pin palette is a verbatim mirror in `pin_palette.ts`).

Also fixed on the way (operator 2026-10-14 08:06): the Ledger page did not scroll inside the run panel, so a long outcome expanded with More had no way back to Less; `.rs_page` and `.ap_page` are now the panel's scrolling children (styles test pins it; Chromium check `untracked/redesign/walk_scroll.mjs`).

Operator feedback 2026-10-14 11:11–11:15 (second round): (a) no "…" anywhere — every field complete, collapsible by size, copy-on-hover on every field; (b) the Agent view must describe the agent running an automation: who it is, what it has access to, what it does, for how long, what it may do after — surfaced from the ledger (used), the run's inputs, the flow defaults, the automation definition; (c) the Flow tab must say ongoing vs finished, highlight the current node in AbstractFlow's vocabulary, and expose each node's state/context/results/tool calls on hover with copy, useful to humans and AIs; (d) Launch becomes a modal opened from "+ New automation" (done the same day); (e) "the artifact page also has to be redesigned" — see follow-up 9.

Second round built 2026-10-14 (uncommitted; suite 565/565, tsc + build clean): (a) one value component, no "…", copy on every field (lane C, `untracked/redesign/LANE-C.md`); (b) the Agent profile with sourced rows (lane C; `llm_detail` fixed to read provider/model from the request as sent); (c) the Flow tab banner, node status rings, hover facts with copies, Copy run state (lane D, `LANE-D.md`); (d) Launch as a modal. Captures: `untracked/redesign/captures_agent_profile/`, `captures_flow/`, `captures_launch/`.

Third round built 2026-10-14 (uncommitted; suite 582/582, tsc + build clean): board polish per the operator's six screenshots (lane E, `untracked/redesign/LANE-E.md`; captures `captures3/`). Gateway asks recorded: owner/requester on run rows (see `REQUESTER-proposal.md` + `REQUESTER-adversary.md`, decision pending), `tokens_in`/`tokens_out` on metrics rows.

## Follow-ups (from GATE-1 and the live walks)

1. P1-7 (GATE-1): when the `status=running` listing is truncated (≥ RUNNING_LIMIT rows), say so on the data-age chip and card a parent whose child is out of page as unresolved.
2. P2-8/16: the legacy Observe run header (above the tabs) still prints the run uuid chip and the raw wait_key; fold it into the Agent header. Pass the board's pulses to the Agent header so it shows the open step.
3. P2-12: the Observe navigator still prints bare `waiting` pills (`run_panels.tsx`) and no longer carries terminal children (the 500-row all-statuses listing is gone): give it the state sentence and a terminal-children source.
4. P2-14/15: seed the phone-layout test with a Needs-you row and a controller; the (i) popover portal needs focus management (Tab, onFocus).
5. P2-9/10: `include_ledger_len` still rides the 5 s tick (needed for pulses; 0.117 vs 0.105 s live) — decide; the browser's 6-slot budget under a slow gateway (pool 3 + tick 2 + sweep 2) — pool 2 or no pulses while a sweep is in flight.
6. Nested sentences quote generated workflow ids (`visual_react_agent_<bundle>_<ver>_<flow>_<node>`); a mechanical short form for the runtime's generated ids (not prose) would read better.
7. Kit asks: the Automations page's occurrence word is a bare `waiting` for a human wait (`panel_core.js:399`), and `Active` where the board says `scheduled`; the shared marks (`AfSubjectMark`, `AfStateLine`, `AfPinList`).
8. Gateway/runtime asks (new, from lane B): `GET /workflows/{bundle@ver:flow}/flow` returns 500 for every bundle workflow (`routes/gateway.py:8777` calls `get_bundle_flow` with the request as the bundle id); `GET /runs/{id}/input_data` returns the run's CURRENT vars, not its start inputs (the page says so); an occurrence's `workspace_access_mode` differs from its automation's definition (`all_except_ignored` vs `workspace_only`) — intended?
9. **Artifact explorer redesign** (operator 2026-10-14 11:14: "the artifact page also has to be redesigned"). Direction, to be designed before building: subject-first like the board — artifacts grouped by the run/automation/entity that produced them, each card title = the artifact's human title (never `vars._temp.agent…` paths unless no title exists, then marked), kind glyph + size + age, the producing step linked into the Agent view's timeline; one preview pane that renders markdown/JSON/images/audio in place with the same no-truncation + copy rules as the pins; filters as chips (kind, run, session, time window) instead of three stacked bars; the "legacy inferred" provenance pill explained in the (i). The current page (`runtime_page.tsx` Artifacts mode) stays until that design is reviewed.

10. **Gateway/runtime asks from the cancel-all incident** (operator 2026-10-16 01:04, "there are still 10 items?"; adversary report `untracked/redesign/CANCEL-ALL-adversary.md`). The gateway runner cascades a cancel DOWN (`runner.py` `_apply_run_control(..., apply_to_tree=True)` + `_list_descendant_run_ids`) but nothing cascades UP: a child cancelled on its own resumes its parent with `{success: false, cancelled: true}` and the parent proceeds (`core/runtime.py` ~4905; runner `_resume_subworkflow_parents`), so multi-agent parents delegate again. The board now sends one cancel per task root it can see in its capped, polled listings (`cancel_targets`). Asks: (a) a runtime guard that refuses to start a subworkflow under a terminal parent (adversary P1-3: a tick past the store probe can still spawn an orphan child); (b) a server-side `cancel_task` that resolves the root below the controller itself, so a parent beyond the listing cap is never missed; (c) uvicorn access logging (or audit rows for GETs) so a request storm is observable — the audit log held 9 GET rows of 85,883 and "159 refreshes" had to be derived from code; (d) the listing's per-request cost (globs + stats every run file in the runner's process) is what turned 53 cancels into a 10 s apply latency.
11. **Gateway ask — parents never resumed after their subrun was cancelled** (operator 2026-10-16 01:31, four 77-day-old multiagent-coding@0.0.13/0.0.14 parents still `waiting subworkflow:<id>` where `GET /runs/<id>` is `cancelled` since 22:52 UTC). The runner resumes a parent when a child ends through its own tick (`_resume_subworkflow_parents`), but a child cancelled by command/cascade whose parent's workflow version is no longer installed (`/runs/{root}/input_data` → `pin_ids: []`) is never resumed: the parent is parked for good. The board now says **stuck** and puts it in Needs you with Cancel; the fix belongs to the gateway (resume-or-fail the parent when its child reaches a terminal state through ANY path, and a sweep for parents whose `details.sub_run_id` is terminal).
12. **Next wave — the task card (chain inside the card)**, proposed 2026-10-16 01:31 by the operator ("we should be handling sessions (runs)… see their subsessions… see the parent… cancel either") and reviewed by the design adversary (`untracked/redesign/TREE-CARD-adversary.md`, GO on the direction, not as first drawn). One card per task ROOT (parent-less run or automation occurrence) in the lane of its deepest live blocker (precedence Needs you > Working > Waiting on); the card: the root's task text as title, who/where it came from and its age; the CHAIN as indented rows root → leaf — workflow short name, that run's own state words (never the child's sentence recursed), its age, ✕ per row whose words carry the upward consequence ("stop this subrun only; its parent continues and may delegate again"); the leaf's ASK block(s) inline, one per asking child ("builder asks …"); a stuck band "Only Cancel task moves this."; footer Open in Code · ✕ Cancel task · ⧉ · (i); lane pill = tasks, tooltip "N tasks · M asks". Today's scale: 13 active runs, 8 roots, depth ≤ 2, no parent with two live children. Size: a day (build_board regrouping by root, the chain rows, tests, captures at 1440 and 400 px). Gateway asks that go with it: serve `Runtime.list_stalled_waits` (runtime.py ~1102) and a `cancel_task` command (see 10, 11). BUILT 2026-10-16 02:30 after the operator's go (uncommitted; `build_board` groups by task root, `ChainBlock`/`ChainRowView`, tests retargeted, harness captures under `untracked/redesign/lane_h/shots/task_*.png`). Not built: terminal siblings in the chain; the gateway asks (`cancel_task`, stalled-waits) stay open.
13. **Gateway/runtime ask — the runs listing is O(store) and GIL-convoyed** (adversary `untracked/redesign/ABORT-AND-SPEED-adversary.md`, measured 2026-10-16 02:30). Every `GET /runs` globs and `stat()`s all 10,678 run files (`abstractruntime/storage/json_files.py` ~1064-1077); each stat drops the GIL, so the scan convoys behind any CPU-bound thread: alone 0.09–0.19 s, two concurrent 2.9 s each, eight 9.9 s, beside one busy thread (a generating model) 67–147 s — yesterday's 120 s listings. Observer-side mitigations shipped (persisted last board, one refresh per cancel batch, no archived scan when none exist). The fix is server-side, in order: **G1** (~3 h with tests) an in-memory ACTIVE index on the `_event_wait_index` pattern (`json_files.py:109-127`, maintained at `:565-576` and the journal path `:539-563`), consulted by `list_run_index`/`list_runs` for `status ∈ {running, waiting}` and verified per candidate with `_scan_fields` → ~11 stats ≈ 55 ms under any load; **G2** (30 min) single-flight + 1–2 s TTL per (principal, query) at `routes/gateway.py:10620`; **G3** (5 min) return the empty page at `routes/gateway.py:~10253` when `archived_only` and no archived sessions. Not started: the operator rules on gateway/runtime changes first.
