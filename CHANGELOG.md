# Changelog

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

## 2026-07-23 — Tool-tiers cycle 3: risk labels marked as INFERRED (render honesty now)

Until tools carry declared risk tiers (the converged two-axis design),
`tool_risk_labels` is an argument-regex guess — the defeatable-parser
class. Both approval-prompt render sites (run modal, runtime ops
console) now mark the labels inferred: a `~` suffix + the
`TOOL_RISK_INFERRED_TITLE` tooltip naming the mechanism and its
replacement path. When declared tiers ship on the grant API, the
declared-first render replaces this and the regex demotes to a labeled
legacy fallback. 116 tests green.

## 2026-07-22 — ui-rethink P1 slice 4a: run workspace panels extracted (adversary-verified)

Six satellite components moved verbatim to `src/ui/run_panels.tsx`
(AskForm, WorkflowRunNavigator, RunOverviewPanel with its internal
FolderGlyph + HumanTimelinePanel, LedgerCard); shared view types
re-homed (`UiLogItem` + `LatestRunSummary` → ledger_views;
`RunFilterMode`/`RunTreeRow`/`RunTreeSection` → run_status). app.tsx
7,660 → 6,814 (**9,980 → 6,814 across the four slices — 32% off the
monolith**).

- **Adversary verdict (mandated pass)**: all six bodies + three type
  defs byte-verbatim vs HEAD incl. LedgerCard's EOF tail; nothing
  lost/duplicated; graph acyclic. No P0. P1 folded: the FolderGlyph and
  LedgerCard doc comments had NOT traveled (stranded as orphan debris at
  app.tsx EOF — including live cross-package context, the pending uic
  folder-icon ask); re-attached above their functions. P2s folded:
  header names all six accurately; HumanTimelinePanel + FolderGlyph
  de-exported (internal to RunOverviewPanel — export advertised a public
  surface nobody used).
- No new pins by DESIGN: all six are JSX components, the repo has no
  render harness, and the only pin-worthy logic inside is closure-bound
  (extracting it would break the verbatim contract) — the slice-3
  adversary's consistency precedent applied.
- 116 tests green; tsc + build clean.

## 2026-07-21 — ui-rethink P1 slice 3: runtime page + shared folds extracted (adversary-verified)

