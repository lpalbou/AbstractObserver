// Launch → Workspace (round 11, DESIGN R11.6): the kit WorkspaceChooser at the
// RUN level, the same model and words as the gateway console, AbstractCode,
// Flow and the Assistant. The value is this launch's own workspaces
// (`{posture, default_mode, folders}`, null = "Use my default"), kept as
// input_data.workspace in the form: Run once moves it to the run-start body
// (`workspace`), Automate stores it on the definition (target.input_data.workspace).
// What it means is the gateway's dry run (POST api/gateway/workspace/effective/me);
// a change the gateway refuses shows its sentence + "Not saved." and is not
// kept. No policy logic here (no path checks, no clamp, no caps).
import { useCallback, useEffect, useState } from "react";
import { WorkspaceChooser, workspaceDryRun, workspaceErrorSentence, type WorkspaceEffective, type WorkspaceRequest } from "@abstractframework/ui-kit";
import type { RunWorkspace } from "../lib/gateway_client";

/** The kit client's request over a `fetch_gateway(path, init)` transport; a 4xx throws the gateway's `detail` sentence. */
export function observerWorkspaceRequest(fetchGateway: (path: string, init?: RequestInit) => Promise<Response>, csrf: () => Record<string, string> = () => ({})): WorkspaceRequest {
  return async (path, init) => {
    const r = await fetchGateway(path, {
      method: init.method,
      headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...csrf() },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await r.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    // FastAPI `detail`: a sentence, or {reason, message, path} (a workspace refusal).
    if (!r.ok) throw new Error(typeof body?.detail === "string" ? body.detail : typeof body?.detail?.message === "string" ? body.detail.message : text || `Gateway request failed (${r.status})`);
    return body;
  };
}

export type LaunchWorkspaceProps = {
  connected: boolean;
  request: WorkspaceRequest;
  /** input_data.workspace as stored in the launch form; null = absent ("Use my default"). */
  value: RunWorkspace | null;
  onChange: (next: RunWorkspace | null) => void;
  disabled?: boolean;
};

export function LaunchWorkspace({ connected, request, value, onChange, disabled }: LaunchWorkspaceProps) {
  const [effective, setEffective] = useState<WorkspaceEffective | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value_key = JSON.stringify(value);
  useEffect(() => {
    if (!connected) {
      setEffective(null);
      setError(null);
      return;
    }
    let live = true;
    setError(null);
    workspaceDryRun(request)(value)
      .then((next) => live && setEffective(next))
      .catch((e) => live && setError(`Could not read your workspaces: ${workspaceErrorSentence(e)}`));
    return () => {
      live = false;
    };
    // `value` is identified by `value_key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, value_key, request]);
  // A change is dry-run first: a refusal rejects (the kit shows the sentence) and the value stays.
  const change = useCallback(
    async (next: RunWorkspace | null) => {
      const answer = await workspaceDryRun(request)(next);
      setEffective(answer);
      onChange(next);
    },
    [request, onChange],
  );
  const unavailable = !connected ? "Connect to your gateway to choose workspaces." : disabled ? "The run is starting." : null;
  return (
    <WorkspaceChooser
      level="run"
      idPrefix="observer-launch-workspace"
      value={value}
      effective={effective}
      onChange={change}
      loadError={connected ? error : unavailable}
      unavailableReason={unavailable}
    />
  );
}
