/**
 * Run workspace panels (ui-rethink P1 slice 4a, 2026-07-22).
 *
 * Moved VERBATIM from app.tsx: the run-detail satellite components —
 * AskForm (wait response) and WorkflowRunNavigator (the grouped run list).
 * The Story panel, its chronology and the old ledger card were replaced by
 * the run view (run_steps_view.tsx, 2026-10-01). All render over props; every fold/label they use lives in
 * the extracted modules.
 */
import React, { useState } from "react";

import { Icon } from "@abstractframework/ui-kit";
import { ListDisclosure } from "./list_disclosure";
import { type WaitState } from "../lib/types";
import {
  active_run_status,
  format_time_ago,
  run_duration_label,
  run_started_at,
  short_id,
} from "./format";
import { RunStatusPill, run_workflow_label } from "./run_labels";
import { run_status_word, type RunFilterMode, type RunSummary, type RunTreeSection } from "./run_status";
import { run_session_tag, run_session_tag_label } from "./automations";

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

/** A navigator row's label: an automation root reads as its title. */
export function run_tree_label(run: RunSummary, labels: Record<string, string>, automation_titles: Record<string, string>): string {
  if (run_session_tag(run) === "automation") {
    const id = String(run.automation_id || run.run_id || "").trim();
    return automation_titles[id] || "Automation";
  }
  return run_workflow_label(run, labels);
}

/** The automation tag chip (gateway attribution; nothing for chat runs). */
export function RunTag(props: { run: RunSummary }): React.ReactElement | null {
  const tag = run_session_tag(props.run);
  if (!tag) return null;
  return (
    <span className="chip scheduled run_tree_tag" data-tag={tag}>
      {run_session_tag_label(props.run)}
    </span>
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
  /** automation_id → title (from the Automations list, when loaded). */
  automation_titles: Record<string, string>;
  on_search: (value: string) => void;
  on_filter: (value: RunFilterMode) => void;
  on_group_by: (value: "status" | "workflow" | "session") => void;
  on_refresh: () => void;
  on_select: (run_id: string, root_run_id?: string) => void;
  /** The list disclosure (DESIGN §12); absent = open, no toggle. */
  list?: { open: boolean; on_toggle: () => void };
}): React.ReactElement {
  const selected = props.selected_run_id.trim();
  const open = props.list ? props.list.open : true;
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
    <aside className={`observatory_sidebar pane${open ? "" : " list_collapsed"}`}>
      <div className="run_nav_header pane_header">
        {props.list ? (
          <ListDisclosure
            open={open}
            on_toggle={props.list.on_toggle}
            controls="run_nav_controls run_nav_tree"
            title="Runs"
            count={`${props.total_runs.toLocaleString()} runs • ${active_count.toLocaleString()} active`}
          />
        ) : (
          <>
            <span className="pane_title">Runs</span>
            <span className="pane_count">
              {props.total_runs.toLocaleString()} runs • {active_count.toLocaleString()} active
            </span>
          </>
        )}
        <span className="pane_spacer" />
        <button className="btn btn_icon" onClick={props.on_refresh} disabled={props.loading} title="Refresh workflow runs">
          <Icon name="refresh" size={14} />
          {props.loading ? "…" : ""}
        </button>
      </div>

      <div className="run_nav_controls" id="run_nav_controls" hidden={!open}>
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

      <div className="run_tree" id="run_nav_tree" hidden={!open}>
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
                      <span className="run_tree_label">{run_tree_label(root, props.workflow_label_by_id, props.automation_titles)}</span>
                      <RunTag run={root} />
                      {root.status ? <RunStatusPill status={run_status_word(root)} /> : null}
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
                              <span className="run_tree_label">{run_tree_label(child, props.workflow_label_by_id, props.automation_titles)}</span>
                              <RunTag run={child} />
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

