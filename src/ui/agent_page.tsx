/**
 * THE AGENT PAGE (backlog 0003 §Agent page, delivery wave 3): one subject —
 * a session's or an occurrence's run tree — read as an agent: what it is
 * for, what it is doing and for whom, what it can do, what it was given and
 * what it returned, what context it carries, its run tree, its spend, and a
 * way to ask about it.
 *
 * Presentational only: the host fetches (`GET /runs/{id}`, `/input_data`,
 * the flow JSON, `GET /automations/{id}`, a run listing) and passes bodies
 * in; every fold is in ./agent_facts (pure, tested) and every sentence in
 * ./state_line (the shared vocabulary). Each block renders honestly when
 * its source is loading, errored or absent — partial renders as partial.
 *
 * Freshness: the detail body wins over the listing row for the subject's
 * state fields only when it is at least as new (`updated_at`), so a stale
 * detail never overrides a newer poll and vice versa.
 */
import React, { useMemo } from "react";

import { clipboardWrite } from "../lib/secure-context";
import {
  fmt_int,
  fmt_utc,
  fold_agent_profile,
  fold_context,
  fold_pins,
  fold_spend,
  fold_tree,
  type AgentProfile,
  type Fact,
  type ModelFact,
  type ProfileSource,
  type TreeNode,
} from "./agent_facts";
import { format_duration_ms, parse_iso_ms } from "./format";
import { CopyButton, PinList, Value, copy_text_of } from "./pins";
import type { LedgerItem } from "./run_steps";
import { run_status_class, stop_reason_of, type RunSummary } from "./run_status";
import {
  card_title,
  fold_automation_brief,
  make_context,
  state_line,
  subject_of,
  workflow_short,
  type AutomationBrief,
  type RunPulse,
  type StateAction,
  type StateContext,
  type StateLine,
  pill_word as shared_pill_word,
} from "./state_line";
import "./agent_page.css";

export type AgentPageProps = {
  /** The subject run's listing row. */
  run: RunSummary;
  /** `GET /runs/{id}` body, or null until loaded. */
  detail: any | null;
  /** `GET /runs/{id}/input_data` body, or null until loaded. */
  input_data: any | null;
  /** The run's flow JSON (bare, or wrapped as `{…, flow}`), or null until loaded. */
  flow: any | null;
  /** The folded automation (state_line `fold_automation_brief`) for automation runs. */
  automation: AutomationBrief | null;
  /** The raw `GET /automations/{id}` body: the only source of `_runtime.allowed_tools`,
   * `policy.untrusted_input_tools` and `policy.email_allowed_recipients` until the
   * brief carries them (see LANE-B.md). Optional. */
  automation_body?: any | null;
  /** Rows for the tree and spend: the session's or the host's listing; `include_metrics` rows feed Spend. */
  runs: RunSummary[];
  /** The ledger items the host holds (`{run_id, cursor, record}`: the subject's and any subrun's).
   * Feeds the profile's "used" facts (models, tools called, subruns). Optional: absent = "ledger not loaded here". */
  records?: LedgerItem[] | null;
  pulses?: Map<string, RunPulse>;
  now_ms?: number;
  stall_after_ms?: number;
  /** `records` is optional on both: the profile says "loading the ledger…" / the error when set. */
  loading: { detail: boolean; input_data: boolean; flow: boolean; records?: boolean };
  errors: { detail?: string; input_data?: string; flow?: string; records?: string };
  on_open_run(run_id: string): void;
  on_ask(): void;
  on_action(action: StateAction, run_id: string): void;
  on_reveal_workspace?(): void;
  /** Copy handler (the app's status-line copy); falls back to the clipboard helper. */
  on_copy?(text: string): void;
  ask_window_note?: string;
};

// --- folding the props into one view ---------------------------------------------

const STATE_FIELDS = ["status", "updated_at", "current_node", "paused", "error", "waiting"] as const;
const IDENTITY_FIELDS = ["workflow_id", "created_at", "parent_run_id", "session_id", "automation_id", "role", "occurrence_index", "session_kind"] as const;

/** Is the detail at least as new as the row? (No `updated_at` on either side: trust the detail.) */
export function detail_is_fresh(run: RunSummary, detail: any): boolean {
  if (!detail || typeof detail !== "object") return false;
  if (String(detail.run_id || "").trim() && String(detail.run_id).trim() !== String(run.run_id || "").trim()) return false;
  const row_ms = parse_iso_ms(run.updated_at || "");
  const det_ms = parse_iso_ms(detail.updated_at || "");
  if (row_ms === null || det_ms === null) return true;
  return det_ms >= row_ms;
}

/** The subject row with the detail's state folded in (when fresh) and its identity gaps filled. */
export function merged_subject(run: RunSummary, detail: any): RunSummary {
  if (!detail || typeof detail !== "object") return run;
  const out: any = { ...run };
  for (const k of IDENTITY_FIELDS) {
    if ((out[k] === undefined || out[k] === null || out[k] === "") && detail[k] !== undefined && detail[k] !== null) out[k] = detail[k];
  }
  if (detail_is_fresh(run, detail)) {
    for (const k of STATE_FIELDS) if (Object.prototype.hasOwnProperty.call(detail, k)) out[k] = detail[k];
  }
  return out as RunSummary;
}

function upsert(runs: RunSummary[], subject: RunSummary): RunSummary[] {
  const id = String(subject.run_id || "").trim();
  let found = false;
  const out = (runs || []).map((r) => {
    if (String(r?.run_id || "").trim() !== id) return r;
    found = true;
    return { ...r, ...subject };
  });
  if (!found) out.push(subject);
  return out;
}

