// Round 11 (DESIGN R11.1 FINAL / R11.6): Launch → Workspace is the kit
// WorkspaceChooser at the RUN level (same rows and words as the console, Code,
// Flow and the Assistant). The launch's own workspaces are kept as
// input_data.workspace in the form: Run once moves them to the run-start body
// (`workspace`), Automate stores them on the definition
// (target.input_data.workspace). What they mean is the gateway's dry run; no
// policy logic in the app.
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CHOOSER_TEXT as T, WorkspaceChooser, workspaceDryRun, workspaceRefusal } from "@abstractframework/ui-kit";
import { GatewayClient } from "../lib/gateway_client";
import { build_automate_request, DEFAULT_AUTOMATE_FORM } from "./automations";
import { LaunchWorkspace, observerWorkspaceRequest } from "./launch_workspace";

const PICS = "/Users/alice/Pictures";
const DOCS = "/Users/alice/Documents";
const GW_LINE = "Allow everything, refuse listed workspaces (rw) · /Users/alice/Documents (ro)";
const LINE = "Deny everything, allow listed workspaces · /Users/alice/Pictures (rw) · /Users/alice/Documents (ro)";
const VALUE = { posture: "allowed_only" as const, default_mode: "rw" as const, folders: [{ path: PICS, mode: "rw" as const }, { path: DOCS, mode: "ro" as const }] };
const effective = {
  posture: "allowed_only" as const,
  default_mode: "rw" as const,
  folders: [{ path: PICS, mode: "rw" as const, cap: "rw" as const, source: "run" }, { path: DOCS, mode: "ro" as const, cap: "ro" as const, source: "run" }],
  summary: LINE,
  gateway_summary: GW_LINE,
};
const REFUSED = "/etc is outside the workspaces the gateway allows.";
const refusal = () => new Response(JSON.stringify({ detail: { reason: "workspace_refused", message: REFUSED, path: "/etc" } }), { status: 400 });
const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const chooser = readFileSync(new URL("./launch_workspace.tsx", import.meta.url), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("Launch → Workspace (round 11, run level)", () => {
  it("the dry run goes through the app's gateway transport (POST workspace/effective/me {workspace}); a refusal is the sentence + Not saved.", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchGateway = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push([path, init]);
      return new Response(JSON.stringify(effective), { status: 200 });
    });
    const answer = await workspaceDryRun(observerWorkspaceRequest(fetchGateway))(VALUE);
    expect(calls[0][0]).toBe("api/gateway/workspace/effective/me");
    expect(calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ workspace: VALUE });
    expect(answer.summary).toBe(LINE);
    let message = "";
    try {
      await workspaceDryRun(observerWorkspaceRequest(vi.fn(async () => refusal())))({ ...VALUE, folders: [{ path: "/etc", mode: "rw" }] });
    } catch (e) {
      message = workspaceRefusal(e);
    }
    expect(message).toBe(`${REFUSED} Not saved.`);
  });

  it("Run once: the start body carries `workspace` (not input_data) and a refused start shows the gateway's sentence verbatim", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ run_id: "r1" }), { status: 200 });
    }));
    const gw = new GatewayClient({ base_url: "http://gw.test", auth_token: "" } as any);
    await gw.start_run("f", { prompt: "x" }, { bundle_id: "b", workspace: VALUE });
    await gw.start_run("f", { prompt: "x" }, { bundle_id: "b" });
    expect(bodies[0].workspace).toEqual(VALUE);
    expect(bodies[0].input_data).toEqual({ prompt: "x" });
    expect("workspace" in bodies[1]).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => refusal()));
    await expect(gw.start_run("f", {}, { bundle_id: "b", workspace: VALUE })).rejects.toThrow(new RegExp(`^${REFUSED.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`));
  });

  it("Run once moves input_data.workspace into the start body; Automate stores it on the definition", () => {
    expect(app).toMatch(/const run_workspace = input_data\.workspace[\s\S]*delete \(input_data as any\)\.workspace;[\s\S]*\.\.\.\(run_workspace \? \{ workspace: run_workspace \} : \{\}\)/);
    expect(app).toContain('update_input_data_field("workspace", next === null ? undefined : next)');
    const built = build_automate_request(DEFAULT_AUTOMATE_FORM, {
      choice: { kind: "default", interface: "abstractcode.agent.v1" },
      bundle_ref_for: () => "",
      input_data: { prompt: "Sort the photos", workspace: VALUE },
      request_id: "rq",
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect((built.body.target as any).input_data.workspace).toEqual(VALUE);
  });

  it("Gateway line, posture, rows with caps, Use my default and the effective line come from the dry run", () => {
    const mine = renderToStaticMarkup(<WorkspaceChooser level="run" value={null} effective={effective} onChange={() => {}} />);
    expect(mine).toContain(`${T.gatewayPrefix} ${GW_LINE}`);
    expect(mine).toContain(`>${T.useDefault}<`);
    expect(mine).toContain('data-following="true"');
    const own = renderToStaticMarkup(<WorkspaceChooser level="run" value={VALUE} effective={effective} onChange={() => {}} />);
    expect(own).toContain(T.capReadOnly);
    expect(own).toContain(`data-workspace="effective">${LINE}<`);
    expect(own).not.toMatch(/>[^<]*\b(folders?|shared workspace)\b[^<]*</i);
  });

  it("while disconnected the chooser says why", () => {
    const html = renderToStaticMarkup(<LaunchWorkspace connected={false} request={async () => ({})} value={null} onChange={() => {}} />);
    expect(html).toContain("Connect to your gateway to choose workspaces.");
  });

  it("the launch form has no access modes, allowed-paths lists or local policy logic", () => {
    expect(app).toContain("<LaunchWorkspace");
    expect(app).not.toMatch(/workspace_access_mode|workspace_ignored_paths|workspace_allowed_paths|workspace_or_allowed|all_except_ignored|Access Mode/);
    expect(chooser).toContain('level="run"');
    expect(chooser).not.toMatch(/\.cap\b|\.filter\(|startsWith\(|builtin_refused|["'`]api\/gateway\//);
  });
});
