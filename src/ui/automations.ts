/**
 * Automations v1 in the Observer — the pure rules and the page controller.
 *
 * The Observer executes nothing: every action is a gateway route (contract F
 * of untracked/design/automations-CONTRACTS.md rev 2), reached through the
 * ui-kit client (`createAutomationsClient`). Presentation rules that the
 * Assistant shares (cadence labels, controls, occurrence chat pairs, error
 * text, the create body) come from the kit; this module owns what is the
 * Observer's own:
 *
 * - the Launch picker's target choice, including the gateway default agent
 *   (`@default` + interface);
 * - the Automate-mode form → `POST /api/gateway/automations` body;
 * - run-row tagging by gateway attribution (`role`, `session_kind`) — never by
 *   a workflow-id prefix;
 * - the Automations page controller (full-page polling, commands, discuss,
 *   seen, waits, legacy rows);
 * - "Recreate as automation" prefill from a legacy schedule.
 *
 * Structure only: nothing here reads model prose.
 */
import {
  attentionLabel,
  automationControls,
  currentOccurrenceLabel,
  relativeIn,
  buildCreateRequest,
  formatUtc,
  isApiError,
  scheduleLabel,
  triggerSummary,
  type ApiError,
  type AutomationChanges,
  type AutomationCommandType,
  type AutomationDefinition,
  type AutomationStatus,
  type AutomationSummary,
  type AutomationTarget,
  type AutomationsClient,
  type CommandReceipt,
  type ContextMode,
  type CreateAutomationRequest,
  type DiscussResponse,
  type OccurrenceRow,
  type ScheduleForm,
  type ToolApprovalPolicy,
  type TriggerSourceEntry,
} from "@abstractframework/ui-kit";

import type { RunSummary } from "./run_status";

// --- launch target -------------------------------------------------------------

/** Picker value prefix for the gateway default agent of an interface. */
export const DEFAULT_AGENT_PREFIX = "@default:";
/** The agent interface the gateway always lists with a built-in default
 * (abstractgateway agent_defaults.py: `BUILTIN_DEFAULT_BUNDLES`). */
export const CODE_AGENT_INTERFACE = "abstractcode.agent.v1";

export type WorkflowChoice =
  | { kind: "bundle"; bundle_id: string; flow_id: string }
  | { kind: "default"; interface: string };

/** `bundle:flow` or `@default:<interface>` → the choice, or null. */
export function parse_workflow_choice(value: string): WorkflowChoice | null {
  const s = String(value || "").trim();
  if (s.startsWith(DEFAULT_AGENT_PREFIX)) {
    const iface = s.slice(DEFAULT_AGENT_PREFIX.length).trim();
    return iface ? { kind: "default", interface: iface } : null;
  }
  const idx = s.indexOf(":");
  if (idx <= 0 || idx >= s.length - 1) return null;
  return { kind: "bundle", bundle_id: s.slice(0, idx), flow_id: s.slice(idx + 1) };
}

export function workflow_choice_value(choice: WorkflowChoice | null): string {
  if (!choice) return "";
  return choice.kind === "default" ? `${DEFAULT_AGENT_PREFIX}${choice.interface}` : `${choice.bundle_id}:${choice.flow_id}`;
}

export type DefaultAgentChoice = { interface: string; value: string; label: string };

/**
 * The gateway-default choices for the picker: the code-agent interface (the
 * gateway always has a built-in default for it) plus every interface a loaded
 * entrypoint is currently the gateway default for (`agent_default_interfaces`
 * on `/bundles` entrypoints). The label names the current default when known.
 */
export function default_agent_choices(options: Array<{ label: string; agent_default_interfaces?: string[] }>): DefaultAgentChoice[] {
  const current: Record<string, string> = {};
  for (const o of options) for (const iface of o.agent_default_interfaces || []) if (iface && !current[iface]) current[iface] = o.label;
  const ifaces = [CODE_AGENT_INTERFACE, ...Object.keys(current).filter((i) => i !== CODE_AGENT_INTERFACE).sort()];
  return ifaces.map((iface) => ({
    interface: iface,
    value: `${DEFAULT_AGENT_PREFIX}${iface}`,
    label: `Gateway default agent · ${iface}${current[iface] ? ` (now: ${current[iface]})` : ""}`,
  }));
}

/**
 * The create/revise target for a choice. A bundle flow needs its published
 * `bundle_ref` (`bundle_id@version`, from `/bundles`); the default agent is
 * sent as `{flow_id:"@default", interface}` and resolved by the gateway.
 */
export function automation_target(
  choice: WorkflowChoice | null,
  bundle_ref_for: (bundle_id: string) => string,
  input_data: Record<string, any>,
): AutomationTarget | null {
  if (!choice) return null;
  if (choice.kind === "default") return { flow_id: "@default", interface: choice.interface, input_data };
  const ref = String(bundle_ref_for(choice.bundle_id) || "").trim();
  if (!ref) throw new Error(`The gateway listed no bundle_ref for bundle "${choice.bundle_id}". Reload bundles, then try again.`);
  return { bundle_ref: ref, flow_id: choice.flow_id, input_data };
}

