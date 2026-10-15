// Node facts (Lane D, operator 2026-10-14 11:15): the fold behind the Flow
// tab's hover panel and its copies — over a synthetic ledger (an LLM call with
// provider/model, a tool_calls step with one failed tool, a subworkflow wait,
// a failed step) and over the REAL recorded ledger of a Basic agent run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  build_run_state_doc,
  fold_node_facts,
  node_context_copy,
  node_facts_copy,
  node_records_jsonl,
  node_status_map,
  result_needs_show_all,
  summarize_result,
} from "./flow_node_facts";
import type { LedgerItem } from "./run_steps";

const ROOT = "11111111-2222-4333-8444-555555555555";
const CHILD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STRAY = "99999999-8888-4777-8666-555555555555";
const T = (s: number) => new Date(Date.UTC(2026, 9, 14, 9, 0, s)).toISOString();

const LONG_ANSWER = "The answer is ".repeat(40);
const root_records: any[] = [
  { run_id: ROOT, step_id: "s-start", node_id: "start", status: "completed", effect: null, result: { prompt: "hi" }, started_at: T(0), ended_at: T(1) },
  {
    run_id: ROOT,
    step_id: "s-llm",
    node_id: "llm",
    status: "started",
    effect: { type: "llm_call", payload: { provider: "lmstudio", model: "qwen3-8b", system_prompt: "You are terse.", messages: [{ role: "user", content: "hello" }] } },
    started_at: T(1),
  },
  {
    run_id: ROOT,
    step_id: "s-llm",
    node_id: "llm",
    status: "completed",
    effect: { type: "llm_call", payload: { provider: "lmstudio", model: "qwen3-8b" } },
    result: { content: LONG_ANSWER, model: "qwen3-8b", usage: { prompt_tokens: 900, completion_tokens: 42, total_tokens: 942 }, finish_reason: "stop" },
    started_at: T(1),
    ended_at: T(4),
  },
  {
    run_id: ROOT,
    step_id: "s-tools",
    node_id: "tools",
    status: "started",
    effect: { type: "tool_calls", payload: { tool_calls: [{ name: "web_search", call_id: "c1", arguments: { q: "x" } }, { name: "read_file", call_id: "c2", arguments: { path: "a" } }] } },
    started_at: T(5),
  },
  {
    run_id: ROOT,
    step_id: "s-tools",
    node_id: "tools",
    status: "completed",
    effect: { type: "tool_calls", payload: { tool_calls: [{ name: "web_search", call_id: "c1" }, { name: "read_file", call_id: "c2" }] } },
    result: { results: [{ call_id: "c1", name: "web_search", success: true, output: "ok", error: null }, { call_id: "c2", name: "read_file", success: false, output: null, error: "ENOENT" }] },
    started_at: T(5),
    ended_at: T(7),
  },
  { run_id: ROOT, step_id: "s-sub", node_id: "sub", status: "started", effect: { type: "start_subworkflow", payload: { workflow_id: "agent@1" } }, started_at: T(8) },
  {
    run_id: ROOT,
    step_id: "s-sub",
    node_id: "sub",
    status: "waiting",
    effect: { type: "start_subworkflow", payload: { workflow_id: "agent@1" } },
    result: { wait: { reason: "subworkflow", wait_key: `subworkflow:${CHILD}`, prompt: null, details: { sub_run_id: CHILD } } },
    started_at: T(8),
    ended_at: T(8),
  },
  { run_id: ROOT, step_id: "s-boom", node_id: "boom", status: "failed", effect: { type: "tool_calls", payload: { tool_calls: [] } }, error: "kaboom: the tool exploded", started_at: T(9), ended_at: T(10) },
];
const child_records: any[] = [{ run_id: CHILD, step_id: "c-llm", node_id: "reason", status: "started", effect: { type: "llm_call", payload: { provider: "lmstudio", model: "qwen3-8b", prompt: "think" } }, started_at: T(11) }];
const stray_records: any[] = [{ run_id: STRAY, step_id: "x-llm", node_id: "llm", status: "failed", effect: { type: "llm_call", payload: {} }, error: "not ours", started_at: T(12), ended_at: T(13) }];

