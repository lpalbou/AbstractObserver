/**
 * A discussion with a fork of an automation, IN PLACE on the Automations page
 * (operator report 2026-09-28: Discuss switched to the Observe tab instead of
 * opening a chat). The chat is panel-chat's shared `WorkflowChat` driven by
 * its `WorkflowSessionController` — the same stack AbstractCode's chat uses —
 * over this Observer's gateway connection.
 *
 * - Draft: nothing exists yet; the first message forks the automation at
 *   occurrence N (`POST /automations/{id}/discuss`).
 * - Active: the session's latest run is shown with every earlier turn (the
 *   history bundle's session turns); a later message starts the next turn
 *   with `POST /runs/start {session_id}` on the discussion's own workflow.
 *   The gateway re-stamps each turn (own writable workspace, the
 *   automation's folder read-only, strict history).
 */
import React, { useMemo, useState } from "react";

import {
  WorkflowChat,
  useWorkflowSession,
  workflowPendingInteraction,
  type WorkflowInteraction,
  type WorkflowSessionController,
  type WorkflowTransport,
  type WorkflowWaitInteraction,
} from "@abstractframework/panel-chat";
import { Icon, type DiscussResponse } from "@abstractframework/ui-kit";

import type { GatewayClient } from "../lib/gateway_client";
import { WorkspaceBrowser } from "./workspace_browser";

export const OBSERVER_CLIENT_ID = "abstractobserver";

/** panel-chat's transport over the Observer's gateway client. */
export function observer_workflow_transport(
  gw: Pick<GatewayClient, "get_run" | "get_run_history_bundle" | "get_ledger" | "stream_ledger" | "submit_command">,
): WorkflowTransport {
  return {
    getRun: (id) => gw.get_run(id),
    getHistory: (id) => gw.get_run_history_bundle(id, { include_subruns: true, include_session: true, ledger_mode: "full" }),
    getLedger: (id, after, signal) => gw.get_ledger(id, { after, limit: 200, signal }),
    streamLedger: (id, after, onStep, signal, onOpen) => gw.stream_ledger(id, { after, on_step: onStep, signal, on_open: onOpen }),
    submitCommand: (command) => gw.submit_command(command),
  };
}

/** `bundle@version:flow` → the `/runs/start` target of the discussion's next turn. */
export function discussion_turn_target(workflow_id: string): { bundle_id: string; flow_id: string } {
  const wid = String(workflow_id || "").trim();
  const i = wid.indexOf(":");
  if (i <= 0 || i === wid.length - 1) throw new Error(`The discussion's workflow id ${JSON.stringify(wid)} is not bundle@version:flow; its next turn cannot be started.`);
  return { bundle_id: wid.slice(0, i), flow_id: wid.slice(i + 1) };
}

/** Runtime waits a discussion can meet (tools ask as in any chat; questions). */
export function discussion_interaction(raw: WorkflowWaitInteraction | null, controller: WorkflowSessionController): WorkflowInteraction | null {
  if (!raw) return null;
  const wait = raw.wait as Record<string, any>;
  const details = (wait.details || {}) as Record<string, any>;
  const id = `${raw.runId}:${String(wait.wait_key || "")}:${raw.stepId || ""}`;
  if (details.mode === "approval_required" || details.kind === "tool_approval") {
    const calls: any[] = Array.isArray(details.tool_calls) ? details.tool_calls : [];
    const target = { runId: raw.runId, waitKey: String(wait.wait_key || ""), stepId: raw.stepId };
    return {
      id,
      kind: "tool-approval",
      title: `${calls.length || "Requested"} ${calls.length === 1 ? "action needs" : "actions need"} permission`,
      toolName: [...new Set(calls.map((c) => String(c?.name || "tool")))].join(", ") || "the requested tools",
      detail: <pre className="mono discussion_tool_args">{JSON.stringify(calls.map((c) => ({ name: c?.name, arguments: c?.arguments })), null, 2)}</pre>,
      approveLabel: "Allow once",
      denyLabel: "Deny",
      onApprove: () => controller.approve(true, target),
      onDeny: () => controller.approve(false, target),
    };
  }
  if (wait.reason === "user" || wait.reason === "ask_user") {
    return {
      id,
      kind: "ask-user",
      title: "A question for you",
      prompt: String(wait.prompt || details.prompt || "How would you like to continue?"),
      allowFreeText: wait.allow_free_text !== false,
      choices: (Array.isArray(wait.choices) ? wait.choices : []).map((c: any) => ({ id: String(c?.value ?? c?.id ?? c), label: String(c?.label ?? c?.text ?? c) })),
      onSubmit: (answer) => controller.resume(answer),
    };
  }
  return null;
}