/** Submit-time whitespace hygiene (same rule as Run once): trim string edges,
 * drop empty strings. Interior whitespace is the user's. */
export function clean_input_data(input: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) out[k] = t;
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

// --- Launch modes and deep link ------------------------------------------------------

export type LaunchMode = "once" | "automate";

/** One sentence per mode: what the Launch button will do. */
export const LAUNCH_MODE_HELP: Record<LaunchMode, string> = {
  once: "Run once: start this workflow now, a single run you can watch in Observe.",
  automate:
    "Automate: create an automation that runs this workflow on a schedule (every N minutes, hours or days) or when you ask; manage it on the Automations page.",
};

/** Deep link to Launch in Automate mode (the Automations page's "+ New automation"). */
export const LAUNCH_AUTOMATE_HASH = "#launch/automate";

/** `#launch`, `#launch/once`, `#launch/automate`, `#automations` → the page (and Launch mode); anything else → null. */
export function parse_app_hash(hash: string): { page: "launch"; mode: LaunchMode } | { page: "automations" } | null {
  const h = String(hash || "").replace(/^#\/?/, "");
  if (h === "automations") return { page: "automations" };
  const m = /^launch(?:\/(once|automate))?$/.exec(h);
  return m ? { page: "launch", mode: (m[1] as LaunchMode) || "once" } : null;
}

// --- Automate mode ---------------------------------------------------------------

export type IntervalUnit = "m" | "h" | "d";

/** The Automate-mode form (raw input values; the kit validates them). */
export type AutomateForm = {
  when: "every" | "once";
  amount: string;
  unit: IntervalUnit;
  /** `YYYY-MM-DDTHH:MM`, read as UTC. */
  once_at: string;
  context: ContextMode;
  /** Decision D1: "auto" (default) = creating the automation approves its
   * tool calls; "ask" = every tool call waits for approval. */
  tool_approval: ToolApprovalPolicy;
  /** Advanced. */
  title: string;
  start_at: string;
  count: string;
  until: string;
};

export const DEFAULT_AUTOMATE_FORM: AutomateForm = {
  when: "every",
  amount: "24",
  unit: "h",
  once_at: "",
  context: "independent",
  tool_approval: "auto",
  title: "",
  start_at: "",
  count: "",
  until: "",
};

export const CONTEXT_HELP: Record<ContextMode, string> = {
  independent: "Each run starts fresh in its own session. Runs never see each other.",
  growing:
    "Each run is a new turn of one conversation and sees the previous runs. The history is bounded: the most recent 50,000 tokens of whole turns are replayed; older runs drop out.",
};

/**
 * Workflow inputs an automation owns (operator 2026-09-28: "Use Context" on
 * top AND Context independent/growing were one control shown twice, and they
 * could contradict: Growing + Use Context = No silently dropped the history).
 * The Context choice is the one control; the gateway sets `use_context` on the
 * automation's target from it, so Automate mode neither shows nor sends it.
 */
export const AUTOMATION_OWNED_INPUTS: readonly string[] = ["use_context"];

/** Said under the Context choice, where the hidden input went. */
export const CONTEXT_OWNS_HISTORY = "This choice also sets the workflow's Use Context input: the workflow always reads the history the automation gives it.";

/** The kit's schedule form for this Observer form and prompt. */
export function schedule_form(form: AutomateForm, prompt: string): ScheduleForm {
  const every = form.when === "every";
  return {
    prompt,
    when: every ? { kind: "every", amount: Number(form.amount), unit: form.unit } : { kind: "once", at: form.once_at },
    context: form.context,
    toolApproval: form.tool_approval,
    title: form.title,
    ...(every && form.start_at ? { startAt: form.start_at } : {}),
    ...(every && form.count.trim() ? { count: Number(form.count) } : {}),
    ...(every && form.until ? { until: form.until } : {}),
  };
}

/**
 * The exact `POST /api/gateway/automations` body, or the reasons it cannot be
 * built. The prompt is `input_data.prompt` (the What field); the other inputs
 * ride `target.input_data` unchanged.
 */
export function build_automate_request(
  form: AutomateForm,
  opts: {
    choice: WorkflowChoice | null;
    bundle_ref_for: (bundle_id: string) => string;
    input_data: Record<string, any> | null;
    request_id: string;
  },
): { ok: true; body: CreateAutomationRequest } | { ok: false; errors: string[] } {
  if (opts.input_data === null) return { ok: false, errors: ["The inputs are not valid JSON."] };
  const cleaned = clean_input_data(opts.input_data);
  const prompt = typeof cleaned.prompt === "string" ? cleaned.prompt : "";
  delete cleaned.prompt;
  for (const key of AUTOMATION_OWNED_INPUTS) delete cleaned[key];
  let target: AutomationTarget | null;
  try {
    target = automation_target(opts.choice, opts.bundle_ref_for, cleaned);
  } catch (e: any) {
    return { ok: false, errors: [String(e?.message || e)] };
  }
  return buildCreateRequest(schedule_form(form, prompt), { target, requestId: opts.request_id });
}

/** "Runs every 24 hours (UTC), first run now." — or "" while incomplete. */
export function automate_preview(form: AutomateForm): string {
  const built = buildCreateRequest(schedule_form(form, "preview"), {
    target: { flow_id: "@default", interface: CODE_AGENT_INTERFACE },
    requestId: "preview",
  });
  if (!built.ok) return "";
  const config = built.body.trigger.config as { start_at?: string; every?: string };
  const label = scheduleLabel(config);
  if (form.when === "once") return `Runs ${label}.`;
  return `Runs ${label}, first run ${config.start_at ? `at ${formatUtc(config.start_at)}` : "now"}.`;
}

/**
 * One request id per distinct create body: a retry of the SAME body reuses
 * its id (the gateway answers idempotently); any change mints a new one (a
 * reused id with a different body is a 409 identity_conflict by contract).
 */
export class RequestIdMemo {
  private key = "";
  private id = "";
  constructor(private readonly mint: () => string) {}
  id_for(key: string): string {
    if (!this.id || key !== this.key) {
      this.key = key;
      this.id = this.mint();
    }
    return this.id;
  }
  reset(): void {
    this.key = "";
    this.id = "";
  }
}

/** Build with a memoized request id (the id is excluded from the memo key). */
export function build_automate_request_memo(
  form: AutomateForm,
  opts: { choice: WorkflowChoice | null; bundle_ref_for: (bundle_id: string) => string; input_data: Record<string, any> | null },
  memo: RequestIdMemo,
): { ok: true; body: CreateAutomationRequest } | { ok: false; errors: string[] } {
  const probe = build_automate_request(form, { ...opts, request_id: "" });
  if (!probe.ok) return probe;
  const { request_id: _ignored, ...rest } = probe.body;
  void _ignored;
  const request_id = memo.id_for(JSON.stringify(rest));
  return { ok: true, body: { ...probe.body, request_id } };
}

// --- run rows: normalization and tagging -------------------------------------------

function str_or_null(v: any): string | null {
  return typeof v === "string" ? v : v ?? null;
}

/** One `/runs` listing row → RunSummary. Keeps every field the gateway
 * returns that a view uses, including `actor_id` and the automation
 * attribution (`session_kind`, `automation_id`, `role`, `occurrence_index`). */
export function normalize_run_summary(r: any): RunSummary {
  return {
    run_id: String(r?.run_id || "").trim(),
    workflow_id: str_or_null(r?.workflow_id),
    status: typeof r?.status === "string" ? String(r.status) : "",
    created_at: str_or_null(r?.created_at),
    updated_at: str_or_null(r?.updated_at),
    ledger_len: typeof r?.ledger_len === "number" ? Number(r.ledger_len) : r?.ledger_len ?? null,
    parent_run_id: str_or_null(r?.parent_run_id),
    session_id: str_or_null(r?.session_id),
    actor_id: str_or_null(r?.actor_id),
    session_kind: str_or_null(r?.session_kind),
    automation_id: str_or_null(r?.automation_id),
    role: str_or_null(r?.role),
    occurrence_index: typeof r?.occurrence_index === "number" ? Number(r.occurrence_index) : null,
    is_scheduled: typeof r?.is_scheduled === "boolean" ? Boolean(r.is_scheduled) : r?.is_scheduled ?? null,
    paused: typeof r?.paused === "boolean" ? Boolean(r.paused) : r?.paused ?? null,
    waiting_reason: typeof r?.waiting?.reason === "string" ? String(r.waiting.reason) : r?.waiting?.reason ?? null,
    schedule_interval: typeof r?.schedule?.interval === "string" ? String(r.schedule.interval).trim() : r?.schedule?.interval ?? null,
    schedule_target_workflow_id:
      typeof r?.schedule?.target_workflow_id === "string" ? String(r.schedule.target_workflow_id).trim() : r?.schedule?.target_workflow_id ?? null,
    current_node: typeof r?.current_node === "string" ? String(r.current_node).trim() : r?.current_node ?? null,
    llm_calls: typeof r?.llm_calls === "number" ? Number(r.llm_calls) : r?.llm_calls ?? null,
    tool_calls: typeof r?.tool_calls === "number" ? Number(r.tool_calls) : r?.tool_calls ?? null,
    tokens_total: typeof r?.tokens_total === "number" ? Number(r.tokens_total) : r?.tokens_total ?? null,
    error: r?.error ?? null,
    waiting: r?.waiting ?? null,
  };
}

export type RunSessionTag = "automation" | "occurrence" | "discussion" | "legacy";

/**
 * The run's automation tag from the gateway's attribution (contract E index
 * columns): `role` controller/occurrence/descendant/discussion/legacy_schedule
 * and `session_kind`. Legacy schedules keep the gateway's `is_scheduled`
 * flag. A `scheduled:` workflow id without attribution is NOT tagged.
 */
export function run_session_tag(run: Pick<RunSummary, "role" | "session_kind" | "is_scheduled"> | null | undefined): RunSessionTag | null {
  const role = String(run?.role || "").trim();
  const kind = String(run?.session_kind || "").trim();
  if (role === "controller") return "automation";
  if (role === "occurrence" || role === "descendant" || kind === "occurrence") return "occurrence";
  if (role === "discussion" || kind === "discussion") return "discussion";
  if (role === "legacy_schedule" || run?.is_scheduled === true) return "legacy";
  return null;
}

export function run_session_tag_label(run: Pick<RunSummary, "role" | "session_kind" | "is_scheduled" | "occurrence_index">): string {
  const tag = run_session_tag(run);
  if (tag === "occurrence") return typeof run.occurrence_index === "number" ? `occurrence #${run.occurrence_index}` : "occurrence";
  if (tag === "legacy") return "legacy schedule";
  return tag || "";
}

/** True for an automation controller root: it lives on the Automations page,
 * never as a board card (it parks in its wait between occurrences). */
export function is_automation_controller(run: Pick<RunSummary, "role"> | null | undefined): boolean {
  return String(run?.role || "").trim() === "controller";
}

// --- capability ---------------------------------------------------------------------

/** `GET /api/gateway/discovery/capabilities` → whether the gateway advertises
 * the Automations API (`capabilities.contracts.common.automations`). */
export function automations_capability(discovery: any): { available: boolean; reason: string } {
  const auto = discovery?.capabilities?.contracts?.common?.automations;
  if (auto && typeof auto === "object" && auto.available === true) return { available: true, reason: "" };
  if (auto && typeof auto === "object" && auto.available === false) {
    return { available: false, reason: "This gateway has the Automations API turned off." };
  }
  return {
    available: false,
    reason: "This gateway does not advertise the Automations API (capabilities.contracts.common.automations). Update AbstractGateway to use automations; legacy schedules stay manageable from their run view.",
  };
}

// --- rows ------------------------------------------------------------------------------

export function is_legacy_summary(s: AutomationSummary): boolean {
  return s.legacy === true || s.capabilities.includes("legacy");
}

export type AutomationRowView = {
  id: string;
  title: string;
  cadence: string;
  next_run: string;
  /** "Run #7 running" — from `current_occurrence` only; null when nothing is in flight. */
  current: string | null;
  state: AutomationStatus;
  last: string;
  last_status: string;
  attention: string | null;
  legacy: boolean;
};

/**
 * Two facts, two fields (never inferred from `last_occurrence`): what runs now
 * comes from `current_occurrence`, when it runs next from `next_fire_at`
 * (present exactly while active and scheduled, also during a run).
 */
export function automation_row_view(s: AutomationSummary, now_ms: number = Date.now()): AutomationRowView {
  const legacy = is_legacy_summary(s);
  const last = s.last_occurrence;
  const attempts = last && last.attempts > 1 ? ` after ${last.attempts} attempts` : "";
  const needs = s.attention.unread || s.attention.pending_waits > 0;
  return {
    id: s.automation_id,
    title: s.title,
    cadence: triggerSummary(s.trigger),
    next_run: s.next_fire_at ? `${formatUtc(s.next_fire_at)} (${relativeIn(s.next_fire_at, now_ms)})` : s.status === "paused" ? "none while paused" : "none scheduled",
    current: currentOccurrenceLabel(s),
    state: s.status,
    last: last ? last.excerpt : "",
    last_status: last ? `#${last.index} ${last.status}${attempts}` : "no runs yet",
    attention: needs ? attentionLabel(s) : null,
    legacy,
  };
}

export type RowAction = "pause" | "resume" | "run_now" | "edit" | "archive" | "discuss";
export type LegacyAction = "legacy_pause" | "legacy_resume" | "legacy_run_now" | "open_run" | "recreate";

/** Row-level controls from the kit's rule (`automationControls`). Edit and
 * Discuss open the panel (they need a form / an occurrence). */
export function automation_row_controls(s: AutomationSummary, busy: boolean): Record<RowAction, { enabled: boolean; reason?: string }> {
  const c = automationControls(s, [], busy);
  // Discuss opens the panel; the panel offers it per FINISHED occurrence, so
  // the row only needs an occurrence to exist (nothing inferred from its status).
  const last = s.last_occurrence;
  const discuss =
    busy
      ? { enabled: false, reason: "Working…" }
      : is_legacy_summary(s)
        ? { enabled: false, reason: "Legacy schedule: managed with its existing controls." }
        : !s.capabilities.includes("discuss")
          ? { enabled: false, reason: "Not permitted for this automation." }
          : !last
            ? { enabled: false, reason: "No occurrence to discuss yet." }
            : { enabled: true };
  return { pause: c.pause, resume: c.resume, run_now: c.run_now, edit: c.revise, archive: c.archive, discuss };
}

export function legacy_row_controls(s: AutomationSummary, busy: boolean): Record<LegacyAction, { enabled: boolean; reason?: string }> {
  const off = (reason: string) => ({ enabled: false, reason });
  if (busy) return { legacy_pause: off("Working…"), legacy_resume: off("Working…"), legacy_run_now: off("Working…"), open_run: { enabled: true }, recreate: off("Working…") };
  const paused = s.status === "paused";
  const live = s.status === "active" || s.status === "paused";
  return {
    legacy_pause: paused ? off("Already suspended.") : live ? { enabled: true } : off("The schedule has ended."),
    legacy_resume: paused ? { enabled: true } : off(live ? "Already running on schedule." : "The schedule has ended."),
    legacy_run_now: s.status === "active" ? { enabled: true } : off(paused ? "Resume the schedule first." : "The schedule has ended."),
    open_run: { enabled: true },
    recreate: { enabled: true },
  };
}

/** The legacy command (`POST /api/gateway/commands`) for a legacy row action. */
export function legacy_command(action: "legacy_pause" | "legacy_resume" | "legacy_run_now", now_iso: string): { type: "pause" | "resume"; payload: Record<string, any> } {
  if (action === "legacy_pause") return { type: "pause", payload: { reason: "Suspended from the Observer's Automations page" } };
  if (action === "legacy_resume") return { type: "resume", payload: {} };
  return { type: "resume", payload: { payload: { mode: "run_now", requested_at: now_iso } } };
}

// --- Recreate as automation -------------------------------------------------------------

export type LegacyPrefill = {
  choice: WorkflowChoice;
  input_data: Record<string, any>;
  form: AutomateForm;
  notes: string[];
};

const LEGACY_INTERVAL_RE = /^([1-9][0-9]*)([smhd])$/;

function to_utc_input(iso: unknown): string {
  if (typeof iso !== "string" || !iso.trim()) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 16);
}

