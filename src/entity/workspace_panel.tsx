/**
 * The workspace window (maintainer asks, 2026-07-08):
 *
 * - 📁 quick access: browse the entity's home workspace and read files —
 *   the operator sees what he builds, without a terminal.
 * - mounts: whitelist extra directories the entity may reach (read-only or
 *   read+write), remove them, see them exactly as his tools do
 *   (`mounts/<name>/`). Writes go through the operator door (token).
 * - tools: the per-phase tool grant (visit / resident / sleep) as a
 *   checkbox matrix over <home>/tool_policy.yaml.
 *
 * Everything renders from gateway answers; a refused write shows the
 * door's words verbatim.
 */

import React, { useCallback, useEffect, useState } from "react";

import {
  getToolPolicy,
  getWorkspaceMounts,
  listWorkspace,
  putToolPolicy,
  putWorkspaceMounts,
  readWorkspaceFile,
  type ToolPolicyInfo,
  type WorkspaceEntry,
  type WorkspaceListing,
  type WorkspaceMount,
} from "./stream_source";

export interface WorkspacePanelProps {
  baseUrl: string;
  entity: string;
  entityName: string;
  token: string | null;
  onClose(): void;
}

type Tab = "files" | "mounts" | "tools";

export function WorkspacePanel({ baseUrl, entity, entityName, token, onClose }: WorkspacePanelProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>("files");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ev_backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ev_panel wsp_panel">
        <div className="ev_head">
          <div className="ev_title">
            <span className="ei_kind ei_kind_lesson">workspace</span>
            <span>{entityName}'s territory</span>
          </div>
          <div className="wsp_tabs">
            <button className={tab === "files" ? "wsp_tab wsp_tab_on" : "wsp_tab"} onClick={() => setTab("files")}>
              files
            </button>
            <button className={tab === "mounts" ? "wsp_tab wsp_tab_on" : "wsp_tab"} onClick={() => setTab("mounts")}>
              mounts
            </button>
            <button className={tab === "tools" ? "wsp_tab wsp_tab_on" : "wsp_tab"} onClick={() => setTab("tools")}>
              tools
            </button>
          </div>
          <button className="ev_close" onClick={onClose}>
            close
          </button>
        </div>
        <div className="ev_body wsp_body">
          {tab === "files" ? <FilesTab baseUrl={baseUrl} entity={entity} /> : null}
          {tab === "mounts" ? <MountsTab baseUrl={baseUrl} entity={entity} token={token} /> : null}
          {tab === "tools" ? <ToolsTab baseUrl={baseUrl} entity={entity} token={token} /> : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ files

function FilesTab({ baseUrl, entity }: { baseUrl: string; entity: string }): React.ReactElement {
  const [path, setPath] = useState(".");
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [file, setFile] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (p: string) => {
      setError(null);
      setFile(null);
      listWorkspace(baseUrl, entity, p)
        .then((l) => {
          setListing(l);
          setPath(l.path);
        })
        .catch((e: Error) => setError(e.message));
    },
    [baseUrl, entity],
  );

  useEffect(() => {
    load(".");
  }, [load]);

  const openEntry = (entry: WorkspaceEntry) => {
    if (entry.kind === "file") {
      readWorkspaceFile(baseUrl, entity, entry.path)
        .then((f) => setFile({ path: f.path, text: f.text, truncated: f.truncated }))
        .catch((e: Error) => setError(e.message));
    } else {
      load(entry.path);
    }
  };

  const up = () => {
    if (path === "." || !path.includes("/")) {
      load(".");
      return;
    }
    const parent = path.split("/").slice(0, -1).join("/") || ".";
    load(parent);
  };

  return (
    <div className="wsp_files">
      <div className="wsp_crumbs">
        <button className="wsp_up" onClick={up} disabled={path === "."}>
          ↑ up
        </button>
        <code>{path === "." ? "workspace/" : `workspace/${path}`}</code>
      </div>
      {error ? <p className="wsp_error">{error}</p> : null}
      {file ? (
        <div className="wsp_file">
          <div className="wsp_file_head">
            <code>{file.path}</code>
            <button className="wsp_up" onClick={() => setFile(null)}>
              back to listing
            </button>
          </div>
          {file.truncated ? <p className="wsp_error">(truncated at the read cap — the file continues on disk)</p> : null}
          <pre className="wsp_pre">{file.text || "(empty file)"}</pre>
        </div>
      ) : listing ? (
        listing.entries.length === 0 ? (
          <p className="wsp_quiet">Empty — nothing here yet.</p>
        ) : (
          <ul className="wsp_list">
            {listing.entries.map((e) => (
              <li key={e.path}>
                <button className="wsp_entry" onClick={() => openEntry(e)}>
                  <span className="wsp_icon">{e.kind === "file" ? "📄" : e.kind === "mount" ? "🔗" : "📁"}</span>
                  <span className="wsp_name">{e.name}</span>
                  {e.kind === "file" && typeof e.size === "number" ? <span className="wsp_size">{e.size} B</span> : null}
                  {e.kind === "mount" ? <span className={`wsp_mode wsp_mode_${e.mode}`}>{e.mode === "rw" ? "read+write" : "read-only"}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="wsp_quiet">reading…</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- mounts

function MountsTab({ baseUrl, entity, token }: { baseUrl: string; entity: string; token: string | null }): React.ReactElement {
  const [mounts, setMounts] = useState<WorkspaceMount[] | null>(null);
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<"ro" | "rw">("ro");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getWorkspaceMounts(baseUrl, entity)
      .then((r) => setMounts(r.mounts))
      .catch((e: Error) => setError(e.message));
  }, [baseUrl, entity]);

  const save = (next: WorkspaceMount[]) => {
    setBusy(true);
    setError(null);
    putWorkspaceMounts(baseUrl, entity, next, token)
      .then((r) => {
        setMounts(r.mounts);
        setNewPath("");
        setNewName("");
      })
      .catch((e: Error & { status?: number }) => {
        setError(e.status === 401 || e.status === 403 ? "The door refused: operator auth required (set the token in the controls strip)." : e.message);
      })
      .finally(() => setBusy(false));
  };

  const add = () => {
    const path = newPath.trim();
    if (!path || !mounts) return;
    const fallbackName = path.split("/").filter(Boolean).slice(-1)[0] ?? "mount";
    const name = (newName.trim() || fallbackName).replace(/[^a-zA-Z0-9_-]/g, "_");
    save([...mounts, { name, path, mode: newMode }]);
  };

  return (
    <div className="wsp_mounts">
      <p className="wsp_quiet">
        Extra workspaces the entity may reach, beside its home workspace. They appear to him as <code>mounts/&lt;name&gt;/</code>, each with its honest
        mode; a read-only mount refuses his writes structurally.
      </p>
      {error ? <p className="wsp_error">{error}</p> : null}
      {mounts === null ? (
        <p className="wsp_quiet">reading…</p>
      ) : mounts.length === 0 ? (
        <p className="wsp_quiet">No extra workspaces granted.</p>
      ) : (
        <ul className="wsp_list">
          {mounts.map((m) => (
            <li key={m.name} className="wsp_mount_row">
              <span className="wsp_icon">🔗</span>
              <code className="wsp_name">mounts/{m.name}/</code>
              <span className={`wsp_mode wsp_mode_${m.mode}`}>{m.mode === "rw" ? "read+write" : "read-only"}</span>
              <span className="wsp_target" title={m.path}>
                {m.path}
              </span>
              <button
                className="wsp_remove"
                disabled={busy}
                title="Remove this grant (his tools lose it on their next call)"
                onClick={() => save(mounts.filter((x) => x.name !== m.name))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="wsp_add">
        <input type="text" placeholder="/absolute/path/to/directory" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
        <input type="text" className="wsp_add_name" placeholder="name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select value={newMode} onChange={(e) => setNewMode(e.target.value as "ro" | "rw")}>
          <option value="ro">read-only</option>
          <option value="rw">read+write</option>
        </select>
        <button onClick={add} disabled={busy || !newPath.trim() || mounts === null}>
          + grant
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tools

const PHASE_LABEL: Record<string, string> = {
  visit: "visit / chat",
  resident: "active / persistent",
  sleep: "sleep",
};

function ToolsTab({ baseUrl, entity, token }: { baseUrl: string; entity: string; token: string | null }): React.ReactElement {
  const [policy, setPolicy] = useState<ToolPolicyInfo | null>(null);
  const [draft, setDraft] = useState<Record<string, Set<string>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getToolPolicy(baseUrl, entity)
      .then((p) => {
        setPolicy(p);
        const d: Record<string, Set<string>> = {};
        for (const [phase, info] of Object.entries(p.phases)) d[phase] = new Set(info.tools);
        setDraft(d);
      })
      .catch((e: Error) => setError(e.message));
  }, [baseUrl, entity]);

  const toggle = (phase: string, tool: string) => {
    if (!draft) return;
    const next = { ...draft, [phase]: new Set(draft[phase]) };
    if (next[phase].has(tool)) next[phase].delete(tool);
    else next[phase].add(tool);
    setDraft(next);
    setSaved(false);
  };

  const save = () => {
    if (!draft || !policy) return;
    setBusy(true);
    setError(null);
    const body: Record<string, string[]> = {};
    for (const [phase, tools] of Object.entries(draft)) body[phase] = policy.all_tools.filter((t) => tools.has(t));
    putToolPolicy(baseUrl, entity, body, token)
      .then((p) => {
        setPolicy(p);
        setSaved(true);
      })
      .catch((e: Error & { status?: number }) => {
        setError(e.status === 401 || e.status === 403 ? "The door refused: operator auth required (set the token in the controls strip)." : e.message);
      })
      .finally(() => setBusy(false));
  };

  if (error && !policy) return <p className="wsp_error">{error}</p>;
  if (!policy || !draft) return <p className="wsp_quiet">reading…</p>;

  const tier1 = new Set(policy.tiers["tier1"] ?? []);

  return (
    <div className="wsp_tools">
      <p className="wsp_quiet">
        Which tools he holds in each phase of life. Tier-1 (marked ●) is the read-only cognition set, designed to be safe 24/7; the rest write inside
        his workspace walls. Saving writes <code>tool_policy.yaml</code> in his home — the next summon of each phase obeys it.
      </p>
      {error ? <p className="wsp_error">{error}</p> : null}
      <table className="wsp_matrix">
        <thead>
          <tr>
            <th>tool</th>
            {Object.keys(policy.phases).map((phase) => (
              <th key={phase}>{PHASE_LABEL[phase] ?? phase}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {policy.all_tools.map((tool) => (
            <tr key={tool}>
              <td>
                <code>{tool}</code> {tier1.has(tool) ? <span className="wsp_tier1" title="tier-1: read-only cognition, safe 24/7">●</span> : null}
              </td>
              {Object.keys(policy.phases).map((phase) => (
                <td key={phase}>
                  <input type="checkbox" checked={draft[phase]?.has(tool) ?? false} onChange={() => toggle(phase, tool)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="wsp_save_row">
        <button onClick={save} disabled={busy}>
          {busy ? "saving…" : "save policy"}
        </button>
        {saved ? <span className="wsp_saved">saved — next summon obeys it</span> : null}
        {policy.phases["visit"]?.source === "default" && !saved ? <span className="wsp_quiet">(currently on defaults — no policy file yet)</span> : null}
      </div>
    </div>
  );
}
