// The Board in plain words (operator 2026-11-07, design pass): a Done card read
// "abstractassistant-orchestr…", "3s · 0 tk · 0 tools · 1 artifact" and "failed" twice.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardCardView, build_board, duration_words, name_untitled_cards, workflow_name_of, type CardHandlers } from "./mission_control";
import type { RunSummary } from "./run_status";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const noop = () => {};
const H: CardHandlers = { now_ms: NOW, stall_after_ms: 5 * 60_000, busy: false, on_open_run: noop, on_act: noop };
const NAMES = { "abstractassistant-orchestrator:7d177c93": "AbstractAssistant Orchestrator" };

function failed_row(extra: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: "r1",
    workflow_id: "abstractassistant-orchestrator@0.0.17:7d177c93",
    status: "failed",
    created_at: new Date(NOW - 60_000).toISOString(),
    updated_at: new Date(NOW - 57_000).toISOString(),
    session_id: "s1",
    session_kind: "chat",
    tokens_total: 0,
    tool_calls: 0,
    ...extra,
  };
}

const done_card = (row: RunSummary, names = NAMES) => name_untitled_cards(build_board({ active: [], done: [row], now_ms: NOW }), names).done[0];
const html = (row: RunSummary, names = NAMES) => renderToStaticMarkup(React.createElement(BoardCardView, { card: done_card(row, names), ...H }));

describe("durations in words", () => {
  it("never abbreviates", () => {
    expect(duration_words(3_000)).toBe("3 seconds");
    expect(duration_words(1_000)).toBe("1 second");
    expect(duration_words(24 * 60_000)).toBe("24 minutes");
    expect(duration_words(60 * 60_000)).toBe("1 hour");
    expect(duration_words(72 * 60_000)).toBe("1 hour 12 minutes");
    expect(duration_words((12 * 24 + 1) * 3_600_000)).toBe("12 days 1 hour");
  });
});

describe("an untitled card is named by its workflow", () => {
  it("reads the gateway's entrypoint name for `<bundle>@<version>:<flow>`", () => {
    expect(workflow_name_of("abstractassistant-orchestrator@0.0.17:7d177c93", NAMES)).toBe("AbstractAssistant Orchestrator");
    expect(workflow_name_of("abstractassistant-orchestrator:7d177c93", NAMES)).toBe("AbstractAssistant Orchestrator");
    expect(workflow_name_of("other@1.0.0:x", NAMES)).toBe("");
    expect(workflow_name_of("no-flow", NAMES)).toBe("");
  });

  it("the Done card shows the name, not the id, and no id under it", () => {
    const h = html(failed_row());
    expect(h).toContain(">AbstractAssistant Orchestrator<");
    expect(h).not.toContain("abstractassistant-orchestrator");
    expect(h).not.toContain("untitled");
  });

  it("without a listed name the id stands in, marked untitled", () => {
    const h = html(failed_row(), {});
    expect(h).toContain("abstractassistant-orchestrator 0.0.17");
    expect(h).toContain("untitled");
  });
});

describe("a failed Done card", () => {
  it("says failed once (the pill), keeps its reason when there is one, and shows no zero counts", () => {
    const plain = html(failed_row());
    expect(plain.match(/>failed</g)?.length).toBe(1);
    expect(plain).not.toMatch(/\btk\b|\b0 (tokens?|tools?|tool calls?|artifacts?)\b|no tokens/);
    expect(plain).toContain("3 seconds");
    const with_error = html(failed_row({ error: "Provider refused the request" }));
    expect(with_error).toContain("failed: Provider refused the request");
  });
});
