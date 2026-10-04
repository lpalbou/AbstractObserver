// Round 13 (DESIGN R13.2): the automation form's visible Workspaces section
// (the kit WorkspaceChooser at the run level), stored on the definition as
// target.input_data.workspace, editable on an existing automation (one
// revision per change), shown as one line ("Workspaces: <summary>") on the
// card and the detail. No "Advanced" disclosure in the Automate form.
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WORKSPACE_CHOOSER_TEXT as T, workspaceDryRun } from "@abstractframework/ui-kit";

import { AutomateTitleLimits, AutomateWhenContext } from "./automate_form";
import { build_automate_request, DEFAULT_AUTOMATE_FORM } from "./automations";
import {
  AUTOMATION_WORKSPACES_TITLE,
  WorkspaceRevisions,
  automation_workspace,
  save_automation_workspace,
  with_workspace,
  workspace_changes,
  workspace_summary,
  workspaces_line,
} from "./automation_workspaces";

const PICS = "/Users/alice/Pictures";
const DOCS = "/Users/alice/Documents";
const VALUE = { posture: "allowed_only" as const, default_mode: "rw" as const, folders: [{ path: PICS, mode: "rw" as const }, { path: DOCS, mode: "ro" as const }] };
const LINE = "Deny everything, allow listed workspaces · /Users/alice/Pictures (rw) · /Users/alice/Documents (ro)";
const definition = {
  revision: 3,
  target: {
    bundle_ref: "basic-agent@0.0.5",
    flow_id: "81795ea9",
    workflow_id: "basic-agent@0.0.5:81795ea9",
    input_data: { prompt: "Sort the photos", workspace: VALUE, workspace_allowed_paths: [PICS, DOCS], workspace_access_mode: "workspace_or_allowed", workspace_root: "/data/session-automation-1" },
  },
} as any;
const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const form_src = readFileSync(new URL("./automate_form.tsx", import.meta.url), "utf8");
const unescape = (h: string) => h.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe("Automate form: a visible Workspaces section, no Advanced disclosure (R13.2)", () => {
  it("Workspaces is its own group after Tools and before Email, with the host's chooser inside (one heading)", () => {
    const html = unescape(renderToStaticMarkup(<AutomateWhenContext form={DEFAULT_AUTOMATE_FORM} on_change={() => {}} workspaces={<div id="chooser">chooser</div>} />));
    expect(html).toContain('<div class="automate_workspaces" data-section="workspaces" role="group" aria-label="Workspaces"><div id="chooser">chooser</div></div>');
    // One heading: the chooser's own ("Workspaces"), never a second legend around it.
    expect(html).not.toContain("<legend>Workspaces</legend>");
    expect(html.indexOf('data-section="tools"')).toBeLessThan(html.indexOf('data-section="workspaces"'));
    expect(html.indexOf('data-section="workspaces"')).toBeLessThan(html.indexOf('data-section="email"'));
    expect(html).not.toMatch(/<details|<summary/);
  });

  it("Title and limits is a visible section with the kit dialog's words", () => {
    const html = unescape(renderToStaticMarkup(<AutomateTitleLimits form={DEFAULT_AUTOMATE_FORM} on_change={() => {}} />));
    expect(html).toContain("<legend>Title and limits</legend>");
    for (const w of ["Title", "Defaults to the task's first line", "First run at (UTC; empty = now)", "Stop after this many runs", "Stop at (UTC)"]) expect(html).toContain(w);
    expect(html).not.toMatch(/<details|<summary|Advanced/);
  });

  it("the Automate block of the Launch page has no disclosure around the schedule fields or the workspaces", () => {
    expect(app).not.toContain("launch_advanced");
    expect(app).not.toMatch(/>\s*Advanced\{/);
    expect(app).not.toContain("AutomateAdvancedSchedule");
    expect(form_src).not.toContain("AutomateAdvancedSchedule");
    // The chooser rides the automation form's Workspaces slot, and Run once shows it as a visible section.
    expect(app).toMatch(/workspaces=\{launch_workspaces_chooser\}/);
    expect(app).toMatch(/<section className="launch_workspaces" data-section="workspaces"/);
    const automate = app.slice(app.indexOf('{launch_mode === "automate" ? ('), app.indexOf("{/* ── Launch button ── */}"));
    expect(automate).toContain("<AutomateTitleLimits");
    expect(automate).not.toMatch(/<details/);
  });

  it("the create body stores the chooser's value as target.input_data.workspace; Run once's Run workspace never rides an automation", () => {
    const built = build_automate_request(DEFAULT_AUTOMATE_FORM, {
      choice: { kind: "default", interface: "abstractcode.agent.v1" },
      bundle_ref_for: () => "",
      input_data: { prompt: "Sort the photos", workspace: VALUE, workspace_root: "/tmp/elsewhere" },
      request_id: "r1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body.target.input_data?.workspace).toEqual(VALUE);
    expect("workspace_root" in (built.body.target.input_data || {})).toBe(false);
    const mine = build_automate_request(DEFAULT_AUTOMATE_FORM, { choice: { kind: "default", interface: "abstractcode.agent.v1" }, bundle_ref_for: () => "", input_data: { prompt: "x" }, request_id: "r2" });
    expect(mine.ok && "workspace" in (mine.body.target.input_data || {})).toBe(false);
  });
});

describe("An existing automation's workspaces", () => {
  it("reads the stored payload; absent = Use my default (null)", () => {
    expect(automation_workspace(definition)).toEqual(VALUE);
    expect(automation_workspace({ target: { flow_id: "f", bundle_ref: "b", input_data: { prompt: "x" } } } as any)).toBeNull();
    expect(automation_workspace(null)).toBeNull();
  });

  it("a change is the target with the new payload; the gateway's derived keys are dropped so it derives them again; null removes it", () => {
    const next = { ...VALUE, folders: [{ path: PICS, mode: "ro" as const }] };
    const changes = workspace_changes(definition, next);
    expect(changes.target).toEqual({
      bundle_ref: "basic-agent@0.0.5",
      flow_id: "81795ea9",
      input_data: { prompt: "Sort the photos", workspace: next, workspace_root: "/data/session-automation-1" },
    });
    const mine = workspace_changes(definition, null);
    expect(mine.target?.input_data).toEqual({ prompt: "Sort the photos", workspace_root: "/data/session-automation-1" });
    expect(with_workspace(undefined, null)).toEqual({});
  });

  it("save = ONE revision with the expected revision and a command id; the next save expects the revision this page made", async () => {
    const revise = vi.fn(async () => ({ accepted: true }));
    const revisions = new WorkspaceRevisions();
    const auto = { automation_id: "a1", summary: { revision: 3 }, definition };
    await save_automation_workspace({ revise }, revisions, auto, null, "cmd-1");
    expect(revise).toHaveBeenCalledTimes(1);
    expect(revise.mock.calls[0]).toEqual(["a1", workspace_changes(definition, null), 3, "cmd-1"]);
    // The summary has not been re-read yet: the second save still expects 4 (this page's own revision).
    await save_automation_workspace({ revise }, revisions, auto, VALUE, "cmd-2");
    expect((revise.mock.calls[1] as unknown[])[2]).toBe(4);
  });

  it("a refused revision rejects and records nothing (the kit shows the sentence + Not saved.)", async () => {
    const revisions = new WorkspaceRevisions();
    const sentence = "The gateway allows this workspace read-only: /Users/alice/Documents.";
    const revise = vi.fn(async () => {
      throw { status: 422, code: "invalid_definition", message: sentence };
    });
    await expect(save_automation_workspace({ revise }, revisions, { automation_id: "a1", summary: { revision: 3 }, definition }, VALUE, "c")).rejects.toMatchObject({ message: sentence });
    expect(revisions.expected("a1", 3)).toBe(3);
  });

  it("the Edit form saves after this page's workspace revisions, never past another client's, and keeps the stored workspaces in a target change", () => {
    const revisions = new WorkspaceRevisions();
    revisions.record("a1", 3, VALUE);
    revisions.record("a1", 4, null);
    expect(revisions.expected("a1", 3)).toBe(5);
    expect(revisions.expected("a1", 2)).toBe(2);
    expect(revisions.expected("a2", 3)).toBe(3);
    expect(revisions.expected("a1", null)).toBeNull();
    const form_target = { target: { bundle_ref: "b", flow_id: "f", input_data: { prompt: "x", workspace: VALUE, workspace_allowed_paths: [PICS] } } } as any;
    expect(revisions.changes("a1", form_target).target.input_data).toEqual({ prompt: "x" });
    expect(revisions.changes("a1", { title: "t" })).toEqual({ title: "t" });
    expect(new WorkspaceRevisions().changes("a1", form_target)).toBe(form_target);
    // The Edit form's own save (this page) is noted: a workspace change after it expects the revision it made.
    const r2 = new WorkspaceRevisions();
    r2.record("a1", 3, VALUE);
    r2.note("a1", 4);
    expect(r2.expected("a1", 3)).toBe(5);
  });
});

describe("The one line: Workspaces: <the gateway's summary>", () => {
  it("is the kit title + the dry run's summary verbatim, cached per value", async () => {
    expect(AUTOMATION_WORKSPACES_TITLE).toBe(T.title);
    expect(workspaces_line(LINE)).toBe(`Workspaces: ${LINE}`);
    const request = vi.fn(async (_path: string, init: { body?: unknown }) => ({ ...{ posture: "allowed_only", default_mode: "rw", folders: [], gateway_summary: "g" }, summary: (init.body as any)?.workspace ? LINE : "Mine" }));
    expect(await workspace_summary(request as any, VALUE)).toBe(LINE);
    expect(await workspace_summary(request as any, VALUE)).toBe(LINE);
    expect(await workspace_summary(request as any, null)).toBe("Mine");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe("api/gateway/workspace/effective/me");
    expect(typeof workspaceDryRun).toBe("function");
  });
});
