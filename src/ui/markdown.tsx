import React from "react";

type InlineNode = React.ReactNode;

function render_inline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  const s = String(text ?? "");
  let i = 0;
  let buf = "";

  const flush = () => {
    if (!buf) return;
    out.push(buf);
    buf = "";
  };

  while (i < s.length) {
    const ch = s[i];

    if (ch === "`") {
      const j = s.indexOf("`", i + 1);
      if (j !== -1) {
        flush();
        out.push(<code key={`code:${i}`}>{s.slice(i + 1, j)}</code>);
        i = j + 1;
        continue;
      }
    }

    if (ch === "*" && s[i + 1] === "*") {
      const j = s.indexOf("**", i + 2);
      if (j !== -1) {
        flush();
        out.push(<strong key={`bold:${i}`}>{s.slice(i + 2, j)}</strong>);
        i = j + 2;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

function normalize_lines(text: string): string[] {
  const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return s.split("\n");
}

export function Markdown({ text, className }: { text: string; className?: string }): React.ReactElement {
  const lines = normalize_lines(text);
  const blocks: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = String(raw ?? "");

    // Skip extra blank lines.
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const fence = line.trim();
      const lang = fence.replace(/```/g, "").trim();
      const code_lines: string[] = [];
      i += 1;
      while (i < lines.length && !String(lines[i] ?? "").trim().startsWith("```")) {
        code_lines.push(String(lines[i] ?? ""));
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing fence
      const code = code_lines.join("\n");
      blocks.push(
        <pre key={`pre:${i}`} className="md_pre">
          <code className={lang ? `language-${lang}` : undefined}>{code}</code>
        </pre>
      );
      continue;
    }

    // Headings (#, ##, ###)
    const heading_m = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading_m) {
      const level = heading_m[1].length;
      const content = heading_m[2] || "";
      const nodes = render_inline(content);
      if (level === 1) blocks.push(<h1 key={`h1:${i}`}>{nodes}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h2:${i}`}>{nodes}</h2>);
      else blocks.push(<h3 key={`h3:${i}`}>{nodes}</h3>);
      i += 1;
      continue;
    }

    // Bullet list
    const is_bullet = (s: string) => {
      const t = s.trimStart();
      return t.startsWith("- ") || t.startsWith("* ");
    };
    if (is_bullet(line)) {
      const items: string[] = [];
      while (i < lines.length && is_bullet(String(lines[i] ?? ""))) {
        const t = String(lines[i] ?? "").trimStart();
        items.push(t.slice(2));
        i += 1;
      }
      blocks.push(
        <ul key={`ul:${i}`} className="md_ul">
          {items.map((it, idx) => (
            <li key={`li:${i}:${idx}`}>{render_inline(it)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Paragraph (collect until blank line)
    const para_lines: string[] = [];
    while (i < lines.length && String(lines[i] ?? "").trim()) {
      para_lines.push(String(lines[i] ?? ""));
      i += 1;
    }
    blocks.push(
      <p key={`p:${i}`} className="md_p">
        {para_lines.map((pl, idx) => (
          <React.Fragment key={`pl:${i}:${idx}`}>
            {render_inline(pl)}
            {idx < para_lines.length - 1 ? <br /> : null}
          </React.Fragment>
        ))}
      </p>
    );
  }

  const cls = ["md", className].filter(Boolean).join(" ");
  return <div className={cls}>{blocks}</div>;
}
