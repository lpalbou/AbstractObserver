# 0009 — The approval dialog's "Recent session turns" shows tool results in words

**Status**: completed (2026-10-29, unreleased) · **Priority**: P1 · **Created**: 2026-10-29
**Cross-package**: the kit's `describeToolResult` / `ToolResultWordsView` (AbstractUIC 0070, lpalbou/AbstractUIC#35).
It needs the ui-kit release that carries them; until then CI, which installs ui-kit from npm, cannot build it.

## Why (operator, live verification 2026-10-29)
After 0007 the calls on an approval read in words. Above them, "Recent session turns" still printed the earlier tool
RESULTS as raw JSON text (a `skim_websearch` payload).

## What shipped
- `run_labels.tsx` `extract_conversation_context`: a tool turn (role `tool` / `function` / `tool_result`, or a
  message answering a `tool_call_id`) carries `tool_result: {name, value}`, with JSON-string content parsed.
- `app.tsx`: such a turn is labelled "Tool result". It renders the kit's `ToolResultWordsView` ("Web search returned
  10 results" and the first titles), with the payload behind **Exact result** (`SharedJsonViewer`).
- Test: `src/ui/approval_turns_results.test.tsx` covers the extraction, the kit view's words with no braces, and the
  dialog's markup. Mutation-checked: the previous `run_labels.tsx` fails it.
