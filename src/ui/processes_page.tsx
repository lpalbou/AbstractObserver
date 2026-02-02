import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GatewayClient, ManagedProcessInfo } from "../lib/gateway_client";
import { Modal } from "./modal";
import { Icon } from "@abstractuic/ui-kit";

function clamp(text: string, max_chars: number): string {
  const s = String(text || "");
  if (s.length <= max_chars) return s;
  return `${s.slice(0, Math.max(0, max_chars - 1))}…`;
}

function status_chip(status: string): { cls: string; label: string } {
  const s = String(status || "").trim().toLowerCase();
  if (s === "running") return { cls: "ok", label: "running" };
  if (s === "stopped") return { cls: "muted", label: "stopped" };
  if (s.includes("restart")) return { cls: "warn", label: s };
  if (s.includes("error") || s.includes("failed")) return { cls: "danger", label: s || "error" };
  return { cls: "warn", label: s || "unknown" };
}

function sort_processes(items: ManagedProcessInfo[]): ManagedProcessInfo[] {
  const rank = (p: ManagedProcessInfo): number => {
    const id = String(p?.id || "").trim();
    if (id === "gateway") return 0;
    if (id === "build") return 1;
    return 10;
  };
  return [...(items || [])].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const la = String(a?.label || a?.id || "").toLowerCase();
    const lb = String(b?.label || b?.id || "").toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

export function ProcessesPage({
  gateway,
  gateway_connected,
}: {
  gateway: GatewayClient;
  gateway_connected: boolean;
}): React.ReactElement {
  const [enabled, set_enabled] = useState<boolean | null>(null);
  const [items, set_items] = useState<ManagedProcessInfo[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string>("");
  const [auto_refresh, set_auto_refresh] = useState(false);

  const [log_open, set_log_open] = useState(false);
  const [log_target, set_log_target] = useState<ManagedProcessInfo | null>(null);
  const [log_text, set_log_text] = useState<string>("");
  const [log_meta, set_log_meta] = useState<string>("");
  const [log_loading, set_log_loading] = useState(false);
  const log_refresh_timer = useRef<number | null>(null);

  const sorted_items = useMemo(() => sort_processes(items), [items]);

  const refresh = useCallback(async () => {
    if (!gateway_connected) return;
    set_loading(true);
    set_error("");
    try {
      const body = await gateway.list_processes();
      set_enabled(Boolean((body as any)?.enabled));
      const procs = Array.isArray((body as any)?.processes) ? ((body as any).processes as ManagedProcessInfo[]) : [];
      set_items(procs);
    } catch (e: any) {
      set_error(String(e?.message || e || "Failed to list processes"));
    } finally {
      set_loading(false);
    }
  }, [gateway, gateway_connected]);

  const refresh_log = useCallback(async () => {
    if (!gateway_connected) return;
    const p = log_target;
    if (!p) return;
    set_log_loading(true);
    try {
      const body = await gateway.process_log_tail(String(p.id || ""), { max_bytes: 160000 });
      const text = String((body as any)?.content || "");
      const bytes = typeof (body as any)?.bytes === "number" ? Number((body as any).bytes) : 0;
      const truncated = Boolean((body as any)?.truncated);
      const rel = String((body as any)?.log_relpath || "");
      set_log_text(text);
      set_log_meta(`${bytes.toLocaleString()} bytes${truncated ? " (tail)" : ""}${rel ? ` • ${rel}` : ""}`);
    } catch (e: any) {
      set_log_text("");
      set_log_meta("");
      set_error(String(e?.message || e || "Failed to read logs"));
    } finally {
      set_log_loading(false);
    }
  }, [gateway, gateway_connected, log_target]);

  const open_logs = useCallback(
    async (p: ManagedProcessInfo) => {
      set_log_target(p);
      set_log_open(true);
    },
    []
  );

  const close_logs = useCallback(() => {
    set_log_open(false);
    set_log_target(null);
    set_log_text("");
    set_log_meta("");
  }, []);

  useEffect(() => {
    if (!gateway_connected) return;
    void refresh();
  }, [gateway_connected, refresh]);

  useEffect(() => {
    if (!gateway_connected) return;
    if (!auto_refresh) return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [gateway_connected, auto_refresh, refresh]);

  useEffect(() => {
    if (!gateway_connected) return;
    if (!log_open) return;
    void refresh_log();
    if (log_refresh_timer.current) window.clearInterval(log_refresh_timer.current);
    log_refresh_timer.current = window.setInterval(() => void refresh_log(), 1500);
    return () => {
      if (log_refresh_timer.current) window.clearInterval(log_refresh_timer.current);
      log_refresh_timer.current = null;
    };
  }, [gateway_connected, log_open, refresh_log]);

  async function run_action(p: ManagedProcessInfo, action: "start" | "stop" | "restart" | "redeploy"): Promise<void> {
    set_error("");
    try {
      if (action === "start") await gateway.start_process(p.id);
      else if (action === "stop") await gateway.stop_process(p.id);
      else if (action === "restart") await gateway.restart_process(p.id);
      else if (action === "redeploy") await gateway.redeploy_process(p.id);
      await refresh();
    } catch (e: any) {
      set_error(String(e?.message || e || `Failed to ${action}`));
    }
  }

  const enabled_label = enabled === null ? "…" : enabled ? "enabled" : "disabled";

  return (
    <div className="page page_scroll">
      <div className="page_inner constrained">
        <div className="card">
          <div className="title">
            <h1>Processes</h1>
          </div>

          {!gateway_connected ? (
            <div className="mono muted">
              Not connected. Open{" "}
              <span className="mono" style={{ opacity: 0.9 }}>
                Settings
              </span>{" "}
              to connect to a gateway.
            </div>
          ) : (
            <>
              <div className="mono muted" style={{ marginTop: "6px" }}>
                Process manager: {enabled_label}
              </div>

              {enabled === false ? (
                <div className="log_item" style={{ borderColor: "rgba(148, 163, 184, 0.25)", marginTop: "10px" }}>
                  <div className="meta">
                    <span className="mono">hint</span>
                    <span className="mono">server</span>
                  </div>
                  <div className="body mono">
                    Set <span className="mono">ABSTRACTGATEWAY_ENABLE_PROCESS_MANAGER=1</span> and{" "}
                    <span className="mono">ABSTRACTGATEWAY_TRIAGE_REPO_ROOT</span> on the gateway host.
                  </div>
                </div>
              ) : null}

              <div className="actions" style={{ marginTop: "10px" }}>
                <button className={`btn btn_icon ${loading ? "is_loading" : ""}`} onClick={() => void refresh()} disabled={!gateway_connected || loading}>
                  <Icon name="refresh" size={16} />
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
                <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <input type="checkbox" checked={auto_refresh} onChange={(e) => set_auto_refresh(Boolean(e.target.checked))} />
                  auto
                </label>
              </div>

              {error ? (
                <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: "10px" }}>
                  <div className="meta">
                    <span className="mono">error</span>
                    <span className="mono">processes</span>
                  </div>
                  <div className="body mono">{error}</div>
                </div>
              ) : null}

              <div style={{ marginTop: "12px" }}>
                {sorted_items.map((p) => {
                  const id = String(p.id || "").trim();
                  const label = String(p.label || id).trim() || id;
                  const s = status_chip(String(p.status || ""));
                  const actions = Array.isArray((p as any)?.actions) ? ((p as any).actions as any[]).map((x) => String(x || "").trim()) : [];
                  const can_start = actions.includes("start");
                  const can_stop = actions.includes("stop");
                  const can_restart = actions.includes("restart");
                  const can_redeploy = actions.includes("redeploy");
                  const can_logs = actions.includes("logs");
                  const pid = typeof (p as any)?.pid === "number" ? Number((p as any).pid) : null;
                  const url = String((p as any)?.url || "").trim();
                  const desc = String((p as any)?.description || "").trim();
                  const err0 = String((p as any)?.last_error || "").trim();
                  const exit_code = typeof (p as any)?.exit_code === "number" ? Number((p as any).exit_code) : null;
                  const subtitle_bits: string[] = [];
                  if (pid) subtitle_bits.push(`pid ${pid}`);
                  if (exit_code !== null) subtitle_bits.push(`exit ${exit_code}`);
                  if (url) subtitle_bits.push(url);
                  const subtitle = subtitle_bits.join(" • ");

                  return (
                    <div key={id} className="log_item" style={{ marginBottom: "10px" }}>
                      <div className="meta">
                        <span className="mono">{id}</span>
                        <span className={`tag ${s.cls}`}>{s.label}</span>
                      </div>
                      <div className="body">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{label}</div>
                            {desc ? (
                              <div className="mono muted" style={{ marginTop: "4px" }}>
                                {clamp(desc, 220)}
                              </div>
                            ) : null}
                            {subtitle ? (
                              <div className="mono muted" style={{ marginTop: "6px", fontSize: "var(--font-size-sm)" }}>
                                {subtitle}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {err0 ? (
                          <div className="mono" style={{ marginTop: "8px", color: "var(--error)" }}>
                            {clamp(err0, 360)}
                          </div>
                        ) : null}

                        <div className="actions" style={{ marginTop: "10px" }}>
                          {can_start ? (
                            <button className="btn primary" onClick={() => void run_action(p, "start")} disabled={loading}>
                              Start
                            </button>
                          ) : null}
                          {can_stop ? (
                            <button className="btn danger" onClick={() => void run_action(p, "stop")} disabled={loading}>
                              Stop
                            </button>
                          ) : null}
                          {can_restart ? (
                            <button className="btn" onClick={() => void run_action(p, "restart")} disabled={loading}>
                              Restart
                            </button>
                          ) : null}
                          {can_redeploy ? (
                            <button className="btn" onClick={() => void run_action(p, "redeploy")} disabled={loading}>
                              Redeploy
                            </button>
                          ) : null}
                          {can_logs ? (
                            <button className="btn" onClick={() => void open_logs(p)} disabled={loading}>
                              Logs
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {log_open && log_target ? (
          <Modal open={log_open} title={`${String(log_target.label || log_target.id || "logs").trim() || "Logs"}`} onClose={close_logs}>
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
              {log_meta}
            </div>
            <div className="actions" style={{ marginTop: "10px" }}>
              <button className={`btn btn_icon ${log_loading ? "is_loading" : ""}`} onClick={() => void refresh_log()} disabled={log_loading}>
                <Icon name="refresh" size={16} />
                {log_loading ? "Refreshing…" : "Refresh"}
              </button>
              <button
                className="btn btn_icon"
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(log_text || "");
                  } catch {
                    // ignore
                  }
                }}
                disabled={!log_text}
              >
                <Icon name="copy" size={16} />
                Copy
              </button>
            </div>
            <pre
              className="mono"
              style={{
                marginTop: "10px",
                padding: "10px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.22)",
                overflowX: "auto",
                maxHeight: "55vh",
                whiteSpace: "pre-wrap",
              }}
            >
              {log_text || "(no logs yet)"}
            </pre>
          </Modal>
        ) : null}
      </div>
    </div>
  );
}
