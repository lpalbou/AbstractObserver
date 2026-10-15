// The Flow tab (Lane D, operator 2026-10-14 11:15): "should always tell
// clearly if it's ongoing or finished, and if ongoing, with our usual clean
// clear highlight (from abstractflow) on where we are". Static markup, the
// repo's pattern: the banner, data-run-status per node, the one "here" chip,
// the facts panel body, and no run uuid as visible node text.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FlowGraph, NodeFactsPanel } from "./flow_graph";
import { fold_node_facts, type NodeFacts } from "./flow_node_facts";
import type { LedgerItem } from "./run_steps";
import type { StateLine } from "./state_line";

const ROOT = "11111111-2222-4333-8444-555555555555";
const CHILD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const T = (s: number) => new Date(Date.UTC(2026, 9, 14, 9, 0, s)).toISOString();

const node = (id: string, type: string, label: string, y: number) => ({ id, type: "custom", position: { x: 0, y }, data: { nodeType: type, label } });
const edge = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t, sourceHandle: "exec-out", targetHandle: "exec-in" });
const FLOW = {
  id: "demo",
  name: "Demo",
  entryNode: "start",
  nodes: [node("start", "on_flow_start", "Start", 0), node("llm", "llm_call", "Ask the model", 120), node("tools", "tool_calls", "Run tools", 240), node("boom", "code", "Boom", 360), node("end", "on_flow_end", "End", 480)],
  edges: [edge("start", "llm"), edge("llm", "tools"), edge("tools", "boom"), edge("boom", "end")],
};

const records: any[] = [
  { run_id: ROOT, step_id: "a", node_id: "start", status: "completed", effect: null, result: { prompt: "hi" }, started_at: T(0), ended_at: T(1) },
  { run_id: ROOT, step_id: "b", node_id: "llm", status: "started", effect: { type: "llm_call", payload: { provider: "lmstudio", model: "qwen3-8b", messages: [{ role: "user", content: "hi" }] } }, started_at: T(1) },
  { run_id: ROOT, step_id: "b", node_id: "llm", status: "completed", effect: { type: "llm_call", payload: {} }, result: { content: "hello", usage: { prompt_tokens: 10, completion_tokens: 2 } }, started_at: T(1), ended_at: T(3) },
  {
    run_id: ROOT,
    step_id: "c",
    node_id: "tools",
    status: "waiting",
    effect: { type: "start_subworkflow", payload: {} },
    result: { wait: { reason: "subworkflow", wait_key: `subworkflow:${CHILD}`, details: { sub_run_id: CHILD } } },
    started_at: T(4),
    ended_at: T(4),
  },
];
const ITEMS: LedgerItem[] = records.map((record, i) => ({ run_id: ROOT, cursor: i + 1, record }));
const FACTS = fold_node_facts(ITEMS, ROOT, (_rid, nid) => nid);

const line = (verb: StateLine["verb"], text: string): StateLine => ({
  verb,
  lane: verb === "done" ? "done" : "working",
  object: "",
  actor: "runtime",
  actor_run_id: "",
  action: "open_run",
  since_ms: null,
  stale_ms: null,
  stalled: false,
  open_step: "",
  unresolved: false,
  text,
  brief: text,
});

const decode = (m: string) => m.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const html = (el: React.ReactElement) => decode(renderToStaticMarkup(el));
/** The visible text of a markup fragment (tags and attributes stripped). */
const text = (m: string) => m.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const banner = (m: string) => {
  const i = m.lastIndexOf("<div", m.indexOf('class="flow_banner"'));
  return text(m.slice(i, m.indexOf("</div>", i)));
};
/** The markup of one node's <g>. */
const node_markup = (m: string, id: string) => {
  const i = m.indexOf(`data-flow-node="${id}"`);
  expect(i, `node ${id}`).toBeGreaterThan(0);
  const start = m.lastIndexOf("<g", i);
  let depth = 0;
  const re = /<g\b|<\/g>/g;
  re.lastIndex = start;
  for (let x = re.exec(m); x; x = re.exec(m)) {
    depth += x[0] === "</g>" ? -1 : 1;
    if (depth === 0) return m.slice(start, x.index + 4);
  }
  return m.slice(start);
};
const run_status_of = (m: string, id: string) => (node_markup(m, id).match(/data-run-status="([a-z]+)"/) || [])[1];

const graph = (p: Partial<React.ComponentProps<typeof FlowGraph>>) =>
  html(<FlowGraph flow={FLOW} simplify={true} prefer_vertical={true} node_facts={FACTS} run_id={ROOT} now_ms={Date.parse(T(30))} {...p} />);

