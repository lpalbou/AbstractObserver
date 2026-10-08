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
  buildCreateRequest,
  calendarRuleOf,
  DEFAULT_CALENDAR_STATE,
  isServedPreviewWhen,
  nextRunLabel,
  scheduleTriggerFrom,
  DEFAULT_EMAIL_RECIPIENTS,
  DEFAULT_GROWING_MAX_TOKENS,
  DEFAULT_EMAIL_TRIGGER_FORM,
  EMAIL_TEXT,
  emailTriggerLabel,
  emailUsable,
  formatUtc,
  isApiError,
  type CalendarRuleState,
  type SchedulePreview,
  type TriggerSpec,
  scheduleLabel,
  triggerSummary,
  type ApiError,
  type EmailRecipientsForm,
  type EmailTriggerForm,
  type MyEmailStatus,
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
import { run_id_from_run_hash } from "../lib/app_paths";

// --- launch target -------------------------------------------------------------

/** Picker value prefix for the gateway default agent of an interface. */
export const DEFAULT_AGENT_PREFIX = "@default:";
/** The agent interface the gateway always lists with a built-in default
 * (abstractgateway agent_defaults.py: `BUILTIN_DEFAULT_BUNDLES`). */
export const CODE_AGENT_INTERFACE = "abstractcode.agent.v1";

export type WorkflowChoice =
  | { kind: "bundle"; bundle_id: string; flow_id: string }
  | { kind: "default"; interface: string };

/** The Launch picker's value (kit WorkflowPicker) for a choice: "@default" for the
 * code-agent gateway default, the entry's `bundle@version:flow` for a listed
 * bundle; "" when the choice is not in the gateway's executable list (shown as
 * the current label, never added as an option). */
export function launch_picker_value(
  choice: WorkflowChoice | null,
  entries: ReadonlyArray<{ value: string; bundleId: string; flowId: string }>,
): string {
  if (!choice) return "";
  if (choice.kind === "default") return choice.interface === CODE_AGENT_INTERFACE ? "@default" : "";
  return entries.find((e) => e.bundleId === choice.bundle_id && e.flowId === choice.flow_id)?.value ?? "";
}

/** The choice a picker value stands for ("@default" → the code-agent gateway default). */
export function choice_from_picker(value: string, entry: { bundleId: string; flowId: string } | null): WorkflowChoice | null {
  if (value === "@default") return { kind: "default", interface: CODE_AGENT_INTERFACE };
  return entry ? { kind: "bundle", bundle_id: entry.bundleId, flow_id: entry.flowId } : null;
}

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
    "Automate: create an automation that runs this workflow on a schedule (every N minutes, hours or days), when an email arrives, or when you ask; manage it on the Automations page.",
};

/**
 * The gateway console's My email (its Users tab), where a user connects their
 * mailbox (framework backlog 0992). Null when the gateway URL is unknown or not
 * http(s): "open My email" is then plain text.
 */
export function my_email_console_url(gateway_url: string | null | undefined): string | null {
  const raw = String(gateway_url || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}/console#users`;
  } catch {
    return null;
  }
}

/** Deep link to Launch in Automate mode (the Automations page's "+ New automation"). */
export const LAUNCH_AUTOMATE_HASH = "#launch/automate";

/**
 * `#launch`, `#launch/once`, `#launch/automate`, `#automations` → the page (and Launch mode);
 * `#run/<run_id>` → that run in Observe (app_paths RUN_HASH_PREFIX); anything else → null.
 */
