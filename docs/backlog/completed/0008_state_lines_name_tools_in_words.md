# 0008 — The state lines name the tools in words (0007 follow-up)

**Status**: completed (2026-10-29, unreleased) · **Priority**: P2 · **Created**: 2026-10-29
**Cross-package**: the kit's `describeToolCall` nouns (AbstractUIC 0068), as in 0007, so it ships with the same kit
release. Stacked on 0007 (lpalbou/AbstractObserver#12).

## Why
After 0007 the calls read in words, but the state lines still named the raw tools: "needs your approval:
web_search, send_email" (the run's line, everywhere a run is listed) and "needs approval for web_search, send_email"
(Mission Control's card).

## What shipped
- `src/ui/tool_call_words.ts` `tools_phrase(calls | names)`: one phrase built from the kit's nouns, e.g. "a web
  search and an email", "2 web searches and a page fetch", "a web search, an email, a page fetch and 2 more". A tool
  without a template reads "a make report call".
- `state_line.ts` says "needs your approval for a web search and an email"; its `object` is "approval for …".
- Mission Control's `tools_words` delegates to it.
- Tests: `state_line.test.ts`, `mission_control.test.ts`, `tool_call_words.test.tsx`. Mutation-checked: the
  previous `state_line.ts` fails them.
