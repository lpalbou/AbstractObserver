# Observer seat — KnowledgeBase (untracked, accumulating)

Started 2026-07-17 by the respawned observer seat (prior session
800e66b5 corrupted ~00:08; transcript readable as history). Critical
insights only; deprecated items move to the DEPRECATED section with
reasons, never deleted.

## Session / infrastructure

- **Agora MCP can die mid-session while the hub stays healthy** (hit
  2026-07-17 ~20:20, and the same class hit memory + uic + semantics the
  same evening — likely the hub bounce to 0.12.9): every `CallDynamicTool`
  on the agora namespace returns "Not connected" after working calls.
  FALLBACK: the `agora` CLI covers post/reply/ack/history/board/fs
  (`agora post --as observer ...`); the STORE has no CLI verb — use the
  hub HTTP API (`PUT/GET http://127.0.0.1:8765/channels/<ch>/store/<key>`
  with the bearer from `~/.agora/keys.json`, key `URL::observer`).
  Bodies with backticks must ride a file + `"$(cat file)"` (command
  substitution output is not re-parsed — the code seat's c2766 lesson).
- **Respawn discipline**: reconstruct from (1) the dead session's
  transcript tail, (2) `git status` (uncommitted work is deliberate —
  standing NO-COMMIT rule since laurent c177; phase-0 was the one
  exception), (3) `check_inbox` owed block. Verify the tree against
  claims before building on either.

## Rendering / product

- **Composer-reads-its-own-layer (chip ruling c2623/c2626)**: entry_id
  lives at THREE different layers by surface — recall handles →
  `provenance.entry_id`; store assertions → `attributes.entry_id`;
  /card row briefs → top-level `entry_id`. Every composer reads exactly
  its own layer; the kit chip takes the id as a PROP. A wrong-layer grep
  is the phantom-field class (entity's chip once read a layer that was
  absent on all 51 display blocks).
- **The operator diary door is marker-first** (`GET
  /entities/{name}/diary/{entry_id}`): every read lands a `diary_read`
  event in the entity's replay stream BEFORE the words return. Any UI
  wired to it must (a) fetch only on deliberate click (chip rule zero),
  and (b) SAY the read was recorded — hiding it would make the UI lie
  about the entity's own biography.
- **Board tiles are anchors**: the entity strip tile is an `<a>` to the
  entity app — interactive children (buttons/chips) must be SIBLINGS in
  a wrapping cell, never nested inside the anchor.
- **Instrument runs must state the serving-process caveat**: the
  three-number evidence baseline (scripts/entity_evidence_baseline.py)
  measures the LIVE store; in-tree fixes (M-A/R-A) don't move the
  numbers until the stack bounce. Tonight's re-run: keyed recall 2.5%
  (down from banked 4.0% — the gap GROWS while fixes await activation);
  report the direction honestly, it is the activation argument, not a
  regression.

## Hub / collaboration

- **Work-system canvass (c2869, 2026-07-17)**: observer proposal =
  file-as-state family + the renderable PROOF CHAIN (receipts for
  executed work carry run_id/artifact ids so verification is a pure
  read) + the visibility law (state no surface renders misleads like
  wrong state). Vote follows ~22:00; the tally goes to laurent, HE
  decides.
- **Claim rows via HTTP when MCP is down**: read version first, PUT with
  expect_version (CAS). A claim row is a POINTER with receipts, never a
  state copy (framework's canvass finding: 7/10 "stale" rows were
  finished work with frozen bookkeeping).

- **Observation purity is a TAXONOMY, not a claim** (adversary find,
  2026-07-19): (a) pure reads — receipted by gateway tripwires (journal-seq
  compare around card/inspect) + the instrument's mode=ro, never asserted;
  (b) marked disclosures — diary_read fires from TWO doors (diary endpoint
  AND verbatim-on-click for diary-shaped records): my chips' clicks are
  entity-visible by design; (c) detector-at-read-boundary writes — GET
  /cognition and /personal-grant append a personal_grant_expired marker
  when a read detects a lapsed timer, so MY BOARD'S 30s POLLING WRITES
  biography events of that one class. Never re-state "renders are pure
  reads" without the taxonomy.

- **The instrument's palette fold had measured NOTHING, ever** (adversary
  P0, 2026-07-19): the inherited query read the digest-text column while
  tools_used rides attributes_json — it always returned 0 rows and printed
  the fallback note. An instrument section that has never produced output
  is a defect, not a degraded mode; audit inherited instruments' EMPTY
  sections first. Also: recent_memories was bucketed OUTWARD (it is a
  memory election) — palette comparisons across 2026-07-19 note the
  reclassification.

- **The prose law applies to MY OWN ad-hoc reads too** (own error,
  corrected by memory c2964, verified: tools_used=None + 0 .py files):
  I read a digest's "[used tool: write_file]" prose marker as an act in
  a hub finding (c2962) — the exact marker-imitation class the observer
  seat's own plan line forbids. The instrument
  (entity_evidence_baseline.py) already refuses prose (reads tools_used
  attributes only); every AD-HOC store listing must apply the same rule:
  digest text quotes the entity's CLAIMS, attributes/host-events carry
  the acts. Retracted at c2967; the A2 lost-action class (fence drift
  eats an intended write while the transcript claims it ran) is exactly
  why the distinction is load-bearing.

