import React from "react";

import { ChatMessageCard } from "@abstractframework/panel-chat";

import type { RunChatHistoryReport } from "../lib/types";

export type { RunChatHistoryReport };

/**
 * The run "Ask" chat's history contract (ADR-0026, operator ruling 2026-09-28).
 *
 * The Observer sends the WHOLE chat: no message count, no character cut. The
 * gateway bounds it with the runtime's one history window (the newest whole
 * messages up to 50,000 tokens) and returns the window's receipt as
 * `history`; the Observer shows it when older messages were not replayed.
 */

/** Every message of the chat plus the new question, as the gateway's `messages`. */
export function run_chat_history(
  messages: ReadonlyArray<{ role: string; content: string }>,
  question: { role: string; content: string }
): Array<{ role: string; content: string }> {
  return [...messages, question].map((m) => ({ role: m.role, content: m.content }));
}

function count(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** The note for a reply whose older history was not replayed, or null when all of it was. */
export function history_replay_note(history: RunChatHistoryReport | null | undefined): string | null {
  const dropped = count(history?.dropped_messages);
  if (!history || dropped <= 0) return null;
  const replayed = count(history.replayed_messages);
  const tokens = count(history.dropped_tokens);
  const budget = count(history.max_tokens);
  const parts = [
    `Earlier messages not replayed: ${dropped.toLocaleString("en-US")}${tokens ? ` (~${tokens.toLocaleString("en-US")} tokens)` : ""}.`,
    `The model read the newest ${replayed.toLocaleString("en-US")} message${replayed === 1 ? "" : "s"}` +
      (budget ? ` (history window: the most recent ${budget.toLocaleString("en-US")} tokens of whole messages).` : "."),
  ];
  if (history.oversize_turn_kept) parts.push("Your latest message alone is larger than the window; it was sent whole.");
  return parts.join(" ");
}

/** The replay note as a chat notice card (shared panel-chat primitive), or nothing. */
export function RunChatReplayNote(props: { history: RunChatHistoryReport | null | undefined }): React.ReactElement | null {
  const note = history_replay_note(props.history);
  if (!note) return null;
  return <ChatMessageCard message={{ role: "system", level: "info", title: "History", content: note }} />;
}