export function parse_app_hash(
  hash: string,
): { page: "launch"; mode: LaunchMode } | { page: "automations" } | { page: "run"; run_id: string } | null {
  const run_id = run_id_from_run_hash(String(hash || ""));
  if (run_id) return { page: "run", run_id };
  const h = String(hash || "").replace(/^#\/?/, "");
  if (h === "automations") return { page: "automations" };
  const m = /^launch(?:\/(once|automate))?$/.exec(h);
  return m ? { page: "launch", mode: (m[1] as LaunchMode) || "once" } : null;
}

// --- Automate mode ---------------------------------------------------------------

export type IntervalUnit = "m" | "h" | "d";

/** The Automate-mode form (raw input values; the kit validates them). */
export type AutomateForm = {
  /**
   * Repeat (`every`), the calendar rules (`daily` / `weekly` / `monthly`, round 16: a wall-clock
   * time in the account's time zone, the rule in `calendar`), Once at (`once_at`, a wall time in
   * the account's time zone), or "email": `email.received@1` from `email` (offered only with a
   * usable account, GET /me/email). Every schedule is written as `schedule@2` (the kit builds it).
   */
  when: "every" | "daily" | "weekly" | "monthly" | "once" | "email";
  /** The calendar fields (time, days, day of month), kept across kind switches; the rule is built from `when`. */
  calendar: CalendarRuleState;
  /** The "When an email arrives" fields (the kit's `EmailTriggerForm`). */
  email: EmailTriggerForm;
  /** "Email me the result" → `notify.channels: ["console", "email"]`. */
  notify_email: boolean;
  /** "May send email without asking to": only me (default) / me and these addresses. */
  email_recipients: EmailRecipientsForm;
  amount: string;
  unit: IntervalUnit;
  /** `YYYY-MM-DDTHH:MM`, a wall time in the account's time zone (the gateway converts it). */
  once_at: string;
  context: ContextMode;
  growing_max_tokens: string;
  /** Decision D1: "auto" (default) = creating the automation approves its
   * tool calls; "ask" = every tool call waits for approval. */
  tool_approval: ToolApprovalPolicy;
  /** Title and limits. */
  title: string;
  start_at: string;
  count: string;
  until: string;
};

export const DEFAULT_AUTOMATE_FORM: AutomateForm = {
  when: "every",
  calendar: DEFAULT_CALENDAR_STATE,
  email: DEFAULT_EMAIL_TRIGGER_FORM,
  notify_email: false,
  email_recipients: DEFAULT_EMAIL_RECIPIENTS,
  amount: "24",
  unit: "h",
  once_at: "",
  context: "independent",
  growing_max_tokens: String(DEFAULT_GROWING_MAX_TOKENS),
  tool_approval: "auto",
  title: "",
  start_at: "",
  count: "",
  until: "",
};

export const CONTEXT_HELP: Record<ContextMode, string> = {
  independent: "Each run starts fresh in its own session. Runs never see each other.",
  growing:
    "Each run is a new turn of one conversation and sees the previous runs. The most recent whole turns are replayed within your token budget; older runs drop out. The newest turn is kept whole even if it exceeds the budget.",
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

/**
 * The kit's schedule form for this Observer form and prompt. Email options
 * (the trigger, "Email me the result", allowed recipients) are carried only
 * when `email_usable` (GET /me/email → effective_enabled): without a usable
 * account nothing email-shaped is sent.
 */
export function schedule_form(form: AutomateForm, prompt: string, email_usable = false): ScheduleForm {
  const every = form.when === "every";
  const calendar = form.when === "daily" || form.when === "weekly" || form.when === "monthly";
  return {
    prompt,
    // The rule of the chosen kind from the kept fields (an emptied day set stays empty: the kit then says why).
    when: form.when === "once" ? { kind: "once", at: form.once_at } : calendar ? calendarRuleOf(form.when as "daily" | "weekly" | "monthly", form.calendar) : { kind: "every", amount: Number(form.amount), unit: form.unit },
    ...(email_usable && form.when === "email" ? { trigger: "email" as const, email: form.email } : {}),
    ...(email_usable && form.notify_email ? { notifyEmail: true } : {}),
    ...(email_usable && form.email_recipients.mode === "list" ? { emailRecipients: form.email_recipients } : {}),
    context: form.context,
    growingMaxTokens: Number(form.growing_max_tokens),
    toolApproval: form.tool_approval,
    title: form.title,
    ...(every && form.start_at ? { startAt: form.start_at } : {}),
    // Max runs and stop at apply to Repeat and the calendar rules.
    ...((every || calendar) && form.count.trim() ? { count: Number(form.count) } : {}),
    ...((every || calendar) && form.until ? { until: form.until } : {}),
  };
}

/**
 * The trigger the gateway previews for the line under When (round 16): Once / Daily / Weekly /
 * Monthly only (they depend on the account's time zone); null for Repeat and email (their line
 * is the kit's) and while the rule is incomplete. The Launch page feeds it to the kit's
 * `useSchedulePreview` with the controller's `preview_schedule`.
 */
export function automate_preview_trigger(form: AutomateForm): TriggerSpec | null {
  if (form.when === "email" || form.when === "every") return null;
  const sf = schedule_form(form, "preview");
  if (!isServedPreviewWhen(sf.when)) return null;
  return scheduleTriggerFrom(sf).trigger;
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
    /** GET /me/email → effective_enabled (see `schedule_form`). */
    email_usable?: boolean;
  },
): { ok: true; body: CreateAutomationRequest } | { ok: false; errors: string[] } {
  if (opts.input_data === null) return { ok: false, errors: ["The inputs are not valid JSON."] };
  if (form.when === "email" && !opts.email_usable) return { ok: false, errors: [EMAIL_TEXT.not_set_up] };
  const cleaned = clean_input_data(opts.input_data);
  const prompt = typeof cleaned.prompt === "string" ? cleaned.prompt : "";
  delete cleaned.prompt;
  for (const key of AUTOMATION_OWNED_INPUTS) delete cleaned[key];
  // An automation works in its own private workspace; other workspaces are
  // chosen in Workspaces (input_data.workspace). Run once's "Run workspace"
  // never rides an automation.
  delete cleaned.workspace_root;
  let target: AutomationTarget | null;
  try {
    target = automation_target(opts.choice, opts.bundle_ref_for, cleaned);
  } catch (e: any) {
    return { ok: false, errors: [String(e?.message || e)] };
  }
  return buildCreateRequest(schedule_form(form, prompt, opts.email_usable === true), { target, requestId: opts.request_id });
}

/** "Runs every 24 hours (UTC), first run now." — or "" while incomplete. */
export function automate_preview(form: AutomateForm, email_usable = false): string {
  if (form.when === "email") {
    if (!email_usable) return "";
    const built = buildCreateRequest(schedule_form(form, "preview", true), { target: { flow_id: "@default", interface: CODE_AGENT_INTERFACE }, requestId: "preview" });
    return built.ok ? `Runs ${emailTriggerLabel(built.body.trigger.config)}.` : "";
  }
  const built = buildCreateRequest(schedule_form(form, "preview"), {
    target: { flow_id: "@default", interface: CODE_AGENT_INTERFACE },
    requestId: "preview",
  });
  if (!built.ok) return "";
  // Once / Daily / Weekly / Monthly: the line is the GATEWAY's (schedule-preview), never composed here.
  if (form.when !== "every") return "";
  const config = built.body.trigger.config as { start_at?: string; every?: string };
  const label = scheduleLabel(config);
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
  opts: { choice: WorkflowChoice | null; bundle_ref_for: (bundle_id: string) => string; input_data: Record<string, any> | null; email_usable?: boolean },
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
    archived: r?.archived === true,
  };
}

