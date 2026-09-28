/**
 * The Automations page: one row per automation of the signed-in gateway user
 * (`GET /api/gateway/automations`, full pages, polled every 30 s while the page
 * is visible) and the kit's `AutomationPanel` for the selected one.
 *
 * The list view (`AutomationsListView`) and the panel wiring
 * (`automation_panel_props`) are hook-free so the tests render them in any
 * state and call their handlers without a DOM; `AutomationsPage` only
 * subscribes to the controller and runs the poll timer.
 */
import React, { useEffect, useState, useSyncExternalStore } from "react";

import {
  AutomationPanelWithMarkdown,
  WorkspaceBrowser,
  renderAutomationText,
  type AutomationPanelWithMarkdownProps,
  type GatewayFetch,
} from "@abstractframework/panel-chat";
import {
  AutomationStateLabel as KitAutomationStateLabel,
  CONTROL_ICONS,
  CONTROL_LABELS,
  DISCUSS_LABEL,
  controlHint,
  type ControlId,
  Icon,
  type IconName,
  apiErrorText,
  type AutomationCommandType,
  type AutomationStatus,
  type AutomationSummary,
  type DiscussResponse,
} from "@abstractframework/ui-kit";

import type { GatewayClient } from "../lib/gateway_client";
import { AutomationDiscussion, type OpenDiscussion } from "./automation_discussion";
import {
  AUTOMATIONS_POLL_MS,
  discuss_index,
  automation_row_controls,
  LAUNCH_AUTOMATE_HASH,
  archived_count,
  automation_row_view,
  discussion_notice,
  visible_automations,
  is_legacy_summary,
  legacy_row_controls,
  type AutomationsController,
  type AutomationsState,
  type LegacyAction,
  type RowAction,
} from "./automations";
import "./automations.css";

export type AutomationsHandlers = {
  on_select(id: string): void;
  on_row_action(summary: AutomationSummary, action: RowAction): void;
  on_legacy_action(summary: AutomationSummary, action: LegacyAction): void;
  on_confirm_archive(summary: AutomationSummary): void;
  on_cancel_archive(): void;
  on_status_filter(status: AutomationStatus | ""): void;
  on_refresh(): void;
  on_new(): void;
  on_show_archived(show: boolean): void;
  /** Dismiss the list's feedback line / error (the page wires these to the controller). */
  on_dismiss_notice?(): void;
  on_dismiss_error?(): void;
};

/** How long the list's feedback line stays (it can also be dismissed). */
export const LIST_NOTICE_MS = 5000;

