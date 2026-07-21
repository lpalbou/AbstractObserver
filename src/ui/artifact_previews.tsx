/**
 * Artifact preview components (ui-rethink P1 slice 3c, 2026-07-21).
 *
 * Moved VERBATIM from app.tsx: the inline render stack for artifact
 * previews — type glyph, HTML tree/source views, markdown/structured
 * text previews, and the embedded-preview switch. Shared by the observe
 * and runtime surfaces.
 */
import React, { useEffect, useMemo, useState } from "react";

import { JsonViewer as SharedJsonViewer, Markdown, tryParseJson } from "@abstractframework/panel-chat";
import {
  artifact_display_kind,
  artifact_preview_kind,
  artifact_text_render_kind,
  format_html_source,
  parse_markdown_report,
  type ArtifactPreviewKind,
  type ArtifactTextRenderKind,
} from "./artifact_rendering";
import { artifact_label, type RuntimeArtifact } from "./artifacts";

export type RuntimeEmbeddedPreview = {
  artifact_id: string;
  kind: ArtifactPreviewKind;
  render_kind: ArtifactTextRenderKind | "";
  text: string;
  url: string;
  loading: boolean;
  error: string;
};

export function ArtifactGlyph(props: { artifact: RuntimeArtifact | null; size?: number }): React.ReactElement {
  const size = props.size || 18;
  const kind = artifact_preview_kind(props.artifact);
  const display_kind = artifact_display_kind(props.artifact, "");
  const cls = `artifact_glyph ${display_kind === "code" ? "code" : kind}`;
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as any;
  if (kind === "image") {
    return (
      <span className={cls}>
        <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15l3-3 3 3 2-2 4 4" /><circle cx="8" cy="9" r="1.4" /></svg>
      </span>
    );
  }
  if (kind === "audio") {
    return (
      <span className={cls}>
        <svg {...common}><path d="M4 12h2" /><path d="M8 8v8" /><path d="M12 5v14" /><path d="M16 8v8" /><path d="M20 12h-2" /></svg>
      </span>
    );
  }
  if (kind === "video") {
    return (
      <span className={cls}>
        <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 9l6 3-6 3V9z" fill="currentColor" stroke="none" /></svg>
      </span>
    );
  }
  if (display_kind === "code") {
    return (
      <span className={cls}>
        <svg {...common}><path d="M8 8l-4 4 4 4" /><path d="M16 8l4 4-4 4" /><path d="M14 4l-4 16" /></svg>
      </span>
    );
  }
  if (kind === "text") {
    return (
      <span className={cls}>
        <svg {...common}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h6" /><path d="M10 13h7" /><path d="M10 17h5" /></svg>
      </span>
    );
  }
  return (
    <span className={cls}>
      <svg {...common}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h6" /><path d="M9 14h8" /></svg>
    </span>
  );
}

export type HtmlExpansionMode = "folded" | "unfolded";
export type HtmlTreeNode =
  | { kind: "doctype"; name: string }
  | { kind: "comment"; text: string }
  | { kind: "text"; text: string }
  | { kind: "element"; tag: string; attrs: Array<{ name: string; value: string }>; children: HtmlTreeNode[] };

const HTML_FOLDED_DEPTH = 2;
const HTML_UNFOLDED_DEPTH = Number.MAX_SAFE_INTEGER;

export function html_text_preview(text: string, max = 120): string {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function parse_html_tree(text: string): HtmlTreeNode[] {
  const raw = String(text || "");
  if (typeof DOMParser === "undefined") {
    return [{ kind: "text", text: format_html_source(raw) || raw }];
  }
  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const nodes: HtmlTreeNode[] = [];
    if (doc.doctype) nodes.push({ kind: "doctype", name: doc.doctype.name || "html" });

    const convert = (node: Node): HtmlTreeNode | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = String(node.textContent || "").trim();
        return value ? { kind: "text", text: value } : null;
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        return { kind: "comment", text: String(node.textContent || "") };
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const attrs = Array.from(el.attributes || []).map((a) => ({ name: a.name, value: a.value }));
        const children = Array.from(el.childNodes || []).map(convert).filter(Boolean) as HtmlTreeNode[];
        return { kind: "element", tag: el.tagName.toLowerCase(), attrs, children };
      }
      return null;
    };

    if (doc.documentElement) {
      const root = convert(doc.documentElement);
      if (root) nodes.push(root);
    }
    return nodes.length ? nodes : [{ kind: "text", text: format_html_source(raw) || raw }];
  } catch {
    return [{ kind: "text", text: format_html_source(raw) || raw }];
  }
}

