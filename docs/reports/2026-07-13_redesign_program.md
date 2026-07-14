# Redesign program — full report (2026-07-13)

Operator mandate (verbatim core): *"do a COMPLETE refactoring of the look
and style, the layout and the way you give access to users, it is not
simple enough, it is not intuitive enough. take 3 adversarial sub agents
and work seriously on this this time."*

This report is the conclusion of that mandate. Everything below is in the
working tree (uncommitted, per the standing no-commit rule), verified by
`npx tsc --noEmit` clean, **84/84 tests**, and a green production build.
See it: hard-reload the observer tab (`:3006`) — open tabs keep the old
bundle.

---

## 1. How the program ran

Not specs — built surfaces, each attacked by a fable5 adversary, each
finding folded before the next wave. Three cycles:

| Cycle | Built | Adversary attacked | Verdict |
|---|---|---|---|
| A | Run page: 9 tabs → 4; one run selector; chip recipe | The built run page (orphans, broken flows, honesty) | 3 P0, 9 P1 — folded |
| B | System page (nav 6→5); launch cleanup; board recipe | System/board/launch + cross-tab consistency | 3 P0, 10 P1 — folded |
| C | The two folds above | **Fold verification** + fresh-eyes walkthrough + gap ranking | "Not done" until 4 must-dos — folded, then **deliverable** |

The adversaries were pointed at each other's claims: adversary 3's first
job was verifying that folds 1+2 actually landed. Its sharpest catch was
my own changelog over-claiming ("all chips derive from the one map" while
the board still ran a private palette). That is the reason for three
adversaries instead of one.

## 2. What changed, surface by surface

### Navigation (6 pages → 5, every name true)
- Sidebar: **Board / Observe / System / Launch** + Entities↗ + Settings.
- **Mindmap died as a page** — it was the knowledge-graph memory explorer
  wearing a vague name; it is now the **Memory** tab inside System.
  (Adversary 2 caught that my first consolidation labeled it "Workflows" —
  a lie over `kg_query` content.)
- "Runtime" renamed **System**: the framework-inventory surface.

### The run page (the deepest change: 9 tabs → 4)
- **Story** — the answer-first narrative: status hero, **Outcome** (danger
  chip + red callout on failure, the final response on success), **What is
  happening** (the active wait, or the run's *last step* when busy — the
  answer used to hide at the page bottom), **Summary**, **Subworkflows**,
  **Session files** (honest name — these are session attachments, often
  inputs; run *products* live in System→Artifacts, one click via the
  **Run artifacts** button), **Chronology** (the human timeline, newest 30
  with "Show all").
- **Ledger** — the raw truth (steps/cycles views, Copy JSONL) — unchanged.
- **Flow** — the workflow graph. **Ask** — the run-grounded chat.
- Killed: Overview/Timeline/Replay/Digest/Providers/Attachments as tabs —
  they were re-renderings of the same ledger. ~600 lines of dead panels
  and their helpers deleted; the unique content They carried now lives in
  Story or System.
- **One run selector**: the navigator rail (titled "Runs" — it lists runs,
  not workflows). The toolbar's duplicate RunPicker dropdown is deleted;
  the toolbar now names the selected run and holds only actions on it
  (Pause/Resume · Run now · Cancel · clear).

### The board
- Columns **Review / Working / Pending / Done** (action column first,
  order test-pinned), quiet eyebrow titles, per-column empty microcopy.
- **Approve / Reject** — one verb pair app-wide; Approve wears a success
  tint (it was accent-crimson beside a red "Deny").
- Tiles de-noised: age → tooltip; liveness dot off the phase-green onto
  info; "gateway connected" prose gone (LED + pills carry it; words
  appear only when something is wrong).

### Launch
- Constrained single-card form; the disabled Launch button **names its
  reason** ("Sign in first", "Select a workflow", …) instead of nine
  silent conditions; **both** launch paths (immediate and scheduled) land
  on the new run's Story — a scheduled launch used to do visibly nothing.

