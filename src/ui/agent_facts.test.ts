// Agent page folds (backlog 0003 §Agent page, wave 3). The live fixtures are
// gateway 0.13.1 reads of automation e3079778 / occurrence #5 (02c4a311) on
// 2026-10-13/14, saved under untracked/redesign/fixtures/ (see LANE-B.md).
// A missing fixture THROWS — no case passes on absent input.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  WHY,
  flatten_tree,
  flow_root,
  fmt_utc,
  fold_agent_profile,
  fold_can_do,
  fold_context,
  fold_ledger_use,
  fold_pins,
  fold_spend,
  fold_tree,
  tree_root_id,
  window_note_of,
} from "./agent_facts";
import { parse_iso_ms } from "./format";
import type { RunSummary } from "./run_status";
import { fold_automation_brief } from "./state_line";

const FIX_DIR = join(__dirname, "__fixtures__");
const fix = (name: string): any => JSON.parse(readFileSync(join(FIX_DIR, name), "utf8"));

const FLOW = fix("bundle_flow.json"); // GET /bundles/basic-agent/flows/81795ea9?bundle_version=0.0.5
const INPUT = fix("occ5_input_data.json"); // GET /runs/02c4a311…/input_data (after completion)
const INPUT_WAITING = fix("occ5_input_data_while_waiting.json"); // same run, while parked on its child
const DETAIL = fix("occ5_detail_completed.json"); // GET /runs/02c4a311…
const DETAIL_WAITING = fix("occ5_detail_waiting.json");
const AUTOMATION = fix("automation.json"); // GET /automations/e3079778…
const SESSION_ROWS: RunSummary[] = fix("session_runs_metrics.json").items; // GET /runs?session_id=automation:e3079778…&include_metrics=true
const WAITING_ROWS: RunSummary[] = fix("runs_while_waiting.json").items; // all-runs listing at 23:50 UTC, no metrics

const OCC = "02c4a311-4e44-508d-96fb-98a205928054";
const CHILD = "6defd6b2-e7a1-4915-8cb9-ec01e3e1321a";
const CONTROLLER = "e3079778-1ba0-50aa-83a3-6ac31b39e471";
const LIVE_PIN_IDS = ["use_context", "memory", "context", "provider", "model", "system", "prompt", "tools", "max_iterations", "max_in_tokens", "temperature", "seed", "resp_schema"];

describe("fixtures are the live reads they claim to be", () => {
  it("the occurrence's input_data names 13 start pins and the flow is basic-agent 0.0.5", () => {
    expect(INPUT.run_id).toBe(OCC);
    expect(INPUT.pin_ids).toEqual(LIVE_PIN_IDS);
    expect(FLOW.workflow_id).toBe("basic-agent@0.0.5:81795ea9");
    expect(DETAIL.status).toBe("completed");
    expect(DETAIL_WAITING.status).toBe("waiting");
  });
});