/**
 * Prefill Automate mode from a legacy scheduled run (`GET /runs/{id}` →
 * `schedule`, `GET /runs/{id}/input_data` → `input_data`). Legacy intervals
 * that `schedule@1` cannot express (milliseconds, decimals, seconds that are
 * not whole minutes) leave the interval at the default and say so.
 */
export function legacy_recreate_prefill(run: any, input: any): LegacyPrefill {
  const schedule = run?.schedule && typeof run.schedule === "object" ? run.schedule : null;
  if (!schedule) throw new Error("This run carries no legacy schedule metadata; nothing to recreate.");
  // The gateway's legacy `schedule` names the target by `target_bundle_ref`
  // (`bundle_id@version`) and `target_flow_id`; `/runs/{id}/input_data`
  // carries `bundle_id`. The Launch picker selects by unversioned bundle id.
  const ref = String(schedule.target_bundle_ref || "").trim();
  const bundle_id = String(schedule.target_host_bundle_id || schedule.target_bundle_id || (ref.includes("@") ? ref.slice(0, ref.lastIndexOf("@")) : "") || input?.bundle_id || "").trim();
  const flow_id = String(schedule.target_flow_id || input?.flow_id || "").trim();
  if (!bundle_id || !flow_id) throw new Error("The legacy schedule does not name its target workflow.");
  const notes: string[] = [];
  const form: AutomateForm = { ...DEFAULT_AUTOMATE_FORM };
  const interval = typeof schedule.interval === "string" ? schedule.interval.trim() : "";
  if (!interval) {
    form.when = "once";
    notes.push("The legacy schedule ran once; pick the date and time (UTC) to run.");
  } else {
    const m = LEGACY_INTERVAL_RE.exec(interval);
    let amount = m ? Number(m[1]) : 0;
    let unit = m ? m[2] : "";
    if (unit === "s" && amount % 60 === 0) {
      amount = amount / 60;
      unit = "m";
    }
    if (unit === "m" || unit === "h" || unit === "d") {
      form.amount = String(amount);
      form.unit = unit;
    } else {
      notes.push(`The legacy interval "${interval}" is not a whole number of minutes, hours or days; choose an interval.`);
    }
  }
  if (typeof schedule.repeat_count === "number" && schedule.repeat_count >= 1) form.count = String(schedule.repeat_count);
  const until = to_utc_input(schedule.repeat_until);
  if (until) form.until = until;
  form.context = schedule.share_context === false ? "independent" : "growing";
  const raw = input && typeof input.input_data === "object" && input.input_data && !Array.isArray(input.input_data) ? input.input_data : {};
  const input_data: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    // Gateway-written keys (workflow_selection, host namespaces) are not the user's inputs.
    if (k === "workflow_selection" || k.startsWith("_")) continue;
    input_data[k] = v;
  }
  return { choice: { kind: "bundle", bundle_id, flow_id }, input_data, form, notes };
}

