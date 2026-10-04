// An automation's Workspaces (round 13, DESIGN R13.2 + R11.1 FINAL): the kit
// WorkspaceChooser at the RUN level, the same section and words as
// AbstractCode's and the AbstractAssistant's automation dialogs.
//
// - The value is the definition's `target.input_data.workspace`
//   (`{posture, default_mode, folders}`; absent = "Use my default"). The
//   gateway stores it and clamps it to the eligible workspaces at each run.
// - What it means is the gateway's dry run (POST
//   api/gateway/workspace/effective/me {workspace}): the chooser's effective
//   line, the card's and the detail's one line ("Workspaces: <summary>").
// - On an existing automation every change is ONE revision (PATCH
//   /automations/{id} with expected_revision), dry-run first; a refusal shows
//   the gateway's sentence + "Not saved." and nothing is stored.
// No policy logic here (no path checks, no clamp, no caps).
import React, { useCallback, useEffect, useState } from "react";

import {
  WORKSPACE_CHOOSER_TEXT,
  WorkspaceChooser,
  workspaceDryRun,
  workspaceErrorSentence,
  type AutomationChanges,
  type AutomationDefinition,
  type WorkspaceEffective,
  type WorkspaceRequest,
} from "@abstractframework/ui-kit";

import type { RunWorkspace } from "../lib/gateway_client";

/** The section title in all three apps (the kit's chooser title). */
export const AUTOMATION_WORKSPACES_TITLE = WORKSPACE_CHOOSER_TEXT.title;

/** "Workspaces: <summary>" — the one line on the card and the detail (the summary is the gateway's, verbatim). */
export function workspaces_line(summary: string): string {
  return `${AUTOMATION_WORKSPACES_TITLE}: ${summary}`;
}

/** Keys the gateway derives from the payload when it stores a definition: dropped on every change so it derives them again. */
const DERIVED_KEYS = ["workspace_access_mode", "workspace_allowed_paths"] as const;

function is_payload(v: unknown): v is RunWorkspace {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as RunWorkspace).folders));
}

/** The automation's stored workspaces (`target.input_data.workspace`), or null ("Use my default"). */
export function automation_workspace(definition: Pick<AutomationDefinition, "target"> | null | undefined): RunWorkspace | null {
  const v = (definition?.target?.input_data as Record<string, unknown> | undefined)?.workspace;
  return is_payload(v) ? v : null;
}

/** `input_data` with this workspace payload (null = removed: "Use my default"); the derived keys are dropped. */
export function with_workspace(input: Record<string, any> | undefined, next: RunWorkspace | null): Record<string, any> {
  const out: Record<string, any> = { ...(input || {}) };
  for (const key of DERIVED_KEYS) delete out[key];
  if (next === null) delete out.workspace;
  else out.workspace = { posture: next.posture, default_mode: next.default_mode, folders: next.folders.map((f) => ({ path: f.path, mode: f.mode })) };
  return out;
}

/** The PATCH `changes` that store `next` on this definition (same target shape as AbstractCode's settings revisions). */
export function workspace_changes(definition: Pick<AutomationDefinition, "target">, next: RunWorkspace | null): AutomationChanges {
  // A stored definition always names the resolved bundle (the gateway publishes `@default` targets).
  const t = definition.target as { bundle_ref: string; flow_id: string; input_data?: Record<string, any> };
  return { target: { bundle_ref: t.bundle_ref, flow_id: t.flow_id, input_data: with_workspace(t.input_data, next) as any } };
}

// --- the gateway's summary for a value (card + detail line) ---------------------------

const SUMMARY_TTL_MS = 30_000;
const summaries = new WeakMap<WorkspaceRequest, Map<string, { at: number; answer: Promise<string> }>>();

/** The gateway's effective summary for `value` (dry run), cached briefly per request transport and value. */
export function workspace_summary(request: WorkspaceRequest, value: RunWorkspace | null, now = Date.now()): Promise<string> {
  let cache = summaries.get(request);
  if (!cache) summaries.set(request, (cache = new Map()));
  const key = JSON.stringify(value);
  const hit = cache.get(key);
  if (hit && now - hit.at < SUMMARY_TTL_MS) return hit.answer;
  const answer = workspaceDryRun(request)(value).then((e) => e.summary);
  answer.catch(() => cache?.delete(key));
  cache.set(key, { at: now, answer });
  return answer;
}

/** Forget the cached summaries (after a change of the account default or an automation's workspaces). */
export function forget_workspace_summaries(request: WorkspaceRequest): void {
  summaries.delete(request);
}