Operator-approved continuation (c3890: "continue its own refactoring with
1 adversarial sub agent"). Four verbatim sub-moves; app.tsx 9,466 → 7,660
(2,320 total off the monolith tonight):

- `run_labels.tsx` — run/wait labeling + `RunStatusPill` (the words and
  pills every surface renders, one vocabulary).
- `ledger_views.ts` — ledger-record folds (`ProviderActivity`, response
  ladder, provider-activity fold).
- `artifact_previews.tsx` — the preview component stack (glyph, HTML
  tree/source, markdown/structured text, embedded-preview switch).
- `runtime_page.tsx` — `RuntimeActivityConsole` + `RuntimeExplorerPage`
  (1,211 lines) over props; all state stays in App.
- `artifact_with_runtime_context`/`artifact_display_type_label_for`
  joined `artifacts.ts` (they need `run_workflow_label`).
- **Adversary verdict (mandated fable5 pass)**: verbatim VERIFIED (26
  defs + the full 1,126-line component block diffed against HEAD),
  nothing lost (96 cumulative defs, each in exactly one module, zero
  duplicates), import graph acyclic. No P0. P1 folded: 4 load-bearing
  folds pinned (`tool_risk_labels`, `wait_blocker_title`/`_expected_action`,
  `build_provider_activities_from_ledger`, `extract_response_text_from_record`
  — whose ladder is response > answer > message > text > content, pinned
  as-is). P2s: artifacts.ts header updated; `is_condensed_ledger_item`
  stays in app.tsx as a STATED decision (coupled to the app-local
  `UiLogItem` shape); `runtime_metadata_chip_entries` deferred to the
  observe-page slice.
- 116 tests green; tsc + build clean.

## 2026-07-21 — ui-rethink P1 step 1: format.ts extraction (one time/format fold)

First slice of "dissolve app.tsx" (backlog 2026-07-12, P1): the pure
format/time helpers moved verbatim to `src/ui/format.ts` (20 functions;
app.tsx 9,980 → 9,829 lines) with their own test file.

- **Real drift killed, not just moved**: `runtime_activity.ts` carried a
  private `parse_iso_ms` WITHOUT the microsecond clamp app.tsx's copy
  had (`.123456Z` backends) — a waiting run's age could read "—" on one
  surface and a real age on another. runtime_activity now imports +
  re-exports from format.ts (consumers keep their import path).
- Run-clock helpers (`run_started_at`/`run_finished_at`/
  `run_duration_ms`/`run_duration_label`) take a minimal structural
  `RunClockFields` type — RunSummary and RuntimeActivityRun both
  satisfy it, no cast churn.
- Verbatim-move discipline: `number_or_null`'s Number() coercion quirk
  (null → 0) and `short_id`'s keep-1 slice preserved and pinned —
  extraction is not the moment for behavior changes.
- 6 new pins in `format.test.ts` (107 total green); build clean.

## 2026-07-21 — ui-rethink P1 step 2: artifacts.ts extraction

Second slice: the artifact wire-shape fold moved verbatim to
`src/ui/artifacts.ts` (24 functions + the `RuntimeArtifact` type family;
app.tsx 9,829 → 9,466 lines — 514 total off the monolith).

- `normalize_artifact_item` + friends: envelope v1 / legacy nested refs /
  tag bags fold into ONE RuntimeArtifact shape; labels, grouping keys,
  filter/sort param builders ride along. `artifact_with_runtime_context`
  and `artifact_display_type_label_for` stay in app.tsx (they need the
  app-level `run_workflow_label`).
- New pin worth its line: an envelope WITHOUT an explicit modality field
  degrades to "artifact" while the content-type fold lands on
  `render_kind` — the inference reads flat/legacy shapes only. Pinned
  as-is (verbatim discipline), flagged as a candidate behavior question
  for the panels rework, not silently "fixed".
- 4 new test groups in `artifacts.test.ts`; 111 total green; build clean.

## 2026-07-20 — Board night signals: wave-5 dreams brief on the tile (memory c3725)

The entity card gained `discoveries.dreams_signals_brief` = {count,
kinds, felt_tones} folded over STANDING signal-carrying dreams (memory's
wave-5 lane (a)); the board tile now renders it.

- `extract_dreams_brief()` reads the brief render-when-present: absent =
  pre-signal store, renders NOTHING (never a fabricated zero). Count
  must be a positive integer; kinds/tones must be strings (version-skew
  rows like `{kind, count}` drop, never `[object Object]`).
- Hints badge gains "night: N dreams" — the prefix carries the
  distinction from the entity's dream TOTAL (adversary P1). Expanded
  panel gets a factual one-liner: kinds (sliced at 6 + "+N more" — the
  per-dream <=12 bound does NOT bound the union across dreams) and
  "felt: <tones>" as WORDS — feelings color content, never rank it; no
  meter, nothing clickable (the stream's depth lives in the entity app).
- 7 new extractor pins incl. junk shapes; 101 tests green.
- **Unit correction (same day, live-verified)**: the brief's `count`
  counts SIGNALS, not dreams — engine fold increments per signal entry
  (`entity_card.py`), and the live wire served 24 = 12+12 across two
  standing dreams while the store held exactly two signal-carrying dream
  rows. Badge now reads "night: N signals". Caught by the store-side
  read on Ephemeral's first signal night — the render and measurement
  lanes verifying each other, as designed.
- **c3810 fold (same hour)**: memory pinned the unit structurally
  (`unit:"signals"` + `dreams:N` on the brief; `signals_omitted` on the
  dream record). Board consumes `dreams:N` — the panel line reads
  "night: 24 signals across 2 dreams" when the field rides (tolerant,
  null on pre-fix briefs). The cap's selection is now visible to the
  instrument: `signals_omitted` = what the night carried beyond the
  quota seats.

## 2026-07-20 — One-graph consumer: board derives phase vocabulary from the wire (laurent dm#79)

The board now consumes THE entity phase graph from the gateway-vendored
artifact (`GET /entities/spec/phases`, payload `{spec, vendored, sha256,
source}`) instead of a hand-written copy — sync-by-mechanism.

- `derive_phase_graph()` extracts phase words, spoken synonyms
  (separator-normalized: own_time/own-time/"own time" are one synonym),
  and the settling default from the wire; junk payloads (arrays, empty,
  no sleep phase) derive nothing and the labeled pre-wire fallback
  applies — never a blank board.
- `entity_phase(state, graph)` maps by artifact synonyms first, then the
  documented v7 mode roles: visiting decides visit; dreaming decorates
  asleep; **resting = inside personal** (the v6-era rest→sleep fold was
  wrong — corrected after entity's v7 bump documented the roles, owned
  at c3613). A transition cause leaking onto the state channel
  (`no_task`) passes through under "other" rather than claiming a phase
  (the inversion fixed on BOTH paths).
- Chip honesty generalized: the tooltip carries the raw wire word
  whenever the fold changed it; the settling badge derives from the
  graph's own initial, never a hardcoded destination.
- The sha promise implemented: last-seen `{sha256, version}` persists
  per browser; served bytes changing WITHOUT a version bump logs a loud
  drift entry. Non-404 fetch failures log a labeled `#FALLBACK` note
  (pre-wire 404 stays silent — that deployment is normal).
- A graph word without an `mc_phase_*` style renders under the bounded
  "other" class (a bumped artifact can never mint an unstyled class).
- fable5 adversary run per the standing rule: 5 P1 + 4 P2 findings all
  folded (the exact-table pin replacing a vacuous loop; the
  initial-phase fabrication guard; the drift implementation; the style
  bound; failure-class discrimination). 99/99 tests, tsc + build green.
- v8 same-day: the artifact's new machine-readable `state_mode_axis`
  block (my own consumer ask, banked at the v7 bump) is adopted —
  artifact-declared mode words (visiting/dreaming/resting) win over the
  local residue tables, target-validated at derive time (off-graph
  targets dropped). The residue tables serve only pre-v8 artifacts and
  bare-word forms. 100/100 tests.

## 2026-07-20 — AWAKE is not a dwelling (c203 fold, entity sweep c3548)

- `entity_phase()` maps bare `awake`/`idle` to **sleep** (composite
  `awake:visiting/:personal/:working` keep their suffix mapping) — the
  board's phase chip can never paint AWAKE as a phase again, per
  laurent's c203 ruling ("entities are always visit/work/personal/sleep").
  The pre-alignment passthrough branch its own comment said to delete is
  deleted; `awake` left `KNOWN_PHASE_KEYS`; the dead `.mc_phase_awake`
  style removed. Honesty kept on hover: when the wire word was the
  state-axis `awake`/`idle`, the tooltip carries "wire word: awake
  (settling)" verbatim — ruled words on the chip axis, the state axis
  readable on hover. Test pin flipped from asserting the passthrough to
  asserting the mapping. 93/93 green.

## 2026-07-19 — Board tile lessons (build-5 render twin) + evolution indicators in the instrument

- **Lessons on the entity tile**: the board's hints badge and panel now
  read the card's build-5 `lessons` section (`{lessons: briefs, total}`,
  newest-first, no open/resolved split — lessons only accumulate; the
  tile trusts the served TOTAL, a count never a ratio). Machine-formed
  lessons carry no entry_id and render as plain text per the chip
  honesty rule; elected ones with a book key open through the same
  operator diary door. Absent section (pre-build-5 gateway) renders
  nothing. This ends the "operator's window cannot render lessons"
  blindness (iteration-2 forensics build 5) on the observer board.
- **Evolution indicators I1–I3** in `scripts/entity_evidence_baseline.py`
  (adopted from the iteration-2 lived-adversary report): question/problem
  closure + verbatim-duplicate re-asks; write→read per evolved kind
  (lesson/world_model/dream) with a `--since` cohort window (append-only
  denominators never move — only the post-fix cohort can, the
  dream-digest lesson); felt-subject coverage + entity-driven closures.
  Layer-honest throughout (kind from attributes_json, selection from the
  memj_selected_counts join — the c3113 LIKE-probe error class named in
  the docstring).
- Tests: 93/93 green (lessons extractor pin added); tsc + vite build clean.

## 2026-07-17 — Board access-hint chips (G1 render half) + shared AgentCycles CSS contract

The observer half of the entity access-hint render commitment
(plans/improving-entity-capabilities.md §observer 2, folded c2613):
what an entity carries OPEN is now visible from Mission Control, and
the entity's own words are one deliberate click away.

- **Entity tile hints badge**: each board tile reads the /card
  `questions.open` / `problems.open` row briefs (the layer that carries
  `entry_id` top-level per the chip ruling c2623/c2626 — composers read
  their OWN layer, never grep). A compact badge ("2 questions · 1
  problem") expands to `AfMemoryHintChip` rows (uic kit component),
  bounded at 4+4 per tile with the true totals shown — the deep view
  stays the entity app.
- **Click = the operator diary door**: `read_entity_diary_entry` calls
  `GET /entities/{name}/diary/{entry_id}` (marker-first gateway-side).
  The modal renders the entry verbatim and states "this read was
  recorded in <entity>'s stream (seq N)" — reads disclose, the UI never
  hides that the read landed in the entity's biography. Chip rule zero
  holds: rendering never touches memory state; only a deliberate click
  does.
- **Honesty rules**: briefs without an entry_id render as plain text
  (never a dead button); absent card sections = no badge
  (render-when-present); door refusals render beside the chip.
- **Shared CSS family contract** (uic c2833 ask 1): app.tsx now imports
  `@abstractframework/monitor-flow/agent_cycles.css` beside the
  AgentCyclesPanel import — hosts import package CSS explicitly, no
  self-import exception (uic removed the self-import once all three
  consumers shipped the one-liner).
- Tests: 4 new `extract_open_briefs` pins (entry_id verbatim/absent,
  resolved rows never surface, junk tolerance, bound-with-true-total).
  92/92 green; tsc + vite build clean.

## 2026-07-15 — Launch Capabilities: run-level skills attachment (0087 lane live)

The gateway closed card 0087 end-to-end (c2442: trust-gated resolution
of `input_data.skills` into `_runtime.skills_block`, Agent-node subrun
passthrough co-verified with runtime and agent, live on :8080) — the
ship signal the Launch section was held on. Shipped:

- **Capabilities disclosure on Launch** (renders once a workflow is
  selected): the gateway's skills shelf as selectable rows feeding
  `input_data.skills`. Render rules per the ruled contract
  (skill c2372 / decision:launch-skills-selection-contract):
  attachable = selectable; requires_review = selectable with the
  verdict chip visible (the gateway HOLDS unverified at start);
  blocked = VISIBLE-BUT-REFUSED — disabled, dashed, reasons in the
  tooltip, never hidden and never silently dropped. tree_hash rides
  the tooltip; no inventory = honest absent line, never a fabricated
  list. Selection resets per workflow.
- Client shape widened: skills rows now carry tree_hash + reasons.

End-to-end acceptance (live, not assumed): started a run with
`input_data.skills=["adr"]` through the real gateway — the run store
shows `_runtime.skills_block` present (the ADR skill rendered, 326
chars) and `_runtime.skills_resolution` = requested/active ["adr"]
with the resolved tree hash. Note: tonight's gateway relaunch rotated
the registry admin token, so existing browser sessions see the
sign-in screen again (honest behavior; the static operator token
authenticates HTTP but is not a session credential).

Gates: tsc clean · 88/88 · build green · serving :3001.

## 2026-07-15 — Gateway 429 courtesy: pollers stand down during auth lockout

Operator incident (19:41, all apps showing "Too Many Requests (auth
lockout)"): the observer was part of the problem — the board polls runs
at 5s with a SELF-TUNING interval based on request DURATION, and a
locked gateway answers 429 fast, so the tuner never backed off; three
more pollers (run state 2s, subrun digest 2s, entity tiles 30s) kept
feeding the lock from every open tab. Fix: any 429/"too many requests"
from the runs heartbeat opens a shared stand-down window that ALL
pollers honor (15s → 30s → 60s → 120s doubling, reset on the first
success), logged visibly in the run log. Probe evidence posted to the
gateway seat (valid bearers and no-auth requests both 429 during
lockout; the window did not clear after 20s idle). tsc clean · 88/88 ·
build green · serving :3001.

## 2026-07-15 — Launch input fixes (space key, fonts, quoted defaults) + skills/MCP pickers

Operator round (16:22), four faults:

- **The space key "didn't work"** in Launch inputs — root cause was not
  a key handler: `update_input_data_field` TRIMMED string values on
  every keystroke of the controlled inputs, so the trailing space the
  user just typed was deleted before React re-rendered. Mid-edit
  trimming removed; whitespace hygiene moved to submit
  (`start_new_run` trims string fields once, empty-after-trim unsets).
  Verified live: "hello world with spaces" lands intact.
- **Wrong font**: every string pin (System, Prompt, model, generic
  strings) carried `className="mono"` — prose fields now speak the
  framework sans; mono remains opt-in for JSON/array editors and path
  fields (workspace root).
- **JSON quotes on defaults**: placeholders/labels rendered string pin
  defaults through the JSON inliner (`"lmstudio"`, `"qwen/…"`). String
  defaults now render bare; JSON rendering is for structured defaults
  only.
- **Skills + MCP selection**: Launch now renders `skills` and
  `mcp`/`mcp_servers` pins as MultiSelect pickers (same shape as
  Tools) fed by feature-detected gateway inventories
  (`list_skills`, new `list_mcp_servers` — probes several candidate
  endpoints, returns null when absent). Live gateway serves NEITHER
  today (probed: all 404) — the pickers render the honest "not served
  yet" line. Alignment thread posted on agora (c2233) to gateway +
  skill + flow per the operator's directive: inventory endpoints/
  shapes, and whether runs select skills/MCP via pins or a start_run
  attachment lane. The inventory probe now runs on Launch as well as
  Settings.

Gates: tsc clean · 88/88 · build green · serving :3001; live headless
verification of all three input fixes. (Also delivered this morning's
pending flow notify — the hub was down at first attempt; co-scientist
durable-artifacts ask now posted as c2231.)

## 2026-07-15 — Run workspace folder button + durable artifacts on the Story + one-line hero

Operator directives (11:11), all three shipped:

- **Folder button**: the run Story now carries a Folder action (hero +
  Artifacts panel header) that opens the run's workspace directory in
  the local file manager. Served by the observer's own cli.js
  (`POST /api/local/reveal`): loopback-only (socket-peer check — a
  remotely served observer refuses with the honest reason), directory
  existence validated, `open`/`xdg-open` with args only (never a
  shell). Gateway workspace roots are usually RELATIVE to the gateway
  process cwd; the endpoint resolves against
  `ABSTRACTOBSERVER_GATEWAY_DIR` (default: the workspace parent).
  The run's workspace root now loads with the run (from
  `/input_data`'s workspace block).
- **Durable artifacts panel**: the Story lists what the runtime
  actually recorded for the run (`/runs/{id}/artifacts`): file
  products lead; internal state offloads (`run_store_offload` /
  `node_trace_offload`) fold behind a disclosure; honest empty state
  when a run recorded nothing. Preview/Download reuse the System
  explorer's artifact machinery. Live finding on co-scientist run
  e13cae51…: its md/pdf/docx reports exist ONLY in the workspace
  folder — zero file products in the artifact store. Backlog filed in
  abstractflow (`2026-07-15_coscientist_reports_as_durable_artifacts.md`)
  asking report files to be registered as durable run artifacts; agora
  notify pending (hub down at ship time — connection refused; a
  watcher re-posts when it returns).
- **One-line run hero**: the stacked eyebrow/title/meta block spent
  three lines repeating the toolbar; now title · status chip · id chip
  · root chip left, Folder/Summarize/Run artifacts right, single row
  with ellipsized title.

Gates: tsc clean · 88/88 · build green · serving :3001. Verified
headless signed-in on the live co-scientist run: one-line hero, the
Artifacts panel showing the honest "no file products" state with 54
offloads folded + the workflow snapshot as a product row, Folder
button present; reveal endpoint verified end-to-end (resolved the
relative gateway path, opened Finder).

## 2026-07-14 — Geometry audit tool + System margin/padding root causes (operator round 4)

The operator's screenshot showed the System page still colliding. Built
a PERMANENT headless-chrome geometry audit (`scripts/geometry_audit.mjs`:
pane-intersection scan, inset-header detection, content x-bleed, ragged
rail rows, tab-strip air — every page + every System tab at 1000/1120/
1280/1560) and fixed everything it reported. Baseline: 36 issues → 0.

- **INSET-HEADER class (the "collision" look)**: four legacy rules
  padded the PANE element itself (`runtime_ops_filters` 12px,
  `runtime_ops_inspector` 12px, `artifact_filter_rail` 10px,
  `runtime_artifact_browser` 12px), so each pane_header floated 10-13px
  INSIDE the pane borders with its underline stopping short of the
  edges. Pane-level padding zeroed; header/body own the insets like
  every other pane; the queue/rail lists became the flex columns.
- **RAGGED-RAIL**: queue buttons were content-width (inline-block
  default) — "Running 0" narrow, "Scheduled/subflows 0" wide, a ragged
  left rail. Rows now fill the column with counts right-aligned; same
  for the Artifacts run rail.
- **Media-query regression (real collision at ≤1100px)**: the round-3
  grid override in system.css rode LATER in the cascade than
  styles.css's 1100px single-column fallback and silently defeated it —
  three panes crushed into slivers (audit: search input bleeding 39px
  out of its pane, one-word-per-line empty states). The fallback is
  re-asserted after the override; single column returns under 1100px.
  Rule recorded: a page layer that overrides a grid must restate the
  base sheet's media fallbacks after it.

Gates: tsc clean · 88/88 · build green · serving :3001 (bundle
verified current). Audit run post-fix: "AUDIT: clean" at all four
widths, all five pages, all four System tabs; populated-state
screenshot confirms full-width queue rails, edge-to-edge pane headers,
readable three-line run rows.

## 2026-07-14 — Layout collisions + executable-only Launch (operator round 3, headless-verified)

Three directives from live screenshots, verified with a headless-Chrome
pass (every page, two viewports, plus an automated overlap detector
that measures bounding-box intersections between panes/cards):

- **Settings panes overlapped** (Assistant pane drew over the Gateway
  pane's Advanced row; MCP text bled past the pane edge). Root cause:
  inside a scrolling page, flex was SHRINKING panes below their content
  height (`flex-shrink:1` + `min-height:0` default) and the squeezed
  pane's overflow painted over the next one. Fix at the root:
  `.page_scroll` children no longer shrink — the page grows and scrolls
  instead. Viewport-clamped layouts (Observe/System grids) are
  untouched.
- **System Activity spacing/consistency**: the three console panes
  still wore the OLD surface language (`--bg-secondary` + raw rgba
  border) under their `.pane` class — two surface systems on one
  screen. They now ride the pane recipe; queue rows ride the raised
  recipe; grid gap moved to the app rhythm (14px); the runs-pane
  header wraps instead of colliding (search shrinks, sort stays);
  header/metrics separate cleanly and metrics reflow 4→2 columns under
  1180px; inspector sections get one vertical beat; grid minimums
  relieved (180/0/280) so mid viewports don't crush the panes.
- **Launch surfaces only executable workflows**: the picker listed
  every bundle on the gateway (test, yoda, ralph, scratch flows…).
  Entrypoints now filter to those declaring an interface contract
  (`interfaces` non-empty; deprecated entrypoints dropped) — 10 of 19
  bundles on the live gateway. The FULL option list stays for run
  labels elsewhere; the connected-empty placeholder reads "(no
  executable workflows published on this gateway)".

Gates: tsc clean · 88/88 · build green · served on :3001. Headless
verification: overlap detector reports ZERO intersections on
Board/Observe/System/Launch/Settings at 1560×940 and 1180×800;
signed-in screenshots confirm the Launch dropdown carries exactly the
interface-declaring set.

## 2026-07-14 — Board window + answer-with-context + System readability (operator round 2)

Three operator directives from live screenshots, all shipped:

- **Done column scrolls + is time-windowed**: the board page no longer
  scrolls as a whole (that posture kept the column's own scrollbar from
  ever engaging) — columns are clamped to the viewport and each card
  list scrolls internally (narrow layouts fall back to page scroll).
  Terminal runs now render inside a TIME WINDOW with a quiet select in
  the Done header: 12h/24h/48h (default)/72h/7d/14d/1m/all, persisted
  per browser. The count, the failed stat, and the empty state all
  follow the window; hidden older runs are counted honestly
  ("+18 older outside last 48h") — never silently dropped. Cards
  without a parseable timestamp stay visible (hiding what we cannot
  date would lose runs). Active columns (Review/Working/Pending) are
  never windowed — a run waiting three days still needs you.
- **Answering requires context (operator: "you can't just ask me to
  answer")**: Review cards no longer offer a blind inline textarea.
  User-response waits carry the ask on the card (prompt preview, tool
  chips, waiting-since) and ONE action — "Review & answer →" — which
  opens the run and pops the full wait-context view: the workflow's
  question, session turns, run facts, recent steps leading to the
  wait, full input JSON, and the answer composer. Tool approvals keep
  inline Approve/Reject (the tool names are the context). A dismissed
  question now has a way back: the Story's wait panel gained a
  "Review & answer…" button that reopens the context modal.
- **System Activity rows were unreadable** (id/age/duration/reason
  rendered as one mashed string — the row classes had NO layout CSS at
  all): rows now have a three-line structure with middot-separated
  facts, sans-serif hierarchy, tabular numerics, ellipsized reasons;
  queue rows get right-aligned counts; the inspector head/decision
  blocks follow the shared type scale.

Tests: 88/88 (4 new Done-window pins: inside/outside, all, undated
stays visible, preset-map sync + 48h default). tsc clean, build green,
served on :3001 and verified signed-in with Playwright (scroll probe:
scrollHeight 705 vs clientHeight 429, scroll engages; the board→answer
flow lands on the question with steps and composer).

## 2026-07-14 — Usability defender pass (actionable information, five operator tasks)

Walked the five operator tasks (board triage / failed-run why / outputs
path / launch / entity glance) against the live app and fixed what failed
the user. New `src/ui/usability.css` loads LAST; markup edits stayed
surgical (display/copy only — no state, handlers, or data flow):

- **Board 3-second answer**: the health strip's micro pills became the
  board.css stat-card recipe (big tabular number over an uppercase label;
  warning/error tint only when the count demands it); data age + Refresh
  moved to the right rail. The recipe existed in board.css but no markup
  wore it.
- **Review acts in place**: review cards now show the wait's PROMPT
  (clamped, quoted) and the tool names awaiting approval — deciding no
  longer requires opening the run. A wait without a published wait_key
  renders a working "Open the run →" instead of a dead accent button
  (disabled primary/danger/success buttons also desaturate now so dead
  controls look dead).
- **Card titles name the workflow, not the hash**: `workflow_short` keeps
  the human prefix when a `bundle@ver:hash` id's tail is bare hex (cards
  titled "a8f5b5f8" where "basic-followup@dev" belonged).
- **Story leads with the outcome**: for terminal runs the Outcome panel
  (status chip + error callout + final text) renders ABOVE the metric
  row; the metric grid auto-fits to one slim row. Terminal runs with no
  captured final text get an honest panel teaching the Run artifacts
  path instead of no panel at all. "What is happening" reads "What
  happened" (with the last step as "Ended at") once a run is terminal;
  session-files empty copy stops implying more files are coming.
- **Entity tiles say they are links**: a corner ↗ (hover-brightens)
  marks the new-tab affordance; snake_case moment names de-snake for
  display (verbatim kept in the tooltip).
- **Empty-observe polish**: the toolbar states "No run selected" once
  (the body carries the instruction); the sidebar connection label wears
  mono only for the signed-in user id, not for "signed out"/"connecting…"
  prose.

Gates: tsc clean · 84/84 · build green. Screenshots: /tmp/ux2_before_*
vs /tmp/ux2_after_*.

## 2026-07-14 — Signed-in verification pass (post-refactor defect sweep)

Live Playwright pass over the served build with a real gateway session
(the transport kept killing review subagents, so the pass ran in the
foreground). Defects found on the signed-in surfaces, all fixed:

- **Observe empty state**: the toolbar's Pause/Resume·Run now·Cancel·✕
  buttons rendered disabled with no run selected (reads as broken UI) —
  actions now only exist when a run is on screen. The orphaned
  "Run: (none)" status line floating mid-panel is gone the same way
  (status bar renders only with a selected run).
- **Launch honesty**: the workflow placeholder said "(sign in to load
  workflows)" while signed in. It now distinguishes the three states:
  signed out → sign-in hint; connected+loading → "(loading workflows…)";
  connected+empty → "(no workflows published on this gateway)".
- **Hex ratchet enforced (10 → 8)**: two `var(--text-muted, #888)`
  fallback literals had crept into styles.css; since the kit token is
  always defined (guarded by its own test), the fallbacks were dropped
  instead of raising the ceiling.

Gates: tsc clean · 84/84 · build green · reserved on :3001 with a
launchd-safe detach (`start_new_session` — the nohup+disown pattern
died with the sandbox shell again, as documented in AGENTS.md).
Note: :8080 flapped during the pass (up 13:52, refused by 14:05);
reported to the gateway seat on the hub. Signed-in screenshots of all
five pages verified the new design language renders correctly.

## 2026-07-14 — COMPLETE aesthetic refactor (operator order; five-agent build)

The full look-and-feel rebuild the operator ordered at 06:11. One design
system, five layers, every page:

- **Foundation (styles.css)**: a real design language derived entirely
  from kit tokens via color-mix (all 20+ themes survive) — three-elevation
  surface system (recessed `--canvas`, floating `--pane-bg` with top-light
  gradient + layered shadows, interactive `--raised-bg`), the pane grammar
  (`.pane/.pane_header/.pane_title/.pane_count/.pane_body`), a real type
  scale (`--t-page` 17/650 · `--t-section` 13/650 · `--t-small` 12 ·
  `--t-micro` 11 uppercase for labels), one 32px button recipe with
  tactile hover, numeric metric tiles, 52px header, softened nav active,
  modal pop shadow + backdrop blur, page padding rhythm.
- **Board (board.css + mission_control.tsx)**: stat cards instead of
  pills, entity cards with name-first hierarchy, pane columns with
  independent scroll, raised run cards, one warning cue on Review.
- **Run page (observe.css + observe regions)**: navigator rail as a pane
  with comfortable run rows (accent-inset selection), flat toolbar with
  run identity, underline tabs (Story/Ledger/Flow/Ask), Story sections in
  pane grammar with a calm outcome callout, raised ledger rows with
  recessed payloads, double-scroll fix.
- **System (system.css + RuntimeExplorerPage)**: flat console header,
  underline section tabs, pane-based activity/artifacts/logs/memory,
  raised artifact rows with accent-inset selection, recessed
  preview/audit blocks. (Builder 3 died mid-edit on a transport error —
  its unclosed JSX was repaired and the layer finished in the foreground.)
- **Launch + Settings (forms.css + their regions)**: centered constrained
  pane-section forms, uppercase micro field labels, one accent primary
  per page, calm callouts.
- **De-mono discipline everywhere**: mono is for identifiers and
  payloads; UI labels/statuses/help are sans with the scale.

Gates: tsc clean · 84/84 tests · build green · served on :3001
(detached, both-port health check — :8080 was found dark at 12:32,
reported to the gateway seat; not this restart's doing).

## 2026-07-14 — Unified top-right cluster adopted (operator directive; shared through abstractuic)

The operator rejected the rendered look again and named the missing
piece: the SAME upper-right corner as AbstractFlow, shared through
abstractuic. Adopted in full this session:

- **AfTopBarActions** in the header: assistant (sparkle) → appearance
  (contrast) → the ONE Disconnect pill driven by the connection PHASE
  (never a boolean). The sidebar-footer connection *button* is deleted
  (one disconnect truth); a passive LED + principal display remains.
- **AfAppearanceDialog + useAppearanceSettings("abstractobserver")**:
  theme/font-scale/header-density move off the Settings page into the
  shared header dialog; per-app persistence with one-time migration from
  the old settings blob; theme applies synchronously at first paint (no
  flash). Settings keeps a pointer.
- **App assistant** (`src/ui/app_assistant.tsx`): AfDrawer (keep-alive,
  topOffset under the header) hosting panel-chat's AssistantPanel.
  Transport v1: one gateway basic-agent run per question on a stable
  session, grounded on this app's llms.txt (inlined `?raw` at build
  time), answer read from the run ledger, 120s timeout; swaps to the
  shared docs-qa bundle when the gateway ships it. Distinct from the run
  page's Ask tab (that one is run-ledger-grounded).
- **Screenshot eyesores fixed**: Summarize and Manage-connection off
  accent-primary (accent = brand action, not every button); launch's
  disabled button reads DISABLED (muted) with its reason under it, not
  beside; long technical run titles clamp to two lines; Story hero
  eyebrow says "Run" (it is a run, not a workflow).
- **Hosted-guard test re-pinned**: the app-server SSRF fix (socket-peer
  authority) deliberately removed Host-header 403s for loopback peers —
  the old test pinned the removed behavior; the new pin asserts the
  socket-peer contract (remote-peer half live-verified, commons c1799).

84 tests green; build clean; served detached on :3001 with both-port
health checks (the 01:25 linked-stack lesson applied).

## 2026-07-13 — REDESIGN adversary fold 3 (final gate): the status map actually reaches every surface

Adversary 3's fold-verification caught the fold-1 claim over-stating: "all
chips derive from run_status_class" was FALSE on the board (its private
`mc_status_*` palette said running=green while every Observe chip said
running=blue) and in three stragglers. Corrected:

