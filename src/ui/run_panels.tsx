/**
 * Run workspace panels (ui-rethink P1 slice 4a, 2026-07-22).
 *
 * Moved VERBATIM from app.tsx: the run-detail satellite components —
 * AskForm (wait response), WorkflowRunNavigator (the grouped run list),
 * RunOverviewPanel (the Story hero, with its internal FolderGlyph and
 * HumanTimelinePanel chronology), and LedgerCard (the observe transcript
 * step card). All render over props; every fold/label they use lives in
 * the extracted modules.
 */
import React, { useState } from "react";

import { type LedgerRecordItem } from "@abstractframework/monitor-flow";
import { JsonViewer as SharedJsonViewer, Markdown } from "@abstractframework/panel-chat";
import { Icon } from "@abstractframework/ui-kit";
import { extract_wait_from_record } from "../lib/runtime_extractors";
import { type WaitState } from "../lib/types";
import {
  active_run_status,
  clamp_preview,
  display_datetime,
  format_duration_ms,
  format_time_ago,
  parse_iso_ms,
  run_duration_label,
  run_finished_at,
  run_started_at,
  safe_json_inline,
  short_id,
  terminal_run_status,
} from "./format";
import { extract_response_text_from_record, type LatestRunSummary, type ProviderActivity, type UiLogItem } from "./ledger_views";
import { RunStatusPill, run_error_label, run_workflow_label } from "./run_labels";
import { run_status_class, run_status_word, type RunFilterMode, type RunSummary, type RunTreeSection } from "./run_status";

/* Story → Chronology renders this many newest steps until expanded. */
const CHRONOLOGY_PREVIEW_COUNT = 30;

