import type { RunSummary } from "./run_status";
// The Agent page (backlog 0003 §Agent page, wave 3), rendered from live
// gateway 0.13.1 reads saved under untracked/redesign/fixtures/ (LANE-B.md).
// Wave-3 gate: basic-agent 0.0.5's 13 start pins render with live values and
// the end pins as the flow JSON declares them. A missing fixture THROWS.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentPage, detail_is_fresh, header_action, merged_subject, type AgentPageProps } from "./agent_page";
import { PIN_COLORS, PIN_TYPES, pin_shape_kind } from "./pin_palette";
import { CopyButton, PinList, Value, clamp_string, copy_text_of, json_summary, list_fit, pin_copy_text } from "./pins";
import type { RunSummary } from "./run_status";
import { fold_automation_brief, make_context, state_line } from "./state_line";

const FIX_DIR = join(__dirname, "__fixtures__");
const fix = (name: string): any => JSON.parse(readFileSync(join(FIX_DIR, name), "utf8"));

const FLOW = fix("bundle_flow.json");
const INPUT = fix("occ5_input_data.json");
const INPUT_WAITING = fix("occ5_input_data_while_waiting.json");
const DETAIL = fix("occ5_detail_completed.json");
const DETAIL_WAITING = fix("occ5_detail_waiting.json");
const AUTOMATION = fix("automation.json");
const AUTOMATION_WAITING = fix("automation_while_waiting.json");
const SESSION_ROWS: RunSummary[] = fix("session_runs_metrics.json").items;
const WAITING_ROWS: RunSummary[] = fix("runs_while_waiting.json").items;

const OCC = "02c4a311-4e44-508d-96fb-98a205928054";
const CHILD = "6defd6b2-e7a1-4915-8cb9-ec01e3e1321a";
const CONTROLLER = "e3079778-1ba0-50aa-83a3-6ac31b39e471";
const LIVE_PIN_IDS = ["use_context", "memory", "context", "provider", "model", "system", "prompt", "tools", "max_iterations", "max_in_tokens", "temperature", "seed", "resp_schema"];

const noop = () => {};
const html = (el: React.ReactElement) =>
  renderToStaticMarkup(el).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** The visible text of a markup fragment (tags and attributes stripped). */
const text = (m: string) => m.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
/** The markup of the block `data-block="<id>"` (up to the next block; the profile nests sections). */
function block(m: string, id: string): string {
  const start = m.indexOf(`data-block="${id}"`);
  if (start < 0) throw new Error(`no block ${id}`);
  const end = m.indexOf("data-block=", start + 12);
  return m.slice(start, end < 0 ? undefined : end);
}
/** The markup between `aria-label="<label>"` and the next pins wrapper. */
function pin_list(m: string, label: string): string {
  const start = m.indexOf(`<div class="ap_pins" aria-label="${label}">`);
  if (start < 0) throw new Error(`no pin list ${label}`);
  const next = m.indexOf('<div class="ap_pins"', start + 10);
  return m.slice(start, next < 0 ? undefined : next);
}
const count = (m: string, needle: string) => m.split(needle).length - 1;

const row = (rows: RunSummary[], id: string) => {
  const r = rows.find((x) => x.run_id === id);
  if (!r) throw new Error(`fixture lacks run ${id}`);
  return r;
};

function props(over: Partial<AgentPageProps> = {}): AgentPageProps {
  return {
    run: row(SESSION_ROWS, OCC),
    detail: DETAIL,
    input_data: INPUT,
    flow: FLOW,
    automation: fold_automation_brief(AUTOMATION),
    automation_body: AUTOMATION,
    runs: SESSION_ROWS,
    now_ms: Date.parse("2026-10-14T00:30:00Z"),
    loading: { detail: false, input_data: false, flow: false },
    errors: {},
    on_open_run: noop,
    on_ask: noop,
    on_action: noop,
    ...over,
  };
}