// --- the page controller -------------------------------------------------------------------

export type AutomationDetailState = {
  automation_id: string;
  summary: AutomationSummary;
  definition: AutomationDefinition | null;
  occurrences: OccurrenceRow[];
  next_cursor: string | null;
  error: ApiError | null;
};

export type AutomationsState = {
  items: AutomationSummary[];
  loaded: boolean;
  loading: boolean;
  /** The list could not be read (cleared by the next successful read). */
  list_error: ApiError | null;
  /** The last action failed (kept until the next action; a refresh keeps it). */
  error: ApiError | null;
  refreshed_at: number | null;
  status_filter: AutomationStatus | "";
  /** Archived automations are hidden unless asked for (or filtered on). */
  show_archived: boolean;
  selected_id: string;
  detail: AutomationDetailState | null;
  trigger_sources: TriggerSourceEntry[];
  busy: boolean;
  notice: string;
  confirm_archive_id: string;
};

export const INITIAL_AUTOMATIONS_STATE: AutomationsState = {
  items: [],
  loaded: false,
  loading: false,
  list_error: null,
  error: null,
  refreshed_at: null,
  status_filter: "",
  show_archived: false,
  selected_id: "",
  detail: null,
  trigger_sources: [],
  busy: false,
  notice: "",
  confirm_archive_id: "",
};

