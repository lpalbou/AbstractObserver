/**
 * Runtime explorer page (ui-rethink P1 slice 3d, 2026-07-21).
 *
 * Moved VERBATIM from app.tsx: RuntimeActivityConsole (the fleet
 * attention queue) + RuntimeExplorerPage (activity / artifacts / logs /
 * memory tabs). All state stays in App — these are render components
 * over props; the fold/label helpers they use live in their own modules
 * (format, artifacts, run_labels, ledger_views, artifact_previews).
 */
import React, { useMemo, useState } from "react";

import { JsonViewer as SharedJsonViewer, Markdown, copyText } from "@abstractframework/panel-chat";
import { Icon } from "@abstractframework/ui-kit";
import { extract_tool_calls_from_wait, extract_wait_from_record } from "../lib/runtime_extractors";
import { type StepRecord, type WaitState } from "../lib/types";
import { ArtifactGlyph, RuntimeInlinePreview, type RuntimeEmbeddedPreview } from "./artifact_previews";
import {
  artifact_created_label,
  artifact_display_type_label_for,
  artifact_generation_prompt,
  artifact_human_title,
  artifact_last_seen_label,
  artifact_media_fact_label,
  artifact_node_label,
  artifact_origin_label,
  artifact_path_label,
  artifact_provenance_label,
  artifact_provider_model_label,
  artifact_semantic_label,
  artifact_turn_label,
  artifact_with_runtime_context,
  artifact_workflow_ref,
  format_bytes,
  runtime_type_filter_label,
  type RuntimeArtifact,
  type RuntimeArtifactDateFilter,
  type RuntimeArtifactGroupMode,
  type RuntimeArtifactSortMode,
  type RuntimeArtifactTypeFilter,
} from "./artifacts";
import {
  active_run_status,
  clamp_preview,
  display_datetime,
  first_string,
  format_duration_ms,
  format_time_ago,
  parse_iso_ms,
  run_duration_label,
  run_started_at,
  safe_json_inline,
  short_id,
  terminal_run_status,
} from "./format";
import {
  build_provider_activities_from_ledger,
  extract_response_text_from_record,
  format_step_summary,
  ledger_record_human_summary,
} from "./ledger_views";
import {
  RunStatusPill,
  run_activity_label,
  run_error_label,
  run_workflow_label,
  tool_risk_labels,
  wait_blocker_title,
  wait_expected_action,
  wait_request_text,
} from "./run_labels";
import { run_status_class, type RunSummary } from "./run_status";
import {
  build_runtime_activity_views,
  count_runtime_activity_queues,
  filter_runtime_activity_views,
  sort_runtime_activity_views,
  type RuntimeActivityQueue,
  type RuntimeActivitySort,
} from "./runtime_activity";

export type RuntimeTab = "activity" | "artifacts" | "logs" | "memory";
export type RuntimeLogSource = "run_ledger" | "provider_calls" | "gateway_audit";
export type RuntimeLedgerLogItem = { cursor: number; record: StepRecord };

