# UI rethink — full redesign plan (2026-07-12)

> STATUS UPDATE (same day, evening): PARTIALLY SUPERSEDED by events.
> Wave 1 shipped (Mission Control board = the health screen with inline
> approvals + live polling; graph lenses; cross-links both ways; the
> `ABSTRACTOBSERVER_LANDING` knob is GONE). The maintainer then directed a
> second split: the ENTIRE entity app moved to `../abstractentity`
> (github.com/lpalbou/AbstractEntity) — every "entity app" work item below
> (entity.css token cut-over, `entity_tokens.test.ts` flip, roster landing)
> now belongs to that repo's backlog, not this one. Observer-scoped items
> (app.tsx structure, run-panel tab consolidation, design-token unification)
> remain live here.

Maintainer directive: "the functionalities we have are good but the design and
access to them is average" + the same-day purpose split (CI/CD development
surfaces moved to `../abstractcontinuum`; the observer's purpose narrows to
OBSERVE AND DISCUSS). Three adversarial reviewers (fable5) attacked the UI
from three lenses — A: information architecture + first contact; B: expert
operator, density, realtime, multi-subject; C: design system + implementation
path. This document folds all three. Everything below is code-cited in the
reviewers' full reports (kept in the session transcript); the load-bearing
citations are repeated here.

## The verdict in one paragraph