export function AskForm(props: { wait: WaitState; disabled?: boolean; on_submit: (value: string) => void }): React.ReactElement {
  const [value, set_value] = useState("");
  const choices = Array.isArray(props.wait.choices) ? props.wait.choices : [];
  const allow_free_text = props.wait.allow_free_text !== false;
  const disabled = props.disabled === true;
  const prompt = String(props.wait.prompt || "").trim();

  return (
    <>
      {choices.length ? (
        <div className="field">
          <label>Expected response</label>
          <select className="mono" value={value} onChange={(e) => set_value(e.target.value)}>
            <option value="">(select)</option>
            {choices.map((c, idx) => (
              <option key={idx} value={String(c)}>
                {String(c)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {allow_free_text ? (
        <div className="field">
          <label>{choices.length ? "Or type a response" : prompt ? "Your answer" : "Response to resume this wait"}</label>
          <textarea
            className="mono wait_response_input"
            value={value}
            onChange={(e) => set_value(e.target.value)}
            placeholder={prompt ? "Type your answer to the request above…" : "Type the response the workflow is waiting for…"}
            rows={4}
          />
        </div>
      ) : null}

      <div className="actions">
        <button className="btn primary" disabled={disabled || !value.trim()} onClick={() => props.on_submit(value.trim())}>
          Submit response
        </button>
      </div>
    </>
  );
}

export function WorkflowRunNavigator(props: {
  sections: RunTreeSection[];
  selected_run_id: string;
  root_run_id: string;
  search: string;
  filter: RunFilterMode;
  group_by: "status" | "workflow" | "session";
  loading: boolean;
  connected: boolean;
  on_sign_in: () => void;
  total_runs: number;
  workflow_label_by_id: Record<string, string>;
  on_search: (value: string) => void;
  on_filter: (value: RunFilterMode) => void;
  on_group_by: (value: "status" | "workflow" | "session") => void;
  on_refresh: () => void;
  on_select: (run_id: string, root_run_id?: string) => void;
}): React.ReactElement {
  const selected = props.selected_run_id.trim();
  const root_selected = props.root_run_id.trim() || selected;
  const active_count = props.sections.reduce(
    (count, section) =>
      count +
      section.rows.reduce((inner, row) => {
        const rows = [row.run, ...row.children];
        return inner + rows.filter((r) => active_run_status(r.status)).length;
      }, 0),
    0
  );

  return (
    <aside className="observatory_sidebar pane">
      <div className="run_nav_header pane_header">
        <span className="pane_title">Runs</span>
        <span className="pane_count">
          {props.total_runs.toLocaleString()} runs • {active_count.toLocaleString()} active
        </span>
        <span className="pane_spacer" />
        <button className="btn btn_icon" onClick={props.on_refresh} disabled={props.loading} title="Refresh workflow runs">
          <Icon name="refresh" size={14} />
          {props.loading ? "…" : ""}
        </button>
      </div>

      <div className="run_nav_controls">
        <input
          value={props.search}
          onChange={(e) => props.on_search(e.target.value)}
          placeholder="Search runs, sessions, workflows"
        />
        <div className="run_nav_filter_row">
          <div className="seg_toggle run_nav_segments">
            {(["active", "waiting", "terminal", "failed", "all"] as RunFilterMode[]).map((mode) => (
              <button key={mode} className={`seg_btn ${props.filter === mode ? "active" : ""}`} onClick={() => props.on_filter(mode)}>
                {mode}
              </button>
            ))}
          </div>
          <select
            className="seg_select"
            value={props.group_by}
            onChange={(e) => props.on_group_by(e.target.value as "status" | "workflow" | "session")}
            title="Group workflow runs"
          >
            <option value="status">Group by status</option>
            <option value="workflow">Group by workflow</option>
            <option value="session">Group by session</option>
          </select>
        </div>
      </div>

      <div className="run_tree">
        {!props.sections.length ? (
          props.connected ? (
            <div className="run_tree_empty">No runs match the current filters.</div>
          ) : (
            <div className="run_tree_empty">
              Gateway offline — runs are unavailable.{" "}
              <button className="btn btn_sm" onClick={props.on_sign_in}>Sign in</button>
            </div>
          )
        ) : null}
        {props.sections.map((section) => (
          <section key={section.key} className="run_tree_section">
            <div className="run_tree_section_header">
              <span>{section.label}</span>
              <span className="mono">{section.rows.length}</span>
            </div>
            {section.rows.map((row) => {
              const root = row.run;
              const root_id = String(root.run_id || "").trim();
              const root_selected_here = root_id === selected;
              return (
                <div key={root_id} className="run_tree_group">
                  <button
                    className={`run_tree_item ${root_selected_here ? "selected" : ""} ${root_id === root_selected ? "root_context" : ""}`}
                    onClick={() => props.on_select(root_id, root_id)}
                    title={root_id}
                  >
                    <div className="run_tree_item_top">
                      <span className="run_tree_label">{run_workflow_label(root, props.workflow_label_by_id)}</span>
                      <RunStatusPill status={run_status_word(root)} />
                    </div>
                    <div className="run_tree_meta">
                      <span className="mono">{short_id(root_id, 13)}</span>
                      <span>{run_started_at(root) ? format_time_ago(run_started_at(root)) : "no start"}</span>
                      <span>{run_duration_label(root)}</span>
                    </div>
                  </button>
                  {row.children.length ? (
                    <div className="run_tree_children">
                      {row.children.map((child) => {
                        const child_id = String(child.run_id || "").trim();
                        return (
                          <button
                            key={child_id}
                            className={`run_tree_item run_tree_child ${child_id === selected ? "selected" : ""}`}
                            onClick={() => props.on_select(child_id, root_id)}
                            title={child_id}
                          >
                            <div className="run_tree_item_top">
                              <span className="run_tree_label">{run_workflow_label(child, props.workflow_label_by_id)}</span>
                              <RunStatusPill status={run_status_word(child)} />
                            </div>
                            <div className="run_tree_meta">
                              <span className="mono">{short_id(child_id, 13)}</span>
                              <span>{run_started_at(child) ? format_time_ago(run_started_at(child)) : "child"}</span>
                              <span>{run_duration_label(child)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

/** Folder glyph — the kit icon set has no folder yet (asked of uic);
 * local SVG keeps the button honest instead of borrowing a wrong glyph. */
function FolderGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function RunOverviewPanel(props: {
  run_id: string;
  run: RunSummary | null;
  run_state: any;
  status_label: string;
  workflow_label_by_id: Record<string, string>;
  root_run_id: string;
  subrun_ids: string[];
  session_id: string;
  records_count: number;
  records: Array<{ record: any }>;
  child_records_count: number;
  provider_activities: ProviderActivity[];
  attachments_count: number;
  latest_summary: LatestRunSummary | null;
  wait_state: WaitState | null;
  summary_generating: boolean;
  summary_error: string;
  on_generate_summary: () => void;
  on_open_runtime: () => void;
  on_open_subrun: (run_id: string) => void;
  /** Reopens the wait-context modal (clears the dismissal) — the Story's
   * way back into "review & answer" for a user wait. */
  on_answer_wait?: () => void;
  /* Workspace + durable artifacts (operator 2026-07-15). */
  workspace_root: string;
  on_reveal_workspace: () => void;
  run_artifacts: any[];
  run_artifacts_loading: boolean;
  run_artifacts_error: string;
  on_preview_run_artifact: (a: any) => void;
  on_download_run_artifact: (a: any) => void;
  /* STORY additions (redesign: Observe's nine tabs → four): the run's
   * human chronology and its produced artifacts live IN the story —
   * they were separate tabs re-rendering the same truth. */
  timeline_items: LedgerRecordItem[];
  node_index: Record<string, any>;
  attachments: any[];
  attachments_loading: boolean;
  attachments_error: string;
  /* Preview/Download need the attachment store's run id resolved; until
   * then the buttons disable instead of silently no-oping. */
  attachments_ready: boolean;
  on_refresh_attachments: () => void;
  on_preview_attachment: (a: any) => void;
  on_download_attachment: (a: any) => void;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const run_id = props.run_id.trim();
  // Chronology renders the newest slice by default (see the section note).
  const [chronology_expanded, set_chronology_expanded] = useState(false);

  // NO-RUN EMPTY STATE (fable5 layout P1-13): the old render showed a hero
  // titled "(workflow unknown)" over eight "—" tiles — it read as a broken
  // run, not an empty view.
  if (!run_id) {
    return (
      <div className="run_overview">
        <div className="empty_state_inline" style={{ padding: "48px 24px", textAlign: "center" }}>
          Select a run on the left to inspect it — or start one from Launch.
        </div>
      </div>
    );
  }
  const title = run_workflow_label(props.run, props.workflow_label_by_id);
  const started = run_started_at(props.run) || String(props.run_state?.started_at || props.run_state?.created_at || "").trim();
  const finished = run_finished_at(props.run) || (terminal_run_status(props.status_label) ? String(props.run_state?.updated_at || "").trim() : "");
  const duration = props.run ? run_duration_label(props.run) : started ? format_duration_ms((parse_iso_ms(finished) ?? Date.now()) - (parse_iso_ms(started) ?? Date.now())) : "—";
  const llm_count = props.provider_activities.length;
  const token_total = props.provider_activities.reduce((n, a) => n + (Number(a.tokens.total) || 0), 0);
  const missing = props.provider_activities.filter((a) => a.missing_response || a.error).length;
  const summary_text = String(props.latest_summary?.text || "").trim();
  const wait = props.wait_state;

  // OUTCOME (fable5 layout P0-2): the Overview previously answered neither
  // "why did it fail" (error lived only in the Runtime inspector) nor
  // "what did it produce" (the answer hid behind per-card unfolds).
  const is_terminal = terminal_run_status(props.status_label);
  const error_text = run_error_label(props.run) || String(props.run_state?.error || "").trim();
  let outcome_text = "";
  for (let i = props.records.length - 1; i >= 0; i--) {
    const t = extract_response_text_from_record(props.records[i]?.record);
    if (t) {
      outcome_text = t;
      break;
    }
  }

  return (
    <div className="run_overview">
      {/* ONE LINE (operator 2026-07-15): identity left, actions right —
        * the stacked eyebrow/title/meta hero spent three lines repeating
        * what the toolbar already says. */}
      <section className="run_hero run_hero_line">
        <h2 className="run_hero_title" title={title}>{title}</h2>
        <RunStatusPill status={props.status_label} />
        {run_id ? <span className="chip mono muted" title={run_id}>{short_id(run_id, 18)}</span> : null}
        {props.root_run_id && props.root_run_id !== run_id ? (
          <span className="chip mono muted" title={props.root_run_id}>root {short_id(props.root_run_id, 12)}</span>
        ) : null}
        <span className="run_hero_spacer" />
        {props.workspace_root ? (
          <button
            className="btn btn_icon"
            onClick={props.on_reveal_workspace}
            title={`Open the run's workspace folder\n${props.workspace_root}`}
          >
            <FolderGlyph />
            Folder
          </button>
        ) : null}
        <button className="btn" onClick={props.on_generate_summary} disabled={!run_id || props.summary_generating}>
          {props.summary_generating ? "Summarizing…" : summary_text ? "Refresh summary" : "Summarize"}
        </button>
        <button className="btn" onClick={props.on_open_runtime} title="Open this run's artifacts in the System explorer">
          Run artifacts
        </button>
      </section>

      {/* OUTCOME FIRST (usability defender): a terminal run's story answers
        * "how did it end" before the numbers — the metric row used to stand
        * between the title and the failure reason, pushing the WHY toward
        * the fold. Terminal runs with no captured text still get an honest
        * panel that teaches where produced files live. */}
      {is_terminal ? (
        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Outcome</h3>
            <span className={`chip mono ${run_status_class(props.status_label)}`}>{props.status_label || (error_text ? "failed" : "completed")}</span>
          </div>
          {error_text ? <div className="error_callout">{error_text}</div> : null}
          {outcome_text ? <Markdown text={clamp_preview(outcome_text, { max_chars: 4000, max_lines: 60 })} /> : null}
          {!error_text && !outcome_text ? (
            <div className="empty_state_inline">No final text output was recorded for this run — produced files, if any, live under Run artifacts (above).</div>
          ) : null}
        </section>
      ) : null}

      {/* DURABLE ARTIFACTS (operator 2026-07-15): what the runtime actually
        * recorded for THIS run — file products lead; internal state
        * offloads (run-store/node-trace vars) fold behind a disclosure.
        * Files a workflow wrote only to its workspace folder are NOT here
        * by construction (not durable) — the Folder button reaches those. */}
      {(() => {
        const arts = Array.isArray(props.run_artifacts) ? props.run_artifacts : [];
        const is_offload = (a: any) => {
          const src = String((a?.tags && typeof a.tags === "object" ? (a.tags as any).source : "") || "").trim();
          return src === "run_store_offload" || src === "node_trace_offload";
        };
        const art_name = (a: any) => {
          const tags = a?.tags && typeof a.tags === "object" ? (a.tags as any) : {};
          const fname = String(a?.filename || tags.filename || "").trim();
          if (fname) return fname;
          const path = String(tags.path || a?.source_path || "").trim();
          if (path) return path.split("/").pop() || path;
          const title = String(a?.title || "").trim();
          return title || String(a?.artifact_id || "").slice(0, 14);
        };
        const art_row = (a: any) => (
          <div key={String(a?.artifact_id || Math.random())} className="run_artifact_row">
            <span className="run_artifact_name" title={String((a?.tags as any)?.path || a?.source_path || a?.artifact_id || "")}>{art_name(a)}</span>
            <span className="chip mono muted">{String(a?.content_type || "?").replace(/^application\//, "").replace(/^text\//, "")}</span>
            <span className="run_artifact_size">{typeof a?.size_bytes === "number" ? `${(a.size_bytes / 1024).toFixed(a.size_bytes > 100_000 ? 0 : 1)} kB` : ""}</span>
            <span className="run_artifact_actions">
              <button className="btn" onClick={() => props.on_preview_run_artifact(a)}>Preview</button>
              <button className="btn" onClick={() => props.on_download_run_artifact(a)}>Download</button>
            </span>
          </div>
        );
        const products = arts.filter((a) => !is_offload(a));
        const internals = arts.filter(is_offload);
        return (
          <section className="overview_panel">
            <div className="overview_panel_header">
              <h3>Artifacts</h3>
              <span className="mono muted">{arts.length ? arts.length.toLocaleString() : ""}</span>
              {props.workspace_root ? (
                <>
                  <span className="pane_spacer" />
                  <button className="btn btn_icon" onClick={props.on_reveal_workspace} title={`Open the run's workspace folder\n${props.workspace_root}`}>
                    <FolderGlyph />
                    Workspace
                  </button>
                </>
              ) : null}
            </div>
            {props.run_artifacts_error ? <div className="warn_callout">{props.run_artifacts_error}</div> : null}
            {props.run_artifacts_loading && !arts.length ? <div className="empty_state_inline">Loading artifacts…</div> : null}
            {!props.run_artifacts_loading && !arts.length && !props.run_artifacts_error ? (
              <div className="empty_state_inline">
                The runtime recorded no durable artifacts for this run.
                {props.workspace_root ? " Files written to the workspace folder (if any) are reachable via the Folder button." : ""}
              </div>
            ) : null}
            {products.length ? <div className="run_artifact_list">{products.map(art_row)}</div> : null}
            {!products.length && arts.length ? (
              <div className="empty_state_inline">
                No file products — this run's durable artifacts are internal state offloads (below).
                {props.workspace_root ? " Report files written to the workspace are reachable via the Folder button." : ""}
              </div>
            ) : null}
            {internals.length ? (
              <details className="runtime_raw_details">
                <summary className="muted">Internal state offloads ({internals.length})</summary>
                <div className="run_artifact_list">{internals.map(art_row)}</div>
              </details>
            ) : null}
          </section>
        );
      })()}

      <div className="metric_grid">
        <div className="metric_tile">
          <span>Started</span>
          <strong>{display_datetime(started)}</strong>
        </div>
        <div className="metric_tile">
          <span>{finished ? "Finished" : "Running for"}</span>
          <strong>{finished ? display_datetime(finished) : duration}</strong>
        </div>
        <div className="metric_tile">
          <span>Total duration</span>
          <strong>{duration}</strong>
        </div>
        <div className="metric_tile">
          <span>Ledger</span>
          <strong>{(props.records_count + props.child_records_count).toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Subworkflows</span>
          <strong>{props.subrun_ids.length.toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Provider calls</span>
          <strong>{llm_count.toLocaleString()}</strong>
        </div>
        <div className="metric_tile">
          <span>Tokens</span>
          <strong>{token_total ? token_total.toLocaleString() : "—"}</strong>
        </div>
        <div className="metric_tile">
          <span>Assets</span>
          <strong>{props.attachments_count.toLocaleString()}</strong>
        </div>
      </div>

      <div className="overview_columns">
        <section className="overview_panel">
          <div className="overview_panel_header">
            {/* Tense honesty (usability defender): a finished run is not
              * "happening" — the panel answers "what happened last" there. */}
            <h3>{is_terminal ? "What happened" : "What is happening"}</h3>
            {wait ? <span className="chip mono info">waiting</span> : null}
          </div>
          {wait ? (
            <div className="overview_fact_list">
              <div><span>Reason</span><strong>{String(wait.reason || "unknown")}</strong></div>
              {wait.wait_key ? <div><span>Wait key</span><strong className="mono">{short_id(String(wait.wait_key), 34)}</strong></div> : null}
              {(wait as any)?.details?.sub_run_id ? (
                <div><span>Subworkflow</span><strong className="mono">{short_id(String((wait as any).details.sub_run_id), 24)}</strong></div>
              ) : null}
              {wait.prompt ? <div><span>Prompt</span><strong>{clamp_preview(String(wait.prompt), { max_chars: 260, max_lines: 3 })}</strong></div> : null}
              {/* Re-entry to the answering surface: the context modal pops on
                * attach but is dismissable — without this button a dismissed
                * question left no way back short of re-attaching the run. */}
              {props.on_answer_wait && wait.wait_key && String(wait.reason || "") === "user" ? (
                <div className="overview_fact_actions">
                  <button className="btn primary" onClick={props.on_answer_wait}>
                    Review &amp; answer…
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            (() => {
              // No wait: answer with the last step instead of a shrug
              // (adversary 3 F2 — the real answer used to sit at the page
              // bottom in Chronology). Terminal runs show it too: the last
              // recorded step is where the run ended.
              const last = props.timeline_items.length ? props.timeline_items[props.timeline_items.length - 1] : null;
              const last_rec: any = last?.record || null;
              const last_node = String(last_rec?.node_id || "").trim();
              const node = last_node && props.node_index ? (props.node_index as any)[last_node] : null;
              const last_label = String(node?.label || last_node || "").trim();
              const last_effect = String(last_rec?.effect?.type || "").trim();
              if (last_label || last_effect) {
                return (
                  <div className="overview_fact_list">
                    {last_label ? <div><span>{is_terminal ? "Ended at" : "Last step"}</span><strong>{last_label}</strong></div> : null}
                    {last_effect ? <div><span>Effect</span><strong className="mono">{last_effect}</strong></div> : null}
                  </div>
                );
              }
              return (
                <div className="empty_state_inline">
                  {is_terminal ? "Nothing in flight — the run is finished." : "No active wait is reported for this run."}
                </div>
              );
            })()
          )}
          {missing ? <div className="warn_callout">{missing} provider call(s) have missing responses or errors.</div> : null}
        </section>

        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Summary</h3>
            {props.latest_summary ? <span className="chip mono ok">saved</span> : <span className="chip mono muted">none</span>}
          </div>
          {props.summary_error ? <div className="warn_callout">{props.summary_error}</div> : null}
          {summary_text ? <Markdown text={summary_text} /> : <div className="empty_state_inline">Generate a grounded summary from the root run and its subflows.</div>}
        </section>
      </div>

      {props.subrun_ids.length ? (
        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Subworkflows</h3>
            <span className="mono muted">{props.subrun_ids.length}</span>
          </div>
          <div className="subrun_chip_list">
            {props.subrun_ids.map((rid) => (
              <button key={rid} className="subrun_chip mono" onClick={() => props.on_open_subrun(rid)} title={rid}>
                {short_id(rid, 22)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* SESSION FILES (was the Attachments tab). Honest name: these are
        * session-memory attachments (often user-supplied inputs), not
        * verified run OUTPUTS — "Produced" over-claimed provenance the
        * query doesn't check (adversary 1 P1-3). Run products live on the
        * System page's artifact explorer. */}
      {props.attachments.length || props.session_id ? (
        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Session files</h3>
            <span className="mono muted">{props.attachments.length ? `${props.attachments.length} file${props.attachments.length === 1 ? "" : "s"}` : ""}</span>
            <button className="btn btn_sm" onClick={props.on_refresh_attachments} disabled={props.attachments_loading || !props.session_id}>
              {props.attachments_loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {props.attachments_error ? <div className="warn_callout">{props.attachments_error}</div> : null}
          {!props.attachments.length ? (
            <div className="empty_state_inline">
              {is_terminal ? "No files were attached to this run's session." : "No files in this run's session yet."}
            </div>
          ) : (
            <div className="produced_list">
              {props.attachments.map((a: any) => {
                const artifact_id = String(a?.artifact_id || "").trim();
                if (!artifact_id) return null;
                const tags = a?.tags && typeof a.tags === "object" ? (a.tags as any) : {};
                const label = String(tags?.path || "").trim() ? `@${String(tags.path).trim()}` : String(tags?.filename || "").trim() || artifact_id;
                const size_bytes = typeof a?.size_bytes === "number" ? Number(a.size_bytes) : null;
                const busy = props.attachments_loading || !props.attachments_ready;
                return (
                  <div key={artifact_id} className="produced_row">
                    <span className="produced_name mono" title={artifact_id}>{label}</span>
                    <span className="mono muted">{size_bytes !== null ? `${size_bytes.toLocaleString()} B` : ""}</span>
                    <span className="produced_actions">
                      <button className="btn btn_sm" onClick={() => props.on_preview_attachment(a)} disabled={busy}>Preview</button>
                      <button className="btn btn_sm" onClick={() => props.on_download_attachment(a)} disabled={busy}>Download</button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* CHRONOLOGY (was the Timeline tab): the run as a human-readable
        * story, oldest → newest. Collapsed to the newest slice by default:
        * rendering hundreds of scrollable articles at the bottom of the
        * default tab was a wheel-capture gauntlet (adversary 1 P1-4), and
        * the count must say when it is a slice. */}
      {props.timeline_items.length ? (
        <section className="overview_panel">
          <div className="overview_panel_header">
            <h3>Chronology</h3>
            <span className="mono muted">
              {chronology_expanded || props.timeline_items.length <= CHRONOLOGY_PREVIEW_COUNT
                ? `${props.timeline_items.length} steps`
                : `last ${CHRONOLOGY_PREVIEW_COUNT} of ${props.timeline_items.length} steps`}
            </span>
            {props.timeline_items.length > CHRONOLOGY_PREVIEW_COUNT ? (
              <button className="btn btn_sm" onClick={() => set_chronology_expanded((v) => !v)}>
                {chronology_expanded ? "Show fewer" : "Show all"}
              </button>
            ) : null}
          </div>
          <HumanTimelinePanel
            items={chronology_expanded ? props.timeline_items : props.timeline_items.slice(-CHRONOLOGY_PREVIEW_COUNT)}
            node_index={props.node_index}
            workflow_label_by_id={props.workflow_label_by_id}
            on_copy={props.on_copy}
          />
        </section>
      ) : null}
    </div>
  );
}

function HumanTimelinePanel(props: {
  items: LedgerRecordItem[];
  node_index: Record<string, any>;
  workflow_label_by_id: Record<string, string>;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const humanize = (item: LedgerRecordItem): { title: string; subtitle: string; request: string; outcome: string; cls: string } => {
    const extra: any = item as any;
    const rec: any = item.record || {};
    const effect_type = String(rec?.effect?.type || extra.effect_type || "").trim();
    const status = String(rec?.status || extra.status || "").trim();
    const node_id = String(rec?.node_id || extra.node_id || "").trim();
    const node = node_id && props.node_index ? (props.node_index as any)[node_id] : null;
    const node_label = String(node?.label || node_id || extra.title || "Step").trim();
    const wait = extract_wait_from_record(rec);
    const payload = rec?.effect?.payload;
    const result = rec?.result;
    const response = extract_response_text_from_record(rec);
    const request = effect_type ? safe_json_inline(payload ?? {}, 900) : clamp_preview(String(extra.preview || ""), { max_chars: 900, max_lines: 8 });
    const outcome =
      response ||
      (wait ? `Waiting for ${String(wait.reason || "input")}${wait.wait_key ? ` (${short_id(String(wait.wait_key), 18)})` : ""}` : "") ||
      (result !== undefined ? safe_json_inline(result, 900) : "");
    const title =
      effect_type === "llm_call"
        ? "Model call"
        : effect_type === "tool_calls"
          ? "Tool execution"
          : effect_type === "answer_user"
            ? "User-facing response"
            : effect_type === "start_subworkflow"
              ? "Subworkflow launched"
              : effect_type === "ask_user"
                ? "User input requested"
                : effect_type || extra.title || "Ledger event";
    return {
      title,
      subtitle: node_label,
      request: clamp_preview(request, { max_chars: 900, max_lines: 7 }),
      outcome: clamp_preview(outcome, { max_chars: 1100, max_lines: 9 }),
      cls: run_status_class(status),
    };
  };

  return (
    <div className="human_timeline">
      {!props.items.length ? <div className="empty_state_inline">No ledger records yet.</div> : null}
      {props.items.map((item) => {
        const rec: any = item.record || {};
        const h = humanize(item);
        const ts = String(rec.ended_at || rec.started_at || (item as any).ts || "").trim();
        return (
          <article key={`${String(item.run_id || rec.run_id || "")}:${item.cursor}`} className={`timeline_event ${h.cls}`}>
            <div className="timeline_marker" />
            <div className="timeline_event_body">
              <div className="timeline_event_header">
                <div>
                  <h3>{h.title}</h3>
                  <div className="timeline_subtitle">
                    <span>{h.subtitle}</span>
                    {item.run_id ? <span className="mono">{short_id(String(item.run_id), 13)}</span> : null}
                  </div>
                </div>
                <div className="timeline_time">
                  <span>{format_time_ago(ts)}</span>
                  <span className="mono" title={ts}>{display_datetime(ts)}</span>
                </div>
              </div>
              <div className="timeline_payload_grid">
                <div>
                  <span>Requested</span>
                  <p className="mono">{h.request || "—"}</p>
                </div>
                <div>
                  <span>Outcome</span>
                  <p>{h.outcome || "—"}</p>
                </div>
              </div>
              <div className="timeline_actions">
                <button className="btn btn_icon" onClick={() => props.on_copy(JSON.stringify(rec, null, 2))}>
                  <Icon name="copy" size={14} />
                  JSON
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
   LedgerCard — visual step card for the observe ledger.
   Structured layout: header row (title + status + time), meta chips,
   optional preview, and compact action buttons.
   -------------------------------------------------------------------------- */
export function LedgerCard(props: {
  item: UiLogItem;
  open: boolean;
  on_toggle: () => void;
  response_open: boolean;
  on_toggle_response: () => void;
  node_index: Record<string, any>;
  on_copy: (text: string) => void;
}): React.ReactElement {
  const item = props.item;
  const node_id = String(item.node_id || "").trim();
  const meta = node_id && props.node_index && typeof props.node_index === "object" ? (props.node_index as any)[node_id] : null;
  const node_label = typeof meta?.label === "string" && meta.label.trim() ? meta.label.trim() : node_id || item.title;
  const node_type = typeof meta?.type === "string" && meta.type.trim() ? meta.type.trim() : "";
  const header_color = typeof meta?.headerColor === "string" && meta.headerColor.trim() ? meta.headerColor.trim() : "";
  const display_label = item.kind === "step" ? node_label : item.title;

  const accent =
    header_color ||
    (item.kind === "error"
      ? "rgba(239, 68, 68, 0.85)"
      : item.kind === "message"
        ? "rgba(167, 139, 250, 0.85)"
        : item.kind === "event"
          ? "rgba(96, 165, 250, 0.85)"
          : item.status === "waiting"
            ? "rgba(96, 165, 250, 0.65)"
            : item.status === "completed"
              ? "rgba(34, 197, 94, 0.65)"
              : "rgba(255, 255, 255, 0.14)");

  const status = String(item.status || "").trim();
  const st = status.toLowerCase();
  const status_cls = run_status_class(st);

  const response_text = extract_response_text_from_record(item.data);
  const has_response = Boolean(response_text && response_text.trim());
  const when = format_time_ago(item.ts);

  return (
    <div className={`lc ${status_cls}`} style={{ ["--lc-accent" as any]: accent }}>
      <div className="lc_header">
        <span className="lc_title">{display_label}</span>
        <div className="lc_header_right">
          {status ? <span className={`lc_status ${status_cls}`}>{status}</span> : null}
          <span className="lc_time" title={item.ts}>{when}</span>
      </div>
      </div>
      <div className="lc_meta">
        {node_type ? <span className="lc_chip">{node_type}</span> : null}
        {item.effect_type ? <span className="lc_chip">{String(item.effect_type)}</span> : null}
        {item.cursor ? <span className="lc_chip">#{item.cursor}</span> : null}
        {item.run_id ? <span className="lc_chip">{short_id(String(item.run_id), 10)}</span> : null}
        {item.kind !== "step" && node_id ? <span className="lc_chip">{node_id}</span> : null}
      </div>
      {item.preview ? <div className="lc_preview">{item.preview}</div> : null}
      {item.data ? (
        <div className="lc_actions">
          {has_response ? (
            <>
              <button className="lc_btn" onClick={props.on_toggle_response}>{props.response_open ? "Fold Response" : "Unfold Response"}</button>
              <button className="lc_btn" onClick={() => props.on_copy(String(response_text || ""))}>Copy Response</button>
            </>
          ) : null}
          <button className="lc_btn" onClick={props.on_toggle}>{props.open ? "Fold JSON" : "Unfold JSON"}</button>
          <button className="lc_btn" onClick={() => { try { props.on_copy(JSON.stringify(item.data, null, 2)); } catch { props.on_copy(String(item.data)); } }}>Copy JSON</button>
        </div>
      ) : null}
      {props.response_open && has_response ? (
        <div className="lc_body"><Markdown text={String(response_text || "")} /></div>
      ) : null}
      {props.open && item.data ? (
        <div className="lc_body lc_body_json mono"><SharedJsonViewer value={item.data} collapseAfterDepth={3} showCopy={false} /></div>
      ) : null}
    </div>
  );
}