describe("the run-state banner says ongoing or finished, always", () => {
  it("ongoing: the state sentence, the pill, and the node the highlight sits on", () => {
    const m = graph({ run_status: "waiting", run_line: line("waiting", "waiting for subrun agent 1: asks a question · 2m"), active_node_id: "tools" });
    expect(banner(m)).toBe("ongoing waiting for subrun agent 1: asks a question · 2m · at Run tools");
    expect(m).toContain('<span class="chip warn">ongoing</span>');
    expect(m).toContain('data-phase="ongoing"');
  });

  it("finished: the sentence plus nodes visited and the span on the graph; no 'at'", () => {
    const m = graph({ run_status: "completed", run_line: line("done", "completed in 3s") });
    expect(banner(m)).toBe("finished completed in 3s · 3 nodes visited in 4s");
    expect(m).toContain('<span class="chip ok">finished</span>');
  });

  it("a failed run names the node it failed at (no live highlight left)", () => {
    const failed: Record<string, NodeFacts> = { ...FACTS, boom: { ...FACTS.llm, node_id: "boom", graph_id: "boom", status: "failed", last_ms: Date.parse(T(9)) } };
    const m = graph({ node_facts: failed, run_status: "failed", run_line: line("done", "failed: kaboom") });
    expect(banner(m)).toContain("finished failed: kaboom · at Boom");
    expect(text(node_markup(m, "boom"))).toContain("failed here");
  });

  it("never the bare word 'waiting': without a sentence the banner says what is missing", () => {
    const m = graph({ run_status: "waiting", run_line: null });
    expect(banner(m)).toMatch(/^ongoing waiting, reason not loaded/);
  });

  it("no run: says the graph is the workflow only", () => {
    const m = html(<FlowGraph flow={FLOW} simplify={true} />);
    expect(banner(m)).toBe("no run the workflow only — open a run to see where it is");
  });
});

describe("nodes carry AbstractFlow's run status and ONE 'here' chip", () => {
  const m = graph({ run_status: "running", run_line: line("running", "running · step tools"), active_node_id: "tools" });

  it("data-run-status per node from the fold (none = not visited)", () => {
    expect(run_status_of(m, "start")).toBe("done");
    expect(run_status_of(m, "llm")).toBe("done");
    expect(run_status_of(m, "tools")).toBe("waiting");
    expect(run_status_of(m, "boom")).toBe("none");
    expect(run_status_of(m, "end")).toBe("none");
  });

  it("the active node gets the ring and the chip; no other node has a chip", () => {
    expect(m.match(/class="flow_here_chip"/g) || []).toHaveLength(1);
    const tools = node_markup(m, "tools");
    expect(tools).toContain('class="flow_here_chip"');
    expect(tools).toContain('class="flow_node_ring"');
    expect(text(tools)).toContain("waiting here");
    expect(tools).toMatch(/class="graph_node active +here"/);
    expect(node_markup(m, "llm")).not.toContain("flow_node_ring");
  });

  it("nodes are keyboard-reachable buttons that name their status", () => {
    const tools = node_markup(m, "tools");
    expect(tools).toContain('tabindex="0"');
    expect(tools).toContain('role="button"');
    expect(tools).toContain('aria-label="Run tools (tool_calls): waiting for its subrun, waiting here"');
  });

  it("a finished run leaves nothing open: the parked node renders done", () => {
    const done = graph({ run_status: "completed", run_line: line("done", "completed in 3s") });
    expect(run_status_of(done, "tools")).toBe("done");
    expect(done).not.toContain("flow_here_chip");
  });

  it("no node shows a run uuid as visible text", () => {
    const svg = m.slice(m.indexOf("<svg"), m.indexOf("</svg>"));
    expect(text(svg)).not.toMatch(UUID);
    expect(text(m)).not.toMatch(UUID);
  });
});

describe("the node facts panel", () => {
  const p = html(<NodeFactsPanel node={{ id: "llm", label: "Ask the model", type: "llm_call" }} facts={FACTS.llm} status="done" here={false} finished={false} />);

  it("label, type, status, visits, the LLM line", () => {
    const t = text(p);
    expect(t).toContain("Ask the model llm_call");
    expect(t).toContain("done");
    expect(t).toContain("1 visit · first");
    expect(t).toContain("2s in steps");
    expect(t).toContain("qwen3-8b · lmstudio · 1 call · 10 in · 2 out tokens");
  });

  it("the result summary is complete (every key, no '…') and the three copies are offered", () => {
    expect(text(p)).toContain('{content: "hello", usage: {"prompt_tokens":10,"completion_tokens":2}}');
    expect(p).not.toContain("…");
    expect(p).toContain("Copy facts (JSON)");
    expect(p).toContain("Copy records (JSONL)");
    expect(p).toContain("Copy context");
  });

  it("subruns are short ids (full id in the title); waits name their object", () => {
    const w = html(<NodeFactsPanel node={{ id: "tools", label: "Run tools", type: "tool_calls" }} facts={FACTS.tools} status="waiting" here={true} finished={false} on_open_run={() => {}} />);
    expect(text(w)).toContain("waiting for its subrun");
    expect(text(w)).toContain("waiting here");
    expect(w).toContain(`title="Open run ${CHILD}"`);
    expect(text(w)).not.toMatch(UUID);
    expect(w).not.toContain("Copy context");
  });

  it("an unvisited node says so and offers no copies of nothing", () => {
    const n = html(<NodeFactsPanel node={{ id: "end", label: "End", type: "on_flow_end" }} facts={null} status="none" here={false} finished={true} />);
    expect(text(n)).toContain("Not visited in this run.");
    expect(n).toMatch(/<button[^>]*disabled=""[^>]*><span aria-live="polite">Copy facts \(JSON\)/);
  });
});
