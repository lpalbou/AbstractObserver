/**
 * Launch → Automate: the When and Context fields, and the schedule part of
 * Advanced. Hook-free (the Launch page owns the state); the rules — presets,
 * `schedule@1` config, UTC wording, validation — are the kit's
 * (`SCHEDULE_PRESETS`, `buildCreateRequest`, `scheduleLabel`) through
 * ./automations.ts. Wording is fixed-interval UTC ("every 24 hours (UTC)"),
 * never calendar wording: `schedule@1` has no time zone.
 */
import React from "react";

import { SCHEDULE_PRESETS, TOOL_APPROVAL_CONSENT } from "@abstractframework/ui-kit";

import { CONTEXT_HELP, automate_preview, type AutomateForm, type IntervalUnit } from "./automations";

export type AutomateFieldsProps = {
  form: AutomateForm;
  /** The target's tool list when the inputs name one (`input_data.tools`). */
  tools?: string[];
  disabled?: boolean;
  on_change(patch: Partial<AutomateForm>): void;
};

export function AutomateWhenContext(p: AutomateFieldsProps): React.ReactElement {
  const f = p.form;
  const preview = automate_preview(f);
  return (
    <div className="automate_fields">
      <fieldset data-section="when">
        <legend>When (UTC)</legend>
        <div className="automate_row" role="radiogroup" aria-label="Schedule kind">
          <label>
            <input type="radio" name="automate_when" value="every" checked={f.when === "every"} disabled={p.disabled} onChange={() => p.on_change({ when: "every" })} /> Repeat
          </label>
          <label>
            <input type="radio" name="automate_when" value="once" checked={f.when === "once"} disabled={p.disabled} onChange={() => p.on_change({ when: "once" })} /> Once at…
          </label>
        </div>
        {f.when === "every" ? (
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
              <span>Every</span>
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
            <span>Run once at (UTC)</span>
            <input type="datetime-local" value={f.once_at} disabled={p.disabled} onChange={(e) => p.on_change({ once_at: e.target.value })} />
          </label>
        )}
        <div className="automate_preview" aria-live="polite" data-preview="true">
          {preview || "Incomplete schedule."}
        </div>
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
      </fieldset>
      <fieldset data-section="tools">
        <legend>Tools</legend>
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
    </div>
  );
}

/** Advanced schedule fields: title, first run, max runs, stop at (UTC). */
export function AutomateAdvancedSchedule(p: AutomateFieldsProps): React.ReactElement {
  const f = p.form;
  return (
    <div className="automate_fields launch_grid" data-section="advanced-schedule">
      <label className="launch_grid_cell" style={{ gridColumn: "1 / -1" }}>
        <span className="launch_label">Title</span>
        <input value={f.title} maxLength={120} disabled={p.disabled} placeholder="Defaults to the prompt's first line" onChange={(e) => p.on_change({ title: e.target.value })} />
      </label>
      {f.when === "every" ? (
        <>
          <label className="launch_grid_cell">
            <span className="launch_label">First run at (UTC; empty = now)</span>
            <input type="datetime-local" value={f.start_at} disabled={p.disabled} onChange={(e) => p.on_change({ start_at: e.target.value })} />
          </label>
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
  );
}