const STATUS_FILTERS: Array<[AutomationStatus | "", string]> = [
  ["", "All"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["completed", "Completed"],
  ["failed", "Failed"],
  ["archived", "Archived"],
];

/** One name and one icon per action: the kit's (the panel uses the same). */
const ROW_LABELS: Record<RowAction, string> = {
  pause: CONTROL_LABELS.pause,
  resume: CONTROL_LABELS.resume,
  run_now: CONTROL_LABELS.run_now,
  edit: CONTROL_LABELS.revise,
  archive: `${CONTROL_LABELS.archive}…`,
  discuss: CONTROL_LABELS.discuss,
};

export const ROW_ICONS: Record<RowAction, IconName> = {
  pause: CONTROL_ICONS.pause,
  resume: CONTROL_ICONS.resume,
  run_now: CONTROL_ICONS.run_now,
  edit: CONTROL_ICONS.revise,
  archive: CONTROL_ICONS.archive,
  discuss: CONTROL_ICONS.discuss,
};

/** Row action → the kit control whose hint (tooltip + aria-description) it carries. */
const ROW_CONTROL: Record<RowAction, ControlId> = {
  pause: "pause",
  resume: "resume",
  run_now: "run_now",
  edit: "revise",
  archive: "archive",
  discuss: "discuss",
};

const LEGACY_ICONS: Record<LegacyAction, IconName> = {
  legacy_pause: CONTROL_ICONS.pause,
  legacy_resume: CONTROL_ICONS.resume,
  legacy_run_now: CONTROL_ICONS.run_now,
  open_run: "list",
  recreate: "refresh",
};

/** The state as WORD then ICON: the kit's one rendering, in a row field. */
export function AutomationStateLabel(props: { status: AutomationStatus }): React.ReactElement {
  return (
    <span className="auto_state" data-field="state">
      <KitAutomationStateLabel status={props.status} />
    </span>
  );
}

function Fact(props: { icon: IconName; field: string; label: string; children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    <span className={`auto_fact${props.className ? ` ${props.className}` : ""}`} data-field={props.field} title={props.label}>
      <Icon name={props.icon} size={12} />
      <span>{props.children}</span>
    </span>
  );
}

const LEGACY_LABELS: Record<LegacyAction, string> = {
  legacy_pause: "Suspend",
  legacy_resume: "Resume",
  legacy_run_now: "Run now",
  open_run: "Open run",
  recreate: "Recreate as automation",
};

function AutomationRow(props: { summary: AutomationSummary; state: AutomationsState; h: AutomationsHandlers }): React.ReactElement {
  const s = props.summary;
  const v = automation_row_view(s);
  const selected = props.state.selected_id === s.automation_id;
  const busy = props.state.busy;
  // `iconOnly`: the label becomes the button's accessible name and leads its tooltip.
  // `hint`: what the control does (the kit's `controlHint`), the tooltip after the
  // label/reason and the button's aria-description.
  const btn = (key: string, label: string, ctl: { enabled: boolean; reason?: string }, onClick: () => void, extra?: string, icon?: IconName, iconOnly?: boolean, hint?: string) => (
    <button
      key={key}
      type="button"
      className={`btn btn_sm auto_action${iconOnly ? " auto_action_icon" : ""}${extra ? ` ${extra}` : ""}`}
      data-action={key}
      disabled={!ctl.enabled}
      title={[iconOnly ? label : null, ctl.enabled ? null : ctl.reason, hint].filter(Boolean).join("\n") || undefined}
      aria-label={iconOnly ? label : undefined}
      aria-description={hint}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {iconOnly ? null : <span>{label}</span>}
    </button>
  );
  let actions: React.ReactNode;
  if (v.legacy) {
    const c = legacy_row_controls(s, busy);
    const order: LegacyAction[] = [s.status === "paused" ? "legacy_resume" : "legacy_pause", "legacy_run_now", "open_run", "recreate"];
    actions = order.map((a) => btn(a, LEGACY_LABELS[a], c[a], () => props.h.on_legacy_action(s, a), undefined, LEGACY_ICONS[a]));
  } else {
    const c = automation_row_controls(s, busy);
    // Archive (destructive, rare) is the icon at the end of the row.
    const order: RowAction[] = [s.status === "paused" ? "resume" : "pause", "run_now", "edit", "discuss", "archive"];
    actions = order.map((a) =>
      btn(a, ROW_LABELS[a], c[a], () => props.h.on_row_action(s, a), a === "archive" ? "danger auto_action_end" : undefined, ROW_ICONS[a], a === "archive", controlHint(ROW_CONTROL[a], s)),
    );
  }
  const confirming = props.state.confirm_archive_id === s.automation_id;
  return (
    <li className={`auto_row${selected ? " selected" : ""}`} data-automation-id={s.automation_id} data-legacy={v.legacy ? "true" : undefined}>
      <button type="button" className="auto_row_main" onClick={() => props.h.on_select(s.automation_id)} aria-current={selected ? "true" : undefined}>
        <span className="auto_row_title">
          {v.title}
          {v.legacy ? <span className="chip scheduled">legacy</span> : null}
          <AutomationStateLabel status={v.state} />
          {v.attention ? (
            <span className="chip warn auto_row_attention" data-field="attention">
              <Icon name="warning" size={12} /> {v.attention}
            </span>
          ) : null}
        </span>
        <span className="auto_row_facts">
          <Fact icon="refresh" field="cadence" label="When it runs">
            {v.cadence}
          </Fact>
          {v.current ? (
            <Fact icon="loader" field="current" label="Running now" className="auto_row_current">
              {v.current}
            </Fact>
          ) : null}
          <Fact icon="clock" field="next" label="Next run">
            next: {v.next_run}
          </Fact>
          <Fact icon="info" field="last-status" label="Last run">
            {v.last_status}
          </Fact>
        </span>
        {v.last ? (
          <span className="auto_row_excerpt" data-field="excerpt">
            {renderAutomationText(v.last)}
          </span>
        ) : null}
      </button>
      <div className="auto_row_actions" role="toolbar" aria-label={`Controls for ${v.title}`}>
        {actions}
      </div>
      {confirming ? (
        <div className="auto_row_confirm" role="group" aria-label="Confirm archive">
          <span>Archive “{v.title}”? Its history stays readable; it will not run again.</span>
          <button type="button" className="btn btn_sm danger auto_action" data-action="archive-confirm" disabled={busy} onClick={() => props.h.on_confirm_archive(s)}>
            <Icon name="archive" size={13} />
            <span>Archive</span>
          </button>
          <button type="button" className="btn btn_sm auto_action" data-action="archive-cancel" onClick={props.h.on_cancel_archive}>
            <Icon name="x" size={13} />
            <span>Keep it</span>
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** The list half of the page (hook-free). */
export function AutomationsListView(props: { state: AutomationsState; available: { available: boolean; reason: string }; h: AutomationsHandlers }): React.ReactElement {
  const st = props.state;
  const shown = st.error ?? st.list_error;
  const err = shown ? apiErrorText(shown) : null;
  return (
    <section className="pane auto_list" aria-label="Automations">
      <div className="pane_header">
        <span className="pane_title">Automations</span>
        <span className="pane_count">{visible_automations(st).length}</span>
        <span className="pane_spacer" />
        <select className="seg_select" value={st.status_filter} onChange={(e) => props.h.on_status_filter(e.target.value as AutomationStatus | "")} aria-label="Filter by status">
          {STATUS_FILTERS.map(([v, l]) => (
            <option key={v || "all"} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn_sm auto_icon_btn"
          data-action="refresh"
          onClick={props.h.on_refresh}
          disabled={st.loading || !props.available.available}
          title="Refresh"
          aria-label="Refresh"
        >
          <Icon name={st.loading ? "loader" : "refresh"} size={14} />
        </button>
        <a
          className={`btn btn_sm auto_new${props.available.available ? "" : " disabled"}`}
          data-action="new"
          href={LAUNCH_AUTOMATE_HASH}
          aria-disabled={!props.available.available}
          title="New automation: opens Launch in Automate mode"
          aria-label="New automation"
          onClick={(e) => {
            e.preventDefault();
            if (props.available.available) props.h.on_new();
          }}
        >
          <Icon name="plus" size={14} />
          <span className="auto_new_label">New automation</span>
        </a>
      </div>
      <div className="pane_body scroll">
        {!props.available.available ? (
          <div className="warn_callout" role="note" data-unavailable="true">
            {props.available.reason}
          </div>
        ) : null}
        {err ? (
          <div className="observe_context_card error auto_list_error" role="alert" data-code={shown?.code}>
            <Icon name="error" size={14} />
            <span className="auto_list_msg">
              <strong>{err.title}</strong> <span>{err.detail}</span>
            </span>
            {st.error && props.h.on_dismiss_error ? (
              <button type="button" className="auto_dismiss" data-action="dismiss-error" aria-label="Dismiss" title="Dismiss" onClick={props.h.on_dismiss_error}>
                <Icon name="x" size={12} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={`auto_notice${st.notice ? " on" : ""}`} role="status">
          {st.notice ? (
            <>
              <Icon name="check" size={13} />
              <span className="auto_list_msg">{st.notice}</span>
              {props.h.on_dismiss_notice ? (
                <button type="button" className="auto_dismiss" data-action="dismiss-notice" aria-label="Dismiss" title="Dismiss" onClick={props.h.on_dismiss_notice}>
                  <Icon name="x" size={12} />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        {props.available.available && st.loaded && !st.items.length ? (
          <div className="help_text muted">No automations yet. Create one from Launch → Automate.</div>
        ) : null}
        {archived_count(st) > 0 && st.status_filter !== "archived" ? (
          <label className="auto_show_archived help_text muted">
            <input type="checkbox" data-action="show-archived" checked={st.show_archived} onChange={(e) => props.h.on_show_archived(e.target.checked)} /> Show archived ({archived_count(st)})
          </label>
        ) : null}
        <ul className="auto_rows">
          {visible_automations(st).map((s) => (
            <AutomationRow key={s.automation_id} summary={s} state={st} h={props.h} />
          ))}
        </ul>
      </div>
    </section>
  );
}

export type PanelHostHandlers = {
  on_open_run(run_id: string): void;
  /** Browse a run's folder (the automation id = its controller run). Absent: no folder controls. */
  on_open_workspace?(run_id: string): void;
  /** Credentialed gateway request (`GatewayClient.fetch_gateway`): the panel opens a run's ledger and
   * artifacts through it (panel-chat `openGatewayResource`, safe tab-open), never as raw links. */
  fetch_gateway?: GatewayFetch;
  /** A discussion was forked at occurrence `index` (the full gateway answer, both workspace paths included). */
  on_open_session(session: DiscussResponse, notice: string, index: number): void;
};

/**
 * The kit panel's props for the selected automation, wired to the controller
 * (and through it to the gateway). Null when nothing (non-legacy) is open.
 */
/** The panel's Edit form, driven by the page (a row's Edit opens it at once). */
export type PanelEdit = { open: boolean; on_change(open: boolean): void };

export function automation_panel_props(ctl: AutomationsController, host: PanelHostHandlers, edit?: PanelEdit): AutomationPanelWithMarkdownProps | null {
  const st = ctl.state;
  const d = st.detail;
  if (!d || is_legacy_summary(d.summary)) return null;
  const id = d.automation_id;
  return {
    summary: d.summary,
    ...(d.definition ? { definition: d.definition } : {}),
    occurrences: d.occurrences,
    triggerSources: st.trigger_sources,
    busy: st.busy,
    ...(d.error ? { error: d.error } : {}),
    // The panel mints one id per user action and reuses it on retry: forward
    // it so a retried command/discussion is idempotent at the gateway.
    onRevise: (changes, expected, meta) => ctl.revise(id, changes, expected, meta?.command_id),
    onCommand: (type, payload, meta) => ctl.command(id, type as AutomationCommandType, payload as Record<string, any> | undefined, meta?.command_id),
    onDiscuss: async (index, prompt, meta) => {
      const r = await ctl.discuss(id, index, prompt, meta?.request_id);
      host.on_open_session(r, discussion_notice(index, r), index);
      return r;
    },
    onSeen: (cursor) => ctl.seen(id, cursor),
    onLoadMore: () => void ctl.load_more(),
    onOpenRun: (run_id) => host.on_open_run(run_id),
    ...(host.on_open_workspace ? { onOpenWorkspace: host.on_open_workspace } : {}),
    ...(host.fetch_gateway ? { fetchGateway: host.fetch_gateway } : {}),
    onAnswerWait: (run_id, wait_key, payload) => ctl.answer_wait(id, run_id, wait_key, payload as Record<string, any>),
    ...(edit ? { editOpen: edit.open, onEditOpenChange: edit.on_change } : {}),
  };
}

/** The detail half: the kit panel, or the legacy explanation. Hook-free.
 * `browser` (a folder browser the host opened through the panel's
 * `onOpenWorkspace`) shows above the panel. */
export function AutomationDetailView(props: {
  ctl: AutomationsController;
  host: PanelHostHandlers;
  h: AutomationsHandlers;
  browser?: React.ReactNode;
  edit?: PanelEdit;
}): React.ReactElement {
  const d = props.ctl.state.detail;
  if (!d && props.ctl.state.selected_id) {
    return (
      <section className="pane auto_detail auto_detail_empty" aria-busy="true">
        <div className="help_text muted">Loading…</div>
      </section>
    );
  }
  if (!d) {
    return (
      <section className="pane auto_detail auto_detail_empty">
        <div className="help_text muted">Select an automation to read its runs as a conversation, change it, or discuss a result ({DISCUSS_LABEL.toLowerCase()}).</div>
      </section>
    );
  }
  if (is_legacy_summary(d.summary)) {
    const v = automation_row_view(d.summary);
    return (
      <section className="pane auto_detail" data-legacy="true">
        <div className="pane_header">
          <span className="pane_title">{v.title}</span>
          <span className="chip scheduled">legacy</span>
        </div>
        <div className="pane_body">
          <p className="help_text">
            A schedule created before automations ({v.cadence}). It keeps working with its existing controls: suspend, resume, run now and edit the
            interval from its run view. “Recreate as automation” opens Launch → Automate prefilled with its workflow, inputs and interval; the legacy
            schedule is not changed.
          </p>
          <div className="auto_row_actions">
            <button type="button" className="btn btn_sm" data-action="open_run" onClick={() => props.h.on_legacy_action(d.summary, "open_run")}>
              Open run
            </button>
            <button type="button" className="btn btn_sm primary" data-action="recreate" onClick={() => props.h.on_legacy_action(d.summary, "recreate")}>
              Recreate as automation
            </button>
          </div>
        </div>
      </section>
    );
  }
  const p = automation_panel_props(props.ctl, props.host, props.edit);
  // Occurrence turns render as the shared chat cards (panel-chat), text
  // through the shared renderer (markdown, tables, code, JSON).
  return (
    <section className="pane auto_detail">
      {props.browser ?? null}
      {p ? <AutomationPanelWithMarkdown {...p} /> : null}
    </section>
  );
}

/** Where a row action goes: Discuss opens a chat with a fork at the latest
 * finished occurrence ON THIS PAGE; Edit selects the automation and opens
 * its Edit form at once, on this page; everything else goes to the app handlers. */
export function route_row_action(
  summary: AutomationSummary,
  action: RowAction,
): { kind: "discuss"; index: number } | { kind: "edit" } | { kind: "forward" } | { kind: "none" } {
  if (action === "edit") return { kind: "edit" };
  if (action !== "discuss") return { kind: "forward" };
  const index = discuss_index(summary);
  return index === null ? { kind: "none" } : { kind: "discuss", index };
}

/** Stateful page: subscribes to the controller, polls while visible; owns the
 * open discussion (a chat in place, never a jump to Observe) and the folder
 * browser toggle. */
export function AutomationsPage(props: {
  ctl: AutomationsController;
  gateway: GatewayClient;
  active: boolean;
  available: { available: boolean; reason: string };
  host: PanelHostHandlers;
  h: AutomationsHandlers;
}): React.ReactElement {
  const ctl = props.ctl;
  const [discussion, set_discussion] = useState<(OpenDiscussion & { opened: number }) | null>(null);
  const open_discussion = (d: OpenDiscussion) => set_discussion((prev) => ({ ...d, opened: (prev?.opened || 0) + 1 }));
  /** The run whose folder is open (the automation's own id = its folder), or "". */
  const [files_run, set_files_run] = useState("");
  /** The automation whose Edit form is open, or "". */
  const [edit_id, set_edit_id] = useState("");
  useSyncExternalStore(
    (fn) => ctl.subscribe(fn),
    () => ctl.state,
    () => ctl.state,
  );
  const [visible, set_visible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => set_visible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  useEffect(() => {
    if (!props.active || !visible || !props.available.available) return;
    void ctl.refresh();
    const t = window.setInterval(() => void ctl.refresh(), AUTOMATIONS_POLL_MS);
    return () => window.clearInterval(t);
  }, [ctl, props.active, visible, props.available.available]);
  const detail = ctl.state.detail;
  // The list's feedback line is brief.
  const notice = ctl.state.notice;
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => ctl.dismiss_notice(), LIST_NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [ctl, notice]);
  // The kit panel's per-occurrence Discuss has already forked when this runs:
  // the chat opens on that session, here.
  const host: PanelHostHandlers = {
    ...props.host,
    on_open_workspace: (run_id) => set_files_run((cur) => (cur === run_id ? "" : run_id)),
    fetch_gateway: props.gateway.fetch_gateway,
    on_open_session: (session, notice, index) => {
      props.host.on_open_session(session, notice, index);
      if (!detail) return;
      open_discussion({ automation_id: detail.automation_id, automation_title: detail.summary.title, occurrence_index: index, session });
    },
  };
  const h: AutomationsHandlers = {
    ...props.h,
    on_select: (id) => {
      set_discussion(null);
      set_files_run("");
      if (id !== edit_id) set_edit_id("");
      props.h.on_select(id);
    },
    on_dismiss_notice: () => ctl.dismiss_notice(),
    on_dismiss_error: () => ctl.dismiss_error(),
    on_row_action: (summary, action) => {
      const route = route_row_action(summary, action);
      if (route.kind === "forward") props.h.on_row_action(summary, action);
      else if (route.kind === "edit") {
        set_discussion(null);
        set_files_run("");
        set_edit_id(summary.automation_id);
        props.h.on_select(summary.automation_id);
      } else if (route.kind === "discuss") {
        props.h.on_select(summary.automation_id);
        open_discussion({ automation_id: summary.automation_id, automation_title: summary.title, occurrence_index: route.index });
      }
    },
  };
  return (
    <div className="page auto_page">
      <AutomationsListView state={ctl.state} available={props.available} h={h} />
      {discussion ? (
        <AutomationDiscussion
          key={discussion.opened}
          gateway={props.gateway}
          discussion={discussion}
          connected={props.active}
          on_fork={async (automation_id, index, prompt) => {
            const r = await ctl.discuss(automation_id, index, prompt);
            props.host.on_open_session(r, discussion_notice(index, r), index);
            set_discussion((prev) => (prev ? { ...prev, session: r } : prev));
            return r;
          }}
          on_close={() => set_discussion(null)}
        />
      ) : (
        <AutomationDetailView
          ctl={ctl}
          host={host}
          h={h}
          edit={{
            open: !!detail && edit_id === detail.automation_id,
            on_change: (open) => set_edit_id(open && detail ? detail.automation_id : ""),
          }}
          browser={
            files_run ? (
              <WorkspaceBrowser
                fetchGateway={props.gateway.fetch_gateway}
                runId={files_run}
                title={files_run === detail?.automation_id ? "Automation files" : "Run files"}
                onClose={() => set_files_run("")}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
