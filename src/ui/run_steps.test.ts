// Run view model (operator 2026-10-01 13:05): cycle grouping, the housekeeping
// table, `$slim` resolution and the filters, over a REAL recorded ledger
// (src/ui/__fixtures__/runview_agent_ledger.json: a Basic agent run on a hermetic
// gateway whose runtime called a loopback fake OpenAI-compatible server).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RUN_VIEW_STATE,
  build_run_steps,
  build_started_index,
  filter_steps,
  group_by_cycle,
  llm_detail,
  parse_run_view_hash,
  resolve_slim_marker,
  run_view_hash,
  sha256_hex,
  step_detail,
  step_search_text,
  step_substance,
  tool_detail,
  type LedgerItem,
} from "./run_steps";
import { run_id_from_run_hash } from "../lib/app_paths";

const FIX = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "runview_agent_ledger.json"), "utf8"));
const CHILD: string = FIX.child_run_id;
const ROOT: string = FIX.root_run_id;
const items = (recs: any[], run_id: string): LedgerItem[] => recs.map((record, i) => ({ run_id, cursor: i + 1, record }));
const ALL: LedgerItem[] = [...items(FIX.root, ROOT), ...items(FIX.child, CHILD)];
const search = (s: any) => step_search_text(s, "");

describe("sha256_hex", () => {
  it("matches known vectors (the runtime's checksum over compact JSON)", () => {
    expect(sha256_hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256_hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const t of ["é→ ✓ unicode", "x".repeat(1000), JSON.stringify({ a: [1, "ü"], b: null })]) {
      expect(sha256_hex(t)).toBe(createHash("sha256").update(t, "utf8").digest("hex"));
    }
  });
});

describe("$slim resolution", () => {
  const terminal = FIX.child.filter((r: any) => r.status === "completed" && r.effect?.type === "llm_call");
  const index = build_started_index(FIX.child);

  it("the recorded ledger really carries markers (the fixture is not trivially clean)", () => {
    expect(terminal.length).toBe(3);
    expect(terminal[1].effect.payload.messages.$slim).toBeTruthy();
    expect(terminal[1].effect.payload.system_prompt.$slim).toBeTruthy();
  });

  it("rebuilds the field from the STARTED record and verifies the runtime's sha256", () => {
    const r = resolve_slim_marker(terminal[1].effect.payload.system_prompt, index);
    expect(r.state).toBe("resolved");
    expect(typeof (r as any).value).toBe("string");
    expect((r as any).value).toContain("ReAct");
  });

  it("says why when the started record is missing, and flags a checksum mismatch", () => {
    expect(resolve_slim_marker(terminal[1].effect.payload.messages, new Map())).toEqual({ state: "missing", reason: "its started record is not in the loaded ledger" });
    const tampered = { $slim: { ...terminal[1].effect.payload.messages.$slim, sha256: "0".repeat(64) } };
    const r = resolve_slim_marker(tampered, index);
    expect(r.state).toBe("unverified");
  });

  it("rebuilds a messages-layout marker with its appendix", () => {
    const idx = new Map([["s1", { system_prompt: "SYS", messages: [{ role: "user", content: "hi" }], prompt: "go" }]]);
    const value = [{ role: "system", content: "SYS" }, { role: "user", content: "hi" }, { role: "system", content: "extra" }, { role: "user", content: "go" }];
    const marker = { $slim: { kind: "started_messages_layout", step_id: "s1", layout: ["system", "messages", "prompt"], appendix: [{ at: 2, item: { role: "system", content: "extra" } }], sha256: sha256_hex(JSON.stringify(value)) } };
    expect(resolve_slim_marker(marker, idx)).toEqual({ state: "resolved", value });
  });

  it("no step of the real run shows a $slim stub: every marker resolved", () => {
    const steps = build_run_steps(ALL, CHILD);
    for (const s of steps) {
      expect(s.unresolved).toEqual([]);
      expect(JSON.stringify(s.record)).not.toContain('"$slim"');
    }
  });

  it("the LLM card reads the real prompt: system, the user turn, the tools offered, the answer and the reasoning", () => {
    const llm = build_run_steps(ALL, CHILD).filter((s) => s.kind === "llm_call");
    const d = llm_detail(llm[2]);
    expect(d.system).toContain("ReAct");
    expect(d.messages.some((m) => m.role === "user" && m.content.includes("notes.md"))).toBe(true);
    expect(d.messages.some((m) => m.role === "tool")).toBe(true);
    expect(d.tools.map((t) => t.name).sort()).toEqual(["list_files", "read_file"]);
    expect(d.response).toContain("empty");
    expect(d.reasoning).toContain("answer now");
    expect(d.missing).toEqual([]);
    expect(d.model).toBe("fake-model");
  });

  it("a terminal record alone (started record not loaded) says once why the prompt is not shown", () => {
    const only_terminal = FIX.child.filter((r: any) => r.status !== "started");
    const llm = build_run_steps(items(only_terminal, CHILD), CHILD).filter((s) => s.kind === "llm_call");
    const d = llm_detail(llm[1]);
    expect(d.missing).toContain("System: its started record is not in the loaded ledger");
    expect(d.missing).toContain("Messages: its started record is not in the loaded ledger");
  });
});