describe("AgentPage — wave-3 gate on the live basic-agent 0.0.5 occurrence", () => {
  const m = html(<AgentPage {...props()} />);
  const inputs = pin_list(m, "Inputs");
  const outputs = pin_list(m, "Outputs");

  it("draws the 13 start pins, in order, with the live values the run holds", () => {
    const ids = [...inputs.matchAll(/data-pin-id="([^"]+)" data-pin-state="([^"]+)"/g)].map((x) => [x[1], x[2]]);
    expect(ids.map(([id]) => id)).toEqual(LIVE_PIN_IDS);
    expect(ids.filter(([, s]) => s === "value")).toHaveLength(9);
    expect(ids.filter(([, s]) => s === "not_provided").map(([id]) => id)).toEqual(["memory", "system", "max_in_tokens", "resp_schema"]);
    expect(count(inputs, ">not provided<")).toBe(4);
    expect(m).toContain("13 pins · 9 provided");
    expect(inputs).toContain('<span class="ap_pin_string"><span class="ap_pin_text">Jundot/Qwen3.8-27B-oQ4e-mtp</span></span>');
    expect(inputs).toContain('<code class="ap_pin_scalar">20</code>');
    expect(inputs).toContain('<code class="ap_pin_scalar">0.7</code>');
    expect(inputs).toContain('<code class="ap_pin_scalar">-1</code>');
    expect(inputs).toContain('<code class="ap_pin_scalar">true</code>');
    expect(text(inputs)).toContain("array · 4 items: fetch_url, skim_url, skim_websearch, web_search");
    expect(text(inputs)).toContain("object · 2 keys: task, messages");
    // The 627-char occurrence prompt is clamped with its own expander.
    expect(inputs).toMatch(/<span class="ap_pin_text">\[Trigger schedule@1 · occurrence 5[^<]*…<\/span><button type="button" class="ap_link_btn" aria-expanded="false">show all \(627 chars\)<\/button>/);
  });

  it("uses the editor's shapes and colours (verbatim palette) for each pin type", () => {
    const glyph = (id: string) => {
      const at = inputs.indexOf(`data-pin-id="${id}"`);
      return inputs.slice(at, inputs.indexOf("</svg>", at));
    };
    expect(glyph("use_context")).toContain(`data-pin-shape="diamond"`);
    expect(glyph("use_context")).toContain(`color:${PIN_COLORS.boolean}`);
    expect(glyph("tools")).toContain(`data-pin-shape="square"`);
    expect(glyph("tools")).toContain(`color:${PIN_COLORS.tools}`);
    expect(glyph("prompt")).toContain(`data-pin-shape="circle"`);
    expect(glyph("prompt")).toContain("color:#FF00FF");
    expect(glyph("memory")).toContain(`color:${PIN_COLORS.memory}`);
    // Filled when the pin carries a value, hollow when not provided.
    expect(glyph("prompt")).toContain('fill="currentColor"');
    expect(glyph("memory")).toContain('fill="none"');
  });

  it("draws the end pins exactly as the flow JSON declares them, valued from the output", () => {
    const ids = [...outputs.matchAll(/data-pin-id="([^"]+)" data-pin-state="([^"]+)"/g)].map((x) => [x[1], x[2]]);
    expect(ids).toEqual([
      ["response", "value"],
      ["success", "value"],
      ["meta", "value"],
      ["scratchpad", "value"],
    ]);
    expect(outputs).toContain('<span class="ap_pin_type mono">string</span>');
    expect(outputs).toContain('<span class="ap_pin_type mono">boolean</span>');
    // The artifact id is shown whole (no clipped ids), and the meta pin lists ALL its keys.
    expect(outputs).toContain("artifact 6f3694a4e5a0bb029de9a3d709203962");
    expect(text(outputs)).toContain("object · 9 keys: schema, version, provider, model, sub_run_id, iterations, tool_calls, tool_results, output_mode");
    expect(outputs).toContain("show all (15,487 chars)");
    expect(m).toContain("4 pins");
  });
});

describe("AgentPage — header, profile, context, tree, spend, ask (completed occurrence)", () => {
  const m = html(<AgentPage {...props()} />);

  it("header: subject mark, the automation's title, status pill, subject line, state sentence, copy id — and no uuid as text", () => {
    const head = m.slice(0, m.indexOf("</header>"));
    expect(head).toContain('<span class="ap_mark ap_mark_automation" title="automation">⟳</span>');
    expect(head).toContain(AUTOMATION.summary.title);
    expect(head).toContain('title="Title from: automation"');
    expect(head).toContain('<span class="chip ok">completed</span>');
    expect(head).toContain('<div class="ap_subject_line">run #5 · basic-agent 0.0.5</div>');
    expect(head).toContain('<span class="ap_state_text">completed in 52m</span>');
    expect(head).toContain(`title="Copy run id ${OCC}"`);
    expect(text(m)).not.toContain(OCC);
    expect(text(m)).not.toContain(CHILD);
  });

  it("profile: model, tools, policy and workspace, each fact tagged with its source", () => {
    const b = block(m, "profile");
    expect(text(b)).toContain("Model · provider mlx · Jundot/Qwen3.8-27B-oQ4e-mtp output");
    expect(text(b)).toContain("May call fetch_url skim_url skim_websearch web_search run");
    expect(text(b)).toContain("Tool approval auto automation");
    expect(text(b)).toContain("Runtime allowlist the same 4 tools as above automation");
    expect(text(b)).toContain("Untrusted-input tools none automation");
    expect(text(b)).toContain("Email recipients self (test@abstractframework.ai) automation");
    expect(text(b)).toContain("Workspace all_except_ignored " + DETAIL.workspace_root);
    expect(text(b)).toContain("Max iterations 20 run");
    expect(text(b)).toContain("Did call — ledger not loaded here");
    expect(text(b)).toContain("LLM calls 3 tree-inclusive: this run and every run below it listing");
    expect(text(b)).toContain("Artifacts 1 artifact: scratchpad output");
    expect(text(b)).toContain("Notifies console email → the owner's registered address (not on this wire) automation");
  });

  it("context: the window note, the token gauge with its warn threshold, the policy, no warnings", () => {
    const b = block(m, "context");
    expect(b).toContain("replayed 8 of 8 messages (14,938 of 100,000 tokens); nothing left out");
    expect(text(b)).toContain("0 of 262,144 tokens (0%) · warns at 80%");
    expect(b).toContain('role="meter"');
    expect(b).toContain('style="left:80%"');
    expect(text(b)).toContain("History policy most_recent_whole_turns · strict · automation session");
    expect(text(b)).toContain("Flow warnings none");
  });

  it("run tree: the controller as a parent line, the occurrence and its 3 children, the subject marked once", () => {
    const b = block(m, "tree");
    expect(b).toContain(`data-run-id="${CONTROLLER}"`);
    expect(text(b)).toContain("other occurrences not shown");
    expect(count(b, 'class="ap_tree_node')).toBe(4);
    expect(count(b, 'aria-current="true"')).toBe(1);
    expect(b).toMatch(new RegExp(`aria-current="true" title="Open run ${OCC}"`));
    expect(text(b)).toContain("run #5 · basic-agent 0.0.5 completed in 52m");
    expect(b).not.toContain('data-run-id="db080535');
    expect(m).toContain("4 runs");
  });

  it("spend: one row per node, tree-inclusive caption, the inclusive counts as served", () => {
    const b = block(m, "spend");
    expect(b).toContain("tree-inclusive");
    expect(b).toContain("Tree-inclusive: each row counts its own run and every run below it, so rows do not add up.");
    expect(count(b, "<tr ")).toBe(4);
    expect(count(b, "<td>70,007</td>")).toBe(2);
    expect(b).toContain('<tr class="ap_spend_subject"');
    expect(b).toContain("<td>52m 1s</td>");
    expect(b).not.toContain("not loaded");
  });

  it("ask: one button, with the window note when the host passes one", () => {
    const b = block(html(<AgentPage {...props({ ask_window_note: "history window: last 12 messages" })} />), "ask");
    expect(b).toContain("history window: last 12 messages");
    expect(b).toContain(">Ask about this run</button>");
  });

  it("blocks come in the design's order", () => {
    const order = ["profile", "pins", "context", "tree", "spend", "ask"].map((id) => m.indexOf(`data-block="${id}"`));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("AgentPage — the parked occurrence at 23:50 UTC (its child running, no progress for 37 min)", () => {
  const now = Date.parse("2026-10-13T23:50:00Z");
  const p = props({
    run: row(WAITING_ROWS, OCC),
    detail: DETAIL_WAITING,
    input_data: INPUT_WAITING,
    automation: fold_automation_brief(AUTOMATION_WAITING),
    automation_body: AUTOMATION_WAITING,
    runs: WAITING_ROWS,
    now_ms: now,
  });
  const m = html(<AgentPage {...p} />);

  it("says what it waits on, who ends it, and offers the one action that follows", () => {
    expect(m).toContain('<span class="ap_state_text">running subrun visual_react_agent_basic-agent_0_0_5_81795ea9_node-2 · last step 37m ago · no progress</span>');
    expect(m).toContain(`title="Ended by run ${CHILD}"`);
    expect(m).toContain(">Open subrun</button>");
    // P5: the pill follows the sentence — a parent parked on its working child reads running, in the header and the tree.
    expect(m.slice(0, m.indexOf("</header>"))).toContain('<span class="chip info">running</span>');
    expect(m).not.toContain(">waiting</span>");
    const ctx = make_context(WAITING_ROWS, { now_ms: now, details: new Map([[OCC, DETAIL_WAITING]]) });
    expect(header_action(state_line(merged_subject(p.run, DETAIL_WAITING), ctx), OCC)).toEqual({ action: "open_subrun", label: "Open subrun", run_id: CHILD });
  });

  it("outputs are '—' until the run ends; spend says metrics are not loaded; time runs to now", () => {
    const outputs = pin_list(m, "Outputs");
    expect(count(outputs, 'data-pin-state="absent"')).toBe(4);
    expect(count(outputs, 'title="no output until the run ends"')).toBe(4);
    expect(m).toContain("values appear when the run ends");
    const b = block(m, "spend");
    expect(b).toContain("token and call counts not loaded");
    expect(b).toContain("38m 26s so far");
  });
});

describe("AgentPage — honest when its sources are loading, failed or absent", () => {
  it("loading: every block says what it is waiting for and draws no invented pins", () => {
    const m = html(
      <AgentPage {...props({ detail: null, input_data: null, flow: null, automation: null, automation_body: null, loading: { detail: true, input_data: true, flow: true } })} />,
    );
    expect(m).toContain("loading the flow…");
    expect(m).toContain("loading the run's inputs…");
    expect(m).toContain("reading the run detail… (the line above is from the listing row)");
    expect(block(m, "context")).toContain("loading the run detail…");
    expect(m).not.toContain("data-pin-state");
    expect(block(m, "profile")).toContain("automation definition not loaded: tool policy unknown");
  });

  it("errors are shown with the gateway's reason; inputs still list the gateway's pin ids, untyped", () => {
    const m = html(
      <AgentPage
        {...props({
          flow: null,
          detail: null,
          errors: { flow: "get_workflow_flow failed: 500", detail: "get_run failed: 502 Bad Gateway" },
        })}
      />,
    );
    expect(m).toContain("the flow did not load (get_workflow_flow failed: 500): pin types unknown");
    expect(m).toContain("run detail unavailable: get_run failed: 502 Bad Gateway");
    const inputs = pin_list(m, "Inputs");
    expect(count(inputs, 'data-pin-state="value"')).toBe(9);
    expect(count(inputs, '<span class="ap_pin_type mono">untyped</span>')).toBe(13);
  });

  it("a pin-less end renders one untyped pass-through output", () => {
    const flow = {
      nodes: [
        { id: "s", type: "on_flow_start", data: { nodeType: "on_flow_start", outputs: [{ id: "prompt", label: "prompt", type: "string" }] } },
        { id: "e", type: "on_flow_end", data: { nodeType: "on_flow_end", inputs: [{ id: "exec-in", type: "execution" }] } },
      ],
    };
    const m = html(<AgentPage {...props({ flow, input_data: { pin_ids: ["prompt"], input_data: { prompt: "hi" } }, detail: { ...DETAIL, output: "the answer" } })} />);
    expect(m).toContain("the end declares no pins: the run returns its last node's output");
    expect(m).toContain("pass-through");
    const outputs = pin_list(m, "Outputs");
    expect(outputs).toContain('data-pin-id="output" data-pin-state="value"');
    expect(outputs).toContain('<span class="ap_pin_type mono">untyped</span>');
    expect(outputs).toContain("the answer");
  });

  it("a reason=user row is resolved by the detail: a free-text wait says 'waits for your answer' with Answer", () => {
    const user_row = { ...row(WAITING_ROWS, OCC), status: "waiting", waiting: { reason: "user" } };
    const user_detail = { ...DETAIL_WAITING, waiting: { reason: "user", wait_key: "ask:1", prompt: null, choices: null, details: {} } };
    const m = html(<AgentPage {...props({ run: user_row, detail: user_detail, runs: WAITING_ROWS, now_ms: Date.parse("2026-10-13T23:50:00Z") })} />);
    expect(m).toContain('<span class="ap_state_text">waits for your answer · 37m</span>');
    expect(m).toContain('<span class="ap_actor ap_actor_you" title="Who ends this state">you</span>');
    expect(m).toContain('<button type="button" class="btn primary ap_action">Answer</button>');
    // Row only (no detail): the page must not pretend to know which kind of wait it is.
    const row_only = html(<AgentPage {...props({ run: user_row, detail: null, runs: WAITING_ROWS, now_ms: Date.parse("2026-10-13T23:50:00Z") })} />);
    expect(row_only).toContain("needs you: question, approval or pause · 37m");
  });

  it("a stale detail never overrides a newer row (and the page says which it used)", () => {
    const newer_row = { ...row(SESSION_ROWS, OCC), status: "running", updated_at: "2026-10-14T01:00:00Z" };
    expect(detail_is_fresh(newer_row, DETAIL)).toBe(false);
    expect(merged_subject(newer_row, DETAIL).status).toBe("running");
    expect(merged_subject(row(WAITING_ROWS, OCC), DETAIL).status).toBe("completed");
    const m = html(<AgentPage {...props({ run: newer_row })} />);
    expect(m).toContain("the listing row is newer than the detail: the line above is from the row");
  });
});

describe("PinList / value cells", () => {
  it("lists undeclared values under the caller's label, nothing hidden", () => {
    const m = html(<PinList side="in" pins={[]} also={[["workflow_selection", { source: "client" }]]} also_label="also sent" />);
    expect(m).toContain('<div class="ap_pins_also_label">also sent</div>');
    expect(m).toContain('data-pin-id="workflow_selection" data-pin-state="also"');
    expect(m).toContain("not a pin");
    expect(text(m)).toContain("object · 1 key: source");
  });

  it("not provided shows the flow default the runtime applied, and 'required' when there is none", () => {
    const pin = (over: any) => ({ id: "x", label: "x", type: "number", typed: true, required: false, description: "", state: "not_provided", value: undefined, flow_default: null, ...over });
    const m = html(<PinList side="in" pins={[pin({ flow_default: { value: 20 } }), pin({ id: "y", label: "y", required: true })]} />);
    expect(m).toContain('<span>not provided</span><div class="ap_pin_default"><span class="ap_pin_default_label">flow default</span> <code class="ap_pin_scalar">20</code></div>');
    expect(m).toContain('<span class="ap_pin_required"> · required</span>');
  });

  it("clamp_string cuts at chars or lines, json_summary describes shape only", () => {
    expect(clamp_string("short")).toEqual({ shown: "short", clamped: false });
    expect(clamp_string("a".repeat(400)).shown).toHaveLength(281);
    expect(clamp_string("1\n2\n3\n4\n5\n6\n7\n8").shown).toBe("1\n2\n3\n4\n5\n6…");
    expect(json_summary([])).toBe("array · 0 items");
    expect(json_summary([{ a: 1 }, { b: 2 }])).toBe("array · 2 items (2 objects)");
    expect(json_summary([{ a: 1 }, "x", null])).toBe("array · 3 items (1 object, 1 string, 1 null)");
    expect(json_summary({})).toBe("object · 0 keys");
    expect(json_summary({ $artifact: "0123456789abcdef0123" })).toBe("artifact 0123456789abcdef0123");
    // Complete: a long scalar list and a long key list are never clipped.
    const many = Array.from({ length: 40 }, (_, i) => `tool_number_${i}`);
    expect(json_summary(many)).toBe(`array · 40 items: ${many.join(", ")}`);
    expect(json_summary(Object.fromEntries(many.map((k) => [k, 1])))).toBe(`object · 40 keys: ${many.join(", ")}`);
  });
});

describe("pin palette and stylesheet discipline", () => {
  // The sibling repo is only present in the framework checkout; CI has no abstractflow/ next to this repo.
  const FLOW_TS = join(__dirname, "..", "..", "..", "abstractflow", "src", "types", "flow.ts");
  it.skipIf(!existsSync(FLOW_TS))("the palette is a verbatim mirror of abstractflow's flow.ts", () => {
    const flow_ts = readFileSync(FLOW_TS, "utf8").split("\n").slice(5, 85).join("\n");
    const mirror = readFileSync(join(__dirname, "pin_palette.ts"), "utf8");
    const begin = mirror.indexOf("\n", mirror.indexOf("---- BEGIN verbatim copy")) + 1;
    const end = mirror.lastIndexOf("\n", mirror.indexOf("---- END verbatim copy"));
    expect(mirror.slice(begin, end)).toBe(flow_ts);
    expect(PIN_TYPES).toHaveLength(37);
    expect(pin_shape_kind("execution")).toBe("triangle");
    expect(pin_shape_kind("assertions")).toBe("square");
    expect(pin_shape_kind("agent")).toBe("hexagon");
  });

  it("agent_page.css carries no colour literal and stacks at phone width", () => {
    const css = readFileSync(join(__dirname, "agent_page.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgba?|hsla?|oklch|lab)\(/i);
    expect(css).not.toMatch(/:\s*(white|black|red|green|blue|gray|grey)\b/i);
    expect(css).toMatch(/@media \(max-width: 767\.98px\)[\s\S]*\.ap_io \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.ap_table_wrap \{\s*overflow-x: auto;/);
  });
});

describe("GATE-1 pins (agent page)", () => {
  const NOW_MS = Date.parse("2026-10-13T23:50:00Z");
  const at = (min: number) => new Date(NOW_MS - min * 60_000).toISOString();
  const base = (p: Partial<RunSummary> & { run_id: string }): RunSummary =>
    ({ workflow_id: "basic-agent@0.0.5:81795ea9", status: "waiting", created_at: at(30), updated_at: at(10), ...p }) as RunSummary;
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);

  it("a paused automation's controller reads 'paused' on the header pill, as on the board (F2)", () => {
    const ctl = base({ run_id: "ctl", role: "controller", session_kind: "automation", automation_id: "ctl", waiting: { reason: "event", until: new Date(NOW_MS + 3_600_000).toISOString() } });
    const paused = { ...fold_automation_brief({ summary: { automation_id: "ctl", title: "Nightly", status: "paused", trigger: { source_id: "schedule", config: { every: "24h" } } }, definition: {} })! };
    const out = html(
      <AgentPage run={ctl} detail={null} input_data={null} flow={null} automation={paused} runs={[ctl]} now_ms={NOW_MS} loading={{ detail: false, input_data: false, flow: false }} errors={{}} on_open_run={() => undefined} on_ask={() => undefined} on_action={() => undefined} />,
    );
    const header = out.slice(out.indexOf('class="ap_header"'), out.indexOf('class="ap_block"'));
    expect(header).toContain(">paused<");
    expect(header).not.toContain(">waiting<");
    expect(header).not.toContain(">scheduled<");
  });

  it("the tree node of the subject reads the MERGED subject (a newer detail wins over the raw row) (M13)", () => {
    const raw = base({ run_id: "s", session_id: "sess-1", status: "waiting", waiting: { reason: "user", prompt: "Go?" }, updated_at: at(20) });
    const detail = { run_id: "s", status: "completed", updated_at: at(1), created_at: at(30), waiting: null, paused: false, current_node: null, error: null };
    const out = html(
      <AgentPage run={raw} detail={detail} input_data={null} flow={null} automation={null} runs={[raw]} now_ms={NOW_MS} loading={{ detail: false, input_data: false, flow: false }} errors={{}} on_open_run={() => undefined} on_ask={() => undefined} on_action={() => undefined} />,
    );
    const tree = out.slice(out.indexOf("Run tree"));
    expect(tree).toContain("completed in");
    expect(tree).not.toContain("asks");
    expect(out).not.toContain("needs you");
  });
});

// --- Lane C (operator 2026-10-14 11:11): the Agent profile, one value component, copy on every field ---
// Orchestrator fixtures: live read-only GETs of automation d18e1757 / occurrence #13 (f66b78f7) and
// its subrun 158a95a4 (LANE-C.md). The occurrence was sent only context/prompt/use_context.

const O_AUTO = fix("orch_automation.json");
const O_DETAIL = fix("orch13_detail.json");
const O_INPUT = fix("orch13_input_data.json");
const O_FLOW = fix("orch_flow.json");
const O_LEDGER = fix("orch13_ledger.json").items;
const O_ROWS: RunSummary[] = fix("orch_session_runs_metrics.json").items;
const O_OCC = "f66b78f7-8400-5d16-b8b4-2fdd75ffae0f";
const O_CHILD = "158a95a4-3af5-4ead-96c6-e69f4b75d1b6";
const O_CTL = "d18e1757-58ae-5e22-a61e-7b84fdee19cf";
const O_TOOLS = "edit_file, analyze_code, execute_command, fetch_url, list_files, read_file, search_files, web_search, write_file";

function o_props(over: Partial<AgentPageProps> = {}): AgentPageProps {
  return props({
    run: row(O_ROWS, O_OCC),
    detail: O_DETAIL,
    input_data: O_INPUT,
    flow: O_FLOW,
    automation: fold_automation_brief(O_AUTO),
    automation_body: O_AUTO,
    records: O_LEDGER,
    runs: O_ROWS,
    now_ms: Date.parse("2026-10-14T09:30:00Z"),
    on_reveal_workspace: noop,
    ...over,
  });
}
/** The markup of one profile group. */
function group(m: string, id: string): string {
  const start = m.indexOf(`data-group="${id}"`);
  if (start < 0) throw new Error(`no group ${id}`);
  return m.slice(start, m.indexOf("</section>", start));
}
/** Every `<summary>…</summary>` of a markup. */
const summaries = (m: string) => [...m.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((x) => x[1]);

describe("Agent profile — orchestrator occurrence #13: the facts the run was not sent, from their real source", () => {
  const m = html(<AgentPage {...o_props()} />);
  const prof = block(m, "profile");

  it("five groups, in order: who, access, does, how long, after", () => {
    const at = ["who", "access", "does", "how_long", "after"].map((g) => prof.indexOf(`data-group="${g}"`));
    expect(at.every((x) => x > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("who: model from the ledger, system prompt from the flow default, the full task", () => {
    const g = text(group(m, "who"));
    expect(g).toContain("Workflow abstractassistant-orchestrator 0.0.9 · flow “AbstractAssistant Orchestrator” run");
    expect(g).toContain("Subject Evolution of prices and stock availability of new and used for: automation");
    expect(g).toContain("Role run #13 of 13 so far · open parent run");
    expect(g).toContain("Model · provider mlx · Jundot/Qwen3.8-27B-oQ4e-mtp × 3 calls used");
    expect(g).toMatch(/System prompt You are AbstractAssistant, [^⧉]*… show all \(518 chars\) flow default/);
    expect(g).toMatch(/Task \[Trigger schedule@1 · occurrence 13 [^⧉]*… show all \(369 chars\) run/);
  });

  it("access: what it may call (flow default) vs what it did call (ledger), the policy, the workspace", () => {
    const g = text(group(m, "access"));
    expect(g).toContain(`May call ${O_TOOLS.replace(/, /g, " ")} flow default`);
    expect(g).toContain("Runtime allowlist the same 9 tools as above used");
    expect(g).toContain("Did call web_search × 5 used");
    expect(g).not.toContain("called outside the declared list");
    expect(g).toContain("Tool approval auto automation");
    expect(g).toContain("Email recipients self (test@abstractframework.ai) automation");
    expect(g).toContain(`Workspace all_except_ignored ${O_DETAIL.workspace_root} show folder run`);
  });

  it("does: calls per run, the delegated subrun and what it was handed, the outcome", () => {
    const g = group(m, "does");
    expect(text(g)).toContain("LLM calls 3 1 in this run · 2 in visual_react_agent_abstractassistant-orchestrator_0_0_9_c53b1579_assistant_agent used");
    expect(text(g)).toContain("Tool calls 5, none failed 0 in this run · 5 in");
    expect(text(g)).toContain("Delegated subruns visual_react_agent_abstractassistant-orchestrator_0_0_9_c53b1579_assistant_agent · handed mlx · Jundot/Qwen3.8-27B-oQ4e-mtp · 9 tools · max 24 iterations used");
    expect(g).toContain(`title="Open run ${O_CHILD}" data-run-id="${O_CHILD}"`);
    expect(text(g)).toMatch(/Outcome Here's the \*\*Oct 13, 2026\*\* update[^⧉]*… show all \(4,484 chars\) output/);
  });

  it("how long and after: clock, iterations, cadence, retry, notify, context, next occurrence", () => {
    const h = text(group(m, "how_long"));
    expect(h).toContain("Started 2026-10-13 22:43:43 UTC run");
    expect(h).toContain("Finished 2026-10-13 22:58:36 UTC run");
    expect(h).toContain("Duration 14m 52s run");
    expect(h).toContain("Max iterations 24 used");
    expect(h).toContain("Iterations used 2 output");
    expect(h).toContain("Cadence every 24h · since 2026-10-02 19:53:29 UTC · next 2026-10-14 19:53:29 UTC automation");
    expect(h).toContain("Occurrences #13 of 13 so far · no count limit · no end date automation");
    expect(h).toContain("Retry policy 3 attempts · backoff 30s ×2 up to 10m · on failure: continue · misfire: coalesce · serial automation");
    const a = text(group(m, "after"));
    expect(a).toContain("Notifies console automation");
    expect(a).toContain("Context growing (cap 50,000 tokens): each occurrence replays the session so far this run replayed 24 messages (11,953 tokens), left out 0 messages automation");
    expect(a).toContain("Next next run at 2026-10-14 19:53:29 UTC (in 10h 23m) automation");
  });

  it("every row says its source or why it is absent; no bare '—'", () => {
    const rows = prof.split('<div class="ap_prow ap_copyable"').slice(1);
    expect(rows.length).toBeGreaterThan(30);
    for (const r of rows) expect(r.includes('class="ap_source"') || r.includes('class="ap_absent"')).toBe(true);
    for (const a of [...prof.matchAll(/class="ap_absent">([^<]*)</g)].map((x) => x[1])) expect(a).toMatch(/^— \S|^gateway default/);
  });

  it("copy: every valued row carries a copy button (aria 'Copy <label>'), never inside a <summary> toggle", () => {
    const rows = prof.split('<div class="ap_prow ap_copyable"').slice(1);
    for (const r of rows) {
      const label = (r.match(/<dt class="ap_prow_label">([^<]*)<\/dt>/) || [])[1];
      if (r.includes('class="ap_absent"')) continue;
      expect(r, label).toContain(`aria-label="Copy ${String(label).toLowerCase()}"`);
    }
    expect(summaries(m).length).toBeGreaterThan(0);
    for (const sm of summaries(m)) expect(sm).not.toContain("<button");
    // Pins, context rows and spend rows carry it too.
    expect(count(pin_list(m, "Inputs"), "ap_copy_btn")).toBeGreaterThanOrEqual(3);
    expect(count(block(m, "context"), "ap_copy_btn")).toBeGreaterThanOrEqual(3);
    expect(count(block(m, "spend"), 'aria-label="Copy run id"')).toBe(2);
  });

  it("no character dropped without a control: every '…' on the page is a clamp followed by 'show all'", () => {
    const ellipses = count(m, "…");
    const clamps = count(m, '…</span><button type="button" class="ap_link_btn" aria-expanded="false">show all (');
    expect(ellipses).toBeGreaterThan(0);
    expect(clamps).toBe(ellipses);
  });

  it("not-provided pins show the flow default through the one value component, complete", () => {
    const inputs = pin_list(m, "Inputs");
    const pin = (id: string) => {
      const at = inputs.indexOf(`data-pin-id="${id}"`);
      return inputs.slice(at, inputs.indexOf("</li>", at));
    };
    expect(text(pin("tools"))).toContain(`not provided flow default array · 9 items: ${O_TOOLS} full JSON`);
    expect(pin("tools")).toContain('aria-label="Copy tools flow default"');
    expect(text(pin("system"))).toMatch(/not provided flow default You are AbstractAssistant[^<]*… show all \(518 chars\)/);
    expect(text(pin("max_iterations"))).toContain("not provided flow default 24");
    expect(text(pin("sound_output"))).toContain("flow default object · 3 keys: modality, task, format");
    // Not sent, no default: says so, offers nothing to copy.
    expect(text(pin("provider"))).toContain("not provided");
    expect(pin("provider")).not.toContain("flow default");
    expect(pin("provider")).not.toContain("ap_copy_btn");
  });

  it("ids never as visible text: run, subrun, controller and automation ids only in attributes", () => {
    for (const id of [O_OCC, O_CHILD, O_CTL]) {
      expect(text(m)).not.toContain(id);
      expect(m).toContain(id);
    }
  });
});

describe("Agent profile — partial sources are said, never hidden", () => {
  it("only the occurrence's ledger: 'children's calls live in their own view' with a link to the subrun", () => {
    const m = html(<AgentPage {...o_props({ records: O_LEDGER.filter((x: any) => x.run_id === O_OCC) })} />);
    const g = group(m, "access");
    expect(text(g)).toContain("Did call none in the loaded ledger children's calls live in their own view (1 subrun not loaded here: visual_react_agent_abstractassistant-orchestrator_0_0_9_c53b1579_assistant_agent )");
    expect(g).toContain(`data-run-id="${O_CHILD}"`);
  });

  it("no ledger, no detail: the model reads 'gateway default (not reported on this wire)'; loading notes", () => {
    const m = html(<AgentPage {...o_props({ detail: null, records: undefined, loading: { detail: false, input_data: false, flow: false, records: true } })} />);
    const g = text(group(m, "who"));
    expect(g).toContain("Model · provider gateway default (not reported on this wire) gateway");
    expect(text(group(m, "access"))).toContain("Did call — ledger not loaded here");
    expect(block(m, "profile")).toContain("loading the ledger…");
    expect(html(<AgentPage {...o_props({ errors: { records: "get_ledger failed: 502" } })} />)).toContain("ledger unavailable: get_ledger failed: 502");
  });

  it("a tool called outside the declared list is a finding, named on the row", () => {
    const sent = { ...O_INPUT, input_data: { ...O_INPUT.input_data, tools: ["read_file"] } };
    const g = text(group(html(<AgentPage {...o_props({ input_data: sent })} />), "access"));
    expect(g).toContain("May call read_file run");
    expect(g).toContain("Did call web_search × 5 called outside the declared list used");
  });
});

describe("Value — the one value component", () => {
  it("a long key list collapses by size behind 'show all N keys' with whole keys only; the full JSON sits in a details", () => {
    const keys = Array.from({ length: 60 }, (_, i) => `field_${String(i).padStart(2, "0")}`);
    const m = html(<Value value={Object.fromEntries(keys.map((k) => [k, i_of(k)]))} />);
    const fit = list_fit(keys);
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThan(60);
    expect(m).toContain(`<span class="ap_json_list">${keys.slice(0, fit).join(", ")}</span>`);
    expect(m).toContain('aria-expanded="false">show all 60 keys</button>');
    expect(m).toContain('<details class="ap_json_details"><summary class="mono">full JSON</summary></details>');
    // A short list is shown whole, with no control.
    const short = html(<Value value={{ a: 1, b: 2 }} />);
    expect(short).toContain('<span class="ap_json_list">a, b</span>');
    expect(short).not.toContain("show all");
  });

  it("scalars inline, strings clamped by size with their length, null and absent distinct", () => {
    expect(html(<Value value={42} />)).toBe('<code class="ap_pin_scalar">42</code>');
    expect(html(<Value value={null} />)).toBe('<code class="ap_pin_scalar ap_pin_muted">null</code>');
    expect(html(<Value value={undefined} />)).toBe('<span class="ap_pin_muted">—</span>');
    expect(html(<Value value={"x".repeat(300)} />)).toContain("show all (300 chars)");
    expect(html(<Value value={"short"} />)).toBe('<span class="ap_pin_string"><span class="ap_pin_text">short</span></span>');
  });

  it("copy copies the FULL raw value: strings raw, JSON pretty-printed; a pin copies its value or the flow default", () => {
    expect(copy_text_of("line 1\nline 2")).toBe("line 1\nline 2");
    expect(copy_text_of({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(copy_text_of(false)).toBe("false");
    expect(copy_text_of(undefined)).toBe("");
    const pin = { id: "t", label: "t", type: "tools", typed: true, required: false, description: "", state: "not_provided" as const, value: undefined, flow_default: { value: ["a", "b"] } };
    expect(pin_copy_text(pin)).toBe('[\n  "a",\n  "b"\n]');
    expect(pin_copy_text({ ...pin, flow_default: null })).toBeNull();
    expect(pin_copy_text({ ...pin, state: "value", value: "v" })).toBe("v");
    expect(html(<CopyButton text="x" label="task" />)).toBe('<button type="button" class="ap_copy_btn" title="Copy task" aria-label="Copy task">⧉</button>');
  });

  it("the copy button shows on hover and keyboard focus, always on touch screens (tokens only)", () => {
    const css = readFileSync(join(__dirname, "agent_page.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.ap_copyable:hover \.ap_copy_btn,\s*\.ap_copyable:focus-within \.ap_copy_btn/);
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.ap_copy_btn \{\s*opacity: 1;/);
    expect(css).toMatch(/@media \(max-width: 767\.98px\)[\s\S]*\.ap_prow \{\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
  });
});

function i_of(k: string): number {
  return Number(k.slice(-2));
}