/** What the page needs from the Observer host (existing gateway paths). */
export type AutomationsHost = {
  /** The existing wait-answer path: `POST /api/gateway/commands` type `resume`
   * with `{wait_key, payload}` against the waiting run. */
  answer_wait(run_id: string, wait_key: string, payload: Record<string, any>): Promise<void>;
  /** A legacy command against a legacy schedule root (`POST /api/gateway/commands`). */
  legacy_command(run_id: string, type: "pause" | "resume", payload: Record<string, any>): Promise<void>;
  now_iso(): string;
};

/**
 * The Observer's host for the page: waits are answered with the SAME command
 * the board and the run view send (`resume` + `{wait_key, payload}`), legacy
 * rows use the legacy command types — both through `POST /api/gateway/commands`.
 */
export function observer_automations_host(
  gateway: { submit_command(c: { command_id: string; run_id: string; type: string; payload: any; client_id?: string }): Promise<any> },
  mint: () => string,
  now_iso: () => string,
): AutomationsHost {
  return {
    answer_wait: async (run_id, wait_key, payload) => {
      await gateway.submit_command({ command_id: mint(), run_id, type: "resume", payload: { wait_key, payload }, client_id: "web_pwa" });
    },
    legacy_command: async (run_id, type, payload) => {
      await gateway.submit_command({ command_id: mint(), run_id, type, payload, client_id: "web_pwa" });
    },
    now_iso,
  };
}

