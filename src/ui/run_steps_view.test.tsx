// Run view cards (operator 2026-10-01 13:05): collapsed by default, one line of
// substance, the full request and answer when expanded, never a `$slim` stub.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_RUN_VIEW_STATE, build_run_steps, type RunViewState } from "./run_steps";
import { RunOutcome, RunStepsView, StepCard } from "./run_steps_view";

const FIX = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "runview_agent_ledger.json"), "utf8"));
const CHILD: string = FIX.child_run_id;
const ledger = (recs: any[]) => recs.map((record, i) => ({ run_id: CHILD, cursor: i + 1, record }));
const noop = () => {};
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

function view(state: Partial<RunViewState> = {}, recs: any[] = FIX.child): string {
  return html(
    <RunStepsView
      items={ledger(recs)}
      run_id={CHILD}
      run_options={[CHILD]}
      run_llm_counts={{}}
      on_select_run={noop}
      state={{ ...DEFAULT_RUN_VIEW_STATE, ...state }}
      on_state={noop}
      node_label={(_r, n) => n}
      on_copy={noop}
    />,
  );
}
const cards = (markup: string) => (markup.match(/<article class="rs_card/g) || []).length;

describe("RunStepsView", () => {
  it("opens grouped by cycle, every card collapsed, housekeeping hidden", () => {
    const m = view();
    expect(cards(m)).toBe(5);
    expect(m).not.toContain("rs_card_body");
    expect((m.match(/aria-expanded="false"/g) || []).length).toBe(5);
    expect(m).toContain(">Cycle 1<");
    expect(m).toContain(">Cycle 3<");
    expect(m).toContain("5 of 7 steps · 3 cycles · 2 housekeeping hidden");
  });

  it("each collapsed card shows kind, node, status, duration and ONE line of substance", () => {
    const m = view();
    expect(m).toContain('<span class="rs_line">900 in · 42 out</span>');
    expect(m).toContain('<span class="rs_detail">fake-model</span>');
    expect(m).toContain('<span class="rs_line">list_files(directory_path=".")</span>');
    expect(m).toMatch(/<span class="rs_kind">LLM call<\/span><span class="rs_node">reason<\/span><span class="rs_status ok">completed<\/span>/);
  });

  it("'All steps' is a real switch labelled by the feature, off by default; on, every step is listed", () => {
    const m = view();
    const sw = /<button type="button" role="switch"[^>]*data-action="show-all-steps"[^>]*>/.exec(m)?.[0] || "";
    expect(sw).toContain('aria-checked="false"');
    expect(m).toContain("All steps");
    expect(cards(view({ all_steps: true }))).toBe(7);
  });

  it("one toolbar row right under the count: Layout, filter, search, then the All steps switch at the end", () => {
    const m = view();
    const count = m.indexOf('class="rs_count"');
    const bar = m.indexOf('class="rs_toolbar"');
    expect(count).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(count);
    const toolbar = m.slice(bar, m.indexOf("</div>", m.indexOf('data-action="show-all-steps"')));
    const order = ['aria-label="Layout"', 'aria-label="Show"', 'class="rs_search"', 'data-action="show-all-steps"'].map((k) => toolbar.indexOf(k));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Nothing (no card) sits between the count and the toolbar.
    expect(m.slice(count, bar)).not.toContain("rs_card");
  });

  it("filters: LLM calls only, Tools only, Failed only (segmented, the active one checked)", () => {
    expect(cards(view({ only: "llm" }))).toBe(3);
    expect(cards(view({ only: "tools" }))).toBe(2);
    const failed = view({ only: "failed" });
    expect(cards(failed)).toBe(1);
    expect(failed).toContain('data-filter="failed" aria-checked="true"');
    // The All steps switch is not rendered where it would do nothing.
    expect(failed).not.toContain('data-action="show-all-steps"');
  });

  it("search filters cards by the expanded bodies too (the resolved system prompt)", () => {
    expect(cards(view({ q: "loop contract" }))).toBe(3);
    expect(view({ q: "zzz-nothing" })).toContain("No step matches.");
  });
});

describe("StepCard expanded", () => {
  const steps = build_run_steps(ledger(FIX.child), CHILD);
  const llm = steps.filter((s) => s.kind === "llm_call")[1];

  it("shows the full request and answer in sections, with the real prompt (no $slim stub)", () => {
    const m = html(<StepCard step={llm} node_label="reason" open on_toggle={noop} on_copy={noop} />);
    for (const title of ["System", "Messages", "Tools offered", "Response", "Reasoning", "Raw JSON"]) {
      expect(m).toContain(`<span class="rs_section_title">${title}</span>`);
    }
    expect(m).toContain("Loop contract");
    expect(m).toContain("What is in my workspace?");
    expect(m).not.toContain("$slim");
    expect((m.match(/>Copy</g) || []).length).toBeGreaterThanOrEqual(6);
    expect(m).not.toContain("Prompt body not kept");
  });

  it("says once, with the reason, when the prompt body is not in the loaded ledger", () => {
    const only_terminal = build_run_steps(ledger(FIX.child.filter((r: any) => r.status !== "started")), CHILD);
    const m = html(<StepCard step={only_terminal.filter((s) => s.kind === "llm_call")[1]} node_label="reason" open on_toggle={noop} on_copy={noop} />);
    expect(m).toContain("Prompt body not kept: System: its started record is not in the loaded ledger.");
    expect(m).toContain("Prompt body not kept: Messages: its started record is not in the loaded ledger.");
  });

  it("a failed tool call reads as failed, with its error", () => {
    const tool = steps.filter((s) => s.kind === "tool")[1];
    const m = html(<StepCard step={tool} node_label="act" open on_toggle={noop} on_copy={noop} />);
    expect(m).toContain('class="rs_card rs_failed"');
    expect(m).toContain('<span class="rs_status danger">failed</span>');
    expect(m).toContain("read_file · failed");
    expect(m).toContain("notes.md' does not exist");
  });
});

describe("RunOutcome (what remains of the Story)", () => {
  it("one facts line, the outcome paragraph, and the actions; the error wins over the answer", () => {
    const base = { status: "completed", duration: "3s", facts: "3 LLM calls", error: "", answer: "All done.", waiting_for_user: false, workspace_root: "", on_reveal_workspace: noop, on_open_artifacts: noop };
    const m = html(<RunOutcome {...base} />);
    expect(m).toContain("3s · 3 LLM calls");
    expect(m).toContain("All done.");
    expect(m).toContain(">Artifacts<");
    expect(m).not.toContain(">Folder<");
    expect(m).not.toContain(">Answer<");
    const f = html(<RunOutcome {...base} error="Provider unreachable" waiting_for_user on_answer_wait={noop} workspace_root="/w" />);
    expect(f).toContain("Provider unreachable");
    expect(f).not.toContain("All done.");
    expect(f).toContain(">Answer<");
    expect(f).toContain(">Folder<");
  });
});

describe("section fold affordance", () => {
  it("every section header carries a ▸ marker that turns ▾ when open (native marker hidden)", () => {
    const css = readFileSync(join(__dirname, "run_steps.css"), "utf8");
    expect(css).toMatch(/\.rs_section > summary::before\s*\{[^}]*content:\s*"▸"/);
    expect(css).toMatch(/\.rs_section\[open\] > summary::before\s*\{[^}]*content:\s*"▾"/);
    expect(css).toMatch(/\.rs_section > summary\s*\{[^}]*list-style:\s*none/);
  });
});