// --- small pieces ------------------------------------------------------------------

function Note(props: { kind: "loading" | "error" | "absent" | "info"; children: React.ReactNode }): React.ReactElement {
  return (
    <p className={`ap_note ap_note_${props.kind}`} role={props.kind === "error" ? "alert" : undefined}>
      {props.children}
    </p>
  );
}

function Block(props: { id: string; title: string; meta?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="ap_block" data-block={props.id} aria-labelledby={`ap_${props.id}_title`}>
      <header className="ap_block_head">
        <h2 id={`ap_${props.id}_title`} className="ap_block_title">
          {props.title}
        </h2>
        {props.meta ? <span className="ap_block_meta">{props.meta}</span> : null}
      </header>
      {props.children}
    </section>
  );
}

const ACTION_LABEL: Partial<Record<StateAction, string>> = {
  approve: "Review approval",
  answer: "Answer",
  resume: "Resume",
  open_subrun: "Open subrun",
  inspect: "Inspect",
};

/** The pill word: the shared rule (state_line.ts `pill_word`, P3/P5) — "running subrun" reads
 * running, a paused line reads paused, a controller reads scheduled. Kept as an export for the
 * page's tests; the body is the shared one so the board and this page never disagree. */
export function pill_word(run: RunSummary, line: StateLine, stop_reason?: ReturnType<typeof stop_reason_of>, automation?: AutomationBrief | null): string {
  return shared_pill_word(run, line, stop_reason ?? null, automation ?? null);
}

/** The header's one action button: label + the run it acts on (a subrun action targets the child). */
export function header_action(line: StateLine, subject_id: string): { action: StateAction; label: string; run_id: string } | null {
  const label = ACTION_LABEL[line.action];
  const run_id = line.action === "open_subrun" ? line.actor_run_id : subject_id;
  return label && run_id ? { action: line.action, label, run_id } : null;
}

function ActorBadge(props: { line: StateLine; ctx: StateContext; on_open_run(run_id: string): void }): React.ReactElement | null {
  const { line } = props;
  if (line.actor === "none") return null;
  if (line.actor === "run" && line.actor_run_id) {
    const child = props.ctx.by_id.get(line.actor_run_id);
    const name = workflow_short(String(child?.workflow_id || "")) || "subrun (row not loaded)";
    return (
      <button type="button" className="ap_actor ap_actor_run" title={`Ended by run ${line.actor_run_id}`} onClick={() => props.on_open_run(line.actor_run_id)}>
        run {name}
      </button>
    );
  }
  const word = line.actor === "run" ? "a run" : line.actor;
  return (
    <span className={`ap_actor ap_actor_${line.actor}`} title="Who ends this state">
      {word}
    </span>
  );
}

function CopyId(props: { run_id: string; on_copy?: (text: string) => void }): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn_icon ap_copy"
      title={`Copy run id ${props.run_id}`}
      aria-label="Copy run id"
      onClick={() => {
        if (props.on_copy) props.on_copy(props.run_id);
        else void clipboardWrite(props.run_id);
      }}
    >
      ⧉
    </button>
  );
}

// --- Agent profile ----------------------------------------------------------------------

const SOURCE_TITLE: Record<Exclude<ProfileSource, "">, string> = {
  used: "Read from the run's ledger: what it actually did",
  output: "Read from the run's own output",
  run: "Read from this run's detail and inputs",
  "flow default": "The flow's default for a pin the run was not sent (the runtime applies it)",
  flow: "Read from the flow declaration",
  automation: "Read from the automation definition, not from this run's inputs",
  listing: "Read from the run listing: counts include every run below this one",
  gateway: "The gateway's own default; this wire does not report it",
};

function SourceTag(props: { source: ProfileSource }): React.ReactElement | null {
  if (!props.source) return null;
  return (
    <span className="ap_source" data-source={props.source} title={SOURCE_TITLE[props.source]}>
      {props.source}
    </span>
  );
}

/** An absent fact: "—" with its reason, never a silent dash (a gateway default reads as such). */
function Absent(props: { fact: Fact<unknown> }): React.ReactElement {
  return <span className="ap_absent">{props.fact.source === "gateway" ? props.fact.why : `— ${props.fact.why || "not on this wire"}`}</span>;
}

/** One fact row: label · value · source tag · copy (hover / focus-within). */
function Row(props: { id: string; label: string; source?: ProfileSource; copy?: string | null; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="ap_prow ap_copyable" data-row={props.id}>
      <dt className="ap_prow_label">{props.label}</dt>
      <dd className="ap_prow_value">{props.children}</dd>
      <dd className="ap_prow_meta">
        <SourceTag source={props.source || ""} />
        {props.copy ? <CopyButton text={props.copy} label={props.label.toLowerCase()} /> : null}
      </dd>
    </div>
  );
}

/** A fact row: the value through `render`, or the absent reason; copy = the full raw value. */
function FactRow<T>(props: { id: string; label: string; fact: Fact<T>; render?: (v: T) => React.ReactNode; copy?: (v: T) => string }): React.ReactElement {
  const { fact } = props;
  const has_value = fact.value !== null;
  return (
    <Row id={props.id} label={props.label} source={fact.source} copy={has_value ? (props.copy ? props.copy(fact.value as T) : copy_text_of(fact.value)) : null}>
      {has_value ? (props.render ? props.render(fact.value as T) : <Value value={fact.value} />) : <Absent fact={fact as Fact<unknown>} />}
    </Row>
  );
}