/**
 * Decision D1: the answer payload is chosen by the wait's `kind`, never from
 * text. Returns the payload to send, or throws when the wait is untyped or
 * the payload does not match its kind (the gateway would refuse it with 422
 * `invalid_request`, field `payload`).
 */
export function wait_answer_payload(kind: unknown, payload: Record<string, any>): Record<string, any> {
  if (kind === "ask_user") {
    if (typeof payload.response !== "string") throw new Error("An ask_user wait is answered with {response: string}.");
    return { response: payload.response };
  }
  if (kind === "tool_approval") {
    if (typeof payload.approved !== "boolean") throw new Error("A tool_approval wait is answered with {approved: true|false}.");
    const ids = payload.tool_ids;
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((x) => typeof x === "string"))) throw new Error("tool_ids must be a list of strings.");
    return { approved: payload.approved, ...(ids !== undefined ? { tool_ids: ids } : {}) };
  }
  if (kind === "event") {
    if (!("payload" in payload)) throw new Error("An event wait is answered with {payload}.");
    return { payload: payload.payload };
  }
  throw new Error(`This wait has no known kind (${JSON.stringify(kind)}); the gateway must type its waits (ask_user, tool_approval, event).`);
}

/** The rows the list shows: archived ones only when asked for, or when filtering on "archived". */
export function visible_automations(state: Pick<AutomationsState, "items" | "status_filter" | "show_archived">): AutomationSummary[] {
  if (state.show_archived || state.status_filter === "archived") return state.items;
  return state.items.filter((s) => s.status !== "archived");
}

export function archived_count(state: Pick<AutomationsState, "items">): number {
  return state.items.filter((s) => s.status === "archived").length;
}

/**
 * What a started discussion is, in words, from the gateway's answer: a fork
 * at occurrence N working in its OWN writable workspace, with the
 * automation's folder mounted read-only.
 */
export function discussion_notice(index: number, r: DiscussResponse): string {
  return `Discussion started from #${index} (session ${r.session_id}). It works in its own workspace ${r.workspace_root}; the automation's files are mounted read-only at ${r.mounted_workspace} for the file tools (shell commands are not sandboxed), and nothing is written back into the automation's session.`;
}

/** Poll interval of the Automations page while visible. */
export const AUTOMATIONS_POLL_MS = 30_000;
/** Page size for list and occurrences (the client polls FULL pages). */
export const AUTOMATIONS_PAGE_LIMIT = 50;

export function to_api_error(e: unknown): ApiError {
  if (isApiError(e)) return e;
  const message = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return { status: 0, code: "client_error", message };
}

/** Newest page first, merged by run id with the pages already loaded. */
export function merge_occurrences(loaded: OccurrenceRow[], page: OccurrenceRow[]): OccurrenceRow[] {
  const by_id = new Map<string, OccurrenceRow>();
  for (const r of loaded) by_id.set(r.run_id, r);
  for (const r of page) by_id.set(r.run_id, r);
  return Array.from(by_id.values()).sort((a, b) => b.index - a.index);
}