/** "Workspaces: <summary>" for one automation (card / detail). Nothing while unknown; the gateway's sentence when it refuses. */
export function AutomationWorkspacesLine(props: { request: WorkspaceRequest | null; connected: boolean; value: RunWorkspace | null; refresh_key?: string | number }): React.ReactElement | null {
  const [text, set_text] = useState<string | null>(null);
  const key = JSON.stringify(props.value);
  useEffect(() => {
    if (!props.connected || !props.request) {
      set_text(null);
      return;
    }
    let live = true;
    workspace_summary(props.request, props.value)
      .then((s) => live && set_text(workspaces_line(s)))
      .catch((e) => live && set_text(workspaces_line(workspaceErrorSentence(e))));
    return () => {
      live = false;
    };
    // `value` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request, props.connected, key, props.refresh_key]);
  if (!text) return null;
  return (
    <span className="auto_workspaces_line" data-field="workspaces" title={text}>
      {text}
    </span>
  );
}

// --- the chooser (create form and existing automation) ---------------------------------

/**
 * The run-level chooser for an automation's workspaces. `on_change` receives a
 * value the gateway's dry run accepted; reject in it (e.g. the revision was
 * refused) and the kit shows the sentence + "Not saved.".
 */
export function AutomationWorkspacesChooser(props: {
  connected: boolean;
  request: WorkspaceRequest;
  value: RunWorkspace | null;
  on_change(next: RunWorkspace | null): void | Promise<unknown>;
  disabled?: boolean;
  id_prefix: string;
}): React.ReactElement {
  const { connected, request, value } = props;
  const [effective, set_effective] = useState<WorkspaceEffective | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const key = JSON.stringify(value);
  useEffect(() => {
    if (!connected) {
      set_effective(null);
      set_error(null);
      return;
    }
    let live = true;
    set_error(null);
    workspaceDryRun(request)(value)
      .then((next) => live && set_effective(next))
      .catch((e) => live && set_error(`Could not read your workspaces: ${workspaceErrorSentence(e)}`));
    return () => {
      live = false;
    };
    // `value` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, key, request]);
  const on_change = props.on_change;
  const change = useCallback(
    async (next: RunWorkspace | null) => {
      // Dry run first: a refusal rejects (the kit shows the sentence) and nothing is kept.
      const answer = await workspaceDryRun(request)(next);
      await on_change(next);
      set_effective(answer);
      forget_workspace_summaries(request);
    },
    [request, on_change],
  );
  const unavailable = !connected ? "Connect to your gateway to choose workspaces." : props.disabled ? "Saving…" : null;
  return (
    <WorkspaceChooser
      level="run"
      idPrefix={props.id_prefix}
      value={value}
      effective={effective}
      onChange={change}
      loadError={connected ? error : unavailable}
      unavailableReason={unavailable}
    />
  );
}

/**
 * Revisions this page made for a workspace change, so the kit Edit form (which
 * snapshots the revision when it opens) can still save after them: its
 * expected_revision moves past the revisions this page made itself, never past
 * anyone else's (another client's change still answers 409 revision_conflict).
 */
export class WorkspaceRevisions {
  private made = new Map<string, Set<number>>();
  private current = new Map<string, RunWorkspace | null>();
  /** A workspace revision with `expected` succeeded: the gateway's next revision is this page's. */
  record(automation_id: string, expected: number | null, value: RunWorkspace | null): void {
    this.current.set(automation_id, value);
    if (expected === null) return;
    let set = this.made.get(automation_id);
    if (!set) this.made.set(automation_id, (set = new Set()));
    set.add(expected + 1);
  }
  /** The expected_revision for a save based on `expected`. */
  expected(automation_id: string, expected: number | null): number | null {
    if (expected === null) return null;
    const set = this.made.get(automation_id);
    let rev = expected;
    while (set && set.has(rev + 1)) rev += 1;
    return rev;
  }
  /** A kit form change carrying a target: keep the workspaces this page stored since the form opened. */
  changes(automation_id: string, changes: AutomationChanges): AutomationChanges {
    if (!this.current.has(automation_id) || !changes.target) return changes;
    const value = this.current.get(automation_id) ?? null;
    return { ...changes, target: { ...changes.target, input_data: with_workspace(changes.target.input_data as Record<string, any>, value) as any } };
  }
}

/**
 * Store `next` on an existing automation: ONE revision (PATCH with the
 * expected revision, past this page's own workspace revisions) and record it.
 * Rejects with the gateway's error (the chooser shows its sentence + "Not saved.").
 */
export async function save_automation_workspace(
  ctl: { revise(id: string, changes: AutomationChanges, expected_revision: number | null, command_id?: string): Promise<unknown> },
  revisions: WorkspaceRevisions,
  automation: { automation_id: string; summary: { revision: number | null }; definition: Pick<AutomationDefinition, "target"> },
  next: RunWorkspace | null,
  command_id: string,
): Promise<void> {
  const expected = revisions.expected(automation.automation_id, automation.summary.revision);
  await ctl.revise(automation.automation_id, workspace_changes(automation.definition, next), expected, command_id);
  revisions.record(automation.automation_id, expected, next);
}