describe("steps and agent cycles", () => {
  it("merges STARTED + terminal into one step per step_id", () => {
    const steps = build_run_steps(ALL, CHILD);
    expect(steps.map((s) => s.kind)).toEqual(["llm_call", "tool", "llm_call", "tool", "llm_call", "node", "event"]);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].started?.status).toBe("started");
  });

  it("groups one LLM call with its tool calls per cycle (3 cycles in the real run)", () => {
    const groups = group_by_cycle(build_run_steps(ALL, CHILD));
    expect(groups.map((g) => g.cycle)).toEqual([1, 2, 3]);
    expect(groups.map((g) => g.steps.map((s) => s.kind))).toEqual([["llm_call", "tool"], ["llm_call", "tool"], ["llm_call", "node", "event"]]);
    expect(groups.every((g) => g.llm?.kind === "llm_call")).toBe(true);
  });

  it("steps before the first LLM call are cycle 0", () => {
    const groups = group_by_cycle(build_run_steps(ALL, ROOT));
    expect(groups.map((g) => g.cycle)).toEqual([0]);
  });

  it("one line of substance per kind", () => {
    const steps = build_run_steps(ALL, CHILD);
    expect(step_substance(steps[0])).toBe("900 in · 42 out");
    expect(step_detail(steps[0])).toBe("fake-model");
    expect(step_detail(steps[1])).toBe("");
    expect(step_substance(steps[1])).toBe('list_files(directory_path=".")');
    expect(step_substance(steps[6])).toBe("abstract.status");
    const sub = build_run_steps(ALL, ROOT).find((s) => s.kind === "subflow" && s.node_id === "node-2")!;
    expect(step_substance(sub)).toContain(CHILD);
  });

  it("a tool call whose result failed is a failed step, with its error readable", () => {
    const tools = build_run_steps(ALL, CHILD).filter((s) => s.kind === "tool");
    expect(tools.map((t) => t.failed)).toEqual([false, true]);
    const d = tool_detail(tools[1]);
    expect(d.calls[0]).toMatchObject({ name: "read_file", arguments: { file_path: "notes.md" } });
    expect(d.results[0].success).toBe(false);
    expect(d.results[0].error).toContain("notes.md");
  });
});

describe("filters, search and the hash", () => {
  const child = build_run_steps(ALL, CHILD);
  const root = build_run_steps(ALL, ROOT);

  it("default view hides housekeeping (status event, effect-less node, waits, resumes)", () => {
    expect(filter_steps(child, DEFAULT_RUN_VIEW_STATE, search).map((s) => s.kind)).toEqual(["llm_call", "tool", "llm_call", "tool", "llm_call"]);
    expect(filter_steps(root, DEFAULT_RUN_VIEW_STATE, search).map((s) => s.kind)).toEqual(["subflow", "subflow", "subflow"]);
    expect(filter_steps(root, { ...DEFAULT_RUN_VIEW_STATE, all_steps: true }, search).length).toBe(root.length);
  });

  it("LLM / Tools / Failed only", () => {
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, only: "llm" }, search).map((s) => s.kind)).toEqual(["llm_call", "llm_call", "llm_call"]);
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, only: "tools" }, search).map((s) => s.kind)).toEqual(["tool", "tool"]);
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, only: "failed" }, search).map((s) => s.effect_type)).toEqual(["tool_calls"]);
  });

  it("search matches card text and expanded bodies, plain substring, case-insensitive", () => {
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, q: "READ_FILE" }, search).length).toBeGreaterThan(0);
    // Only inside the resolved system prompt (a $slim body on the terminal record).
    const sys_words = "Loop contract";
    const hits = filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, only: "llm", q: sys_words.toLowerCase() }, search);
    expect(hits.length).toBe(3);
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, q: "no such text anywhere" }, search)).toEqual([]);
    // Regex characters are literal.
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, q: "list_.*s" }, search).length).toBe(0);
    expect(filter_steps(child, { ...DEFAULT_RUN_VIEW_STATE, q: "list_files(" }, search).length).toBeGreaterThan(0);
  });

  it("state round-trips through the hash; a plain run link keeps working", () => {
    const st = { view: "steps" as const, only: "failed" as const, all_steps: true, q: "notes md" };
    const h = run_view_hash("#run/abc-1", st);
    expect(h).toBe("#run/abc-1?view=steps&only=failed&all=1&q=notes+md");
    expect(parse_run_view_hash(h)).toEqual(st);
    expect(run_id_from_run_hash(h)).toBe("abc-1");
    expect(run_view_hash("#run/abc-1?only=llm", DEFAULT_RUN_VIEW_STATE)).toBe("#run/abc-1");
    expect(parse_run_view_hash("#run/abc-1")).toEqual(DEFAULT_RUN_VIEW_STATE);
    expect(parse_run_view_hash("#run/x?only=bogus&view=nope")).toEqual(DEFAULT_RUN_VIEW_STATE);
  });
});