export function HtmlOpenTag(props: { tag: string; attrs: Array<{ name: string; value: string }>; closing?: boolean; selfClosing?: boolean }): React.ReactElement {
  if (props.closing) {
    return (
      <>
        <span className="runtime_html_punct">&lt;/</span>
        <span className="runtime_html_tag">{props.tag}</span>
        <span className="runtime_html_punct">&gt;</span>
      </>
    );
  }
  return (
    <>
      <span className="runtime_html_punct">&lt;</span>
      <span className="runtime_html_tag">{props.tag}</span>
      {props.attrs.map((attr) => (
        <React.Fragment key={`${props.tag}:${attr.name}:${attr.value}`}>
          {" "}
          <span className="runtime_html_attr">{attr.name}</span>
          <span className="runtime_html_punct">=</span>
          <span className="runtime_html_value">"{attr.value}"</span>
        </React.Fragment>
      ))}
      <span className="runtime_html_punct">{props.selfClosing ? " />" : ">"}</span>
    </>
  );
}

export function HtmlTreeNodeView(props: { node: HtmlTreeNode; depth: number; collapseAfterDepth: number; expansionMode: HtmlExpansionMode; expansionVersion: number }): React.ReactElement {
  const node = props.node;
  const indentPx = props.depth * 14;
  const defaultOpen = props.depth < props.collapseAfterDepth;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, props.expansionVersion]);

  if (node.kind === "doctype") {
    return (
      <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
        <span className="runtime_html_punct">&lt;!DOCTYPE </span>
        <span className="runtime_html_tag">{node.name}</span>
        <span className="runtime_html_punct">&gt;</span>
      </div>
    );
  }

  if (node.kind === "comment") {
    return (
      <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
        <span className="runtime_html_comment">{`<!-- ${node.text.trim()} -->`}</span>
      </div>
    );
  }

  if (node.kind === "text") {
    return (
      <div className="html-tree__line html-tree__text" style={{ paddingLeft: indentPx }}>
        {node.text}
      </div>
    );
  }

  if (!node.children.length) {
    return (
      <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
        <HtmlOpenTag tag={node.tag} attrs={node.attrs} selfClosing={true} />
      </div>
    );
  }

  const summary = node.children.find((child) => child.kind === "text") as Extract<HtmlTreeNode, { kind: "text" }> | undefined;

  return (
    <details className="html-tree__details" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="html-tree__summary" style={{ paddingLeft: indentPx }}>
        <span className="html-tree__caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <HtmlOpenTag tag={node.tag} attrs={node.attrs} />
        {!open && summary ? <span className="html-tree__summary_text"> {html_text_preview(summary.text)}</span> : null}
      </summary>
      {open ? (
        <div className="html-tree__children">
          {node.children.map((child, idx) => (
            <HtmlTreeNodeView
              key={`${props.depth}:${node.kind}:${node.tag}:${idx}`}
              node={child}
              depth={props.depth + 1}
              collapseAfterDepth={props.collapseAfterDepth}
              expansionMode={props.expansionMode}
              expansionVersion={props.expansionVersion}
            />
          ))}
          <div className="html-tree__line" style={{ paddingLeft: indentPx }}>
            <HtmlOpenTag tag={node.tag} attrs={[]} closing={true} />
          </div>
        </div>
      ) : null}
    </details>
  );
}