const items = (recs: any[], run_id: string): LedgerItem[] => recs.map((record, i) => ({ run_id, cursor: i + 1, record }));
const ALL: LedgerItem[] = [...items(root_records, ROOT), ...items(child_records, CHILD), ...items(stray_records, STRAY)];
/** The app's rule: the root has no prefix, a registered subrun lives under its parent node; STRAY is not registered. */
const gid = (rid: string, nid: string) => (rid === CHILD ? `sub::${nid}` : nid);

describe("fold_node_facts — status in AbstractFlow's vocabulary", () => {
  const facts = fold_node_facts(ALL, ROOT, gid);

  it("done = last record completed; failed = last record failed", () => {
    expect(facts.start.status).toBe("done");
    expect(facts.llm.status).toBe("done");
    expect(facts.tools.status).toBe("done");
    expect(facts.boom.status).toBe("failed");
  });

  it("running = last record started and not ended (a subrun node, under its parent's prefix)", () => {
    expect(facts["sub::reason"].status).toBe("running");
    expect(facts["sub::reason"].run_ids).toEqual([CHILD]);
  });

  it("waiting = last record waiting; a node parked on its own RUNNING subrun is running (one truth per run)", () => {
    expect(facts.sub.status).toBe("running");
    const no_child = fold_node_facts(items(root_records, ROOT), ROOT, gid);
    expect(no_child.sub.status).toBe("waiting");
    const only_started = fold_node_facts(items(root_records.slice(0, 2), ROOT), ROOT, gid);
    expect(only_started.llm.status).toBe("running");
  });

  it("node_status_map is the status per graph id", () => {
    expect(node_status_map(facts)).toEqual({ start: "done", llm: "done", tools: "done", sub: "running", boom: "failed", "sub::reason": "running" });
  });

  it("a subrun not placed on the graph (bare id) never lands on the root's node of the same id", () => {
    expect(facts.llm.records.some((r) => r.run_id === STRAY)).toBe(false);
    expect(facts.llm.last_error).toBe("");
    expect(Object.values(facts).some((f) => f.run_ids.includes(STRAY))).toBe(false);
  });

  it("no root run → no facts", () => {
    expect(fold_node_facts(ALL, "", gid)).toEqual({});
  });
});

describe("fold_node_facts — counts and bodies", () => {
  const facts = fold_node_facts(ALL, ROOT, gid);

  it("the LLM line: calls, last model/provider, summed tokens", () => {
    expect(facts.llm.llm).toEqual({ calls: 1, model: "qwen3-8b", provider: "lmstudio", tokens: { in: 900, out: 42, total: 942 } });
    expect(facts.tools.llm).toBeNull();
  });

  it("the tools table counts calls and failures per tool", () => {
    expect(facts.tools.tools).toEqual([
      { name: "web_search", calls: 1, failed: 0 },
      { name: "read_file", calls: 1, failed: 1 },
    ]);
  });

  it("visits, times and the summed step duration", () => {
    expect(facts.llm.visits).toBe(1);
    expect(facts.llm.first_ms).toBe(Date.parse(T(1)));
    expect(facts.llm.last_ms).toBe(Date.parse(T(4)));
    expect(facts.llm.duration_ms).toBe(3000);
    expect(facts.tools.duration_ms).toBe(2000);
    expect(facts.llm.last_effect).toBe("llm_call");
    expect(facts.llm.last_status).toBe("completed");
  });

  it("waits (the open one marked) and the subrun the node spawned", () => {
    expect(facts.sub.waits).toEqual([{ reason: "subworkflow", wait_key: `subworkflow:${CHILD}`, open: true }]);
    expect(facts.sub.subruns).toEqual([CHILD]);
  });

  it("the last error, complete", () => {
    expect(facts.boom.last_error).toBe("kaboom: the tool exploded");
  });

  it("records: the node's ledger records as recorded, newest last; JSONL one per line", () => {
    expect(facts.llm.records.map((r) => r.status)).toEqual(["started", "completed"]);
    const lines = node_records_jsonl(facts.llm).split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).status).toBe("completed");
  });

  it("context: the exact messages of the last LLM call, system first", () => {
    const ctx = JSON.parse(node_context_copy(facts.llm));
    expect(ctx.messages_source).toBe("payload");
    expect(ctx.messages[0]).toEqual({ role: "system", content: "You are terse." });
    expect(ctx.messages[1]).toEqual({ role: "user", content: "hello" });
    expect(node_context_copy(facts.tools)).toBe("");
  });

  it("Copy facts carries no raw records and no conversation", () => {
    const doc = JSON.parse(node_facts_copy(facts.llm));
    expect(doc).not.toHaveProperty("records");
    expect(doc).not.toHaveProperty("context");
    expect(doc.llm.model).toBe("qwen3-8b");
    expect(doc.last_result.content).toBe(LONG_ANSWER);
  });
});

