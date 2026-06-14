import { tryParseJson } from "@abstractframework/panel-chat";

export type ArtifactPreviewKind = "text" | "image" | "audio" | "video" | "binary";
export type ArtifactTextRenderKind = "json" | "markdown" | "html" | "code" | "text";
export type ArtifactDisplayKind = ArtifactTextRenderKind | "image" | "voice" | "music" | "sound" | "audio" | "video" | "document" | "other";

export type MarkdownReport = {
  metadata: Array<{ label: string; value: string }>;
  body: string;
};

export type ArtifactRenderLike = {
  content_type?: string | null;
  filename?: string | null;
  source_path?: string | null;
  modality?: string | null;
  semantic_kind?: string | null;
  render_kind?: string | null;
  task?: string | null;
  tags?: Record<string, string | null | undefined> | null;
};

function lc(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function extension_name(a: ArtifactRenderLike | null | undefined): string {
  return `${a?.filename || ""} ${a?.source_path || ""}`.trim().toLowerCase();
}

function has_ext(name: string, exts: string[]): boolean {
  return exts.some((ext) => name.endsWith(ext));
}

function artifact_metadata_text(a: ArtifactRenderLike | null | undefined): string {
  const tags = a?.tags || {};
  return [
    a?.content_type,
    a?.filename,
    a?.source_path,
    a?.modality,
    tags.kind,
    tags.type,
    tags.source,
    tags.format,
    tags.content_format,
    tags.name,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function artifact_media_signal_text(a: ArtifactRenderLike | null | undefined): string {
  const tags = a?.tags || {};
  return [
    a?.content_type,
    a?.filename,
    a?.source_path,
    a?.modality,
    a?.semantic_kind,
    a?.render_kind,
    a?.task,
    tags.semantic_kind,
    tags.render_kind,
    tags.kind,
    tags.type,
    tags.task,
    tags.provider_task,
    tags.source,
    tags.format,
    tags.content_format,
    tags.name,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function looks_like_html_artifact(text: string): boolean {
  const trimmed = String(text || "").trimStart().slice(0, 4096).toLowerCase();
  if (!trimmed) return false;
  if (/^<!doctype\s+html\b/.test(trimmed)) return true;
  if (/^<html[\s>]/.test(trimmed)) return true;
  if (/<head[\s>][\s\S]*<\/head>/.test(trimmed)) return true;
  if (/<body[\s>][\s\S]*<\/body>/.test(trimmed)) return true;
  if (/<(?:article|main|section|div|p|h[1-6]|meta|title|script|style)\b[\s\S]*>/.test(trimmed) && /<\/(?:article|main|section|div|p|h[1-6]|title|script|style)>/.test(trimmed)) return true;
  return false;
}

function looks_like_code_artifact(a: ArtifactRenderLike | null | undefined, text: string): boolean {
  const ct = lc(a?.content_type);
  const name = extension_name(a);
  const semantic = [
    a?.semantic_kind,
    a?.render_kind,
    a?.task,
    a?.tags?.semantic_kind,
    a?.tags?.render_kind,
    a?.tags?.task,
    a?.tags?.kind,
    a?.tags?.type,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (/(^|[^a-z0-9])(code|source_code|script|program|executable)([^a-z0-9]|$)/i.test(semantic)) return true;
  if (
    ct.includes("javascript") ||
    ct.includes("typescript") ||
    ct.includes("x-python") ||
    ct.includes("x-shellscript") ||
    ct.includes("x-rust") ||
    ct.includes("x-go") ||
    ct.includes("x-java") ||
    ct.includes("x-csrc") ||
    ct.includes("x-c++src")
  ) {
    return true;
  }
  if (
    has_ext(name, [
      ".py",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".mjs",
      ".cjs",
      ".sh",
      ".bash",
      ".zsh",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cc",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".php",
      ".rb",
      ".swift",
      ".kt",
      ".sql",
    ])
  ) {
    return true;
  }
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return looks_like_code_text(lines);
}

export function parse_markdown_report(text: string): MarkdownReport | null {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const marker_idx = lines.findIndex((line) => /^Markdown Content:\s*$/i.test(line.trim()));
  if (marker_idx === -1) return null;

  const metadata: Array<{ label: string; value: string }> = [];
  for (const line of lines.slice(0, marker_idx)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9 /_-]{1,40}):\s*(.+?)\s*$/);
    if (!m) continue;
    metadata.push({ label: m[1].trim(), value: m[2].trim() });
  }

  const body = lines.slice(marker_idx + 1).join("\n").trim();
  if (!metadata.length && !body) return null;
  return { metadata, body };
}

function looks_like_csv_or_tsv(lines: string[]): boolean {
  const sample = lines.map((line) => line.trim()).filter(Boolean).slice(0, 8);
  if (sample.length < 2) return false;
  for (const sep of [",", "\t", ";"]) {
    const counts = sample.map((line) => line.split(sep).length);
    if (counts[0] >= 3 && counts.every((count) => Math.abs(count - counts[0]) <= 1)) return true;
  }
  return false;
}

function looks_like_log_or_code(lines: string[]): boolean {
  const sample = lines.map((line) => line.trimEnd()).filter(Boolean).slice(0, 20);
  if (!sample.length) return false;
  const logish = sample.filter((line) => /^(\[[^\]]+\]|\d{4}-\d{2}-\d{2}[t\s]|\w+:\s|traceback\b|error\b|warn\b|info\b)/i.test(line.trim())).length;
  if (sample.length >= 4 && logish / sample.length >= 0.55) return true;
  return looks_like_code_text(lines);
}

function looks_like_code_text(lines: string[]): boolean {
  const sample = lines.map((line) => line.trimEnd()).filter(Boolean).slice(0, 20);
  if (!sample.length) return false;
  const codeish = sample.filter((line) => /[{};]\s*$/.test(line) || /^\s*(import|export|const|let|var|function|class|def|if|for|while|return)\b/.test(line)).length;
  return sample.length >= 4 && codeish / sample.length >= 0.55;
}

function looks_like_extracted_document_text(text: string): boolean {
  const s = String(text || "");
  if (!s.trim()) return false;

  const latexish = s.match(/\\[A-Za-z]{2,}\b/g) || [];
  if (latexish.length >= 1 && /\\(?:setcctype|sectctype|documentclass|begin|end|maketitle|geq|leq|cite|ref|label)\b/.test(s)) return true;
  if (latexish.length >= 4) return true;

  const lines = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const sample = lines.map((line) => line.trim()).filter(Boolean).slice(0, 80);
  if (sample.length < 12) return false;
  const short_lines = sample.filter((line) => line.length <= 28).length;
  const isolated_punctuation = sample.filter((line) => /^[,.;:()†]+$/.test(line)).length;
  const paper_markers = sample.filter((line) => /^(abstract\.?|introduction|references|appendix|figure\s+\d+|table\s+\d+)\b/i.test(line)).length;
  return paper_markers >= 2 && (short_lines / sample.length >= 0.45 || isolated_punctuation >= 2);
}

function looks_like_markdown_artifact(a: ArtifactRenderLike | null | undefined, text: string): boolean {
  const s = String(text || "");
  const metadata = artifact_metadata_text(a);
  if (/(^|[^a-z0-9])(markdown|mdown)([^a-z0-9]|$)/i.test(metadata)) return true;
  if (!s.trim()) return false;
  if (/(^|\n)\s*Markdown Content:\s*(\n|$)/i.test(s)) return true;
  if (s.includes("```")) return true;
  if (/(^|\n)\s*#{1,6}\s+\S/.test(s)) return true;
  if (/(^|\n)[ \t]*[-*][ \t]+\S/.test(s)) return true;
  if (/(^|\n)[ \t]*\d+[\.)][ \t]+\S/.test(s)) return true;
  if (/\*\*[^*\n][\s\S]*?\*\*/.test(s)) return true;
  if (/\[[^\]\n]+\]\([^)]+\)/.test(s)) return true;
  if (/(^|\n)\s*\|.+\|\s*(\n|$)/.test(s) && /(^|\n)\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*(\n|$)/.test(s)) return true;

  const lines = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const non_empty = lines.map((line) => line.trim()).filter(Boolean);
  if (non_empty.length < 2) return false;
  if (looks_like_extracted_document_text(s)) return false;
  if (looks_like_csv_or_tsv(lines) || looks_like_log_or_code(lines)) return false;
  const words = s.match(/[A-Za-z][A-Za-z'-]+/g)?.length || 0;
  const blank_lines = lines.filter((line) => !line.trim()).length;
  const prose_lines = non_empty.filter((line) => /[A-Za-z]{3,}/.test(line) && line.length >= 12).length;
  return words >= 24 && prose_lines >= 2 && (blank_lines >= 1 || non_empty[0].length <= 140);
}

export function artifact_preview_kind(a: ArtifactRenderLike | null | undefined): ArtifactPreviewKind {
  const modality = lc(a?.modality);
  const ct = lc(a?.content_type);
  const name = extension_name(a);
  const media_signal = artifact_media_signal_text(a);
  if (modality === "image" || ct.startsWith("image/") || has_ext(name, [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tif", ".tiff", ".heic"])) return "image";
  if (
    modality === "audio" ||
    modality === "voice" ||
    modality === "music" ||
    modality === "sound" ||
    ct.startsWith("audio/") ||
    /(tts|stt|voice|music|sound|speech|audio)/i.test(media_signal) ||
    has_ext(name, [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".mid", ".midi"])
  ) {
    return "audio";
  }
  if (modality === "video" || ct.startsWith("video/") || has_ext(name, [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"])) return "video";
  if (
    !ct ||
    modality === "text" ||
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("yaml") ||
    ct.includes("toml") ||
    ct.includes("xml") ||
    ct.includes("html") ||
    ct.includes("markdown") ||
    ct.includes("csv") ||
    looks_like_code_artifact(a, "")
  ) {
    return "text";
  }
  return "binary";
}

export function artifact_text_render_kind(a: ArtifactRenderLike | null | undefined, text: string): ArtifactTextRenderKind {
  const content_type = lc(a?.content_type);
  const name = extension_name(a);
  const trimmed = String(text || "").trim();

  if (content_type.includes("html") || name.endsWith(".html") || name.endsWith(".htm") || looks_like_html_artifact(text)) return "html";
  if (looks_like_code_artifact(a, text)) return "code";
  if (content_type.includes("markdown") || name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (content_type.includes("json") || name.endsWith(".json") || name.endsWith(".jsonl")) return "json";
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && tryParseJson(trimmed) !== null) return "json";
  if (looks_like_markdown_artifact(a, text)) return "markdown";
  return "text";
}

export function artifact_display_kind(a: ArtifactRenderLike | null | undefined, text = ""): ArtifactDisplayKind {
  const preview_kind = artifact_preview_kind(a);
  if (preview_kind === "image" || preview_kind === "video") return preview_kind;
  if (preview_kind === "audio") {
    const tags = a?.tags || {};
    const semantic = [
      a?.semantic_kind,
      a?.modality,
      a?.task,
      tags.semantic_kind,
      tags.modality,
      tags.kind,
      tags.task,
      tags.source,
      a?.filename,
      a?.source_path,
    ]
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ");
    if (/(^|[^a-z0-9])(voice|tts|speech)([^a-z0-9]|$)/i.test(semantic)) return "voice";
    if (/(^|[^a-z0-9])(music|song|instrumental|t2m)([^a-z0-9]|$)/i.test(semantic)) return "music";
    if (/(^|[^a-z0-9])(sound|sfx|recording)([^a-z0-9]|$)/i.test(semantic)) return "sound";
    return "audio";
  }
  if (preview_kind === "binary") {
    const modality = lc(a?.modality);
    const ct = lc(a?.content_type);
    const name = extension_name(a);
    if (modality === "document" || ct.includes("pdf") || has_ext(name, [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"])) return "document";
    return "other";
  }
  return artifact_text_render_kind(a, text);
}

export function artifact_display_type_label(a: ArtifactRenderLike | null | undefined, text = ""): string {
  const kind = artifact_display_kind(a, text);
  if (kind === "json") return "JSON";
  if (kind === "html") return "HTML";
  if (kind === "code") return "Code";
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

export function format_html_source(text: string): string {
  const input = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!input) return "";
  const void_tags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tokens = input.match(/<!--[\s\S]*?-->|<!doctype\b[^>]*>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z][^>]*>|[^<]+/gi) || [input];
  const lines: string[] = [];
  let indent = 0;
  let preserve: "script" | "style" | "" = "";
  const pad = (n: number) => "  ".repeat(Math.max(0, n));

  const format_tag = (token: string, level: number): string[] => {
    const m = token.match(/^(<\/?|<!)([^\s/>]+)([\s\S]*?)(\/?>)$/);
    if (!m || token.length <= 120 || token.startsWith("</") || token.startsWith("<!")) return [`${pad(level)}${token.trim()}`];
    const attrs = (m[3] || "").trim();
    if (!attrs) return [`${pad(level)}${token.trim()}`];
    const parts = attrs.match(/[^\s="'<>`]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+))?/g) || [attrs];
    return [`${pad(level)}${m[1]}${m[2]}`, ...parts.map((part) => `${pad(level + 1)}${part.trim()}`), `${pad(level)}${m[4]}`];
  };

  for (const raw of tokens) {
    const token = String(raw || "");
    if (!token.trim()) continue;
    const lower = token.trim().toLowerCase();
    if (lower.startsWith("</")) {
      const close_name = lower.match(/^<\/\s*([a-z0-9:-]+)/)?.[1] || "";
      if (preserve && close_name === preserve) preserve = "";
      indent = Math.max(0, indent - 1);
      lines.push(`${pad(indent)}${token.trim()}`);
      continue;
    }

    if (token.trimStart().startsWith("<")) {
      lines.push(...format_tag(token, indent));
      const open_name = lower.match(/^<\s*([a-z0-9:-]+)/)?.[1] || "";
      const self_closing = /\/>\s*$/.test(token) || lower.startsWith("<!") || void_tags.has(open_name);
      if (!self_closing) {
        indent += 1;
        if (open_name === "script" || open_name === "style") preserve = open_name;
      }
      continue;
    }

    if (preserve) {
      const body = token.trim();
      if (body) lines.push(...body.split("\n").map((line) => `${pad(indent)}${line.trimEnd()}`));
      continue;
    }

    const text_body = token.replace(/\s+/g, " ").trim();
    if (text_body) lines.push(`${pad(indent)}${text_body}`);
  }

  return lines.join("\n");
}
