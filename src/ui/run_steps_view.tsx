/**
 * The run view's step list (operator 2026-10-01 13:05): collapsible step
 * cards, collapsed by default, grouped by agent cycle; housekeeping behind
 * the "All steps" switch; LLM / Tools / Failed filters and a search box;
 * an expanded card shows the full request and answer, `$slim` bodies
 * resolved (run_steps.ts).
 *
 * Flat by design: one list, section dividers instead of nested cards, no
 * inner scroll (the run panel is the one scroll container).
 */
import React, { useMemo, useState } from "react";

import { JsonViewer as SharedJsonViewer, Markdown } from "@abstractframework/panel-chat";
import { AfSwitch } from "@abstractframework/ui-kit";

import { format_duration_ms, short_id } from "./format";
import { run_status_class } from "./run_status";
import { STEP_KIND_LABEL } from "./run_step_kinds";
import {
  build_run_steps,
  filter_steps,
  group_by_cycle,
  llm_detail,
  step_search_text,
  step_detail,
  step_substance,
  subflow_child_id,
  tool_detail,
  type LedgerItem,
  type RunStep,
  type RunViewState,
  type StepFilter,
} from "./run_steps";
import "./run_steps.css";

const FILTER_LABEL: Record<StepFilter, string> = { all: "All", llm: "LLM calls", tools: "Tools", failed: "Failed" };

function json_text(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** One foldable body section: title, a short meta, Copy. */
function Section(props: { title: string; meta?: string; copy?: string; open?: boolean; on_copy: (t: string) => void; children: React.ReactNode }): React.ReactElement {
  return (
    <details className="rs_section" open={props.open}>
      <summary>
        <span className="rs_section_title">{props.title}</span>
        {props.meta ? <span className="rs_section_meta">{props.meta}</span> : null}
        {props.copy !== undefined ? (
          <button
            type="button"
            className="rs_copy"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.on_copy(props.copy || "");
            }}
          >
            Copy
          </button>
        ) : null}
      </summary>
      <div className="rs_section_body">{props.children}</div>
    </details>
  );
}

function chars(n: number): string {
  return `${n.toLocaleString("en-US")} chars`;
}

function RawSection(props: { step: RunStep; on_copy: (t: string) => void }): React.ReactElement {
  const raw = props.step.started && props.step.started !== props.step.record ? { started: props.step.started, record: props.step.record } : props.step.record;
  return (
    <Section title="Raw JSON" copy={json_text(raw)} on_copy={props.on_copy}>
      <div className="rs_json mono">
        <SharedJsonViewer value={raw} collapseAfterDepth={2} showCopy={false} />
      </div>
    </Section>
  );
}

