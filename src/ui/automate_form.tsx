/**
 * Launch → Automate: When, Context, Tools, Workspaces (the host's chooser),
 * Email, and Title and limits — every section visible, no disclosure (the
 * same sections as the kit's AfScheduleDialog in AbstractCode and the
 * AbstractAssistant's schedule sheet). Hook-free (the Launch page owns the state); the rules — presets,
 * the `schedule@2` config, validation — are the kit's (`SCHEDULE_PRESETS`, `buildCreateRequest`,
 * `scheduleLabel`, `AfCalendarRuleFields`) through ./automations.ts. Repeat keeps the
 * fixed-interval UTC sentence ("every 24 hours (UTC)"); Once / Daily / Weekly / Monthly show the
 * GATEWAY's line (schedule-preview `first_run_sentence`) and the account's time zone (round 16):
 * nothing calendar-shaped is composed or computed here.
 */
import React from "react";

import {
  AutomationToolsPicker,
  AfEmailOptionsFields,
  AfEmailSetupNotice,
  AfEmailTriggerFields,
  AfCalendarRuleFields,
  AfServedSchedule,
  calendarWhenOf,
  DEFAULT_EMAIL_RECIPIENTS,
  SCHEDULE_TEXT,
  type PreviewState,
  EMAIL_TEXT,
  SCHEDULE_PRESETS,
  TOOL_APPROVAL_CONSENT,
  emailUsable,
  type MyEmailStatus,
} from "@abstractframework/ui-kit";

import { CONTEXT_HELP, CONTEXT_OWNS_HISTORY, LAUNCH_MODE_HELP, automate_preview, type AutomateForm, type IntervalUnit, type LaunchMode } from "./automations";

/** Launch's mode switch with one sentence saying what the selected mode does. */
export function LaunchModeSwitch(p: {
  mode: LaunchMode;
  automate_available: boolean;
  automate_reason: string;
  on_change(mode: LaunchMode): void;
}): React.ReactElement {
  const btn = (mode: LaunchMode, label: string, title?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={p.mode === mode}
      className={`seg_btn ${p.mode === mode ? "active" : ""}`}
      data-mode={mode}
      title={title}
      onClick={() => p.on_change(mode)}
    >
      {label}
    </button>
  );
  return (
    <div className="launch_mode">
      <div className="seg_toggle launch_mode_switch" role="radiogroup" aria-label="Launch mode" aria-describedby="launch_mode_help">
        {btn("once", "Run once")}
        {btn("automate", "Automate", p.automate_available ? undefined : p.automate_reason)}
      </div>
      <p className="launch_mode_help" id="launch_mode_help" data-mode-help={p.mode} aria-live="polite">
        {LAUNCH_MODE_HELP[p.mode]}
      </p>
    </div>
  );
}

export type AutomateFieldsProps = {
  form: AutomateForm;
  /** The target's tool list when the inputs name one (`input_data.tools`). */
  tools?: string[];
  available_tools?: string[];
  on_tools_change?(tools: string[] | null): void;
  disabled?: boolean;
  on_change(patch: Partial<AutomateForm>): void;
  /** GET /me/email (framework backlog 0992): the email options are offered only when usable; null/absent = not set up. */
  email_status?: MyEmailStatus | null;
  /** Opens the gateway console's My email; absent = "open My email" is plain text. */
  on_open_my_email?: () => void;
  /** The Workspaces section's content (the run-level WorkspaceChooser), shown after Tools. */
  workspaces?: React.ReactNode;
  /**
   * The gateway's preview of the Once / Daily / Weekly / Monthly rule (the Launch page runs the
   * kit's `useSchedulePreview` over `automate_preview_trigger(form)`). Required: the form has no
   * calendar wording of its own.
   */
  served: PreviewState;
  /** Opens the gateway console's Accounts (Preferences: the time zone); absent = no link. */
  on_open_preferences?: () => void;
};

