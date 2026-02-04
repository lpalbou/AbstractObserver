import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GatewayClient, ManagedEnvVarItem, ManagedProcessInfo } from "../lib/gateway_client";
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

function env_source_chip(source: string): { cls: string; label: string } {
  const s = String(source || "").trim().toLowerCase();
  if (s === "override") return { cls: "ok", label: "override" };
  if (s.startsWith("inherited")) return { cls: "info", label: s };
  if (s === "unset") return { cls: "warn", label: "unset" };
  if (!s || s === "missing") return { cls: "muted", label: "missing" };
  return { cls: "muted", label: s };
}

export function ProcessesPage({
  gateway,
  gateway_connected,
}: {
  gateway: GatewayClient;
  gateway_connected: boolean;
}): React.ReactElement {
  const [tab, set_tab] = useState<"processes" | "env_vars">("processes");
  const [enabled, set_enabled] = useState<boolean | null>(null);
  const [items, set_items] = useState<ManagedProcessInfo[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string>("");
  const [auto_refresh, set_auto_refresh] = useState(false);

  const [env_enabled, set_env_enabled] = useState<boolean | null>(null);
  const [env_items, set_env_items] = useState<ManagedEnvVarItem[]>([]);
  const [env_loading, set_env_loading] = useState(false);
  const [env_error, set_env_error] = useState<string>("");
  const [env_inputs, set_env_inputs] = useState<Record<string, string>>({});

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

  const refresh_env = useCallback(async () => {
    if (!gateway_connected) return;
    set_env_loading(true);
    set_env_error("");
    try {
      const body = await gateway.list_process_env_vars();
      set_env_enabled(Boolean((body as any)?.enabled));
      const vars0 = Array.isArray((body as any)?.vars) ? ((body as any).vars as ManagedEnvVarItem[]) : [];
      set_env_items(vars0);
      const err = String((body as any)?.error || "").trim();
      if (err) set_env_error(err);
    } catch (e: any) {
      set_env_error(String(e?.message || e || "Failed to list env vars"));
    } finally {
      set_env_loading(false);
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
    if (tab !== "processes") return;
    if (!auto_refresh) return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [gateway_connected, tab, auto_refresh, refresh]);

  useEffect(() => {
    if (!gateway_connected) return;
    if (tab !== "env_vars") return;
    void refresh_env();
  }, [gateway_connected, tab, refresh_env]);

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

  async function env_set(key: string): Promise<void> {
    const k = String(key || "").trim();
    if (!k) return;
    set_env_error("");
    try {
      const value = String(env_inputs?.[k] ?? "");
      const body = await gateway.update_process_env_vars({ set: { [k]: value } });
      set_env_enabled(Boolean((body as any)?.enabled));
      set_env_items(Array.isArray((body as any)?.vars) ? ((body as any).vars as ManagedEnvVarItem[]) : []);
      set_env_inputs((prev) => ({ ...(prev || {}), [k]: "" }));
      const err = String((body as any)?.error || "").trim();
      if (err) set_env_error(err);
    } catch (e: any) {
      set_env_error(String(e?.message || e || "Failed to set env var"));
    }
  }

  async function env_unset(key: string): Promise<void> {
    const k = String(key || "").trim();
    if (!k) return;
    set_env_error("");
    try {
      const body = await gateway.update_process_env_vars({ unset: [k] });
      set_env_enabled(Boolean((body as any)?.enabled));
      set_env_items(Array.isArray((body as any)?.vars) ? ((body as any).vars as ManagedEnvVarItem[]) : []);
      set_env_inputs((prev) => ({ ...(prev || {}), [k]: "" }));
      const err = String((body as any)?.error || "").trim();
      if (err) set_env_error(err);
    } catch (e: any) {
      set_env_error(String(e?.message || e || "Failed to unset env var"));
    }
  }

  const enabled_label = enabled === null ? "…" : enabled ? "enabled" : "disabled";
  const env_enabled_label = env_enabled === null ? "…" : env_enabled ? "enabled" : "disabled";

  return (
    <div className="page page_scroll">
      <div className="page_inner constrained">
        <div className="card">
          <div className="title">
            <h1>Process manager</h1>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
              <button className={`nav_tab ${tab === "processes" ? "active" : ""}`} onClick={() => set_tab("processes")}>
                Processes
              </button>
              <button className={`nav_tab ${tab === "env_vars" ? "active" : ""}`} onClick={() => set_tab("env_vars")}>
                Env vars
              </button>
            </div>
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

              {tab === "processes" ? (
                <>
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
              ) : (
                <>
                  <div className="mono muted" style={{ fontSize: "var(--font-size-sm)", marginTop: "10px" }}>
                    Write-only: the gateway will never return env var values to the browser. Use this for integration config (email, notifications, …).
                  </div>

                  <div className="mono muted" style={{ marginTop: "6px" }}>
                    Env vars: {env_enabled_label}
                  </div>

                  <div className="actions" style={{ marginTop: "10px" }}>
                    <button className={`btn btn_icon ${env_loading ? "is_loading" : ""}`} onClick={() => void refresh_env()} disabled={!gateway_connected || env_loading}>
                      <Icon name="refresh" size={16} />
                      {env_loading ? "Refreshing…" : "Refresh"}
                    </button>
                  </div>

                  {env_error ? (
                    <div className="log_item" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: "10px" }}>
                      <div className="meta">
                        <span className="mono">error</span>
                        <span className="mono">env</span>
                      </div>
                      <div className="body mono">{env_error}</div>
                    </div>
                  ) : null}

                  <div style={{ marginTop: "12px" }}>
                    {env_items.map((it) => {
                      const key = String((it as any)?.key || "").trim();
                      if (!key) return null;
                      const label = String((it as any)?.label || key).trim() || key;
                      const desc = String((it as any)?.description || "").trim();
                      const source = String((it as any)?.source || "").trim();
                      const secret = Boolean((it as any)?.secret);
                      const updated_at = String((it as any)?.updated_at || "").trim();
                      const chip = env_source_chip(source);
                      const v = String(env_inputs?.[key] ?? "");

                      return (
                        <div key={`env:${key}`} className="log_item" style={{ marginBottom: "10px" }}>
                          <div className="meta">
                            <span className="mono">{key}</span>
                            <span className={`chip mono ${chip.cls}`}>{chip.label}</span>
                          </div>
                          <div className="body">
                            <div style={{ fontWeight: 700 }}>{label}</div>
                            {desc ? (
                              <div className="mono muted" style={{ marginTop: "4px" }}>
                                {clamp(desc, 280)}
                              </div>
                            ) : null}
                            {updated_at ? (
                              <div className="mono muted" style={{ marginTop: "6px", fontSize: "var(--font-size-sm)" }}>
                                updated {updated_at}
                              </div>
                            ) : null}

                            <div className="actions" style={{ marginTop: "10px", alignItems: "center" }}>
                              <input
                                className="input"
                                value={v}
                                onChange={(e) => set_env_inputs((prev) => ({ ...(prev || {}), [key]: String(e.target.value || "") }))}
                                placeholder={secret ? "••••••••" : "value"}
                                type={secret ? "password" : "text"}
                                style={{ flex: "1 1 320px", minWidth: "220px" }}
                                autoComplete="off"
                                spellCheck={false}
                              />
                              <button className="btn primary" onClick={() => void env_set(key)} disabled={env_loading}>
                                Set
                              </button>
                              <button className="btn" onClick={() => void env_unset(key)} disabled={env_loading}>
                                Unset
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!env_items.length ? (
                      <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                        No env vars available (process manager must be enabled).
                      </div>
                    ) : null}
                  </div>
                </>
              )}
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
