import React, { useEffect, useMemo, useState } from "react";

import { Markdown, copyText } from "@abstractuic/panel-chat";

import type { BacklogContentResponse, ReportInboxItem, TriageDecisionSummary } from "../lib/gateway_client";
import { GatewayClient } from "../lib/gateway_client";
import { Modal } from "./modal";

type InboxTab = "messages" | "bugs" | "features";

function filename_from_relpath(relpath: string): string {
  const raw = String(relpath || "").trim();
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function format_when(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleString();
}

function short_id(value: string, keep: number): string {
  const s = String(value || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

export type ReportInboxPageProps = {
  gateway: GatewayClient;
  gateway_connected: boolean;
  default_session_id?: string;
  default_active_run_id?: string;
  default_workflow_id?: string | null;
};

export function ReportInboxPage(props: ReportInboxPageProps): React.ReactElement {
  const gateway = props.gateway;

  const [tab, set_tab] = useState<InboxTab>("messages");

  const [bugs, set_bugs] = useState<ReportInboxItem[]>([]);
  const [features, set_features] = useState<ReportInboxItem[]>([]);
  const [decisions, set_decisions] = useState<TriageDecisionSummary[]>([]);

  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState("");

  const [selected_report, set_selected_report] = useState<ReportInboxItem | null>(null);
  const [selected_report_md, set_selected_report_md] = useState<string>("");
  const [selected_report_loading, set_selected_report_loading] = useState(false);
  const [selected_report_error, set_selected_report_error] = useState("");

  const [decision_filter, set_decision_filter] = useState<"pending" | "approved" | "deferred" | "rejected" | "">("pending");
  const [selected_decision, set_selected_decision] = useState<TriageDecisionSummary | null>(null);
  const [selected_decision_report_md, set_selected_decision_report_md] = useState<string>("");
  const [selected_decision_draft, set_selected_decision_draft] = useState<BacklogContentResponse | null>(null);
  const [decision_action_error, set_decision_action_error] = useState("");
  const [decision_action_loading, set_decision_action_loading] = useState(false);

  const [triage_running, set_triage_running] = useState(false);
  const [triage_last, set_triage_last] = useState<string>("");

  const [create_kind, set_create_kind] = useState<"" | "bug" | "feature">("");
  const create_open = Boolean(create_kind);
  const [create_session_id, set_create_session_id] = useState("");
  const [create_description, set_create_description] = useState("");
  const [create_error, set_create_error] = useState("");
  const [create_loading, set_create_loading] = useState(false);

  const can_use_gateway = props.gateway_connected;

  const inbox_items = useMemo(() => {
    if (tab === "bugs") return bugs;
    if (tab === "features") return features;
    return [];
  }, [tab, bugs, features]);

  async function refresh_bugs(): Promise<void> {
    const res = await gateway.list_bug_reports();
    set_bugs(Array.isArray(res?.items) ? res.items : []);
  }

  async function refresh_features(): Promise<void> {
    const res = await gateway.list_feature_requests();
    set_features(Array.isArray(res?.items) ? res.items : []);
  }

  async function refresh_decisions(): Promise<void> {
    const res = await gateway.list_triage_decisions({ status: decision_filter || undefined, limit: 500 });
    const items = Array.isArray(res?.decisions) ? res.decisions : [];
    set_decisions(items);
    if (selected_decision && !items.some((d) => d.decision_id === selected_decision.decision_id)) {
      set_selected_decision(null);
      set_selected_decision_report_md("");
      set_selected_decision_draft(null);
      set_decision_action_error("");
    }
  }

  async function refresh_current_tab(): Promise<void> {
    if (!can_use_gateway) return;
    set_error("");
    set_loading(true);
    try {
      if (tab === "bugs") await refresh_bugs();
      else if (tab === "features") await refresh_features();
      else await refresh_decisions();
    } catch (e: any) {
      set_error(String(e?.message || e || "Refresh failed"));
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    void refresh_current_tab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, can_use_gateway, decision_filter]);

  async function load_report(item: ReportInboxItem): Promise<void> {
    set_selected_report(item);
    set_selected_report_md("");
    set_selected_report_error("");
    set_selected_report_loading(true);
    try {
      if (item.report_type === "bug") {
        const res = await gateway.get_bug_report_content(item.filename);
        set_selected_report_md(String(res?.content || ""));
      } else {
        const res = await gateway.get_feature_request_content(item.filename);
        set_selected_report_md(String(res?.content || ""));
      }
    } catch (e: any) {
      set_selected_report_error(String(e?.message || e || "Failed to load report"));
    } finally {
      set_selected_report_loading(false);
    }
  }

  async function load_decision_report(decision: TriageDecisionSummary): Promise<void> {
    set_selected_decision(decision);
    set_selected_decision_report_md("");
    set_selected_decision_draft(null);
    set_decision_action_error("");

    const filename = filename_from_relpath(decision.report_relpath);
    if (!filename) return;
    try {
      if (decision.report_type === "bug") {
        const res = await gateway.get_bug_report_content(filename);
        set_selected_decision_report_md(String(res?.content || ""));
      } else if (decision.report_type === "feature") {
        const res = await gateway.get_feature_request_content(filename);
        set_selected_decision_report_md(String(res?.content || ""));
      }
    } catch (e: any) {
      // best-effort; leave empty
      set_decision_action_error(String(e?.message || e || "Failed to load report"));
    }
  }

  async function load_decision_draft(decision: TriageDecisionSummary): Promise<void> {
    set_decision_action_error("");
    set_selected_decision_draft(null);
    const rel = String(decision.draft_relpath || "").trim();
    if (!rel) return;
    const name = filename_from_relpath(rel);
    if (!name) return;
    try {
      const res = await gateway.backlog_content("proposed", name);
      set_selected_decision_draft(res);
    } catch (e: any) {
      set_decision_action_error(String(e?.message || e || "Failed to load draft (is repo root configured on gateway?)"));
    }
  }

  async function apply_decision(action: "approve" | "reject" | "defer", defer_days?: number): Promise<void> {
    if (!selected_decision) return;
    if (decision_action_loading) return;
    set_decision_action_error("");
    set_decision_action_loading(true);
    try {
      const updated = await gateway.apply_triage_decision(selected_decision.decision_id, { action, defer_days: defer_days ?? null });
      await refresh_decisions();
      const wanted = String(decision_filter || "")
        .trim()
        .toLowerCase();
      const next_status = String(updated?.status || "")
        .trim()
        .toLowerCase();
      const still_visible = !wanted || wanted === next_status;
      if (!still_visible) {
        set_selected_decision(null);
        set_selected_decision_report_md("");
        set_selected_decision_draft(null);
      } else {
        set_selected_decision(updated);
        if (String(updated.draft_relpath || "").trim()) {
          try {
            await load_decision_draft(updated);
          } catch {
            // ignore
          }
        }
      }
    } catch (e: any) {
      set_decision_action_error(String(e?.message || e || "Decision action failed"));
    } finally {
      set_decision_action_loading(false);
    }
  }

  async function run_triage(): Promise<void> {
    if (triage_running) return;
    set_error("");
    set_triage_running(true);
    try {
      const res = await gateway.triage_run({ write_drafts: false, enable_llm: false });
      set_triage_last(`Scanned ${res?.reports ?? 0} report(s); updated ${res?.updated_decisions ?? 0} decision(s).`);
      await refresh_decisions();
    } catch (e: any) {
      set_error(String(e?.message || e || "Triage failed"));
    } finally {
      set_triage_running(false);
    }
  }

  useEffect(() => {
    if (!create_open) return;
    set_create_error("");
    set_create_description("");
    set_create_loading(false);
    set_create_session_id(String(props.default_session_id || "").trim());
  }, [create_open, props.default_session_id]);

  async function submit_create(): Promise<void> {
    if (!create_kind) return;
    if (create_loading) return;
    set_create_error("");
    set_create_loading(true);
    try {
      const session_id = String(create_session_id || "").trim();
      if (!session_id) throw new Error("session_id is required");
      const description = String(create_description || "").trim();
      if (!description) throw new Error("description is required");

      const base_req: any = {
        session_id,
        description,
        active_run_id: String(props.default_active_run_id || "").trim() || undefined,
        workflow_id: String(props.default_workflow_id || "").trim() || undefined,
        client: "abstractobserver/web",
        client_version: "",
        user_agent: String(globalThis?.navigator?.userAgent || ""),
        url: String(globalThis?.location?.href || ""),
      };

      if (create_kind === "bug") {
        const out = await gateway.bug_report_create(base_req);
        const filename = String(out?.filename || "").trim();
        set_create_kind("");
        set_tab("bugs");
        const list = await gateway.list_bug_reports();
        const items = Array.isArray(list?.items) ? list.items : [];
        set_bugs(items);
        const item = items.find((b) => b.filename === filename) || null;
        if (item) await load_report(item);
      } else {
        const out = await gateway.feature_report_create(base_req);
        const filename = String(out?.filename || "").trim();
        set_create_kind("");
        set_tab("features");
        const list = await gateway.list_feature_requests();
        const items = Array.isArray(list?.items) ? list.items : [];
        set_features(items);
        const item = items.find((f) => f.filename === filename) || null;
        if (item) await load_report(item);
      }
    } catch (e: any) {
      set_create_error(String(e?.message || e || "Failed to create report"));
    } finally {
      set_create_loading(false);
    }
  }

  return (
    <div className="page">
      <div className="page_inner">
        <div className="card">
          <div className="title">
            <h1>Inbox</h1>
          </div>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div className="tab_bar" style={{ paddingBottom: 0, borderBottom: "none" }}>
              <button className={`tab ${tab === "messages" ? "active" : ""}`} onClick={() => set_tab("messages")}>
                Messages
              </button>
              <button className={`tab ${tab === "bugs" ? "active" : ""}`} onClick={() => set_tab("bugs")}>
                Bugs
              </button>
              <button className={`tab ${tab === "features" ? "active" : ""}`} onClick={() => set_tab("features")}>
                Features
              </button>
            </div>
            <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
              {tab === "messages" ? (
                <>
                  <select
                    value={decision_filter}
                    onChange={(e) => set_decision_filter(String(e.target.value) as any)}
                    title="Filter triage decisions by status"
                  >
                    <option value="pending">pending</option>
                    <option value="approved">approved</option>
                    <option value="deferred">deferred</option>
                    <option value="rejected">rejected</option>
                    <option value="">all</option>
                  </select>
                  <button className="btn" onClick={() => void refresh_current_tab()} disabled={!can_use_gateway || loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                  <button className="btn primary" onClick={() => void run_triage()} disabled={!can_use_gateway || triage_running}>
                    {triage_running ? "Running…" : "Run triage"}
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => void refresh_current_tab()} disabled={!can_use_gateway || loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              )}
              <button className="btn" onClick={() => set_create_kind("bug")} disabled={!can_use_gateway}>
                File bug
              </button>
              <button className="btn" onClick={() => set_create_kind("feature")} disabled={!can_use_gateway}>
                File feature
              </button>
            </div>
          </div>
          {triage_last ? <div className="mono muted" style={{ marginTop: "8px", fontSize: "12px" }}>{triage_last}</div> : null}
          {error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", marginTop: "8px", fontSize: "12px" }}>
              {error}
            </div>
          ) : null}
        </div>

        <div className="inbox_layout">
          <div className="card inbox_sidebar">
            {tab === "messages" ? (
              <div className="inbox_list">
                {!decisions.length ? (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    No decisions.
                  </div>
                ) : (
                  decisions.map((d) => {
                    const active = selected_decision?.decision_id === d.decision_id;
                    const missing = Array.isArray(d.missing_fields) ? d.missing_fields.length : 0;
                    return (
                      <button
                        key={d.decision_id}
                        className={`inbox_item ${active ? "active" : ""}`}
                        onClick={() => void load_decision_report(d)}
                      >
                        <div className="inbox_item_title">
                          <span className={`pill ${String(d.status || "").toLowerCase()}`}>{String(d.status || "pending")}</span>
                          <span className="mono">{d.report_type}</span>
                          <span className="mono muted">{short_id(d.decision_id, 10)}</span>
                        </div>
                        <div className="inbox_item_meta mono muted">
                          {missing ? `${missing} missing` : "complete"} • {format_when(d.updated_at || d.created_at) || "(time?)"}
                        </div>
                        <div className="inbox_item_meta mono">{short_id(d.report_relpath || "", 46)}</div>
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="inbox_list">
                {!inbox_items.length ? (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    No reports.
                  </div>
                ) : (
                  inbox_items.map((it) => {
                    const active = selected_report?.filename === it.filename && selected_report?.report_type === it.report_type;
                    const status = String(it.triage_status || "").trim().toLowerCase();
                    return (
                      <button key={it.relpath} className={`inbox_item ${active ? "active" : ""}`} onClick={() => void load_report(it)}>
                        <div className="inbox_item_title">
                          {status ? <span className={`pill ${status}`}>{status}</span> : null}
                          <span className="mono">{short_id(it.title || it.filename, 46)}</span>
                        </div>
                        <div className="inbox_item_meta mono muted">
                          {format_when(it.created_at) || "(time?)"} • {it.session_id ? short_id(it.session_id, 12) : "session?"}
                        </div>
                        <div className="inbox_item_meta mono">{it.filename}</div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="card inbox_viewer">
            {tab === "messages" ? (
              selected_decision ? (
                <div className="inbox_detail">
                  <div className="inbox_detail_header">
                    <div className="inbox_detail_title">
                      <span className="mono" style={{ fontWeight: 700 }}>
                        Triage decision
                      </span>
                      <span className="chip mono muted">{selected_decision.report_type}</span>
                      <span className="chip mono muted">{selected_decision.status}</span>
                      <span className="chip mono muted">{short_id(selected_decision.decision_id, 16)}</span>
                    </div>
                    <div className="inbox_detail_actions">
                      <button
                        className="btn"
                        onClick={() => {
                          copyText(selected_decision.report_relpath || "");
                        }}
                      >
                        Copy report path
                      </button>
                      {selected_decision.draft_relpath ? (
                        <button className="btn" onClick={() => void load_decision_draft(selected_decision)}>
                          Load draft
                        </button>
                      ) : null}
                      <button className="btn primary" onClick={() => void apply_decision("approve")} disabled={decision_action_loading}>
                        Approve
                      </button>
                      <button className="btn" onClick={() => void apply_decision("defer", 1)} disabled={decision_action_loading}>
                        Defer 1d
                      </button>
                      <button className="btn" onClick={() => void apply_decision("defer", 7)} disabled={decision_action_loading}>
                        Defer 7d
                      </button>
                      <button className="btn" onClick={() => void apply_decision("reject")} disabled={decision_action_loading}>
                        Reject
                      </button>
                    </div>
                  </div>

                  <div className="inbox_detail_meta mono muted" style={{ fontSize: "12px" }}>
                    {selected_decision.updated_at ? `updated ${format_when(selected_decision.updated_at)}` : null}
                    {selected_decision.created_at ? `${selected_decision.updated_at ? " • " : ""}created ${format_when(selected_decision.created_at)}` : null}
                    {selected_decision.defer_until ? ` • defer until ${selected_decision.defer_until}` : null}
                  </div>

                  {decision_action_error ? (
                    <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                      {decision_action_error}
                    </div>
                  ) : null}

                  <div className="row" style={{ gap: "12px" }}>
                    <div className="col" style={{ minWidth: 240 }}>
                      <div className="section_title">Missing fields</div>
                      {selected_decision.missing_fields && selected_decision.missing_fields.length ? (
                        <ul className="inbox_list_ul mono">
                          {selected_decision.missing_fields.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mono muted" style={{ fontSize: "12px" }}>
                          None.
                        </div>
                      )}

                      <div className="section_title" style={{ marginTop: "10px" }}>
                        Possible duplicates
                      </div>
                      {selected_decision.duplicates && selected_decision.duplicates.length ? (
                        <ul className="inbox_list_ul mono">
                          {selected_decision.duplicates.slice(0, 20).map((d, idx) => {
                            const label = String(d?.title || d?.ref || d?.kind || "duplicate").trim();
                            const score = typeof d?.score === "number" && Number.isFinite(d.score) ? ` (score ${d.score.toFixed(2)})` : "";
                            return (
                              <li key={`${label}_${idx}`}>
                                {label}
                                {score}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="mono muted" style={{ fontSize: "12px" }}>
                          None.
                        </div>
                      )}
                    </div>
                    <div className="col" style={{ minWidth: 240 }}>
                      <div className="section_title">Draft</div>
                      {selected_decision.draft_relpath ? (
                        <div className="mono" style={{ fontSize: "12px" }}>
                          <div className="mono muted">path</div>
                          <div className="mono">{selected_decision.draft_relpath}</div>
                        </div>
                      ) : (
                        <div className="mono muted" style={{ fontSize: "12px" }}>
                          No draft yet. Approve to generate one (requires repo mounted on gateway host).
                        </div>
                      )}
                    </div>
                  </div>

                  {selected_decision_draft ? (
                    <div className="inbox_markdown">
                      <div className="section_title">Draft content</div>
                      <Markdown text={String(selected_decision_draft.content || "")} />
                    </div>
                  ) : null}

                  <div className="inbox_markdown">
                    <div className="section_title">Source report</div>
                    {selected_decision_report_md ? (
                      <Markdown text={selected_decision_report_md} />
                    ) : (
                      <div className="mono muted" style={{ fontSize: "12px" }}>
                        No report preview loaded.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mono muted" style={{ fontSize: "12px" }}>
                  Select a decision.
                </div>
              )
            ) : selected_report ? (
              <div className="inbox_detail">
                <div className="inbox_detail_header">
                  <div className="inbox_detail_title">
                    <span className="mono" style={{ fontWeight: 700 }}>
                      {selected_report.report_type === "bug" ? "Bug report" : "Feature request"}
                    </span>
                    {selected_report.triage_status ? <span className={`pill ${selected_report.triage_status}`}>{selected_report.triage_status}</span> : null}
                    <span className="chip mono muted">{selected_report.filename}</span>
                    {selected_report.session_id ? <span className="chip mono muted">{short_id(selected_report.session_id, 16)}</span> : null}
                  </div>
                  <div className="inbox_detail_actions">
                    <button
                      className="btn"
                      onClick={() => {
                        copyText(selected_report.relpath || "");
                      }}
                    >
                      Copy path
                    </button>
                  </div>
                </div>

                {selected_report_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                    {selected_report_error}
                  </div>
                ) : null}

                {selected_report_loading ? (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    Loading…
                  </div>
                ) : selected_report_md ? (
                  <Markdown text={selected_report_md} />
                ) : (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    No content loaded.
                  </div>
                )}
              </div>
            ) : (
              <div className="mono muted" style={{ fontSize: "12px" }}>
                Select a report.
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={create_open}
        title={create_kind === "bug" ? "File bug report" : "File feature request"}
        onClose={() => set_create_kind("")}
        actions={
          <>
            <button className="btn" onClick={() => set_create_kind("")} disabled={create_loading}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void submit_create()} disabled={create_loading}>
              {create_loading ? "Submitting…" : "Submit"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Session ID</label>
          <input value={create_session_id} onChange={(e) => set_create_session_id(e.target.value)} placeholder="session id (required)" />
          <div className="mono muted" style={{ fontSize: "12px" }}>
            This correlates runs + attachments (via the session memory run).
          </div>
        </div>
        <div className="field">
          <label>{create_kind === "bug" ? "Bug description" : "Feature description"}</label>
          <textarea
            value={create_description}
            onChange={(e) => set_create_description(e.target.value)}
            placeholder={create_kind === "bug" ? "What is broken? What did you expect?" : "What do you want to be able to do?"}
            rows={6}
          />
        </div>
        {create_error ? (
          <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px" }}>
            {create_error}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
