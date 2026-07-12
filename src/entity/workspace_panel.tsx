/**
 * The workspace window (maintainer asks, 2026-07-08):
 *
 * - 📁 quick access: browse the entity's home workspace and read files —
 *   the operator sees what he builds, without a terminal.
 * - mounts: whitelist extra directories the entity may reach (read-only or
 *   read+write), remove them, see them exactly as his tools do
 *   (`mounts/<name>/`). Writes go through the operator door (token).
 * - tools: the per-phase tool grant (visit / tasked / own_time / sleep —
 *   the ruled four-phase vocabulary; `resident` renders for older
 *   gateways) as a checkbox matrix over <home>/tool_policy.yaml.
 *
 * Everything renders from gateway answers; a refused write shows the
 * door's words verbatim.
 */

import React, { useCallback, useEffect, useState } from "react";

import { authRefusedMsg } from "./gateway_session";
import {
  getEntityPrompt,
  getToolPolicy,
  getWorkspaceMounts,
  listWorkspace,
  putEntityPrompt,
  putToolPolicy,
  putWorkspaceMounts,
  readWorkspaceFile,
  type PromptLayerInfo,
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

type Tab = "files" | "mounts" | "tools" | "prompt";

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
            <button className={tab === "prompt" ? "wsp_tab wsp_tab_on" : "wsp_tab"} onClick={() => setTab("prompt")}>
              prompt
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
          {tab === "prompt" ? <PromptTab baseUrl={baseUrl} entity={entity} entityName={entityName} token={token} /> : null}
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
        setError(e.status === 401 || e.status === 403 ? authRefusedMsg(e.status, e.message) : e.message);
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

/** Labels for the phase vocabulary. RULED (laurent, 2026-07-11 20:30 via
 * agency c786, after a 9-0 room ballot): the four phases are single human
 * words — visit / work / personal / sleep. `tasked`/`own_time` are the
 * pre-ruling spellings and `resident` the oldest — all three render
 * labeled as legacy during the migration window (runtime aliases them:
 * tasked→work, own_time/resident→personal, loud #FALLBACK). The matrix
 * itself is server-driven — it renders whatever keys the gateway serves;
 * only labels/hints live client-side. DELETABLE STOPGAP: when the gateway
 * GET carries per-phase label/hint (uic's MatrixPhase {id,label?,hint?}
 * shape, c703), delete both maps and render the payload's words —
 * client-side vocabulary is the drift class the adversary already caught
 * here once. */
const PHASE_LABEL: Record<string, string> = {
  visit: "visit",
  work: "work",
  personal: "personal",
  sleep: "sleep",
  resident: "personal (legacy spelling)",
  tasked: "work (legacy spelling)",
  own_time: "personal (legacy spelling)",
};

/** Honest state of each column (adversary A's caveat, 2026-07-11): the
 * sleep grant is CONFIG the consolidation pass will consume when it gains
 * tool use — checking it today configures the future, it does not run
 * anything tonight. */
const PHASE_HINT: Record<string, string> = {
  visit: "Applies at the next summon (chat or visit).",
  work: "Pursuing operator-given tasks; ticks until done, then sleeps. Full set by default (hands by default). Applies at the next work session.",
  personal: "His own time — self-directed, no given tasks. Full set by default (Q1 ruling: same as work); the brake is the personal-time grant (off by default, operator-granted with a timer or until retracted), never an empty toolset. Applies at the next day boundary.",
  sleep: "Configures the sleep/dream pass. The DEFAULT is explore-only (recall, search, reads) — widen it here if his dreams should act (a dedicated sleep workspace, extra tools: the operator's call). It does not run tools yet: this column takes effect when the sleep pass gains tool use.",
  resident: "Legacy spelling of the personal phase (older gateway). Applies at the next day boundary.",
  tasked: "Legacy spelling of the work phase (older gateway).",
  own_time: "Legacy spelling of the personal phase (older gateway).",
};

// ------------------------------------------------------------------ prompt

/** Labels/hints for the layer keys the server is KNOWN to serve. The list
 * itself comes from the server (`editable`) so a new layer renders (with a
 * generic label) instead of being silently dropped from the next save —
 * the whole-document-replace PUT makes a missing key a deletion. */
const PROMPT_LAYER_META: Record<string, { label: string; hint: string }> = {
  conversation: { label: "conversation contract", hint: "How memories arrive and how the diary is offered — every session." },
  visit: { label: "visit paragraph", hint: "The life framing during visits (own time continues after)." },
  own_time: { label: "own-time contract", hint: "The framing of the entity's own 24/7 loop sessions." },
  operator: {
    label: "operator instructions",
    hint:
      "Standing direction and PERMISSIONS, appended last and attributed to you — never blended into the entity's own voice. " +
      "Grants of authority belong here (\"You have my standing permission to act without asking\"). CHARACTER statements " +
      "(\"You are curious, fair…\") belong in the SPARK at creation — there they are the entity's own and its memory can find them; " +
      "here they read as orders, and a self-search would contradict them. Mid-life character change is the entity's own act (its reflection), not an operator edit.",
  },
};


function PromptTab({
  baseUrl,
  entity,
  entityName,
  token,
}: {
  baseUrl: string;
  entity: string;
  entityName: string;
  token: string | null;
}): React.ReactElement {
  const [info, setInfo] = useState<PromptLayerInfo | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [open, setOpen] = useState<string | null>("operator");
  const [showPrelude, setShowPrelude] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const layerKeys = (p: PromptLayerInfo): string[] =>
    p.editable?.length ? p.editable : Object.keys(PROMPT_LAYER_META);

  const draftFrom = (p: PromptLayerInfo): Record<string, string> => {
    const d: Record<string, string> = {};
    for (const key of layerKeys(p)) d[key] = p.layers[key]?.source === "overlay" ? p.layers[key].text : "";
    return d;
  };

  useEffect(() => {
    getEntityPrompt(baseUrl, entity)
      .then((p) => {
        setInfo(p);
        setDraft(draftFrom(p));
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, entity]);

  const save = () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    putEntityPrompt(baseUrl, entity, draft, token)
      .then((p) => {
        setInfo(p);
        setDraft(draftFrom(p));
        setSaved(true);
      })
      .catch((e: Error & { status?: number }) => {
        setError(e.status === 401 || e.status === 403 ? authRefusedMsg(e.status, e.message) : e.message);
      })
      .finally(() => setBusy(false));
  };

  if (error && !info) return <p className="wsp_error">{error}</p>;
  if (!info || !draft) return <p className="wsp_quiet">reading…</p>;

  const dirty = layerKeys(info).some((key) => {
    const live = info.layers[key]?.source === "overlay" ? info.layers[key].text : "";
    return (draft[key] ?? "") !== live;
  });

  return (
    <div className="wsp_prompt">
      <p className="wsp_quiet">
        {entityName}'s system prompt, layer by layer. The identity block and the tools text are machine-owned (identity evolves by the entity's own
        acts; tools text follows the actual grant — edit it in the tools tab). The layers below are yours to rewrite; empty = the built-in default.
        Saving writes <code>system_prompt.yaml</code> in the home — the next summon obeys it; a session already open keeps the prompt it was
        summoned with.
      </p>
      {info.warnings.length > 0 ? <p className="wsp_error">{info.warnings.join(" · ")}</p> : null}
      {info.raw_file ? (
        <div className="wsp_prompt_section">
          <div className="wsp_prompt_editor">
            <p className="wsp_error">The file on disk could not be parsed — its raw content is shown here so nothing is lost. Saving replaces it.</p>
            <pre className="wsp_pre wsp_prompt_pre">{info.raw_file}</pre>
          </div>
        </div>
      ) : null}
      {error ? <p className="wsp_error">{error}</p> : null}

      <div className="wsp_prompt_section">
        <button className="wsp_prompt_head" onClick={() => setShowPrelude(!showPrelude)}>
          <span className="wsp_prompt_arrow">{showPrelude ? "▾" : "▸"}</span> identity prelude
          <span className="wsp_badge wsp_badge_locked" title="Rendered from the engrammed core + diary + standing; evolves only by the entity's own acts">
            read-only
          </span>
        </button>
        {showPrelude ? <pre className="wsp_pre wsp_prompt_pre">{info.prelude || "(prelude refused to render — see warnings)"}</pre> : null}
      </div>

      {layerKeys(info).map((key) => {
        const meta = PROMPT_LAYER_META[key] ?? { label: key.replace(/_/g, " "), hint: "" };
        const live = info.layers[key];
        const isOpen = open === key;
        const overlayOn = (draft[key] ?? "").trim().length > 0;
        return (
          <div className="wsp_prompt_section" key={key}>
            <button className="wsp_prompt_head" onClick={() => setOpen(isOpen ? null : key)}>
              <span className="wsp_prompt_arrow">{isOpen ? "▾" : "▸"}</span> {meta.label}
              <span className={overlayOn ? "wsp_badge wsp_badge_overlay" : "wsp_badge"} title={overlayOn ? "Your rewrite is live" : "Built-in default text"}>
                {overlayOn ? "rewritten" : "default"}
              </span>
            </button>
            {isOpen ? (
              <div className="wsp_prompt_editor">
                {meta.hint ? <p className="wsp_quiet">{meta.hint}</p> : null}
                <textarea
                  className="wsp_prompt_text"
                  rows={key === "operator" ? 4 : 8}
                  placeholder={key === "operator" ? "(nothing yet — standing instructions you want in every summon)" : "(empty = the built-in default below)"}
                  value={draft[key] ?? ""}
                  onChange={(e) => {
                    setDraft({ ...draft, [key]: e.target.value });
                    setSaved(false);
                  }}
                />
                {(info.defaults[key] ?? "") !== "" ? (
                  <div className="wsp_prompt_default">
                    <div className="wsp_prompt_default_head">
                      built-in default{live?.source === "overlay" ? " (replaced by your rewrite)" : " (live)"}
                      <button
                        className="wsp_up"
                        onClick={() => {
                          setDraft({ ...draft, [key]: info.defaults[key] ?? "" });
                          setSaved(false);
                        }}
                        title="Copy the default into the editor as a starting point (saving it unchanged keeps the default live)"
                      >
                        copy to editor
                      </button>
                    </div>
                    <pre className="wsp_pre wsp_prompt_pre">{info.defaults[key]}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="wsp_prompt_section">
        <button className="wsp_prompt_head" onClick={() => setShowPreview(!showPreview)}>
          <span className="wsp_prompt_arrow">{showPreview ? "▾" : "▸"}</span> full preview
          <span className="wsp_badge" title="The exact head the next VISIT summon composes (per-turn presence + MEMORIES append at runtime; own-time sessions swap the visit paragraph for the own-time contract)">
            next visit summon
          </span>
        </button>
        {showPreview ? <pre className="wsp_pre wsp_prompt_pre">{info.preview || "(no preview — prelude refused)"}</pre> : null}
      </div>

      <div className="wsp_save_row">
        <button onClick={save} disabled={busy || !dirty}>
          {busy ? "saving…" : "save prompt"}
        </button>
        {saved ? <span className="wsp_saved">saved — next summon obeys it</span> : null}
      </div>
    </div>
  );
}

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
    // TOUCHED PHASES ONLY (adversary find, 2026-07-11): sending every
    // phase materialized the day's RESOLVED defaults into the file as
    // "the operator's word" — every real home ended up with a frozen
    // `sleep: []` from pre-ruling saves, killing the ruled sleep default.
    // The server merges per phase; unchanged phases stay as they were
    // (absent = follows the evolving framework defaults).
    const body: Record<string, string[]> = {};
    for (const [phase, tools] of Object.entries(draft)) {
      const shown = new Set(policy.phases[phase]?.tools ?? []);
      const changed = tools.size !== shown.size || [...tools].some((t) => !shown.has(t));
      if (changed) body[phase] = policy.all_tools.filter((t) => tools.has(t));
    }
    if (Object.keys(body).length === 0) {
      setBusy(false);
      setSaved(true);
      return;
    }
    putToolPolicy(baseUrl, entity, body, token)
      .then((p) => {
        setPolicy(p);
        const d: Record<string, Set<string>> = {};
        for (const [phase, info] of Object.entries(p.phases)) d[phase] = new Set(info.tools);
        setDraft(d);
        setSaved(true);
      })
      .catch((e: Error & { status?: number }) => {
        setError(e.status === 401 || e.status === 403 ? authRefusedMsg(e.status, e.message) : e.message);
      })
      .finally(() => setBusy(false));
  };

  if (error && !policy) return <p className="wsp_error">{error}</p>;
  if (!policy || !draft) return <p className="wsp_quiet">reading…</p>;

  const tier1 = new Set(policy.tiers["tier1"] ?? []);

  return (
    <div className="wsp_tools">
      <p className="wsp_quiet">
        Which tools he holds in each phase of life. Tier-1 (marked ●) is the read-only cognition set, designed to be safe 24/7; the rest reach only
        his workspace walls (reads and writes). Saving writes <code>tool_policy.yaml</code> in his home — the next summon of each phase obeys it; a session already
        open (a live visit, an own-time day mid-run) keeps the grant it was summoned with. The sleep column (⏳) is standing config with an explore-only
        DEFAULT (recall, search, read) — widen it if his dreams should act; it takes effect when the sleep pass gains tool use.
      </p>
      {error ? <p className="wsp_error">{error}</p> : null}
      <table className="wsp_matrix">
        <thead>
          <tr>
            <th>tool</th>
            {Object.keys(policy.phases).map((phase) => (
              <th key={phase} title={PHASE_HINT[phase] ?? ""}>
                {PHASE_LABEL[phase] ?? phase}
                {phase === "sleep" ? (
                  <span className="wsp_phase_note" title={PHASE_HINT.sleep}>
                    {" "}
                    ⏳
                  </span>
                ) : null}
              </th>
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
