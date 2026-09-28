// The observer's app assistant (unified top-bar directive, 2026-07-13:
// "every app should have a simple assistant, based on application docs").
//
// Composition per the consensus doc (plans/unified-top-bar.md): the kit's
// AfDrawer hosts panel-chat's AssistantPanel; the TRANSPORT is injected
// here and nowhere else. v1 transport = one gateway basic-agent run per
// question, grounded on this app's own llms.txt (inlined at build time —
// 4KB, no fetch, works before any run exists). When the gateway ships the
// shared docs-qa bundle this swaps to it without touching the panel.
//
// NOT the same surface as the run page's "Ask" tab: Ask is grounded in a
// RUN's ledger; this assistant answers questions about the APP itself.
import React, { useMemo, useRef, useState } from "react";
import { AfDrawer } from "@abstractframework/ui-kit";
import { AssistantPanel, type AssistantAsk, type ChatMessage } from "@abstractframework/panel-chat";
// Vite inlines the docs index as a string (build-time, versioned with the app).
// eslint-disable-next-line import/no-unresolved
import docs_index from "../../llms.txt?raw";
import type { GatewayClient } from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import type { RunChatHistoryReport } from "../lib/types";
import { RunChatReplayNote } from "./run_chat";

const POLL_INTERVAL_MS = 1500;
const ANSWER_TIMEOUT_MS = 120_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

// History (ADR-0026, operator ruling 2026-09-28): no client-side copy of the
// conversation, no turn count, no character cut. Every question is a run of
// ONE gateway session per conversation with `use_session_history`: the
// gateway replays that session's earlier turns through the runtime's history
// window (the newest whole turns up to 50,000 tokens) and records the receipt
// in the run (`session_history` on GET /runs/{id}). The docs index rides the
// system prompt, so replayed turns are the user's questions and the answers.
const SYSTEM_PROMPT = [
  "You are the AbstractObserver in-app assistant. Answer questions about",
  "using and understanding the AbstractObserver web app (pages: Board,",
  "Observe/run page with Story/Ledger/Flow/Ask tabs, System with",
  "Activity/Artifacts/Memory/Logs, Launch, Settings). Ground every answer",
  "in the documentation index below; when the docs don't cover something,",
  "say so plainly instead of guessing. Be concise and concrete.",
  "",
  "=== DOCUMENTATION INDEX (llms.txt) ===",
  docs_index,
  "=== END DOCUMENTATION ===",
].join("\n");

const SESSION_PREFIX = "observer-docs-assistant";

/** A fresh conversation's session id: the gateway replays nothing from another conversation. */
export function new_docs_session_id(): string {
  return `${SESSION_PREFIX}:${random_id()}`;
}

/**
 * The run input for one question: the question alone, the docs in the system
 * prompt, history from the session, and NO tools. basic-agent's default tool
 * set includes write_file and execute_command; an explicit empty list means
 * no tool is offered or run (the gateway test
 * test_basic_agent_with_an_empty_tools_list_offers_and_runs_no_tool pins it),
 * so a docs question can never write files or run commands.
 */
export function docs_question_input(question: string): Record<string, unknown> {
  return { prompt: question, system: SYSTEM_PROMPT, tools: [], use_session_history: true, use_context: true };
}

/** Extract the final assistant text from a completed run's ledger. */
function extract_answer(records: any[]): string {
  for (let i = records.length - 1; i >= 0; i--) {
    const rec: any = records[i];
    const result = rec?.result && typeof rec.result === "object" ? rec.result : null;
    const candidates = [
      result?.response?.content,
      result?.response?.text,
      result?.output,
      result?.content,
      result?.text,
    ];
    for (const c of candidates) {
      const t = typeof c === "string" ? c.trim() : "";
      if (t) return t;
    }
  }
  return "";
}

/**
 * The injected transport: ask(question) → one gateway basic-agent run on this
 * conversation's session, polled to terminal, answer read from the run's
 * ledger; the run's history receipt goes to `on_history`.
 */
export function make_docs_ask(
  get_gateway: () => GatewayClient,
  get_session_id: () => string,
  on_history: (history: RunChatHistoryReport | null) => void = () => {}
): AssistantAsk {
  return async (question, ctx) => {
    const gateway = get_gateway();
    const run_id = await gateway.start_run(null, docs_question_input(question), {
      bundle_id: "basic-agent",
      session_id: get_session_id(),
    });

    const started = Date.now();
    for (;;) {
      await sleep(POLL_INTERVAL_MS, ctx.signal);
      if (Date.now() - started > ANSWER_TIMEOUT_MS) {
        throw new Error("The assistant run timed out (120s). The run is still visible on the Observe page.");
      }
      const run = await gateway.get_run(run_id);
      const status = String(run?.status || "").trim().toLowerCase();
      if (status === "failed" || status === "cancelled") {
        const err = String(run?.error?.message || run?.error || "run " + status).slice(0, 400);
        throw new Error(`The assistant run ${status}: ${err}`);
      }
      if (status === "completed") {
        on_history(run?.session_history ?? null);
        const page = await gateway.get_ledger(run_id, { after: 0, limit: 500, signal: ctx.signal });
        const answer = extract_answer(page.items);
        return answer || "(the run completed but produced no readable answer — inspect it on the Observe page)";
      }
    }
  };
}

export function AppAssistantDrawer(props: {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  topOffset: number;
  gateway: GatewayClient;
}): React.ReactElement {
  // The transport reads the CURRENT client on every ask (auth mode can
  // change between questions); the panel itself stays mounted so the
  // conversation survives close/reopen (kit keep-alive contract).
  const gateway_ref = useRef(props.gateway);
  gateway_ref.current = props.gateway;
  // One gateway session per conversation, for as long as this drawer lives;
  // "New conversation" starts another, so nothing earlier is replayed.
  const session_ref = useRef<string>(new_docs_session_id());
  const [messages, set_messages] = useState<ChatMessage[]>([]);
  const [history, set_history] = useState<RunChatHistoryReport | null>(null);
  const ask = useMemo(() => make_docs_ask(() => gateway_ref.current, () => session_ref.current, set_history), []);
  const [busy_hint] = useState<string | undefined>(undefined);
  const new_conversation = () => {
    session_ref.current = new_docs_session_id();
    set_messages([]);
    set_history(null);
  };

  return (
    <AfDrawer
      open={props.open}
      onClose={props.onClose}
      label="Observer assistant"
      title="Assistant"
      width={420}
      topOffset={props.topOffset}
      headerActions={
        <button className="btn" type="button" disabled={!messages.length} onClick={new_conversation} title="Start a new conversation (nothing earlier is replayed)">
          New conversation
        </button>
      }
    >
      <RunChatReplayNote history={history} />
      <AssistantPanel
        ask={ask}
        messages={messages}
        onMessagesChange={set_messages}
        assistantName="Observer"
        placeholder="Ask about the observer…"
        blockedNotice={props.connected ? busy_hint : "Connect to the gateway to use the assistant."}
        suggestions={[
          "How do I see why a run failed?",
          "Where do I find the artifacts a run produced?",
          "What does the Board's Review column mean?",
          "How do I launch a workflow on a schedule?",
        ]}
        emptyState={
          <div>
            Answers are grounded in this app's documentation. Each question runs
            once through the connected gateway's basic agent.
          </div>
        }
      />
    </AfDrawer>
  );
}