describe("fold_pins — wave-3 gate: basic-agent 0.0.5", () => {
  const pins = fold_pins(FLOW, INPUT, DETAIL);

  it("renders the 13 start pins in the flow's order, typed as the flow declares them", () => {
    expect(pins.flow_found && pins.start_found && pins.end_found).toBe(true);
    expect(pins.inputs.map((p) => p.id)).toEqual(LIVE_PIN_IDS);
    expect(pins.inputs.every((p) => p.typed)).toBe(true);
    const types = Object.fromEntries(pins.inputs.map((p) => [p.id, p.type]));
    expect(types).toEqual({
      use_context: "boolean",
      memory: "memory",
      context: "object",
      provider: "provider",
      model: "model",
      system: "string",
      prompt: "string",
      tools: "tools",
      max_iterations: "number",
      max_in_tokens: "number",
      temperature: "number",
      seed: "number",
      resp_schema: "object",
    });
  });

  it("carries the live values for the 9 pins sent and says 'not provided' for the other 4", () => {
    const by = Object.fromEntries(pins.inputs.map((p) => [p.id, p]));
    const provided = pins.inputs.filter((p) => p.state === "value").map((p) => p.id);
    expect(provided).toEqual(["use_context", "context", "provider", "model", "prompt", "tools", "max_iterations", "temperature", "seed"]);
    expect(pins.inputs.filter((p) => p.state === "not_provided").map((p) => p.id)).toEqual(["memory", "system", "max_in_tokens", "resp_schema"]);
    expect(by.model.value).toBe("Jundot/Qwen3.8-27B-oQ4e-mtp");
    expect(by.provider.value).toBe("mlx");
    expect(by.max_iterations.value).toBe(20);
    expect(by.temperature.value).toBe(0.7);
    expect(by.seed.value).toBe(-1);
    expect(by.use_context.value).toBe(true);
    expect(by.tools.value).toEqual(["fetch_url", "skim_url", "skim_websearch", "web_search"]);
    expect(String(by.prompt.value)).toMatch(/^\[Trigger schedule@1 · occurrence 5 · fired 2026-10-13T23:06:22/);
    expect((by.context.value as any).messages.length).toBe(14);
    // None of the four unsent pins has a flow default (pinDefaults: use_context, temperature, seed, tools, max_iterations).
    expect(pins.inputs.filter((p) => p.state === "not_provided").every((p) => p.flow_default === null)).toBe(true);
    expect(pins.also_sent).toEqual([]);
  });

  it("renders the end pins as the flow JSON declares them, valued from the terminal output", () => {
    expect(pins.end_is_passthrough).toBe(false);
    expect(pins.outputs_final).toBe(true);
    expect(pins.outputs.map((p) => [p.id, p.type, p.state])).toEqual([
      ["response", "string", "value"],
      ["success", "boolean", "value"],
      ["meta", "object", "value"],
      ["scratchpad", "object", "value"],
    ]);
    const by = Object.fromEntries(pins.outputs.map((p) => [p.id, p.value]));
    expect(String(by.response)).toMatch(/^# International Political & Economic Digest/);
    expect(by.success).toBe(true);
    expect((by.meta as any).sub_run_id).toBe(CHILD);
    expect(by.scratchpad).toEqual({ $artifact: "6f3694a4e5a0bb029de9a3d709203962" });
    expect(pins.also_returned).toEqual([]);
  });

  it("while the run is parked, outputs are absent (not final) and the inputs are the 8-message state", () => {
    const w = fold_pins(FLOW, INPUT_WAITING, DETAIL_WAITING);
    expect(w.outputs_final).toBe(false);
    expect(w.outputs.map((p) => p.state)).toEqual(["absent", "absent", "absent", "absent"]);
    const ctx = w.inputs.find((p) => p.id === "context");
    expect((ctx?.value as any).messages.length).toBe(8);
  });

  it("reads the wrapped `{…, flow}` body and the bare flow the same way", () => {
    expect(flow_root(FLOW)).toBe(FLOW.flow);
    expect(fold_pins(FLOW.flow, INPUT, DETAIL)).toEqual(pins);
  });
});

describe("fold_pins — edges", () => {
  const sent = INPUT.input_data;

  it("an unsent pin with a flow default shows the default the runtime applied", () => {
    const { tools: _t, ...rest } = sent;
    const p = fold_pins(FLOW, { ...INPUT, input_data: rest }, DETAIL);
    const tools = p.inputs.find((x) => x.id === "tools");
    expect(tools?.state).toBe("not_provided");
    expect(tools?.flow_default?.value).toEqual(FLOW.flow.nodes[0].data.pinDefaults.tools);
  });

  it("values sent that are not declared pins are listed under also_sent", () => {
    const p = fold_pins(FLOW, { ...INPUT, input_data: { ...sent, workflow_selection: { source: "client" } } }, DETAIL);
    expect(p.also_sent).toEqual([["workflow_selection", { source: "client" }]]);
    expect(p.inputs).toHaveLength(13);
  });

  it("output keys that are not end pins (the gateway's #TRUNCATION marker) are listed, never dropped", () => {
    const p = fold_pins(FLOW, INPUT, { ...DETAIL, output: { ...DETAIL.output, "#TRUNCATION": "output object truncated from 90 keys" } });
    expect(p.also_returned).toEqual([["#TRUNCATION", "output object truncated from 90 keys"]]);
  });

  it("a pin-less on_flow_end passes the last output through as ONE untyped output", () => {
    const flow = {
      nodes: [
        { id: "s", type: "on_flow_start", data: { nodeType: "on_flow_start", outputs: [{ id: "exec-out", type: "execution" }, { id: "q", label: "q", type: "string" }] } },
        { id: "e", type: "on_flow_end", data: { nodeType: "on_flow_end", inputs: [{ id: "exec-in", type: "execution" }] } },
      ],
    };
    const p = fold_pins(flow, { input_data: { q: "hi" } }, { status: "completed", output: { answer: 42 } });
    expect(p.end_is_passthrough).toBe(true);
    expect(p.outputs).toEqual([
      { id: "output", label: "output", type: "any", typed: false, required: false, description: "", state: "value", value: { answer: 42 }, flow_default: null },
    ]);
    expect(p.also_returned).toEqual([]);
    const running = fold_pins(flow, { input_data: { q: "hi" } }, { status: "running", output: null });
    expect(running.outputs[0].state).toBe("absent");
  });

  it("no flow: the gateway's pin_ids still list every start pin, untyped", () => {
    const p = fold_pins(null, INPUT, DETAIL);
    expect(p.flow_found).toBe(false);
    expect(p.inputs.map((x) => x.id)).toEqual(LIVE_PIN_IDS);
    expect(p.inputs.every((x) => !x.typed && x.type === "any")).toBe(true);
    expect(p.outputs).toEqual([]);
    expect(p.also_returned.map(([k]) => k)).toEqual(["response", "success", "meta", "scratchpad"]);
  });

  it("nothing loaded: declared pins are 'unknown', not 'not provided'", () => {
    const p = fold_pins(FLOW, null, null);
    expect(p.inputs).toHaveLength(13);
    expect(p.inputs.every((x) => x.state === "unknown")).toBe(true);
    expect(p.outputs.every((x) => x.state === "unknown")).toBe(true);
  });

  it("the flow with its start node removed has no typed inputs (the check goes red without the node)", () => {
    const no_start = { nodes: FLOW.flow.nodes.filter((n: any) => n.type !== "on_flow_start"), edges: [] };
    const p = fold_pins(no_start, { ...INPUT, pin_ids: [] }, DETAIL);
    expect(p.start_found).toBe(false);
    expect(p.inputs).toEqual([]);
    expect(p.also_sent.map(([k]) => k)).toEqual(Object.keys(sent));
  });
});

describe("fold_can_do", () => {
  it("live occurrence: the run's own inputs win; policy and the runtime allowlist come from the automation", () => {
    const c = fold_can_do(DETAIL, INPUT, AUTOMATION);
    expect(c.model).toBe("Jundot/Qwen3.8-27B-oQ4e-mtp");
    expect(c.provider).toBe("mlx");
    expect(c.tools).toEqual(["fetch_url", "skim_url", "skim_websearch", "web_search"]);
    expect(c.max_iterations).toBe(20);
    expect(c.tool_approval).toBe("auto");
    expect(c.allowed_tools).toEqual(["fetch_url", "skim_url", "skim_websearch", "web_search"]);
    expect(c.untrusted_input_tools).toEqual([]);
    expect(c.email_allowed_recipients).toEqual(["self"]);
    // The run's vars say all_except_ignored; the CURRENT definition says workspace_only — the run wins.
    expect(AUTOMATION.definition.target.input_data.workspace_access_mode).toBe("workspace_only");
    expect(c.workspace_access_mode).toBe("all_except_ignored");
    expect(c.workspace_root).toBe(DETAIL.workspace_root);
    expect(c.workspace_allowed_paths).toEqual(["/home/operator/abstractframework"]);
    expect(c.workspace_ignored_paths).toEqual(["/home/operator/Pictures", "/home/operator/Downloads"]);
    expect(c.source).toMatchObject({
      model: "run",
      tools: "run",
      workspace_access_mode: "run",
      tool_approval: "automation",
      allowed_tools: "automation",
      untrusted_input_tools: "automation",
      email_allowed_recipients: "automation",
    });
  });

  it("brief only: the policy lists the brief does not carry stay unknown (source ''), never 'none'", () => {
    const c = fold_can_do(null, null, fold_automation_brief(AUTOMATION));
    expect(c.model).toBe("Jundot/Qwen3.8-27B-oQ4e-mtp");
    expect(c.source.model).toBe("automation");
    expect(c.tool_approval).toBe("auto");
    expect(c.allowed_tools).toEqual([]);
    expect(c.source.allowed_tools).toBe("");
    expect(c.source.untrusted_input_tools).toBe("");
    expect(c.source.email_allowed_recipients).toBe("");
  });

  it("a run whose input_data carries the workspace keys inline (no `workspace` block) still reads them as the run's", () => {
    const c = fold_can_do(null, { input_data: { workspace_access_mode: "workspace_only", workspace_root: "/w" } }, AUTOMATION);
    expect(c.workspace_access_mode).toBe("workspace_only");
    expect(c.source.workspace_access_mode).toBe("run");
    expect(c.workspace_root).toBe("/w");
  });

  it("nothing on the wire: every field empty, every source ''", () => {
    const c = fold_can_do(null, null, null);
    expect(c).toMatchObject({ model: "", provider: "", tools: [], tool_approval: "", workspace_access_mode: "", workspace_root: "", allowed_tools: [], max_iterations: null, untrusted_input_tools: [], email_allowed_recipients: [] });
    expect(Object.values(c.source).every((s) => s === "")).toBe(true);
  });
});

describe("fold_context", () => {
  it("live occurrence: window note from the receipt's numbers, gauge with pct as a percent", () => {
    const c = fold_context(DETAIL);
    expect(c.has_history).toBe(true);
    expect(c.policy).toBe("most_recent_whole_turns");
    expect(c.window_note).toBe("replayed 8 of 8 messages (14,938 of 100,000 tokens); nothing left out");
    expect(c.tokens).toEqual({ used: 0, max_tokens: 262144, max_input_tokens: null, budget: 262144, pct: 0, warn_pct: 80, over_warn: false });
    expect(c.flow_warnings).toEqual([]);
  });

  it("the design's example sentence, built only from the numbers present", () => {
    const base = { replayed_messages: 12, replayed_tokens: 48210, max_tokens: 50000, dropped_messages: 2, dropped_tokens: null, dropped_counts_complete: true, oversize_turn_kept: false };
    expect(window_note_of(base)).toBe("replayed 12 of 14 messages (48,210 of 50,000 tokens); 2 older messages left out");
    expect(window_note_of({ ...base, dropped_tokens: 3100 })).toBe("replayed 12 of 14 messages (48,210 of 50,000 tokens); 2 older messages left out (3,100 tokens)");
    expect(window_note_of({ ...base, dropped_counts_complete: false })).toBe("replayed 12 messages (48,210 of 50,000 tokens); at least 2 older messages left out");
    expect(window_note_of({ ...base, oversize_turn_kept: true })).toMatch(/; the newest turn alone exceeds the budget and was kept whole$/);
    const only_budget = { replayed_messages: null, replayed_tokens: null, max_tokens: 50000, dropped_messages: null, dropped_tokens: null, dropped_counts_complete: null, oversize_turn_kept: null };
    expect(window_note_of(only_budget)).toBe("history budget 50,000 tokens");
  });

  it("over the warn threshold; max_input_tokens is the budget when set; flow warnings kept", () => {
    const c = fold_context({ limits: { tokens: { estimated_used: 85000, max_tokens: 262144, max_input_tokens: 100000, pct: 0.85, warn_tokens_pct: 80 } }, flow_warnings: ["node-3: unknown pin 'x'"] });
    expect(c.tokens?.budget).toBe(100000);
    expect(c.tokens?.pct).toBeCloseTo(85);
    expect(c.tokens?.over_warn).toBe(true);
    expect(c.flow_warnings).toEqual(["node-3: unknown pin 'x'"]);
    expect(c.has_history).toBe(false);
    expect(c.window_note).toBe("");
  });

  it("no detail: nothing invented", () => {
    const c = fold_context(null);
    expect(c).toMatchObject({ has_history: false, tokens: null, flow_warnings: [], window_note: "", policy: "" });
  });
});

describe("fold_tree", () => {
  it("occurrence subject: rooted at the occurrence, its children in start order, the controller as a parent line only", () => {
    const t = fold_tree(OCC, SESSION_ROWS);
    expect(t.subject_found).toBe(true);
    expect(t.root?.run.run_id).toBe(OCC);
    expect(t.root?.is_subject).toBe(true);
    expect(t.root?.children.map((c) => c.run.run_id.slice(0, 8))).toEqual(["4a2d1440", "6defd6b2", "00fd4eac"]);
    expect(t.size).toBe(4);
    expect(t.controller_id).toBe(CONTROLLER);
    expect(t.controller?.role).toBe("controller");
    // Sibling occurrences are never expanded.
    const ids = flatten_tree(t.root).map((n) => n.run.run_id);
    expect(ids.some((id) => id.startsWith("db080535"))).toBe(false);
  });

  it("a child subject is drawn inside its occurrence's tree and marked", () => {
    const t = fold_tree(CHILD, SESSION_ROWS);
    expect(t.root?.run.run_id).toBe(OCC);
    const marked = flatten_tree(t.root).filter((n) => n.is_subject);
    expect(marked.map((n) => n.run.run_id)).toEqual([CHILD]);
  });

  it("controller → occurrence → child → grandchild nests (a delegate_agent shape)", () => {
    const rows: RunSummary[] = [
      { run_id: "C", role: "controller", status: "waiting", created_at: "2026-10-13T20:00:00Z" },
      { run_id: "O", role: "occurrence", parent_run_id: "C", automation_id: "C", status: "waiting", created_at: "2026-10-13T20:01:00Z" },
      { run_id: "K", role: "descendant", parent_run_id: "O", status: "waiting", created_at: "2026-10-13T20:02:00Z" },
      { run_id: "G", role: "descendant", parent_run_id: "K", status: "running", created_at: "2026-10-13T20:03:00Z" },
    ];
    const t = fold_tree("G", rows);
    expect(tree_root_id("G", new Map(rows.map((r) => [r.run_id, r])))).toBe("O");
    expect(t.controller_id).toBe("C");
    expect(t.root?.run.run_id).toBe("O");
    expect(t.root?.children[0].run.run_id).toBe("K");
    expect(t.root?.children[0].children[0].run.run_id).toBe("G");
    expect(t.root?.children[0].children[0].depth).toBe(2);
  });

  it("plain session runs: the topmost loaded ancestor is the root; no controller line", () => {
    const rows: RunSummary[] = [
      { run_id: "A", session_id: "s1", status: "completed" },
      { run_id: "B", session_id: "s1", parent_run_id: "A", status: "completed" },
      { run_id: "X", session_id: "s1", status: "completed" },
    ];
    const t = fold_tree("B", rows);
    expect(t.root?.run.run_id).toBe("A");
    expect(t.controller_id).toBe("");
    expect(t.size).toBe(2);
  });

  it("an occurrence stops the walk even when its parent row carries no role (older rows)", () => {
    const rows: RunSummary[] = [
      { run_id: "C", status: "waiting" },
      { run_id: "O", role: "occurrence", parent_run_id: "C", status: "waiting" },
      { run_id: "O2", role: "occurrence", parent_run_id: "C", status: "completed" },
      { run_id: "K", parent_run_id: "O", status: "running" },
    ];
    const t = fold_tree("K", rows);
    expect(t.root?.run.run_id).toBe("O");
    expect(t.controller_id).toBe("C");
    expect(t.size).toBe(2);
  });

  it("a parent cycle terminates; an unknown subject is reported, not invented", () => {
    const rows: RunSummary[] = [
      { run_id: "P", parent_run_id: "Q" },
      { run_id: "Q", parent_run_id: "P" },
    ];
    const t = fold_tree("P", rows);
    expect(t.size).toBe(2);
    expect(fold_tree("nope", rows)).toMatchObject({ root: null, subject_found: false, size: 0 });
  });
});

describe("fold_spend", () => {
  it("live tree with metrics: per-node counts as the rows carry them, tree-inclusive", () => {
    const t = fold_tree(OCC, SESSION_ROWS);
    const s = fold_spend(t, SESSION_ROWS, Date.parse("2026-10-14T00:30:00Z"));
    expect(s.inclusive).toBe(true);
    expect(s.any_metrics).toBe(true);
    expect(s.rows.map((r) => [r.run_id.slice(0, 8), r.depth, r.tokens_total, r.llm_calls, r.tool_calls, r.steps])).toEqual([
      ["02c4a311", 0, 70007, 3, 8, 738],
      ["4a2d1440", 1, 0, 0, 0, 4],
      ["6defd6b2", 1, 70007, 3, 8, 725],
      ["00fd4eac", 1, 0, 0, 0, 4],
    ]);
    // The occurrence's tokens EQUAL its child's: inclusive, so a column must never be summed.
    expect(s.rows.every((r) => r.inclusive === true)).toBe(true);
    const occ = SESSION_ROWS.find((r) => r.run_id === OCC)!;
    expect(s.rows[0].duration_ms).toBe((parse_iso_ms(occ.updated_at) as number) - (parse_iso_ms(occ.created_at) as number));
    expect(s.rows[0].running).toBe(false);
    expect(s.rows[0].is_subject).toBe(true);
  });

  it("rows listed without metrics: counts null, any_metrics false; an active run's time runs to now", () => {
    const now = Date.parse("2026-10-13T23:50:00Z");
    const t = fold_tree(OCC, WAITING_ROWS);
    const s = fold_spend(t, WAITING_ROWS, now);
    expect(s.any_metrics).toBe(false);
    expect(s.rows[0].tokens_total).toBeNull();
    expect(s.rows[0].running).toBe(true);
    expect(s.rows[0].duration_ms).toBe(now - (parse_iso_ms("2026-10-13T23:11:33.519669+00:00") as number));
  });
});

// --- Agent profile (operator 2026-10-14 11:11) -----------------------------------------
// Orchestrator fixtures: live read-only GETs (gateway 127.0.0.1:8080, 2026-10-14 ~09:21 UTC)
// of automation d18e1757, its occurrence #13 (f66b78f7) and that occurrence's subrun 158a95a4;
// home paths rewritten, long bodies trimmed and marked inside the fixtures (LANE-C.md).

const O_AUTO = fix("orch_automation.json"); // GET /automations/d18e1757…
const O_DETAIL = fix("orch13_detail.json"); // GET /runs/f66b78f7…
const O_INPUT = fix("orch13_input_data.json"); // GET /runs/f66b78f7…/input_data
const O_FLOW = fix("orch_flow.json"); // GET /bundles/abstractassistant-orchestrator@0.0.9/flows/c53b1579
const O_LEDGER = fix("orch13_ledger.json").items; // the occurrence's 7 records + 9 of its subrun's 459
const O_ROWS: RunSummary[] = fix("orch_session_runs_metrics.json").items; // GET /runs?session_id=automation:d18e1757…&include_metrics=true
const O_OCC = "f66b78f7-8400-5d16-b8b4-2fdd75ffae0f";
const O_CHILD = "158a95a4-3af5-4ead-96c6-e69f4b75d1b6";
const O_NOW = Date.parse("2026-10-14T09:30:00Z");
const O_FLOW_TOOLS = ["edit_file", "analyze_code", "execute_command", "fetch_url", "list_files", "read_file", "search_files", "web_search", "write_file"];
const O_MODEL = "Jundot/Qwen3.8-27B-oQ4e-mtp";
const occ_records = O_LEDGER.filter((x: any) => x.run_id === O_OCC);

describe("orchestrator fixtures are the live reads they claim to be", () => {
  it("the occurrence was sent only context/prompt/use_context; model, provider and tools come from elsewhere", () => {
    expect(O_INPUT.run_id).toBe(O_OCC);
    expect(Object.keys(O_INPUT.input_data).sort()).toEqual(["context", "prompt", "use_context"]);
    expect(O_DETAIL.flow_warnings).toEqual(["#FALLBACK: missing provider/model; using runtime defaults"]);
    expect(O_AUTO.definition.target.workflow_id).toBe("abstractassistant-orchestrator@0.0.9:c53b1579");
    expect(O_AUTO.definition.target.input_data._runtime).toEqual({ operator_email: "test@abstractframework.ai" });
    expect(flow_root(O_FLOW)?.nodes[0].data.pinDefaults.tools).toEqual(O_FLOW_TOOLS);
    expect(new Set(O_LEDGER.map((x: any) => x.run_id))).toEqual(new Set([O_OCC, O_CHILD]));
    // Sanitized: no operator home path in any fixture the profile reads.
    expect(JSON.stringify([O_AUTO, O_DETAIL, O_INPUT, O_FLOW, O_LEDGER, O_ROWS])).not.toContain("/Users/");
  });
});

describe("fold_ledger_use — what the ledger shows", () => {
  it("the occurrence and its subrun: models, tools, the delegated subrun and what it was handed", () => {
    const u = fold_ledger_use(O_LEDGER, O_OCC);
    expect(u.loaded && u.subject_found).toBe(true);
    expect(u.runs.map((r) => [r.run_id.slice(0, 8), r.llm_calls, r.tool_calls, r.tool_failures])).toEqual([
      ["f66b78f7", 1, 0, 0],
      ["158a95a4", 2, 5, 0],
    ]);
    // The router's call carries no provider/model in its payload: read from `_provider_request`.
    expect(u.models).toEqual([{ provider: "mlx", model: O_MODEL, calls: 3, run_ids: [O_OCC, O_CHILD] }]);
    expect(u.tools).toEqual([{ name: "web_search", calls: 5, failures: 0, run_ids: [O_CHILD], outside_declared: null }]);
    expect(u.subruns).toEqual([
      {
        run_id: O_CHILD,
        workflow_id: "visual_react_agent_abstractassistant-orchestrator_0_0_9_c53b1579_assistant_agent",
        from_run_id: O_OCC,
        provider: "mlx",
        model: O_MODEL,
        allowed_tools: O_FLOW_TOOLS,
        max_iterations: 24,
      },
    ]);
    expect([...(u.allowlist || [])].sort()).toEqual([...O_FLOW_TOOLS].sort());
    expect(u.missing_run_ids).toEqual([]);
    expect(u.first_ms).toBe(Date.parse("2026-10-13T22:43:45.038Z"));
  });

  it("only the occurrence's records: the subrun it started is reported missing, never invented", () => {
    const u = fold_ledger_use(occ_records, O_OCC);
    expect(u.llm_calls).toBe(1);
    expect(u.tool_calls).toBe(0);
    expect(u.tools).toEqual([]);
    expect(u.missing_run_ids).toEqual([O_CHILD]);
    expect(fold_ledger_use(occ_records, O_OCC, [O_CHILD, "other-desc"]).missing_run_ids).toEqual([O_CHILD, "other-desc"]);
  });

  it("not passed ≠ passed empty; a failed tool result counts as a failure", () => {
    expect(fold_ledger_use(undefined, O_OCC)).toMatchObject({ loaded: false, subject_found: false, runs: [] });
    expect(fold_ledger_use([], O_OCC)).toMatchObject({ loaded: true, subject_found: false });
    const rec = (status: string, results: any[] | null) => ({
      run_id: "r",
      step_id: "s1",
      status,
      effect: { type: "tool_calls", payload: { tool_calls: [{ name: "read_file", call_id: "c1" }, { name: "send_email", call_id: "c2" }] } },
      result: results ? { results } : null,
    });
    const u = fold_ledger_use(
      [
        { run_id: "r", cursor: 1, record: rec("started", null) },
        { run_id: "r", cursor: 2, record: rec("completed", [{ name: "read_file", success: true }, { name: "send_email", success: false, error: "refused" }]) },
      ],
      "r",
    );
    expect(u.tool_calls).toBe(2);
    expect(u.tool_failures).toBe(1);
    expect(u.tools.find((t) => t.name === "send_email")).toMatchObject({ calls: 1, failures: 1 });
  });
});

describe("fold_agent_profile — orchestrator occurrence #13 (model/tools not sent)", () => {
  const prof = fold_agent_profile(O_DETAIL, O_INPUT, O_FLOW, O_AUTO, O_LEDGER, O_ROWS, O_NOW);

  it("who: workflow, subject, role, the model it USED (ledger), the flow's system prompt, the full task", () => {
    expect(prof.subject_id).toBe(O_OCC);
    expect(prof.who.workflow).toEqual({
      value: { id: "abstractassistant-orchestrator@0.0.9:c53b1579", name: "abstractassistant-orchestrator 0.0.9", version: "0.0.9", flow_name: "AbstractAssistant Orchestrator" },
      source: "run",
      why: "",
    });
    expect(prof.who.subject.value).toMatchObject({ kind: "automation", title: "Evolution of prices and stock availability of new and used for:" });
    expect(prof.who.role.value?.text).toBe("run #13");
    expect(prof.who.model).toEqual({ value: [{ provider: "mlx", model: O_MODEL, calls: 3 }], source: "used", why: "" });
    expect(prof.who.model_declared).toBeNull();
    expect(prof.who.system_prompt.source).toBe("flow default");
    expect(prof.who.system_prompt.value).toBe(flow_root(O_FLOW)?.nodes[0].data.pinDefaults.system);
    expect(prof.who.task).toEqual({ value: O_INPUT.input_data.prompt, source: "run", why: "" });
    expect(String(prof.who.task.value)).toHaveLength(369);
  });

  it("access: may call = the flow default; enforced allowlist and calls from the ledger; policy from the automation", () => {
    expect(prof.access.tools_allowed).toEqual({ value: O_FLOW_TOOLS, source: "flow default", why: "" });
    expect(prof.access.runtime_allowlist.source).toBe("used");
    expect(prof.access.tools_called).toEqual({ value: [{ name: "web_search", calls: 5, failures: 0, run_ids: [O_CHILD], outside_declared: false }], source: "used", why: "" });
    expect(prof.access.tool_approval).toEqual({ value: "auto", source: "automation", why: "" });
    expect(prof.access.untrusted_input_tools).toEqual({ value: [], source: "automation", why: "" });
    expect(prof.access.email_recipients.value).toEqual(["self"]);
    expect(prof.access.operator_email).toBe("test@abstractframework.ai");
    expect(prof.access.workspace.mode).toEqual({ value: "all_except_ignored", source: "run", why: "" });
    expect(prof.access.workspace.root.value).toBe(O_DETAIL.workspace_root);
    expect(prof.access.workspace.ignored_paths.value).toEqual(["/home/operator/Pictures", "/home/operator/Downloads"]);
  });

  it("does: calls from the ledger, the delegated subrun, the full outcome", () => {
    expect(prof.does.llm_calls).toEqual({ value: 3, source: "used", why: "" });
    expect(prof.does.tool_calls).toEqual({ value: { calls: 5, failures: 0 }, source: "used", why: "" });
    expect(prof.does.subruns.value?.map((s) => s.run_id)).toEqual([O_CHILD]);
    expect(prof.does.artifacts).toEqual([]);
    expect(prof.does.outcome).toEqual({ value: O_DETAIL.output.response, source: "output", why: "" });
    expect(prof.does.children_not_loaded).toEqual([]);
  });

  it("how long: clock, iterations (handed 24, used 2), tokens, cadence, occurrences, retry", () => {
    const h = prof.how_long;
    expect(h.started_ms).toBe(Date.parse("2026-10-13T22:43:43.651Z"));
    expect(h.finished_ms).toBe(Date.parse("2026-10-13T22:58:36.377Z"));
    expect(h.running).toBe(false);
    expect(h.duration).toEqual({ value: 892726, source: "run", why: "" });
    expect(h.max_iterations).toEqual({ value: 24, source: "used", why: "" });
    expect(h.iterations_used).toEqual({ value: 2, source: "output", why: "" });
    expect(h.tokens).toMatchObject({ used: 0, budget: 262144, warn_pct: 80 });
    expect(h.cadence).toEqual({ value: { text: "every 24h", start_ms: Date.parse("2026-10-02T19:53:29.622Z") }, source: "automation", why: "" });
    expect(h.occurrence.value).toEqual({ index: 13, count: 13 });
    expect(h.stop_after).toEqual({ value: null, source: "automation", why: "no count limit" });
    expect(h.stop_at).toEqual({ value: null, source: "automation", why: "no end date" });
    expect(h.retry.value).toEqual({ max_attempts: 3, backoff_initial: "30s", backoff_factor: 2, backoff_max: "10m", failure: "continue", misfire: "coalesce", serial: true });
  });

  it("after: notify channels, growing context with this occurrence's replay, outputs, the next occurrence", () => {
    expect(prof.after.notify).toEqual({ value: ["console"], source: "automation", why: "" });
    expect(prof.after.context.value).toEqual({ mode: "growing", growing_max_tokens: 50000, replayed_messages: 24, replayed_tokens: 11953, dropped_messages: 0, dropped_tokens: 0 });
    expect(prof.after.outputs_to.value).toBe(O_DETAIL.workspace_root);
    expect(prof.after.next.value).toEqual({ kind: "next_at", at_ms: Date.parse("2026-10-14T19:53:29.622Z"), text: "next run at 2026-10-14 19:53:29 UTC (in 10h 23m)" });
  });

  it("without the ledger: model from the output meta, counts from the listing, calls unknown — never a silent '—'", () => {
    const p = fold_agent_profile(O_DETAIL, O_INPUT, O_FLOW, O_AUTO, undefined, O_ROWS, O_NOW);
    expect(p.who.model).toEqual({ value: [{ provider: "mlx", model: O_MODEL, calls: null }], source: "output", why: "" });
    expect(p.access.tools_allowed.source).toBe("flow default");
    expect(p.access.tools_called).toEqual({ value: null, source: "", why: WHY.ledger_not_loaded });
    expect(p.access.runtime_allowlist).toEqual({ value: null, source: "", why: WHY.wire });
    expect(p.does.llm_calls).toEqual({ value: 3, source: "listing", why: "" });
    expect(p.does.subruns.source).toBe("listing");
    expect(p.how_long.max_iterations).toEqual({ value: 24, source: "flow default", why: "" });
  });

  it("only the occurrence's ledger: the subrun's calls are named as not loaded here", () => {
    const p = fold_agent_profile(O_DETAIL, O_INPUT, O_FLOW, O_AUTO, occ_records, O_ROWS, O_NOW);
    expect(p.does.llm_calls.value).toBe(1);
    expect(p.access.tools_called.value).toEqual([]);
    expect(p.does.children_not_loaded).toEqual([O_CHILD]);
  });

  it("nothing reports the model: 'gateway default (not reported on this wire)', tagged gateway", () => {
    const p = fold_agent_profile(null, O_INPUT, O_FLOW, O_AUTO, undefined, [], O_NOW, { subject_run_id: O_OCC });
    expect(p.who.model).toEqual({ value: null, source: "gateway", why: WHY.gateway_default });
  });
});

describe("fold_agent_profile — precedence and edges", () => {
  it("run beats flow default beats automation; a used model that differs from the request is said", () => {
    const sent = { ...O_INPUT, input_data: { ...O_INPUT.input_data, provider: "lmstudio", model: "qwen-asked", tools: ["read_file"], max_iterations: 5, system: "be brief" } };
    const p = fold_agent_profile(O_DETAIL, sent, O_FLOW, O_AUTO, O_LEDGER, O_ROWS, O_NOW);
    expect(p.who.model.source).toBe("used");
    expect(p.who.model_declared).toEqual({ value: { provider: "lmstudio", model: "qwen-asked", calls: null }, source: "run", why: "" });
    expect(p.access.tools_allowed).toEqual({ value: ["read_file"], source: "run", why: "" });
    expect(p.who.system_prompt).toEqual({ value: "be brief", source: "run", why: "" });
    // web_search was called but the run's declared list is [read_file]: a finding, not an error.
    expect(p.access.tools_called.value?.[0]).toMatchObject({ name: "web_search", outside_declared: true });
    const no_ledger = fold_agent_profile(null, sent, O_FLOW, O_AUTO, undefined, [], O_NOW, { subject_run_id: O_OCC });
    expect(no_ledger.who.model).toEqual({ value: [{ provider: "lmstudio", model: "qwen-asked", calls: null }], source: "run", why: "" });
    expect(no_ledger.how_long.max_iterations).toEqual({ value: 5, source: "run", why: "" });
    const auto_only = fold_agent_profile(null, null, null, AUTOMATION, undefined, [], O_NOW, { subject_run_id: OCC, row: { run_id: OCC, role: "occurrence", automation_id: CONTROLLER } });
    expect(auto_only.who.model).toEqual({ value: [{ provider: "mlx", model: "Jundot/Qwen3.8-27B-oQ4e-mtp", calls: null }], source: "automation", why: "" });
    expect(auto_only.who.system_prompt).toEqual({ value: null, source: "", why: WHY.flow_not_loaded });
  });

  it("next run: paused, completed on its last occurrence, manual, and the trigger's count/until", () => {
    const with_summary = (summary: any, trigger?: any) => ({ ...O_AUTO, summary: { ...O_AUTO.summary, ...summary, ...(trigger ? { trigger } : {}) } });
    const next = (auto: any) => fold_agent_profile(O_DETAIL, O_INPUT, O_FLOW, auto, undefined, O_ROWS, O_NOW).after.next.value;
    expect(next(with_summary({ status: "paused" }))).toEqual({ kind: "none", at_ms: null, text: "no next run (paused)" });
    expect(next(with_summary({ status: "completed", next_fire_at: null }))).toEqual({ kind: "last", at_ms: null, text: "this was the last (stop reached)" });
    expect(next(with_summary({ status: "completed", last_occurrence: { ...O_AUTO.summary.last_occurrence, index: 14 } }))?.kind).toBe("none");
    expect(next(with_summary({ next_fire_at: null }, { source_id: "manual", config: {} }))).toEqual({ kind: "on_trigger", at_ms: null, text: "next run when someone runs it" });
    // Mail, a feed: the next run is what arrives next, in words (the real source ids; UX review 2026-10-25 #2).
    expect(next(with_summary({ next_fire_at: null, next_run_at: null }, { source_id: "email.received", source_version: 1, config: {} }))).toEqual({ kind: "on_trigger", at_ms: null, text: "next run when mail arrives in your main mailbox" });
    expect(next(with_summary({ next_fire_at: null, next_run_at: null }, { source_id: "feed.item", source_version: 1, config: { connection_id: "c1" } }))).toEqual({ kind: "on_trigger", at_ms: null, text: "next run when a feed has a new item" });
    const bounded = fold_agent_profile(O_DETAIL, O_INPUT, O_FLOW, with_summary({}, { source_id: "schedule", config: { every: "24h", count: 20, until: "2026-12-31T00:00:00+00:00" } }), undefined, O_ROWS, O_NOW);
    expect(bounded.how_long.stop_after).toEqual({ value: 20, source: "automation", why: "" });
    expect(bounded.how_long.stop_at).toEqual({ value: Date.parse("2026-12-31T00:00:00Z"), source: "automation", why: "" });
  });

  it("a plain session run: automation facts say 'not an automation run', the subject is the session", () => {
    const p = fold_agent_profile({ run_id: "p1", status: "running", session_id: "sess-1", workflow_id: "basic-agent@0.0.5:81795ea9", created_at: "2026-10-14T09:00:00Z" }, null, null, null, undefined, [], O_NOW);
    expect(p.is_automation).toBe(false);
    expect(p.who.subject.value).toEqual({ kind: "session", title: "", id: "sess-1" });
    expect(p.who.role.value?.text).toBe("run in a session");
    for (const f of [p.access.tool_approval, p.after.notify, p.after.next, p.how_long.cadence, p.how_long.retry]) expect(f).toEqual({ value: null, source: "", why: WHY.not_automation });
    expect(p.does.outcome.why).toBe(WHY.not_ended);
    expect(p.how_long.duration).toEqual({ value: 30 * 60_000, source: "run", why: "" });
  });

  it("basic-agent occurrence #5 (no ledger): the run's own model/tools, the automation's allowlist, the artifact it produced", () => {
    const p = fold_agent_profile(DETAIL, INPUT, FLOW, AUTOMATION, undefined, SESSION_ROWS, Date.parse("2026-10-14T00:30:00Z"));
    expect(p.who.model.source).toBe("output");
    expect(p.access.tools_allowed).toEqual({ value: ["fetch_url", "skim_url", "skim_websearch", "web_search"], source: "run", why: "" });
    expect(p.access.runtime_allowlist.source).toBe("automation");
    expect(p.who.system_prompt).toEqual({ value: null, source: "flow", why: "none declared: not provided and the flow has no default" });
    expect(p.how_long.max_iterations).toEqual({ value: 20, source: "run", why: "" });
    expect(p.how_long.iterations_used.value).toBe(3);
    expect(p.does.artifacts).toEqual([{ pin: "scratchpad", id: "6f3694a4e5a0bb029de9a3d709203962" }]);
    expect(p.after.notify.value).toEqual(["console", "email"]);
    expect(p.after.next.value?.text).toBe("next run at 2026-10-14 23:06:22 UTC (in 22h 36m)");
    expect(fmt_utc(Date.parse("2026-10-14T23:06:22.996Z"))).toBe("2026-10-14 23:06:22 UTC");
  });
});
