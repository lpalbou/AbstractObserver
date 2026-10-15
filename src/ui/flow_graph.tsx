import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { COPY_FAILED, clipboardWrite } from "../lib/secure-context";
import {
  build_run_state_doc,
  node_context_copy,
  node_facts_copy,
  node_records_jsonl,
  node_status_map,
  result_needs_show_all,
  type NodeFacts,
  type NodeRunStatus,
} from "./flow_node_facts";
import { format_duration_ms } from "./format";
import { PinLegend } from "./pin_legend";
import { clamp_string } from "./pins";
import { run_status_class } from "./run_status";
import { short_run_id, type StateLine } from "./state_line";

type VisualFlow = {
  id?: string;
  name?: string;
  nodes?: any[];
  edges?: any[];
  entryNode?: string;
};

type GraphNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  type: string;
  color: string;
  meta?: {
    schedule?: string;
    recurrent?: boolean;
    subflow_id?: string;
  };
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
};

type ViewBox = { x: number; y: number; w: number; h: number };

function safe_str(v: any): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

function clamp_text(s: string, max_len: number): string {
  const text = safe_str(s).trim();
  if (text.length <= max_len) return text;
  return `${text.slice(0, Math.max(0, max_len - 1))}…`;
}

function is_exec_edge(e: any): boolean {
  const th = safe_str(e?.targetHandle);
  const sh = safe_str(e?.sourceHandle);
  if (th === "exec-in") return true;
  if (sh === "exec-out") return true;
  if (th.includes("exec") || sh.includes("exec")) return true;
  return false;
}

function node_type_from_raw(n: any): string {
  if (!n || typeof n !== "object") return "";
  const data = n?.data && typeof n.data === "object" ? n.data : {};
  return safe_str((data as any)?.nodeType || n?.type || "").trim();
}

function subflow_id_from_raw(n: any): string {
  if (!n || typeof n !== "object") return "";
  const data = n?.data && typeof n.data === "object" ? n.data : {};
  const sid = (data as any)?.subflowId || (data as any)?.flowId;
  const s = safe_str(sid).trim();
  if (!s) return "";
  // Accept namespaced "bundle:flow" but return only the local flow id.
  if (s.includes(":")) {
    const parts = s.split(":", 2);
    if (parts.length === 2 && parts[1]) return parts[1].trim();
  }
  return s;
}

function entry_node_id(flow: any): string {
  const en = safe_str(flow?.entryNode).trim();
  if (en) return en;
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  for (const n of nodes) {
    if (node_type_from_raw(n) === "on_flow_start") {
      const id = safe_str(n?.id).trim();
      if (id) return id;
    }
  }
  return "";
}

function node_pos(n: any): { x: number; y: number } {
  const pos = n?.position && typeof n.position === "object" ? n.position : {};
  const x = typeof (pos as any).x === "number" ? (pos as any).x : 0;
  const y = typeof (pos as any).y === "number" ? (pos as any).y : 0;
  return { x, y };
}

function prefixed_id(prefix: string, id: string): string {
  const p = safe_str(prefix).trim();
  const s = safe_str(id).trim();
  if (!s) return "";
  return p ? `${p}::${s}` : s;
}

function merge_flow_with_subflows(args: {
  root: any;
  flow_by_id: Record<string, any>;
  expand_subflows: boolean;
  max_depth: number;
  max_nodes: number;
  max_edges: number;
}): VisualFlow {
  const root = args.root && typeof args.root === "object" ? args.root : {};
  if (!args.expand_subflows) return root;

  const merged_nodes: any[] = [];
  const merged_edges: any[] = [];
  const seen = new Set<string>();

  const add_flow = (flow: any, prefix: string, offset: { x: number; y: number }, depth: number) => {
    if (!flow || typeof flow !== "object") return;
    if (merged_nodes.length >= args.max_nodes || merged_edges.length >= args.max_edges) return;

    const raw_nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const raw_edges = Array.isArray(flow.edges) ? flow.edges : [];

    for (const n of raw_nodes) {
      const id = safe_str(n?.id).trim();
      if (!id) continue;
      const nid = prefixed_id(prefix, id);
      if (!nid || seen.has(nid)) continue;
      const pos = node_pos(n);
      const next = { ...(n as any), id: nid, position: { x: pos.x + offset.x, y: pos.y + offset.y } };
      merged_nodes.push(next);
      seen.add(nid);
      if (merged_nodes.length >= args.max_nodes) break;
    }

    for (const e of raw_edges) {
      if (!is_exec_edge(e)) continue;
      const source = safe_str(e?.source).trim();
      const target = safe_str(e?.target).trim();
      if (!source || !target) continue;
      const sid = prefixed_id(prefix, source);
      const tid = prefixed_id(prefix, target);
      if (!sid || !tid) continue;
      const raw_id = safe_str(e?.id).trim();
      const edge_id = raw_id ? `${sid}->${tid}::${raw_id}` : `${sid}->${tid}`;
      merged_edges.push({
        ...(e as any),
        id: edge_id,
        source: sid,
        target: tid,
      });
      if (merged_edges.length >= args.max_edges) break;
    }

    if (depth >= args.max_depth) return;

    for (const n of raw_nodes) {
      if (merged_nodes.length >= args.max_nodes || merged_edges.length >= args.max_edges) return;
      if (node_type_from_raw(n) !== "subflow") continue;
      const child_fid = subflow_id_from_raw(n);
      if (!child_fid) continue;
      const child = args.flow_by_id[child_fid];
      if (!child || typeof child !== "object") continue;

      const parent_id = prefixed_id(prefix, safe_str(n?.id));
      if (!parent_id) continue;
      const en = entry_node_id(child);
      if (!en) continue;
      const child_nodes = Array.isArray((child as any).nodes) ? (child as any).nodes : [];
      const entry_raw = child_nodes.find((x: any) => safe_str(x?.id).trim() === en) || null;
      if (!entry_raw) continue;

      const parent_pos = node_pos(n);
      const entry_pos = node_pos(entry_raw);
      const dx = 240;
      const dy = 0;
      const child_offset = { x: parent_pos.x + offset.x + dx - entry_pos.x, y: parent_pos.y + offset.y + dy - entry_pos.y };

      const child_entry_id = prefixed_id(parent_id, en);
      merged_edges.push({
        id: `${parent_id}=>${child_entry_id}`,
        source: parent_id,
        target: child_entry_id,
        sourceHandle: "exec-out",
        targetHandle: "exec-in",
      });

      add_flow(child, parent_id, child_offset, depth + 1);
    }
  };

  add_flow(root, "", { x: 0, y: 0 }, 0);
  return {
    ...(root as any),
    id: safe_str((root as any).id),
    nodes: merged_nodes,
    edges: merged_edges,
  };
}

