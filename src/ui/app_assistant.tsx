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
import { AssistantPanel, type AssistantAsk } from "@abstractframework/panel-chat";
// Vite inlines the docs index as a string (build-time, versioned with the app).
// eslint-disable-next-line import/no-unresolved
import docs_index from "../../llms.txt?raw";
import type { GatewayClient } from "../lib/gateway_client";

const ASSISTANT_SESSION_ID = "observer-docs-assistant";
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

function build_prompt(question: string, history: Array<{ role: string; content: string }>): string {
  const turns = history
    .slice(-6)
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${String(m.content || "").slice(0, 1200)}`)
    .join("\n");
  return [
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
    turns ? "\nConversation so far:\n" + turns : "",
    `\nUser question: ${question}`,
  ].join("\n");
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
 * The injected transport: ask(question) → one gateway basic-agent run on a
 * stable session, polled to terminal, answer read from the run's ledger.
 */
export function make_docs_ask(get_gateway: () => GatewayClient): AssistantAsk {
  return async (question, ctx) => {
    const gateway = get_gateway();
    const history = ctx.history.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
    const run_id = await gateway.start_run(null, { prompt: build_prompt(question, history) }, {
      bundle_id: "basic-agent",
      session_id: ASSISTANT_SESSION_ID,
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
  const ask = useMemo(() => make_docs_ask(() => gateway_ref.current), []);
  const [busy_hint] = useState<string | undefined>(undefined);

  return (
    <AfDrawer open={props.open} onClose={props.onClose} label="Observer assistant" title="Assistant" width={420} topOffset={props.topOffset}>
      <AssistantPanel
        ask={ask}
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
