import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import type { GatewayClient } from "../lib/gateway_client";
import { docs_question_input, make_docs_ask, new_docs_session_id } from "./app_assistant";

/** A gateway double: records start_run calls, completes every run with `session_history`. */
function fake_gateway(session_history: any) {
  const starts: Array<{ input: any; opts: any }> = [];
  const gateway = {
    async start_run(_flow: any, input: any, opts: any) {
      starts.push({ input, opts });
      return `run-${starts.length}`;
    },
    async get_run() {
      return { status: "completed", session_history };
    },
    async get_ledger() {
      return { items: [{ result: { response: { content: "the answer" } } }] };
    },
  } as unknown as GatewayClient;
  return { gateway, starts };
}

function long_history(turns: number) {
  const out: Array<{ role: string; content: string }> = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: `question-${i}` });
    out.push({ role: "assistant", content: `answer-${i} ` + "x".repeat(5_000) });
  }
  return out;
}

describe("observer docs assistant (ADR-0026: no client-side history copy; the gateway session window replays)", () => {
  it("sends the question alone, the docs in the system prompt, and opts into the session history", async () => {
    const { gateway, starts } = fake_gateway({ replayed_messages: 4, dropped_messages: 0 });
    const received: any[] = [];
    const ask = make_docs_ask(() => gateway, () => "observer-docs-assistant:abc", (h) => received.push(h));
    const answer = await ask("How do I see why a run failed?", { signal: new AbortController().signal, history: long_history(10) as any });

    expect(answer).toBe("the answer");
    expect(starts).toHaveLength(1);
    const { input, opts } = starts[0];
    expect(input.prompt).toBe("How do I see why a run failed?");
    expect(JSON.stringify(input)).not.toContain("question-0");
    expect(JSON.stringify(input)).not.toContain("TRUNCATION");
    expect(input.use_session_history).toBe(true);
    expect(input.use_context).toBe(true);
    expect(String(input.system)).toContain("=== DOCUMENTATION INDEX (llms.txt) ===");
    expect(opts).toEqual({ bundle_id: "basic-agent", session_id: "observer-docs-assistant:abc" });
    expect(received).toEqual([{ replayed_messages: 4, dropped_messages: 0 }]);
  });

  it("each conversation gets its own session id (New conversation replays nothing earlier)", () => {
    const a = new_docs_session_id();
    const b = new_docs_session_id();
    expect(a.startsWith("observer-docs-assistant:")).toBe(true);
    expect(a.length).toBeGreaterThan("observer-docs-assistant:".length);
    expect(a).not.toBe(b);
  });

  it("the question input never embeds a transcript", () => {
    expect(Object.keys(docs_question_input("q")).sort()).toEqual(["prompt", "system", "use_context", "use_session_history"]);
    expect(docs_question_input("q").prompt).toBe("q");
  });

  it("the drawer's New conversation starts a new session and clears the thread and the receipt", () => {
    const src = readFileSync(resolve(__dirname, "app_assistant.tsx"), "utf8");
    const body = src.slice(src.indexOf("const new_conversation = () => {"), src.indexOf("};", src.indexOf("const new_conversation = () => {")));
    expect(body).toContain("session_ref.current = new_docs_session_id();");
    expect(body).toContain("set_messages([]);");
    expect(body).toContain("set_history(null);");
    expect(src).toContain("onClick={new_conversation}");
    expect(src).toContain("<RunChatReplayNote history={history} />");
  });
});