/**
 * The Automations page's state machine, UI-free (the React page subscribes).
 * Panel callbacks REJECT with an `ApiError` so the kit panel shows it; row
 * actions record the error in `state.error` instead.
 */
export class AutomationsController {
  state: AutomationsState = { ...INITIAL_AUTOMATIONS_STATE };
  private listeners = new Set<() => void>();
  private list_seq = 0;
  private detail_seq = 0;
  private sources_loaded = false;

  /**
   * `followups_ms`: re-reads after a command. The gateway ACCEPTS a command
   * when it is queued and the controller applies it moments later, so the
   * first re-read may still show the old state.
   */
  constructor(
    private readonly client: AutomationsClient,
    private readonly host: AutomationsHost,
    private readonly followups_ms: number[] = [1500, 4000],
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<AutomationsState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Every page of `GET /automations` (v1 has no change cursor). */
  async list_all(): Promise<AutomationSummary[]> {
    const out: AutomationSummary[] = [];
    let cursor: string | undefined = undefined;
    for (let guard = 0; guard < 200; guard += 1) {
      const page = await this.client.listAutomations({
        ...(this.state.status_filter ? { status: this.state.status_filter } : {}),
        ...(cursor ? { cursor } : {}),
        limit: AUTOMATIONS_PAGE_LIMIT,
      });
      out.push(...page.items);
      if (!page.next_cursor) return out;
      cursor = page.next_cursor;
    }
    throw new Error("GET /api/gateway/automations kept returning next_cursor after 200 pages.");
  }

  async refresh(): Promise<void> {
    const seq = ++this.list_seq;
    this.set({ loading: true });
    try {
      const items = await this.list_all();
      if (seq !== this.list_seq) return;
      const detail = this.state.detail;
      const fresh = detail ? items.find((s) => s.automation_id === detail.automation_id) : undefined;
      this.set({
        items,
        loaded: true,
        loading: false,
        list_error: null,
        refreshed_at: Date.now(),
        ...(detail && fresh ? { detail: { ...detail, summary: fresh } } : {}),
      });
      if (detail) await this.reload_occurrences(detail.automation_id);
    } catch (e) {
      if (seq !== this.list_seq) return;
      this.set({ loading: false, loaded: true, list_error: to_api_error(e) });
    }
  }

  async set_status_filter(status: AutomationStatus | ""): Promise<void> {
    this.set({ status_filter: status });
    await this.refresh();
  }

  async load_trigger_sources(): Promise<void> {
    if (this.sources_loaded) return;
    const res = await this.client.listTriggerSources();
    this.sources_loaded = true;
    this.set({ trigger_sources: res.items });
  }

  async select(automation_id: string): Promise<void> {
    const id = String(automation_id || "").trim();
    const seq = ++this.detail_seq;
    if (!id) {
      this.set({ selected_id: "", detail: null });
      return;
    }
    // Never show the previous automation's panel while this one loads.
    this.set({ selected_id: id, notice: "", ...(this.state.detail?.automation_id !== id ? { detail: null } : {}) });
    try {
      const listed = this.state.items.find((s) => s.automation_id === id);
      if (listed && is_legacy_summary(listed)) {
        // Legacy rows have no definition/occurrences on the automation routes.
        this.set({ detail: { automation_id: id, summary: listed, definition: null, occurrences: [], next_cursor: null, error: null } });
        return;
      }
      const [detail, page] = await Promise.all([this.client.getAutomation(id), this.client.listOccurrences(id, { limit: AUTOMATIONS_PAGE_LIMIT })]);
      if (seq !== this.detail_seq) return;
      this.set({
        detail: {
          automation_id: id,
          summary: listed ?? detail.summary,
          definition: detail.definition,
          occurrences: merge_occurrences([], page.items),
          next_cursor: page.next_cursor,
          error: null,
        },
      });
      await this.load_trigger_sources();
    } catch (e) {
      if (seq !== this.detail_seq) return;
      this.set({ error: to_api_error(e) });
    }
  }

  private async reload_occurrences(id: string): Promise<void> {
    const d = this.state.detail;
    if (!d || d.automation_id !== id || is_legacy_summary(d.summary)) return;
    const [detail, page] = await Promise.all([this.client.getAutomation(id), this.client.listOccurrences(id, { limit: AUTOMATIONS_PAGE_LIMIT })]);
    const cur = this.state.detail;
    if (!cur || cur.automation_id !== id) return;
    const listed = this.state.items.find((s) => s.automation_id === id);
    this.set({
      detail: {
        ...cur,
        summary: listed ?? detail.summary,
        definition: detail.definition,
        occurrences: merge_occurrences(cur.occurrences, page.items),
        // Keep the older-page cursor once pages beyond the first are loaded.
        next_cursor: cur.occurrences.length > page.items.length ? cur.next_cursor : page.next_cursor,
      },
    });
  }

  async load_more(): Promise<void> {
    const d = this.state.detail;
    if (!d || !d.next_cursor) return;
    try {
      const page = await this.client.listOccurrences(d.automation_id, { cursor: d.next_cursor, limit: AUTOMATIONS_PAGE_LIMIT });
      const cur = this.state.detail;
      if (!cur || cur.automation_id !== d.automation_id) return;
      this.set({ detail: { ...cur, occurrences: merge_occurrences(cur.occurrences, page.items), next_cursor: page.next_cursor } });
    } catch (e) {
      this.set({ error: to_api_error(e) });
    }
  }

  /** Re-read the list and, when this automation is open, its detail. */
  private async after_change(_id: string): Promise<void> {
    await this.refresh();
    for (const ms of this.followups_ms) setTimeout(() => void this.refresh(), ms);
  }

  /** Panel/row command (`POST /automations/{id}/commands`). Rejects with ApiError. */
  async command(id: string, type: AutomationCommandType, payload?: Record<string, any>, command_id?: string): Promise<CommandReceipt> {
    this.set({ busy: true });
    try {
      const receipt = await this.client.sendAutomationCommand(id, { type, ...(payload ? { payload } : {}), ...(command_id ? { command_id } : {}) });
      await this.after_change(id);
      return receipt;
    } catch (e) {
      throw to_api_error(e);
    } finally {
      this.set({ busy: false });
    }
  }

  /** `PATCH /automations/{id}` with `expected_revision`. Rejects with ApiError. */
  async revise(id: string, changes: AutomationChanges, expected_revision: number | null, command_id?: string): Promise<CommandReceipt> {
    this.set({ busy: true });
    try {
      const receipt = await this.client.reviseAutomation(id, {
        changes,
        ...(expected_revision !== null ? { expected_revision } : {}),
        ...(command_id ? { command_id } : {}),
      });
      await this.after_change(id);
      return receipt;
    } catch (e) {
      throw to_api_error(e);
    } finally {
      this.set({ busy: false });
    }
  }

  /** `POST /automations/{id}/discuss` → the new session (the host opens it). */
  async discuss(id: string, occurrence_index: number, prompt: string, request_id?: string): Promise<DiscussResponse> {
    this.set({ busy: true });
    try {
      const r = await this.client.discuss(id, { occurrence_index, prompt, ...(request_id ? { request_id } : {}) });
      this.set({ notice: discussion_notice(occurrence_index, r) });
      return r;
    } catch (e) {
      throw to_api_error(e);
    } finally {
      this.set({ busy: false });
    }
  }

  /** `POST /automations/{id}/seen` with the LAST DISPLAYED item's cursor. */
  async seen(id: string, attention_cursor: string): Promise<void> {
    try {
      await this.client.markSeen(id, attention_cursor);
    } catch (e) {
      throw to_api_error(e);
    }
  }

  /** Answer an occurrence's human wait through the existing resume path. */
  async answer_wait(id: string, run_id: string, wait_key: string, payload: Record<string, any>): Promise<void> {
    this.set({ busy: true });
    try {
      const wait = (this.state.detail?.occurrences || []).flatMap((o) => o.waits).find((w) => w.run_id === run_id && w.wait_key === wait_key);
      if (!wait) throw new Error(`No loaded wait ${wait_key} on run ${run_id}; reload the automation.`);
      await this.host.answer_wait(run_id, wait_key, wait_answer_payload((wait as { kind?: unknown }).kind, payload));
      await this.after_change(id);
    } catch (e) {
      throw to_api_error(e);
    } finally {
      this.set({ busy: false });
    }
  }

  /** Row action: errors land in `state.error` (no panel to show them). */
  async row_action(summary: AutomationSummary, action: "pause" | "resume" | "run_now" | "archive"): Promise<void> {
    const type = `automation.${action}` as AutomationCommandType;
    this.set({ error: null, notice: "" });
    try {
      await this.command(summary.automation_id, type);
      this.set({
        notice:
          action === "run_now" && summary.status === "paused"
            ? `Run now sent to “${summary.title}”; it stays paused.`
            : `${action.replace("_", " ")} sent to “${summary.title}”.`,
        confirm_archive_id: "",
      });
    } catch (e) {
      this.set({ error: to_api_error(e) });
    }
  }

  set_show_archived(show: boolean): void {
    this.set({ show_archived: show });
  }

  ask_archive(id: string): void {
    this.set({ confirm_archive_id: id });
  }

  /** Legacy row action through the legacy command types. */
  async legacy_action(summary: AutomationSummary, action: "legacy_pause" | "legacy_resume" | "legacy_run_now"): Promise<void> {
    if (!is_legacy_summary(summary)) throw new Error("legacy_action on a non-legacy automation");
    const cmd = legacy_command(action, this.host.now_iso());
    this.set({ busy: true, error: null, notice: "" });
    try {
      await this.host.legacy_command(summary.automation_id, cmd.type, cmd.payload);
      this.set({ notice: `${cmd.type === "pause" ? "Suspend" : action === "legacy_run_now" ? "Run now" : "Resume"} sent to “${summary.title}”.` });
      await this.refresh();
    } catch (e) {
      this.set({ error: to_api_error(e) });
    } finally {
      this.set({ busy: false });
    }
  }

  report_error(e: unknown): void {
    this.set({ error: to_api_error(e) });
  }

  clear_notice(): void {
    this.set({ notice: "", error: null });
  }
}