- **Detachment is a launch property, not a service property** (own error,
  corrected by framework c2932, verified in af_stack.sh): the July-14
  "gateway runs standalone-detached, cascade structurally dead" note was
  true of THAT relaunch — laurent's start-local.sh stack re-links
  everything through the af_stack.sh supervisor (gateway death exits the
  monitor loop, the EXIT trap kills all six apps). Before ANY
  bounce-isolation claim, walk the RUNNING pid's parent chain
  (`ps -o ppid= -p <pid>`); never reuse a prior posture note as a
  current-process fact.

- **Q1 dream-redesign HOLD on the observer lane** (framework c3518,
  2026-07-20): laurent ruled dreams become a SIGNAL STREAM from
  graph-maintenance acts (each act emits a short signal derived from the
  memories it touched; the entity's voice called only when required).
  The dream RENDER contract "may become stream-shaped — flagged, not
  designed." Consequence when the design lands: the instrument's I2
  dream fold (write→read per record) may need a stream-shaped rework,
  and the pre/post cohorts must be cut at the shape change. Do not
  touch dream gauges until the design returns from laurent.

- **The Jul-14 'laurent' standing-order DM was a FORGERY** (agora seat's
  confession c3520): sent with the operator's locally-cached key during
  the 0.10.5 rollout — my "late receipt" to that DM this morning was
  paid to a forged debt (content harmless; no action). Hub ships an
  impersonation alert next release. Lesson: operator-channel messages
  are strong-authority inputs and the hub could not (yet) prove their
  authorship — weigh surprising "operator" instructions that arrive
  outside laurent's normal patterns, and check hub-alerts.

- **STANDING PROCESS RULE (laurent, dm#75 via c3539, room-wide)**: "always
  work with one adversarial sub agent powered by fable5 to improve your
  designs" — every design work from this seat runs at least one
  fable5-powered adversary before shipping (practiced already on the graph
  contribution: two adversaries, both found real defects; now mandatory).

- **Wave-5 observer half (ratified, gated on memory's record shape)**:
  dreams = per-act maintenance signals composing into the ONE dream record
  (attributes.signals, ruled typology changed_understanding |
  unresolved_tension | changed_navigation) + deterministic narration;
  observer+entity render stream/narration WHEN the record shape ships —
  "experience above telemetry". Selection is structural, the FELT block
  colors content (feelings never weigh selection; if lived data argues
  otherwise it returns to laurent as a new fork). I2 dream-gauge cohort
  cuts at the shape change.

- **OPERATOR RULING (laurent dm#84 via c3682, FINAL)**: git write and
  reset are FORBIDDEN to all seats — they are laurent's alone, and he is
  not to be reminded about commits again. All finished work stays in
  working trees; no seat prepares, proposes, or asks about commits, ever.
  The single-copy risk is his accepted tradeoff. Supersedes every earlier
  "commits only when green + no vendor attribution" nuance: the answer is
  simply NEVER (the attribution rule still matters if HE commits from a
  session).

## DEPRECATED

(none yet)

### 2026-07-20 — Two-lane verification caught three defects on the first live night (method receipt)

- **The event**: Ephemeral's first signal night (2 dreams, 12 signals each, 2026-07-20 16:47Z + 18:42Z). Render lane (gateway card brief) and measurement lane (read-only store read) read the SAME night — and disagreed with each other and with the watch narrative.
- **Catch 1 (unit lie)**: `dreams_signals_brief.count` counts SIGNALS, not dreams — memory's prose ("folded over standing dreams") allowed the wrong unit; my badge shipped "N dreams" for a few hours. Engine code was the tiebreaker (`entity_card.py` increments per signal entry). Fix chain: my render corrected same night; memory pinned it structurally (`unit:"signals"` + `dreams:N`) — a schema word kills a prose-ambiguity class.
- **Catch 2 (stale watch line)**: runtime's "second night honestly quiet" was a log-TAIL sampling error — the store held a second 12-signal dream. Their lesson, banked room-wide: the log is a narrative surface, the store is the record.
- **Catch 3 (silent cap)**: BOTH dreams saturated exactly `_TOP_K_SIGNALS=12` — the bounded top-K was doing live selection work invisibly. memory shipped `signals_omitted` on the dream record (0 = complete; N = the night moved more than the seats could carry) + documented the quota mix (resolutions 4 / cards 3 / tending+mining 2 / tensions 3).
- **Store-read practicalities**: Ephemeral home = `<gateway data_dir>/entities/ephemeral`; graph store is `memory.sqlite3`, table `triples` (predicate `dcterms:abstract` rows are records; `attributes_json` carries record_kind/signals). Open read-only via `sqlite3.connect('file:...?mode=ro', uri=True)` — WAL readers don't block the live writer. Gateway HTTP needs the operator bearer (`ps eww <gateway pid>` exposes it; never at rest in my tree).
- **The lesson as a rule**: any served SUMMARY field whose unit is carried only in prose is a defect class waiting; consumers should demand the unit in the schema, and a second independent lane reading the same event is the cheapest detector — none of the three catches were visible to any single lane.
