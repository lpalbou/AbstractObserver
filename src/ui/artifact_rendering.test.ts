import { describe, expect, it } from "vitest";

import { artifact_display_type_label, artifact_preview_kind, artifact_text_render_kind, format_html_source, parse_markdown_report } from "./artifact_rendering";

describe("artifact render classification", () => {
  it("renders markdown artifacts even when stored as text/plain", () => {
    const artifact = {
      content_type: "text/plain; charset=utf-8",
      tags: { format: "markdown" },
    };
    const text = [
      "State of the Art of Agentic AI Transformation | Bain & Company",
      "",
      "Tech-forward enterprises have cracked the code on ROI for AI.",
      "Falling behind is riskier than ever as the next wave of agentic AI raises the stakes.",
      "",
      "Technology Report",
      "State of the Art of Agentic AI Transformation",
      "At a Glance",
      "AI leaders have moved from pilots to profits, delivering 10% to 25% EBITDA gains by scaling AI across core workflows.",
    ].join("\n");

    expect(artifact_text_render_kind(artifact, text)).toBe("markdown");
    expect(artifact_display_type_label(artifact)).toBe("Markdown");
  });

  it("keeps normalized arXiv paper text out of markdown rendering", () => {
    const artifact = {
      content_type: "text/plain",
      tags: {
        kind: "evidence",
        tool: "fetch_url",
        url: "https://arxiv.org/html/2602.17753v1",
        part: "normalized",
        workflow_id: "visual_react_agent_Iterative-Deep-Research-with-Markdown-Report",
      },
    };
    const text = [
      "The 2025 AI Agent Index Documenting Technical and Safety Features of Deployed Agentic AI Systems",
      "",
      "\\setcctype",
      "[4.0]by",
      "The 2025 AI Agent Index",
      "Documenting Technical and Safety Features of Deployed Agentic AI Systems",
      "Leon Staufer",
      "University of Cambridge",
      "Cambridge",
      "United Kingdom",
      ",",
      "Kevin Feng",
      "University of Washington",
      "Seattle",
      "Washington",
      "USA",
      "(2026)",
      "Abstract.",
      "Agentic AI systems are increasingly capable of performing professional and personal tasks with limited human involvement.",
      "1.",
      "Introduction",
      "Figure 1",
      ".",
      "Interest in AI agents is growing.",
    ].join("\n");

    expect(artifact_display_type_label(artifact)).toBe("Text");
    expect(artifact_text_render_kind(artifact, text)).toBe("text");
    expect(artifact_display_type_label(artifact, text)).toBe("Text");
  });

  it("sniffs human report text as markdown when metadata is generic text/plain", () => {
    const text = [
      "Title: The Emerging Agentic Enterprise: How Leaders Must Navigate a New Age of AI",
      "",
      "URL Source: https://example.com/report.pdf",
      "",
      "Published Time: Fri, 14 Nov 2025 00:18:52 GMT",
      "",
      "Markdown Content:",
      "",
      "## November 2025",
      "",
      "# The Emerging Agentic Enterprise: How Leaders Must Navigate a New Age of AI",
    ].join("\n");

    expect(artifact_text_render_kind({ content_type: "text/plain; charset=utf-8" }, text)).toBe("markdown");
    const report = parse_markdown_report(text);
    expect(report?.metadata.find((m) => m.label === "Title")?.value).toContain("Emerging Agentic Enterprise");
    expect(report?.body).toContain("## November 2025");
  });

  it("renders HTML source for HTML artifacts and sniffed HTML text", () => {
    const html = "<!DOCTYPE html>\n<html lang=\"en\"><head><title>Report</title></head><body><main>Body</main></body></html>";

    expect(artifact_preview_kind({ content_type: "text/html; charset=utf-8" })).toBe("text");
    expect(artifact_text_render_kind({ content_type: "text/html; charset=utf-8", tags: { workflow_id: "with-Markdown" } }, html)).toBe("html");
    expect(artifact_text_render_kind({ content_type: "text/plain" }, html)).toBe("html");
    expect(artifact_display_type_label({ content_type: "text/html; charset=utf-8" })).toBe("HTML");
  });

  it("classifies voice and music artifacts as audio from modality, tags, or filename", () => {
    expect(artifact_preview_kind({ modality: "voice", content_type: "application/octet-stream" })).toBe("audio");
    expect(artifact_preview_kind({ modality: "music", content_type: "application/octet-stream" })).toBe("audio");
    expect(artifact_preview_kind({ modality: "sound", content_type: "application/octet-stream" })).toBe("audio");
    expect(artifact_preview_kind({ content_type: "application/octet-stream", filename: "tts.wav" })).toBe("audio");
    expect(artifact_preview_kind({ content_type: "application/octet-stream", tags: { kind: "voice_generation" } })).toBe("audio");
    expect(artifact_preview_kind({ content_type: "application/octet-stream", tags: { task: "sound_generation" } })).toBe("audio");
    expect(artifact_display_type_label({ modality: "music", content_type: "application/octet-stream" })).toBe("Music");
    expect(artifact_display_type_label({ modality: "voice", content_type: "application/octet-stream" })).toBe("Voice");
    expect(artifact_display_type_label({ modality: "sound", content_type: "application/octet-stream" })).toBe("Sound");
  });

  it("does not classify text artifacts as audio only because the workflow mentions music", () => {
    expect(
      artifact_preview_kind({
        content_type: "text/plain; charset=utf-8",
        tags: { workflow_id: "visual_react_agent_Music-Research-with-Markdown-Report" },
      })
    ).toBe("text");
    expect(
      artifact_text_render_kind(
        {
          content_type: "text/plain; charset=utf-8",
          tags: { workflow_id: "visual_react_agent_Music-Research-with-Markdown-Report" },
        },
        "Title: Music report\n\nMarkdown Content:\n\n# Findings"
      )
    ).toBe("markdown");
  });

  it("formats minified HTML into indented source", () => {
    const formatted = format_html_source('<!DOCTYPE html><html lang="en"><head><title>x</title></head><body><main><p>Hello</p></main></body></html>');

    expect(formatted).toContain("<!DOCTYPE html>");
    expect(formatted).toContain('\n<html lang="en">');
    expect(formatted).toContain("\n  <head>");
    expect(formatted).toContain("\n    <title>");
    expect(formatted).toContain("\n  <body>");
    expect(formatted).toContain("\n      <p>");
  });

  it("keeps JSON and logs out of markdown rendering while recognizing source code", () => {
    expect(artifact_text_render_kind({ content_type: "text/plain" }, "{\"ok\": true, \"items\": [1, 2]}")).toBe("json");
    expect(
      artifact_text_render_kind(
        { content_type: "text/plain" },
        [
          "2026-06-06T12:00:00 INFO gateway started",
          "2026-06-06T12:00:01 WARN provider retry",
          "2026-06-06T12:00:02 ERROR failed request",
          "2026-06-06T12:00:03 INFO gateway stopped",
        ].join("\n")
      )
    ).toBe("text");
    expect(
      artifact_text_render_kind(
        { content_type: "text/plain", filename: "worker-output.txt" },
        [
          "import { x } from './x';",
          "const value = { ok: true };",
          "function run() {",
          "  return value;",
          "}",
        ].join("\n")
      )
    ).toBe("code");
  });

  it("classifies code artifacts as code while previewing them as text", () => {
    const artifact = { content_type: "text/x-python", filename: "worker.py", tags: { kind: "source_code" } };
    const text = ["def run():", "  return {'ok': True}"].join("\n");

    expect(artifact_preview_kind(artifact)).toBe("text");
    expect(artifact_text_render_kind(artifact, text)).toBe("code");
    expect(artifact_display_type_label(artifact, text)).toBe("Code");
  });
});
