import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayClient } from "../lib/gateway_client";
import { RunChatReplayNote, history_replay_note, run_chat_history } from "./run_chat";

function conversation(turns: number): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: `question-${i}` });
    out.push({ role: "assistant", content: `answer-${i} ` + "x".repeat(i === 1 ? 40_000 : 10) });
  }
  return out;
}

describe("run Ask chat history (ADR-0026: no caps; the gateway applies the 50k-token window)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends every message of the chat, whole, plus the new question", () => {
    const chat = conversation(30); // 60 messages: the old code sent only the last 20
    const question = { role: "user", content: "the-newest-question" };
    const sent = run_chat_history(chat, question);
    expect(sent).toHaveLength(61);
    expect(sent[0]).toEqual({ role: "user", content: "question-0" });
    expect(sent[3].content.length).toBe("answer-1 ".length + 40_000);
    expect(sent[60]).toEqual(question);
  });

  it("the client posts the whole history and returns the gateway's history receipt", async () => {
    const posted: any[] = [];
    const history = { replayed_messages: 12, dropped_messages: 49, dropped_tokens: 61234, max_tokens: 50000 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        posted.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ok: true, run_id: "r1", provider: "p", model: "m", generated_at: "t", answer: "a", history }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    const client = new GatewayClient({ base_url: "http://gw.test", auth_token: "" });
    const messages = run_chat_history(conversation(30), { role: "user", content: "q" });
    const res = await client.run_chat("r1", { messages });
    expect(posted[0].messages).toEqual(messages);
    expect(res.history).toEqual(history);
  });

  it("says how many earlier messages were not replayed, and nothing when all were", () => {
    const note = history_replay_note({ replayed_messages: 12, dropped_messages: 49, dropped_tokens: 61234, max_tokens: 50000 });
    expect(note).toContain("Earlier messages not replayed: 49 (~61,234 tokens).");
    expect(note).toContain("The model read the newest 12 messages");
    expect(note).toContain("the most recent 50,000 tokens");
    expect(history_replay_note({ replayed_messages: 61, dropped_messages: 0 })).toBeNull();
    expect(history_replay_note(undefined)).toBeNull();
    expect(history_replay_note({ replayed_messages: 1, dropped_messages: 2, oversize_turn_kept: true })).toContain("sent whole");
  });

  it("renders the note as a panel-chat notice card", () => {
    const html = renderToStaticMarkup(<RunChatReplayNote history={{ replayed_messages: 12, dropped_messages: 49, max_tokens: 50000 }} />);
    expect(html).toContain("Earlier messages not replayed: 49");
    expect(html).toContain("History");
    expect(renderToStaticMarkup(<RunChatReplayNote history={{ replayed_messages: 3, dropped_messages: 0 }} />)).toBe("");
  });

  it("the Ask chat in app.tsx sends run_chat_history and shows the note, never a sliced history", () => {
    const src = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    expect(src).toContain("const history = run_chat_history(chat_messages, user_msg);");
    expect(src).toContain("set_chat_replay_history(res?.history ?? null);");
    expect(src).toContain("after={<RunChatReplayNote history={chat_replay_history} />}");
    expect(src).not.toMatch(/user_msg\][^\n]*\.slice\(/);
  });
});