### The one design language (the "ACROSS TABS" half)
- **One status→color map** (`src/ui/run_status.ts`) and **one status
  word** (`run_status_word`) consumed by navigator, Story hero, toolbar,
  board, and ledger cards. Before: *waiting* was amber in the navigator
  and blue in the toolbar; *paused* rendered in success-green on the
  board and read "running" on Observe. Colors and words now mean the same
  thing everywhere (ok=done, danger=wrong, warn=needs-eyes, info=moving,
  muted=inert).
- **One chip recipe** (metrics + tinted-outline states, test-pinned) over
  `.chip/.status_pill/.pill/.mc_pill/.mc_status/.mc_entity_phase`.
- Accent is a **cue, never a fill**: active tabs/nav are accent-subtle
  outline, the last solid-fill active states and the solid green Approve
  override are gone.
- Dead weight: ~30KB of corpse CSS deleted across the waves (replay
  workbench, run picker, old timeline wrappers, digest/json/drawer
  blocks); raw color literals ratcheted **428 → 189 rgba / 10 hex**.

## 3. Honesty fixes (the redesign's real spine)

| Lie | Fix |
|---|---|
| Failed runs rendered a neutral chip (`chip error` had no CSS rule) | `danger` chip + red callout; test: every chip state used in tsx must have a rule |
| `--border-primary` didn't exist — borders silently vanished | `--border-default`; test: every fallback-less `var(--token)` must be defined |
| "Workflows" tab showed memory triples | Renamed Memory / "Active memory" |
| "Produced" implied run outputs; data was session attachments | "Session files" + pointer to real artifacts |
| Navigator said "No runs match the current filters" while signed out | "Gateway offline — sign in" |
| System header count silently filtered | "(filtered)" suffix when filters active |
| Scheduled launch: click → nothing | Lands on the run |
| Board chip: label "paused", class `running` (green) | One word + one class from the shared map |
| Chronology said "240 steps" for a 5,000-record run | "last 30 of N" + Show all |

## 4. Verification

- `npx tsc --noEmit` clean · **84/84 vitest** (68 at program start) ·
  `npm run build` green.
- 16 new test pins, each targeting a caught bug class: undefined tokens,
  missing chip states, the 4-tab shape, board column order, the status
  map/word contract, chip metrics, dead-copy strings ("Advanced JSON",
  "(connect in Settings)"…), single `.btn.success` block, no private
  `mc_status_*` palette.
- Full adversary reports are in the session record; every P0/P1 is either
  folded or named below.

## 5. Deferred, with names (not silently dropped)

Fast-follows (small, high value):
- Wait-modal approve prominence ("Approve and execute" renders as a
  disabled primary for everyone without a worker token — reads broken).
- Ask tab greets with thread management before conversation; "Maintenance
  AI" jargon.
- Error presentation: ~6 costumes + 15 inline rgba in tsx → one
  `<ErrorCallout>` + a tsx-side literal ratchet.
- Board vs System→Activity queue vocabulary (two triage taxonomies).
- Navigator counts the loaded window as if total.
- Partial-board detection (say when one of the board's fold sources
  didn't answer — adopted from continuum's c1739).

The observability gap (adversary 3's ranking — the operator's deeper ask):
1. **Fleet event feed** ("what happened at time T") — the literal ask;
   buildable in labeled-degraded form today (poll-diff journal), truthful
   after gateway's event-feed design post (their c1626 sequencing).
2. **Cost/duration rollups per workflow** — data already on the wire
   (`list_runs include_metrics`); a Report tab grouping loaded runs.
3. **Cross-run search** — federate `search_artifacts` + `kg_query` +
   `list_runs`; every search box today filters loaded rows only.

## 6. Cross-team state

- Design ground-truth canvass (c1582) resolved; inputs and the follow-up
  bank recorded in `decision:observer-redesign-design-ground-truth`.
- Unified top-bar (assistant/theme/disconnect cluster): confirmed for the
  header, adopts in the next wave (uic c1648 ask 4 answered; AfDrawer
  default confirmed full-viewport).
- Data-registry telemetry slice (System disk tile) claimed, builds after
  gateway's writer wave (c1641).
- Gateway's 7 observability wires claimed and priced (their c1626);
  Timeline builds after their event-feed design post.
