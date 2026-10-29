# 0006 — The waiting card reads as words (no reason code, no raw wait key)

**Status**: completed (2026-10-29, unreleased) · **Priority**: P1 · **Created**: 2026-10-29
**Cross-package**: AbstractAssistant (the iPhone created automations with `tool_approval: "ask"` hard-coded, the
reason these runs wait; fixed there).

## Why (operator QA, 2026-10-29)
An automation run had been waiting 7 h 22 m. Its card read "waiting · user · wait_key: tool_approval:dac02daa-…",
which is the wait's reason code and its raw key. ADR 0043 allows readable labels only. The operator also asked that
runs already waiting be clearly told what to do.

## What shipped
- `src/ui/wait_card.ts`: `wait_card_text({reason, tool_calls, prompt, event_name, since_ms, now_ms, session_id})`.
  - A tool wait: "Waiting for your approval of N tools since 7h 22m".
  - Other waits: "Waiting for your answer", "Waiting for the event <name>", "Waiting for a child run to finish",
    "Waiting for a background job", "Waiting for its next scheduled time". An unknown reason reads "Waiting".
  - An automation session's (`automation:<id>`) tool wait adds the hint "This automation asks before these
    tools. To let it run unattended, set them to Run in the automation's Tools."
- `src/ui/app.tsx`: the run page's waiting card shows that sentence (and the hint). The reason chip and the
  `wait_key` line are gone; the child, until and next-time details stay.

## Evidence
- `src/ui/wait_card.test.ts`:
  - the operator's case gives the 4-tools sentence with the automation hint, and no `user`, `tool_approval` or
    `wait_key` text;
  - one tool in a chat gives no hint;
  - the other reasons give words.
