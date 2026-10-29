// The approval dialog's "Recent session turns": an earlier tool RESULT reads in the kit's words
// ("Web search returned 10 results" and the first titles), its payload behind "Exact result",
// never the raw JSON text (operator 2026-10-29, live verification: a skim_websearch payload).
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolResultWordsView } from "@abstractframework/ui-kit";
import { extract_conversation_context } from "./run_labels";

const payload = JSON.stringify({
  success: true,
  query: "AI news",
  results: Array.from({ length: 10 }, (_, i) => ({ title: `Story ${i}`, url: `https://www.example.org/news/story-${i}`, snippet: "…" })),
  counts: { returned: 10 },
});

describe("Recent session turns: tool results in words", () => {
  it("a tool turn carries its result (parsed) and its tool's name; other turns are unchanged", () => {
    const turns = extract_conversation_context({
      messages: [
        { role: "user", content: "What happened in AI today?" },
        { role: "assistant", content: "Searching." },
        { role: "tool", name: "skim_websearch", tool_call_id: "c1", content: payload },
        { role: "assistant", content: "Here is the digest." },
      ],
    });
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(turns[0].tool_result).toBeUndefined();
    expect(turns[2].tool_result?.name).toBe("skim_websearch");
    expect((turns[2].tool_result?.value as any).results).toHaveLength(10);
    // A tool turn without a role of its own is recognised by the call it answers.
    const t = extract_conversation_context({ messages: [{ role: "assistant", tool_call_id: "c9", content: '{"error":"timed out"}' }] });
    expect(t[0].tool_result?.value).toEqual({ error: "timed out" });
  });

  it("the turn renders the kit's sentence and titles, not braces", () => {
    const turn = extract_conversation_context({ messages: [{ role: "tool", name: "skim_websearch", content: payload }] })[0];
    const html = renderToStaticMarkup(<ToolResultWordsView name={turn.tool_result!.name} result={turn.tool_result!.value} />);
    expect(html).toContain("Web search returned 10 results");
    expect(html).toContain("Story 0 · example.org/news/story-0");
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/[{}]/);
  });

  it("the dialog renders a tool turn through the kit view with the payload behind a disclosure", () => {
    const src = fs.readFileSync(path.join(__dirname, "app.tsx"), "utf8");
    const block = src.slice(src.indexOf("Recent session turns"), src.indexOf('<div className="artifact_detail_grid">'));
    expect(block).toContain("<ToolResultWordsView name={msg.tool_result.name || null} result={msg.tool_result.value} />");
    expect(block).toMatch(/<summary className="muted">Exact result<\/summary>\s*<SharedJsonViewer value=\{msg\.tool_result\.value\}/);
    expect(block).toContain('msg.tool_result ? "Tool result"');
  });
});