function is_plumbing_type(node_type: string): boolean {
  const t = safe_str(node_type).trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith("literal")) return true;
  if (t.includes("literal")) return true;
  if (t === "concat") return true;
  if (t === "join") return true;
  if (t === "cast") return true;
  if (t === "parse_json" || t === "stringify_json") return true;
  if (t === "break_object") return true;
  if (t === "get_property" || t === "set_property") return true;
  if (t.includes("get_property") || t.includes("set_property")) return true;
  if (t === "get_variable" || t === "set_variable") return true;
  if (t.includes("get_variable") || t.includes("set_variable")) return true;
  if (t === "json_schema") return true;
  return false;
}

function simplify_exec_graph(args: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  keep_id: (id: string) => boolean;
  max_edges: number;
}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = args.nodes.filter((n) => args.keep_id(n.id));
  const keep = new Set(nodes.map((n) => n.id));

  const outgoing: Record<string, string[]> = {};
  for (const e of args.edges) {
    if (!outgoing[e.source]) outgoing[e.source] = [];
    outgoing[e.source].push(e.target);
  }

  const dedup = new Map<string, GraphEdge>();
  for (const s of nodes) {
    const seen = new Set<string>();
    const stack = (outgoing[s.id] || []).slice();
    while (stack.length) {
      const t = stack.pop() as string;
      if (!t || seen.has(t)) continue;
      seen.add(t);
      if (keep.has(t)) {
        const key = `${s.id}->${t}`;
        if (!dedup.has(key)) dedup.set(key, { id: key, source: s.id, target: t });
        continue;
      }
      const nexts = outgoing[t] || [];
      for (const nx of nexts) {
        if (!seen.has(nx)) stack.push(nx);
      }
      if (dedup.size >= args.max_edges) break;
    }
    if (dedup.size >= args.max_edges) break;
  }

  return { nodes, edges: Array.from(dedup.values()) };
}

function clamp_view(view: ViewBox, bounds: { x: number; y: number; w: number; h: number }): ViewBox {
  const min_w = 160;
  const min_h = 120;
  const max_w = Math.max(bounds.w * 8, min_w);
  const max_h = Math.max(bounds.h * 8, min_h);

  const w = Math.max(min_w, Math.min(max_w, view.w));
  const h = Math.max(min_h, Math.min(max_h, view.h));
  return { x: view.x, y: view.y, w, h };
}

// --- run status on the graph (Lane D, operator 2026-10-14 11:15) -------------------
//
// AbstractFlow's run vocabulary (abstractflow NodeStatusGlyph.tsx, nodes.css):
// running = --success ring + pulse, waiting = --warning dashed ring, failed =
// --error ring, done = --info check. The colour is never the only signal: each
// status also draws a glyph and is named in the node's accessible label.

export type GraphRunStatus = NodeRunStatus | "none";

const TERMINAL_WORDS = new Set(["completed", "failed", "cancelled", "stopped"]);

const HERE_TEXT: Readonly<Record<GraphRunStatus, string>> = { running: "here", waiting: "waiting here", failed: "failed here", done: "here", none: "here" };

const STATUS_WORD: Readonly<Record<GraphRunStatus, string>> = { running: "running", waiting: "waiting", failed: "failed", done: "done", none: "not visited" };

/** The wait reason as the object of "waiting" (runtime WaitReason enum → words; never the bare word). */
const WAIT_OBJECT: Readonly<Record<string, string>> = {
  user: "waiting for you",
  subworkflow: "waiting for its subrun",
  until: "waiting for the clock",
  event: "waiting for an event",
  job: "waiting for a tool job",
};

function wait_words(facts: NodeFacts | null | undefined): string {
  const open = facts?.waits.find((w) => w.open) || null;
  if (!open) return "waiting, reason not recorded";
  return WAIT_OBJECT[open.reason] || `waiting (${open.reason || "reason not recorded"})`;
}

function status_rank(s: GraphRunStatus): number {
  return s === "running" ? 3 : s === "waiting" ? 2 : 0;
}

function hhmmss(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
}

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function StatusGlyph(props: { status: GraphRunStatus }): React.ReactElement | null {
  const s = props.status;
  if (s === "none") return null;
  let glyph: React.ReactElement;
  if (s === "running") glyph = <circle className="flow_badge_spin" r={4} fill="none" strokeDasharray="18 8" />;
  else if (s === "waiting") glyph = <path d="M -2 -3.5 V 3.5 M 2 -3.5 V 3.5" />;
  else if (s === "failed")
    glyph = (
      <>
        <path d="M 0 -4 V 1" />
        <circle className="flow_badge_dot" cx={0} cy={3.6} r={0.9} />
      </>
    );
  else glyph = <path d="M -3.5 0.2 L -1 2.8 L 3.6 -2.6" />;
  return (
    <>
      <circle className="flow_badge_bg" r={8.5} />
      {glyph}
    </>
  );
}

function CopyButton(props: {
  label: React.ReactNode;
  /** What the button says for 1.5 s after a copy (default "Copied" / the failure hint). */
  copied?: React.ReactNode;
  failed?: React.ReactNode;
  title?: string;
  className?: string;
  get_text: () => string;
  disabled?: boolean;
}): React.ReactElement {
  const [state, set_state] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className={props.className || "btn flow_copy_btn"}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      data-copy-state={state}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await clipboardWrite(props.get_text());
        set_state(ok ? "copied" : "failed");
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => set_state("idle"), 1500);
      }}
    >
      <span aria-live="polite">{state === "copied" ? props.copied ?? "Copied" : state === "failed" ? props.failed ?? COPY_FAILED : props.label}</span>
    </button>
  );
}

/** A long text: clamped the pins' way, with "show all (N chars)". */
function LongText(props: { text: string }): React.ReactElement {
  const [all, set_all] = useState(false);
  const { shown, clamped } = clamp_string(props.text);
  return (
    <span className="flow_facts_text">
      <span>{all || !clamped ? props.text : shown}</span>
      {clamped ? (
        <button type="button" className="flow_link_btn" aria-expanded={all} onClick={() => set_all((v) => !v)}>
          {all ? "show less" : `show all (${props.text.length.toLocaleString("en-US")} chars)`}
        </button>
      ) : null}
    </span>
  );
}

/** The result summary (every key) and, when a value is shown by its size, the complete value behind "show all". */
function ResultCell(props: { summary: string; value: unknown }): React.ReactElement {
  const [all, set_all] = useState(false);
  const more = result_needs_show_all(props.value);
  return (
    <span className="flow_facts_text">
      <code className="flow_facts_summary">{props.summary}</code>
      {more ? (
        <button type="button" className="flow_link_btn" aria-expanded={all} onClick={() => set_all((v) => !v)}>
          {all ? "show less" : "show all"}
        </button>
      ) : null}
      {more && all ? <pre className="flow_facts_json">{JSON.stringify(props.value, null, 2)}</pre> : null}
    </span>
  );
}

