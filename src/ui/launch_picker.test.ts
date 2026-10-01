// Operator 2026-10-01: a client's workflow picker lists ONLY the workflows the
// gateway says it can run for the signed-in person
// (GET /bundles?executable_for=<interface>), through the kit WorkflowPicker —
// no "show all", no client-side widening. Observer's Launch / Automate picker
// launches the code agent (abstractcode.agent.v1, its default target).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseExecutableWorkflows } from "@abstractframework/ui-kit";
import { CODE_AGENT_INTERFACE, choice_from_picker, launch_picker_value } from "./automations";

const app = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
const client = readFileSync(resolve(__dirname, "../lib/gateway_client.ts"), "utf8");

const envelope = {
  executable_for: CODE_AGENT_INTERFACE,
  items: [
    { bundle_id: "basic-agent", bundle_version: "0.0.5", owner: { kind: "gateway", user_id: null }, shipped: true,
      entrypoints: [{ flow_id: "main", name: "Basic agent", interfaces: [CODE_AGENT_INTERFACE], workflow_id: "basic-agent@0.0.5:main" }] },
    { bundle_id: "mine", bundle_version: "0.1.0", owner: { kind: "user", user_id: "u1" }, shipped: false,
      entrypoints: [{ flow_id: "m", name: "Mine", interfaces: [CODE_AGENT_INTERFACE], workflow_id: "mine@0.1.0:m" }] },
  ],
  default_agent_workflows: {},
};

describe("Launch workflow picker", () => {
  it("is the kit WorkflowPicker over executable_for=abstractcode.agent.v1 (no native select, no interface filter of its own)", () => {
    const block = /<WorkflowPicker\s[\s\S]*?\/>/.exec(app)?.[0] ?? "";
    expect(block).toContain("interfaceId={CODE_AGENT_INTERFACE}");
    expect(block).toContain("workflows={executable_workflows}");
    expect(app).toMatch(/useExecutableWorkflows\(\{\s*interfaceId: CODE_AGENT_INTERFACE,/);
    expect(app).not.toContain('className="launch_workflow_select"');
    expect(app).not.toContain("launchable_workflow_options");
    expect(app).not.toMatch(/show all workflows/i);
    expect(client).toContain("async get_gateway_json(path: string");
  });

  it("maps choices to picker values and back, never inventing an option", () => {
    const { entries } = parseExecutableWorkflows(envelope, CODE_AGENT_INTERFACE);
    expect(launch_picker_value({ kind: "default", interface: CODE_AGENT_INTERFACE }, entries)).toBe("@default");
    expect(launch_picker_value({ kind: "bundle", bundle_id: "mine", flow_id: "m" }, entries)).toBe("mine@0.1.0:m");
    // Not in the gateway's answer: no value (the picker shows it as the current label only).
    expect(launch_picker_value({ kind: "bundle", bundle_id: "prompt-only", flow_id: "x" }, entries)).toBe("");
    expect(launch_picker_value({ kind: "default", interface: "abstractassistant.agent.v1" }, entries)).toBe("");
    expect(choice_from_picker("@default", null)).toEqual({ kind: "default", interface: CODE_AGENT_INTERFACE });
    expect(choice_from_picker("mine@0.1.0:m", entries[1])).toEqual({ kind: "bundle", bundle_id: "mine", flow_id: "m" });
  });

  it("a gateway that ignores executable_for is refused, not listed", () => {
    const leaky = { ...envelope, items: [{ ...envelope.items[0], entrypoints: [{ flow_id: "p", name: "Prompt", interfaces: ["chat"] }] }] };
    expect(() => parseExecutableWorkflows(leaky, CODE_AGENT_INTERFACE)).toThrow(/does not declare/);
  });
});
