# Changelog

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

## Unreleased

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
