/**
 * The web equivalent of "open the folder": browse a run's workspace on the
 * gateway host and open or download its files, through the gateway's
 * workspace routes (CONTRACTS §W): `GET /runs/{id}/workspace` (where),
 * `/workspace/files?path=` (one folder) and `/workspace/content?path=` (one
 * file). The gateway applies the caller's workspace policy and its deny lists
 * to every entry and read; this view shows what it serves and says how many
 * entries it kept out.
 *
 * Operator report 2026-09-28: on a remote server the automation's folder was
 * only a path in the UI. A local "open folder" cannot work in a browser; this
 * does, on any machine, with the same credentials as every other call (files
 * are fetched, not linked: a bare link carries no bearer token).
 */
import React, { useCallback, useEffect, useState } from "react";

import { Icon } from "@abstractframework/ui-kit";

import type { GatewayClient, RunWorkspace, WorkspaceEntry, WorkspaceListing } from "../lib/gateway_client";

/** Breadcrumb of a workspace-relative folder: [{label, path}], root first. */
export function workspace_crumbs(path: string): Array<{ label: string; path: string }> {
  const parts = String(path || "").split("/").filter(Boolean);
  const out = [{ label: "Workspace", path: "" }];
  parts.forEach((part, i) => out.push({ label: part, path: parts.slice(0, i + 1).join("/") }));
  return out;
}

