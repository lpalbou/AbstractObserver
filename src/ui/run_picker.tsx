import React, { useEffect, useMemo, useRef, useState } from "react";

export type RunSummary = {
  run_id: string;
  workflow_id?: string | null;
  status?: string;
  created_at?: string | null;
  updated_at?: string | null;
  ledger_len?: number | null;
  parent_run_id?: string | null;
  session_id?: string | null;
};

function parse_iso_ms(ts: any): number | null {
  const s = typeof ts === "string" ? ts.trim() : "";
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function format_relative_time(date: Date): string {
  const now = Date.now();
  const then = date.getTime();
  const diff = now - then;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days <= 3) return `${days}d ago`;
  
  // Beyond 3 days, show actual date
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function format_time_ago(ts: any): string {
  const ms = parse_iso_ms(ts);
  if (ms === null) return "—";
  return format_relative_time(new Date(ms));
}

function short_id(id: string, keep: number): string {
  const s = String(id || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

type StatusConfig = { label: string; cls: string };

function get_status_config(status: string): StatusConfig {
  const st = String(status || "").trim().toLowerCase();
  const config: Record<string, StatusConfig> = {
    completed: { label: "Completed", cls: "success" },
    failed: { label: "Failed", cls: "error" },
    cancelled: { label: "Cancelled", cls: "muted" },
    waiting: { label: "Waiting", cls: "warning" },
    running: { label: "Running", cls: "info" },
  };
  return config[st] || { label: status || "Unknown", cls: "muted" };
}

function extract_workflow_name(workflow_id: string, label_map: Record<string, string>): string {
  const wid = String(workflow_id || "").trim();
  
  // Check if we have a mapped label
  if (wid) {
    const mapped = label_map[wid];
    if (mapped) {
      // Extract just the name part after the separator
      const parts = mapped.split(/[·:]/);
      return parts.length > 1 ? parts[parts.length - 1].trim() : mapped.trim();
    }
    
    // Try to extract name from workflow_id itself (format: bundle_id:flow_id)
    const idx = wid.indexOf(":");
    if (idx > 0) {
      return wid.slice(idx + 1).trim() || wid.slice(0, idx).trim();
    }

    // If it looks like a human name (contains letters), show it.
    if (/[a-z]/i.test(wid)) return wid;
  }

  return "(unknown workflow)";
}

function RunCard({
  run,
  workflow_label_by_id,
  selected,
  onClick,
}: {
  run: RunSummary;
  workflow_label_by_id: Record<string, string>;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  const wid = typeof run.workflow_id === "string" ? String(run.workflow_id) : "";
  const wf_display = extract_workflow_name(wid, workflow_label_by_id);
  
  const st = typeof run.status === "string" ? String(run.status) : "";
  const status_info = get_status_config(st);
  const time_ago = format_time_ago(run.updated_at || run.created_at);
  const steps = typeof run.ledger_len === "number" && run.ledger_len > 0 ? run.ledger_len : null;

  return (
    <button
      className={`run_card ${selected ? "selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      <div className="run_card_header">
        <span className="run_card_name">{wf_display}</span>
        <span className={`run_card_status ${status_info.cls}`}>{status_info.label}</span>
      </div>
      <div className="run_card_time">
        <span>{time_ago}</span>
        <span className="run_card_sep">•</span>
        <span className="mono">{short_id(run.run_id, 8)}</span>
      </div>
      {steps !== null ? (
        <div className="run_card_meta">{steps} steps</div>
      ) : null}
    </button>
  );
}

function SelectedRunBadge({
  run,
  workflow_label_by_id,
}: {
  run: RunSummary;
  workflow_label_by_id: Record<string, string>;
}): React.ReactElement {
  const wid = typeof run.workflow_id === "string" ? String(run.workflow_id) : "";
  const wf_display = extract_workflow_name(wid, workflow_label_by_id);
  
  const st = typeof run.status === "string" ? String(run.status) : "";
  const status_info = get_status_config(st);
  const time_ago = format_time_ago(run.updated_at || run.created_at);

  return (
    <div className="run_selected_badge">
      <span className="run_selected_name">{wf_display}</span>
      <span className={`run_selected_status ${status_info.cls}`}>{status_info.label}</span>
      <span className="run_selected_time">{time_ago}</span>
    </div>
  );
}

export function RunPicker({
  runs,
  selected_run_id,
  workflow_label_by_id,
  disabled,
  loading,
  onSelect,
}: {
  runs: RunSummary[];
  selected_run_id: string;
  workflow_label_by_id: Record<string, string>;
  disabled: boolean;
  loading: boolean;
  onSelect: (run_id: string) => void;
}): React.ReactElement {
  const [open, set_open] = useState(false);
  const [filter, set_filter] = useState("");
  const [panel_pos, set_panel_pos] = useState<{
    left: number;
    width: number;
    height: number;
    top: number;
  } | null>(null);
  const root_ref = useRef<HTMLDivElement | null>(null);
  const btn_ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const on_down = (e: MouseEvent) => {
      if (!root_ref.current) return;
      if (!root_ref.current.contains(e.target as any)) set_open(false);
    };
    window.addEventListener("mousedown", on_down);
    return () => window.removeEventListener("mousedown", on_down);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!btn_ref.current) return;
      const rect = btn_ref.current.getBoundingClientRect();
      const pad = 12;

      const minWidth = Math.min(720, window.innerWidth - pad * 2);
      let left = rect.left;
      let width = Math.max(rect.width, minWidth);
      if (width > window.innerWidth - pad * 2) width = window.innerWidth - pad * 2;
      if (left + width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - width);
      if (left < pad) left = pad;

      const minHeight = 320;
      const maxHeight = 520;
      const below = window.innerHeight - rect.bottom - pad;
      const above = rect.top - pad;
      const open_up = below < minHeight && above > below;

      let height = Math.max(minHeight, open_up ? above : below);
      height = Math.min(height, maxHeight, window.innerHeight - pad * 2);

      let top = open_up ? rect.top - 8 - height : rect.bottom + 8;
      top = Math.min(top, window.innerHeight - pad - height);
      top = Math.max(pad, top);

      set_panel_pos({ left, width, height, top });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const selected = useMemo(() => {
    const rid = String(selected_run_id || "").trim();
    if (!rid) return null;
    return runs.find((r) => String(r.run_id || "").trim() === rid) || { run_id: rid } as RunSummary;
  }, [runs, selected_run_id]);

  const filtered = useMemo(() => {
    const q = String(filter || "").trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => {
      const rid = String(r.run_id || "").toLowerCase();
      const wid = typeof r.workflow_id === "string" ? String(r.workflow_id).toLowerCase() : "";
      const wl = wid ? String(workflow_label_by_id[String(r.workflow_id)] || "").toLowerCase() : "";
      const st = typeof r.status === "string" ? String(r.status).toLowerCase() : "";
      return rid.includes(q) || wid.includes(q) || wl.includes(q) || st.includes(q);
    });
  }, [runs, filter, workflow_label_by_id]);

  return (
    <div className="run_picker" ref={root_ref}>
      <button
        className="run_picker_btn"
        ref={btn_ref}
        onClick={() => {
          if (disabled) return;
          set_open((v) => !v);
        }}
        disabled={disabled}
        type="button"
      >
        {loading ? (
          <span className="muted">Loading runs…</span>
        ) : selected ? (
          <SelectedRunBadge run={selected} workflow_label_by_id={workflow_label_by_id} />
        ) : (
          <span className="run_picker_placeholder">Select a run to observe</span>
        )}
        <span className="run_picker_chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div
          className="run_picker_panel"
          style={
            panel_pos
              ? {
                  left: `${panel_pos.left}px`,
                  width: `${panel_pos.width}px`,
                  height: `${panel_pos.height}px`,
                  top: `${panel_pos.top}px`,
                }
              : undefined
          }
        >
          <div className="run_picker_header">
            <input
              className="run_picker_filter"
              value={filter}
              onChange={(e) => set_filter(e.target.value)}
              placeholder="Search runs by name, status..."
            />
          </div>

          <div className="run_picker_grid">
            {filtered.length ? (
              filtered.map((r) => {
                const rid = String(r.run_id || "").trim();
                if (!rid) return null;
                const is_selected = String(selected_run_id || "").trim() === rid;
                return (
                  <RunCard
                    key={rid}
                    run={r}
                    workflow_label_by_id={workflow_label_by_id}
                    selected={is_selected}
                    onClick={() => {
                      set_open(false);
                      onSelect(rid);
                    }}
                  />
                );
              })
            ) : (
              <div className="run_picker_empty">
                <span className="run_picker_empty_icon">◇</span>
                <span>No runs found</span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
