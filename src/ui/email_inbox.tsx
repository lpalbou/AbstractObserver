import React, { useEffect, useMemo, useState } from "react";

import { copyText } from "@abstractuic/panel-chat";

import type { EmailAccountInfo, EmailMessageSummary, EmailReadResponse } from "../lib/gateway_client";
import { GatewayClient } from "../lib/gateway_client";
import { Modal } from "./modal";

type EmailStatus = "all" | "unread" | "read";

function format_when(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleString();
}

function short(value: string, keep: number): string {
  const s = String(value || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

function parse_recipients(raw: string): string | string[] {
  const parts = String(raw || "")
    .split(/[,\n]/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts;
}

export type EmailInboxPanelProps = {
  gateway: GatewayClient;
  enabled: boolean;
};

export function EmailInboxPanel(props: EmailInboxPanelProps): React.ReactElement {
  const gateway = props.gateway;

  const [accounts, set_accounts] = useState<EmailAccountInfo[]>([]);
  const [default_account, set_default_account] = useState<string>("");
  const [account, set_account] = useState<string>("");

  const [mailbox, set_mailbox] = useState<string>("");
  const [since, set_since] = useState<string>("7d");
  const [status, set_status] = useState<EmailStatus>("unread");
  const [limit, set_limit] = useState<number>(25);

  const [loading_accounts, set_loading_accounts] = useState(false);
  const [loading_list, set_loading_list] = useState(false);
  const [loading_read, set_loading_read] = useState(false);
  const [sending, set_sending] = useState(false);

  const [error, set_error] = useState("");
  const [read_error, set_read_error] = useState("");
  const [send_error, set_send_error] = useState("");

  const [messages, set_messages] = useState<EmailMessageSummary[]>([]);
  const [selected_uid, set_selected_uid] = useState<string>("");
  const [selected, set_selected] = useState<EmailReadResponse | null>(null);

  const [compose_open, set_compose_open] = useState(false);
  const [compose_to, set_compose_to] = useState("");
  const [compose_cc, set_compose_cc] = useState("");
  const [compose_bcc, set_compose_bcc] = useState("");
  const [compose_subject, set_compose_subject] = useState("");
  const [compose_body, set_compose_body] = useState("");

  const can_use = props.enabled;

  const account_options = useMemo(() => {
    const list = Array.isArray(accounts) ? accounts : [];
    return list
      .map((a) => ({
        account: String(a?.account || "").trim(),
        can_read: a?.can_read !== false,
        can_send: a?.can_send !== false,
        label: "",
      }))
      .filter((a) => Boolean(a.account));
  }, [accounts]);

  const selected_caps = useMemo(() => {
    const acct = String(account || "").trim();
    if (!acct) return null;
    return account_options.find((a) => a.account === acct) || null;
  }, [account_options, account]);

  const selected_can_read = Boolean(selected_caps?.can_read);
  const selected_can_send = Boolean(selected_caps?.can_send);

  const account_options_labeled = useMemo(() => {
    return account_options.map((a) => {
      const suffix = !a.can_read ? " (send-only)" : !a.can_send ? " (read-only)" : "";
      return { ...a, label: `${a.account}${suffix}` };
    });
  }, [account_options]);

  async function refresh_accounts(): Promise<void> {
    if (!can_use) return;
    set_error("");
    set_loading_accounts(true);
    try {
      const res = await gateway.email_list_accounts();
      set_accounts(Array.isArray(res?.accounts) ? res.accounts : []);
      set_default_account(String(res?.default_account || "").trim());
    } catch (e: any) {
      set_error(String(e?.message || e || "Failed to list email accounts"));
      set_accounts([]);
      set_default_account("");
    } finally {
      set_loading_accounts(false);
    }
  }

  useEffect(() => {
    void refresh_accounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can_use]);

  useEffect(() => {
    if (!can_use) return;
    const chosen = String(account || "").trim();
    if (chosen && account_options.some((a) => a.account === chosen)) return;

    const stored = String(localStorage.getItem("abstractobserver_email_account") || "").trim();
    if (stored && account_options.some((a) => a.account === stored)) {
      set_account(stored);
      return;
    }
    if (default_account && account_options.some((a) => a.account === default_account)) {
      set_account(default_account);
      return;
    }
    if (account_options.length) set_account(account_options[0].account);
  }, [can_use, account, default_account, account_options]);

  useEffect(() => {
    const chosen = String(account || "").trim();
    if (!chosen) return;
    localStorage.setItem("abstractobserver_email_account", chosen);
  }, [account]);

  async function refresh_list(): Promise<void> {
    if (!can_use) return;
    const acct = String(account || "").trim();
    if (!acct) return;
    if (!selected_can_read) {
      set_error("Selected account is not allowed to read email.");
      set_messages([]);
      set_selected_uid("");
      set_selected(null);
      return;
    }
    set_error("");
    set_loading_list(true);
    try {
      const res = await gateway.email_list_messages({
        account: acct,
        mailbox: String(mailbox || "").trim() || undefined,
        since: String(since || "").trim() || undefined,
        status,
        limit,
      });
      set_messages(Array.isArray(res?.messages) ? res.messages : []);
      const current_uid = String(selected_uid || "").trim();
      if (current_uid && !Array.isArray(res?.messages)) {
        set_selected_uid("");
        set_selected(null);
      }
    } catch (e: any) {
      set_error(String(e?.message || e || "Failed to list emails"));
      set_messages([]);
      set_selected_uid("");
      set_selected(null);
    } finally {
      set_loading_list(false);
    }
  }

  useEffect(() => {
    if (!can_use) return;
    if (!String(account || "").trim()) return;
    void refresh_list();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can_use, account]);

  async function open_message(uid: string): Promise<void> {
    if (!can_use) return;
    const acct = String(account || "").trim();
    const id = String(uid || "").trim();
    if (!acct || !id) return;
    if (!selected_can_read) return;
    set_selected_uid(id);
    set_selected(null);
    set_read_error("");
    set_loading_read(true);
    try {
      const res = await gateway.email_read_message(id, {
        account: acct,
        mailbox: String(mailbox || "").trim() || undefined,
        max_body_chars: 20000,
      });
      set_selected(res);
    } catch (e: any) {
      set_read_error(String(e?.message || e || "Failed to read email"));
    } finally {
      set_loading_read(false);
    }
  }

  function open_compose(opts?: { to?: string; subject?: string; body?: string }): void {
    set_send_error("");
    set_compose_to(String(opts?.to || "").trim());
    set_compose_cc("");
    set_compose_bcc("");
    set_compose_subject(String(opts?.subject || "").trim());
    set_compose_body(String(opts?.body || ""));
    set_compose_open(true);
  }

  function open_reply(): void {
    if (!selected) return;
    const to = String(selected?.from || "").trim();
    const subj_raw = String(selected?.subject || "").trim();
    const subj = subj_raw.toLowerCase().startsWith("re:") ? subj_raw : `Re: ${subj_raw || "(no subject)"}`;
    const quoted = String(selected?.body_text || "").trim();
    const body = `\n\n---\nOn ${format_when(selected?.date || "")}, ${to} wrote:\n\n${quoted}`;
    open_compose({ to, subject: subj, body });
  }

  async function send_compose(): Promise<void> {
    if (!can_use) return;
    if (sending) return;
    const acct = String(account || "").trim();
    if (!acct) return;
    if (!selected_can_send) {
      set_send_error("Selected account is not allowed to send email.");
      return;
    }
    set_send_error("");
    set_sending(true);
    try {
      const to = parse_recipients(compose_to);
      if (!to) throw new Error("to is required");
      const subject = String(compose_subject || "").trim();
      if (!subject) throw new Error("subject is required");
      const body_text = String(compose_body || "").trim();
      if (!body_text) throw new Error("body is required");

      await gateway.email_send({
        account: acct,
        to,
        subject,
        body_text,
        cc: parse_recipients(compose_cc),
        bcc: parse_recipients(compose_bcc),
      });
      set_compose_open(false);
      set_compose_to("");
      set_compose_cc("");
      set_compose_bcc("");
      set_compose_subject("");
      set_compose_body("");
      await refresh_list();
    } catch (e: any) {
      set_send_error(String(e?.message || e || "Failed to send email"));
    } finally {
      set_sending(false);
    }
  }

  const selected_summary = useMemo(() => {
    const id = String(selected_uid || "").trim();
    if (!id) return null;
    return messages.find((m) => String(m?.uid || "").trim() === id) || null;
  }, [messages, selected_uid]);

  const selected_body = String(selected?.body_text || "").trim() || String(selected?.body_html || "").trim();
  const selected_body_label = String(selected?.body_text || "").trim() ? "Body (text)" : String(selected?.body_html || "").trim() ? "Body (html, raw)" : "Body";

  return (
    <>
      <div className="inbox_layout">
        <div className="card inbox_sidebar">
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div className="row" style={{ gap: "8px", alignItems: "center" }}>
              <select value={account} onChange={(e) => set_account(String(e.target.value || ""))} disabled={!can_use || loading_accounts}>
                {account_options_labeled.length ? (
                  account_options_labeled.map((a) => (
                    <option key={a.account} value={a.account}>
                      {a.label}
                    </option>
                  ))
                ) : (
                  <option value="">(no accounts)</option>
                )}
              </select>
              <button className="btn" onClick={() => void refresh_accounts()} disabled={!can_use || loading_accounts}>
                {loading_accounts ? "Loading…" : "Accounts"}
              </button>
            </div>
            <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => void refresh_list()} disabled={!can_use || loading_list || !String(account || "").trim() || !selected_can_read}>
                {loading_list ? "Refreshing…" : "Refresh"}
              </button>
              <button className="btn primary" onClick={() => open_compose()} disabled={!can_use || !String(account || "").trim() || !selected_can_send}>
                Compose
              </button>
            </div>
          </div>

          <div className="row" style={{ gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0, minWidth: 120, flex: "1 1 120px" }}>
              <label>Since</label>
              <input value={since} onChange={(e) => set_since(String(e.target.value || ""))} placeholder="7d" />
            </div>
            <div className="field" style={{ margin: 0, minWidth: 120, flex: "0 0 120px" }}>
              <label>Status</label>
              <select value={status} onChange={(e) => set_status(String(e.target.value || "all") as any)}>
                <option value="all">all</option>
                <option value="unread">unread</option>
                <option value="read">read</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0, minWidth: 120, flex: "0 0 120px" }}>
              <label>Limit</label>
              <input
                value={String(limit)}
                onChange={(e) => set_limit(Number(e.target.value || "0") || 25)}
                inputMode="numeric"
                placeholder="25"
              />
            </div>
            <div className="field" style={{ margin: 0, minWidth: 160, flex: "1 1 160px" }}>
              <label>Mailbox</label>
              <input value={mailbox} onChange={(e) => set_mailbox(String(e.target.value || ""))} placeholder="INBOX" />
            </div>
            <div className="row" style={{ gap: "8px", alignItems: "center", marginTop: "18px" }}>
              <button className="btn" onClick={() => void refresh_list()} disabled={!can_use || loading_list || !String(account || "").trim() || !selected_can_read}>
                Apply
              </button>
            </div>
          </div>

          {error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)" }}>
              {error}
            </div>
          ) : null}

          <div className="inbox_list">
            {!messages.length ? (
              <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
                No messages.
              </div>
            ) : (
              messages.map((m) => {
                const uid = String(m?.uid || "").trim();
                const active = Boolean(uid) && uid === String(selected_uid || "").trim();
                const subj = String(m?.subject || "").trim() || "(no subject)";
                const from = String(m?.from || "").trim();
                const date = String(m?.date || "").trim();
                const seen = Boolean(m?.seen);
                return (
                  <button key={uid || Math.random()} className={`inbox_item ${active ? "active" : ""}`} onClick={() => void open_message(uid)}>
                    <div className="inbox_item_title">
                      <span className={`pill ${seen ? "approved" : "pending"}`}>{seen ? "read" : "unread"}</span>
                      <span className="item_title_text">{short(subj, 52)}</span>
                    </div>
                    <div className="inbox_item_meta mono muted">{short(from, 60) || "(from?)"}</div>
                    <div className="inbox_item_meta mono muted">
                      {short(date, 36) || "(date?)"} • uid {short(uid, 10)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="card inbox_viewer">
          {!selected_uid ? (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
              Select an email to read.
            </div>
          ) : loading_read ? (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
              Loading email…
            </div>
          ) : read_error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)" }}>
              {read_error}
            </div>
          ) : selected ? (
            <>
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <div className="row" style={{ gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <div className="mono" style={{ fontWeight: 700 }}>
                    {String(selected?.subject || "").trim() || "(no subject)"}
                  </div>
                  <span className="pill muted">{String(selected?.account || "").trim() || account}</span>
                  <span className="pill muted">{String(selected?.mailbox || "").trim() || "(mailbox?)"}</span>
                  <span className="pill muted">uid {short(String(selected?.uid || selected_uid), 12)}</span>
                </div>
                <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    className="btn"
                    onClick={() => copyText(String(selected?.message_id || ""))}
                    disabled={!String(selected?.message_id || "").trim()}
                    title="Copy Message-ID"
                  >
                    Copy msg-id
                  </button>
                  <button className="btn" onClick={() => copyText(String(selected_uid || ""))} disabled={!String(selected_uid || "").trim()} title="Copy UID">
                    Copy uid
                  </button>
                  <button className="btn primary" onClick={() => open_reply()} disabled={!selected_can_send || !String(selected?.from || "").trim()}>
                    Reply
                  </button>
                </div>
              </div>

              <div className="section_divider" />

              <div className="field">
                <label>From</label>
                <div className="mono">{String(selected?.from || "").trim() || "(from?)"}</div>
              </div>
              <div className="field">
                <label>To</label>
                <div className="mono">{String(selected?.to || "").trim() || "(to?)"}</div>
              </div>
              {String(selected?.cc || "").trim() ? (
                <div className="field">
                  <label>Cc</label>
                  <div className="mono">{String(selected?.cc || "").trim()}</div>
                </div>
              ) : null}
              <div className="field">
                <label>Date</label>
                <div className="mono">{format_when(String(selected?.date || selected_summary?.date || "").trim()) || String(selected?.date || selected_summary?.date || "").trim() || "(date?)"}</div>
              </div>

              {Array.isArray(selected?.attachments) && selected.attachments.length ? (
                <div className="field">
                  <label>Attachments</label>
                  <div className="mono">
                    {selected.attachments.map((a, idx) => (
                      <div key={`${a?.filename || ""}:${idx}`}>
                        {String(a?.filename || "").trim() || "(file?)"}{" "}
                        <span className="muted">{String(a?.content_type || "").trim() ? `(${String(a?.content_type || "").trim()})` : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="section_divider" />

              <div className="field">
                <label>{selected_body_label}</label>
                <pre
                  className="mono"
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    padding: "10px",
                    borderRadius: "10px",
                    border: "1px solid rgba(255, 255, 255, 0.10)",
                    background: "rgba(0, 0, 0, 0.12)",
                    maxHeight: "60vh",
                    overflow: "auto",
                  }}
                >
                  {selected_body || "(empty)"}
                </pre>
              </div>
            </>
          ) : (
            <div className="mono muted" style={{ fontSize: "var(--font-size-sm)" }}>
              Select an email to read.
            </div>
          )}
        </div>
      </div>

      <Modal
        open={compose_open}
        title={`Compose (${String(account || "").trim() || "account"})`}
        onClose={() => {
          if (sending) return;
          set_compose_open(false);
        }}
        actions={
          <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
            {send_error ? (
              <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "var(--font-size-sm)", marginRight: "auto" }}>
                {send_error}
              </div>
            ) : null}
            <button className="btn" onClick={() => set_compose_open(false)} disabled={sending}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void send_compose()} disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        }
      >
        <div className="field">
          <label>To</label>
          <input value={compose_to} onChange={(e) => set_compose_to(String(e.target.value || ""))} placeholder="you@example.com" />
        </div>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label>Cc</label>
            <input value={compose_cc} onChange={(e) => set_compose_cc(String(e.target.value || ""))} placeholder="(optional)" />
          </div>
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label>Bcc</label>
            <input value={compose_bcc} onChange={(e) => set_compose_bcc(String(e.target.value || ""))} placeholder="(optional)" />
          </div>
        </div>
        <div className="field">
          <label>Subject</label>
          <input value={compose_subject} onChange={(e) => set_compose_subject(String(e.target.value || ""))} placeholder="Subject" />
        </div>
        <div className="field">
          <label>Body (text)</label>
          <textarea value={compose_body} onChange={(e) => set_compose_body(String(e.target.value || ""))} placeholder="Write your message…" />
        </div>
        <div className="mono muted" style={{ fontSize: "var(--font-size-xs)" }}>
          Tip: separate multiple recipients with commas or newlines.
        </div>
      </Modal>
    </>
  );
}