export function format_bytes(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Folders first, then files, each by name. */
export function sorted_entries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

/** "2 entries hidden by the gateway's workspace rules" — or "" when none. */
export function hidden_note(listing: Pick<WorkspaceListing, "hidden" | "truncated">): string {
  const h = listing.hidden || {};
  const n = Number(h.blocked || 0) + Number(h.outside_links || 0) + Number(h.other || 0);
  const parts: string[] = [];
  if (n > 0) parts.push(`${n} ${n === 1 ? "entry" : "entries"} hidden by the gateway's workspace rules`);
  if (listing.truncated) parts.push("the list is truncated");
  return parts.join("; ");
}

function save_blob(blob: Blob, name: string, mode: "open" | "download"): void {
  const url = URL.createObjectURL(blob);
  if (mode === "open") {
    window.open(url, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // The opened tab/download holds its own reference by then.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type WorkspaceBrowserProps = {
  gateway: Pick<GatewayClient, "run_workspace" | "run_workspace_files" | "run_workspace_file">;
  /** A run whose `workspace_root` is the folder to browse (an automation's id is its controller run). */
  run_id: string;
  /** "Automation files", "Discussion files", … */
  title: string;
  /** One line under the title (e.g. "read-only for the discussion"). */
  note?: string;
  on_close?: () => void;
};

export function WorkspaceBrowser(props: WorkspaceBrowserProps): React.ReactElement {
  const { gateway, run_id } = props;
  const [where, set_where] = useState<RunWorkspace | null>(null);
  const [path, set_path] = useState("");
  const [listing, set_listing] = useState<WorkspaceListing | null>(null);
  const [error, set_error] = useState("");
  const [loading, set_loading] = useState(false);
  const [file_busy, set_file_busy] = useState("");

  const load = useCallback(
    async (next: string) => {
      set_loading(true);
      set_error("");
      try {
        const [w, l] = await Promise.all([where ? Promise.resolve(where) : gateway.run_workspace(run_id), gateway.run_workspace_files(run_id, next)]);
        set_where(w);
        set_listing(l);
        set_path(next);
      } catch (e: any) {
        set_error(String(e?.message || e));
      } finally {
        set_loading(false);
      }
    },
    [gateway, run_id, where],
  );

  useEffect(() => {
    set_where(null);
    set_listing(null);
    set_path("");
    void (async () => {
      set_loading(true);
      set_error("");
      try {
        const [w, l] = await Promise.all([gateway.run_workspace(run_id), gateway.run_workspace_files(run_id, "")]);
        set_where(w);
        set_listing(l);
      } catch (e: any) {
        set_error(String(e?.message || e));
      } finally {
        set_loading(false);
      }
    })();
  }, [gateway, run_id]);

  const fetch_file = async (entry: WorkspaceEntry, mode: "open" | "download") => {
    set_file_busy(entry.path);
    set_error("");
    try {
      save_blob(await gateway.run_workspace_file(run_id, entry.path), entry.name, mode);
    } catch (e: any) {
      set_error(String(e?.message || e));
    } finally {
      set_file_busy("");
    }
  };

  return (
    <WorkspaceBrowserView
      title={props.title}
      note={props.note}
      where={where}
      path={path}
      listing={listing}
      error={error}
      loading={loading}
      file_busy={file_busy}
      on_navigate={(p) => void load(p)}
      on_refresh={() => void load(path)}
      on_file={(entry, mode) => void fetch_file(entry, mode)}
      on_close={props.on_close}
    />
  );
}

/** The hook-free view (tests render it in any state). */
export function WorkspaceBrowserView(p: {
  title: string;
  note?: string;
  where: RunWorkspace | null;
  path: string;
  listing: WorkspaceListing | null;
  error: string;
  loading: boolean;
  file_busy: string;
  on_navigate(path: string): void;
  on_refresh(): void;
  on_file(entry: WorkspaceEntry, mode: "open" | "download"): void;
  on_close?: () => void;
}): React.ReactElement {
  const note = p.listing ? hidden_note(p.listing) : "";
  return (
    <section className="ws_browser" aria-label={p.title} data-workspace-root={p.where?.workspace_root || undefined}>
      <header className="ws_browser_head">
        <span className="ws_browser_title">
          <Icon name="list" size={15} /> {p.title}
        </span>
        <span className="pane_spacer" />
        <button type="button" className="btn btn_sm btn_icon" onClick={p.on_refresh} disabled={p.loading} title="Refresh" aria-label="Refresh the folder">
          <Icon name="refresh" size={14} />
        </button>
        {p.on_close ? (
          <button type="button" className="btn btn_sm btn_icon" onClick={p.on_close} title="Close" aria-label="Close the file browser">
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </header>
      {p.where ? (
        <div className="ws_browser_root mono" title={p.where.host?.hostname ? `on ${p.where.host.hostname}` : undefined}>
          {p.where.workspace_root}
        </div>
      ) : null}
      {p.note ? <div className="help_text muted">{p.note}</div> : null}
      <nav className="ws_browser_crumbs" aria-label="Folder">
        {workspace_crumbs(p.path).map((c, i, all) =>
          i === all.length - 1 ? (
            <span key={c.path} aria-current="page">
              {c.label}
            </span>
          ) : (
            <React.Fragment key={c.path}>
              <button type="button" className="ws_crumb" onClick={() => p.on_navigate(c.path)}>
                {c.label}
              </button>
              <span className="muted"> / </span>
            </React.Fragment>
          ),
        )}
      </nav>
      {p.error ? (
        <div className="observe_context_card error" role="alert">
          {p.error}
        </div>
      ) : null}
      {p.loading && !p.listing ? <div className="help_text muted">Loading…</div> : null}
      {p.where && !p.where.exists ? <div className="help_text muted">The folder does not exist yet: nothing has been written.</div> : null}
      {p.listing ? (
        p.listing.entries.length ? (
          <ul className="ws_entries">
            {sorted_entries(p.listing.entries).map((e) => (
              <li key={e.path} className="ws_entry" data-type={e.type} data-path={e.path}>
                {e.type === "dir" ? (
                  <button type="button" className="ws_entry_name ws_dir" onClick={() => p.on_navigate(e.path)}>
                    <Icon name="chevronRight" size={13} /> {e.name}/
                  </button>
                ) : (
                  <>
                    <span className="ws_entry_name mono">{e.name}</span>
                    <span className="ws_entry_size muted">{format_bytes(e.size_bytes)}</span>
                    <button type="button" className="btn btn_sm" data-action="open-file" disabled={p.file_busy === e.path} onClick={() => p.on_file(e, "open")}>
                      Open
                    </button>
                    <button type="button" className="btn btn_sm btn_icon" data-action="download-file" disabled={p.file_busy === e.path} onClick={() => p.on_file(e, "download")} title={`Download ${e.name}`} aria-label={`Download ${e.name}`}>
                      <Icon name="download" size={14} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="help_text muted">This folder is empty.</div>
        )
      ) : null}
      {note ? <div className="help_text muted" data-hidden-note="true">{note}</div> : null}
    </section>
  );
}