/**
 * Observer is the audit view: an archived conversation (its session archived through
 * POST /sessions/{id}/archive) leaves the gateway's `root_only` listing, so its runs are fetched
 * with `archived_only=true` and appended here, each keeping the gateway's `archived: true`. A run
 * already listed is never repeated (an older gateway that ignores `archived_only` answers the
 * same rows, which then stay unmarked).
 */
export function with_archived_roots<T extends { run_id?: unknown }>(active: readonly T[], archived: readonly T[]): T[] {
  const seen = new Set(active.map((r) => String(r?.run_id || "")));
  const out = [...active];
  for (const r of archived) {
    const id = String(r?.run_id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
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
 * comes from `current_occurrence`, when it runs next from the served `next_run_at` / `next_run_local`
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
    cadence: triggerSummary(s.trigger, s),
    // The SERVED next run (round 16): next_run_local cut + relative from next_run_at; never computed here.
    next_run: nextRunLabel(s, now_ms),
    current: currentOccurrenceLabel(s),
    state: s.status,
    last: last ? last.excerpt : "",
    last_status: last ? `#${last.index} ${last.status}${attempts}` : "no runs yet",
    attention: needs ? attentionLabel(s) : null,
    legacy,
  };
}

/**
 * The occurrence a row-level Discuss forks at: the latest FINISHED one (the
 * kit panel offers Discuss per finished occurrence; a running latest one is
 * not discussable yet). Null when none has finished.
 */
export function discuss_index(s: AutomationSummary): number | null {
  const last = s.last_occurrence;
  if (!last) return null;
  const finished = ["completed", "failed", "cancelled"].includes(String(last.status));
  const index = finished ? last.index : last.index - 1;
  return index >= 1 ? index : null;
}

export type RowAction = "pause" | "resume" | "run_now" | "edit" | "archive" | "discuss";
export type LegacyAction = "legacy_pause" | "legacy_resume" | "legacy_run_now" | "open_run" | "recreate";

/** Row-level controls from the kit's rule (`automationControls`). Edit and
 * Discuss open the panel (they need a form / an occurrence). */
export function automation_row_controls(
  s: AutomationSummary,
  busy: boolean,
): Record<RowAction, { enabled: boolean; reason?: string }> & { active: { enabled: boolean; reason?: string } } {
  const c = automationControls(s, [], busy);
  // Discuss opens a chat with a fork at the latest FINISHED occurrence.
  const at = discuss_index(s);
  const discuss =
    busy
      ? { enabled: false, reason: "Working…" }
      : is_legacy_summary(s)
        ? { enabled: false, reason: "Legacy schedule: managed with its existing controls." }
        : !s.capabilities.includes("discuss")
          ? { enabled: false, reason: "Not permitted for this automation." }
          : at === null
            ? { enabled: false, reason: s.last_occurrence ? "Available once the first run finishes." : "No occurrence to discuss yet." }
            : { enabled: true, reason: `Discuss run #${at} in a new chat (a fork of this automation).` };
  return { active: c.active, pause: c.pause, resume: c.resume, run_now: c.run_now, edit: c.revise, archive: c.archive, discuss };
}

export function legacy_row_controls(s: AutomationSummary, busy: boolean): Record<LegacyAction, { enabled: boolean; reason?: string }> {
  const off = (reason: string) => ({ enabled: false, reason });
  if (busy) return { legacy_pause: off("Working…"), legacy_resume: off("Working…"), legacy_run_now: off("Working…"), open_run: { enabled: true }, recreate: off("Working…") };
  const paused = s.status === "paused";
  const live = s.status === "active" || s.status === "paused";
  return {
    legacy_pause: paused ? off("Already suspended.") : live ? { enabled: true } : off("The schedule has ended."),
    legacy_resume: paused ? { enabled: true } : off(live ? "Already running on schedule." : "The schedule has ended."),
    legacy_run_now: s.status === "active" ? { enabled: true } : off(paused ? "The schedule is off: switch Active on first." : "The schedule has ended."),
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
    notes.push("The legacy schedule ran once; pick the date and time to run.");
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
  /**
   * GET /me/email, re-read with every list refresh (and when Launch → Automate
   * opens). null = unknown (not read yet, refused or failed): the email options
   * then say "Connect a mailbox first — open My email".
   */
  email_status: MyEmailStatus | null;
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
  email_status: null,
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

  /** GET /me/email → `state.email_status` (null when it cannot be read; never an automations error). */
  /**
   * `POST /automations/schedule-preview` (round 16): the gateway's line, next run and time zone
   * for a trigger, nothing stored — the Automate form and the Edit form show them verbatim.
   */
  readonly preview_schedule = (trigger: TriggerSpec): Promise<SchedulePreview> => this.client.previewSchedule(trigger);

  async load_email_status(): Promise<void> {
    try {
      const status = await this.client.getMyEmail();
      this.set({ email_status: status && typeof status === "object" ? status : null });
    } catch {
      this.set({ email_status: null });
    }
  }

  /** Is the user's email account usable now (the kit's rule)? */
  get email_usable(): boolean {
    return emailUsable(this.state.email_status);
  }

  async refresh(): Promise<void> {
    const seq = ++this.list_seq;
    this.set({ loading: true });
    try {
      const items = await this.list_all();
      void this.load_email_status();
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

  private definitions = new Map<string, { revision: number | null; answer: Promise<AutomationDefinition | null> }>();

  /**
   * One automation's definition for its card (the list carries none), read
   * once per revision: a new revision (any client) reads it again. Legacy
   * schedules have none (null).
   */
  definition(summary: AutomationSummary): Promise<AutomationDefinition | null> {
    if (is_legacy_summary(summary)) return Promise.resolve(null);
    const id = summary.automation_id;
    const open = this.state.detail;
    if (open && open.automation_id === id && open.definition && open.definition.revision === summary.revision) return Promise.resolve(open.definition);
    const hit = this.definitions.get(id);
    if (hit && hit.revision === summary.revision) return hit.answer;
    const answer = this.client.getAutomation(id).then((d) => d.definition ?? null);
    answer.catch(() => this.definitions.delete(id));
    this.definitions.set(id, { revision: summary.revision, answer });
    return answer;
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
            : action === "pause" || action === "resume"
              ? active_notice(summary.title, action === "resume")
              : `${ROW_ACTION_SENT[action]} sent to “${summary.title}”.`,
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
      this.set({ notice: action === "legacy_run_now" ? `Run now sent to “${summary.title}”.` : active_notice(summary.title, action === "legacy_resume") });
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

  /** The list's feedback line is brief: the page clears it after a few seconds or on dismiss. */
  dismiss_notice(): void {
    if (this.state.notice) this.set({ notice: "" });
  }

  dismiss_error(): void {
    if (this.state.error) this.set({ error: null });
  }
}

/** The feedback line after the "Active" switch: the NEW state, not the verb sent. */
export function active_notice(title: string, active: boolean): string {
  return active ? `“${title}” is active: it runs on its schedule.` : `“${title}” is paused: scheduled runs are skipped.`;
}

const ROW_ACTION_SENT: Record<"run_now" | "archive", string> = {
  run_now: "Run now",
  archive: "Archive",
};