export type NodeFactsPanelProps = {
  node: { id: string; label: string; type: string };
  facts: NodeFacts | null;
  status: GraphRunStatus;
  here: boolean;
  finished: boolean;
  on_open_run?: (run_id: string) => void;
};

/** What one node did in this run — the hover/focus panel's body (exported for tests). */
export function NodeFactsPanel(props: NodeFactsPanelProps): React.ReactElement {
  const { node, facts, status } = props;
  const word = status === "waiting" ? wait_words(facts) : STATUS_WORD[status];
  const times = facts
    ? [
        `${facts.visits.toLocaleString("en-US")} visit${facts.visits === 1 ? "" : "s"}`,
        facts.first_ms !== null ? `first ${hhmmss(facts.first_ms)}` : "",
        facts.last_ms !== null ? `last ${hhmmss(facts.last_ms)}` : "",
        `${format_duration_ms(facts.duration_ms)} in steps`,
      ].filter(Boolean)
    : [];
  const llm = facts?.llm || null;
  return (
    <div className="flow_facts">
      <div className="flow_facts_head">
        <span className="flow_facts_title">{node.label}</span>
        <span className="flow_facts_type">{node.type}</span>
      </div>
      <div className="flow_facts_status">
        <span className="flow_status_chip" data-run-status={status}>
          {word}
        </span>
        {props.here ? <span className="flow_facts_here">{HERE_TEXT[status]}</span> : null}
      </div>
      {facts ? (
        <dl className="flow_facts_rows">
          <div className="flow_facts_row">
            <dt>Visits</dt>
            <dd>{times.join(" · ")}</dd>
          </div>
          {llm ? (
            <div className="flow_facts_row">
              <dt>LLM</dt>
              <dd>
                {[
                  llm.model || "model not recorded",
                  llm.provider || "provider not recorded",
                  `${llm.calls.toLocaleString("en-US")} call${llm.calls === 1 ? "" : "s"}`,
                  llm.tokens ? `${llm.tokens.in.toLocaleString("en-US")} in · ${llm.tokens.out.toLocaleString("en-US")} out tokens` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          ) : null}
          {facts.tools.length ? (
            <div className="flow_facts_row">
              <dt>Tools</dt>
              <dd>
                <table className="flow_facts_tools">
                  <thead>
                    <tr>
                      <th scope="col">tool</th>
                      <th scope="col">calls</th>
                      <th scope="col">failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.tools.map((t) => (
                      <tr key={t.name} data-failed={t.failed > 0 ? "true" : undefined}>
                        <td>{t.name}</td>
                        <td>{t.calls}</td>
                        <td>{t.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </dd>
            </div>
          ) : null}
          {facts.waits.length ? (
            <div className="flow_facts_row">
              <dt>Waits</dt>
              <dd>
                <ul className="flow_facts_list">
                  {facts.waits.map((w, i) => (
                    <li key={`${w.reason}|${w.wait_key}|${i}`}>
                      <span>{WAIT_OBJECT[w.reason] || w.reason || "reason not recorded"}</span>
                      {w.open ? <span className="flow_facts_open"> · now</span> : null}
                      {w.prompt ? (
                        <>
                          {" · "}
                          <LongText text={w.prompt} />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {facts.subruns.length ? (
            <div className="flow_facts_row">
              <dt>Subruns</dt>
              <dd className="flow_facts_subruns">
                {facts.subruns.map((rid) => (
                  <button
                    key={rid}
                    type="button"
                    className="flow_link_btn mono"
                    title={props.on_open_run ? `Open run ${rid}` : `${rid} (opening runs is not wired here)`}
                    disabled={!props.on_open_run}
                    onClick={() => props.on_open_run?.(rid)}
                  >
                    {short_run_id(rid)}
                  </button>
                ))}
              </dd>
            </div>
          ) : null}
          {facts.last_result_summary ? (
            <div className="flow_facts_row">
              <dt>Result</dt>
              <dd>
                <ResultCell summary={facts.last_result_summary} value={facts.last_result} />
              </dd>
            </div>
          ) : null}
          {facts.last_error ? (
            <div className="flow_facts_row flow_facts_error">
              <dt>Error</dt>
              <dd>
                <LongText text={facts.last_error} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="flow_facts_none">{props.finished ? "Not visited in this run." : "Not visited yet."}</p>
      )}
      <div className="flow_facts_actions">
        <CopyButton label="Copy facts (JSON)" disabled={!facts} get_text={() => (facts ? node_facts_copy(facts) : "")} />
        <CopyButton label="Copy records (JSONL)" disabled={!facts || !facts.records.length} get_text={() => (facts ? node_records_jsonl(facts) : "")} />
        {facts?.context ? <CopyButton label="Copy context" get_text={() => node_context_copy(facts)} /> : null}
      </div>
    </div>
  );
}

export function FlowGraph(props: {
  flow: VisualFlow | null;
  flow_by_id?: Record<string, any>;
  expand_subflows?: boolean;
  simplify?: boolean;
  prefer_vertical?: boolean;
  vertical_compact?: number;
  schedule_next_in?: string;
  schedule_interval?: string;
  node_last_ms?: Record<string, number>;
  active_node_id?: string;
  recent_nodes?: Record<string, number>;
  visited_nodes?: Record<string, number>;
  highlight_path?: boolean;
  now_ms?: number;
  /** The root run the graph shows (for "Copy run state"). */
  run_id?: string;
  /** The run's state sentence (state_line.ts) — the banner's text. */
  run_line?: StateLine | null;
  /** The run's status word (`run_status_word`): colours the banner pill, decides ongoing vs finished. */
  run_status?: string;
  /** Overrides the label the banner names after "at" (default: the highlighted node's label). */
  current_node_label?: string;
  /** graph node id → status (`node_status_map(node_facts)`); default: derived from `node_facts`. */
  node_status?: Record<string, NodeRunStatus>;
  /** graph node id → facts (`fold_node_facts`): the hover/focus panel and the copies. */
  node_facts?: Record<string, NodeFacts>;
  /** Opens a subrun listed in a node's facts. */
  on_open_run?: (run_id: string) => void;
}): React.ReactElement {
  const now_ms = typeof props.now_ms === "number" ? props.now_ms : Date.now();
  const flow_in = props.flow;
  const active = safe_str(props.active_node_id);
  const recent = props.recent_nodes || {};
  const visited = props.visited_nodes || {};
  const highlight_path = props.highlight_path === true;
  const vertical_compact = typeof props.vertical_compact === "number" ? Math.max(0.4, Math.min(1, props.vertical_compact)) : 0.78;

  const { nodes, edges, bounds } = useMemo(() => {
    const vf: any = merge_flow_with_subflows({
      root: flow_in || {},
      flow_by_id: props.flow_by_id || {},
      expand_subflows: props.expand_subflows === true,
      max_depth: 3,
      max_nodes: 700,
      max_edges: 900,
    });
    const raw_nodes = Array.isArray(vf.nodes) ? vf.nodes : [];
    const raw_edges = Array.isArray(vf.edges) ? vf.edges : [];

    let nodes_out: GraphNode[] = [];
    for (const n of raw_nodes) {
      const id = safe_str(n?.id).trim();
      if (!id) continue;
      const pos = n?.position && typeof n.position === "object" ? n.position : {};
      const x = typeof pos.x === "number" ? pos.x : 0;
      const y = typeof pos.y === "number" ? pos.y : 0;
      const data = n?.data && typeof n.data === "object" ? n.data : {};
      const label = safe_str(data?.label || n?.label || id) || id;
      const type = safe_str(data?.nodeType || n?.type || "unknown") || "unknown";
      const color = safe_str(data?.headerColor || n?.headerColor || "") || "";
      const event_cfg = data?.eventConfig && typeof data.eventConfig === "object" ? data.eventConfig : null;
      const schedule = event_cfg && typeof (event_cfg as any).schedule === "string" ? safe_str((event_cfg as any).schedule).trim() : "";
      const recurrent = event_cfg && typeof (event_cfg as any).recurrent === "boolean" ? Boolean((event_cfg as any).recurrent) : undefined;
      const subflow_id = type === "subflow" ? subflow_id_from_raw(n) : "";
      const meta =
        schedule || recurrent !== undefined || subflow_id
          ? { schedule: schedule || undefined, recurrent, subflow_id: subflow_id || undefined }
          : undefined;
      nodes_out.push({ id, x, y, label, type, color, meta });
    }
    const node_lookup: Record<string, GraphNode> = {};
    for (const n of nodes_out) node_lookup[n.id] = n;

    let edges_out: GraphEdge[] = [];
    for (const e of raw_edges) {
      if (!is_exec_edge(e)) continue;
      const source = safe_str(e?.source).trim();
      const target = safe_str(e?.target).trim();
      if (!source || !target) continue;
      edges_out.push({ id: safe_str(e?.id || `${source}->${target}`), source, target });
    }

    // Only keep edges that connect nodes we actually have (important when graphs are truncated).
    const node_ids = new Set(nodes_out.map((n) => n.id));
    edges_out = edges_out.filter((e) => node_ids.has(e.source) && node_ids.has(e.target));

    if (props.simplify === true) {
      const keep_id = (id: string) => {
        if (active && id === active) return true;
        const n = node_lookup[id];
        if (!n) return false;
        const t = safe_str(n.type).trim().toLowerCase();
        if (t === "on_flow_start" || t === "on_flow_end") return true;
        if (t === "subflow") return true;
        return !is_plumbing_type(t);
      };
      const simplified = simplify_exec_graph({ nodes: nodes_out, edges: edges_out, keep_id, max_edges: 900 });
      nodes_out = simplified.nodes;
      edges_out = simplified.edges;
    }

    if (props.prefer_vertical === true && nodes_out.length >= 2) {
      const xs = nodes_out.map((n) => n.x);
      const ys = nodes_out.map((n) => n.y);
      const span_x = Math.max(...xs) - Math.min(...xs);
      const span_y = Math.max(...ys) - Math.min(...ys);
      // Force a "vertical-first" read: rotate only if it's not already taller than wide.
      if (span_x >= span_y) {
        nodes_out = nodes_out.map((n) => ({ ...n, x: n.y, y: n.x }));
      }
      // Condense vertical spacing a bit (mobile/portrait readability).
      const min_y0 = Math.min(...nodes_out.map((n) => n.y));
      nodes_out = nodes_out.map((n) => ({ ...n, y: min_y0 + (n.y - min_y0) * vertical_compact }));
    }

    const node_pos: Record<string, GraphNode> = {};
    for (const n of nodes_out) node_pos[n.id] = n;

    // Estimate bounds based on node positions.
    const w = 160;
    const h = 56;
    const half_w = w / 2;
    const half_h = h / 2;
    let min_x = 0;
    let min_y = 0;
    let max_x = 0;
    let max_y = 0;
    if (nodes_out.length) {
      min_x = Math.min(...nodes_out.map((n) => n.x));
      min_y = Math.min(...nodes_out.map((n) => n.y));
      max_x = Math.max(...nodes_out.map((n) => n.x + w));
      max_y = Math.max(...nodes_out.map((n) => n.y + h));
    }

    // Expand bounds to include large loop arcs (bidirectional edges).
    let arc_pad = 0;
    if (edges_out.length) {
      const pair = new Set(edges_out.map((e) => `${e.source}->${e.target}`));
      for (const e of edges_out) {
        if (!pair.has(`${e.target}->${e.source}`)) continue;
        const s = node_pos[e.source];
        const t = node_pos[e.target];
        if (!s || !t) continue;
        const sx = s.x + half_w;
        const sy = s.y + half_h;
        const tx = t.x + half_w;
        const ty = t.y + half_h;
        const len = Math.max(1, Math.hypot(tx - sx, ty - sy));
        const base = Math.max(28, Math.min(72, len * 0.14));
        const mag = Math.min(200, base * 3.5);
        if (mag > arc_pad) arc_pad = mag;
      }
    }

    const pad = 60 + arc_pad;
    const vb = {
      x: min_x - pad,
      y: min_y - pad,
      w: (max_x - min_x) + pad * 2,
      h: (max_y - min_y) + pad * 2,
      node_w: w,
      node_h: h,
    };
    return { nodes: nodes_out, edges: edges_out, bounds: vb };
  }, [flow_in, props.flow_by_id, props.expand_subflows, props.simplify, props.prefer_vertical, active, vertical_compact]);

  const svg_ref = useRef<SVGSVGElement | null>(null);
  const [view, set_view] = useState<ViewBox>(() => ({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }));
  const view_ref = useRef<ViewBox>(view);
  view_ref.current = view;

  useEffect(() => {
    set_view({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
  }, [bounds.x, bounds.y, bounds.w, bounds.h]);

  const pointers_ref = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture_ref = useRef<
    | null
    | {
        mode: "pan" | "pinch";
        start_view: ViewBox;
        start_client: { x: number; y: number };
        start_dist: number;
        anchor_svg: { x: number; y: number };
      }
  >(null);

  const edge_pair_set = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) set.add(`${e.source}->${e.target}`);
    return set;
  }, [edges]);

  // --- the node facts panel: one at a time; hover (150 ms) or focus shows it, a click or Enter pins it ---
  const [pop, set_pop] = useState<{ id: string; mode: "hover" | "focus" | "pinned" } | null>(null);
  const [pop_pos, set_pop_pos] = useState<{ top: number; left: number; width: number } | null>(null);
  const node_els = useRef<Record<string, SVGGElement | null>>({});
  const pop_el = useRef<HTMLDivElement | null>(null);
  const hover_timer = useRef<number | null>(null);
  const down_ref = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppress_focus_ref = useRef(false);
  const uid = useId();
  const panel_dom_id = `flow_facts_${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const clear_hover_timer = () => {
    if (hover_timer.current !== null) window.clearTimeout(hover_timer.current);
    hover_timer.current = null;
  };
  const place_pop = (id: string) => {
    const el = node_els.current[id];
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(400, vw - 16);
    let left = r.right + 10;
    let top = r.top;
    if (left + width > vw - 8) left = r.left - 10 - width;
    if (left < 8) {
      // Neither side fits (a phone): below the node.
      left = Math.min(Math.max(8, r.left), Math.max(8, vw - width - 8));
      top = r.bottom + 8;
    }
    set_pop_pos((prev) => (prev && prev.top === top && prev.left === left && prev.width === width ? prev : { top, left, width }));
  };
  const open_pop = (id: string, mode: "hover" | "focus") => {
    clear_hover_timer();
    place_pop(id);
    set_pop({ id, mode });
  };
  const hide_soon = (id: string) => {
    clear_hover_timer();
    hover_timer.current = window.setTimeout(() => set_pop((p) => (p && p.id === id && p.mode !== "pinned" ? null : p)), 200);
  };
  const toggle_pin = (id: string, focus_panel: boolean) => {
    clear_hover_timer();
    if (pop && pop.id === id && pop.mode === "pinned") {
      set_pop(null);
      return;
    }
    place_pop(id);
    set_pop({ id, mode: "pinned" });
    if (focus_panel) window.setTimeout(() => pop_el.current?.focus(), 0);
  };
  useEffect(() => () => clear_hover_timer(), []);

  // Keep the panel beside its node while the graph pans/zooms, and inside the viewport.
  useBrowserLayoutEffect(() => {
    if (pop) place_pop(pop.id);
  }, [pop?.id, view.x, view.y, view.w, view.h]);
  const clamp_pop = () => {
    const el = pop_el.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vh = window.innerHeight;
    set_pop_pos((p) => {
      if (!p || p.top + h <= vh - 8) return p;
      const top = Math.max(8, vh - 8 - h);
      return top === p.top ? p : { ...p, top };
    });
  };
  useBrowserLayoutEffect(() => {
    if (pop && pop_pos) clamp_pop();
  }, [pop?.id, pop_pos?.top, pop_pos?.left, pop_pos?.width]);
  // A section opened inside the panel ("show all") grows it: keep it on screen.
  const has_pop_pos = Boolean(pop_pos);
  useEffect(() => {
    const el = pop_el.current;
    if (!pop || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => clamp_pop());
    ro.observe(el);
    return () => ro.disconnect();
  }, [pop?.id, has_pop_pos]);
  useEffect(() => {
    if (!pop) return;
    const on_key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      set_pop(null);
      if (pop.mode !== "hover") {
        suppress_focus_ref.current = true;
        node_els.current[pop.id]?.focus();
        suppress_focus_ref.current = false;
      }
    };
    const on_down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && pop_el.current?.contains(t)) return;
      // A press on a node toggles that node's panel itself (svg pointerup).
      if (t && typeof t.closest === "function" && t.closest("[data-flow-node]")) return;
      set_pop(null);
    };
    const on_move = () => place_pop(pop.id);
    document.addEventListener("keydown", on_key, true);
    document.addEventListener("pointerdown", on_down, true);
    window.addEventListener("resize", on_move);
    window.addEventListener("scroll", on_move, true);
    return () => {
      document.removeEventListener("keydown", on_key, true);
      document.removeEventListener("pointerdown", on_down, true);
      window.removeEventListener("resize", on_move);
      window.removeEventListener("scroll", on_move, true);
    };
  }, [pop?.id, pop?.mode]);

  const view_box = `${view.x} ${view.y} ${view.w} ${view.h}`;
  const node_by_id: Record<string, GraphNode> = {};
  for (const n of nodes) node_by_id[n.id] = n;

  const to_visible_id = (id: string): string => {
    let cur = safe_str(id).trim();
    if (!cur) return "";
    if (node_by_id[cur]) return cur;
    while (cur.includes("::")) {
      cur = cur.slice(0, Math.max(0, cur.lastIndexOf("::")));
      if (node_by_id[cur]) return cur;
    }
    return "";
  };

  const active_visible = to_visible_id(active);
  const recent_visible: Record<string, number> = {};
  for (const [k, until] of Object.entries(recent)) {
    if (typeof until !== "number") continue;
    const vid = to_visible_id(k);
    if (!vid) continue;
    recent_visible[vid] = Math.max(recent_visible[vid] || 0, until);
  }

  const visited_visible: Record<string, number> = {};
  if (highlight_path) {
    for (const [k, t] of Object.entries(visited)) {
      if (typeof t !== "number") continue;
      const vid = to_visible_id(k);
      if (!vid) continue;
      visited_visible[vid] = typeof visited_visible[vid] === "number" ? Math.min(visited_visible[vid], t) : t;
    }
  }

  const schedule_next_in = safe_str(props.schedule_next_in).trim();
  const schedule_interval = safe_str(props.schedule_interval).trim();
  const node_last_ms = props.node_last_ms && typeof props.node_last_ms === "object" ? props.node_last_ms : {};

  const short_hhmm = (ms: number): string => {
    try {
      const d = new Date(ms);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "";
    }
  };

  const schedule_sublabel = (n: GraphNode, is_active: boolean): string => {
    const schedule = safe_str(n.meta?.schedule).trim();
    const recurrent = n.meta?.recurrent === true;
    if (!recurrent) {
      if (is_active && schedule_next_in) return `next ${schedule_next_in}`;
      if (schedule && schedule.length <= 12 && !schedule.includes("T")) return `in ${schedule}`;
      return "scheduled";
    }
    const every = schedule || schedule_interval;
    if (!every) return is_active && schedule_next_in ? `next ${schedule_next_in}` : "scheduled";
    if (is_active && schedule_next_in) return `${every} • next ${schedule_next_in}`;
    return `every ${every}`;
  };

  const subflow_label = (n: GraphNode): { label: string; sub: string } => {
    const sid = safe_str(n.meta?.subflow_id).trim();
    const flow = sid && props.flow_by_id ? props.flow_by_id[sid] : null;
    const name = safe_str(flow?.name).trim();
    const label = name || sid || n.label || n.id;
    const last_ms = typeof node_last_ms[n.id] === "number" ? Number(node_last_ms[n.id]) : null;
    const last = last_ms !== null ? short_hhmm(last_ms) : "";
    const sub = last ? `last ${last}` : "subflow";
    return { label, sub };
  };

  /** The label and second line a node card shows. */
  const display_of = (n: GraphNode, is_active: boolean): { label: string; type: string } => {
    let label = n.label || n.id;
    let type = n.type;
    if (n.type === "on_schedule") type = schedule_sublabel(n, is_active);
    else if (n.type === "subflow") {
      const sub = subflow_label(n);
      label = sub.label;
      type = sub.sub;
    }
    return { label, type };
  };

  // --- run state: ongoing or finished, and where the highlight sits ---
  const run_word = safe_str(props.run_status).trim().toLowerCase();
  const line = props.run_line || null;
  const run_id = safe_str(props.run_id).trim();
  const has_run = Boolean(run_word || line || run_id);
  const finished = run_word ? TERMINAL_WORDS.has(run_word) : line ? line.verb === "done" : false;
  const run_died = run_word === "failed" || run_word === "cancelled";
  const facts_all: Record<string, NodeFacts> = props.node_facts || {};
  const raw_status: Record<string, NodeRunStatus> = props.node_status || node_status_map(facts_all);

  // A collapsed subflow shows the status of what runs inside it: an open state
  // (running over waiting) beats a closed one; among closed ones the latest wins.
  const status_visible: Record<string, { s: GraphRunStatus; t: number }> = {};
  for (const [k, s0] of Object.entries(raw_status)) {
    const vid = to_visible_id(k);
    if (!vid) continue;
    let s: GraphRunStatus = s0;
    // A finished run has no open node: what was left open ended with the run.
    if (finished && (s === "running" || s === "waiting")) s = run_died ? "failed" : "done";
    const t = facts_all[k]?.last_ms ?? (typeof node_last_ms[k] === "number" ? node_last_ms[k] : 0);
    const cur = status_visible[vid];
    if (!cur) {
      status_visible[vid] = { s, t };
      continue;
    }
    const ra = status_rank(s), rb = status_rank(cur.s);
    const wins = ra !== rb ? ra > rb : t !== cur.t ? t > cur.t : s === "failed" && cur.s !== "failed";
    if (wins) status_visible[vid] = { s, t };
  }
  const status_of = (id: string): GraphRunStatus => status_visible[id]?.s || "none";

  let here = active_visible;
  if (!here && has_run) {
    // No live highlight (a page opened mid-run, or a run that died): the ledger says where.
    let best: { id: string; s: GraphRunStatus; t: number } | null = null;
    for (const [id, v] of Object.entries(status_visible)) {
      const ok = finished ? run_died && v.s === "failed" : status_rank(v.s) > 0;
      if (!ok) continue;
      if (!best || status_rank(v.s) > status_rank(best.s) || (status_rank(v.s) === status_rank(best.s) && v.t > best.t)) best = { id, ...v };
    }
    here = best ? best.id : "";
  }
  const here_text = (s: GraphRunStatus): string => (finished && run_word === "cancelled" && s === "failed" ? "cancelled here" : HERE_TEXT[s]);

  const visited_ids = new Set<string>();
  let first_ms: number | null = null;
  let last_ms: number | null = null;
  for (const [k, f] of Object.entries(facts_all)) {
    if (!f || f.visits <= 0) continue;
    const vid = to_visible_id(k);
    if (vid) visited_ids.add(vid);
    if (f.first_ms !== null) first_ms = first_ms === null ? f.first_ms : Math.min(first_ms, f.first_ms);
    if (f.last_ms !== null) last_ms = last_ms === null ? f.last_ms : Math.max(last_ms, f.last_ms);
  }
  for (const [k, t] of Object.entries(visited)) {
    if (typeof t !== "number") continue;
    const vid = to_visible_id(k);
    if (vid) visited_ids.add(vid);
  }
  if (first_ms === null || last_ms === null) {
    const times = Object.values(node_last_ms).filter((x) => typeof x === "number" && Number.isFinite(x));
    if (times.length >= 2) {
      first_ms = Math.min(...times);
      last_ms = Math.max(...times);
    }
  }
  const span_ms = first_ms !== null && last_ms !== null && last_ms >= first_ms ? last_ms - first_ms : null;

  const fallback_sentence = (w: string): string => {
    if (!w) return "state not loaded";
    if (w === "waiting") return "waiting, reason not loaded";
    return w;
  };
  const sentence = line?.text || fallback_sentence(run_word);
  const verb_status: Record<string, string> = { running: "running", needs_you: "waiting", paused: "paused", waiting: "waiting", scheduled: "scheduled", done: "" };
  const pill_class = run_status_class(run_word || (line ? verb_status[line.verb] ?? "" : ""));
  const here_node = here ? node_by_id[here] : undefined;
  const at_label = safe_str(props.current_node_label).trim() || (here_node ? display_of(here_node, here === active_visible).label : "");
  const show_at = Boolean(at_label) && (!finished || run_died);
  const visited_text = `${visited_ids.size.toLocaleString("en-US")} node${visited_ids.size === 1 ? "" : "s"} visited${span_ms !== null ? ` in ${format_duration_ms(span_ms)}` : ""}`;

  const banner = has_run ? (
    <div className="flow_banner" data-phase={finished ? "finished" : "ongoing"}>
      <span className={`chip ${pill_class}`}>{finished ? "finished" : "ongoing"}</span>
      <span className="flow_banner_text">{sentence}</span>
      {show_at ? (
        <span className="flow_banner_at">
          · at <strong>{at_label}</strong>
        </span>
      ) : null}
      {finished && flow_in ? <span className="flow_banner_meta">· {visited_text}</span> : null}
    </div>
  ) : (
    <div className="flow_banner" data-phase="none">
      <span className="chip muted">no run</span>
      <span className="flow_banner_text">the workflow only — open a run to see where it is</span>
    </div>
  );

  if (!flow_in) {
    if (!has_run) {
      return (
        <div className="graph_empty mono">
          (no graph loaded)
        </div>
      );
    }
    return (
      <div className="graph_wrap">
        {banner}
        <div className="graph_empty mono">(no graph loaded)</div>
      </div>
    );
  }

  const client_to_svg = (client_x: number, client_y: number, use_view?: ViewBox): { x: number; y: number } => {
    const vb = use_view || view_ref.current;
    const svg = svg_ref.current;
    if (!svg) return { x: client_x, y: client_y };
    const rect = svg.getBoundingClientRect();
    const px = rect.width > 0 ? (client_x - rect.left) / rect.width : 0;
    const py = rect.height > 0 ? (client_y - rect.top) / rect.height : 0;
    return { x: vb.x + px * vb.w, y: vb.y + py * vb.h };
  };

  const zoom_at = (anchor: { x: number; y: number }, factor: number, base_view?: ViewBox) => {
    const vb = base_view || view_ref.current;
    const f = Math.max(0.12, Math.min(8, factor));
    const next_w = vb.w * f;
    const next_h = vb.h * f;
    const rx = vb.w > 0 ? (anchor.x - vb.x) / vb.w : 0.5;
    const ry = vb.h > 0 ? (anchor.y - vb.y) / vb.h : 0.5;
    const next_x = anchor.x - rx * next_w;
    const next_y = anchor.y - ry * next_h;
    set_view(clamp_view({ x: next_x, y: next_y, w: next_w, h: next_h }, bounds));
  };

  const pan_by = (dx_client: number, dy_client: number, base_view?: ViewBox) => {
    const vb = base_view || view_ref.current;
    const svg = svg_ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const pan_scale = 0.88; // +10% vs previous tuning
    const dx = rect.width > 0 ? (dx_client / rect.width) * vb.w * pan_scale : 0;
    const dy = rect.height > 0 ? (dy_client / rect.height) * vb.h * pan_scale : 0;
    set_view((prev) => clamp_view({ x: (base_view || prev).x - dx, y: (base_view || prev).y - dy, w: (base_view || prev).w, h: (base_view || prev).h }, bounds));
  };

  const rect_border_point = (cx: number, cy: number, dx: number, dy: number): { x: number; y: number } => {
    const w = bounds.node_w;
    const h = bounds.node_h;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < 1e-6 && ady < 1e-6) return { x: cx, y: cy };
    const sx = adx > 1e-6 ? (w / 2) / adx : Number.POSITIVE_INFINITY;
    const sy = ady > 1e-6 ? (h / 2) / ady : Number.POSITIVE_INFINITY;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  };

  const run_state_json = (): string =>
    JSON.stringify(
      build_run_state_doc({
        run_id,
        status: run_word,
        state: sentence,
        finished,
        now_ms,
        current_id: here,
        nodes: nodes.map((n) => ({ id: n.id, label: display_of(n, false).label, type: n.type })),
        edges,
        facts: facts_all,
        status_of,
      }),
      null,
      2,
    );

  const pop_node = pop ? node_by_id[pop.id] : undefined;

  return (
    <div className="graph_wrap">
      {banner}
      <div className="graph_corner">
        <div className="graph_corner_buttons">
          <button
            className="btn graph_corner_btn"
            type="button"
            onClick={() => set_view({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })}
            title="Recenter"
          >
            ⤢
          </button>
          <button
            className="btn graph_corner_btn"
            type="button"
            onClick={() => {
              const svg = svg_ref.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const anchor = client_to_svg(rect.left + rect.width / 2, rect.top + rect.height / 2);
              zoom_at(anchor, 0.84);
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            className="btn graph_corner_btn"
            type="button"
            onClick={() => {
              const svg = svg_ref.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const anchor = client_to_svg(rect.left + rect.width / 2, rect.top + rect.height / 2);
              zoom_at(anchor, 1.18);
            }}
            title="Zoom out"
          >
            −
          </button>
          <CopyButton
            className="btn graph_corner_btn flow_copy_state_btn"
            title="Copy run state (JSON: where the run is and what each node did)"
            label="⧉"
            copied="✓"
            failed="!"
            get_text={run_state_json}
          />
        </div>
        <PinLegend />
      </div>
      <svg
        ref={svg_ref}
        className="graph_svg"
        viewBox={view_box}
        role="group"
        aria-label="Workflow execution graph"
        onWheel={(e) => {
          e.preventDefault();
          const anchor = client_to_svg(e.clientX, e.clientY);
          const raw = typeof e.deltaY === "number" ? e.deltaY : 0;
          const mode = typeof (e as any).deltaMode === "number" ? Number((e as any).deltaMode) : 0; // 0=pixel, 1=line, 2=page
          const delta = mode === 1 ? raw * 24 : mode === 2 ? raw * 800 : raw;

          // Magnitude-aware + ~3x slower than the old fixed step.
          const speed = 0.00045 * 1.15 * 1.1;
          let factor = Math.exp(delta * speed);
          factor = Math.max(0.86, Math.min(1.16, factor));
          zoom_at(anchor, factor);
        }}
        onPointerDown={(e) => {
          (e.currentTarget as any).setPointerCapture?.(e.pointerId);
          pointers_ref.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pts = Array.from(pointers_ref.current.values());
          if (pts.length === 1) {
            gesture_ref.current = { mode: "pan", start_view: view_ref.current, start_client: { x: e.clientX, y: e.clientY }, start_dist: 0, anchor_svg: { x: 0, y: 0 } };
          } else if (pts.length >= 2) {
            down_ref.current = null;
            const a = pts[0];
            const b = pts[1];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const start_view = view_ref.current;
            gesture_ref.current = {
              mode: "pinch",
              start_view,
              start_client: mid,
              start_dist: dist,
              anchor_svg: client_to_svg(mid.x, mid.y, start_view),
            };
          }
        }}
        onPointerMove={(e) => {
          if (!pointers_ref.current.has(e.pointerId)) return;
          pointers_ref.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture_ref.current;
          if (!g) return;
          const pts = Array.from(pointers_ref.current.values());
          if (g.mode === "pan" && pts.length === 1) {
            const dx = e.clientX - g.start_client.x;
            const dy = e.clientY - g.start_client.y;
            pan_by(dx, dy, g.start_view);
          } else if (g.mode === "pinch" && pts.length >= 2) {
            const a = pts[0];
            const b = pts[1];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const factor = g.start_dist / dist;
            zoom_at(g.anchor_svg, factor, g.start_view);
          }
        }}
        onPointerUp={(e) => {
          pointers_ref.current.delete(e.pointerId);
          if (pointers_ref.current.size === 0) gesture_ref.current = null;
          // A press that did not pan is a click on the node it started on (pointer
          // capture retargets the click itself to the svg).
          const down = down_ref.current;
          down_ref.current = null;
          if (down && pointers_ref.current.size === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) toggle_pin(down.id, false);
        }}
        onPointerCancel={(e) => {
          pointers_ref.current.delete(e.pointerId);
          if (pointers_ref.current.size === 0) gesture_ref.current = null;
          down_ref.current = null;
        }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.55)" />
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {edges.map((e) => {
          const s = node_by_id[e.source];
          const t = node_by_id[e.target];
          if (!s || !t) return null;
          const sx = s.x + bounds.node_w / 2;
          const sy = s.y + bounds.node_h / 2;
          const tx = t.x + bounds.node_w / 2;
          const ty = t.y + bounds.node_h / 2;
          const dx = tx - sx;
          const dy = ty - sy;

          const start = rect_border_point(sx, sy, dx, dy);
          const end = rect_border_point(tx, ty, -dx, -dy);

          const bidirectional = e.source !== e.target && edge_pair_set.has(`${e.target}->${e.source}`);
          const len = Math.max(1, Math.hypot(dx, dy));
          const px = (-dy) / len;
          const py = dx / len;
          const sign = String(e.source) < String(e.target) ? 1 : -1;
          // For pairs, draw one "primary" straight edge + one arced return edge (clearer loop signal).
          // Choose "primary" by screen direction (forward edge), not by id ordering.
          const dominant_is_x = Math.abs(dx) >= Math.abs(dy);
          const forward = dominant_is_x ? dx >= 0 : dy >= 0;
          const primary = !bidirectional || forward;
          const base_offset_mag = Math.max(28, Math.min(72, len * 0.14));
          const offset_mag = Math.min(200, base_offset_mag * 3.5);
          const offset = bidirectional && !primary ? offset_mag * sign : 0;
          const cx = (start.x + end.x) / 2 + px * offset;
          const cy = (start.y + end.y) / 2 + py * offset;
          const d = bidirectional && !primary ? `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}` : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

          const is_visited_edge = highlight_path && visited_visible && visited_visible[e.source] !== undefined && visited_visible[e.target] !== undefined;
          return <path key={e.id} d={d} className={`graph_edge ${is_visited_edge ? "visited" : ""}`} markerEnd="url(#arrow)" fill="none" />;
        })}

        {nodes.map((n) => {
          const until = typeof recent_visible[n.id] === "number" ? recent_visible[n.id] : 0;
          const is_recent = until > now_ms;
          const is_active = active_visible && n.id === active_visible;
          const is_visited = highlight_path && visited_visible && visited_visible[n.id] !== undefined;
          const st = status_of(n.id);
          const is_here = Boolean(here) && n.id === here;
          const cls = `graph_node ${is_active ? "active" : is_recent ? "recent" : ""} ${is_visited ? "visited" : ""}${is_here ? " here" : ""}`;
          const bar_color = n.color || "rgba(255,255,255,0.16)";
          const { label, type } = display_of(n, Boolean(is_active));
          const label_clamped = clamp_text(label, 22);
          const type_clamped = clamp_text(type, 22);
          const chip = is_here ? here_text(st) : "";
          const chip_w = chip ? Math.round(chip.length * 6.2 + 14) : 0;
          const word = st === "waiting" ? wait_words(facts_all[n.id]) : STATUS_WORD[st];
          const open = pop?.id === n.id;
          return (
            <g
              key={n.id}
              ref={(el) => {
                node_els.current[n.id] = el;
              }}
              className={cls}
              transform={`translate(${n.x}, ${n.y})`}
              data-flow-node={n.id}
              data-run-status={st}
              tabIndex={0}
              role="button"
              aria-label={`${label} (${type}): ${word}${chip ? `, ${chip}` : ""}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-describedby={open ? panel_dom_id : undefined}
              onPointerDown={(e) => {
                down_ref.current = { id: n.id, x: e.clientX, y: e.clientY };
              }}
              onMouseEnter={() => {
                if (pop?.mode === "pinned") return;
                clear_hover_timer();
                if (open) return;
                hover_timer.current = window.setTimeout(() => {
                  if (!gesture_ref.current) open_pop(n.id, "hover");
                }, 150);
              }}
              onMouseLeave={() => {
                if (open && pop?.mode === "hover") hide_soon(n.id);
                else if (pop?.mode !== "pinned") clear_hover_timer();
              }}
              onFocus={() => {
                if (suppress_focus_ref.current) return;
                if (open && pop?.mode === "pinned") return;
                open_pop(n.id, "focus");
              }}
              onBlur={(e) => {
                if (open && pop?.mode === "focus" && !pop_el.current?.contains(e.relatedTarget as Node | null)) hide_soon(n.id);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                toggle_pin(n.id, true);
              }}
            >
              {st === "running" || st === "waiting" || st === "failed" || is_here ? (
                <rect className="flow_node_ring" x={-5} y={-5} width={bounds.node_w + 10} height={bounds.node_h + 10} rx={16} ry={16} />
              ) : null}
              <rect className="graph_node_bg" width={bounds.node_w} height={bounds.node_h} rx={12} ry={12} />
              <rect className="graph_node_bar" width={bounds.node_w} height={6} rx={12} ry={12} fill={bar_color} />
              <text className="graph_node_label" x={12} y={28}>
                {label_clamped}
              </text>
              <text className="graph_node_type" x={12} y={46}>
                {type_clamped}
              </text>
              {n.type === "on_schedule" ? (
                <text className="graph_node_icon" x={bounds.node_w - 18} y={18}>
                  ⏰
                </text>
              ) : null}
              {st !== "none" ? (
                <g className="flow_status_badge" transform={`translate(${bounds.node_w - 12}, 0)`} aria-hidden="true">
                  <StatusGlyph status={st} />
                </g>
              ) : null}
              {chip ? (
                <g className="flow_here_chip" transform={`translate(${bounds.node_w - 26 - chip_w}, -9)`} aria-hidden="true">
                  <rect width={chip_w} height={18} rx={9} ry={9} />
                  <text x={7} y={12.5}>
                    {chip}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      {pop && pop_node && pop_pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={pop_el}
              id={panel_dom_id}
              className="flow_facts_pop"
              role="dialog"
              aria-label={`About the node ${display_of(pop_node, pop_node.id === active_visible).label}`}
              tabIndex={-1}
              style={{ top: pop_pos.top, left: pop_pos.left, width: pop_pos.width }}
              onMouseEnter={clear_hover_timer}
              onMouseLeave={() => (pop.mode === "hover" ? hide_soon(pop.id) : undefined)}
              onBlur={(e) => {
                if (pop.mode === "focus" && !e.currentTarget.contains(e.relatedTarget as Node | null)) hide_soon(pop.id);
              }}
            >
              <NodeFactsPanel
                node={{ id: pop_node.id, ...display_of(pop_node, pop_node.id === active_visible) }}
                facts={facts_all[pop_node.id] || null}
                status={status_of(pop_node.id)}
                here={pop_node.id === here}
                finished={finished}
                on_open_run={props.on_open_run}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