export type OpenDiscussion = {
  automation_id: string;
  automation_title: string;
  occurrence_index: number;
  /** Set once the fork exists (the gateway's answer to `/discuss`). */
  session?: DiscussResponse;
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function AutomationDiscussion(props: {
  gateway: GatewayClient;
  discussion: OpenDiscussion;
  /** Forks the automation (the page controller's `discuss`). */
  on_fork(automation_id: string, occurrence_index: number, prompt: string): Promise<DiscussResponse>;
  on_close(): void;
  connected: boolean;
}): React.ReactElement {
  const { gateway, discussion } = props;
  const transport = useMemo(() => observer_workflow_transport(gateway), [gateway]);
  const [run_id, set_run_id] = useState<string>(discussion.session?.run_id || "");
  const [draft, set_draft] = useState("");
  const [starting, set_starting] = useState(false);
  const [files, set_files] = useState<"" | "own" | "mounted">("");
  const { controller, snapshot } = useWorkflowSession({ transport, runId: run_id, enabled: props.connected, clientId: OBSERVER_CLIENT_ID });
  const session = discussion.session;
  const running = Boolean(run_id) && !TERMINAL.has(snapshot.status) && snapshot.status !== "idle";
  const pending = workflowPendingInteraction(snapshot);

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    set_starting(true);
    try {
      if (!session) {
        const r = await props.on_fork(discussion.automation_id, discussion.occurrence_index, prompt);
        set_run_id(r.run_id);
      } else {
        const workflow_id = String(snapshot.run?.workflow_id || "");
        const target = discussion_turn_target(workflow_id);
        const next = await gateway.start_run(target.flow_id, { prompt }, { bundle_id: target.bundle_id, session_id: session.session_id });
        set_run_id(next);
      }
      set_draft("");
    } finally {
      set_starting(false);
    }
  };

  const header = (
    <div className="discussion_head">
      <button type="button" className="btn btn_sm" data-action="discussion-back" onClick={props.on_close} title={`Back to ${discussion.automation_title}`}>
        <Icon name="chevronRight" size={13} className="flip_x" /> {discussion.automation_title}
      </button>
      <span className="discussion_title">
        <Icon name="chat" size={15} /> Discussion — fork at #{discussion.occurrence_index}
      </span>
      <span className="pane_spacer" />
      {session ? (
        <>
          <button type="button" className={`btn btn_sm${files === "own" ? " active" : ""}`} data-action="discussion-files" onClick={() => set_files(files === "own" ? "" : "own")} title={session.workspace_root}>
            <Icon name="list" size={14} /> Its files
          </button>
          <button type="button" className={`btn btn_sm${files === "mounted" ? " active" : ""}`} data-action="automation-files" onClick={() => set_files(files === "mounted" ? "" : "mounted")} title={session.mounted_workspace}>
            <Icon name="list" size={14} /> Automation files
          </button>
        </>
      ) : null}
    </div>
  );

  return (
    <section className="pane auto_detail auto_discussion" data-discussion-session={session?.session_id || undefined}>
      {files && session ? (
        <WorkspaceBrowser
          gateway={gateway}
          run_id={files === "own" ? session.run_id : discussion.automation_id}
          title={files === "own" ? "Discussion files" : "Automation files"}
          note={files === "own" ? "The discussion's own writable folder." : "Mounted read-only for the discussion's file tools; nothing is written back."}
          on_close={() => set_files("")}
        />
      ) : null}
      <WorkflowChat
        header={header}
        messages={snapshot.messages}
        draft={draft}
        onDraftChange={set_draft}
        onSend={send}
        busy={running || starting}
        busyLabel={starting ? (session ? "Starting…" : "Forking the automation…") : pending ? "Waiting for you" : "Working…"}
        onCancel={running ? () => controller.cancel() : undefined}
        stopState={snapshot.stop ?? null}
        disabled={!props.connected}
        interaction={discussion_interaction(pending, controller)}
        placeholder={session ? "Ask a follow-up…" : `Ask about run #${discussion.occurrence_index}…`}
        emptyState={
          <div className="help_text muted discussion_intro">
            A new session that forks this automation at #{discussion.occurrence_index} with its history (runs 1–{discussion.occurrence_index}). It works in its own writable
            workspace; the automation's files are mounted read-only for the file tools (shell commands are not sandboxed), and nothing is written back into the
            automation.
          </div>
        }
        footer={snapshot.error ? <div className="observe_context_card error" role="alert">{snapshot.error}</div> : null}
      />
    </section>
  );
}
