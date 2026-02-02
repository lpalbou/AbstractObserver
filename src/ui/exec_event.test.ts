import { describe, expect, it } from "vitest";

import { classify_exec_event_status_kind, humanize_shell_command, infer_exec_event_main_text, infer_exec_event_time_label } from "./exec_event";

describe("exec_event helpers", () => {
  it("humanizes common shell -lc wrappers", () => {
    expect(humanize_shell_command("/bin/zsh -lc 'ls docs'")).toBe("ls docs");
    expect(humanize_shell_command("bash -lc \"cat foo.txt\"")).toBe("cat foo.txt");
    expect(humanize_shell_command("ls -la")).toBe("ls -la");
  });

  it("infers main text from command_execution", () => {
    const payload = { item: { type: "command_execution", command: "/bin/zsh -lc \"cat abstractobserver/src/ui/styles.css\"" } };
    expect(infer_exec_event_main_text("item.completed", payload)).toContain("cat abstractobserver/src/ui/styles.css");
  });

  it("infers main text from reasoning title", () => {
    const payload = { item: { type: "reasoning", text: "**Preparing test overview**\n\nMore details…" } };
    expect(infer_exec_event_main_text("item.completed", payload)).toBe("**Preparing test overview**");
  });

  it("classifies command_execution status via exit_code", () => {
    expect(classify_exec_event_status_kind("item.completed", { item: { type: "command_execution", exit_code: 0 } })).toBe("ok");
    expect(classify_exec_event_status_kind("item.completed", { item: { type: "command_execution", exit_code: 2 } })).toBe("error");
  });

  it("extracts a time label when present", () => {
    const label = infer_exec_event_time_label({ at: "2026-02-02T00:00:00Z" });
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });
});

