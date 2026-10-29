# 0007 — Approval calls read in the kit's words (no tool name with its JSON)

**Status**: completed (2026-10-29, unreleased) · **Priority**: P1 · **Created**: 2026-10-29
**Cross-package**: needs `@abstractframework/ui-kit` with `ToolCallWordsList` / `describeToolCall` (AbstractUIC
0068, merged and not yet released; the npm 0.9.5 lacks them). Ships with the kit release that carries them. The chat
approval card comes from panel-chat (AbstractUIC 0069).

## Why (operator QA, 2026-10-29)
Approval views listed each call as its tool name with its JSON arguments (`fetch_url { "url": … }`). The Observer had
three panels with its own markup:
- the run page's approval panel: the name in bold, then a JSON viewer;
- the System page's waiting run: name chips;
- Mission Control: a local `name(key: value)` formatter.

## What shipped
- `src/ui/tool_call_words.ts`: an adapter only. It takes runtime calls, parses JSON-string arguments, and
  hands them to the kit's `describeToolCall`. No local word templates.
- Run page approval panel (`app.tsx`):
  - each call is the kit's `ToolCallWordsList` ("Fetch the page example.org/news");
  - a group line ("2 web searches, 1 page fetch");
  - the exact arguments sit behind an "Exact arguments" disclosure;
  - the risk badges and the Reject / Approve only / Approve and execute actions are unchanged.
- System page waiting run (`runtime_page.tsx`): the kit's list replaces the name chips.
- Mission Control (`mission_control.tsx`): the request glimpse and the (i) copy use the kit's sentence, and the
  (i) chip shows the verb.
- Tests: `src/ui/tool_call_words.test.tsx` (adapter, the rendered System page, the run panel source) and
  `mission_control.test.ts` (glimpse wording). Mutation-checked: reverting `runtime_page.tsx`, `app.tsx` or
  the formatter turns them red.

## Not here
- The state lines ("needs approval for web_search, send_email") still name the tools. That is a follow-up.