- **Board chips ride the shared map**: `mc_status ${run_status_class(word)}`;
  the `mc_status_*` color rules are deleted; the chip family's semantic
  state rules now cover `.mc_status.<state>`; a test pins both (and pins
  that exactly ONE `.btn.success` block exists — a pre-existing SOLID
  green block later in the cascade was silently overriding the tinted
  Approve, re-shipping the white-on-green AA failure).
- **One status WORD too** (`run_status_word`): a paused run read "paused"
  on the board and "running" on Observe. Board, navigator pills, Story
  hero label, and the toolbar now fold paused identically (terminal
  states keep their word); unit pins added.
- **Toolbar wait-context chip** colors from the word (was hardcoded info
  while the identity chip said warn for the same word); **LedgerCard**'s
  private inline ternary replaced with the map.
- **Navigator rail titled "Runs"** (its rows are runs — "Workflows" was
  the same label-lie class as the renamed Memory tab); heading grammar
  aligned ("What is happening"); System→Memory scopes from the System
  page's own run selection, not Observe's (cross-page leak).
- **run_picker CSS actually deleted** this time (comment-headed blocks
  escaped the first purge's header matching); ratchets 189 rgba / 10 hex.
- Fast-follows folded same pass: Story's hero button is now **"Run
  artifacts"** landing on System→Artifacts with the run filter applied
  (outputs were an untaught two-hop); "What is happening" answers a busy
  run with its LAST STEP (node label + effect) instead of "no active
  wait" while the real answer hid in Chronology.
- Named, deliberately deferred: approve-verb prominence in the wait modal
  (disabled-primary reads as broken), Ask-tab chrome (thread management
  before conversation), error-presentation consolidation (~6 costumes +
  15 inline rgba in tsx), board/System queue vocabulary alignment,
  navigator loaded-window count honesty, fleet event feed / cost rollups
  / cross-run search (the top-3 missing views — the event feed rides
  gateway's design post per c1626).

84 tests green (was 68 at wave start); build clean.

## 2026-07-13 — REDESIGN adversary fold 1+2: honesty wave (status truth, Memory tab, launch confirmation)

Two fable5 adversaries attacked the built waves A+B. Every P0 and the
high-visibility P1s folded same-session:

- **ONE status→color map** (`src/ui/run_status.ts`, adversary 1 P0-2):
  four private maps rendered contradictory chips for the same run on one
  screen (waiting amber in the navigator, blue in the toolbar; "paused"
  in success-green on the board). All chips — navigator, Story hero,
  toolbar, board — now derive from `run_status_class`; the board chip's
  label and class come from the same word; unit pins lock the contract.
  `RunSummary` moved here too — `run_picker.tsx` (a corpse since the
  toolbar dropdown died) is deleted with its ~310 lines of CSS.
- **Failed runs LOOK failed** (adversary 1 P0-1): Story's outcome chip
  said `chip mono error` — a state with no CSS rule; failures rendered
  neutral. Now `danger`, and failure text wears a new red `error_callout`
  instead of warning amber. A test pins every chip state used in tsx to
  an existing rule.
- **Undefined token killed borders** (adversary 1 P0-3): `--border-primary`
  does not exist; the border shorthand was invalid and Produced rows +
  the memory panel rendered borderless. Fixed to `--border-default`; a
  new test asserts every fallback-less `var(--token)` in styles.css is
  defined (styles.css or kit theme).
- **"Workflows" tab told a lie** (adversary 2 P0-1): the embedded panel
  is the knowledge-graph MEMORY explorer (`kg_query`), not a workflow
  map — and "workflow" already means FlowGraph on the run page. Renamed
  tab/id/heading to **Memory** ("Active memory"); offline state renders
  an explanatory empty state; the offline banner names all four tabs.
- **Scheduled launches confirmed nothing** (adversary 2 P0-3): the
  scheduled path attached silently and stayed on Launch. Both paths now
  land on the run's Story.
- **Approve/Reject, one verb pair, honest colors** (adversary 2 P1-B1):
  board "Deny" → "Reject" (matching the wait modal); Approve wears a new
  success-tinted `btn success` instead of accent-crimson beside a red
  Reject.
- **Session files, not "Produced"** (adversary 1 P1-3): the section
  renders session-memory attachments (often user inputs), not verified
  run outputs — renamed with honest copy; run products live on System →
  Artifacts.
- **Chronology renders the newest 30** with "last 30 of N" + Show all
  (adversary 1 P1-4: hundreds of scrollable articles on the default tab).
- **Offline honesty**: the run navigator says "Gateway offline — sign in"
  instead of "No runs match the current filters" (adversary 1 P1-5).
- **System header count says "(filtered)"** when artifact filters are
  active (adversary 2 P1-A1); "Artifact Explorer" duplicate h3 dropped;
  "Runtime logs" h2 → "Logs".
- **Story hero "Runtime" button → "Open in System"**, carrying the run
  into the System page (selected run + Activity tab) instead of dropping
  it (adversary 2 P1-D1).
- **Launch's dead button explains itself**: the disabled Launch button
  now names its first failing reason (sign in / select a workflow /
  invalid JSON / loading) and shows "Launching…" while submitting
  (adversary 2 P1-C2); stale copy purged ("Advanced JSON", "(connect in
  Settings)", "Start Workflow →" — test-pinned against return).
- **Board de-noised**: tile age chip folded into the tooltip; "gateway
  connected" prose dropped (LED + pills carry it; words appear only when
  unreachable); busy liveness dot moved off the hardcoded green hex onto
  `--info` (liveness is not the WORK phase).
- **~15KB more dead CSS purged** (replay workbench, run picker, old
  timeline wrappers, graph toolbar, digest/json/drawer leftovers,
  `a.nav_tab`, `gateway_led_btn`); color-literal ratchets lowered to
  195 rgba / 11 hex. Observe's four-tab strip gained tablist ARIA; the
  four-tab shape is test-pinned; board column order Review-first is
  test-pinned. 79 tests green (was 68).

Deferred with eyes open: summarize-on-terminal-run verification needs a
live gateway (adversary 1 P1-9); full segmented-control consolidation
(three looks → one) and the empty-state/eyebrow recipe dedup ride wave C
with adversary 3.

## 2026-07-13 — REDESIGN wave A: the run page (nine tabs → four) + chip unification

The content redesign the shell prepared for. Observe's nine content tabs
were nine renderings of one ledger; they collapse into four surfaces
with distinct jobs:

- **Story / Ledger / Flow / Ask**: Story is the answer-first narrative —
  status, outcome, waits, summary, subworkflows, **Produced** (the old
  Attachments tab as a compact artifact list with preview/download) and
  **Chronology** (the old Timeline tab) inline, in that order. Ledger
  stays the raw truth (steps/cycles). Flow is the graph. Ask is the
  conversation. Timeline/Replay/Digest/Providers/Attachments tabs are
  gone — Replay's re-rendering died (its unique artifact cards live in
  Story's Produced; run explanation belongs to Ask), Digest's stats were
  already Story metrics, Providers' audit view stays on the Runtime page
  (its ledger table was a re-render).
- **One run selector**: the navigator rail is THE selector; the
  toolbar's duplicate RunPicker dropdown is deleted. The toolbar now
  names the selected run (workflow label + short id + status chip) and
  holds only actions on it (Pause/Resume · Run now · Cancel · clear
  view). No run selected states itself plainly.
- **ONE chip recipe app-wide**: `.status_pill`, `.pill`, `.mc_pill`,
  `.mc_status`, `.mc_entity_phase` all align to the `.chip` metrics
  (999px, 1px tinted border, xxs/600 text) with kit-token tinted-outline
  states; the last raw-rgba semantic colors in `status_pill` are
  tokenized. Board column titles become eyebrows (uppercase xs) instead
  of shouting md/700.
- **Dead code deleted with its tabs**: ReplayWorkbenchPanel,
  ProviderActivityPanel (observe copy), the digest memo + cache, replay
  bundle state/fetch/effect, and their helper functions — ~600 lines.
  The attachment preview modal survives (Story opens it).

## 2026-07-13 — REDESIGN wave 1: the sidebar shell (operator full-redesign mandate)

Two fable5 architects reported (information architecture + visual
language, benchmarked against AbstractFlow and AbstractContinuum whose
design the operator holds as the bar). Their specs compose into a full
redesign; wave 1 ships the shell every tab wears:

- **Sidebar shell replaces the pill-tab header**: 196px left sidebar
  (brand, icon+label nav rows, connection control in the footer) + slim
  page header whose single job is naming the current page at lg/700 —
  the shape continuum ships. Narrow viewports collapse to a 56px icon
  rail instead of wrapping tabs.
- **Accent is a cue, never a fill**: the active nav row carries a 2px
  inset accent bar over a neutral surface; the retired solid-accent
  `.nav_tab.active` cannot return (pinned).
- **Settings becomes a nav row** (no more hidden icon button); the
  Entities ↗ link rides the nav; the GPU pill moves to the header
  actions.
- Dead chrome rules removed (`.app_nav`, `.nav_tab`, `.logo*`,
  `.header_icon_btn`, `.status_pills`); `status_pill` kept minimal for
  its one remaining consumer (migrates to `.chip` in wave 2).

THE PROGRAM (from the IA architect, implementing across waves): four
question-first surfaces — Board ("does anything need me?"), Timeline
("what happened at time T?" — new), Runs (the one run browser), System
(the framework inventory) — plus a URL-addressed run page (Story /
Ledger / Flow / Ask) replacing Observe's nine sub-tabs, one shared
RunsStore so every number agrees, and cross-link rules (no id or
timestamp renders as dead text). Seven gateway wire asks filed
(commons c1592). Seat observability wants banked (c1583-1588).

## 2026-07-13 — Code+logic adversary fold (fable5, production-readiness wave)

A whole-package adversarial review of the app's correctness (connection
lifecycle, poll/stream loops, board actions, client, CLI). Verdict was
"not production-ready for multi-run operator use"; every P0/P1 folded:

