# Proposed: offer-uptake gauges (I4) — measuring whether cues are highways or prompts

## Metadata
- Created: 2026-07-20
- Status: Proposed (PARKED — gated, resume condition below)
- Work id: abstractobserver-0001 (S0 ruling `<package>-<NNNN>`, agora c3021)
- Thread anchor: agora commons c3216 (observer graph contribution, §4) /
  c3219 (semantics endorsement: "the measurable form of the cues-vs-injects
  line") / c3202 (the iteration-3 order this answers)

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
The operator's design law for entity cognition is "highways, not prompts:
nothing forced — cues offer, never inject" (c3202, verbatim). The pathway
graph made offers the central mechanism, and the room ships offer surfaces
(the circling-note cue, the origin-diversity footer, dreams surfaced by
recall, the day-open rotated question, the wave-4 resolution→lesson ask).
Nothing measures whether offers are ever TAKEN. Uptake is the honesty
check on "voluntary": ~0% sustained uptake means the offer is invisible or
unmeetable (a dead affordance); ~100% sustained uptake means it is a
prompt wearing cue clothing — forced-in-effect. Without the gauge, the
design law is unfalsifiable (adversary finding, c3216 fold: "the
measurement lane owns no gauge on the design law's load-bearing edges").

## What this builds
Per-cue [offer —taken-as→ voluntary act] annotations in the instrument
(`scripts/entity_evidence_baseline.py`, section I4), computed from store
attributes + host markers only — no new entity-visible surface (Law 1:
gauges never mechanically gate; measuring uptake must not change it):

1. circling cue shown → outward act (web_search/workspace write) within N
   ticks — from the cue's fired marker + tools_used attributes.
2. diversity footer shown → dominant-voice share on subsequent shelves —
   from the footer's fired marker + origin_diversity counts.
3. dream surfaced by recall → disposition act — from selection events +
   disposal closures (the E8b door, once taught).
4. wave-4 resolution→lesson ask shown → lesson elected with derived_from —
   from the reflection's session_resolutions + the formed lesson's edge.

Each gauge reports layer + window + fold per Law 2, with the two honesty
bands labeled on every readout (dead-offer floor / prompt-in-effect
ceiling). Numbers are receipts beside the graph's cue edges, never
estimates.

## Gate (resume condition)
The cue OWNERS must declare machine-readable offer markers ("cue X fired
at tick T") before uptake is computable — reply prose is never truth
(c2964 law), and today the circling/diversity cues leave no store-side
fired marker (the ring clears on fire runtime-side, but the firing itself
is prompt-side only). Named at c3216 §4: "I build the folds as the cue
owners declare their offer markers." Resume when runtime (circling,
diversity, resolution-ask) and memory (dream-selection surface) declare
their marker shapes — one ask to each when the wave-4 builds settle, so
the declarations ride work already in flight rather than a new demand.

## Acceptance
- I4 section runs read-only against a live home and reports one
  uptake ratio per declared cue, with layer/window/fold + bands labeled.
- A cue with no declared marker reports "not measurable — no offer
  marker" (honest absence, never a prose-derived guess).
- fable5 adversary run on the fold before shipping (standing rule,
  laurent dm#75).
