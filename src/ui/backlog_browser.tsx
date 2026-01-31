import React, { useEffect, useMemo, useState } from "react";

import { Markdown, copyText } from "@abstractuic/panel-chat";

import type { BacklogItemSummary, BacklogListResponse, GatewayClient } from "../lib/gateway_client";

type BacklogKind = "planned" | "proposed" | "recurrent" | "completed";

function short_id(value: string, keep: number): string {
  const s = String(value || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

function is_parsed(item: BacklogItemSummary): boolean {
  if (typeof (item as any)?.parsed === "boolean") return Boolean((item as any).parsed);
  // Back-compat: if id is missing/0, treat as unparsed.
  return typeof item.item_id === "number" && item.item_id > 0;
}

export type BacklogBrowserPageProps = {
  gateway: GatewayClient;
  gateway_connected: boolean;
};

export function BacklogBrowserPage(props: BacklogBrowserPageProps): React.ReactElement {
  const gateway = props.gateway;
  const can_use_gateway = props.gateway_connected;

  const [kind, set_kind] = useState<BacklogKind>("planned");
  const [items, set_items] = useState<BacklogItemSummary[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState("");

  const [query, set_query] = useState("");

  const [selected, set_selected] = useState<BacklogItemSummary | null>(null);
  const [content, set_content] = useState("");
  const [content_loading, set_content_loading] = useState(false);
  const [content_error, set_content_error] = useState("");

  async function refresh(): Promise<void> {
    if (!can_use_gateway) return;
    if (loading) return;
    set_error("");
    set_loading(true);
    try {
      const res = (await gateway.backlog_list(kind)) as BacklogListResponse;
      const next = Array.isArray(res?.items) ? res.items : [];
      set_items(next);
      if (selected && !next.some((it) => it.filename === selected.filename)) {
        set_selected(null);
        set_content("");
        set_content_error("");
      }
    } catch (e: any) {
      set_items([]);
      set_error(String(e?.message || e || "Failed to load backlog list"));
    } finally {
      set_loading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, can_use_gateway]);

  async function load_item(item: BacklogItemSummary): Promise<void> {
    set_selected(item);
    set_content("");
    set_content_error("");
    set_content_loading(true);
    try {
      const res = await gateway.backlog_content(kind, item.filename);
      set_content(String(res?.content || ""));
    } catch (e: any) {
      set_content_error(String(e?.message || e || "Failed to load backlog item"));
    } finally {
      set_content_loading(false);
    }
  }

  const filtered_items = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.item_id || ""} ${it.package || ""} ${it.title || ""} ${it.summary || ""} ${it.filename || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  return (
    <div className="page">
      <div className="page_inner">
        <div className="card">
          <div className="title">
            <h1>Backlog</h1>
            <span className="badge">{can_use_gateway ? "gateway connected" : "connect gateway in Settings"}</span>
          </div>

          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div className="tab_bar" style={{ paddingBottom: 0, borderBottom: "none" }}>
              <button className={`tab ${kind === "planned" ? "active" : ""}`} onClick={() => set_kind("planned")}>
                Planned
              </button>
              <button className={`tab ${kind === "proposed" ? "active" : ""}`} onClick={() => set_kind("proposed")}>
                Proposed
              </button>
              <button className={`tab ${kind === "recurrent" ? "active" : ""}`} onClick={() => set_kind("recurrent")}>
                Recurrent
              </button>
              <button className={`tab ${kind === "completed" ? "active" : ""}`} onClick={() => set_kind("completed")}>
                Completed
              </button>
            </div>
            <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => void refresh()} disabled={!can_use_gateway || loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="row" style={{ marginTop: "10px", alignItems: "center", justifyContent: "space-between" }}>
            <div className="field" style={{ margin: 0, flex: "1 1 auto", minWidth: 240 }}>
              <input value={query} onChange={(e) => set_query(e.target.value)} placeholder="Search backlog (id/title/package/filename…)" />
            </div>
            <div className="mono muted" style={{ fontSize: "12px", paddingLeft: "10px" }}>
              {filtered_items.length}/{items.length}
            </div>
          </div>

          {error ? (
            <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", marginTop: "8px", fontSize: "12px" }}>
              {error}
            </div>
          ) : null}
          {!error && !loading && !items.length ? (
            <div className="mono muted" style={{ marginTop: "8px", fontSize: "12px" }}>
              No items (or backlog browsing not configured on this gateway).
            </div>
          ) : null}
        </div>

        <div className="inbox_layout">
          <div className="card inbox_sidebar">
            <div className="inbox_list">
              {!filtered_items.length ? (
                <div className="mono muted" style={{ fontSize: "12px" }}>
                  No items.
                </div>
              ) : (
                filtered_items.map((it) => {
                  const active = selected?.filename === it.filename;
                  const parsed = is_parsed(it);
                  return (
                    <button key={it.filename} className={`inbox_item ${active ? "active" : ""}`} onClick={() => void load_item(it)}>
                      <div className="inbox_item_title">
                        {!parsed ? <span className="pill unparsed">unparsed</span> : null}
                        {it.item_id ? <span className="mono">#{it.item_id}</span> : null}
                        {it.package ? <span className="mono muted">{it.package}</span> : null}
                        <span className="mono">{short_id(it.title || it.filename, 56)}</span>
                      </div>
                      {it.summary ? <div className="inbox_item_meta mono muted">{short_id(it.summary, 160)}</div> : null}
                      <div className="inbox_item_meta mono">{it.filename}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="card inbox_viewer">
            {selected ? (
              <div className="inbox_detail">
                <div className="inbox_detail_header">
                  <div className="inbox_detail_title">
                    <span className="mono" style={{ fontWeight: 700 }}>
                      {selected.title || selected.filename}
                    </span>
                    {selected.item_id ? <span className="chip mono muted">#{selected.item_id}</span> : null}
                    {selected.package ? <span className="chip mono muted">{selected.package}</span> : null}
                    {!is_parsed(selected) ? <span className="chip mono muted">unparsed</span> : null}
                    <span className="chip mono muted">{selected.filename}</span>
                  </div>
                  <div className="inbox_detail_actions">
                    <button
                      className="btn"
                      onClick={() => {
                        copyText(`docs/backlog/${kind}/${selected.filename}`);
                      }}
                    >
                      Copy path
                    </button>
                  </div>
                </div>

                <div className="inbox_detail_meta mono muted" style={{ fontSize: "12px" }}>{kind}</div>

                {content_error ? (
                  <div className="mono" style={{ color: "rgba(239, 68, 68, 0.9)", fontSize: "12px", marginTop: "8px" }}>
                    {content_error}
                  </div>
                ) : null}
                {content_loading ? (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    Loading…
                  </div>
                ) : content ? (
                  <Markdown text={content} />
                ) : (
                  <div className="mono muted" style={{ fontSize: "12px" }}>
                    No content loaded.
                  </div>
                )}
              </div>
            ) : (
              <div className="mono muted" style={{ fontSize: "12px" }}>
                Select a backlog item.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