export function AutomateWhenContext(p: AutomateFieldsProps): React.ReactElement {
  const f = p.form;
  const usable = emailUsable(p.email_status);
  // An email choice made while the account was usable reads as Repeat once it is not.
  const when = f.when === "email" && !usable ? "every" : f.when;
  const preview = automate_preview(f, usable);
  return (
    <div className="automate_fields">
      <fieldset data-section="when">
        <legend>{SCHEDULE_TEXT.legend}</legend>
        <div className="automate_row" role="radiogroup" aria-label="Schedule kind">
          <label>
            <input type="radio" name="automate_when" value="every" checked={when === "every"} disabled={p.disabled} onChange={() => p.on_change({ when: "every" })} /> {SCHEDULE_TEXT.kind_every}
          </label>
          {(["daily", "weekly", "monthly"] as const).map((k) => (
            <label key={k}>
              <input type="radio" name="automate_when" value={k} checked={when === k} disabled={p.disabled} onChange={() => p.on_change({ when: k, calendar: calendarWhenOf(k, f.calendar) })} /> {SCHEDULE_TEXT[`kind_${k}`]}
            </label>
          ))}
          <label>
            <input type="radio" name="automate_when" value="once" checked={when === "once"} disabled={p.disabled} onChange={() => p.on_change({ when: "once" })} /> {SCHEDULE_TEXT.kind_once}
          </label>
          <label>
            <input type="radio" name="automate_when" value="email" checked={when === "email"} disabled={p.disabled || !usable} onChange={() => p.on_change({ when: "email" })} /> {EMAIL_TEXT.trigger_label}
          </label>
        </div>
        {!usable ? <AfEmailSetupNotice status={p.email_status} onOpenMyEmail={p.on_open_my_email} /> : null}
        {when === "email" ? (
          <AfEmailTriggerFields value={f.email} onChange={(email) => p.on_change({ email })} disabled={p.disabled} idBase="automate" />
        ) : when === "daily" || when === "weekly" || when === "monthly" ? (
          <AfCalendarRuleFields value={calendarWhenOf(when, f.calendar)} onChange={(calendar) => p.on_change({ calendar })} idBase="automate" disabled={p.disabled} />
        ) : when === "every" ? (
          <>
            <div className="automate_row" role="group" aria-label="Presets">
              {SCHEDULE_PRESETS.map((preset) =>
                preset.when.kind === "every" ? (
                  <button
                    key={preset.label}
                    type="button"
                    className="btn btn_sm"
                    data-preset={preset.label}
                    aria-pressed={Number(f.amount) === preset.when.amount && f.unit === preset.when.unit}
                    disabled={p.disabled}
                    onClick={() => {
                      if (preset.when.kind !== "every") return;
                      p.on_change({ amount: String(preset.when.amount), unit: preset.when.unit });
                    }}
                  >
                    {preset.label}
                  </button>
                ) : null,
              )}
            </div>
            <div className="automate_row">
              <span>{SCHEDULE_TEXT.every_label}</span>
              <input type="number" min={1} step={1} value={f.amount} disabled={p.disabled} aria-label="Interval amount" onChange={(e) => p.on_change({ amount: e.target.value })} />
              <select value={f.unit} disabled={p.disabled} aria-label="Interval unit" onChange={(e) => p.on_change({ unit: e.target.value as IntervalUnit })}>
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
              </select>
            </div>
          </>
        ) : (
          <label className="automate_row">
            <span>{SCHEDULE_TEXT.once_label}</span>
            <input type="datetime-local" value={f.once_at} disabled={p.disabled} onChange={(e) => p.on_change({ once_at: e.target.value })} />
          </label>
        )}
        {when === "every" || when === "email" ? (
          <div className="automate_preview" aria-live="polite" data-preview="true">
            {preview || (when === "email" ? "Incomplete email trigger." : SCHEDULE_TEXT.incomplete)}
          </div>
        ) : (
          <div className="automate_preview automate_preview--served">
            <AfServedSchedule state={p.served} onOpenPreferences={p.on_open_preferences} />
          </div>
        )}
      </fieldset>
      <fieldset data-section="context">
        <legend>Context</legend>
        <label>
          <input type="radio" name="automate_context" value="independent" checked={f.context === "independent"} disabled={p.disabled} onChange={() => p.on_change({ context: "independent" })} />{" "}
          <strong>Independent</strong> (default) — {CONTEXT_HELP.independent}
        </label>
        <label>
          <input type="radio" name="automate_context" value="growing" checked={f.context === "growing"} disabled={p.disabled} onChange={() => p.on_change({ context: "growing" })} />{" "}
          <strong>Growing</strong> — {CONTEXT_HELP.growing}
        </label>
        {f.context === "growing" ? <label>
          Max growing context (tokens)
          <input type="number" min={1} step={1} required value={f.growing_max_tokens} disabled={p.disabled} onChange={(e) => p.on_change({ growing_max_tokens: e.target.value })} />
        </label> : null}
        <p className="help_text muted" data-context-owns="use_context">
          {CONTEXT_OWNS_HISTORY}
        </p>
      </fieldset>
      <fieldset data-section="tools">
        <legend>Tools</legend>
        {p.available_tools && p.on_tools_change ? <AutomationToolsPicker availableTools={p.available_tools} value={p.tools ?? null} onChange={p.on_tools_change} disabled={p.disabled} /> : null}
        {when === "email" ? (
          <p className="help_text muted" data-email-rule="untrusted">
            {EMAIL_TEXT.untrusted_hint}
          </p>
        ) : null}
        <label>
          <input type="radio" name="automate_tools" value="auto" checked={f.tool_approval === "auto"} disabled={p.disabled} onChange={() => p.on_change({ tool_approval: "auto" })} />{" "}
          {TOOL_APPROVAL_CONSENT}
          {p.tools && p.tools.length ? <span className="automate_preview"> — {p.tools.join(", ")}</span> : null}
        </label>
        <label>
          <input type="radio" name="automate_tools" value="ask" checked={f.tool_approval === "ask"} disabled={p.disabled} onChange={() => p.on_change({ tool_approval: "ask" })} /> Ask each time — every tool call
          waits for your approval on the Automations page
        </label>
      </fieldset>
      {p.workspaces ? (
        // The chooser titles its own group ("Workspaces"): no second heading here.
        <div className="automate_workspaces" data-section="workspaces" role="group" aria-label="Workspaces">
          {p.workspaces}
        </div>
      ) : null}
      <fieldset data-section="email">
        <legend>Email</legend>
        {!usable ? <AfEmailSetupNotice status={p.email_status} onOpenMyEmail={p.on_open_my_email} /> : null}
        <AfEmailOptionsFields
          notifyEmail={usable && f.notify_email}
          onNotifyEmailChange={(notify_email) => p.on_change({ notify_email })}
          recipients={usable ? f.email_recipients : DEFAULT_EMAIL_RECIPIENTS}
          onRecipientsChange={(email_recipients) => p.on_change({ email_recipients })}
          disabled={p.disabled || !usable}
          idBase="automate"
        />
      </fieldset>
    </div>
  );
}