export function HtmlSourcePreview(props: { text: string; className: string }): React.ReactElement {
  const nodes = useMemo(() => parse_html_tree(props.text), [props.text]);
  const [expansion, setExpansion] = useState<{ mode: HtmlExpansionMode; version: number }>({ mode: "folded", version: 0 });
  const collapseAfterDepth = expansion.mode === "unfolded" ? HTML_UNFOLDED_DEPTH : HTML_FOLDED_DEPTH;

  useEffect(() => {
    setExpansion((prev) => ({ mode: "folded", version: prev.version + 1 }));
  }, [props.text]);

  const toggleExpansion = () => {
    setExpansion((prev) => ({
      mode: prev.mode === "unfolded" ? "folded" : "unfolded",
      version: prev.version + 1,
    }));
  };

  return (
    <div className={`${props.className} structured html_source_preview`}>
      <div className="html-tree__toolbar">
        <button type="button" className="btn html-tree__toggle" onClick={toggleExpansion} aria-expanded={expansion.mode === "unfolded"}>
          {expansion.mode === "unfolded" ? "Fold all" : "Unfold all"}
        </button>
      </div>
      <div className="html-tree__tree" role="tree" aria-label="HTML source tree">
        {nodes.map((node, idx) => (
          <HtmlTreeNodeView key={`root:${idx}`} node={node} depth={0} collapseAfterDepth={collapseAfterDepth} expansionMode={expansion.mode} expansionVersion={expansion.version} />
        ))}
      </div>
    </div>
  );
}

export function MarkdownArtifactPreview(props: { text: string; className: string }): React.ReactElement {
  const report = parse_markdown_report(props.text);
  if (!report) {
    return (
      <div className={`${props.className} structured markdown_preview`}>
        <Markdown text={props.text} />
      </div>
    );
  }

  const title = report.metadata.find((m) => m.label.toLowerCase() === "title")?.value || "";
  return (
    <div className={`${props.className} structured markdown_preview artifact_markdown_report`}>
      {title ? <h1 className="artifact_markdown_title">{title}</h1> : null}
      {report.metadata.length ? (
        <dl className="artifact_markdown_meta">
          {report.metadata.map((m) => {
            const is_url = /^https?:\/\//i.test(m.value);
            return (
              <div key={`${m.label}:${m.value}`}>
                <dt>{m.label}</dt>
                <dd>
                  {is_url ? (
                    <a href={m.value} target="_blank" rel="noreferrer">
                      {m.value}
                    </a>
                  ) : (
                    m.value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      <Markdown text={report.body || props.text} />
    </div>
  );
}

export function RuntimeStructuredTextPreview(props: { artifact: RuntimeArtifact | null; text: string; className: string }): React.ReactElement {
  const text = String(props.text || "");
  const render_kind = artifact_text_render_kind(props.artifact, text);

  if (render_kind === "json") {
    const parsed = tryParseJson(text);
    if (parsed !== null) {
      return (
        <div className={`${props.className} structured`}>
          <SharedJsonViewer value={parsed} collapseAfterDepth={4} showCopy={false} />
        </div>
      );
    }
  }

  if (render_kind === "markdown") {
    return <MarkdownArtifactPreview text={text} className={props.className} />;
  }

  if (render_kind === "html") {
    return <HtmlSourcePreview text={text} className={props.className} />;
  }

  return <pre className={`mono ${props.className}`}>{text}</pre>;
}

export function RuntimeInlinePreview(props: { artifact: RuntimeArtifact | null; preview: RuntimeEmbeddedPreview }): React.ReactElement {
  const preview = props.preview;
  const artifact = props.artifact;
  if (!artifact) return <div className="runtime_inline_preview empty">Select an artifact to preview it here.</div>;
  if (preview.loading) return <div className="runtime_inline_preview empty">Loading preview…</div>;
  if (preview.error) return <div className="runtime_inline_preview empty danger">{preview.error}</div>;
  if (preview.kind === "image" && preview.url) return <img className="runtime_inline_preview media" src={preview.url} alt={artifact_label(artifact)} />;
  if (preview.kind === "audio" && preview.url) return <audio className="runtime_inline_preview audio" src={preview.url} controls />;
  if (preview.kind === "video" && preview.url) return <video className="runtime_inline_preview media" src={preview.url} controls />;
  return <RuntimeStructuredTextPreview artifact={artifact} text={preview.text || "Preview unavailable. Use Preview or Download."} className="runtime_inline_preview text" />;
}