export function RuntimeActivityConsole(props: {
  gateway_connected: boolean;
  runs: RunSummary[];
  artifacts: RuntimeArtifact[];
  selected_run_id: string;
  workflow_label_by_id: Record<string, string>;
  on_select_run: (run_id: string) => void;
  on_open_run: (run_id: string) => void;
  on_open_ledger: (run_id: string) => void;
  on_filter_artifacts: (run_id: string) => void;
  on_filter_session_artifacts: (session_id: string) => void;
  on_open_logs: () => void;
  on_refresh_runs: () => void;
  on_reconnect: () => void;
}): React.ReactElement {
  const [filter, set_filter] = useState<RuntimeActivityQueue>("attention");
  const [query, set_query] = useState("");
  const [sort, set_sort] = useState<RuntimeActivitySort>("attention");
  const [selected_id, set_selected_id] = useState("");

  const artifact_counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of props.artifacts) {
      const rid = String(a.run_id || "").trim();
      if (rid) out[rid] = (out[rid] || 0) + 1;
    }
    return out;
  }, [props.artifacts]);

  const views = useMemo(
    () => build_runtime_activity_views(props.runs as any[], { workflow_label_by_id: props.workflow_label_by_id }),
    [props.runs, props.workflow_label_by_id]
  );
  const counts = useMemo(() => count_runtime_activity_queues(views), [views]);
  const rows = useMemo(() => {
    const filtered = filter_runtime_activity_views(views, { queue: filter, query });
    return sort_runtime_activity_views(filtered, sort);
  }, [views, filter, query, sort]);

  const selected_view =
    rows.find((v) => String(v.run_id || "") === selected_id) ||
    rows.find((v) => String(v.run_id || "") === props.selected_run_id) ||
    rows[0] ||
    null;
  const selected = (selected_view?.run as RunSummary | undefined) || null;
  const selected_run_id = String(selected?.run_id || "").trim();
  const selected_session_id = String(selected?.session_id || "").trim();
  const selected_session_run_ids = useMemo(() => {
    if (!selected_session_id) return new Set<string>();
    return new Set(
      props.runs
        .filter((r) => String(r.session_id || "").trim() === selected_session_id)
        .map((r) => String(r.run_id || "").trim())
        .filter(Boolean)
    );
  }, [props.runs, selected_session_id]);
  const selected_session_runs = selected_session_id ? selected_session_run_ids.size : 0;
  const selected_session_artifacts = useMemo(() => {
    if (!selected_session_id) return 0;
    return props.artifacts.filter((a) => String(a.session_id || "").trim() === selected_session_id || selected_session_run_ids.has(String(a.run_id || "").trim())).length;
  }, [props.artifacts, selected_session_id, selected_session_run_ids]);
  const waiting = selected?.waiting && typeof selected.waiting === "object" ? (selected.waiting as any) : null;
  const selected_tool_calls = waiting ? extract_tool_calls_from_wait(waiting as WaitState) : [];
  const selected_wait_blocker = selected_view?.reason || (waiting ? wait_blocker_title(waiting as WaitState, selected_tool_calls) : "");
  const selected_wait_expected = selected_view?.expected_action || (waiting ? wait_expected_action(waiting as WaitState, selected_tool_calls) : "");
  const selected_wait_request = waiting ? wait_request_text(waiting as WaitState, null) : "";
  const selected_artifacts = selected_run_id ? artifact_counts[selected_run_id] || 0 : 0;
  const selected_terminal = terminal_run_status(selected?.status);
  const filters: Array<{ key: RuntimeActivityQueue; label: string; count: number }> = [
    { key: "attention", label: "Needs attention", count: counts.attention },
    { key: "user_wait", label: "Needs my response", count: counts.user_wait },
    { key: "tool_approval", label: "Tool approvals", count: counts.tool_approval },
    { key: "running", label: "Running", count: counts.running },
    { key: "failed", label: "Failed", count: counts.failed },
    { key: "scheduled", label: "Scheduled/subflows", count: counts.scheduled },
    { key: "finished", label: "Finished", count: counts.finished },
    { key: "all", label: "All loaded", count: counts.all },
  ];

  return (
    <div className="runtime_ops_layout">
      <aside className="pane runtime_ops_filters">
        <div className="pane_header runtime_ops_filter_header">
          <span className="pane_title">Queues</span>
          <div className="pane_spacer" />
          <button className="btn btn_icon" onClick={props.gateway_connected ? props.on_refresh_runs : props.on_reconnect}>
            <Icon name="refresh" size={14} />
            {props.gateway_connected ? "Refresh" : "Reconnect"}
          </button>
        </div>
        <div className="pane_body scroll runtime_ops_queue_list">
          {filters.map((f) => (
            <button key={f.key} className={`runtime_ops_filter ${filter === f.key ? "selected" : ""}`} aria-pressed={filter === f.key} onClick={() => set_filter(f.key)}>
              <span>{f.label}</span>
              <strong>{f.count.toLocaleString()}</strong>
            </button>
          ))}
          <div className="runtime_ops_hint">
            Counts are for the loaded runtime page. Refine search or refresh when supervising large runtimes.
          </div>
        </div>
      </aside>

      <section className="pane runtime_ops_table_panel">
        <div className="pane_header runtime_ops_list_header">
          <span className="pane_title">Runs</span>
          <span className="pane_count">{rows.length.toLocaleString()}</span>
          <div className="pane_spacer" />
          <input value={query} onChange={(e) => set_query(e.target.value)} placeholder="Search workflow, run, node, status, error" />
          <select className="seg_select" value={sort} onChange={(e) => set_sort(e.target.value as any)}>
            <option value="attention">Attention order</option>
            <option value="recent">Latest event</option>
            <option value="oldest">Oldest event</option>
            <option value="duration">Longest duration</option>
            <option value="tokens">Most tokens</option>
            <option value="workflow">Workflow</option>
          </select>
        </div>
        <div className="pane_body scroll runtime_ops_rows">
          {!rows.length ? (
            <div className="runtime_ops_empty">
              {props.gateway_connected ? "No runs match this queue." : "Gateway offline. Runtime activity cannot be loaded until the connection is restored."}
            </div>
          ) : null}
          {rows.map((view) => {
            const r = view.run as RunSummary;
            const rid = String(r.run_id || "").trim();
            const artifact_count = artifact_counts[rid] || 0;
            return (
              <div
                key={rid}
                className={`raised runtime_ops_row ${rid === selected_run_id ? "selected" : ""}`}
                aria-current={rid === selected_run_id ? "true" : undefined}
                tabIndex={0}
                onClick={() => {
                  set_selected_id(rid);
                  props.on_select_run(rid);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    set_selected_id(rid);
                    props.on_select_run(rid);
                  }
                }}
              >
                <div className="runtime_ops_row_top">
                  <strong className="runtime_ops_row_name">{run_workflow_label(r, props.workflow_label_by_id)}</strong>
                  {view.is_stale ? <span className="chip warn">stale</span> : null}
                  <RunStatusPill status={r.status} />
                </div>
                <div className="runtime_ops_row_sub">
                  <span className="mono">{short_id(rid, 18)}</span>
                  <span>{format_time_ago(r.updated_at || r.created_at)}</span>
                  <span>{run_duration_label(r)}</span>
                  <span className="runtime_ops_row_reason" title={view.reason}>{view.reason}</span>
                </div>
                <div className="runtime_ops_row_foot">
                  <span className="runtime_ops_row_facts">
                    <span>{Number(r.llm_calls || 0).toLocaleString()} llm</span>
                    <span>{Number(r.tool_calls || 0).toLocaleString()} tools</span>
                    <span>{Number(r.tokens_total || 0).toLocaleString()} tok</span>
                    <span>{artifact_count.toLocaleString()} artifacts</span>
                  </span>
                  <div className="runtime_ops_actions">
                    {view.needs_user_action ? (
                      <button className="btn primary" onClick={(e) => { e.stopPropagation(); props.on_open_run(rid); }}>{view.action_label}</button>
                    ) : (
                      <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_open_run(rid); }}>Open</button>
                    )}
                    <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_open_ledger(rid); }}>Ledger</button>
                    <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_select_run(rid); props.on_open_logs(); }}>Logs</button>
                    <button className="btn" onClick={(e) => { e.stopPropagation(); props.on_filter_artifacts(rid); }}>Artifacts</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="pane runtime_ops_inspector">
        <div className="pane_header">
          <span className="pane_title">Run inspector</span>
          {selected ? (
            <>
              <div className="pane_spacer" />
              <RunStatusPill status={selected.status} />
            </>
          ) : null}
        </div>
        <div className="pane_body scroll runtime_ops_inspector_body">
        {!selected ? (
          <div className="empty_state_inline">Select a run to inspect why it is active or blocked.</div>
        ) : (
          <>
            <div className="runtime_ops_inspector_head">
              <h3>{run_workflow_label(selected, props.workflow_label_by_id)}</h3>
              <span className="mono">{short_id(selected_run_id, 28)}</span>
            </div>
            <div className="runtime_ops_decision">
              <strong>{selected_view?.reason || run_activity_label(selected)}</strong>
              <span>
                {selected_view?.expected_action ||
                (String(selected.status || "").toLowerCase() === "waiting"
                  ? "This run is paused until the pending wait is resolved or the run is cancelled."
                  : selected_terminal
                    ? "This run is terminal. Open the ledger for the narrative and final error/output."
                    : "This run is active or recently updated. Use ledger/provider logs to inspect live work.")}
              </span>
            </div>
            <div className="artifact_detail_grid">
              <div><span>Started</span><strong>{display_datetime(run_started_at(selected))}</strong></div>
              <div><span>Elapsed</span><strong>{run_duration_label(selected)}</strong></div>
              <div><span>Last event</span><strong>{display_datetime(selected.updated_at || selected.created_at)}</strong></div>
              <div><span>Session</span><strong className="mono">{selected.session_id ? short_id(String(selected.session_id), 18) : "—"}</strong></div>
              <div><span>Node</span><strong className="mono">{selected.current_node || "—"}</strong></div>
              <div><span>Visible artifacts</span><strong>{selected_artifacts.toLocaleString()}</strong></div>
              <div><span>Provider calls</span><strong>{Number(selected.llm_calls || 0).toLocaleString()}</strong></div>
              <div><span>Tokens</span><strong>{Number(selected.tokens_total || 0).toLocaleString()}</strong></div>
            </div>
            {selected_session_id ? (
              <section className="runtime_ops_session_context">
                <div>
                  <span className="run_hero_eyebrow">Session context</span>
                  <strong className="mono">{short_id(selected_session_id, 30)}</strong>
                </div>
                <div className="runtime_ops_session_facts">
                  <span>{selected_session_runs.toLocaleString()} loaded run{selected_session_runs === 1 ? "" : "s"}</span>
                  <span>{selected_session_artifacts.toLocaleString()} visible artifact{selected_session_artifacts === 1 ? "" : "s"}</span>
                </div>
                <div className="runtime_detail_actions compact">
                  <button className="btn" onClick={() => props.on_filter_session_artifacts(selected_session_id)}>Open session artifacts</button>
                  <button className="btn" onClick={() => void copyText(selected_session_id)}>Copy session id</button>
                </div>
              </section>
            ) : null}
            {waiting ? (
              <div className="runtime_ops_wait_summary">
                <div className="runtime_ops_wait_header">
                  <span className="run_hero_eyebrow">Blocked on</span>
                  <strong>{selected_wait_blocker}</strong>
                </div>
                <p>{selected_wait_expected}</p>
                {selected_wait_request ? (
                  <div className="runtime_ops_wait_request">
                    <span>Request</span>
                    <Markdown text={selected_wait_request} />
                  </div>
                ) : (
                  <div className="runtime_ops_wait_request muted">
                    No explicit prompt is attached to this wait. Open Observe or the ledger for full run context before responding.
                  </div>
                )}
                {selected_tool_calls.length ? (
                  <div className="runtime_ops_wait_tools">
                    {selected_tool_calls.map((tc, idx) => (
                      <React.Fragment key={`${String((tc as any)?.name || "tool")}:${idx}`}>
                        <span className="chip mono warn">{String((tc as any)?.name || "tool")}</span>
                        {tool_risk_labels(tc).map((label) => (
                          <span key={`${idx}:${label}`} className="chip muted">{label}</span>
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                ) : null}
                <details className="runtime_raw_details">
                  <summary className="muted">Raw wait payload</summary>
                  <SharedJsonViewer value={waiting} collapseAfterDepth={3} showCopy={true} />
                </details>
              </div>
            ) : null}
            {run_error_label(selected) ? <div className="warn_callout">{run_error_label(selected)}</div> : null}
            <div className="runtime_detail_actions">
              <button className="btn primary" onClick={() => props.on_open_run(selected_run_id)}>Open Observe</button>
              <button className="btn" onClick={() => props.on_open_ledger(selected_run_id)}>Open ledger</button>
              <button className="btn" onClick={() => props.on_filter_artifacts(selected_run_id)}>Open artifacts</button>
              <button className="btn" onClick={props.on_open_logs}>Open logs</button>
              <button className="btn" onClick={() => void copyText(selected_run_id)}>Copy run id</button>
            </div>
          </>
        )}
        </div>
      </aside>
    </div>
  );
}

export function RuntimeExplorerPage(props: {
  gateway_connected: boolean;
  tab: RuntimeTab;
  runs: RunSummary[];
  active_runs: RunSummary[];
  all_artifacts: RuntimeArtifact[];
  artifacts: RuntimeArtifact[];
  artifact_total_count: number;
  artifact_total_bytes: number;
  artifact_facets: Record<string, Record<string, number>>;
  artifact_type_facets: Record<string, Record<string, number>>;
  artifact_page: number;
  artifact_page_size: number;
  artifact_groups: Array<{ key: string; items: RuntimeArtifact[] }>;
  selected_artifact: RuntimeArtifact | null;
  embedded_preview: RuntimeEmbeddedPreview;
  loading: boolean;
  error: string;
  query: string;
  scope: "all" | "session" | "run";
  type_filters: RuntimeArtifactTypeFilter[];
  date_filter: RuntimeArtifactDateFilter;
  group_by: RuntimeArtifactGroupMode;
  sort_by: RuntimeArtifactSortMode;
  artifact_run_filter: string;
  audit_log_text: string;
  audit_log_meta: string;
  audit_log_loading: boolean;
  audit_log_error: string;
  workflow_label_by_id: Record<string, string>;
  run_by_id: Record<string, RunSummary>;
  selected_run_id: string;
  session_id: string;
  runtime_log_source: RuntimeLogSource;
  runtime_log_query: string;
  runtime_ledger_log_items: RuntimeLedgerLogItem[];
  runtime_ledger_log_meta: string;
  runtime_ledger_log_loading: boolean;
  runtime_ledger_log_error: string;
  on_tab_change: (tab: RuntimeTab) => void;
  on_query_change: (value: string) => void;
  on_scope_change: (value: "all" | "session" | "run") => void;
  on_session_filter_change: (session_id: string) => void;
  on_type_filters_change: (value: RuntimeArtifactTypeFilter[]) => void;
  on_date_filter_change: (value: RuntimeArtifactDateFilter) => void;
  on_group_by_change: (value: RuntimeArtifactGroupMode) => void;
  on_sort_by_change: (value: RuntimeArtifactSortMode) => void;
  on_artifact_page_change: (page: number) => void;
  on_artifact_run_filter_change: (run_id: string) => void;
  on_refresh_artifacts: () => void;
  on_refresh_audit: () => void;
  on_refresh_runtime_ledger: (run_id?: string) => void;
  on_runtime_log_source_change: (value: RuntimeLogSource) => void;
  on_runtime_log_query_change: (value: string) => void;
  on_select_run: (run_id: string) => void;
  on_select_artifact: (artifact_id: string) => void;
  on_preview_artifact: (artifact: RuntimeArtifact) => void;
  on_download_artifact: (artifact: RuntimeArtifact) => void;
  on_open_run: (run_id: string) => void;
  on_open_ledger: (run_id: string) => void;
  on_refresh_runs: () => void;
  on_reconnect: () => void;
  on_open_settings: () => void;
  /* System page (redesign wave B): the knowledge-graph memory explorer
   * (the old standalone Mindmap page) lives here as a tab, not as its
   * own top-level page. It renders MEMORY assertions, not workflows —
   * the tab must never be labeled "Workflows" (adversary-caught lie). */
  memory_panel: React.ReactNode;
}): React.ReactElement {
  const selected = props.selected_artifact;
  const artifact_type_options: RuntimeArtifactTypeFilter[] = ["voice", "music", "sound", "recording", "audio", "image", "video", "markdown", "html", "json", "document", "code", "text", "other"];
  const artifact_date_options: Array<{ value: RuntimeArtifactDateFilter; label: string }> = [
    { value: "all", label: "Any time" },
    { value: "hour", label: "Last hour" },
    { value: "today", label: "Today" },
    { value: "week", label: "7 days" },
    { value: "month", label: "30 days" },
  ];
  const selected_type_filters = useMemo(() => new Set(props.type_filters), [props.type_filters]);
  const artifact_total_count = Math.max(0, Number(props.artifact_total_count || 0));
  // The header count is the FILTERED total when any artifact filter is on —
  // label it so other tabs don't read it as the system inventory.
  const artifact_filters_active =
    Boolean(props.query.trim()) || props.type_filters.length > 0 || props.date_filter !== "all" || props.scope !== "all" || Boolean(props.artifact_run_filter.trim());
  const artifact_page_size = Math.max(1, Number(props.artifact_page_size || 500));
  const artifact_total_pages = Math.max(1, Math.ceil(artifact_total_count / artifact_page_size));
  const artifact_page = Math.min(Math.max(0, Number(props.artifact_page || 0)), artifact_total_pages - 1);
  const artifact_page_start = artifact_total_count ? artifact_page * artifact_page_size + 1 : 0;
  const artifact_page_end = Math.min(artifact_total_count, artifact_page * artifact_page_size + props.artifacts.length);
  const artifact_type_counts = useMemo(() => {
    const out: Partial<Record<RuntimeArtifactTypeFilter, number>> = {};
    const facets = props.artifact_type_facets && Object.keys(props.artifact_type_facets).length ? props.artifact_type_facets : props.artifact_facets;
    const semantic_counts = facets?.semantic_kind || {};
    const render_counts = facets?.render_kind || {};
    for (const kind of artifact_type_options) {
      out[kind] = Number(semantic_counts[kind] || render_counts[kind] || 0);
    }
    out.audio = Number(semantic_counts.audio || 0);
    out.other = Number(semantic_counts.other || 0) + Number(semantic_counts.artifact || 0) + Number(semantic_counts.binary || 0) + Number(semantic_counts["(none)"] || 0);
    return out;
  }, [props.artifact_facets, props.artifact_type_facets]);
  const toggle_type_filter = (kind: RuntimeArtifactTypeFilter) => {
    const next = new Set(selected_type_filters);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    props.on_type_filters_change(Array.from(next.values()));
  };
  const run_groups = useMemo(() => {
    const groups: Record<string, RunSummary[]> = { waiting: [], running: [], failed: [], cancelled: [], completed: [], other: [] };
    for (const r of props.runs) {
      const st = String(r.status || "").trim().toLowerCase();
      if (st === "waiting") groups.waiting.push(r);
      else if (st === "running") groups.running.push(r);
      else if (st === "failed") groups.failed.push(r);
      else if (st === "cancelled") groups.cancelled.push(r);
      else if (st === "completed") groups.completed.push(r);
      else groups.other.push(r);
    }
    return groups;
  }, [props.runs]);
  const selected_run_for_artifact = selected?.run_id ? props.run_by_id[selected.run_id] || null : null;
  const run_filter_label = props.artifact_run_filter
    ? run_workflow_label(props.run_by_id[props.artifact_run_filter], props.workflow_label_by_id)
    : "";
  const artifact_filter_runs = useMemo(() => {
    const ids = new Set<string>();
    const run_counts = props.artifact_facets?.run_id || {};
    for (const rid of Object.keys(run_counts)) {
      if (rid && rid !== "(none)") ids.add(rid);
    }
    for (const a of props.artifacts) if (a.run_id) ids.add(a.run_id);
    for (const r of props.active_runs) if (r.run_id) ids.add(String(r.run_id));
    return Array.from(ids)
      .map((rid) => props.run_by_id[rid] || ({ run_id: rid, workflow_id: null, status: "", created_at: null, updated_at: null } as RunSummary))
      .sort((a, b) => {
        const active_a = active_run_status(a.status) ? 0 : 1;
        const active_b = active_run_status(b.status) ? 0 : 1;
        if (active_a !== active_b) return active_a - active_b;
        const am = parse_iso_ms(a.updated_at || a.created_at) ?? 0;
        const bm = parse_iso_ms(b.updated_at || b.created_at) ?? 0;
        return bm - am;
      })
      .slice(0, 160);
  }, [props.artifacts, props.active_runs, props.run_by_id, props.artifact_facets]);
  const set_run_artifact_filter = (rid: string) => {
    props.on_artifact_run_filter_change(rid);
    props.on_session_filter_change("");
    props.on_scope_change(rid ? "run" : "all");
  };
  const runtime_metric_label = (value: number) => (props.gateway_connected ? Math.max(0, Number(value || 0)).toLocaleString() : "—");
  const selected_runtime_run = props.selected_run_id ? props.run_by_id[props.selected_run_id] || null : null;
  const runtime_log_rows = useMemo(() => {
    const q = props.runtime_log_query.trim().toLowerCase();
    const rows = props.runtime_ledger_log_items || [];
    if (!q) return rows;
    return rows.filter((item) => {
      const rec: any = item.record || {};
      const hay = [
        item.cursor,
        rec.run_id,
        rec.node_id,
        rec.status,
        rec.effect?.type,
        rec.started_at,
        rec.ended_at,
        safe_json_inline(rec.effect?.payload ?? {}, 900),
        safe_json_inline(rec.result ?? {}, 900),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [props.runtime_ledger_log_items, props.runtime_log_query]);
  const runtime_provider_rows = useMemo(() => {
    const q = props.runtime_log_query.trim().toLowerCase();
    const rows = build_provider_activities_from_ledger(props.runtime_ledger_log_items);
    if (!q) return rows;
    return rows.filter((a) =>
      [
        a.provider,
        a.model,
        a.run_id,
        a.node_id,
        a.status,
        a.error,
        a.prompt_preview,
        a.response_preview,
        a.tokens.prompt,
        a.tokens.completion,
        a.tokens.total,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [props.runtime_ledger_log_items, props.runtime_log_query]);
  const runtime_provider_token_total = runtime_provider_rows.reduce((n, a) => n + (Number(a.tokens.total) || 0), 0);
  const runtime_provider_issue_count = runtime_provider_rows.filter((a) => a.missing_response || a.error).length;
  const audit_log_lines = useMemo(() => {
    const q = props.runtime_log_query.trim().toLowerCase();
    const lines = String(props.audit_log_text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
    return q ? lines.filter((line) => line.toLowerCase().includes(q)) : lines;
  }, [props.audit_log_text, props.runtime_log_query]);
  const runtime_log_is_run_scoped = props.runtime_log_source === "run_ledger" || props.runtime_log_source === "provider_calls";
  const runtime_log_title =
    props.runtime_log_source === "run_ledger"
      ? "Selected Run Ledger"
      : props.runtime_log_source === "provider_calls"
        ? "Provider Calls"
        : "Gateway HTTP Audit";
  const runtime_log_description =
    props.runtime_log_source === "run_ledger"
      ? "Runtime execution records for the selected workflow run."
      : props.runtime_log_source === "provider_calls"
        ? "Model/provider call records extracted from the selected run ledger."
        : "Global Gateway HTTP/audit tail. This is system activity, not artifact provenance.";

  return (
    <div className="page runtime_page">
      <section className="runtime_header">
        <div>
          <div className="run_hero_eyebrow">System</div>
          <h2>{props.tab === "activity" ? "Activity monitor" : props.tab === "artifacts" ? "Artifact explorer" : props.tab === "memory" ? "Active memory" : "Logs"}</h2>
          <div className="run_hero_meta">
            <span className={`status_pill ${props.gateway_connected ? "ok" : "warn"}`}>{props.gateway_connected ? "gateway connected" : "gateway offline"}</span>
            {props.tab === "artifacts" && props.artifact_run_filter ? (
              <span className="chip muted">
                filtered run <span className="mono">{short_id(props.artifact_run_filter, 18)}</span>
              </span>
            ) : null}
            {props.session_id ? (
              <span className="chip muted">
                session <span className="mono">{short_id(props.session_id, 18)}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="metric_grid compact runtime_header_metrics">
          <div className="metric_tile">
            <span>Waiting</span>
            <strong>{runtime_metric_label(run_groups.waiting.length)}</strong>
          </div>
          <div className="metric_tile">
            <span>Running</span>
            <strong>{runtime_metric_label(run_groups.running.length)}</strong>
          </div>
          <div className="metric_tile">
            <span>Failed</span>
            <strong>{runtime_metric_label(run_groups.failed.length)}</strong>
          </div>
          <div className="metric_tile">
            <span>Artifacts{artifact_filters_active ? " (filtered)" : ""}</span>
            <strong>{runtime_metric_label(artifact_total_count)}</strong>
          </div>
        </div>
      </section>

      <nav className="runtime_mode_tabs" role="tablist" aria-label="System sections">
        {(["activity", "artifacts", "memory", "logs"] as RuntimeTab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={props.tab === tab}
            className={`runtime_mode_tab ${props.tab === tab ? "active" : ""}`}
            onClick={() => props.on_tab_change(tab)}
          >
            <Icon name={tab === "activity" ? "history" : tab === "artifacts" ? "download" : tab === "memory" ? "agent" : "terminal"} size={14} />
            <span>{tab === "activity" ? "Activity" : tab === "artifacts" ? "Artifacts" : tab === "memory" ? "Memory" : "Logs"}</span>
          </button>
        ))}
      </nav>

      {!props.gateway_connected ? (
        <div className="runtime_offline_banner" role="status">
          <div>
            <strong>Gateway offline</strong>
            <span>Activity, artifacts, memory, and logs are unavailable until the gateway reconnects.</span>
          </div>
          <div>
            <button className="btn primary" onClick={props.on_reconnect}>Reconnect</button>
            <button className="btn" onClick={props.on_open_settings}>Settings</button>
          </div>
        </div>
      ) : null}

      {props.error ? <div className="warn_callout">{props.error}</div> : null}

      {props.tab === "activity" ? (
        <RuntimeActivityConsole
          gateway_connected={props.gateway_connected}
          runs={props.runs}
          artifacts={props.artifacts}
          selected_run_id={props.selected_run_id}
          workflow_label_by_id={props.workflow_label_by_id}
          on_select_run={props.on_select_run}
          on_open_run={props.on_open_run}
          on_open_ledger={props.on_open_ledger}
          on_refresh_runs={props.on_refresh_runs}
          on_reconnect={props.on_reconnect}
          on_open_logs={() => props.on_tab_change("logs")}
          on_filter_artifacts={(rid) => {
            set_run_artifact_filter(rid);
            props.on_select_run(rid);
            props.on_tab_change("artifacts");
          }}
          on_filter_session_artifacts={(sid) => {
            if (!sid) return;
            props.on_artifact_run_filter_change("");
            props.on_session_filter_change(sid);
            props.on_scope_change("session");
            props.on_tab_change("artifacts");
          }}
        />
      ) : null}

      {props.tab === "memory" ? (
        props.memory_panel ? (
          <div className="runtime_memory_panel">{props.memory_panel}</div>
        ) : (
          <div className="empty_state_inline">The memory explorer needs a gateway connection — sign in to browse knowledge-graph assertions.</div>
        )
      ) : null}

      {props.tab === "artifacts" ? (
        <>
          <section className="pane runtime_artifact_toolbar" aria-label="Find artifacts">
            <div className="runtime_artifact_toolbar_top">
              <label className="artifact_filter_field artifact_filter_search">
                <span>Search</span>
                <input value={props.query} onChange={(e) => props.on_query_change(e.target.value)} placeholder="title, path, hash, run, workflow, tag" />
              </label>
              <label className="artifact_filter_field">
                <span>Scope</span>
                <select
                  className="seg_select"
                  value={props.scope}
                  onChange={(e) => {
                    const next = e.target.value as "all" | "session" | "run";
                    if (next !== "run") props.on_artifact_run_filter_change("");
                    if (next === "session") props.on_session_filter_change(props.session_id);
                    else props.on_session_filter_change("");
                    props.on_scope_change(next);
                  }}
                >
                  <option value="all">All runtime</option>
                  <option value="session">This session</option>
                  <option value="run">Selected run</option>
                </select>
              </label>
              <label className="artifact_filter_field">
                <span>Group</span>
                <select className="seg_select" value={props.group_by} onChange={(e) => props.on_group_by_change(e.target.value as RuntimeArtifactGroupMode)}>
                  <option value="type">Type</option>
                  <option value="time">Date</option>
                  <option value="turn">Turn</option>
                  <option value="node">Node</option>
                  <option value="workflow">Workflow</option>
                  <option value="run">Run</option>
                  <option value="location">Location</option>
                  <option value="source">Source</option>
                </select>
              </label>
              <label className="artifact_filter_field">
                <span>Sort</span>
                <select className="seg_select" value={props.sort_by} onChange={(e) => props.on_sort_by_change(e.target.value as RuntimeArtifactSortMode)}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="last_access">Last accessed</option>
                  <option value="turn">Turn order</option>
                  <option value="type">Type</option>
                  <option value="size_desc">Largest</option>
                  <option value="size_asc">Smallest</option>
                </select>
              </label>
              <button className="btn btn_icon" onClick={props.on_refresh_artifacts} disabled={!props.gateway_connected || props.loading}>
                <Icon name="refresh" size={14} />
                {props.loading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="artifact_filter_section">
              <div className="artifact_filter_label">Type <span className="muted">OR</span></div>
              <div className="artifact_filter_chips" role="group" aria-label="Artifact type filters combine with OR">
                {artifact_type_options.map((kind) => {
                  const active = selected_type_filters.has(kind);
                  const count = artifact_type_counts[kind] || 0;
                  const label = runtime_type_filter_label(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${active ? "Remove" : "Add"} ${label} artifact type filter. Type filters combine with OR.`}
                      title={`${active ? "Remove" : "Add"} ${label}. Type filters combine with OR.`}
                      className={`artifact_filter_chip ${active ? "active" : ""}`}
                      onClick={() => toggle_type_filter(kind)}
                    >
                      <span>{label}</span>
                      <span className="artifact_chip_count">{props.gateway_connected ? count.toLocaleString() : "—"}</span>
                    </button>
                  );
                })}
                {props.type_filters.length ? <button type="button" className="artifact_filter_chip clear" onClick={() => props.on_type_filters_change([])}>Clear types</button> : null}
              </div>
            </div>
            <div className="artifact_filter_section">
              <div className="artifact_filter_label">Date</div>
              <div className="artifact_filter_chips" role="group" aria-label="Artifact date filters">
                {artifact_date_options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={props.date_filter === opt.value}
                    className={`artifact_filter_chip ${props.date_filter === opt.value ? "active" : ""}`}
                    onClick={() => props.on_date_filter_change(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <div className="artifact_scope_banner">
            {props.artifact_run_filter ? (
              <>
                Showing artifacts for <strong>{run_filter_label || short_id(props.artifact_run_filter, 18)}</strong>.
                <button className="btn" onClick={() => set_run_artifact_filter("")}>Show all</button>
              </>
            ) : (
              <>Showing artifacts across the selected runtime scope. Select a run to filter the inventory. {props.artifact_total_bytes ? <span className="mono muted">Total size {format_bytes(props.artifact_total_bytes)}</span> : null}</>
            )}
          </div>
          <div className="runtime_artifacts_layout">
            <aside className="pane artifact_filter_rail">
              <div className="pane_header">
                <span className="pane_title">Runs</span>
                <span className="pane_count">{artifact_filter_runs.length.toLocaleString()}</span>
              </div>
              <div className="pane_body scroll artifact_filter_rail_list">
                <button className={`artifact_filter_run ${!props.artifact_run_filter ? "selected" : ""}`} onClick={() => set_run_artifact_filter("")}>
                  <strong>All artifacts</strong>
                  <span>{props.gateway_connected ? `${artifact_total_count.toLocaleString()} match${artifact_total_count === 1 ? "" : "es"}` : "counts unavailable"}</span>
                </button>
                {artifact_filter_runs.map((r) => {
                  const rid = String(r.run_id || "").trim();
                  const highlighted = rid === props.artifact_run_filter || rid === selected?.run_id;
                  return (
                    <button key={rid} className={`artifact_filter_run ${highlighted ? "selected" : ""}`} onClick={() => set_run_artifact_filter(rid)} title={rid}>
                      <strong>{run_workflow_label(r, props.workflow_label_by_id)}</strong>
                      <span className="mono">{short_id(rid, 15)}</span>
                      <span>{run_duration_label(r)}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
            <section className="pane runtime_artifact_browser">
          <div className="pane_header artifact_browser_header">
            <span className="pane_title">Artifacts</span>
            <span className="pane_count">
              {artifact_total_count
                ? `${artifact_page_start.toLocaleString()}-${artifact_page_end.toLocaleString()} of ${artifact_total_count.toLocaleString()}`
                : "0 items"}
            </span>
            <div className="pane_spacer" />
            {artifact_total_pages > 1 ? (
              <div className="artifact_pagination" aria-label="Artifact pages">
                <button className="btn" onClick={() => props.on_artifact_page_change(0)} disabled={artifact_page <= 0}>First</button>
                <button className="btn" onClick={() => props.on_artifact_page_change(artifact_page - 1)} disabled={artifact_page <= 0}>Prev</button>
                <span className="muted artifact_page_label">Page {(artifact_page + 1).toLocaleString()} / {artifact_total_pages.toLocaleString()}</span>
                <button className="btn" onClick={() => props.on_artifact_page_change(artifact_page + 1)} disabled={artifact_page >= artifact_total_pages - 1}>Next</button>
                <button className="btn" onClick={() => props.on_artifact_page_change(artifact_total_pages - 1)} disabled={artifact_page >= artifact_total_pages - 1}>Last</button>
              </div>
            ) : null}
          </div>
          <div className="pane_body scroll artifact_browser_body">
          {!props.artifact_groups.length ? (
            <div className="empty_state_inline">
              {props.gateway_connected ? "No artifacts match the current filters." : "Gateway offline. Artifact inventory cannot be loaded until the connection is restored."}
            </div>
          ) : null}
          <div className="artifact_group_list">
            {props.artifact_groups.map((group) => (
              <section key={group.key} className="artifact_group">
                <div className="artifact_group_header">
                  <span>{group.key}</span>
                  <span className="artifact_group_count">{group.items.length}</span>
                </div>
                {group.items.map((a) => {
	                  const row_run = a.run_id ? props.run_by_id[a.run_id] || null : null;
	                  const workflow_label = row_run ? run_workflow_label(row_run, props.workflow_label_by_id) : artifact_workflow_ref(a);
	                  const media_fact = artifact_media_fact_label(a);
	                  const access_count = Number(a.access?.access_count || 0) || 0;
	                  return (
                    <button
                      key={a.artifact_id}
                      className={`artifact_row ${selected?.artifact_id === a.artifact_id ? "selected" : ""}`}
                      onClick={() => {
                        props.on_select_artifact(a.artifact_id);
                        if (a.run_id) props.on_select_run(a.run_id);
                      }}
                      title={a.artifact_id}
                    >
                      <ArtifactGlyph artifact={a} size={18} />
                      <div className="artifact_row_main">
	                        <div className="artifact_row_title">
	                          <strong>{artifact_human_title(artifact_with_runtime_context(a, props.run_by_id, props.workflow_label_by_id))}</strong>
	                          <span className="artifact_type_badge">{artifact_semantic_label(a)}</span>
	                          {a.render_kind && a.render_kind !== a.semantic_kind ? <span className="artifact_type_badge muted">{a.render_kind}</span> : null}
	                          {a.legacy_inferred ? <span className="artifact_type_badge inferred">legacy inferred</span> : null}
	                        </div>
	                        <div className="artifact_row_facts">
	                          <span><b>Created</b> {artifact_created_label(a)}</span>
	                          <span><b>Size</b> {format_bytes(a.size_bytes)}</span>
	                          <span><b>Last seen</b> {artifact_last_seen_label(a)}</span>
	                          {access_count ? <span><b>Accesses</b> {access_count.toLocaleString()}</span> : null}
	                          {media_fact ? <span><b>Media</b> {media_fact}</span> : null}
	                          {a.content_type ? <span><b>MIME</b> {a.content_type}</span> : null}
                        </div>
                        <div className="artifact_row_facts secondary">
                          {workflow_label ? <span><b>Workflow</b> {workflow_label}</span> : null}
                          {a.run_id ? <span className="mono"><b>Run</b> {short_id(a.run_id, 13)}</span> : null}
                          <span><b>Turn</b> {artifact_turn_label(a)}</span>
                          {artifact_node_label(a) ? <span className="mono"><b>Node</b> {artifact_node_label(a)}</span> : null}
                          {artifact_origin_label(a) ? <span><b>Source</b> {artifact_origin_label(a)}</span> : null}
                        </div>
                        <div className="artifact_row_facts tertiary">
                          <span className="mono"><b>ID</b> {short_id(a.artifact_id, 22)}</span>
                          <span><b>Provenance</b> {artifact_provenance_label(a)}</span>
                        </div>
                        {artifact_path_label(a) ? <div className="artifact_row_path mono">{artifact_path_label(a)}</div> : null}
                      </div>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          </div>
            </section>

            <aside className="runtime_detail">
              <section className="overview_panel runtime_artifact_detail">
            <div className="overview_panel_header">
              <h3>Artifact Detail</h3>
              {selected ? <span className="chip mono muted">{props.embedded_preview.render_kind ? artifact_display_type_label_for(selected, props.run_by_id, props.workflow_label_by_id, props.embedded_preview.text) : artifact_display_type_label_for(selected, props.run_by_id, props.workflow_label_by_id)}</span> : null}
            </div>
            {!selected ? (
              <div className="empty_state_inline">Select an artifact to inspect metadata, preview, or download content.</div>
            ) : (
              <>
                {(() => {
                  const prompt = artifact_generation_prompt(selected);
                  const provider_model = artifact_provider_model_label(selected);
                  const media_fact = artifact_media_fact_label(selected);
                  const access_count = Number(selected.access?.access_count || 0) || 0;
                  const provider_trace_link = first_string(selected.links?.provider_trace, selected.links?.provider_trace_url, selected.links?.provider_trace_id);
                  const audit_link = first_string(selected.links?.audit, selected.links?.audit_tail, selected.links?.audit_url);
                  return (
                    <>
                <div className="artifact_detail_header">
                  <ArtifactGlyph artifact={selected} size={22} />
                  <div>
                    <div className="artifact_detail_title">{artifact_human_title(artifact_with_runtime_context(selected, props.run_by_id, props.workflow_label_by_id))}</div>
                    <div className="artifact_detail_subtitle">
                      {artifact_semantic_label(selected)} • {selected.render_kind || props.embedded_preview.render_kind || selected.modality || "artifact"} • {selected.content_type || "unknown MIME"} • {format_bytes(selected.size_bytes)}
                      {selected.legacy_inferred ? " • legacy inferred" : ""}
                    </div>
                  </div>
                </div>
                <RuntimeInlinePreview artifact={selected} preview={props.embedded_preview} />
                <div className="artifact_detail_grid">
                  <div><span>Semantic type</span><strong>{artifact_semantic_label(selected)}</strong></div>
                  <div><span>Render kind</span><strong>{selected.render_kind || props.embedded_preview.render_kind || "—"}</strong></div>
                  <div><span>Created</span><strong>{display_datetime(selected.created_at)}</strong></div>
                  <div><span>Size</span><strong>{format_bytes(selected.size_bytes)}</strong></div>
                  <div><span>Last seen</span><strong>{artifact_last_seen_label(selected)}</strong></div>
                  <div><span>Accesses</span><strong>{access_count ? access_count.toLocaleString() : "—"}</strong></div>
                  <div><span>Run</span><strong className="mono">{selected.run_id ? short_id(selected.run_id, 24) : "—"}</strong></div>
                  <div><span>Workflow</span><strong>{selected_run_for_artifact ? run_workflow_label(selected_run_for_artifact, props.workflow_label_by_id) : "—"}</strong></div>
                  <div><span>Turn</span><strong>{artifact_turn_label(selected)}</strong></div>
                  <div><span>Node</span><strong className="mono">{artifact_node_label(selected) || "—"}</strong></div>
                  <div><span>Provider/model</span><strong>{provider_model || "—"}</strong></div>
                  <div><span>Media facts</span><strong>{media_fact || "—"}</strong></div>
                  <div><span>Trace</span><strong>{selected.provider_trace_available ? "available" : "not recorded"}</strong></div>
                  <div><span>Provenance</span><strong>{artifact_provenance_label(selected)}</strong></div>
                  <div><span>Artifact id</span><strong className="mono">{short_id(selected.artifact_id, 30)}</strong></div>
                  {selected.sha256 ? <div><span>sha256</span><strong className="mono">{short_id(selected.sha256, 30)}</strong></div> : null}
                </div>
                {prompt ? (
                  <div className="artifact_provenance_panel">
                    <div className="artifact_filter_label">Generation prompt / input</div>
                    <div className="artifact_prompt_text">{prompt}</div>
                  </div>
                ) : (
                  <div className="artifact_provenance_panel muted">
                    <div className="artifact_filter_label">Generation prompt / input</div>
                    <div className="artifact_prompt_text">Generation prompt not recorded by the runtime artifact descriptor.</div>
                  </div>
                )}
                {Object.keys(selected.generation || {}).length || Object.keys(selected.producer || {}).length ? (
                  <details className="runtime_raw_details">
                    <summary className="mono muted">Generation and producer metadata</summary>
                    <SharedJsonViewer value={{ generation: selected.generation, producer: selected.producer, source_refs: selected.source_refs }} collapseAfterDepth={3} showCopy={true} />
                  </details>
                ) : null}
                {selected.source_path ? <div className="artifact_detail_path mono">{selected.source_path}</div> : null}
                <div className="runtime_detail_actions">
                  <button className="btn primary" onClick={() => props.on_preview_artifact(selected)} disabled={!selected.run_id}>
                    {props.embedded_preview.render_kind === "html" ? "Open as web page" : "Open full preview"}
                  </button>
                  <button className="btn" onClick={() => props.on_download_artifact(selected)} disabled={!selected.run_id}>
                    Download
                  </button>
                  <button className="btn" onClick={() => set_run_artifact_filter(selected.run_id)} disabled={!selected.run_id}>
                    Show run artifacts
                  </button>
                  <button className="btn" onClick={() => props.on_open_run(selected.run_id)} disabled={!selected.run_id}>
                    Open in Observe
                  </button>
                  <button className="btn" onClick={() => props.on_open_ledger(selected.run_id)} disabled={!selected.run_id}>
                    Open run ledger
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (provider_trace_link) window.open(provider_trace_link, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!provider_trace_link}
                  >
                    Open provider trace
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (audit_link) window.open(audit_link, "_blank", "noopener,noreferrer");
                      else props.on_tab_change("logs");
                    }}
                    disabled={!audit_link && !selected.audit_available}
                  >
                    Open audit trail
                  </button>
                  <button className="btn" onClick={() => void copyText(selected.artifact_id)} disabled={!selected.artifact_id}>
                    Copy artifact id
                  </button>
                </div>
                    </>
                  );
                })()}
                <details className="runtime_raw_details">
                  <summary className="mono muted">Raw metadata</summary>
                  <SharedJsonViewer value={selected.raw} collapseAfterDepth={3} showCopy={true} />
                </details>
              </>
            )}
              </section>
            </aside>
          </div>
        </>
      ) : null}

	      {props.tab === "logs" ? (
	        <section className="overview_panel runtime_logs_panel">
	          <div className="overview_panel_header">
	            <div>
	              <h3>{runtime_log_title}</h3>
	              <div className="mono muted">{runtime_log_description}</div>
	            </div>
	            <div className="actions" style={{ marginTop: 0 }}>
	              {runtime_log_is_run_scoped && props.runtime_ledger_log_meta ? <span className="mono muted">{props.runtime_ledger_log_meta}</span> : null}
	              {props.runtime_log_source === "gateway_audit" && props.audit_log_meta ? <span className="mono muted">{props.audit_log_meta}</span> : null}
	              <button
	                className="btn btn_icon"
	                onClick={() => {
	                  if (runtime_log_is_run_scoped) props.on_refresh_runtime_ledger(props.selected_run_id);
	                  else props.on_refresh_audit();
	                }}
	                disabled={runtime_log_is_run_scoped ? props.runtime_ledger_log_loading : props.audit_log_loading}
	              >
	                <Icon name="refresh" size={14} />
	                {runtime_log_is_run_scoped ? (props.runtime_ledger_log_loading ? "Loading…" : "Refresh") : props.audit_log_loading ? "Loading…" : "Refresh"}
	              </button>
	            </div>
	          </div>
          <div className="runtime_log_toolbar">
            <div className="seg_toggle mono">
	              <button className={`seg_btn ${props.runtime_log_source === "run_ledger" ? "active" : ""}`} onClick={() => props.on_runtime_log_source_change("run_ledger")}>
	                Run ledger
	              </button>
	              <button className={`seg_btn ${props.runtime_log_source === "provider_calls" ? "active" : ""}`} onClick={() => props.on_runtime_log_source_change("provider_calls")}>
	                Provider calls
	              </button>
	              <button className={`seg_btn ${props.runtime_log_source === "gateway_audit" ? "active" : ""}`} onClick={() => props.on_runtime_log_source_change("gateway_audit")}>
	                Gateway audit
	              </button>
            </div>
            <input
              className="mono"
              value={props.runtime_log_query}
              onChange={(e) => props.on_runtime_log_query_change(e.target.value)}
              placeholder="Search node, status, effect, payload, error"
            />
          </div>

	          {props.runtime_log_source === "run_ledger" ? (
	            <>
	              <div className="runtime_log_context">
	                <div>
                  <span>Selected run</span>
                  <strong>{selected_runtime_run ? run_workflow_label(selected_runtime_run, props.workflow_label_by_id) : props.selected_run_id ? short_id(props.selected_run_id, 24) : "No run selected"}</strong>
                  {props.selected_run_id ? <em className="mono">{short_id(props.selected_run_id, 34)}</em> : null}
                </div>
                <div>
                  <span>Session</span>
                  <strong className="mono">{selected_runtime_run?.session_id ? short_id(String(selected_runtime_run.session_id), 28) : props.session_id ? short_id(props.session_id, 28) : "—"}</strong>
                </div>
                <div className="runtime_log_context_actions">
                  <button className="btn" onClick={() => props.on_open_run(props.selected_run_id)} disabled={!props.selected_run_id}>Open Observe</button>
                  <button className="btn" onClick={() => set_run_artifact_filter(props.selected_run_id)} disabled={!props.selected_run_id}>Run artifacts</button>
                </div>
              </div>
              {props.runtime_ledger_log_error ? <div className="warn_callout">{props.runtime_ledger_log_error}</div> : null}
              {!props.selected_run_id ? <div className="empty_state_inline">Select a run in Activity or Artifact Explorer to inspect its runtime ledger.</div> : null}
              {props.selected_run_id && !runtime_log_rows.length && !props.runtime_ledger_log_loading ? <div className="empty_state_inline">No ledger records match the current search.</div> : null}
              <div className="runtime_log_event_list" aria-label="Selected run ledger records">
                {runtime_log_rows.map((item) => {
                  const rec: any = item.record || {};
                  const effect_type = String(rec?.effect?.type || "").trim();
                  const status = String(rec?.status || "").trim();
	                  const node_id = String(rec?.node_id || "").trim();
	                  const ts = first_string(rec?.ended_at, rec?.started_at, rec?.ts);
	                  const wait = extract_wait_from_record(rec);
	                  const human_summary = ledger_record_human_summary(rec);
	                  const payload_preview = effect_type ? clamp_preview(safe_json_inline(rec?.effect?.payload ?? {}, 1200), { max_chars: 1200, max_lines: 6 }) : "";
	                  const outcome =
	                    extract_response_text_from_record(rec) ||
	                    (wait ? `Waiting for ${String(wait.reason || "input")}` : "") ||
                    (rec?.result !== undefined ? safe_json_inline(rec.result, 700) : "");
                  return (
                    <article key={`${props.selected_run_id}:${item.cursor}`} className={`runtime_log_event ${run_status_class(status)}`}>
                      <div className="runtime_log_event_header">
                        <span className="mono">#{item.cursor}</span>
                        <RunStatusPill status={status || "record"} />
                        {effect_type ? <span className="chip mono muted">{effect_type}</span> : null}
                        {node_id ? <strong className="mono">{node_id}</strong> : null}
                        {ts ? <span className="mono muted">{display_datetime(ts)}</span> : null}
                      </div>
	                      <div className="runtime_log_event_body">
	                        <div>
	                          <span>Request / activity</span>
	                          <p>{[human_summary || format_step_summary(rec as StepRecord), payload_preview && payload_preview !== "{}" ? payload_preview : ""].filter(Boolean).join("\n")}</p>
	                        </div>
                        <div>
                          <span>Outcome</span>
                          <p>{clamp_preview(outcome || "—", { max_chars: 1200, max_lines: 6 })}</p>
                        </div>
                      </div>
                      <details className="runtime_raw_details">
                        <summary className="mono muted">Raw ledger record</summary>
                        <SharedJsonViewer value={rec} collapseAfterDepth={3} showCopy={true} />
                      </details>
                    </article>
                  );
	                })}
	              </div>
	            </>
	          ) : props.runtime_log_source === "provider_calls" ? (
	            <>
	              <div className="runtime_log_context">
	                <div>
	                  <span>Selected run</span>
	                  <strong>{selected_runtime_run ? run_workflow_label(selected_runtime_run, props.workflow_label_by_id) : props.selected_run_id ? short_id(props.selected_run_id, 24) : "No run selected"}</strong>
	                  {props.selected_run_id ? <em className="mono">{short_id(props.selected_run_id, 34)}</em> : null}
	                </div>
	                <div>
	                  <span>Provider calls</span>
	                  <strong>{runtime_provider_rows.length.toLocaleString()}</strong>
	                  <em className="mono">{runtime_provider_token_total ? `${runtime_provider_token_total.toLocaleString()} tokens` : "tokens not recorded"}</em>
	                </div>
	                <div>
	                  <span>Issues</span>
	                  <strong>{runtime_provider_issue_count.toLocaleString()}</strong>
	                </div>
	                <div className="runtime_log_context_actions">
	                  <button className="btn" onClick={() => props.on_open_run(props.selected_run_id)} disabled={!props.selected_run_id}>Open Observe</button>
	                  <button className="btn" onClick={() => props.on_runtime_log_source_change("run_ledger")} disabled={!props.selected_run_id}>Run ledger</button>
	                </div>
	              </div>
	              {props.runtime_ledger_log_error ? <div className="warn_callout">{props.runtime_ledger_log_error}</div> : null}
	              {!props.selected_run_id ? <div className="empty_state_inline">Select a run in Activity or Artifact Explorer to inspect provider calls.</div> : null}
	              {props.selected_run_id && !runtime_provider_rows.length && !props.runtime_ledger_log_loading ? (
	                <div className="empty_state_inline">No provider calls are present in the selected run ledger, or none match the current search.</div>
	              ) : null}
	              <div className="provider_activity_list runtime_provider_log_list">
	                {runtime_provider_rows.map((a) => (
	                  <article key={a.id} className={`provider_activity ${a.error || a.missing_response ? "danger" : ""}`}>
	                    <div className="provider_activity_header">
	                      <div>
	                        <h4>{[a.provider || "provider unknown", a.model || "model unknown"].join(" / ")}</h4>
	                        <div className="timeline_subtitle">
	                          {a.node_id ? <span className="mono">{a.node_id}</span> : null}
	                          {a.run_id ? <span className="mono">{short_id(a.run_id, 16)}</span> : null}
	                          <span>{format_duration_ms(a.duration_ms)}</span>
	                          {a.status ? <RunStatusPill status={a.status} /> : null}
	                        </div>
	                      </div>
	                      <div className="provider_tokens mono">
	                        {a.tokens.total ? a.tokens.total.toLocaleString() : "—"} tokens
	                      </div>
	                    </div>
	                    <div className="provider_preview_grid">
	                      <div>
	                        <span>Prompt / messages</span>
	                        <p>{a.prompt_preview || "No prompt payload captured"}</p>
	                      </div>
	                      <div>
	                        <span>Response / error</span>
	                        <p>{a.response_preview || a.error || "No response captured"}</p>
	                      </div>
	                    </div>
	                    <details className="runtime_raw_details">
	                      <summary className="mono muted">Raw provider ledger record</summary>
	                      <SharedJsonViewer value={a.raw} collapseAfterDepth={3} showCopy={true} />
	                    </details>
	                  </article>
	                ))}
	              </div>
	            </>
	          ) : (
            <>
              {props.audit_log_error ? <div className="warn_callout">{props.audit_log_error}</div> : null}
              <pre className="mono audit_log_tail">{audit_log_lines.length ? audit_log_lines.join("\n") : "(audit tail not loaded or no lines match search)"}</pre>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

