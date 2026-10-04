// Round 9 (R9.3): Launch → Workspace is the kit WorkspaceChooser (same rows and
// words as the console, Code and the Assistant); the run's chosen folders ride
// input_data.workspace_allowed_paths; no access modes, no ignored-paths field,
// no policy logic in the app.
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WORKSPACE_CHOOSER_TEXT as T, WorkspaceChooser, workspaceChooserClient, workspaceSelectionAfterToggle, workspaceSelectionView } from "@abstractframework/ui-kit";
import { LaunchWorkspace, observerWorkspaceRequest } from "./launch_workspace";

const SHARED = "/srv/gw/workspaces";
const A = "/data/projects";
const OWN = "/home/me/thesis";
const B = "/data/notes";
const DENIED = "/etc/secrets";
const effective = {
  posture: "allowed_only",
  default_mode: null,
  shared_workspace: SHARED,
  folders: [{ path: SHARED, mode: "rw", source: "shared" }, { path: A, mode: "rw", source: "gateway" }, { path: OWN, mode: "ro", source: "gateway" }, { path: DENIED, mode: "deny", source: "gateway" }],
  summary: "Deny everything, allow listed workspaces · Shared workspace (rw) · /data/projects (rw) · /home/me/thesis (ro)",
};
const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");

describe("Launch → Workspace (round 9)", () => {
  it("reads the caller's folders through the app's gateway transport and surfaces the gateway sentence", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchGateway = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push([path, init]);
      return new Response(JSON.stringify({ ok: true, policy: { default_mode: null, folders: [] }, gateway: { shared_workspace: SHARED, posture: "allowed_only", default_mode: "rw", folders: [{ path: A, mode: "rw" }, { path: OWN, mode: "ro" }, { path: DENIED, mode: "deny" }] }, effective }), { status: 200 });
    });
    const state = await workspaceChooserClient(observerWorkspaceRequest(fetchGateway)).load();
    expect(calls[0][0]).toBe("api/gateway/workspace/policy/me");
    expect(state.effective.shared_workspace).toBe(SHARED);
    const refusing = vi.fn(async () => new Response(JSON.stringify({ detail: "Sign in first." }), { status: 401 }));
    await expect(workspaceChooserClient(observerWorkspaceRequest(refusing)).load()).rejects.toThrow("Sign in first.");
  });

  it("the run's set is chosen among the account's workspaces; a workspace the admin did not list (or refused) cannot be chosen", () => {
    const html = renderToStaticMarkup(<WorkspaceChooser mode="automation" subject="run" effective={effective} selection={null} onSelectionChange={() => {}} />);
    expect(html).toContain(T.runHelp.replace(/'/g, "&#x27;"));
    expect(html).toContain('data-workspace="shared-always"');
    expect(html).not.toContain(B);
    expect(html).not.toContain(DENIED);
    const view = workspaceSelectionView(effective, [OWN, B, DENIED]);
    expect(workspaceSelectionAfterToggle(view, A, true)).toEqual([A, OWN]);
    expect(workspaceSelectionAfterToggle(view, DENIED, true)).toEqual([OWN]);
  });

  it("while disconnected the chooser says why", () => {
    const html = renderToStaticMarkup(<LaunchWorkspace connected={false} request={async () => ({})} selection={null} onSelectionChange={() => {}} />);
    expect(html).toContain("Connect to your gateway to choose workspaces.");
  });

  it("the launch form has no access modes, allowed-paths text or ignored paths any more", () => {
    expect(app).toContain("<LaunchWorkspace");
    expect(app).not.toMatch(/workspace_access_mode|workspace_ignored_paths|workspace_or_allowed|all_except_ignored|Access Mode/);
  });
});
