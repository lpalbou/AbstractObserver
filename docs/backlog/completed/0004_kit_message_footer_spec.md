# Completed: run chat and discussions follow the kit's message footer spec (0.10.3)

## Metadata
- Created: 2026-10-28
- Status: Completed (0.10.3)
- Area: `src/ui/app.tsx` run chat (`ChatThread`), `automation_discussion.tsx` (`WorkflowChat`)

## Summary
Operator QA 2026-10-28, item 2: "we wanted both the speaker and copy icons permanent; where is the speaker? Show the
date when the message is not from today." The message footer is a shared primitive (AbstractUIC ADR 0001): the spec
is written once in panel-chat 0.6.4 (`message_footer.ts`, AbstractUIC backlog 0064) and this app adopts it by pin
bump, with no local twin of the card.

## What changes here
- `@abstractframework/panel-chat` ^0.6.4 (lockfile refreshed): in the run chat and the automation discussion a message
  not from today is stamped with its date ("Yesterday · 10:52 PM", "Oct 21 · 10:52 PM") and a reply with no text keeps
  its speaker (disabled with the reason); in the discussion (`WorkflowChat`) a streaming reply keeps its speaker
  (disabled) and the files-changed chip opens the structured detail panel. The run chat's messages carry no statistics
  and no live state, so those two do not apply there.

## Evidence
- The kit check `panel-chat/scripts/check_message_footer.mjs` (56 checks, mutation-checked) pins the behaviour.
- This app: tests and build green on the bumped pin (see the PR).