/** Title and limits: title; for Repeat the first run; for Repeat and the calendar rules max runs and stop at (UTC) — a visible section (the kit dialog's words). */
export function AutomateTitleLimits(p: Omit<AutomateFieldsProps, "served">): React.ReactElement {
  const f = p.form;
  return (
    <div className="automate_fields">
    <fieldset className="automate_limits" data-section="limits">
      <legend>Title and limits</legend>
      <div className="launch_grid">
        <label className="launch_grid_cell" style={{ gridColumn: "1 / -1" }}>
          <span className="launch_label">Title</span>
          <input value={f.title} maxLength={120} disabled={p.disabled} placeholder="Defaults to the task's first line" onChange={(e) => p.on_change({ title: e.target.value })} />
        </label>
        {f.when === "every" || f.when === "daily" || f.when === "weekly" || f.when === "monthly" ? (
          <>
            {f.when === "every" ? (
              <label className="launch_grid_cell">
                <span className="launch_label">First run at (UTC; empty = now)</span>
                <input type="datetime-local" value={f.start_at} disabled={p.disabled} onChange={(e) => p.on_change({ start_at: e.target.value })} />
              </label>
            ) : null}
            <label className="launch_grid_cell">
              <span className="launch_label">Stop after this many runs</span>
              <input type="number" min={1} step={1} value={f.count} disabled={p.disabled} onChange={(e) => p.on_change({ count: e.target.value })} />
            </label>
            <label className="launch_grid_cell">
              <span className="launch_label">Stop at (UTC)</span>
              <input type="datetime-local" value={f.until} disabled={p.disabled} onChange={(e) => p.on_change({ until: e.target.value })} />
            </label>
          </>
        ) : null}
      </div>
    </fieldset>
    </div>
  );
}
