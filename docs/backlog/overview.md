# AbstractObserver backlog overview

The Observer's own work items. Cross-package waves and release sequencing live in the root backlog
(`abstractframework/docs/backlog/`); items here cite their root parent. Item files are `NNNN_<slug>.md`: a four-digit
id, never reused, no dates. Lifecycle folders: `planned/`, `proposed/`, `completed/`, `deprecated/`.

Created 2026-09-27, when the first item completed. Before that, the folder had no overview.

## Counts (on disk, 2026-09-27)

| State | Items | Notes |
|---|---|---|
| Planned | 0 | |
| Proposed | 3 | 0001, plus two legacy date-prefixed files (`2026-05-08_gateway_capability_profile_alignment.md`, `2026-07-12_ui_rethink_redesign.md`) that break the naming rule; to renumber in a hygiene pass |
| Completed | 1 | 0002 |
| Deprecated | 0 | |

## Next recommended work

1. The Observer's part of the Automations v1 release (root backlog 0941): relock after the ui-kit publishes, re-run the
   suite against the published kit fixtures, then a minor release.
2. Root backlog 0940: the Automate form refuses server-owned input keys visibly (review 54 O-2).

## Completed

| ID | Item | Completed | Notes |
|---|---|---|---|
| 0002 | [Automations in the Observer](completed/0002_automations_observer.md) | 2026-09-27 | UNRELEASED. Automate mode, Automations page (kit panel), transcript as chat pairs, discuss, typed wait answers, legacy rows. `56af9b4`…`9685fe0`; vitest 159/159; Chromium walk 17/17 on gateway `5161785`; review 54 GO. |

## Proposed

| ID | Item |
|---|---|
| 0001 | [Offer uptake gauges](proposed/0001_offer_uptake_gauges.md) |
| — | [Gateway capability profile alignment](proposed/2026-05-08_gateway_capability_profile_alignment.md) (legacy name) |
| — | [UI rethink / redesign](proposed/2026-07-12_ui_rethink_redesign.md) (legacy name) |