// Operator 2026-10-11 (run 15dc6e47): approved tool calls showed "waiting"
// beside a completed copy. The runtime records an approved call's execution
// under a new step_id with the same idempotency key (real records, run 615ab196).
describe("approved tool calls", () => {
  const APPROVED = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "approved_tool_call_ledger.json"), "utf8"));
  const RID = "615ab196-8834-4360-8e24-0a09cbe736ba";

  it("are one completed step each, not a waiting step plus a copy", () => {
    const steps = build_run_steps(items(APPROVED, RID), RID).filter((s) => s.effect_type === "tool_calls");
    expect(steps.map((s) => [s.status, s.started?.status])).toEqual([
      ["completed", "started"],
      ["completed", "started"],
    ]);
    expect(steps.map((s) => s.record.effect.payload.tool_calls.map((c: any) => c.name).join(","))).toEqual([
      "read_file,read_file,analyze_code,analyze_code,analyze_code",
      "edit_file",
    ]);
  });
});

describe("llm_detail — provider and model of a call on the runtime's defaults", () => {
  it("falls back to the request as sent (result.metadata._provider_request) when payload and result name none (LANE-C finding)", () => {
    const run = "r-defaults";
    const recs = [
      { run_id: run, step_id: "s1", node_id: "n1", status: "started", effect: { type: "llm_call", payload: { messages: [{ role: "user", content: "hi" }] } }, started_at: "2026-10-14T10:00:00Z", ended_at: null },
      {
        run_id: run,
        step_id: "s1",
        node_id: "n1",
        status: "completed",
        effect: { type: "llm_call", payload: { messages: [{ role: "user", content: "hi" }] } },
        result: { content: "hello", metadata: { _provider_request: { provider: "mlx", model: "Jundot/Qwen3.8-27B-oQ4e-mtp", payload: { messages: [{ role: "user", content: "hi" }] } } } },
        started_at: "2026-10-14T10:00:00Z",
        ended_at: "2026-10-14T10:00:02Z",
      },
    ];
    const steps = build_run_steps(items(recs, run), run).filter((s) => s.kind === "llm_call");
    expect(steps.length).toBe(1);
    const d = llm_detail(steps[0]);
    expect(d.provider).toBe("mlx");
    expect(d.model).toBe("Jundot/Qwen3.8-27B-oQ4e-mtp");
  });
});

describe("the run header counts failed steps of every kind (operator 2026-10-16 01:59)", () => {
  it("run_facts.failed_steps and the facts line", async () => {
    const { run_facts, run_facts_line } = await import("./run_steps");
    const rec = (i: number, extra: any) => ({ cursor: i, record: { run_id: "r1", node_id: `n${i}`, status: "completed", ...extra } }) as any;
    const items = [
      rec(1, { effect: { type: "llm_call" }, result: { usage: { total_tokens: 100 } } }),
      rec(2, { effect: { type: "llm_call" }, status: "failed", error: "provider timeout" }),
      rec(3, { effect: { type: "tool_calls" }, result: { results: [{ success: false, error: "boom" }] } }),
    ];
    const f = run_facts(items);
    expect(f.failed_steps).toBeGreaterThanOrEqual(1);
    expect(run_facts_line(f)).toMatch(/failed step/);
    expect(run_facts_line({ llm_calls: 2, tokens: 10, tool_calls: 0, tool_failures: 0, failed_steps: 0 })).toBe("2 LLM calls · 10 tokens");
    expect(run_facts_line({ llm_calls: 0, tokens: 0, tool_calls: 0, tool_failures: 0, failed_steps: 2 })).toBe("2 failed steps");
  });
});
