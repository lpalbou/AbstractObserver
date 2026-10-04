// Round 8 (R8.3): the observer's Docs assistant is the kit's shared
// DocsAssistantDrawer grounded on THIS app's llms.txt (served from this app's
// build, read by the gateway at docs/corpus?app=observer) through docs-qa.
import React from "react";
import http from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsAssistantPanel, makeDocsQaAsk } from "@abstractframework/panel-chat";

import { GatewayClient } from "../lib/gateway_client";
import { AppAssistantDrawer, OBSERVER_DOCS_SOURCE } from "./app_assistant";
// @ts-expect-error bin/server.js is plain ESM JavaScript without types
import { createObserverHandler } from "../../bin/server.js";

const appSource = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
const enc = new TextEncoder();

/** A fake gateway behind `fetch`: corpus, run start, live llm.delta frames, poll. */
function fakeGateway() {
  const calls: { url: string; method: string; auth: string | null; body?: unknown }[] = [];
  let polls = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const sse = (frames: string[]) =>
    new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const delta = (seq: number, text: string) =>
    `event: llm.delta\ndata: ${JSON.stringify({ kind: "llm.delta", run_id: "docs-run", call_id: "c1", seq, text, channel: "content", snapshot: false })}\n\n`;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    calls.push({ url, method: String(init.method || "GET"), auth: headers.get("Authorization"), body: init.body });
    if (url === "http://gw.test/api/gateway/docs/corpus?app=observer") return json({ app: "AbstractObserver", text: "# AbstractObserver\n\n## Runs\nOpen the Observe page." });
    if (url === "http://gw.test/api/gateway/runs/start") return json({ run_id: "docs-run" });
    if (url === "http://gw.test/api/gateway/runs/docs-run/ledger/stream?after=0") return sse([delta(0, "Open the "), delta(1, "**Observe** page.")]);
    if (url === "http://gw.test/api/gateway/runs/docs-run") return json({ status: polls++ ? "completed" : "running", output: { response: "Open the **Observe** page." } });
    return new Response(JSON.stringify({ detail: `unexpected ${url}` }), { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("observer Docs assistant (kit DocsAssistantDrawer)", () => {
  it("asks docs-qa with the observer's own llms.txt through the client's authenticated fetch, streaming the reply", async () => {
    const calls = fakeGateway();
    const gateway = new GatewayClient({ base_url: "http://gw.test", auth_token: "tok-1" });
    const ask = makeDocsQaAsk({ fetchGateway: gateway.fetch_gateway, source: OBSERVER_DOCS_SOURCE, pollMs: 1 });
    const live: string[] = [];
    const answer = await ask("How do I see why a run failed?", { signal: new AbortController().signal, sessionId: "observer-docs-assistant:s1", onText: (t) => live.push(t) });
    expect(answer).toBe("Open the **Observe** page.");
    expect(live[live.length - 1]).toBe("Open the **Observe** page.");
    const start = calls.find((c) => c.url.endsWith("/runs/start"))!;
    const body = JSON.parse(String(start.body));
    expect(body).toMatchObject({ bundle_id: "docs-qa", flow_id: "docsqa001", session_id: "observer-docs-assistant:s1" });
    expect(body.input_data).toMatchObject({ prompt: "How do I see why a run failed?", app: "AbstractObserver", use_session_history: true });
    expect(body.input_data.docs).toContain("Open the Observe page.");
    expect(calls.every((c) => c.auth === "Bearer tok-1")).toBe(true);

    const html = renderToStaticMarkup(
      React.createElement(DocsAssistantPanel, {
        source: OBSERVER_DOCS_SOURCE, draft: "", onDraftChange: () => {}, onSend: () => {},
        messages: [{ role: "user", content: "Why did it fail?" }, { role: "assistant", title: "AbstractObserver", content: answer }],
      })
    );
    expect(html).toContain("pc-chat-item--user");
    expect(html).toContain("pc-chat-item--assistant");
    expect(html).toContain("<strong>Observe</strong>");
    expect(html).toContain("Grounded on AbstractObserver’s documentation (llms.txt) · docs-qa");
  });

  it("the drawer: compact header, icon-only New conversation, close, suggestions, signed-out notice", () => {
    const gateway = new GatewayClient({ base_url: "" });
    const html = renderToStaticMarkup(React.createElement(AppAssistantDrawer, { open: true, onClose: () => {}, connected: true, topOffset: 44, gateway }));
    expect(html).toContain("Docs assistant");
    expect(html).toMatch(/aria-label="New conversation"[^>]*><svg/);
    expect(html).not.toMatch(/>New conversation</);
    expect(html).toContain('aria-label="Close panel"');
    expect(html).toContain("How do I see why a run failed?");
    const off = renderToStaticMarkup(React.createElement(AppAssistantDrawer, { open: true, onClose: () => {}, connected: false, topOffset: 44, gateway }));
    expect(off).toContain("Connect to the gateway to use the docs assistant.");
  });

  it("the top bar opens it from the shared docs slot", () => {
    expect(appSource).toContain("docs={{ open: assistant_open,");
    expect(appSource).not.toContain("assistant={{ open: assistant_open");
  });

  it("the app serves its llms.txt as text/plain (what the gateway reads)", async () => {
    const dist = mkdtempSync(join(tmpdir(), "observer-dist-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>AbstractObserver</title>");
    writeFileSync(join(dist, "llms.txt"), "# AbstractObserver\n");
    const server = http.createServer(createObserverHandler({ distDir: dist, gatewayUrl: "http://127.0.0.1:9", gatewayDir: dist }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await new Promise<{ status: number; type: string; body: string }>((ok, fail) => {
        http
          .get(`http://127.0.0.1:${port}/llms.txt`, (r) => {
            let body = "";
            r.on("data", (d) => (body += d));
            r.on("end", () => ok({ status: r.statusCode || 0, type: String(r.headers["content-type"] || ""), body }));
          })
          .on("error", fail);
      });
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/^text\/plain/);
      expect(res.body).toBe("# AbstractObserver\n");
    } finally {
      server.close();
    }
  });
});
