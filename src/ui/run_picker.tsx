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

function format_local_ts(ts: any): string {
  const ms = parse_iso_ms(ts);
  if (ms === null) return "—";
  const d = new Date(ms);
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function short_id(id: string, keep: number): string {
  const s = String(id || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

function status_chip_class(status: string): string {
  const st = String(status || "").trim().toLowerCase();
  if (st === "completed") return "ok";
  if (st === "failed" || st === "cancelled") return "danger";
  if (st === "running") return "info";
  if (st === "waiting") return "warn";
  return "muted";
}

function RunBadges({
  run,
  workflow_label_by_id,
  compact,
}: {
  run: RunSummary;
  workflow_label_by_id: Record<string, string>;
  compact: boolean;
}): React.ReactElement {
  const rid = String(run.run_id || "").trim();
  const wid = typeof run.workflow_id === "string" ? String(run.workflow_id) : "";
  const wf_label = wid ? workflow_label_by_id[wid] || wid : "";
  const wf_display = wf_label ? wf_label.replace(/\s+/g, " ").trim() : "(unknown)";
  const st = typeof run.status === "string" ? String(run.status) : "";
  const start_ts = format_local_ts(run.created_at || run.updated_at);
  const cnt = typeof run.ledger_len === "number" ? `#${run.ledger_len}` : "";
  const sid = String(run.session_id || "").trim();

  if (compact) {
    return (
      <div className="run_badges_compact">
        <span className="chip mono run_badge">{start_ts}</span>
        <span className="chip mono run_badge workflow">{wf_display}</span>
        <span className={`chip mono run_badge ${status_chip_class(st)}`}>{st || "unknown"}</span>
        {cnt ? <span className="chip mono run_badge muted">{cnt}</span> : null}
        <span className="chip mono run_badge muted">{short_id(rid, 14)}</span>
        {sid ? <span className="chip mono run_badge muted">{`sid:${short_id(sid, 10)}`}</span> : null}
      </div>
    );
  }

  return (
    <div className="run_badges">
      <span className="chip mono run_badge">{start_ts}</span>
      <span className="chip mono run_badge workflow">{wf_display}</span>
      <span className={`chip mono run_badge ${status_chip_class(st)}`}>{st || "unknown"}</span>
      <span className="chip mono run_badge muted">{cnt || "—"}</span>
      <span className="chip mono run_badge muted">{short_id(rid, 14)}</span>
      {sid ? <span className="chip mono run_badge muted">{`sid:${short_id(sid, 10)}`}</span> : <span className="chip mono run_badge muted">—</span>}
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

      const minWidth =
        window.innerWidth >= 1200 ? 980 : window.innerWidth >= 980 ? 860 : window.innerWidth >= 760 ? 720 : rect.width;
      let left = rect.left;
      let width = Math.max(rect.width, minWidth);
      if (width > window.innerWidth - pad * 2) width = window.innerWidth - pad * 2;
      if (left + width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - width);
      if (left < pad) left = pad;

      const minHeight = 240;
      const below = window.innerHeight - rect.bottom - pad;
      const above = rect.top - pad;
      const open_up = below < minHeight && above > below;

      let height = Math.max(minHeight, open_up ? above : below);
      height = Math.min(height, window.innerHeight - pad * 2);

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
        className="run_picker_btn mono"
        ref={btn_ref}
        onClick={() => {
          if (disabled) return;
          set_open((v) => !v);
        }}
        disabled={disabled}
        type="button"
      >
        {loading ? (
          <span className="mono muted">(loading…)</span>
        ) : selected ? (
          <RunBadges run={selected} workflow_label_by_id={workflow_label_by_id} compact={true} />
        ) : (
          <span className="mono">(select)</span>
        )}
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
              className="mono run_picker_filter"
              value={filter}
              onChange={(e) => set_filter(e.target.value)}
              placeholder="filter runs…"
            />
          </div>
          <div className="run_picker_cols mono muted">
            <span>date</span>
            <span>workflow</span>
            <span>status</span>
            <span>#</span>
            <span>run</span>
            <span>session</span>
          </div>

          <div className="run_picker_list">
            {filtered.length ? (
              filtered.map((r) => {
                const rid = String(r.run_id || "").trim();
                if (!rid) return null;
                const is_selected = String(selected_run_id || "").trim() === rid;
                return (
                  <button
                    key={rid}
                    className={`run_picker_row ${is_selected ? "selected" : ""}`}
                    onClick={() => {
                      set_open(false);
                      onSelect(rid);
                    }}
                    type="button"
                  >
                    <RunBadges run={r} workflow_label_by_id={workflow_label_by_id} compact={false} />
                  </button>
                );
              })
            ) : (
              <div className="mono muted" style={{ padding: "10px" }}>
                (no matches)
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