function Tags(props: { items: string[]; empty?: string }): React.ReactElement {
  if (!props.items.length) return <span className="ap_muted">{props.empty || "none"}</span>;
  return (
    <span className="ap_tags">
      {props.items.map((v, i) => (
        <code key={`${v}:${i}`} className="ap_tag">
          {v}
        </code>
      ))}
    </span>
  );
}

function Group(props: { id: string; title: string; question: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="ap_pgroup" data-group={props.id} aria-labelledby={`ap_pg_${props.id}`}>
      <h3 className="ap_pgroup_title" id={`ap_pg_${props.id}`}>
        {props.title} <span className="ap_pgroup_q">{props.question}</span>
      </h3>
      <dl className="ap_ptable">{props.children}</dl>
    </section>
  );
}

function model_text(m: ModelFact): string {
  return [m.provider, m.model].filter(Boolean).join(" · ") || "model not recorded on the call";
}

function same_set(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

function plural_n(n: number, one: string, many = `${one}s`): string {
  return `${fmt_int(n)} ${n === 1 ? one : many}`;
}

function ProfileBlock(props: { prof: AgentProfile; p: AgentPageProps; line: StateLine; ctx: StateContext }): React.ReactElement {
  const { prof, p, line, ctx } = props;
  const notes: React.ReactNode[] = [];
  if (p.loading.input_data) notes.push(<Note key="li" kind="loading">loading the run's inputs…</Note>);
  if (p.errors.input_data) notes.push(<Note key="ei" kind="error">inputs unavailable: {p.errors.input_data}</Note>);
  if (p.loading.detail) notes.push(<Note key="ld" kind="loading">loading the run detail…</Note>);
  if (p.errors.detail) notes.push(<Note key="ed" kind="error">run detail unavailable: {p.errors.detail}</Note>);
  if (p.loading.flow) notes.push(<Note key="lf" kind="loading">loading the flow (its defaults)…</Note>);
  if (p.loading.records) notes.push(<Note key="lr" kind="loading">loading the ledger…</Note>);
  if (p.errors.records) notes.push(<Note key="er" kind="error">ledger unavailable: {p.errors.records}</Note>);
  if (prof.is_automation && !p.automation_body && !p.automation) notes.push(<Note key="na" kind="absent">automation definition not loaded: tool policy unknown</Note>);
  const name_of = (run_id: string): string => {
    const r = ctx.by_id.get(run_id);
    return workflow_short(String(r?.workflow_id || "")) || "a run (row not loaded)";
  };
  const open_btn = (run_id: string, text: string) => (
    <button type="button" className="ap_link_btn ap_run_link" title={`Open run ${run_id}`} data-run-id={run_id} onClick={() => p.on_open_run(run_id)}>
      {text}
    </button>
  );
  const { who, access, does, how_long: hl, after } = prof;
  const ws = access.workspace;
  const show_folder =
    ws.root.value && p.on_reveal_workspace ? (
      <button type="button" className="ap_link_btn" onClick={() => p.on_reveal_workspace?.()}>
        show folder
      </button>
    ) : null;
  const runs_used = prof.ledger.runs;
  const breakdown = (pick: (r: (typeof runs_used)[number]) => number) =>
    runs_used.length > 1 ? (
      <span className="ap_breakdown">
        {runs_used.map((r, i) => (
          <span key={r.run_id} data-run-id={r.run_id}>
            {i ? " · " : ""}
            {fmt_int(pick(r))} {r.run_id === prof.subject_id ? "in this run" : <>in {open_btn(r.run_id, name_of(r.run_id))}</>}
          </span>
        ))}
      </span>
    ) : null;
  const not_loaded = does.children_not_loaded;
  const children_note = not_loaded.length ? (
    <span className="ap_breakdown" data-children-not-loaded={not_loaded.length}>
      children's calls live in their own view ({plural_n(not_loaded.length, "subrun")} not loaded here:{" "}
      {not_loaded.map((id, i) => (
        <span key={id}>
          {i ? ", " : ""}
          {open_btn(id, name_of(id))}
        </span>
      ))}
      )
    </span>
  ) : null;
  const listing_note = (f: Fact<unknown>) => (f.source === "listing" ? <span className="ap_breakdown">tree-inclusive: this run and every run below it</span> : null);
  const recipients = (list: string[]) => (
    <Tags items={list.map((r) => (r === "self" && access.operator_email ? `self (${access.operator_email})` : r))} empty="none" />
  );

  return (
    <Block id="profile" title="Agent profile" meta="who it is · what it can reach · what it does · for how long · what comes after">
      {notes}
      <div className="ap_profile">
        <Group id="who" title="Who" question="is this agent">
          <FactRow
            id="workflow"
            label="Workflow"
            fact={who.workflow}
            render={(w) => (
              <span>
                {w.name || w.id}
                {w.flow_name ? <span className="ap_muted"> · flow “{w.flow_name}”</span> : null}
              </span>
            )}
            copy={(w) => w.id}
          />
          <FactRow
            id="subject"
            label="Subject"
            fact={who.subject}
            render={(s) => (s.kind === "automation" ? <Value value={s.title || "untitled automation"} /> : <span>{s.kind === "session" ? "a session (id on copy)" : "a standalone run (id on copy)"}</span>)}
            copy={(s) => s.id}
          />
          <FactRow
            id="role"
            label="Role"
            fact={who.role}
            render={(r) => (
              <span>
                {r.text}
                {r.parent_run_id && prof.is_automation && hl.occurrence.value?.count !== null && hl.occurrence.value?.count !== undefined && r.text.startsWith("run #") ? (
                  <span className="ap_muted"> of {fmt_int(hl.occurrence.value.count)} so far</span>
                ) : null}
                {r.parent_run_id ? <> · {open_btn(r.parent_run_id, "open parent")}</> : null}
              </span>
            )}
            copy={(r) => r.parent_run_id || r.text}
          />
          <FactRow
            id="model"
            label="Model · provider"
            fact={who.model}
            render={(list) => (
              <span className="ap_stack">
                {list.map((m, i) => (
                  <span key={i}>
                    {model_text(m)}
                    {m.calls !== null ? <span className="ap_muted"> × {plural_n(m.calls, "call")}</span> : null}
                  </span>
                ))}
                {who.model_declared?.value ? (
                  <span className="ap_finding">
                    asked for {model_text(who.model_declared.value)} <SourceTag source={who.model_declared.source} />
                  </span>
                ) : null}
              </span>
            )}
            copy={(list) => list.map(model_text).join("\n")}
          />
          <FactRow id="system" label="System prompt" fact={who.system_prompt} />
          <FactRow id="task" label="Task" fact={who.task} />
        </Group>

        <Group id="access" title="Access" question="what it may use">
          <FactRow id="tools_allowed" label="May call" fact={access.tools_allowed} render={(l) => <Tags items={l} />} />
          <FactRow
            id="runtime_allowlist"
            label="Runtime allowlist"
            fact={access.runtime_allowlist}
            render={(l) =>
              access.tools_allowed.value && l.length && same_set(l, access.tools_allowed.value) ? <span>the same {plural_n(l.length, "tool")} as above</span> : <Tags items={l} />
            }
          />
          <FactRow
            id="tools_called"
            label="Did call"
            fact={access.tools_called}
            render={(list) => (
              <span className="ap_stack">
                {list.length ? (
                  <span className="ap_tags">
                    {list.map((t) => (
                      <span key={t.name} className={`ap_tool_use ${t.outside_declared ? "ap_tool_outside" : ""}`} data-tool={t.name}>
                        <code className="ap_tag">
                          {t.name} × {fmt_int(t.calls)}
                          {t.failures ? `, ${fmt_int(t.failures)} failed` : ""}
                        </code>
                        {t.outside_declared ? <span className="ap_finding">called outside the declared list</span> : null}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="ap_muted">none in the loaded ledger</span>
                )}
                {children_note}
              </span>
            )}
          />
          <FactRow id="tool_approval" label="Tool approval" fact={access.tool_approval} render={(v) => <span>{v}</span>} />
          <FactRow id="untrusted_input_tools" label="Untrusted-input tools" fact={access.untrusted_input_tools} render={(l) => <Tags items={l} />} />
          <FactRow id="email_recipients" label="Email recipients" fact={access.email_recipients} render={recipients} />
          <FactRow
            id="workspace"
            label="Workspace"
            fact={ws.mode}
            render={(mode) => (
              <span className="ap_workspace">
                <span>{mode || "mode not set"}</span>
                {ws.root.value ? <code className="ap_path">{ws.root.value}</code> : null}
                {show_folder}
              </span>
            )}
            copy={(mode) => (ws.root.value ? `${mode}\n${ws.root.value}` : mode)}
          />
          {ws.allowed_paths.value !== null ? <FactRow id="allowed_paths" label="Allowed paths" fact={ws.allowed_paths} render={(l) => <Tags items={l} />} /> : null}
          {ws.ignored_paths.value !== null ? <FactRow id="ignored_paths" label="Ignored paths" fact={ws.ignored_paths} render={(l) => <Tags items={l} />} /> : null}
        </Group>

        <Group id="does" title="Does" question="what it did">
          <Row id="now" label="Now" source="run" copy={line.text}>
            <span className={line.stalled ? "ap_stalled_text" : undefined}>{line.text}</span>
          </Row>
          <FactRow
            id="llm_calls"
            label="LLM calls"
            fact={does.llm_calls}
            render={(n) => (
              <span className="ap_stack">
                <span>{fmt_int(n)}</span>
                {does.llm_calls.source === "used" ? breakdown((r) => r.llm_calls) : listing_note(does.llm_calls)}
              </span>
            )}
          />
          <FactRow
            id="tool_calls"
            label="Tool calls"
            fact={does.tool_calls}
            render={(t) => (
              <span className="ap_stack">
                <span>
                  {fmt_int(t.calls)}
                  {t.failures ? `, ${fmt_int(t.failures)} failed` : t.failures === 0 && t.calls ? ", none failed" : ""}
                </span>
                {does.tool_calls.source === "used" ? breakdown((r) => r.tool_calls) : listing_note(does.tool_calls)}
                {does.tool_calls.source === "used" ? children_note : null}
              </span>
            )}
          />
          <FactRow
            id="subruns"
            label="Delegated subruns"
            fact={does.subruns}
            render={(list) =>
              list.length ? (
                <span className="ap_stack">
                  {list.map((s, i) => {
                    const handed = [
                      [s.provider, s.model].filter(Boolean).join(" · "),
                      s.allowed_tools !== null ? plural_n(s.allowed_tools.length, "tool") : "",
                      s.max_iterations !== null ? `max ${fmt_int(s.max_iterations)} iterations` : "",
                    ].filter(Boolean);
                    const name = workflow_short(s.workflow_id) || "subrun";
                    return (
                      <span key={`${s.run_id}:${i}`} className="ap_subrun">
                        {s.run_id ? open_btn(s.run_id, name) : <span>{name} (not started yet)</span>}
                        {handed.length ? <span className="ap_muted"> · handed {handed.join(" · ")}</span> : null}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="ap_muted">none</span>
              )
            }
          />
          {does.artifacts.length ? (
            <Row id="artifacts" label="Artifacts" source="output" copy={does.artifacts.map((a) => a.id).join("\n")}>
              <span>
                {plural_n(does.artifacts.length, "artifact")}: <Tags items={does.artifacts.map((a) => a.pin)} />
              </span>
            </Row>
          ) : null}
          <FactRow id="outcome" label="Outcome" fact={does.outcome} />
        </Group>

        <Group id="how_long" title="How long" question="it runs and may run">
          <Row id="started" label="Started" source={hl.started_ms !== null ? "run" : ""} copy={hl.started_ms !== null ? new Date(hl.started_ms).toISOString() : null}>
            {hl.started_ms !== null ? <span>{fmt_utc(hl.started_ms)}</span> : <span className="ap_absent">— not on this wire</span>}
          </Row>
          <Row id="finished" label="Finished" source={hl.finished_ms !== null ? "run" : ""} copy={hl.finished_ms !== null ? new Date(hl.finished_ms).toISOString() : null}>
            {hl.finished_ms !== null ? <span>{fmt_utc(hl.finished_ms)}</span> : <span className="ap_muted">{hl.running ? "so far (still active)" : "— not on this wire"}</span>}
          </Row>
          <FactRow id="duration" label="Duration" fact={hl.duration} render={(ms) => <span>{format_duration_ms(ms)}{hl.running ? " so far" : ""}</span>} copy={(ms) => String(ms)} />
          <FactRow id="max_iterations" label="Max iterations" fact={hl.max_iterations} />
          <FactRow id="iterations_used" label="Iterations used" fact={hl.iterations_used} />
          <Row id="token_limit" label="Token limit" source={hl.tokens ? "run" : ""} copy={hl.tokens ? copy_text_of(p.detail?.limits?.tokens ?? hl.tokens) : null}>
            {hl.tokens && (hl.tokens.used !== null || hl.tokens.budget !== null) ? (
              <span>
                {hl.tokens.used !== null ? fmt_int(hl.tokens.used) : "—"}
                {hl.tokens.budget !== null ? ` of ${fmt_int(hl.tokens.budget)}` : ""} tokens
                {hl.tokens.pct !== null ? ` (${hl.tokens.pct < 10 && hl.tokens.pct > 0 ? hl.tokens.pct.toFixed(1) : Math.round(hl.tokens.pct)}%)` : ""}
              </span>
            ) : (
              <span className="ap_absent">— no token estimate on this run</span>
            )}
          </Row>
          <FactRow
            id="cadence"
            label="Cadence"
            fact={hl.cadence}
            render={(c) => (
              <span>
                {c.text}
                {c.start_ms !== null ? <span className="ap_muted"> · since {fmt_utc(c.start_ms)}</span> : null}
                {hl.next_fire_ms !== null ? <span> · next {fmt_utc(hl.next_fire_ms)}</span> : null}
              </span>
            )}
          />
          <FactRow
            id="occurrences"
            label="Occurrences"
            fact={hl.occurrence}
            render={(o) => (
              <span>
                {o.index !== null ? `#${fmt_int(o.index)}` : "this run"}
                {o.count !== null ? ` of ${fmt_int(o.count)} so far` : ""}
                {" · "}
                {hl.stop_after.value !== null ? `stops after ${plural_n(hl.stop_after.value, "scheduled occurrence")}` : hl.stop_after.why}
                {" · "}
                {hl.stop_at.value !== null ? `stops at ${fmt_utc(hl.stop_at.value)}` : hl.stop_at.why}
              </span>
            )}
          />
          <FactRow
            id="retry"
            label="Retry policy"
            fact={hl.retry}
            render={(r) => (
              <span>
                {[
                  r.max_attempts !== null ? plural_n(r.max_attempts, "attempt") : "",
                  r.backoff_initial ? `backoff ${r.backoff_initial}${r.backoff_factor !== null ? ` ×${r.backoff_factor}` : ""}${r.backoff_max ? ` up to ${r.backoff_max}` : ""}` : "",
                  r.failure ? `on failure: ${r.failure}` : "",
                  r.misfire ? `misfire: ${r.misfire}` : "",
                  r.serial === true ? "serial" : r.serial === false ? "may overlap" : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "no retry fields set"}
              </span>
            )}
          />
        </Group>

        <Group id="after" title="After" question="what it may do next">
          <FactRow
            id="notify"
            label="Notifies"
            fact={after.notify}
            render={(list) => (
              <Tags items={list.map((c) => (c === "email" ? "email → the owner's registered address (not on this wire)" : c))} empty="nobody (no channel)" />
            )}
          />
          <FactRow
            id="context_plan"
            label="Context"
            fact={after.context}
            render={(c) => (
              <span className="ap_stack">
                <span>
                  {c.mode === "growing"
                    ? `growing${c.growing_max_tokens !== null ? ` (cap ${fmt_int(c.growing_max_tokens)} tokens)` : ""}: each occurrence replays the session so far`
                    : c.mode === "independent"
                      ? "independent: each occurrence starts fresh"
                      : c.mode || "session history"}
                </span>
                {c.replayed_messages !== null || c.replayed_tokens !== null ? (
                  <span className="ap_muted">
                    this run replayed {c.replayed_messages !== null ? plural_n(c.replayed_messages, "message") : "?"}
                    {c.replayed_tokens !== null ? ` (${fmt_int(c.replayed_tokens)} tokens)` : ""}
                    {c.dropped_messages !== null ? `, left out ${plural_n(c.dropped_messages, "message")}${c.dropped_tokens ? ` (${fmt_int(c.dropped_tokens)} tokens)` : ""}` : ""}
                  </span>
                ) : null}
              </span>
            )}
          />
          <FactRow
            id="outputs_to"
            label="Outputs go to"
            fact={after.outputs_to}
            render={(root) => (
              <span className="ap_workspace">
                <code className="ap_path">{root}</code>
                {show_folder}
                {does.artifacts.length ? <span className="ap_muted">· {plural_n(does.artifacts.length, "artifact")} in the output</span> : null}
              </span>
            )}
          />
          <FactRow id="next" label="Next" fact={after.next} render={(n) => <span>{n.text}</span>} copy={(n) => (n.at_ms !== null ? new Date(n.at_ms).toISOString() : n.text)} />
        </Group>
      </div>
    </Block>
  );
}

// --- Inputs → Outputs ------------------------------------------------------------------

function PinsBlock(props: { p: AgentPageProps }): React.ReactElement {
  const { p } = props;
  const pins = useMemo(() => fold_pins(p.flow, p.input_data, p.detail), [p.flow, p.input_data, p.detail]);
  const provided = pins.inputs.filter((x) => x.state === "value").length;
  const flow_note: React.ReactNode = p.loading.flow ? (
    <Note kind="loading">loading the flow…</Note>
  ) : p.errors.flow ? (
    <Note kind="error">the flow did not load ({p.errors.flow}): pin types unknown</Note>
  ) : !pins.flow_found ? (
    <Note kind="absent">no flow JSON for this run: pin types unknown</Note>
  ) : !pins.start_found ? (
    <Note kind="absent">the flow has no On Flow Start node</Note>
  ) : null;
  const in_note: React.ReactNode = p.loading.input_data ? (
    <Note kind="loading">loading the run's inputs…</Note>
  ) : p.errors.input_data ? (
    <Note kind="error">inputs unavailable: {p.errors.input_data}</Note>
  ) : p.input_data ? (
    <Note kind="info">values as the run holds them now: the gateway reads the run's current variables, so a pin the run writes back (context) shows its latest value</Note>
  ) : null;
  const out_note: React.ReactNode = p.loading.detail ? (
    <Note kind="loading">loading the run detail…</Note>
  ) : p.errors.detail ? (
    <Note kind="error">output unavailable: {p.errors.detail}</Note>
  ) : pins.flow_found && !pins.end_found ? (
    <Note kind="absent">the flow has no On Flow End node</Note>
  ) : pins.end_is_passthrough ? (
    <Note kind="info">the end declares no pins: the run returns its last node's output</Note>
  ) : p.detail && !pins.outputs_final ? (
    <Note kind="info">values appear when the run ends</Note>
  ) : null;
  return (
    <Block id="pins" title="Inputs → Outputs">
      {flow_note}
      <div className="ap_io">
        <div className="ap_io_col">
          <h3 className="ap_io_title">
            Inputs
            {pins.inputs.length ? (
              <span className="ap_io_meta">
                {pins.inputs.length} pin{pins.inputs.length === 1 ? "" : "s"}
                {p.input_data ? ` · ${provided} provided` : ""}
              </span>
            ) : null}
          </h3>
          {in_note}
          <PinList
            side="in"
            label="Inputs"
            pins={pins.inputs}
            also={pins.also_sent}
            also_label="also sent"
            empty_text={pins.flow_found || p.input_data ? "no input pins" : "—"}
          />
        </div>
        <div className="ap_io_arrow" aria-hidden="true">
          →
        </div>
        <div className="ap_io_col">
          <h3 className="ap_io_title">
            Outputs
            {pins.outputs.length ? (
              <span className="ap_io_meta">
                {pins.end_is_passthrough ? "pass-through" : `${pins.outputs.length} pin${pins.outputs.length === 1 ? "" : "s"}`}
              </span>
            ) : null}
          </h3>
          {out_note}
          <PinList
            side="out"
            label="Outputs"
            pins={pins.outputs}
            also={pins.also_returned}
            also_label="also returned"
            outputs_final={pins.outputs_final}
            empty_text={pins.flow_found ? "no output pins" : "—"}
          />
        </div>
      </div>
    </Block>
  );
}

// --- Context ---------------------------------------------------------------------------

function ContextBlock(props: { p: AgentPageProps }): React.ReactElement {
  const { p } = props;
  const c = useMemo(() => fold_context(p.detail), [p.detail]);
  if (p.loading.detail && !p.detail) {
    return (
      <Block id="context" title="Context">
        <Note kind="loading">loading the run detail…</Note>
      </Block>
    );
  }
  if (!p.detail) {
    return (
      <Block id="context" title="Context">
        {p.errors.detail ? <Note kind="error">run detail unavailable: {p.errors.detail}</Note> : <Note kind="absent">run detail not loaded</Note>}
      </Block>
    );
  }
  const t = c.tokens;
  const pct_text = t?.pct !== null && t?.pct !== undefined ? `${t.pct < 10 && t.pct > 0 ? t.pct.toFixed(1) : Math.round(t.pct)}%` : "";
  const policy_bits = [c.policy, c.strict === true ? "strict" : "", c.session_kind ? `${c.session_kind} session` : ""].filter(Boolean);
  const history = p.detail?.session_history;
  return (
    <Block id="context" title="Context">
      <dl className="ap_ptable">
        <Row id="window" label="Window" source={c.has_history ? "run" : ""} copy={c.has_history ? copy_text_of(history) : null}>
          {c.has_history ? (
            <span className="ap_window_note">{c.window_note || "the session-history receipt carries no counts"}</span>
          ) : (
            <span className="ap_absent">— no session history replayed into this run</span>
          )}
        </Row>
        {c.has_history ? (
          <Row id="history_policy" label="History policy" source="run" copy={policy_bits.length ? policy_bits.join(" · ") : null}>
            {policy_bits.length ? policy_bits.join(" · ") : <span className="ap_absent">— not on this wire</span>}
            {c.token_estimator ? (
              <span className="ap_source" title={c.token_estimator}>
                estimated
              </span>
            ) : null}
          </Row>
        ) : null}
        <Row id="tokens" label="Tokens" source={t ? "run" : ""} copy={t ? copy_text_of(p.detail?.limits?.tokens ?? t) : null}>
          {t && (t.used !== null || t.budget !== null) ? (
            <span className={`ap_gauge_wrap ${t.over_warn ? "ap_gauge_over" : ""}`}>
              <span className="ap_gauge_text">
                {t.used !== null ? fmt_int(t.used) : "—"}
                {t.budget !== null ? ` of ${fmt_int(t.budget)}` : ""}
                {t.max_input_tokens !== null ? " input" : ""} tokens{pct_text ? ` (${pct_text})` : ""}
                {t.warn_pct !== null ? ` · warns at ${t.warn_pct}%` : ""}
              </span>
              {t.pct !== null ? (
                <span
                  className="ap_gauge"
                  role="meter"
                  aria-label="Context tokens used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(100, t.pct))}
                >
                  <span className="ap_gauge_fill" style={{ width: `${Math.min(100, Math.max(0, t.pct))}%` }} />
                  {t.warn_pct !== null ? <span className="ap_gauge_warn" style={{ left: `${Math.min(100, Math.max(0, t.warn_pct))}%` }} /> : null}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="ap_absent">— no token estimate on this run</span>
          )}
        </Row>
        <Row id="flow_warnings" label="Flow warnings" source={p.detail ? "run" : ""} copy={c.flow_warnings.length ? c.flow_warnings.join("\n") : null}>
          {c.flow_warnings.length ? (
            <ul className="ap_warnings">
              {c.flow_warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <span className="ap_muted">none</span>
          )}
        </Row>
      </dl>
    </Block>
  );
}

// --- Run tree --------------------------------------------------------------------------

function node_name(run: RunSummary): string {
  const wf = workflow_short(String(run.workflow_id || "")) || "(workflow?)";
  const role = String(run.role || "").trim();
  if (role === "occurrence" && typeof run.occurrence_index === "number") return `run #${run.occurrence_index} · ${wf}`;
  return wf;
}

function TreeItem(props: { node: TreeNode; ctx: StateContext; on_open_run(run_id: string): void }): React.ReactElement {
  const { node, ctx } = props;
  const run = node.run;
  const line = state_line(run, ctx);
  const word = pill_word(run, line);
  const id = String(run.run_id || "");
  return (
    <li className="ap_tree_item">
      <button
        type="button"
        className={`ap_tree_node ${node.is_subject ? "ap_tree_subject" : ""}`}
        aria-current={node.is_subject ? "true" : undefined}
        title={`Open run ${id}`}
        data-run-id={id}
        onClick={() => props.on_open_run(id)}
      >
        <span className={`chip ${run_status_class(word)}`}>{word}</span>
        <span className="ap_tree_name">{node_name(run)}</span>
        <span className={`ap_tree_line ${line.stalled ? "ap_stalled" : ""}`}>{line.text}</span>
      </button>
      {node.children.length ? (
        <ul className="ap_tree_children">
          {node.children.map((c) => (
            <TreeItem key={String(c.run.run_id)} node={c} ctx={ctx} on_open_run={props.on_open_run} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// --- Spend -----------------------------------------------------------------------------

function n_or_dash(n: number | null): string {
  return n === null ? "—" : fmt_int(n);
}

// --- the page --------------------------------------------------------------------------

export function AgentPage(props: AgentPageProps): React.ReactElement {
  const now_ms = typeof props.now_ms === "number" ? props.now_ms : Date.now();
  const subject = useMemo(() => merged_subject(props.run, props.detail), [props.run, props.detail]);
  const subject_id = String(subject.run_id || "").trim();
  const fresh = detail_is_fresh(props.run, props.detail);
  const brief: AutomationBrief | null = useMemo(
    () => props.automation ?? (props.automation_body ? fold_automation_brief(props.automation_body) : null),
    [props.automation, props.automation_body],
  );
  const all_runs = useMemo(() => upsert(props.runs || [], subject), [props.runs, subject]);
  const ctx = useMemo(() => {
    const details = new Map<string, any>();
    if (props.detail && fresh) details.set(subject_id, props.detail);
    const automations = new Map<string, AutomationBrief>();
    if (brief?.automation_id) automations.set(brief.automation_id, brief);
    return make_context(all_runs, { now_ms, details, pulses: props.pulses, automations, stall_after_ms: props.stall_after_ms });
  }, [all_runs, props.detail, fresh, subject_id, brief, now_ms, props.pulses, props.stall_after_ms]);

  const line = state_line(subject, ctx);
  const subj = subject_of(subject, ctx);
  const excerpt = String(props.input_data?.input_data?.prompt || "").trim();
  const title = card_title(subject, ctx, excerpt ? { run_id: subject_id, excerpt } : null);
  const word = pill_word(subject, line, stop_reason_of(props.detail), props.automation);
  const subject_bits = [subj.label && subj.label !== title.text ? subj.label : "", subj.secondary].filter(Boolean);
  const action = header_action(line, subject_id);

  const prof = useMemo(
    () => fold_agent_profile(props.detail, props.input_data, props.flow, props.automation_body ?? brief, props.records, all_runs, now_ms, { subject_run_id: subject_id, row: subject }),
    [props.detail, props.input_data, props.flow, props.automation_body, brief, props.records, all_runs, now_ms, subject_id, subject],
  );
  const tree = useMemo(() => fold_tree(subject_id, all_runs), [subject_id, all_runs]);
  const spend = useMemo(() => fold_spend(tree, all_runs, now_ms), [tree, all_runs, now_ms]);
  const controller_title = brief?.title || "automation";

  return (
    <article className="ap_page" data-run-id={subject_id}>
      <header className="ap_header">
        <div className="ap_title_row">
          <span className={`ap_mark ap_mark_${subj.kind}`} title={subj.kind}>
            {subj.glyph}
          </span>
          <h1 className={`ap_title ${title.untitled ? "ap_untitled" : ""}`} title={`Title from: ${title.source}`}>
            {title.text}
          </h1>
          {title.untitled ? <span className="ap_untitled_tag">untitled</span> : null}
          <span className={`chip ${run_status_class(word, stop_reason_of(props.detail))}`}>{word}</span>
          <CopyId run_id={subject_id} on_copy={props.on_copy} />
        </div>
        {subject_bits.length ? <div className="ap_subject_line">{subject_bits.join(" · ")}</div> : null}
        <div className={`ap_state ap_verb_${line.verb} ${line.stalled ? "ap_stalled" : ""}`} data-lane={line.lane}>
          <span className="ap_state_text">{line.text}</span>
          <ActorBadge line={line} ctx={ctx} on_open_run={props.on_open_run} />
          {action ? (
            <button type="button" className={`btn ${line.actor === "you" ? "primary" : ""} ap_action`} onClick={() => props.on_action(action.action, action.run_id)}>
              {action.label}
            </button>
          ) : null}
        </div>
        {props.loading.detail ? <Note kind="loading">reading the run detail… (the line above is from the listing row)</Note> : null}
        {props.errors.detail ? <Note kind="error">run detail unavailable: {props.errors.detail} (the line above is from the listing row)</Note> : null}
        {props.detail && !fresh ? <Note kind="info">the listing row is newer than the detail: the line above is from the row</Note> : null}
      </header>

      <ProfileBlock prof={prof} p={props} line={line} ctx={ctx} />
      <PinsBlock p={props} />
      <ContextBlock p={props} />

      <Block id="tree" title="Run tree" meta={tree.size ? `${tree.size} run${tree.size === 1 ? "" : "s"}` : undefined}>
        {!tree.root ? (
          <Note kind="absent">this run is not among the loaded rows</Note>
        ) : (
          <>
            {tree.controller_id ? (
              <button
                type="button"
                className="ap_tree_parent"
                title={`Open the automation's controller run ${tree.controller_id}`}
                data-run-id={tree.controller_id}
                onClick={() => props.on_open_run(tree.controller_id)}
              >
                <span className="ap_mark ap_mark_automation">⟳</span>
                <span className="ap_tree_name">{controller_title}</span>
                <span className="ap_tree_line">
                  {tree.controller ? state_line(tree.controller, ctx).text : "controller (row not loaded)"} · other occurrences not shown
                </span>
              </button>
            ) : null}
            <ul className={`ap_tree ${tree.controller_id ? "ap_tree_under_parent" : ""}`}>
              <TreeItem node={tree.root} ctx={ctx} on_open_run={props.on_open_run} />
            </ul>
          </>
        )}
      </Block>

      <Block id="spend" title="Spend" meta="tree-inclusive">
        {!spend.any_metrics ? <Note kind="absent">token and call counts not loaded: these rows were listed without metrics</Note> : null}
        {spend.rows.length ? (
          <div className="ap_table_wrap">
            <table className="ap_spend">
              <caption>Tree-inclusive: each row counts its own run and every run below it, so rows do not add up.</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Time</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">LLM calls</th>
                  <th scope="col">Tool calls</th>
                  <th scope="col">Steps</th>
                </tr>
              </thead>
              <tbody>
                {spend.rows.map((r) => {
                  const run = ctx.by_id.get(r.run_id);
                  return (
                    <tr key={r.run_id} className={r.is_subject ? "ap_spend_subject" : undefined} data-run-id={r.run_id}>
                      <th scope="row" className="ap_copyable" style={{ ["--ap-depth" as any]: r.depth }}>
                        <span className="ap_spend_name">{run ? node_name(run) : "run (row not loaded)"}</span>
                        <CopyButton text={r.run_id} label="run id" />
                      </th>
                      <td>{r.duration_ms === null ? "—" : `${format_duration_ms(r.duration_ms)}${r.running ? " so far" : ""}`}</td>
                      <td>{n_or_dash(r.tokens_total)}</td>
                      <td>{n_or_dash(r.llm_calls)}</td>
                      <td>{n_or_dash(r.tool_calls)}</td>
                      <td>{n_or_dash(r.steps)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Note kind="absent">no rows</Note>
        )}
      </Block>

      <Block id="ask" title="Ask">
        <p className="ap_window_note">{props.ask_window_note || "Ask a question about this run and the runs below it."}</p>
        <button type="button" className="btn primary ap_ask" onClick={() => props.on_ask()}>
          Ask about this run
        </button>
      </Block>
    </article>
  );
}
