/**
 * The Observer's on/off settings, one kit switch each (docs/state-toggles.md
 * in AbstractUIC: a persistent on/off setting is a switch labelled by the
 * feature, highlighted when on; never a verb label or an On/Off select).
 *
 * Hook-free so the tests render them in both states without a DOM.
 */
import React from "react";

import { AfSwitch } from "@abstractframework/ui-kit";

/** Settings → Gateway: reuse the browser session when the app opens. */
export function AutoConnectSwitch(props: { checked: boolean; onChange: (next: boolean) => void }): React.ReactElement {
  return (
    <AfSwitch
      variant="row"
      action="auto-connect"
      label="Auto-connect on load"
      description="Reuse the browser session automatically when the app opens."
      checked={props.checked}
      onChange={props.onChange}
    />
  );
}

/** Settings → Assistant skills: one switch per skill of the gateway's shelf. */
export function AssistantSkillSwitch(props: {
  name: string;
  version?: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  return (
    <div className={`settings_choice ${props.checked ? "on" : ""}`}>
      <AfSwitch
        variant="row"
        action="assistant-skill"
        label={
          <span className="settings_choice_name">
            {props.name}
            {props.version ? <em> v{props.version}</em> : null}
          </span>
        }
        ariaLabel={props.name}
        description={props.description || undefined}
        checked={props.checked}
        onChange={props.onChange}
      />
    </div>
  );
}

export const SCHEDULE_ACTIVE_HINT = "On: the schedule runs at its times. Off: suspended, scheduled runs are skipped until it is on again.";

/**
 * Observe toolbar, legacy scheduled run: the schedule's "Active" switch.
 * ON = it runs at its times, OFF = suspended. Switching it off asks for a
 * reason first (the caller opens the confirmation); switching it on applies
 * at once.
 */
export function ScheduleActiveSwitch(props: {
  active: boolean;
  unavailableReason: string | null;
  busy: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  return (
    <AfSwitch
      variant="sm"
      action="schedule-active"
      className="observe_schedule_switch"
      label="Active"
      hint={SCHEDULE_ACTIVE_HINT}
      checked={props.active}
      unavailableReason={props.unavailableReason}
      busy={props.busy}
      onChange={props.onChange}
    />
  );
}

/** System → Memory map: keep refreshing as new memory arrives. */
export function MindmapLiveSwitch(props: { checked: boolean; onChange: (next: boolean) => void }): React.ReactElement {
  return <AfSwitch variant="sm" action="mindmap-live" label="Live" hint="Refresh the map as new memory arrives." checked={props.checked} onChange={props.onChange} />;
}

/**
 * Edit schedule dialog: apply the new interval now. Form state only — the
 * dialog's single primary action saves it with the interval.
 */
export function ApplyImmediatelySwitch(props: { checked: boolean; busy: boolean; onChange: (next: boolean) => void }): React.ReactElement {
  return (
    <AfSwitch
      variant="row"
      action="apply-immediately"
      label="Apply immediately"
      description="Recompute the next run from now if the schedule is waiting."
      checked={props.checked}
      busy={props.busy}
      onChange={props.onChange}
    />
  );
}
