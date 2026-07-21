import { describe, expect, it } from "vitest";

import { tool_risk_labels, wait_blocker_title, wait_expected_action } from "./run_labels";

/** Slice-3 adversary P1: these folds moved verbatim but carried no pins —
 * a regex edit could relabel `rm -rf` as "Tool call" and no test would
 * notice. Security-adjacent words get pinned. */
describe("run_labels.ts — risk labels + wait wording (ui-rethink P1 slice 3)", () => {
  it("tool_risk_labels classifies command risk honestly", () => {
    const call = (name: string, command?: string) => ({ name, arguments: command ? { command } : {} }) as any;
    expect(tool_risk_labels(call("execute_command", "rm -rf /tmp/x"))).toContain("Destructive risk");
    expect(tool_risk_labels(call("execute_command", "curl http://evil"))).toContain("Network");
    expect(tool_risk_labels(call("execute_command", "cat notes.txt"))).toContain("Read path");
    // A read piped to a file is a WRITE, not a read.
    const piped = tool_risk_labels(call("execute_command", "cat a > b"));
    expect(piped).toContain("Filesystem write");
    expect(piped).not.toContain("Read path");
    expect(tool_risk_labels(call("write_file"))).toEqual(["Tool call"]);
    // Shell label rides any command-bearing call.
    expect(tool_risk_labels(call("execute_command", "ls"))).toContain("Shell");
  });

  it("wait_blocker_title names the blocker per reason", () => {
    expect(wait_blocker_title({ reason: "user" } as any, [])).toBe("Waiting for your answer");
    expect(wait_blocker_title({ reason: "subworkflow" } as any, [])).toBe("Waiting for a subworkflow");
    expect(wait_blocker_title({ reason: "until" } as any, [])).toBe("Scheduled wait");
    expect(wait_blocker_title({ reason: "custom_thing" } as any, [])).toBe("Waiting: custom_thing");
    expect(wait_blocker_title(null, [])).toBe("Waiting for input");
    // Tool calls take precedence over reason and name the tools (3 shown + count).
    const tools = [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] as any[];
    expect(wait_blocker_title({ reason: "user" } as any, tools)).toBe("Approval required: a, b, c +1");
  });

  it("wait_expected_action guides per wait shape", () => {
    expect(wait_expected_action(null, [{ name: "x" }] as any)).toMatch(/approve/i);
    expect(wait_expected_action({ choices: ["yes", "no"] } as any, [])).toMatch(/allowed responses/i);
    expect(wait_expected_action({ allow_free_text: false } as any, [])).toMatch(/does not allow free text/i);
    expect(wait_expected_action({ prompt: "Pick a name" } as any, [])).toMatch(/answer the workflow question/i);
    expect(wait_expected_action({} as any, [])).toMatch(/no explicit question/i);
  });
});
