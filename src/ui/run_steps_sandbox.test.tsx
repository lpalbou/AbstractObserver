// Round 13 (R13.4): the run view shows, for each command call, ONE line saying the sandbox it ran
// under — "Sandbox: macOS sandbox-exec · 4 workspaces enforced" — or "Sandbox: none — refused",
// from the ledger's own evidence (`output.sandbox`), with the enforced paths. Seeded ledger
// (__fixtures__/sandbox_ledger.json): a real execute_command record of a scratch gateway, the
// runtime's fail-closed refusal, and a read_file that carries no sandbox.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { build_run_steps, tool_detail } from "./run_steps";
import { StepCard } from "./run_steps_view";

const FIX = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "sandbox_ledger.json"), "utf8"));
const RID = "run-sandbox";
const items = FIX.records.map((record: any, i: number) => ({ run_id: RID, cursor: i + 1, record }));
const noop = () => {};
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

function toolSteps() {
  return build_run_steps(items, RID).filter((s) => s.kind === "tool");
}

describe("run view: the command sandbox line", () => {
  it("each tool step keeps the raw ledger row for the evidence", () => {
    const steps = toolSteps();
    expect(steps.length).toBe(3);
    expect(tool_detail(steps[0]).results[0].raw.output.sandbox.kind).toBe("macos-sandbox-exec");
  });

  it("a sandboxed command: one line + the enforced paths in the call's detail", () => {
    const [exec] = toolSteps();
    const m = html(<StepCard step={exec} node_label="tools" open on_toggle={noop} on_copy={noop} />);
    expect(m.split("Sandbox: macOS sandbox-exec · 4 workspaces enforced").length - 1).toBe(1);
    expect(m).toContain('class="pc-tool-sandbox is-sandboxed rs_sandbox"');
    for (const path of ["/srv/gateway/data/workspaces/e04124f4ec82", "/Users/ada/home/work/project", "/Users/ada", "/Users/ada/home"]) {
      expect(m).toContain(`<code>${path}</code>`);
    }
    expect(m).toContain("Read-only");
    expect(m).toContain("Refused");
    expect(m).toContain("12 built-in protected folders refused");
    // Inside the Results section, under the call's name.
    expect(m.indexOf("execute_command · ok")).toBeLessThan(m.indexOf("Sandbox: macOS sandbox-exec"));
    // Collapsed, the card shows no line (detail only).
    expect(html(<StepCard step={exec} node_label="tools" open={false} on_toggle={noop} on_copy={noop} />)).not.toContain("pc-tool-sandbox");
  });

  it("a refused command: 'Sandbox: none — refused', no paths", () => {
    const refused = toolSteps()[1];
    const m = html(<StepCard step={refused} node_label="tools" open on_toggle={noop} on_copy={noop} />);
    expect(m).toContain("Sandbox: none — refused");
    expect(m).toContain('class="pc-tool-sandbox is-refused rs_sandbox"');
    expect(m).not.toContain("pc-tool-sandbox__rows");
  });

  it("a tool without evidence shows no line", () => {
    const plain = toolSteps()[2];
    const m = html(<StepCard step={plain} node_label="tools" open on_toggle={noop} on_copy={noop} />);
    expect(m).toContain("read_file · ok");
    expect(m).not.toContain("pc-tool-sandbox");
  });

  it("the app never spells a sandbox kind (the label is the ledger's)", () => {
    const view = readFileSync(join(__dirname, "run_steps_view.tsx"), "utf8");
    expect(view).not.toContain("sandbox-exec");
    expect(view).not.toContain("bubblewrap");
    expect(view).not.toContain("workspaces enforced");
  });
});
