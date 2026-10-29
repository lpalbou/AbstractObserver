# 0005 — Adopt panel-chat's `readAloudStep` export; delete the inlined copy

## Metadata
- Created: 2026-10-29
- Status: Planned — blocked on the next `@abstractframework/panel-chat` release (nothing is released tonight)
- Area: `src/ui/read_aloud.ts` (the inlined copy); `src/ui/observer_voice.tsx` (`use_read_aloud`),
  `src/ui/automation_discussion.tsx`, `src/ui/read_aloud.test.ts` (the importers)
- Related: AbstractUIC backlog 0065 (the rule, panel-chat PR #26) and 0066 (the kit-side tracker of this debt);
  AbstractObserver PR #8 (the inlining)

## Summary
AbstractObserver PR #8 (merged 2026-10-29) fixed "read aloud speaks a run chat's or a discussion's existing messages
on open" by applying the kit's rule — AbstractUIC panel-chat `src/read_aloud.ts` (`READ_ALOUD_INITIAL`,
`readAloudStep`, `readAloudPhase`, types `ReadAloudInput`, `ReadAloudPhase`, `ReadAloudReply`, `ReadAloudState`),
exported from `@abstractframework/panel-chat` by AbstractUIC PR #26. That export is in no published panel-chat
(0.6.4 is the newest; this app pins `^0.6.4`), so PR #8 shipped a VERBATIM COPY of the kit file as
`src/ui/read_aloud.ts`.

The copy breaks the operator's standing rule: shared UI behaviour is reused from AbstractUIC, never re-implemented
locally (AbstractUIC ADR 0001; the same rule that put the message footer spec in the kit, backlog 0004). It is
tolerated only until the kit ships the export. This item is the dated debt.

## What to do (when panel-chat with `readAloudStep` is published)
1. Bump `package.json` `@abstractframework/panel-chat` to the version that carries `read_aloud.ts` (AbstractUIC 0066
   names it), reinstall, relock.
2. `src/ui/observer_voice.tsx`, `src/ui/automation_discussion.tsx`, `src/ui/read_aloud.test.ts`: import
   `READ_ALOUD_INITIAL`, `readAloudStep`, `readAloudPhase` and `ReadAloudPhase` from `@abstractframework/panel-chat`
   instead of `./read_aloud`.
3. Delete `src/ui/read_aloud.ts`. `use_read_aloud` (the hook: scope + phase from each chat) stays — it is host wiring,
   not the rule.
4. `src/ui/read_aloud.test.ts` keeps passing unchanged.

## Acceptance
- `grep -rn "function readAloudStep" src` finds nothing; `readAloudStep` is imported from
  `@abstractframework/panel-chat` only.
- `npm test` green; CHANGELOG names the kit version adopted.