function LlmBody(props: { step: RunStep; on_copy: (t: string) => void }): React.ReactElement {
  const d = llm_detail(props.step);
  const nothing_kept = !d.system && !d.messages.length && !d.missing.length;
  return (
    <>
      {d.missing.map((m) => (
        <p key={m} className="rs_notice">Prompt body not kept: {m}.</p>
      ))}
      {nothing_kept ? <p className="rs_notice">Prompt body not kept: this record carries no request messages.</p> : null}
      {d.unverified.length ? <p className="rs_notice">Rebuilt prompt may differ from what was sent: {d.unverified.join("; ")}.</p> : null}
      {d.system ? (
        <Section title="System" meta={chars(d.system.length)} copy={d.system} on_copy={props.on_copy}>
          <pre className="rs_text">{d.system}</pre>
        </Section>
      ) : null}
      {d.messages.length ? (
        <Section title="Messages" meta={`${d.messages.length}${d.messages_source === "sent" ? " · as sent" : ""}`} copy={json_text(d.messages)} on_copy={props.on_copy}>
          <ol className="rs_messages">
            {d.messages.map((m, i) => (
              <li key={i} className={`rs_msg rs_msg_${m.role}`}>
                <span className="rs_role">{m.role}{m.name ? ` · ${m.name}` : ""}</span>
                {m.content ? <pre className="rs_text">{m.content}</pre> : null}
                {m.tool_calls?.map((c, j) => (
                  <pre key={j} className="rs_text mono">{`${c.name}(${json_text(c.arguments)})`}</pre>
                ))}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      {d.tools.length ? (
        <Section title="Tools offered" meta={String(d.tools.length)} copy={json_text(d.tools)} on_copy={props.on_copy}>
          <ul className="rs_tools">
            {d.tools.map((t) => (
              <li key={t.name}>
                <strong className="mono">{t.name}</strong>
                {t.description ? <span> — {t.description}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Response" meta={d.tool_calls.length ? `${d.tool_calls.length} tool call${d.tool_calls.length === 1 ? "" : "s"}` : d.response ? chars(d.response.length) : "empty"} copy={d.response || json_text(d.tool_calls)} open on_copy={props.on_copy}>
        {d.response ? <div className="rs_markdown"><Markdown text={d.response} /></div> : null}
        {d.tool_calls.map((c, j) => (
          <pre key={j} className="rs_text mono">{`${c.name}(${json_text(c.arguments)})`}</pre>
        ))}
        {!d.response && !d.tool_calls.length ? <p className="rs_muted">No text and no tool call.</p> : null}
      </Section>
      {d.reasoning ? (
        <Section title="Reasoning" meta={chars(d.reasoning.length)} copy={d.reasoning} on_copy={props.on_copy}>
          <pre className="rs_text">{d.reasoning}</pre>
        </Section>
      ) : null}
      <RawSection step={props.step} on_copy={props.on_copy} />
    </>
  );
}

function ToolBody(props: { step: RunStep; on_copy: (t: string) => void }): React.ReactElement {
  const d = tool_detail(props.step);
  return (
    <>
      <Section title="Calls" meta={String(d.calls.length)} copy={json_text(d.calls)} open on_copy={props.on_copy}>
        {d.calls.map((c, i) => (
          <pre key={i} className="rs_text mono">{`${c.name}(${json_text(c.arguments)})`}</pre>
        ))}
      </Section>
      <Section title="Results" meta={String(d.results.length)} copy={json_text(d.results)} open on_copy={props.on_copy}>
        {!d.results.length ? <p className="rs_muted">No result recorded yet.</p> : null}
        <ol className="rs_messages">
          {d.results.map((r, i) => (
            <li key={i} className={`rs_msg ${r.success === false ? "rs_msg_failed" : ""}`}>
              <span className="rs_role">
                {r.name} · {r.success === false ? "failed" : r.success ? "ok" : "unknown"}
              </span>
              {r.error ? <pre className="rs_text">{r.error}</pre> : null}
              {r.output ? <pre className="rs_text">{r.output}</pre> : null}
            </li>
          ))}
        </ol>
      </Section>
      <RawSection step={props.step} on_copy={props.on_copy} />
    </>
  );
}

function GenericBody(props: { step: RunStep; on_copy: (t: string) => void; on_open_run?: (rid: string) => void }): React.ReactElement {
  const rec = props.step.record || {};
  const payload = props.step.started?.effect?.payload ?? rec?.effect?.payload;
  const child = props.step.kind === "subflow" ? subflow_child_id(rec) : "";
  return (
    <>
      {child && props.on_open_run ? (
        <p className="rs_line_actions">
          <span className="mono">{child}</span>
          <button type="button" className="btn btn_sm" onClick={() => props.on_open_run?.(child)}>Open</button>
        </p>
      ) : null}
      {rec.error ? <pre className="rs_text rs_error">{typeof rec.error === "string" ? rec.error : json_text(rec.error)}</pre> : null}
      {payload !== undefined && payload !== null ? (
        <Section title="Payload" copy={json_text(payload)} on_copy={props.on_copy}>
          <div className="rs_json mono"><SharedJsonViewer value={payload} collapseAfterDepth={2} showCopy={false} /></div>
        </Section>
      ) : null}
      {rec.result !== undefined && rec.result !== null ? (
        <Section title="Result" copy={json_text(rec.result)} on_copy={props.on_copy}>
          <div className="rs_json mono"><SharedJsonViewer value={rec.result} collapseAfterDepth={2} showCopy={false} /></div>
        </Section>
      ) : null}
      <RawSection step={props.step} on_copy={props.on_copy} />
    </>
  );
}

export function StepCard(props: {
  step: RunStep;
  node_label: string;
  open: boolean;
  on_toggle: () => void;
  on_copy: (t: string) => void;
  on_open_run?: (rid: string) => void;
}): React.ReactElement {
  const s = props.step;
  const line = step_substance(s);
  const detail = step_detail(s);
  const status = s.failed && s.status !== "failed" ? "failed" : s.status;
  return (
    <article className={`rs_card ${s.failed ? "rs_failed" : ""}`} data-kind={s.kind} data-step-id={s.step_id || undefined}>
      <button type="button" className="rs_card_head" aria-expanded={props.open} onClick={props.on_toggle}>
        <span className="rs_chevron" aria-hidden="true">{props.open ? "▾" : "▸"}</span>
        <span className="rs_kind">{STEP_KIND_LABEL[s.kind]}</span>
        <span className="rs_node">{props.node_label || s.node_id || s.effect_type || "step"}</span>
        <span className={`rs_status ${run_status_class(status)}`}>{status || "—"}</span>
        <span className="rs_dur">{s.duration_ms !== null ? format_duration_ms(s.duration_ms) : ""}</span>
        {detail ? <span className="rs_detail">{detail}</span> : null}
        {line ? <span className="rs_line">{line}</span> : null}
      </button>
      {props.open ? (
        <div className="rs_card_body">
          {s.kind === "llm_call" ? (
            <LlmBody step={s} on_copy={props.on_copy} />
          ) : s.kind === "tool" ? (
            <ToolBody step={s} on_copy={props.on_copy} />
          ) : (
            <GenericBody step={s} on_copy={props.on_copy} on_open_run={props.on_open_run} />
          )}
        </div>
      ) : null}
    </article>
  );
}

export function RunStepsView(props: {
  items: LedgerItem[];
  run_id: string;
  run_options: string[];
  run_llm_counts: Record<string, number>;
  on_select_run: (rid: string) => void;
  state: RunViewState;
  on_state: (next: RunViewState) => void;
  node_label: (run_id: string, node_id: string) => string;
  on_copy: (t: string) => void;
  on_open_run?: (rid: string) => void;
}): React.ReactElement {
  const { state } = props;
  const steps = useMemo(() => build_run_steps(props.items, props.run_id), [props.items, props.run_id]);
  const [open, set_open] = useState<Record<string, boolean>>({});
  const label_of = (s: RunStep) => props.node_label(s.run_id, s.node_id);
  const search_cache = useMemo(() => new Map<string, string>(), [steps]);
  const search_text = (s: RunStep) => {
    let t = search_cache.get(s.id);
    if (t === undefined) {
      t = step_search_text(s, label_of(s));
      search_cache.set(s.id, t);
    }
    return t;
  };
  const visible = filter_steps(steps, state, search_text);
  const has_cycles = steps.some((s) => s.kind === "llm_call");
  const cycles = steps.reduce((n, s) => (s.kind === "llm_call" ? n + 1 : n), 0);
  const hidden = steps.length - visible.length;
  const set = (patch: Partial<RunViewState>) => props.on_state({ ...state, ...patch });

  const card = (s: RunStep) => (
    <StepCard
      key={s.id}
      step={s}
      node_label={label_of(s)}
      open={open[s.id] === true}
      on_toggle={() => set_open((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
      on_copy={props.on_copy}
      on_open_run={props.on_open_run}
    />
  );

  return (
    <div className="rs_view">
      <p className="rs_count">
        {visible.length} of {steps.length} steps{has_cycles ? ` · ${cycles} cycle${cycles === 1 ? "" : "s"}` : ""}
        {hidden && state.only === "all" && !state.all_steps && !state.q ? ` · ${hidden} housekeeping hidden` : ""}
      </p>
      {/* One compact toolbar row under the count: segmented controls left, search right, the switch at the end (wraps on phones). */}
      <div className="rs_toolbar">
        <div className="seg_toggle" role="radiogroup" aria-label="Layout">
          {(["cycles", "steps"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={state.view === v} className={`seg_btn ${state.view === v ? "active" : ""}`} onClick={() => set({ view: v })}>
              {v === "cycles" ? "Cycles" : "Steps"}
            </button>
          ))}
        </div>
        <div className="seg_toggle" role="radiogroup" aria-label="Show">
          {(["all", "llm", "tools", "failed"] as const).map((f) => (
            <button key={f} type="button" role="radio" data-filter={f} aria-checked={state.only === f} className={`seg_btn ${state.only === f ? "active" : ""}`} onClick={() => set({ only: f })}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        {props.run_options.length > 1 ? (
          <select className="seg_select mono" value={props.run_id} onChange={(e) => props.on_select_run(String(e.target.value || ""))} aria-label="Run">
            {props.run_options.map((rid) => (
              <option key={rid} value={rid}>
                {short_id(rid, 14)}
                {props.run_llm_counts[rid] ? ` · ${props.run_llm_counts[rid]} LLM` : ""}
              </option>
            ))}
          </select>
        ) : null}
        <input
          className="rs_search"
          type="search"
          value={state.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search steps"
          aria-label="Search steps"
          autoComplete="off"
          spellCheck={false}
        />
        {state.only === "all" ? (
          <AfSwitch
            label="All steps"
            action="show-all-steps"
            hint="Also list status events, waits, resumes and memory bookkeeping."
            checked={state.all_steps}
            onChange={(next) => set({ all_steps: next })}
          />
        ) : null}
      </div>
      {!steps.length ? <p className="rs_muted">No steps recorded for this run yet.</p> : null}
      {steps.length && !visible.length ? <p className="rs_muted">No step matches.</p> : null}
      {state.view === "cycles" && has_cycles
        ? group_by_cycle(visible).map((g) => (
            <section key={g.cycle} className="rs_cycle" data-cycle={g.cycle}>
              <h3 className="rs_cycle_head">{g.cycle === 0 ? "Before the first call" : `Cycle ${g.cycle}`}</h3>
              {g.steps.map(card)}
            </section>
          ))
        : visible.map(card)}
    </div>
  );
}

/**
 * The run summary above the steps (what remained of the Story tab): one facts
 * line, the outcome in one paragraph (the error, or the final answer), and
 * the actions the Story held that nothing else covers.
 */
export function RunOutcome(props: {
  status: string;
  duration: string;
  facts: string;
  error: string;
  answer: string;
  waiting_for_user: boolean;
  on_answer_wait?: () => void;
  workspace_root: string;
  on_reveal_workspace: () => void;
  on_open_artifacts: () => void;
}): React.ReactElement {
  const [more, set_more] = useState(false);
  const long = props.answer.length > OUTCOME_PREVIEW_CHARS;
  const answer = more || !long ? props.answer : `${props.answer.slice(0, OUTCOME_PREVIEW_CHARS).trimEnd()}…`;
  return (
    <section className="rs_outcome" aria-label="Run summary">
      <p className="rs_outcome_facts">
        <span className={`rs_status ${run_status_class(props.status)}`}>{props.status || "unknown"}</span>
        {[props.duration, props.facts].filter(Boolean).join(" · ")}
      </p>
      {props.error ? <p className="rs_text rs_error">{props.error}</p> : null}
      {!props.error && props.answer ? (
        <div className="rs_markdown rs_outcome_text">
          <Markdown text={answer} />
          {long ? (
            <button type="button" className="rs_link" aria-expanded={more} onClick={() => set_more((v) => !v)}>
              {more ? "Less" : "More"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="rs_outcome_actions">
        {props.waiting_for_user && props.on_answer_wait ? (
          <button type="button" className="btn primary" onClick={props.on_answer_wait}>Answer</button>
        ) : null}
        <button type="button" className="btn" onClick={props.on_open_artifacts} title="This run's artifacts in System">Artifacts</button>
        {props.workspace_root ? (
          <button type="button" className="btn" onClick={props.on_reveal_workspace} title={props.workspace_root}>Folder</button>
        ) : null}
      </div>
    </section>
  );
}

const OUTCOME_PREVIEW_CHARS = 600;