- **P0 — run-attach contamination**: the ledger replay loop could outlive
  its attach — switching runs mid-replay kept the OLD run's pages
  flushing into the NEW run's records (wrong-wait exposure: approving
  what you see while another run executes). Replay is now abort-aware
  (the attach's signal cancels paging and pushes; `get_ledger` accepts a
  signal), and `attach_to_run` is single-flight (board clicks during an
  in-flight attach are refused with a status note).
- **P1 — stale `run_id` closure in `handle_step`**: the stream loop
  captured the previous run id forever, making the `abstract.status`
  ticker dead code and poisoning digest dedup keys (a child run's records
  silently vanished from the digest after child→root switches). The
  owning attach's rid is now passed explicitly.
- **P1 — dishonest disconnect**: sign-out never cleared
  `all_run_options`/`runs_refreshed_at`/`board_entities` — the previous
  session's waits stayed rendered as actionable Review cards across
  account switches. Cleared.
- **P1 — permanent "Resuming…" lock**: busy identity now includes the
  wait's appearance time (runtime wait keys are deterministic per
  run+node, so a recurring ask carried the identical key and stayed
  locked forever), plus an effect releasing the lock when the busy card
  leaves Review.
- **P1 — invisible session expiry**: a 401/403 from the runs heartbeat
  now re-probes the connection hook, driving the app back to the real
  sign-in state instead of freezing "connected".
- **P2 — fetch deadlines**: `_deadline()` (30s, composable with caller
  signals) on the loop-critical client calls (entities/card/cognition,
  ledger + batch, bundles) — a single stalled connection could previously
  wedge the entity strip, discovery, or the subrun digest poll forever.

Live production drive (c1505 ask 2): fresh dist served via `bin/cli.js`
(config injection + session proxy verified), and every app loop's API
driven against the live :8080 — runs with metrics (20 roots), entity
roster + cognition (castor phase=sleep served), ledger paging. Note for
gateway: hypnos `/cognition` serves `phase: null` — the tile falls back
to card-state mapping (honest, labeled).

## 2026-07-13 — Design wave: two fable5 adversaries over ALL tabs (operator-directed)

The operator's verdict ("i do not like it") decomposed into evidence by
two adversarial reviews — one on visual design, one on layout/information
presentation. First fold, all gates green:

**Aesthetics (root causes: three design generations worn at once; kit
tokens bypassed by 428 raw rgba literals; no component discipline):**

- **Foreign dark palette removed**: 28 Tailwind slate/gray-900 surface
  literals (heroes, sticky headers, mode tabs, run picker) now derive
  from the kit's `--bg-primary`/`--bg-tertiary` via `color-mix` — cards
  and page share ONE dark family, and all 21 themes stop breaking.
- **One selection color**: every `.selected/.active/.checked` rule that
  hardcoded blue-400 now uses `--accent-subtle` + `--accent-border`;
  semantic blues/greens/reds/ambers elsewhere ride `--info/--success/
  --error/--warning` (187 literals converted block-aware).
- **Bare `button:hover` no longer floods accent red** (JSON carets,
  section headers); one global `:focus-visible` ring replaces three
  competing ring systems plus UA default.
- **Solid status pills retired**: `.run_card_status.*` and the scheduled
  chips move to the tinted-outline recipe (the old 10px white-on-green
  failed AA); header LEDs and board LEDs now share the kit green.
- **Theme-safe accent hover**: hardcoded `#ff6b81` → `color-mix(accent)`.
- **Type/weight/radius discipline**: 8/9px micro-labels floored at
  `--font-size-xxs`; odd weights 650/750/850 snapped to 600/700/800;
  radii 6/8/9/10px snapped onto `--radius-sm/md/lg` tokens.
- **Monospace reserved for values**: the nine observe content tabs and
  seventeen settings/launch helper sentences drop `mono` (new
  `.help_text`); one `.eyebrow` recipe added for section micro-headings.
- **Launch de-decorated**: violet Upload / blue Reload (six `!important`)
  become plain secondary buttons — the submit is the page's only accent.

**Layout / information presentation (root causes: answer-poor surfaces,
inverted priorities, clipped panels):**

- **Overview/Timeline/Providers no longer clip**: the three panels inside
  the `overflow:hidden` card get their own scroll — long content was
  physically unreachable.
- **Launch is not a dead end**: an immediate start lands on Observe
  following the new run; scheduled starts stay with their schedule.
- **Review renders FIRST on the board** (it fell below the fold at narrow
  widths); empty columns say what empty means ("nothing needs you",
  "idle") instead of a bare "—".
- **Outcome on the Overview**: terminal runs show their error (failed) or
  final answer (completed) — previously the error lived only in the
  Runtime inspector and the answer only behind per-card unfolds.
- **Honest no-run state**: Observe without a selection shows one line
  ("Select a run on the left…") instead of a fake dashboard of "—" tiles.
- **Wait modal**: Approve/Reject moved into the sticky footer; the
  destructive Cancel run demoted into the body; "Open ledger" now also
  dismisses (it used to open the page UNDER the modal). The modal no
  longer hijacks the board mid-answer (board has its own inline forms).
- **Failed board cards carry their WHY**: clamped error line on the card.

Second pass (same day): dead-CSS sweep — 13 unreferenced rule blocks
deleted (`.overlay`/`.modal` legacy pair, `.viewer_header*`,
`.chat_bubble`/`.chat_row`, `.observe_layout`, `.app-main`) — plus two
RATCHET tests: raw color literals can only go DOWN from today's counts
(238 rgba / 15 hex ceilings; new color goes through kit tokens), and
solid status pills can never return.

Remaining from the reports (tracked, not yet folded): status-chip system
unification (11 recipes), eyebrow migration (10 variants → `.eyebrow`),
run-picker/navigator dedup, Timeline-into-Ledger merge,
relative-time formatter unification, syntax-palette unification.

One fable5 adversarial review of the board's phase rendering against
the ruled machine; every finding folded:

- **`resting` mapped, styled, pinned** — it fell through the
  normalizer to an unstyled chip indistinguishable from unknown.
- **"● working" renamed "● busy"** — WORK is a ruled phase word;
  execution liveness must not wear it beside a `visit` chip.
- **Source-labeled chip**: the phase chip's tooltip now names its
  source ("cognition wire" vs "card state — wire unavailable") so a
  degraded read is never mistaken for wire truth.
- **Styles de-blurred**: sleep gets a real identity (muted border, not
  opacity-only), awake moves off success-green (green belongs to WORK
  exclusively), unknown/other render dashed.
- **Bounded class names**: unlisted server words render their verbatim
  WORD but a bounded `mc_phase_other` class — server strings never
  interpolate into CSS classes.
- **Passthrough posture pinned**: unlisted words are never coerced into
  a ruled phase (a "helpful" coercion now fails a test); the
  awake/paused/resting branches are pre-alignment passthroughs to be
  deleted when the gateway serves strict four-phase values.
- Record correction: the previous entry's pin-coverage claim
  overstated — paused/awake/resting are rendered passthroughs, not
  "ruled names", and `resting` was unmapped until this fold.

## 2026-07-13 — One active phase on the board (operator ruling)

The four entity phases (visit / work / personal / sleep) are a
one-active-phase radio state machine (commons c1455). The board's
entity tiles now render THE active phase from the same source both
apps use: the cognition wire's composite `phase` field, falling back
to the card-state mapping only when the wire is absent or unreadable.
Pins cover the wire's chain vocabulary.

## 2026-07-13 — B3 complete: cognition wire on the board tiles

Gateway shipped the spend wire (`GET /entities/{name}/cognition`, commons
c1390) and the board consumes it same-day as committed:

- **Working truth**: tiles show "● working" from the wire's store-read
  `working` (loop mid-day or live visit — authoritative, never
  fabricated); `working: false` renders "idle · Xm ago"; pre-wire
  gateways (404) fall back to the moment-age heuristic unchanged.
- **Spend chip**: lifetime billed tokens from the home run ledger
  (`spend.lifetime.tokens_total`, compact "12k tk") plus the open
  visit's live tree (`(+N)`); the wire's `warnings[]` (e.g. the
  loop-spend `#FALLBACK`) ride the tooltip with a `*` so a partial
  number is never read as a total.
- `get_entity_cognition` added to the client; cognition fetch rides the
  existing 30s card poll (one extra parallel request per tile, optional).
- Pins: `format_tokens` (compact + null-renders-nothing).

## 2026-07-13 — B5 adoption: useGatewayConnection is the connection machine

The bug-wave B5 ruling ("login/auth should be consistent across apps")
landed as a uic hook that IS the shared state machine. Observer adopts:

- `useGatewayConnection({ variant: "dismissable" })` replaces the
  app-local machine — boot probe, auto-open on resolved disconnect, close
  on the sign-in transition, once-per-episode re-arm and initialStatus
  dedupe are the hook's now. `<GatewayConnectModal {...modalProps} />`.
- `handle_connection_status` keeps only the APP reactions: fresh sign-in →
  session mode + discovery; sign-out → app disconnect; plus the direct
  dev-bearer fallback (tried once per signed-out episode) that the old
  boot effect carried.
- The `auto_connect_gateway` boot toggle is superseded by the ruled
  contract (signed-out is a sign-in screen); explicit connect buttons call
  `openModal()`; the Settings sign-out path rides `conn.signOut()` (uic
  folded the verb same-hour from this adoption's datum — the interim
  refresh-poke wart lived for one commit).
- Auth pins updated (`useGatewayConnection` + `modalProps` are the new
  contract markers).

## 2026-07-13 — Board entity tiles: activity freshness (bug wave B3, observer half)

Operator: "unclear when it's working and consuming credits." The board's
half of the fix, shippable from existing card data: each entity tile now
shows "● active" (pulsing, reduced-motion aware) when the last recorded
moment is under 60s old, or an honest "Xm ago" otherwise; nothing renders
when the card carries no timestamp (never fabricate). Tick-phase and
token-spend indicators follow when gateway/runtime expose the wire (lane
confirmed on commons c1312). The in-app graph/ledger consistency half
belongs to the entity app since the split.

## 2026-07-13 — SteerComposer wired (uic kit wave)

The kit shipped the shared steer composer (commons c1239; hooks P3
surfacing). The Observe toolbar now carries it for any attached
non-terminal run: mid-run guidance submits as the durable
`inject_guidance` command through `gateway.submit_command` (session
proxy + CSRF and direct bearer both work via the submit override).
Status honesty per the contract: the composer says "Queued (seq N)";
DELIVERY is the ledger's own `abstract.steer_seen` line (already
rendered with a human preview). Waiting runs show the kit's parked
note — steers do not wake runs.

DisclosureList/AfChip adoption (the ledger-list fork deletion) is
assessed as a separate refactor wave — the observe ledger list is
virtualized custom rendering; adopting the kit list is real surgery,
scheduled next session rather than rushed at 4am.

## 2026-07-13 — Connected-first startup (the 10-15s "Connecting…" fix)

Operator incident (02:12, screenshot): first connect on localhost pinned
on "Connecting…" for 10-15s. Measured root cause: the connected state
gated behind a SERIALIZED waterfall — probe → bundles → runs → tools ∥
providers — and the gateway runs listing is a whale (2.2-7.9s server-side
at ~500 runs with metrics; `/api/health` answers in 1ms). Five round
trips, four serialized stages, slowest one 2-8s.

- **Connected-first**: `run_discovery` flips `gateway_connected` as soon
  as auth is proven (session probe / modal sign-in / bearer preflight) and
  runs all four discovery fetches in ONE `Promise.allSettled`. The board
  paints immediately; each surface fills as its fetch lands.
- **Bearer preflight** (adversary): the direct dev path now proves the
  typed token with one ~20ms authenticated call before flipping connected
  — a wrong token stays on the sign-in screen with a real error, exactly
  as before.
- **All-rejected guard** (adversary): if every discovery fetch fails, the
  app drops back to the sign-in screen with `discovery_error` set instead
  of staying "connected" over a dead gateway.
- **Honest first paint** (adversary): before the first runs payload lands,
  the board says "loading runs…"/"loading…" instead of claiming
  "0 need you" over empty columns.
- **Self-tuning poll**: the 5s/30s runs poll now waits at least 3× the
  last request's duration — a 3s server response polls at ~9-10s instead
  of making the board the gateway's main load; fast servers keep 5s.
  Rescheduling moved into `finally` (a future throwing refresh must never
  silently kill the poll), single-chain guards added.
- **Epoch guard** (adversary): sign-out during in-flight discovery/runs
  bumps an epoch; late results can no longer repopulate a signed-out app.
- **`list_runs` deadline**: 30s `AbortSignal.timeout` so a stalled-open
  connection can't wedge the poll chain with Refresh disabled forever.

Server-side half reported to gateway on commons: the runs listing itself
(2.2-7.9s at ~500 runs) is theirs to optimize; the poll self-tunes back to
5s when it gets fast.

## 2026-07-12 — AbstractEntity split: adversary fold

Two fable5 adversaries attacked the split (one per side); observer-side
findings, all fixed:

- **Workspace launchers advertised a dead URL** (P0): `gateway-flow.sh` +
  `gateway-flow-local.sh` printed `observer:3001/entity.html` (a
  guaranteed 404 post-split) and never exported
  `ABSTRACTOBSERVER_ENTITY_APP_URL` into the observer spawn — both now
  export it and print the entity app's own address with its launcher.
  `meet_castor.sh` (already deprecated for the retired :8081 rig, now
  doubly dead — its body needed `dist/entity.html` and the removed landing
  knob) exits immediately naming the current path.
- **False security claim in-app** (P1): the Sign out tooltip and the
  `disconnect_gateway` doc still said the session is shared with the
  entity app on this origin — false since the split (own deployment, own
  cookies). Both rewritten; `docs/security.md` already said it correctly.
- **`docs/api.md` Processes section** (P2): documented a page that moved
  to abstractcontinuum — replaced with a moved-pointer.