describe("the result summary never clips (ADR-0026, the pins' rule)", () => {
  const facts = fold_node_facts(ALL, ROOT, gid);

  it("every key of the last result, short values inline, long ones as their size", () => {
    const s = facts.llm.last_result_summary;
    for (const k of ["content", "model", "usage", "finish_reason"]) expect(s).toContain(`${k}:`);
    expect(s).toContain(`content: text (${LONG_ANSWER.length} chars)`);
    expect(s).toContain('model: "qwen3-8b"');
    expect(s).toContain("usage: object (3 keys)");
    expect(s).not.toContain("…");
    expect(result_needs_show_all(facts.llm.last_result)).toBe(true);
  });

  it("a 40-key object lists all 40 keys; a fully inline result needs no show-all", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 40; i += 1) big[`key_${i}`] = i;
    const s = summarize_result(big);
    for (let i = 0; i < 40; i += 1) expect(s).toContain(`key_${i}: ${i}`);
    expect(s).not.toContain("…");
    expect(result_needs_show_all(big)).toBe(false);
    expect(summarize_result({ resumed: true })).toBe("{resumed: true}");
    expect(summarize_result(undefined)).toBe("");
    expect(summarize_result("x".repeat(500))).toBe("text (500 chars)");
  });
});

describe("Copy run state — one bounded document for an AI reader", () => {
  const facts = fold_node_facts(ALL, ROOT, gid);
  const doc = build_run_state_doc({
    run_id: ROOT,
    status: "running",
    state: "running subrun agent 1 · llm_call open 12s",
    finished: false,
    now_ms: Date.parse(T(20)),
    current_id: "sub",
    nodes: [
      { id: "llm", label: "Ask", type: "llm_call" },
      { id: "sub", label: "Agent", type: "subflow" },
      { id: "idle", label: "Never ran", type: "code" },
    ],
    edges: [{ source: "llm", target: "sub" }],
    facts,
    status_of: (id) => facts[id]?.status ?? "none",
  });

  it("says where the run is and what each node did, without records or conversations", () => {
    expect(doc.current_node).toEqual({ id: "sub", label: "Agent", type: "subflow", status: "running" });
    expect(doc.nodes.map((n) => [n.id, n.status, n.visits])).toEqual([
      ["llm", "done", 1],
      ["sub", "running", 1],
      ["idle", "none", 0],
    ]);
    expect(doc.nodes[1].subruns).toEqual([CHILD]);
    expect(doc.edges).toEqual([{ source: "llm", target: "sub" }]);
    const text = JSON.stringify(doc);
    expect(text).not.toContain('"records"');
    expect(text).not.toContain('"context"');
    expect(text).not.toContain(LONG_ANSWER);
  });
});

describe("fold_node_facts over the REAL recorded ledger (basic agent, hermetic gateway)", () => {
  const FIX = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "runview_agent_ledger.json"), "utf8"));
  const R: string = FIX.root_run_id;
  const C: string = FIX.child_run_id;
  const real: LedgerItem[] = [...items(FIX.root, R), ...items(FIX.child, C)];
  const facts = fold_node_facts(real, R, (rid, nid) => (rid === C ? `node-2::${nid}` : nid));

  it("the agent's reason node made 3 LLM calls on the recorded model; its act node ran 2 tools, one failed", () => {
    const reason = facts["node-2::reason"];
    expect(reason.llm?.calls).toBe(3);
    expect(reason.llm?.model).toBe("fake-model");
    expect(reason.llm?.provider).toBe("openai-compatible");
    expect(reason.context?.messages.length).toBeGreaterThan(0);
    expect(facts["node-2::act"].tools).toEqual([
      { name: "list_files", calls: 1, failed: 0 },
      { name: "read_file", calls: 1, failed: 1 },
    ]);
  });

  it("a finished subflow node is done (its resume step closed the wait) and lists its subrun", () => {
    expect(facts["node-4"].status).toBe("done");
    expect(facts["node-4"].visits).toBe(2);
    expect(facts["node-4"].subruns.length).toBe(1);
    expect(facts["node-4"].waits[0]).toMatchObject({ reason: "subworkflow", open: false });
  });
});
