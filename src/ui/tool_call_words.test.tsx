// Approval calls in the kit's words on the Observer's own panels (operator 2026-10-29: an approval
// listed `fetch_url { "url": … }`). The words come from ui-kit `describeToolCall` /
// `ToolCallWordsList`; nothing here re-implements them.
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { kit_tool_call, tool_call_sentence, tool_call_verb } from "./tool_call_words";
import { RuntimeActivityConsole } from "./runtime_page";

const noop = () => undefined;

describe("the Observer's approval calls read in the kit's words", () => {
  it("adapts runtime calls (arguments as an object or a JSON string) to the kit", () => {
    expect(kit_tool_call({ name: "fetch_url", arguments: '{"url":"https://example.org/news"}' })).toEqual({ name: "fetch_url", arguments: { url: "https://example.org/news" } });
    expect(kit_tool_call({ arguments: "not json" })).toEqual({ name: "tool", arguments: null });
    expect(tool_call_sentence({ name: "web_search", arguments: { query: "AI news" } })).toBe("Search the web for AI news");
    expect(tool_call_verb({ name: "fetch_url", arguments: {} })).toBe("Fetch");
    // A tool without a template: its verb and readable "Key: value" pairs, never braces.
    const s = tool_call_sentence({ name: "make_report", arguments: { report_title: "Q3" } });
    expect(s).toMatch(/^Make report: /);
    expect(s).toContain("Q3");
    expect(s).not.toMatch(/[{}]/);
  });

  it("the System page's waiting run lists the calls with the kit's list, not name chips", () => {
    const run = {
      run_id: "r1",
      workflow_id: "basic-agent",
      status: "waiting",
      waiting: { reason: "user", wait_key: "approve:1", details: { mode: "approval_required", tool_calls: [{ name: "fetch_url", arguments: { url: "https://example.org/news" } }, { name: "web_search", arguments: { query: "AI news" } }] } },
    };
    const html = renderToStaticMarkup(
      <RuntimeActivityConsole
        gateway_connected
        runs={[run as any]}
        artifacts={[]}
        selected_run_id="r1"
        workflow_label_by_id={{}}
        on_select_run={noop}
        on_open_run={noop}
        on_open_ledger={noop}
        on_filter_artifacts={noop}
        on_filter_session_artifacts={noop}
        on_open_logs={noop}
        on_refresh_runs={noop}
        on_reconnect={noop}
      />,
    );
    const tools = html.slice(html.indexOf('class="runtime_ops_wait_tools"'));
    expect(tools).toContain('class="af-toolwords"');
    expect(tools).toContain('<span class="af-toolwords__verb" title="fetch_url">Fetch</span>');
    expect(tools).toContain("1 page fetch, 1 web search");
    expect(tools).not.toContain('<span class="chip mono warn">fetch_url</span>');
  });

  it("the run page's approval panel uses the kit's list per call and keeps the exact arguments behind a disclosure", () => {
    const src = fs.readFileSync(path.join(__dirname, "app.tsx"), "utf8");
    const panel = src.slice(src.indexOf('<div className="wait_tool_list">'), src.indexOf("No tool worker is configured"));
    expect(panel).toContain("<ToolCallWordsList calls={[kit_tool_call(tc)]}");
    expect(panel).toContain("groupToolCalls(kit_tool_calls(tool_calls_for_wait))");
    expect(panel).toMatch(/<details className="wait_tool_args">\s*<summary className="muted">Exact arguments<\/summary>\s*<SharedJsonViewer/);
    expect(panel).not.toContain('<strong>{String((tc as any)?.name || "tool")}</strong>');
  });
});
