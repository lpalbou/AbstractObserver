// Operator 2026-10-01: a client's workflow picker lists ONLY the workflows the
// gateway says it can run for the signed-in person
// (GET /bundles?executable_for=<interface>), through the kit WorkflowPicker —
// no "show all", no client-side widening. Observer's Launch / Automate picker is
// a LAUNCHER (C3F 2026-10-01): the kit's any-interface mode — GET /bundles
// (availability-filtered by the gateway), every interface, Shared / Mine, the
// interfaces as the detail line; "Gateway default" is the code agent's.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseExecutableWorkflows, parseWorkflowListing, workflowPickerPath, workflowPickerRows } from "@abstractframework/ui-kit";
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
  it("is the kit WorkflowPicker in its any-interface mode (no native select, no interface filter of its own)", () => {
    const block = /<WorkflowPicker\s[\s\S]*?\/>/.exec(app)?.[0] ?? "";
    expect(block).toContain("interfaceId={null}");
    expect(block).toContain("defaultInterface={CODE_AGENT_INTERFACE}");
    expect(block).toContain("workflows={executable_workflows}");
    expect(app).toMatch(/useExecutableWorkflows\(\{\s*interfaceId: null,\s*defaultInterface: CODE_AGENT_INTERFACE,/);
    expect(workflowPickerPath(null)).toBe("bundles");
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

  it("lists every interface the gateway returns, with the interface as the detail line", () => {
    const listing = {
      items: [
        ...envelope.items,
        { bundle_id: "mail", bundle_version: "1.0.0", owner: { kind: "user", user_id: "u1" }, shipped: false,
          entrypoints: [{ flow_id: "t", name: "Mail triage", interfaces: ["abstractflow.event.v1"], workflow_id: "mail@1.0.0:t" }] },
      ],
      default_agent_workflows: {},
    };
    const data = parseWorkflowListing(listing, null, { defaultInterface: CODE_AGENT_INTERFACE });
    expect(data.entries.map((e) => e.bundleId).sort()).toEqual(["basic-agent", "mail", "mine"]);
    const rows = workflowPickerRows(data);
    expect(rows.find((r) => r.entry?.bundleId === "mail")?.detail).toBe("abstractflow.event.v1 · @1.0.0");
    expect(launch_picker_value({ kind: "bundle", bundle_id: "mail", flow_id: "t" }, data.entries)).toBe("mail@1.0.0:t");
  });

  it("a gateway that ignores executable_for is refused, not listed", () => {
    const leaky = { ...envelope, items: [{ ...envelope.items[0], entrypoints: [{ flow_id: "p", name: "Prompt", interfaces: ["chat"] }] }] };
    expect(() => parseExecutableWorkflows(leaky, CODE_AGENT_INTERFACE)).toThrow(/does not declare/);
  });
});