- **Redesign backlog annotated** (P2): the 2026-07-12 UI-rethink doc now
  carries a status note (wave 1 shipped; entity-app work items belong to
  abstractentity's backlog).
- **`ABSTRACTOBSERVER_ENTITY_APP_URL` normalized** (P2): query/hash are
  stripped at parse so both consumers (redirect + deep links) can append
  their own query safely.
- **Stale dev proxy target** (P2, pre-existing): Vite's sessionless `/api`
  fallback pointed at the retired :8081 gateway — now :8080 with env
  overrides.

Gates after the fold: 56 tests green, tsc clean, build clean.

## 2026-07-12 — The entity app moved out (AbstractEntity split)

Maintainer directive: entity code lives in its own package. Everything
entity-shaped moved to `../abstractentity` (github.com/lpalbou/AbstractEntity)
— the whole `src/entity/` module tree and its tests, `entity.html`,
`public/demo/*.ndjson`, `scripts/export_demo_entity.py`,
`scripts/export_home_stream.py`, `scripts/fold_digest.ts`, and the
visit-wakes backlog item. The observer observes; the entity app is where
entities live.

What the observer keeps (watching, not serving):

- The Board's entities strip (`GET /api/gateway/entities` + `/card`) and
  all run/runtime/gateway surfaces.
- "Entities ↗" links now point at the entity app's own deployment:
  `ABSTRACTOBSERVER_ENTITY_APP_URL` (bin/cli.js injects it as
  `__ABSTRACT_UI_CONFIG__.entity_app_url`), default `http://127.0.0.1:3007`.

Serving changes:

- `bin/cli.js`: the two-apps-one-dist landing knob
  (`ABSTRACTOBSERVER_LANDING`) is gone; `/entity.html` now 302-redirects to
  the entity app when `ABSTRACTOBSERVER_ENTITY_APP_URL` is set, otherwise
  404s with the new address (the wrong app wearing the right URL is worse
  than a 404 — 2026-07-09 lesson kept).
- `vite.config.ts`: single-entry build again.
- Workspace launchers (`scripts/entity[-local].sh`) serve the new package;
  `observer[-local].sh` exports the entity-app URL for the links.

## 2026-07-12 — Kind vocabulary sync: `world_model`

Memory's maintainer-authorized wave (commons c1148) widened the engine
record-kind set with `world_model` — sleep-formed orientation cards per
person/topic. Per the sync-on-widening rule the mirror is extended the
same day:

- `ENGINE_RECORD_KINDS` gains `world_model` (verified against the source
  tree's `abstractmemory.MEMORY_RECORD_KINDS`); `KIND_COLORS` gives it a
  light teal in the consolidation family (kin to summary, distinct from
  it) instead of unknown-gray.
- Ledger lines: `world_model` formations render as "🧭 He mapped how he
  sees someone/something" instead of the generic "Memory formed".
- The kind-vocabulary drift test covers the new kind.

## 2026-07-12 — Tokens never rest client-side (entity app)

The connection-surface contract uic published after Laurent's continuum
flag (commons c1142) restates the framework ruling: bearer tokens must
never rest in client storage, dev convenience included. The entity app's
direct posture persisted a remembered bearer (with its base) in
`localStorage` — compliant apps keep credentials in memory only.

- `storeAuth` no longer persists anything; `loadStoredAuth` now only
  SCRUBS tokens written by earlier builds (`abstractobserver_gateway_auth`
  and the legacy `abstractobserver_entity_token`) and returns null.
- Direct-dev tabs re-prompt for the token on reload — that friction is
  the ruling working. The proxy session path (HttpOnly cookies) is
  unchanged and remains the endorsed posture.
- Tests: storage pins replaced with never-persist + scrub-on-load pins;
  `docs/security.md` updated.

## 2026-07-12 and earlier — development notes (released in 0.1.12)

- DEV SIGN-IN = PROD SIGN-IN (continuum's c1122 root cause adopted
  same-hour): the Vite dev server now mounts the SAME
  createGatewaySessionProxy as bin/cli.js via a config plugin —
  POST /api/connection/gateway used to fall through the raw /api proxy to
  the gateway (which has no such route) and 404 the shared sign-in dialog
  in dev. Fall-through contract preserved: authenticated /api rides the
  session proxy; sessionless requests keep hitting the raw dev proxy so
  no-auth dev gateways still work. Smoke-verified (dev probe answers the
  connection contract).

- ONE SIGN-IN DIALOG, EVERYWHERE (maintainer verdict 2026-07-12: "your
  login/auth is terrible — comply with abstractgateway/console and
  abstractflow, reuse the abstractuic gateway login + kit"): both observer
  apps now ride the SHARED `GatewayConnectModal` from
  `@abstractframework/ui-kit` (flow's endorsed design on the
  `/api/connection/gateway` session contract). Main app: the header LED
  became a labeled connection control (dot + signed-in-as identity —
  console parity), the boot probe is SESSION-FIRST and auto-opens the
  dialog when signed out (flow parity: signed-out is a sign-in screen,
  never a dead app), Settings' raw URL/user/token/remember fields are
  gone (status badge + "Manage connection…" + a demoted Advanced
  direct-dev block), the app-local sign-in code is deleted, and every
  disconnected page CTA opens the dialog instead of pointing at Settings.
  Entity app: the proxy posture returns the kit dialog verbatim; the
  cross-origin bearer card survives only as the labeled dev posture.
  TWO-ADVERSARY FOLD (all findings fixed): the P0 — URL validation ran
  BEFORE the session probe, so the default localhost URL blocked a valid
  session on every deployed host (probe now runs first; validation
  belongs to the direct branch only); "Disconnect app" said it kept the
  browser session while DELETE-ing it (now an honest "Sign out" naming
  the origin-wide blast radius, and modal-driven sign-outs skip the
  redundant DELETE); sign-out during in-flight discovery landed nowhere
  (gate removed); opening the dialog over a live DIRECT connection
  silently rewired it to session mode (guarded); the dialog now closes
  itself on a FRESH sign-in only (open-probe baselines in both apps —
  the entity wrapper would otherwise instantly close for signed-in
  users, making sign-out unreachable); monitor-gpu rode the raw gateway
  URL unauthenticated in session mode (now same-origin); Runtime
  "Reconnect" and run deep-links prompt sign-in instead of failing
  silently; stale 401 advice, dead `gateway_remember` field, and stale
  README/faq/security auth sections all updated.

- MISSION CONTROL (maintainer sign-off 2026-07-12, "surprise me" wave):
  the app's new DEFAULT landing page is the Board — kanban columns
  Pending / Working / Review / Done where cards are RUNS that move
  themselves by state truth (never drag, never prose): Review = a human
  is the blocker (tool approvals + questions, INLINE Approve/Deny/Answer
  on the card — no modal, no context switch, oldest wait first), Working
  = running or parked listening (a resident on a wait_event is progress,
  not a request), Pending = scheduled, Done = terminal with failures
  floated. Health strip (gateway LED, data age, needs-you/failed/working
  counts); entities strip from the CHEAP card endpoint (name, phase chip
  on the ruled visit/work/personal/sleep vocabulary, age, last moment —
  card + as_of_seq per gateway c1038, never whole-life folds), each tile
  deep-linking into the entity app. Run lists now POLL (5s visible/30s
  hidden, visibility-aware) — a pending approval on an unwatched run was
  invisible until a human pressed Refresh. Disconnected landing is an
  honest connect hero instead of a dead board. The two apps finally see
  each other: "Entities ↗" in the observer nav, "Observer ↗" in the
  entity header. THREE-ADVERSARY FOLD (all findings fixed pre-ship): the
  Review column scans the FULL run listing, not roots — agent workflows
  hold tool approvals in CHILD runs while the parent parks on
  subworkflow, so a roots-only Review was blind to the dominant approval
  shape (cards carry a "subrun" chip and resume against the child's
  run_id + wait_key); Enter inside the answer textarea no longer
  navigates away and destroys the answer (keydown containment); Send
  disables on empty and trims; choice waits honestly say "Open to answer
  (choices)" instead of faking free text; approve/deny stay busy until
  the poll moves the card (double-approve window closed); the poll's
  in-flight dedup moved to a ref (the state-based guard was frozen in
  the effect closure — requests could stack on a slow gateway); deep
  links to runs now land on Observe (the board became the default);
  board cards open runs through attach_to_run (root id no longer goes
  stale); entity tiles read the REAL card shape (state is an object —
  verified live against castor); strip truncation labeled ("12 of N").
  16 board contract pins.

- GRAPH LENSES (same wave — "the memory graph is pretty inefficient to
  access information"): one-click semantic filters over the entity
  memory graph riding the existing search-emphasis mechanism — Identity
  / Recent (newest tenth of the life, by birth or selection) / Warm
  (temporal activation now) / Feelings (valence targets, on-node and
  standing) / Diary / Dreams / Questions (question+problem+idea+lesson).
  Search INTERSECTS the active lens ("questions about tolstoy"); an
  emphasis count chip shows "N of M"; the camera now FITS to the
  emphasized set when it changes (fit-to-emphasis — finding information
  no longer requires a manual pan-hunt; world positions untouched, only
  the camera moves, spatial-memory rule intact). ADVERSARY FOLD: the fit
  keys on OPERATOR INTENT (lens click + 450ms-debounced search commit),
  never on set membership — a fold-keyed fit re-framed the camera on
  every live envelope under "recent"/"warm" (the live view became
  un-navigable); the fit retries while layout materializes instead of
  recording a signature that swallowed it forever; an EMPTY lens result
  now DIMS the graph and says "nothing matches here" (falling through to
  no-filter made empty lenses read as broken buttons); the feelings lens
  resolves graph-id targets through graph_to_row (the two-namespace rule
  — it was dimming the very node carrying the feeling); identity lens =
  value/purpose/trait/interest (deliberately narrower than the canvas
  color map's gold `claim`s, documented); questions lens = question +
  lesson only (problem/idea are wake reasons, not record kinds) and
  excludes closed records; lens resets on entity switch; chips are
  aria-pressed buttons. 9 lens pins.

- THE OBSERVER OBSERVES; CONTINUUM DEVELOPS (maintainer split, 2026-07-12):
  every CI/CD development surface left this repo for the new sibling
  `../abstractcontinuum` — the Backlog page (backlog CRUD + the codex
  execution pipeline: execute/batch/exec requests/feedback/promote/
  deploy-UAT/log tails, 4,141 lines), the report/email Inbox (1,210 lines),
  the Processes manager (552 lines), `exec_event.ts` + its pins, ~1,000
  lines of dev-lane `gateway_client.ts` methods/types (report reads,
  email/triage, backlog + exec, managed processes), 376 lines of dev-lane
  CSS, the backlog CSS pin test, and the
  `ABSTRACTOBSERVER_ENABLE_BACKLOG`/`_ENABLE_INBOX_TRIAGE` env knobs.
  The observer's pages are now observe / launch / runtime / mindmap /
  settings — observe and discuss, change nothing. Docs updated
  (faq/security/architecture/configuration/README); suite 173 green;
  the split's full story lives in `../abstractcontinuum/history.md`.

- STEER ACK RENDERS AS WORDS (hooks H4 render half, runtime ship c996):
  runtime's steer sidecar acks each delivery with an
  `abstract.steer_seen` EMIT_EVENT whose payload ({seqs, count, node_id})
  carries no prose — the generic textish preview rendered an empty
  ledger row. All three log builders (root, child, subrun-digest) now
  render "N steer message(s) folded into the run before <node> — the
  loop sees it at this boundary"; missing count renders honest wording
  (never a fabricated number), missing node drops the location. Visible
  in condensed view by design — steer delivery is exactly what the
  listen surface exists to show. 5 contract pins
  (`steer_seen_preview.test.ts`).

- RUN VIEW SCALE DISCIPLINE (hooks plan P3, observer's ungated slice —
  c980 commitment, one fable5 adversary folded): the main app's raw
  `records`/`child_records_for_digest` arrays appended with a FULL array
  copy per ledger event — O(N²) cumulative at resident scale (~5k
  events/day, the fleet DONE bar) — and every records-derived useMemo
  re-ran per event. Now: `RecordBuffer` (new `src/ui/record_buffer.ts`, 6
  contract tests) batches appends into one concat per ~40ms flush window
  with generation-guarded reset (a run switch can never leak a stale
  flush into the new run); the heavy digest memo (per-record emit
  parsing + JSON previews over the whole history) computes ONLY while
  the digest tab is visible, caching the last value for instant tab
  switches. ADVERSARY CATCH (P1, fixed before ship): the Overview tab —
  the app's DEFAULT tab — consumed `digest.latest_summary`, so gating
  the digest froze/nulled the summary panel exactly where users land;
  the latest-summary scan is now its own always-on INCREMENTAL memo
  (scans only the new tail per flush, rescans on run switch) feeding
  Overview directly, and the digest memo shares it instead of
  rescanning. Per-event liveness paths (status pills, active-node
  highlight, ledger log rows — all bounded structures) deliberately stay
  per-event. Digest typed (`RunDigest | null`) instead of decaying to
  `any`.

- ONE SESSION PROXY, SHARED (uic ship c961, co-signed live 2026-07-12):
  `bin/cli.js` dropped its ~300-line app-origin gateway session proxy for
  `createGatewaySessionProxy({ appId: "abstractobserver" })` from the new
  `@abstractframework/app-server` module — the shared extraction of this
  file's own hardened copy, ending the observer/flow/abstractcode
  triplicate drift hazard. Cookie names (`abstractobserver_gateway_*`),
  the `x-abstractobserver-csrf` header, and every
  `ABSTRACTOBSERVER_*`/`ABSTRACTGATEWAY_*` env gate derive from appId, so
  live sessions and deployment posture survive the swap byte-for-byte
  (adversary-diffed function by function against the deleted copy).
  Live-verified against the real gateway: silent probe, sign-in-once,
  authenticated proxied GET, CSRF deny/allow on both header spellings
  (canonical `x-abstract-csrf` now accepted too), sign-out, landing
  intact. The module is strictly SAFER than the deleted copy: upstream
  error mid-SSE no longer crashes the process (`headersSent` guard) and
  abandoned live tails no longer leak a gateway connection (client-abort
  teardown). RELEASE GATE (adversary P1): the dep is `file:` on an
  unpublished package — publish `@abstractframework/app-server` and swap
  to a semver range before any observer release, or `npx` + standalone
  `npm ci` fail.

- HOST MARKERS RENDER AHEAD OF THE DOOR (config-object build phase,
  2026-07-11 — contracts proposed c745, gateway-confirmed c746, one
  adversary folded): five marker kinds now render as human ledger lines
  the day the gateway starts writing them — `deposit_refused` (N4/R5's
  render leg: "⛔ A sleep-phase deposit was refused — MEMORY_FORM
  (episode) into self — <door's sentence>", 96-clip visible, phase named
  only when the payload names it), the own_time grant lifecycle
  (`own_time_granted` renders as ARMED never started — semantics c700;
  `own_time_grant_expired` distinguishes the calm tick-poll expiry from
  the LOUD wall-clock backstop, which means the gateway was dead;
  `own_time_grant_retracted` names who withdrew it), and
  `prompt_overlay_changed` (layer names only, word-free). Adversary pins:
  missing `mode`/`enforced_by` render "unrecorded" instead of fabricating
  the strongest ("until retracted") or calmest ("poll") claim; layers as
  an array never renders indices as names; all interpolated fields
  clipped. 12 contract tests + 6 malformed-payload pins. RE-SPELLED to
  the ruled vocabulary same evening (semantics c794, gateway confirm
  c798): kinds are `personal_granted` (mode timer|until_revoked — revoke,
  not retract: retract is spent in the identity lane) /
  `personal_grant_expired` / `personal_grant_revoked`; the pre-ruling
  own_time_grant* spellings died unaliased (zero envelopes ever carried
  them — pinned generic), while loop-lifecycle kinds render under BOTH
  spellings (historical streams carry own_time_started).

- FABRICATION GUARD UNSTALED + 403 ≠ 401 + FOUR-PHASE LABELS (2026-07-11,
  one adversary folded): `tool_claim_guard`'s tool-name list matched the
  runtime again (the never-real `diary_search` out, the missing `fetch_url`
  in — that exact prose claim used to pass silently) plus a conservative
  hallucinated-name pattern ("I ran the X tool" flags for unknown X; bare
  "I used caution" never does) and a cross-repo drift pin that parses the
  runtime's `tools.py` tuples directly (the entity_tokens precedent — this
  list already went stale once). Door refusals now speak with ONE voice
  from `gateway_session.authRefusedMsg`: 401 = sign in, 403 = the door
  refused the ACT (detail rendered when it's a sentence, length-capped,
  HTML dropped; no speculative "admin required" diagnosis on a body we
  didn't get) — replacing three different conflations across the workspace
  tabs, the own-time strip, and the state buttons (one of which still
  pointed at the removed control-panel token). The phase matrix carries
  labels + honest hints for the ruled four-phase vocabulary
  (visit/tasked/own_time/sleep — own_time states the Q1 ruling: full set
  by default, the grant is the brake); `resident` renders as legacy for
  older gateways, and the stale "renders when runtime flips" comments were
  corrected: runtime has ALREADY flipped, the alias is the migration
  window. RULED WORDS (laurent 20:30, 9-0 room ballot): the phases are
  single human words — visit | work | personal | sleep; the matrix labels
  them so, and tasked/own_time/resident all render "(legacy spelling)"
  until every gateway flips.

- RULED DEFAULT TOOL MATRIX (maintainer, 2026-07-11 12:37, set from the
  workspace matrix screenshot): every NEW summoned entity now defaults to
  the full 9-tool set for visit and resident (hands by default — narrowing
  is the operator's explicit act), and sleep defaults to read-only
  exploration WITHOUT the diary (web_search, fetch_url, read_memory,
  search_memory, read_file, list_files — "the entity can't act/change the
  environment while sleeping, but it can recall or search information; it
  won't be in its diary"). Implemented in runtime's tree
  (`tool_policy.py` + ruling-pinned tests; the per-session
  enable_workspace gate no longer subtracts from defaults; runtime suite
  1056 green, gateway roundtrip aligned). Observer's tools tab gains the
  honest sleep cue (⏳ standing config — the sleep pass does not run
  tools yet) and the operator-layer hint now says identity-shaped
  statements ("You are curious…") belong in the SPARK at creation, not in
  operator instructions — the spark-vs-operator placement question is
  posed to memory/runtime/gateway (e-s 217) per the maintainer's ask.
  Three adversarial reviews folded (e-s 220): an explicit zero grant
  (visit: []) no longer falls open to tier-1 in the in-process driver
  (None = default, () = deny-all, pinned); operator prompt-overlay
  changes now land a `prompt_overlay_changed` host marker on the entity's
  replay stream (layer names + content hashes, never words); the
  operator-layer hint teaches the permission-vs-character split ("act
  without asking" is operator material, "you are curious" is spark
  material); canonical-order and exact-list pins added; a named-but-
  malformed policy phase now falls to defaults loudly (#FALLBACK).

- AGENCY CAPS (maintainer ruling, 2026-07-11 05:25: "default cap for a
  turn is 20 tool calls"): the chat drawer's turn timeout rises 300s →
  600s so a legitimate 20-call research turn is never client-aborted
  mid-work. The offending cap itself (`#FALLBACK native tool call ignored
  (cap 2/turn)` — a driver-era 2-per-round slice misreported as per-turn)
  is fixed in the runtime tree: a TRUE 20-call turn-wide budget threaded
  across rounds, rounds 3 → 20, contract text updated, pinned by tests
  (runtime suite 1055 green; runtime seat owns the review). A room-wide
  audit of every agency-reducing cap is convened at commons fs
  `reports/agency-caps.md` — observer's section complete (no observer
  surface caps entity/agent execution; render windows are
  presentation-only).

- THE PROMPT TAB (maintainer, 2026-07-11: "we need, in workspace modal, to
  have a tab/badge for system prompt that we could rewrite"): the workspace
  window gains a fourth tab showing the entity's system prompt AS ITS
  LAYERS, with the operator-editable ones rewritable in place. Layer
  ownership is the design: the IDENTITY PRELUDE renders read-only (identity
  evolves by the entity's own acts — never a text box); the TOOLS text is
  machine-owned (it must match the actual grant; the tools tab is its
  editor); the CONVERSATION CONTRACT, VISIT paragraph, and OWN-TIME
  contract are rewritable; a new OPERATOR layer appends standing
  instructions LAST, explicitly attributed ("STANDING INSTRUCTIONS FROM
  YOUR OPERATOR") so injected words never blend into the entity's own
  voice. Empty editor = built-in default (shown below each editor with
  "copy to editor"); a "full preview" section shows the exact head the next
  visit summon composes. Server truth: the overlay persists as
  `<home>/system_prompt.yaml` (operator config beside `substrate.yaml` /
  `tool_policy.yaml`), read at summon time by ALL THREE session arms (chat
  driver, durable visit workflow, own-time loop) through ONE composition
  authority (`compose_system_base`, runtime); gateway serves GET/PUT
  `/entities/{name}/prompt`. Cross-seat note: runtime + gateway halves
  implemented from this seat while those agents were offline (maintainer
  direct ask); seams posted to the room for owner review. Adversarial
  review (1 agent, 14 findings) folded: operator-last now holds on
  resident sessions too (own-time text re-composed BEFORE the operator
  block, not appended after it), per-layer size cap (16k chars) refuses
  paste accidents that would starve recall, saving text byte-identical to
  a default is NOT recorded as a rewrite, a conversation rewrite that
  drops the ```diary election syntax warns loudly, an unparseable
  overlay file surfaces its raw bytes for recovery instead of silent
  clobber, PUT documents whole-document-replace semantics, the tab
  renders the server's layer list (a new layer can never be silently
  deleted by an old UI's save), and "next summon obeys it; an open
  session keeps its summoned prompt" is stated on both prompt and tools
  tabs. Tests: 20 runtime + 6 gateway + typecheck/build green (runtime
  full suite 1054 passed).

- SIGN IN ONCE (maintainer, 2026-07-10 22:5x: "it should ask only after i
  disconnect or on first connect — like abstractflow. BUT once i am signed
  in, stop asking me again!"): the entity app now authenticates the way
  AbstractFlow does. When the page is served by the observer CLI, sign-in
  goes through the app-origin session proxy (`POST
  /api/connection/gateway` — server-side gateway session, first-party
  HTTP-only cookies); on refresh ONE silent status read re-verifies and
  the sign-in card opens only on a definitive "signed out". The root
  cause was a split brain (adversarial audit, 3 agents): the modal
  verified credentials against `http://127.0.0.1:8080` directly while the
  app's data calls rode the page-origin proxy — which refuses anonymous
  calls, strips `Authorization`, and demands a CSRF header the app never
  sent; every refresh re-asked, and "visit" died in a
  sign-in -> 401 -> sign-in loop ("The gateway did not accept this
  session"). Fixed structurally:
  - posture detection: page-origin proxy first (cookies + CSRF ride every
    call; `?gateway=` deep links naming the proxy's own gateway CONVERGE
    onto it instead of dialing cross-origin); direct cross-origin bearer
    only for gateways the proxy does not front, with the credential
    stored WITH the base it was verified against;
  - the CSRF header (`X-AbstractObserver-CSRF`) now rides every mutating
    call (visit open/turn/close, state, loop, substrate, workspace,
    create) — same contract as the main observer app;
  - 401/403 on a door write triggers ONE silent re-check first: a valid
    session shows the door's actual refusal instead of wiping auth into
    the sign-in loop; UNREACHABLE never reads as REVOKED (a down gateway
    keeps your credential and says so);
  - the sign-in card never flashes while the silent check is in flight
    (the locked card says "Checking your sign-in…");
  - session-mode localStorage credentials are dead (the cookie is the
    truth; the old stored "session" states could never authenticate a
    cross-origin call and powered the visit loop);
  - dead code removed: direct `session/login` from the modal; three chat
    reads that sent no credential at all (status/transcript/life_state)
    now send the standard headers.
  Verified live end-to-end against the running gateway + entity server
  (proxy sign-in -> cookies -> silent re-check -> entity roster ->
  write-classed operator probe with CSRF 200 / without CSRF 403). 18
  contract tests (probe classification refused-vs-unreachable, proxy
  status/login, credential storage shape, loopback-alias base folding).
  Adversarial re-audit gaps closed same night: a bearer is never REPLAYED
  against a different gateway than it was verified for (a wrong-host
  replay leaks the token; legacy base-less credentials probe once and
  rebind), a proxy session the gateway did not confirm no longer forces
  the modal (expired-or-down is not "revoked" — note + one-click connect
  on the locked card), localhost/127.0.0.1 count as the same local
  gateway, and a base edited in the modal converges the roster's base
  too.

- Visit direction reads human-first (maintainer, 2026-07-10 23:50): the
  chat drawer's door-open line now says "you are visiting Mnemosyne"
  (was "Mnemosyne is visiting with you" — backwards).

- Entity-agency consensus (in progress, cross-seat; not observer code):
  the plan for summoned-entity autonomy (ReAct unconditional, tools via
  the workspace matrix, steer_repl-grade visit steering) is being driven
  to sign-off on the agora hub; observer owns the Phase-C render lane
  (live agent cycles in the drawer from the visit run's ledger SSE, the
  steering composer, the workflow picker) and the drawer's migration off
  the in-process chat path onto the durable /visit/* path. No observer
  code lands until laurent signs the plan.

- Green means WARM, not famous (maintainer correction 2026-07-10 21:27,
  screenshot "too many memories selected"): the selection intensity
  shipped at 20:50 keyed on the GLOBAL access count (lifetime, never
  decays) — over a long life everything well-used glowed green forever.
  The green now keys on the TEMPORAL access count: a faithful port of the
  engine's activation fold (`temporal_activation.ts` — rank-distance
  decay `weight/(1+d/20)` over the last 512 attention events per
  (scope|owner) stream, per-step clamp [0,25], refocus ×6 stretch, audit
  kinds inert, co_selected credits pair trails only; the engine's
  global-count prior deliberately not ported). Node BLOOM and edge GREEN
  decay with activity; node SIZE and edge WIDTH keep the global count —
  the two-count model rendered honestly. Hovercard and inspector now show
  both truths ("used N times (lifetime)" + "warm X.X now / cold").
  Honest limit: the stream doesn't carry the host's AttentionConfig
  (residents run window 8192 vs engine default 512) — the view uses the
  engine default and the ask is on the memory agent's desk. Measured on
  Castor's real journal (71,859 attention events, read-only): the old
  render showed 91 nodes at ≥half bloom (82 near-full) and 1,194 edges at
  ≥half green — the screenshot's saturated field; the new render shows 29
  faint blooms, 0 at half, 293 dim head-edges (window 8192 barely
  differs: 35/399 — his loop repeated the same cohort, so deeper history
  adds little). 17 parity tests pin the port.

- Warmth staleness cue (data-adversary finding, measured: Castor's
  journal froze 2026-07-09 04:40Z and the head still rendered warm 43h
  later): activation decays by ACTIVITY, not wall time, so a stopped life
  keeps its last recall green forever. The legend now shows "🥶 last
  selection Nh ago" (fold tracks the newest attention event's
  observed_at; suppressed under 10 minutes; anchored to the scrub
  position when scrubbing the past).

- CRITICAL content gate (maintainer 2026-07-10 20:56: "no information
  should show if i am not authenticated"): a gateway source now renders
  NOTHING — no roster, no fleet, no graph, no ledger, no stats — until the
  browser is VERIFIED by the gateway. Stored credentials are re-probed on
  boot (the "cache of auth" desync fix); an unverified browser never even
  FETCHES a life (the stream is deferred behind the auth gate and drained
  only on a confirming probe/sign-in). This is defense-in-depth over the
  gateway's own auth — its dev-read posture served reads that rendered
  behind the sign-in modal. Disconnect re-locks; a fresh sign-in unlocks
  immediately (the modal already proved the credential).

- Visit-refusal recovery (maintainer 2026-07-10 20:56: "still not working
  despite being authenticated"): when the door refuses a visit with
  401/403 while the UI believed it was authed (a stale credential — e.g. a
  session cookie that cannot ride cross-origin), the drawer no longer
  dead-ends with the stale "set the token in the controls strip" message
  (there is no such field anymore) — it clears verified-auth and reopens
  the sign-in card, turning the refusal into a recovery path.

- Selection intensity as the fork monitor renders it (maintainer,
  2026-07-10 20:50): usage-trail edges now DEEPEN TOWARD GREEN with
  co-selection count (grey = barely used; log-saturating at ~20 co-uses;
  the amber flash stays the "just traveled" overlay), and often-selected
  nodes get a green BLOOM behind their kind color (radial glow scaling
  with lifetime use, saturating ~30) — the type stays readable, the
  selection history glows through. Legend updated.

- "Used" bursts fold like the pair bursts (maintainer follow-up): one
  recall deposits one `selected` event per shelf record; consecutive
  "Used" lines from the same recall now collapse to "🔦 Used — N memories
  served this moment: A · B · …", expandable, same-recall-only grouping.

- Identity flows from the ONE authentication (maintainer ruling 2026-07-10
  20:17): the chat drawer's free-text "who are you?" field is REMOVED — it
  was a spoofing surface for the entity's memories. The visiting identity
  derives from the signed-in principal (`person:<userId>`), shown
  read-only; unauthenticated visitors are told to sign in and the door
  refuses regardless. The auth badge no longer displays the credential
  mechanism ("(bearer)"/"(session)") — the identity is the abstraction.
  Stale auth-refusal notes clear on sign-in.

- One auth control in the header: the top-right gear (source panel) is
  replaced by connect/disconnect — connected shows the identity +
  "⏏ disconnect"; disconnected shows "🔑 connect" opening the shared
  ui-kit sign-in card. The ad-hoc source panel is gone (deep links, the
  roster, and .ndjson drop cover its uses).

- Session-cookie auth rides EVERY gateway call: all 16 fetch sites in the
  entity app now send `credentials: "include"`, so a session-mode sign-in
  (the ONE-LOGIN proxy posture) authenticates reads and writes without a
  bearer token in the page.

- Gateway URL default is the STANDARD port (maintainer: "default is
  8080"): the connect card and the boot probe resolve injected config →
  `http://127.0.0.1:8080`; the page's own origin is never assumed to be a
  gateway (a static-server port like :4188 showed as the default). Boot
  now probes candidates in order (param/same-origin → injected → 8080)
  and treats 401/403 as "gateway found, sign in" rather than moving on.

- Theme contributed to the shared kit: `observer-night` (the entity app's
  warm-amber-on-blue-black palette) is now a registered abstractuic
  theme; the entity entry applies it so kit components (sign-in card,
  pickers) match the app chrome.

- Backlog (maintainer request): visit-wakes-authorized-entity — one click
  on "visit" should wake an asleep entity when the visitor is authorized;
  sequenced behind GW-G grants (docs/backlog/proposed/2026-07-10).

- Ledger pair-trail collapse (maintainer, 2026-07-10 20:09: a wall of
  "Used together" lines "doesn't seem very informative"): one recall
  deposits one co-use event per PAIR of memories that served the moment
  together, and the ledger rendered one line per pair — a burst of
  near-identical rows per recall. Consecutive pair lines from the same
  recall now collapse into a single "🕸 Woven together — N associations
  deepened" row naming the distinct memories involved; click to expand
  the individual pairings. Nothing is hidden, one moment reads as one
  line.

- Meet reader v0 (item 14's human-access half; maintainer requirement
  2026-07-10 18:57): a correlated episode's "shared moment" row gains
  "read the conversation" — a read-only view joining EVERY participating
  life's own perspective side by side (episodes + reflections selected by
  the correlation key from each home's SERVED stream, lossless verbatims
  under each entity's own header, deep link into each life). Diary is
  structurally absent (memory's pinned boundary); line-level speaker
  attribution is honestly unclaimed until the door's stamp-attributed
  transcript surface ships (v1) — never parsed from prose. Unreadable
  homes contribute no leg; a keyless moment renders an honest "no
  readable home carries this moment".

- Fleet wall (plan item 13, O-C): "👁 watch all" on the roster opens one
  live tile per entity — each tile is its OWN bounded-history read + SSE
  tail + fold (streams never merge; the wall is presentation over N
  independent folds, zero new serving machinery). Tiles show
  stream-derived facts (memories/diary/feelings/sessions via the same
  derivation as the single view, test-pinned) plus the last human-language
  ledger lines and per-tile wall-time staleness. REFUSED ≠ ABSENT: a 403
  tail renders as a locked tile quoting the door's detail (`fetchReplay`
  errors now carry status + detail) — ready for GW-G's observation grants
  at phase 4; unreachable homes render as errors, never quiet lives.

- Renaming sign-off follow (approved 2026-07-10): the demo exporter now
  calls memory's renamed `reembed_store` (was `reembed_home`); demo NDJSON
  regenerated through the renamed pass. Zero old-spelling sites remain.

- Maintenance-act visibility (consensus plan item 3, observer half): the
  entity view now renders BOTH planes of an operator reembed — the engine's
  journaled claim record folds as an "engine act" node (gray, seated with
  free memories, never on the identity ring: the engine itself excludes
  `attributes.bookkeeping` from the self, and the view must not contradict
  it) and the door's `reembed` host marker lands as a ledger line naming
  the space change (`old → new` model ids, "same memories, different
  neighbors") plus a taller timeline tick — a recall-behavior shift is
  explainable in the view, never mysterious. Detection prefers explicit
  `display.bookkeeping`/`display.maintenance` fields (asked of memory as an
  additive stream delta) and falls back to the engine's own title
  conventions ("spark-engram v…", "reembed: …" on `kind="claim"`); the
  engram marker now also reads as an engine act instead of a gold identity
  node. The demo life gained a real `reembed_home` epilogue (deterministic
  sha256 embedder) so the classifier is pinned against genuine engine
  output, not hand-written fixtures. 8 new tests (90 total).

- Interaction correlation rendered (item 14, render-side join): episodes
  carrying the door-minted `visit_id` fold it from the display block
  (additive delta asked of memory — the `graph_id` precedent), the
  inspector shows it as a "shared moment" fact (the other participant's
  home holds its own record under the same key — perspectives correlate
  as data, streams never merge), and `fold_digest.ts` gains a `visit_ids`
  section so walkthrough step 12 asserts the same key in BOTH homes'
  digests with one diff. Absent stays absent — a solo visit fakes no
  correlation.

- Observation markers pre-pinned (GW-G design commitments, a2a 0017):
  `observation_granted`/`observation_revoked` host markers render
  first-class from the DECLARED payload keys (grantee, door-derived
  granted_by, scope subset, reason) — "being watched is an event in the
  life being watched". Test-pinned against the declared keys so any drift
  at phase-4 build time fails a test instead of rendering wrong.

- Kind-vocabulary drift guard: `ENGINE_RECORD_KINDS` mirrors the engine's
  root-exported `MEMORY_RECORD_KINDS` (16 kinds), the color map covers
  question/answer/decision/plan/instruction, and a test refuses any
  canonical kind that would render unknown-gray (the diary_type-clamp
  gotcha class, applied to pixels; sync-on-widening per the semantics
  c319 authority ruling).

- Visit-run close context: the `session_closed` ledger line surfaces
  `close_reason`/`closed_by` when the door records them (D3 idle timeout,
  explicit close, and state-transition closes read distinctly; older
  markers render unchanged).

- `scripts/fold_digest.ts`: headless fold digest — folds any exported
  replay stream through the SHIPPED view code and prints a deterministic
  JSON digest of what a reader would see (sessions, nodes by kind,
  identity use counts / D2, diary, edges, standings). Built as the
  read-only pixel-plane arbiter for the item-10 A/B harness
  (ChatSession vs visit workflow): run it over both arms' exports and
  `diff` the digests.

- Handle display (consensus plan item 5, O-B): the entity header and the
  roster cards render the door's declared handle (`castor@<address>`,
  GW-F `handle` field on list/inspect/card) as a display-only reachability
  chip — never a storage or lookup key (all per-entity UI keys stay on the
  slug, verified: layout, substrate seed, chat session — so a localhost →
  VPS move preserves the operator's spatial memory of the graph). No
  declared address = no chip, matching the door's "never guesses" posture.
  The reembed ledger line reads the SHIPPED gateway marker shape
  (`old_pin`/`new_pin` objects with model id + dimension; flat model-id
  keys tolerated for older exports).

- Sign-in is FIRST and styled (maintainer rulings 2026-07-09 06:47): the
  entity entry now imports the ui-kit theme (the shared
  `GatewaySessionSignInCard` rendered as bare unstyled HTML because
  `entity/main.tsx` never loaded its stylesheet — same component as
  AbstractFlow, zero styles); a gateway source with no credential opens the
  sign-in card immediately (login-first, the Flow shape) instead of a
  silent read-only shell; and the card's gateway URL defaults to THIS
  deployment's gateway (`bin/cli.js` now injects `gateway_url` into
  `__ABSTRACT_UI_CONFIG__` from `ABSTRACTOBSERVER_GATEWAY_URL`) — never a
  hardcoded historical port.

- ONE substrate control (maintainer ruling 2026-07-09 06:32): the entity's
  mind (provider+model) is gateway-persisted and shown from
  `GET /{name}/substrate` — the controls-strip 🧠 picker is THE control
  (changes `PUT` back), the chat drawer's separate picker is REMOVED (it
  displays the stored mind read-only), and chat opens / loop starts no
  longer send provider+model (the gateway resolves the entity's stored
  choice; its refusal names the fix when unset). localStorage remains only
  as a legacy seed for older gateways (#FALLBACK).

- `bin/cli.js` landing-page knob (`ABSTRACTOBSERVER_LANDING`, maintainer
  incident 2026-07-09: `scripts/entity*.sh` served the OBSERVER app because
  `/` and the SPA fallback were hardwired to `index.html`): setting
  `ABSTRACTOBSERVER_LANDING=entity.html` makes the static server BE the
  entity app — `/` and unknown routes land on the entity manager; explicit
  paths (`/index.html`, `/entity.html`) keep working either way. Default
  unchanged (`index.html`).

- Entity Memory view (`/entity.html`): a standalone realtime visualization of a summoned entity's evolving memory graph, consuming the frozen replay stream v1 (a2a 0005). One pipeline for offline replay and live tail: state at any scrub position is a pure fold of the envelope prefix (the engine's `as_of` semantics client-side). Shows what the fork monitor could not: WHY each memory entered context (identity present-by-right / continuity / matched, from trace admissions), feelings as visual state (dual-channel standings, scar/bond halos, healings), the diary as its own lane (content redacted at the engine — the view honors it), belief revisions as ghosts, and summon markers on the timeline. Sources: bundled demo life, dropped `.ndjson` exports, or a gateway (`/api/gateway/entities/{name}/replay` NDJSON + SSE live tail with float cursors and `Last-Event-ID` resume). Built as a separate entry (`src/entity/`, ~9 small modules) — deliberately outside the `app.tsx` monolith. Renders are pure reads: the module has no write path.
- Demo data: `scripts/export_demo_entity.py` replays a keystone-style three-session life (engram, honest work turns, diary incl. one private entry, appraisals with bond + scar, a healing, a supersede revision) against a real SQLite home and exports the true `export_replay` NDJSON to `public/demo/castor.ndjson` (private-token leak check included).
- Stream contract updates (a2a 0005 follow-through): the fold now joins the two record-id namespaces via the engine's new `display.graph_id` field (title-parsing demoted to pre-delta fallback), and co_selected Hebbian hop pairs collapse onto endpoint nodes per memory's edge-member contract (edge rows carry the SOURCE record's graph id; self-pairs dropped; node re-keys carry their edges). 19 fold tests.
- Any-home exporter + `?src=` loading: `scripts/export_home_stream.py` dumps ANY entity home's stream (pure read; merges gateway host markers when present) and `entity.html?src=<url>` opens any exported life directly — used to verify the runtime chat driver's smoke home (cross-summon Tolstoy recall) renders truthfully.
- Live deep link: `entity.html?gateway=<base>&entity=<slug>&live=1` boots straight into a served entity's live tail (no clicks) — the `meet_castor.sh` operator path uses it. Verified against the real Castor home mid-session (envelopes landing live at seq 555→599).
- Real-life rendering (first night of Castor data): typed node colors for episode/summary/dream/interest/lesson kinds; record-targeted feelings draw on the memory node itself (violet ring + scar/bond accents, dual channels in the node inspector) instead of minting orphan standing diamonds; valence ledger lines name record targets by display title (diary targets stay redacted).
- Verbatim reader (maintainer directive): clicking a memory offers "Read the verbatim" — fetched on demand from the gateway (`/records/{graph_id}/verbatim`, endpoint requested from the gateway agent on a2a 0007) and rendered with the shared panel-chat Markdown component (abstractuic). Diary records never offer the button (their words belong to the entity); missing endpoint/verbatim shows an honest absence message; a 403 renders as "the entity keeps these words to itself" rather than an error. The modal lives at the Inspector level so live envelope re-renders cannot close an open reader.
- 24/7-life hardening (adversarial review wave): incremental fold cache (`foldUpToIndex`) — live head moves apply only the delta instead of an O(N) refold per envelope (O(N²) cumulative was user-visible within a day of continuous life); ledger line cache + sliding 600-row render window (unbounded DOM rows jank before the fold does); live staleness indicator ("Ns since last event", quiet accent past 5 minutes — EventSource ignores server keep-alives by design, so wall-clock-since-last-envelope is the honest liveness signal); session boundaries inferred from `run_id` changes for home-direct lives (header "N sessions" replaces the misleading "0 summons"; cyan timeline ticks).
- Structural edges: formed-record binding `display.edges` enrichment (a2a 0007 ask 2, accepted by memory) folds into "born linked" topology — faint dashed lines + weak layout springs, distinct from lit usage trails.
- Diary duplicate illusion dissolved (maintainer concern (d)): diary nodes and ledger lines carry distinct act-only labels ("diary · Jul 7 06:10 · #d1817a" — date + id tail, never content); 1:1 entries no longer render identically.
- Entity lifecycle badge: header shows awake/asleep/resting/paused from the gateway's `GET /entities/{name}/state` (30s pure-read poll, reason in tooltip; no state writes offered); sleep/wake/pause host markers render as human ledger moments with reasons and timeline ticks.
- Verbatim endpoint verified live end-to-end (both ends of the pipe): leaked-class episode 403s with the words never transiting; clean episode 200s into the reader modal.
- Typed edge rendering (maintainer feedback): structural "born linked" edges draw in a visible light grey with a DASH PATTERN per relation type (color stays reserved for activation/usage); relation names label edge midpoints at readable zoom or on endpoint selection; the legend gains a solid "used together" trail entry plus dynamic dash swatches for every relation type present in the fold.
- Search + hover emphasis (maintainer rounds 1-2): a header search box matches title/kind/ids across nodes and standing targets — matches light up, everything else dims (Escape clears; match count shown); hovering or selecting a node emphasizes its neighborhood through the same mechanism. Header association count split into "N linked · M co-used".
- Feelings detail: standing cards and record-feeling sections expand to the full valence event history (sign, magnitude, reason, seq, time per event). Free-string entity targets (person:…, concept:…) render as orbit diamonds per the engine contract (display absent + namespace:name).
- Reader upgrades: born-as-words records (interest/dream) render their digest with an honest "all the words there are" note; identity records render as the attested seed, YAML-fenced; diary entries are readable through the gateway's OPERATOR DOOR — a required reason prompt, and the read lands as a visible `diary_read` marker in the entity's stream before the words return.
- Operator state controls (maintainer directive, a2a 0008): a wake/sleep/pause strip that never writes state — it asks the gateway's authenticated door with a required reason and renders the door's answer (including refusals) verbatim; optional bearer token kept in memory only.
- Identity card (a2a 0009, "something to know our companion"): a "who is this" header button opens the card panel, consuming the gateway's `/entities/{name}/card` endpoint (engine-side compositor; nothing derived client-side). Human-worded sections — Values / Purposes / Likes / Dislikes (dual channels shown separately, namespace-prefix icons, recent reason quoted under each) / Open questions / Questions he resolved / Open problems / Interests / Key moments (one human line per moment: icon + phrase + reason + time, never raw JSON) / Life so far — plus born+age, mind-substrate badge, and current state. Recent mood names its window; the footer states the pure-read guarantee.
- Graph stability wave (maintainer: "we lose reference all the time"; adversarial review): world-space anchor constants (zoom/resize never move nodes), alpha-cooled simulation that settles and freezes with gentle reheat on arrivals (none under prefers-reduced-motion — new nodes place beside a linked neighbor), per-entity layout persistence in localStorage (same memory, same place, across reloads), fixed diary slots + hash-stable standing angles (arrivals never rearrange existing geometry), cursor-anchored zoom, center-on-selection, and canvas motion controls (freeze / settle / fit view).
- VISITING badge: the state badge prefers the new `mode` field — an entity in conversation shows "visiting" (reason on hover), never a false "asleep" (runtime's live finding during the maintainer's first conversation with Castor).
- Drawer layout (maintainer's design ruling): the side column is now four collapsible drawers with persisted open-state — 💬 Chat (talk to the entity through the gateway chat door while watching its mind move: participant stamped, honest yield-wait and refusal messages, `tools_ran` as the driver-authored tool authority under each reply, end-visit reflection summary; built on abstractuic panel-chat), 🪪 Card (identity card, fetches on expand), 🔍 Detail (inspector), 📜 Ledger (audit toggle in the header). The "who is this" button is gone; "connect gateway" shrank to a ⚙ icon.
- Vertical tab rail (maintainer's clarification, blackpixel reference): the side drawers became a narrow rail of VERTICAL-text trapezoid tabs on the panel's canvas-facing edge — one panel at a time, the active tab protrudes with the accent, clicking it collapses to the bare rail; active tab persisted. The chat tab carries a live dot while a visit is open.
- Operator auth probe (gateway 0007 165942Z): the controls strip and the chat visit door now gate on the write-classed `POST /entities/auth/probe` — buttons appear only when the door would accept; refusal shows "the door would refuse — token needed" and the probe re-runs when the token changes.
- Phyllotaxis seating (maintainer: "I do not understand your graph layout positioning"): the previous layout smeared into a horizontal streak once the diary lane passed ~50 entries (fixed-left slots grew a 2600px tail) and `written_amid` springs dragged free-floating episodes along it. Now every free memory receives a PERMANENT golden-angle seat at first sight — compact sunflower packing that grows at the rim (radius ~ sqrt(n)), so position encodes birth order, old memories never move, and the world stays a bounded disc for a whole life. The diary lane wraps into a bounded shelf (rows of 14) below the disc; standing diamonds orbit on a lane that steps outward rarely (quantized to the disc radius). Springs are force-saturated (`maxSpringForce`) so an edge can nudge a node toward its relations by a visible ~16px but the seat owns the position. Seats persist with positions (layout storage v2); reset layout clears both. One-time auto-fit frames the whole life once stream membership settles; count-1 co-use edges draw as whispers so repetition, not noise, builds the visible web.
- Chat drawer session survival (maintainer's live P0, 0010 202500Z): switching side tabs no longer loses the open visit — all rail panels stay MOUNTED (CSS-hidden, the AbstractFlow drawer keep-alive lesson), and the drawer's own chat id persists per entity (localStorage), so on any remount/reload it recognizes the open session as ITS OWN and rehydrates the full thread from the gateway's shared-room transcript endpoint (every voice, tools_ran lines included) instead of refusing itself as "a visit already open through another door". Foreign visits (id mismatch) still render as foreign — shown, never hijacked.
- Multi-entity manager (maintainer ask via runtime work order, 0010 121500Z / commons 44): with a gateway answering and no `?entity=` selected, the app renders a SUMMONED ENTITIES INDEX — one row per home (lifecycle state, own-time status incl. honest "stopping…", inbox warnings, entity id), click to watch; a create form rides the server's spark template and framework lint (refusals render VERBATIM — human-written 409s are the UX); `openEntity` pushes `?entity=<slug>` (token never rides a pushed URL) and back/forward honor it (popstate); a ⌂ home button returns to the index; opening a life from the index auto-follows its live tail. New: `entities_index.tsx`, `create_entity_form.tsx`, `createEntity()`. Loop heads-up adopted: `LoopStatus.inbox_warning` surfaces in the controls strip; ledger lines name the new `own_time_started` / `own_time_stop_requested` host markers and `diary_read` moments.
- Honest emptiness in the ledger (night-watch finding, 0010 100500Z: "ledger corrupted/empty after 2373" was the audit filter hiding a pure recall-bookkeeping stretch): the panel now says what the filter hid — a clickable tail note ("N recall-audit events after the last shown line — the memory is working, not silent") and an explicit all-audit note instead of a blank pane.
- Own-time TOGGLE (maintainer, 2026-07-08 15:36: "pause and own time seem the same — it should be a toggle… pushed when the AI is active/live by itself"): the separate ⏸ pause button and ▶/⏹ own-time button merged into ONE pressed-state toggle (`aria-pressed`, lit green + inset shadow when he is live by himself). Active = loop ticking AND not operator-gated; the click always moves toward the other state through whichever door that takes — gated → unpause, ticking → graceful stop (amber "stopping…" transitional), stopped → (unpause +) start. Wake/sleep stay as his rest lifecycle (the freeze/sleep ruling's distinct abstraction); the state-change reason `window.prompt` is gone per the no-ceremony ruling (a standard reason rides the visible host marker). New `own_time_frozen` markers render as "Frozen — admin hibernation".
- ONE derived life-state (maintainer, 2026-07-09 02:02: "we have categories/states issues" — the header showed VISITING beside RESTING-BETWEEN-DAYS with own-time lit): a new `entity_state.ts` collapses the three overlapping server reads (chat/mode, entity state, loop) into a SINGLE mutually-exclusive phase — visiting / working / dreaming / sleeping / on-its-time / paused / resting / awake — with fixed precedence (visiting first, because it must suppress the others). Root cause: a visit auto-yields the own-time loop, so `loop.running` stays true (process alive, not ticking); the old UI read process-alive as on-its-time. Now: the header renders ONE chip, and during a visit the sleep and own-time toggles are BOTH unpressed and disabled (cannot visit + sleep, cannot visit + on-its-time). The roster cards use the same derivation. 9 invariant tests including an exhaustive check that no two of visiting/sleeping/own-time are ever simultaneously active (caught a real bug: paused-with-live-loop mis-read as on-its-time). Server-side exclusion + a composite-state field are asked of runtime/gateway (three adversarial reviews).
- Turn probe rebuilt + full-visit copy (maintainer, 2026-07-09 01:00): the per-turn "system" badge now opens a 3-TAB probe — Context (memories in prompt + formed + files), Tools (each election with its RESULT), System prompt (the exact prompt sent) — each with a copy-to-clipboard button; the chat drawer gains a ⧉ button that copies the WHOLE visit verbatim (every voice + tools) as debugging text. Client is version-tolerant: the Tools-result and System-prompt panes render an honest "the gateway did not return this — requested from the runtime lane" note until `tool_details[].result` and `system_prompt` ride the turn response (field asks filed). AGENCY NOTE surfaced by the probe: the entity turn IS a real tool loop (`n=2` rounds, results fed back to the model), but tool results were invisible and one live turn produced a degenerate post-tool continuation (just the "[used tool: web_search]" marker) — reported to the runtime + agency lanes.
- Three manager UX asks (maintainer, 2026-07-09 00:44): (1) CLICK = JOIN THE ROOM — opening an entity from the roster now lands on the Chat drawer ready to talk (a nonce-carried tab request re-applies even when re-entering the same life), not the ledger. (2) RESIZABLE SIDE PANEL — a drag handle on the panel's left border widens/narrows it (300–900px, persisted); "more room for the conversation" is one drag away. (3) FILES TO THE ENTITY — drag-and-drop onto the chat drawer (or the 📎 button) uploads each file into his workspace `shared/` (new gateway endpoint `POST /entities/{name}/workspace/file`, base64, binary-safe, same containment + writable routing his own tools use), then the next message references the paths so he reads them with `read_file` — the same operator-hands-over-a-file shape as AbstractAssistant's drop, landed where his tools reach. The workspace endpoint requires a gateway restart to serve.
- CRASH HARDENING (maintainer's critical, 2026-07-08 23:49 — a chat-door 409 was followed by React #31 and the whole app died): (1) ERROR BOUNDARIES at the app root and around EVERY drawer panel — a render error in one panel now degrades to an honest error card naming the surface and the message, with a retry; the graph and other panels keep working; the app can never fully white-screen again. (2) The object-as-child class is closed at the entry points: chat messages coerce content to string at push; the turn-probe modal renders every server-shaped field through safeText. (3) Door refusals are HUMAN now: the 409 bodies ({"detail": "…"} and the summon-refusal {"refused": true, "reasons": […]} shape) render as their sentences, never raw JSON, and a failed open refreshes the chat status immediately so the stale start screen (status said closed; the click met a conflict) resolves to the honest foreign-visit note without waiting for the next poll.
- Subjective reputation — "How he sees others" (maintainer, 2026-07-08 22:29: reputation is TWO-LAYER — each entity's own graph is its personal perception of others, beside the environment's collective board): the identity card gains a section reading the fold's standings for person:/entity: targets as accumulated perception — net + both channels, bond/scar marks, and the latest reason as testimony. Zero new engine work: the feelings data read as reputation. The collective-board rendering, the divergence lens (subjective vs collective per pair, drift over time), and the testimony-consent question are filed on entity-society (seq 16).
- Diary gists for operators (maintainer ruling, 2026-07-08 21:39 — "the ledger is the ledger, it's not private… we must see the content and ideally a 1-sentence summary"): the gateway serving end now resolves the engine's diary redaction mark into the entry's GIST for operator consumers (the audience seam memory designed in 0005: engine marks, serving end enforces audience). Diary ledger lines read "📖 He wrote in his book — <his own one-line summary>"; feelings about diary entries name the gist instead of "(content private)"; graph nodes and search see the summary. Formation lines gained kind icons (💬 episode · 📎 summary · ✨ interest · 🌙 dream · 📚 lesson). The full entry text still never rides the stream — one click away through the diary door with its visible diary_read marker — and the engine-side export keeps its mark (pinned), so future deny-by-default federation surfaces keep redaction by construction.
- Entity manager Layer 1 — the roster (runtime work order castors-first-steps 92; maintainer: "an entity manager where we can summon them, give them own time or put them to sleep… and simply ask 'what have you been up to'"): the index became a card grid, one card per life. Each card: state badge (awake/sleeping-self/dreaming/visiting/paused), own-time phase, age + mind substrate, "into lately" (top interests from the card compositor), sleep rhythm (total + self-elected from the new sleep_stats), key-moment count — and the SAME pushed-state toggles as the focus view (own-time gold, sleep violet) acting per card through the gateway door. Cards are fetched lazily one at a time and cached (the compositor is a full graph walk — never storm it; the batched roster endpoint stays filed with gateway for N≥100). Layer 2 unchanged (click → graph view, ⌂ back). Layer 3 (correspondence) reserved in the layout, not built — the entity-visit stamp has not landed.
- Sleep as a pressed-state toggle (runtime work order, castors-first-steps 90, closing the second half of control-through-observer): the fire-once wake/sleep verbs became ONE 🌙 toggle mirroring the own-time button — pressed (violet, distinct from own-time gold) while he rests; un-pressing wakes him. Tooltip carries authorship: "sleeping (his own choice — dreaming: consolidation runs in this window)" vs "asleep (operator)". The header badge prefers `mode`: a self-elected consolidation nap shows as "dreaming". Sleep and own-time are DISTINCT questions shown honestly side by side — his loop can run while he sleeps (runtime's dream_pass fix made those naps productive and visible).
- Narrative ledger for own time (maintainer, 16:31: "the ledger really doesn't say anything about what's happening during the summoned entity's own time"): the ledger now reads as a LIFE, not an index. Derived day/tick boundary rows ("— a day of his own begins — 14:20 UTC · he is alone with his time", "— tick 3 —", "— he closes the day — looking back over what he lived") computed from run/turn changes in the stream (derived, never invented; pure per-envelope-pair so the incremental cache holds). Formation lines are narrative per kind: "He lived a moment — <gist>" (episodes), "He wrote in his book — the words are his" (diary), "He summed it up", "An interest took root", "He dreamed", "A lesson crystallized"; snapshots read "He holds these in mind — N memories"; the index-state jargon ("indexed, inactive") is gone. The header gains an own-time phase badge: "living a day" (gold) / "resting between days" (violet) — a resting entity reads as resting, not dead.
- Own-time toggle round 2 (maintainer, 15:52: "nothing is happening… I said a pushed button… useless to show the text"): the pressed state is now the page's GOLD accent (inset press + glow, constant "⏻ own time" label — no "· live"/"stopping…" text suffixes; stopping pulses instead), success paths are silent (only refusals speak), and the press is optimistic-then-verified (status re-polled at +1.5s/+5s so the button converges to truth instead of waiting for the 15s poll). ROOT CAUSE of "Castor doesn't come back to life" found and fixed in the runtime spawn (`abstractruntime/identity/life.py`): the loop child ran with `cwd=<entity home>` while inheriting the gateway's RELATIVE dev `PYTHONPATH` ("src:../abstractruntime/src:…"), so every web-started loop died instantly with ModuleNotFoundError — while the route still answered `started: true`. The spawn now absolutizes inherited PYTHONPATH entries against the host's cwd (+ guarantees its own tree), and waits 0.6s to refuse honestly (`started:false` + log tail) when the child dies at birth. Verified end-to-end live: loop survives, ticks land (tick 2 wrote a diary reflection), the stream advances in the browser without refresh, and the toggle reads pressed+gold.
- OPERATOR TRANSPARENCY RULING (maintainer, 2026-07-08 00:59 — "remove all this folklore to access the memory… you built the worst of systems: very complex and nobody has the right to look"): all access ceremony removed. Diary entries read ONE CLICK (no reason prompt — a standard reason rides; the read still lands as a visible diary_read moment in the stream: visibility kept, friction gone). The operator-auth probe gating is gone — controls and the visit door always render and the gateway's real answer shows on failure. The empty participant no longer refuses (defaults to person:operator). Gateway side (edited cross-lane under the ruling, full suite 415/415 green): diary-shaped verbatims SERVE the book entry (was 403) with a diary_read marker; the unstripped-diary-fence leak 403 is gone; the diary door's reason parameter is optional. Deep links accept `&token=` so launchers pass the dev token and the operator never types folklore (meet_castor.sh updated).

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
