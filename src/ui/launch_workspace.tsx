// Launch → Workspace (round 9): the kit WorkspaceChooser, the same folder
// model and words as the gateway console, AbstractCode and the Assistant.
// The run being launched may use the account's effective folders
// (GET api/gateway/workspace/policy/me); the chosen set rides the run as
// input_data.workspace_allowed_paths (absent = follows the account). The
// gateway decides: a folder outside the account's folders is refused at run
// start with a sentence. No policy logic here (no path checks, no clamp).
import { useEffect, useState } from "react";
import { WorkspaceChooser, workspaceChooserClient, type WorkspaceEffective, type WorkspaceRequest } from "@abstractframework/ui-kit";

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
    if (!r.ok) throw new Error(typeof body?.detail === "string" ? body.detail : text || `Gateway request failed (${r.status})`);
    return body;
  };
}

export type LaunchWorkspaceProps = {
  connected: boolean;
  request: WorkspaceRequest;
  /** input_data.workspace_allowed_paths as stored in the launch form; null = absent. */
  selection: string[] | null;
  onSelectionChange: (next: string[] | null) => void;
  disabled?: boolean;
  /** Launch mode: one run (default) or an automation being created (its definition stores the set). */
  subject?: "run" | "automation";
};

export function LaunchWorkspace({ connected, request, selection, onSelectionChange, disabled, subject = "run" }: LaunchWorkspaceProps) {
  const [effective, setEffective] = useState<WorkspaceEffective | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connected) {
      setEffective(null);
      setError(null);
      return;
    }
    let live = true;
    setError(null);
    workspaceChooserClient(request)
      .load()
      .then((state) => live && setEffective(state.effective))
      .catch((e) => live && setError(`Could not read your workspace folders: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
  }, [connected, request]);
  const unavailable = !connected ? "Connect to your gateway to choose workspace folders." : disabled ? "The run is starting." : null;
  return (
    <WorkspaceChooser
      mode="automation"
      subject={subject}
      idPrefix="observer-launch-workspace"
      effective={effective}
      selection={selection}
      onSelectionChange={onSelectionChange}
      loadError={connected ? error : unavailable}
      unavailableReason={unavailable}
    />
  );
}