The product is TWO apps that don't know each other (zero links between
index.html and entity.html), a main app whose navigation mixes intents with
backend data sources ("Observe" vs "Runtime" both show runs/ledgers), a
9-tab run panel where the most common operator question ("what did this run
say / cost / touch") spans 3-4 tabs, an approval flow that COVERS the stream
it interrupts, a run list that only updates on manual Refresh, and two
design languages (~9 blue families, ~28 chip variants, 2 modal systems,
2 z-index scales). The entity app is the better-designed surface but the
worse design-system citizen (184 hex literals, 127 fixed px font sizes, no
theming). The 9.9k-line app.tsx makes every fix expensive — structure first,
then paint.

## Top findings (cross-reviewer, deduplicated)

1. THE TWO APPS ARE MUTUALLY INVISIBLE (A). No link/tile/mention of the
   entity app anywhere in the main app; discovery is folklore
   (ABSTRACTOBSERVER_LANDING). Cheapest fix in the whole review: an
   "Entities" nav tab (one anchor) + a "⌂ Observer" backlink in the entity
   header.
2. NO SCREEN ANSWERS "IS EVERYTHING HEALTHY?" (B). The run list never
   auto-refreshes (no interval, no visibilitychange re-poll — only the
   attached run polls at 2s); the closest thing to a fleet queue lives on
   the Runtime page rendered from the same stale snapshot, with the wait
   fully displayed but NO approve/reject buttons; entity health lives in the
   other app. A pending approval on a non-attached run is invisible until a
   human presses Refresh.
3. APPROVALS ARE A MODAL OVER THE EVIDENCE (B). The full-screen wait modal
   covers the ledger it asks about — and embeds a reconstruction of the
   context it hides (records.slice(-10)). One dismissed wait_key; N waits =
   modal storm at fleet scale.
4. THE ANSWER HAS NO HOME (A). Overview shows an AI-GENERATED summary, not
   the run's final answer; cost lives in Providers/Digest; tools in
   Ledger/Timeline. Overview and Digest even duplicate the same
   generate_summary action.
5. OBSERVE/RUNTIME IS A FALSE SPLIT (A). Named by data source, not intent;
   Runtime's run-scoped Logs re-implements the Observe Ledger/Providers
   tabs; cross-jumps mutate hidden filter state with no breadcrumb.
6. REALTIME HONESTY IS ASYMMETRIC (B). The entity app has
   wall-time-since-last-envelope, reconnect badges, progressive-load
   counters; the main observe stream has NONE — a dropped SSE looks
   identical to a healthy idle run.
7. SCALE GAPS REMAIN (B), post record-buffer/digest-gating wave: the observe
   ledger renders up to 800 non-virtualized cards with silent truncation;
   ledger_record_items / cycles_run_counts / provider_activities rebuild
   full-array per flush regardless of tab; FleetTile fetches ENTIRE lives
   (since_seq=0 — Castor is ~98MB/67k events; a 5-entity wall is a
   half-gigabyte page load); entity backward scrub re-folds from zero at
   resident scale.
8. DESIGN-SYSTEM DRIFT IS COUNTED, NOT VAGUE (C): ~9 blues, 5 reds (two
   "danger" hues in one file), ~28 chip systems (paddings 2×7→6×10, radius
   999 vs 6), 8 border radii in live use, 4 mono stacks in entity.css, 2
   modal systems, 2 z-index scales, 93 inline style objects in app.tsx.
   Light themes are advertised (21 kit themes, 6 light) but unusable: 124
   dark-assuming rgba literals in styles.css; entity hardcodes
   applyTheme("observer-night") and ignores theme classes entirely.
   graph_canvas.tsx hardcodes 42 canvas colors — theming can never reach
   the app's centerpiece. Kit --text-muted #666 on --bg-primary ≈ 3.0:1,
   below AA.
9. A11Y IS SPARSE (C): Modal lacks role="dialog"/aria-modal/focus trap;
   :focus-visible styled 0× in entity.css; entity side tabs are emoji-only
   (💬🪪🔍📜) with no visible names; 10px labels.

## The target design

### Main app: three intents + one run workspace

    ┌──────────────────────────────────────────────────────────────────┐
    │ ◉ Observer   [ Fleet ] [ Runs ] [ Launch ] [ Memory ] [ Entities ]│
    │                      gateway ● · 2 approvals · alice@local · ⚙    │
    ├──────────────┬───────────────────────────────────┬───────────────┤
    │ RUN LIST     │ RUN WORKSPACE                     │ DISCUSS (chat)│
    │ (live, auto) │ header: name·status·duration·     │ docked rail,  │
    │ ○ needs you  │   tokens·cost·▶controls           │ collapsible,  │
    │ ○ active     │ ┌─────────────────────────────┐   │ run-context   │
    │ ○ finished   │ │ Answer | Trace | Structure  │   │ pre-seeded    │
    │ ○ scheduled  │ │ | Calls | Artifacts         │   │               │
    └──────────────┴───────────────────────────────────┴───────────────┘

- FLEET is the new landing page: the Runtime attention queue promoted to a
  live surface (needs-you band always on top: user waits, tool approvals,
  new failures — with inline Approve/Reject), runs grid + entities grid
  side by side, header badges for pending approvals/failures. Entity
  summaries come from the roster/card endpoints, not whole-life folds.
- RUNS = Observe + Runtime merged (one run list — kill the duplicate
  toolbar RunPicker; runtime-wide artifact inventory + audit move to a
  System section). Tabs 9 → 5, named by the question they answer:
  Answer (Overview⊕Digest merged; the run's ACTUAL final output first, AI
  summary second, ONE generate button), Trace (Timeline+Ledger+Replay under
  one surface with Human/Raw/Workbench density toggle), Structure (Graph),
  Calls (Providers), Artifacts (Attachments; links to System inventory
  instead of hidden-state page jumps).
- DISCUSS leaves the tab bar: a collapsible right dock so observe→discuss
  is simultaneous, not modal; "Discuss this run" affordance on every tab
  (generalizing Replay's buried "Explain this run"); thread chrome folds
  into a kebab menu.
- APPROVALS become a dock (same slot as Discuss), not a modal; queue
  semantics (N waits = N rows, cross-run); the existing tool cards move
  verbatim; Runtime-inspector waits gain the missing Approve/Reject.
- Run controls (Pause/Cancel/Run now) move into the run header beside
  status. Header LED becomes a connect/identity popover; Settings keeps
  appearance + advanced only. Disconnected landing = the entity app's
  locked-card hero (URL + Connect + sign-in), never "No runs match the
  current filters".
- Mindmap renames to Memory with an explicit run/session scope selector
  (today it silently inherits observe-page state).

### Entity app

- Land on the roster when served from a gateway (demo becomes an explicit
  "load demo" affordance). Chat becomes the default side tab on gateway
  sources (the visit IS the core loop); side tabs get text labels; chat and
  a mini-ledger can stack during visits (turn activity lands in the ledger
  exactly when you're chatting). "⌂ Observer" backlink; meet/workspace/
  fleet controls get labels. Phase chip gains a tools-grant chip that
  deep-links into the workspace tools tab (3 clicks → 1).
- FleetTile switches to tail reads / roster cards (never since_seq=0).

### Design system (the path that makes the above cheap)

P0 foundation (~4-5 days):
  finish dead-CSS sweep + re-pin styles tests for what stays; ratchet test
  "no #hex outside :root" for entity.css; ENTITY TOKEN CUT-OVER (alias
  local :root tokens to kit --entity-* names; flip entity_tokens.test.ts
  from "copies match" to "observer consumes kit names"; route
  graph_canvas's 42 colors through one getComputedStyle readTokens()
  helper — the single highest-leverage day: all 21 kit themes start working
  on the surface the maintainer actually watches); entity typography
  normalization (127 px sizes → --font-size-*; 4 mono stacks → --font-mono;
  FontScaleSelect starts working there); styles.css semantic literal
  replacement (82×blue→--info-*, reds→--error-*, etc.; kit gains
  --accent-hover, --focus-ring, --z-* scale); contrast fixes at the kit
  (--text-muted ≥ 4.5:1).

P1 dissolve app.tsx + shared primitives (~7-9 days):
  extraction order by size×value, suite green between steps — (1) module
  helpers → format.ts/artifacts.ts/run_status.ts (~1,100 lines, pure);
  (2) RuntimeExplorerPage + console + LedgerCard → runtime_page.tsx
  (~1,250); (3) observe page + satellites → observe_page.tsx + parts
  (~2,300); (4) launch + settings pages (~470). End state: app.tsx ≈ 1,500
  lines of shell/state/wiring. Then ONE modal (kit, role="dialog" +
  focus trap; both apps re-shell), ONE chip (af-chip with data-tone,
  replaces ~28 variants), ONE button (af-btn; kills the bare-button vs
  .btn divergence).

P2 one-product layer (~5-6 days):
  kit AppShell (header/brand/LED/status pills/nav slot) mounted by BOTH
  apps; entity theme picker (possible once literals are gone); a11y pass
  (roles, labels, :focus-visible in entity.css, focusable ledger rows);
  4px-grid --space-* scale for new/extracted components.

Sequencing rule (C's push-back, adopted): do NOT paint before P1 — any
mockup applied to today's app.tsx becomes 93 more inline styles. Structure
first, then paint. Total ≈ 16-20 days across three independently shippable
stages; logic tests (22 files / 173 green today) pin behavior at every step.

## Priorities table (cross-lens fold)

| Pri | Change | Lens |
| --- | --- | --- |
| P0 | Cross-link the two apps (Entities tab; ⌂ backlink) | A |
| P0 | Live run list (5s visible / 30s hidden poll) | B |
| P0 | Fleet landing page with needs-you band + inline approve | B |
| P0 | Approval dock replaces modal; wait queue semantics | B |
| P0 | Disconnected hero on landing; connect popover on LED | A |
| P0 | FleetTile tail reads (kill since_seq=0 whole-life folds) | B |
| P0 | Entity token cut-over + graph canvas readTokens() | C |
| P1 | Merge Observe+Runtime → Runs; 9 tabs → 5; Answer surface | A |
| P1 | Chat → docked rail; steer composer slot beside stream | A/B |
| P1 | Observe stream honesty (last-event age, reconnecting badge) | B |
| P1 | Window the observe ledger; gate remaining full-array memos | B |
| P1 | Dissolve app.tsx (4-step extraction); one modal/chip/button | C |
| P1 | Entity: roster landing, Chat default, labeled tabs | A |
| P2 | Kit AppShell for both apps; entity theme picker | C |
| P2 | Keyboard layer (j/k runs, a/r approvals, 1-5 tabs) | B |
| P2 | Memory rename + explicit scope; breadcrumbed deep links | A |
| P2 | A11y pass; contrast + focus-visible + reduced-motion | C |

## Dependencies on other seats

- Steer composer component: uic (H4 door is open; placement decided here —
  pinned under the stream / in the fleet needs-you band).
- Roster/entity card endpoint for cheap fleet tiles: RESOLVED (gateway
  c1038, verified live): GET /entities/{name}/card already serves the tile
  facts + as_of_seq (the journal high-water) — the tile recipe is card →
  tail read (replay?since_seq=as_of_seq-N). Zero new endpoint fields.
- Run-list SSE (nice-to-have; polling is the honest v1): gateway.
- Kit tokens (--accent-hover, --focus-ring, --z-*, --space-*), af-chip/
  af-btn/af-modal, AppShell: uic (proposals, not unilateral builds).
