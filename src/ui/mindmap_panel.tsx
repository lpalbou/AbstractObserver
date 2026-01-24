import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  KgActiveMemoryExplorer,
  type JsonValue,
  type KgAssertion,
  type KgQueryParams,
  type KgQueryResult,
  type MemoryScope,
} from "@abstractuic/monitor-active-memory";

import { GatewayClient } from "../lib/gateway_client";

type MindmapPanelProps = {
  gateway: GatewayClient;
  selected_run_id: string;
  selected_session_id: string;
};

type RecentAssertion = {
  id: string;
  assertion: KgAssertion;
  expires_at_ms: number;
};

function normalize_scope(value: string, fallback: MemoryScope = "session"): MemoryScope {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (s === "run" || s === "session" || s === "global" || s === "all") return s;
  return fallback;
}

function parse_iso_ms(ts: unknown): number | null {
  const s = typeof ts === "string" ? ts.trim() : "";
  if (!s) return null;
  const normalized = s.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function iso_max(a: string, b: string): string {
  const s1 = String(a || "");
  const s2 = String(b || "");
  return s2 > s1 ? s2 : s1;
}

function assertion_key(a: KgAssertion): string {
  const s = String(a?.subject || "").trim();
  const p = String(a?.predicate || "").trim();
  const o = String(a?.object || "").trim();
  const t = String(a?.observed_at || "").trim();
  const sc = String(a?.scope || "").trim();
  const oid = String(a?.owner_id || "").trim();
  return `${s}|${p}|${o}|${t}|${sc}|${oid}`;
}

function format_assertion_line(a: KgAssertion): string {
  const ts = String(a?.observed_at || "").trim();
  const s = String(a?.subject || "").trim();
  const p = String(a?.predicate || "").trim();
  const o = String(a?.object || "").trim();
  const sc = String(a?.scope || "").trim();
  const oid = String(a?.owner_id || "").trim();
  const suffix: string[] = [];
  if (sc) suffix.push(`scope=${sc}`);
  if (oid) suffix.push(`owner=${oid}`);
  const meta = suffix.length ? ` (${suffix.join(", ")})` : "";
  return `${ts ? `[${ts}] ` : ""}${s} --${p}--> ${o}${meta}`;
}

export function MindmapPanel({ gateway, selected_run_id, selected_session_id }: MindmapPanelProps) {
  const [run_id_override, set_run_id_override] = useState<string>(String(selected_run_id || "").trim());
  const [session_id_override, set_session_id_override] = useState<string>(String(selected_session_id || "").trim());
  const [source, set_source] = useState<"all" | "global" | "session" | "run">("all");
  const all_owners = source === "all";

  const [live, set_live] = useState(true);
  const [poll_ms, set_poll_ms] = useState(750);
  const [highlight_ms, set_highlight_ms] = useState(2000);

  const [items, set_items] = useState<KgAssertion[]>([]);
  const [warnings, set_warnings] = useState<JsonValue | undefined>(undefined);
  const [error, set_error] = useState<string>("");
  const [loading, set_loading] = useState(false);

  const [recent, set_recent] = useState<RecentAssertion[]>([]);

  const seen_keys_ref = useRef<Set<string>>(new Set());
  const last_seen_observed_at_ref = useRef<string>("");
  const base_query_ref = useRef<{ scope: MemoryScope; subject?: string; predicate?: string; object?: string } | null>(null);
  const last_query_params_ref = useRef<KgQueryParams | null>(null);

  useEffect(() => {
    set_run_id_override(String(selected_run_id || "").trim());
  }, [selected_run_id]);

  useEffect(() => {
    set_session_id_override(String(selected_session_id || "").trim());
  }, [selected_session_id]);

  const reset_key = useMemo(() => {
    const rid = String(run_id_override || "").trim();
    const sid = String(session_id_override || "").trim();
    return `mindmap:${source}:${rid}:${sid}`;
  }, [run_id_override, session_id_override, source]);

  const time_bounds = useMemo(() => {
    let min_ms: number | null = null;
    let max_ms: number | null = null;
    for (const a of items) {
      const ms = parse_iso_ms(a?.observed_at);
      if (ms === null) continue;
      min_ms = min_ms === null ? ms : Math.min(min_ms, ms);
      max_ms = max_ms === null ? ms : Math.max(max_ms, ms);
    }
    return { min_ms, max_ms };
  }, [items]);

  const [follow_latest, set_follow_latest] = useState(true);
  const [time_cursor_ms, set_time_cursor_ms] = useState<number | null>(null);

  useEffect(() => {
    if (!follow_latest) return;
    if (typeof time_bounds.max_ms !== "number") return;
    set_time_cursor_ms(time_bounds.max_ms);
  }, [follow_latest, time_bounds.max_ms]);

  const filtered_items = useMemo(() => {
    const cur = typeof time_cursor_ms === "number" ? time_cursor_ms : null;
    if (cur === null) return items;
    return items.filter((a) => {
      const ms = parse_iso_ms(a?.observed_at);
      if (ms === null) return true;
      return ms <= cur;
    });
  }, [items, time_cursor_ms]);

  const replace_items = useCallback((next_items_raw: KgAssertion[], meta?: { warnings?: JsonValue }) => {
    const next_items = Array.isArray(next_items_raw) ? next_items_raw : [];
    const seen = new Set<string>();
    const deduped: KgAssertion[] = [];
    let last_seen = "";

    for (const a of next_items) {
      if (!a || typeof a !== "object") continue;
      if (typeof a.subject !== "string" || typeof a.predicate !== "string" || typeof a.object !== "string") continue;
      const key = assertion_key(a);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(a);
      const ts = String(a.observed_at || "").trim();
      if (ts) last_seen = iso_max(last_seen, ts);
    }

    set_items(deduped);
    set_warnings(meta?.warnings);
    seen_keys_ref.current = seen;
    last_seen_observed_at_ref.current = last_seen;
  }, []);

  const query_gateway = useCallback(
    async (params: {
      scope: MemoryScope;
      subject?: string;
      predicate?: string;
      object?: string;
      query_text?: string;
      min_score?: number;
      since?: string;
      until?: string;
      active_at?: string;
      order?: "asc" | "desc";
      limit?: number;
    }): Promise<KgQueryResult> => {
      const scope = normalize_scope(params.scope, "session");
      const subject = String(params.subject || "").trim();
      const predicate = String(params.predicate || "").trim();
      const object_value = String(params.object || "").trim();
      const since = String(params.since || "").trim();
      const until = String(params.until || "").trim();
      const active_at = String(params.active_at || "").trim();
      const query_text = String(params.query_text || "").trim();
      const min_score = typeof params.min_score === "number" && Number.isFinite(params.min_score) ? Number(params.min_score) : undefined;
      const order = params.order === "asc" ? "asc" : "desc";
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit) ? Number(params.limit) : 0;

      const rid = String(run_id_override || "").trim();
      const sid = String(session_id_override || "").trim();

      const req: any = {
        scope,
        all_owners: all_owners,
        limit,
        order,
      };
      if (subject) req.subject = subject;
      if (predicate) req.predicate = predicate;
      if (object_value) req.object = object_value;
      if (since) req.since = since;
      if (until) req.until = until;
      if (active_at) req.active_at = active_at;
      if (query_text) req.query_text = query_text;
      if (typeof min_score === "number") req.min_score = min_score;

      if (!all_owners) {
        if (scope === "run") {
          if (rid) req.run_id = rid;
        } else if (scope === "session") {
          if (sid) req.session_id = sid;
          else if (rid) req.run_id = rid;
        } else if (scope === "all") {
          if (rid) req.run_id = rid;
          else if (sid) req.session_id = sid;
        }
      }

      try {
        const raw = await gateway.kg_query(req);
        const items = Array.isArray(raw?.items) ? (raw.items as KgAssertion[]) : [];
        const warnings = raw?.warnings as JsonValue | undefined;
        return { ok: Boolean(raw?.ok !== false), count: Number(raw?.count || items.length), items, warnings, raw: raw as any };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const run_not_found = msg.includes("Run '") && msg.includes("not found");
        if (run_not_found && !sid && (scope === "session" || scope === "all") && rid) {
          const raw = await gateway.kg_query({ ...req, run_id: undefined, session_id: rid });
          const items = Array.isArray(raw?.items) ? (raw.items as KgAssertion[]) : [];
          const warnings = raw?.warnings as JsonValue | undefined;
          return { ok: Boolean(raw?.ok !== false), count: Number(raw?.count || items.length), items, warnings, raw: raw as any };
        }
        throw new Error(msg || "KG query failed");
      }
    },
    [all_owners, gateway, run_id_override, session_id_override]
  );

  const load_default = useCallback(async () => {
    set_error("");
    set_loading(true);
    try {
      const scope: MemoryScope = source === "all" ? "all" : source;
      const res = await query_gateway({ scope, limit: 0, order: "desc" });
      replace_items(res.items || [], { warnings: res.warnings });
      base_query_ref.current = { scope };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set_error(msg || "Load failed");
    } finally {
      set_loading(false);
    }
  }, [query_gateway, replace_items, source]);

  useEffect(() => {
    if (items.length) return;
    void load_default();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const on_query = useCallback(
    async (params: KgQueryParams): Promise<KgQueryResult> => {
      const scope = normalize_scope(params.scope, "session");
      last_query_params_ref.current = params;

      const res = await query_gateway({
        scope,
        subject: params.subject,
        predicate: params.predicate,
        object: params.object,
        query_text: params.query_text,
        min_score: params.min_score,
        since: params.since,
        until: params.until,
        active_at: params.active_at,
        limit: typeof params.limit === "number" ? params.limit : 0,
        order: "desc",
      });
      return res;
    },
    [query_gateway]
  );

  const on_items_replace = useCallback(
    (next_items: KgAssertion[], meta: { kind: "live query" | "expanded neighborhood"; result: KgQueryResult }) => {
      if (meta?.kind === "live query") {
        const p = last_query_params_ref.current;
        if (p) {
          base_query_ref.current = {
            scope: normalize_scope(p.scope, "session"),
            subject: typeof p.subject === "string" ? p.subject : undefined,
            predicate: typeof p.predicate === "string" ? p.predicate : undefined,
            object: typeof p.object === "string" ? p.object : undefined,
          };
        }
      }
      replace_items(next_items, { warnings: meta?.result?.warnings });
    },
    [replace_items]
  );

  const poll_once = useCallback(async () => {
    const base = base_query_ref.current;
    if (!base) return;
    const since = String(last_seen_observed_at_ref.current || "").trim();
    const res = await query_gateway({
      scope: base.scope,
      subject: base.subject,
      predicate: base.predicate,
      object: base.object,
      since: since || undefined,
      order: "asc",
      limit: 0,
    });
    const incoming = Array.isArray(res.items) ? res.items : [];
    if (!incoming.length) return;

    const now = Date.now();
    const expires_at = now + Math.max(250, Math.min(20_000, highlight_ms));

    const seen = seen_keys_ref.current;
    const fresh: KgAssertion[] = [];
    const recent_add: RecentAssertion[] = [];
    let last_seen = String(last_seen_observed_at_ref.current || "").trim();

    for (const a of incoming) {
      if (!a || typeof a !== "object") continue;
      if (typeof a.subject !== "string" || typeof a.predicate !== "string" || typeof a.object !== "string") continue;
      const key = assertion_key(a);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(a);
      recent_add.push({ id: key, assertion: a, expires_at_ms: expires_at });
      const ts = String(a.observed_at || "").trim();
      if (ts) last_seen = iso_max(last_seen, ts);
    }

    if (!fresh.length) return;

    last_seen_observed_at_ref.current = last_seen;
    set_items((prev) => {
      const merged = prev.concat(fresh);
      merged.sort((a, b) => String(b?.observed_at || "").localeCompare(String(a?.observed_at || "")));
      return merged;
    });
    set_recent((prev) => {
      const merged = prev.concat(recent_add);
      merged.sort((a, b) => b.expires_at_ms - a.expires_at_ms);
      return merged.slice(0, 30);
    });
  }, [highlight_ms, query_gateway]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        await poll_once();
      } catch {
        // Best-effort: mindmap observability must not be brittle.
      }
      if (cancelled) return;
      timer = window.setTimeout(() => void tick(), Math.max(250, Math.min(60_000, poll_ms)));
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [live, poll_ms, poll_once]);

  useEffect(() => {
    if (!recent.length) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      set_recent((prev) => prev.filter((x) => x.expires_at_ms > now));
    }, 250);
    return () => window.clearInterval(t);
  }, [recent.length]);

  return (
    <div className="mindmap_root">
      <div className="mindmap_bar">
        <button className="btn" onClick={() => void load_default()} disabled={loading}>
          {loading ? "Loading…" : "Load snapshot"}
        </button>
        <label className="field_inline">
          <span className="mono muted">source</span>
          <select
            value={source}
            onChange={(e) => {
              const next = String(e.target.value || "").trim() as any;
              if (next === "all" || next === "global" || next === "session" || next === "run") set_source(next);
            }}
          >
            <option value="all">all memory</option>
            <option value="global">global</option>
            <option value="session">session</option>
            <option value="run">run</option>
          </select>
        </label>
        <label className="field_inline">
          <span className="mono muted">live</span>
          <input type="checkbox" checked={live} onChange={(e) => set_live(Boolean(e.target.checked))} />
        </label>
        {source === "session" ? (
          <label className="field_inline">
            <span className="mono muted">session_id</span>
            <input
              className="mono"
              value={session_id_override}
              onChange={(e) => set_session_id_override(String(e.target.value || ""))}
              placeholder="(required)"
            />
          </label>
        ) : null}
        {source === "run" ? (
          <label className="field_inline">
            <span className="mono muted">run_id</span>
            <input className="mono" value={run_id_override} onChange={(e) => set_run_id_override(String(e.target.value || ""))} placeholder="(required)" />
          </label>
        ) : null}
        <details className="mindmap_details">
          <summary className="mono muted">advanced</summary>
          <div className="mindmap_advanced">
            <div className="field_inline">
              <span className="mono muted" style={{ width: 84 }}>
                poll_ms
              </span>
              <input
                type="number"
                min={250}
                max={60_000}
                step={50}
                value={poll_ms}
                onChange={(e) => set_poll_ms(Math.max(250, Number(e.target.value || 0) || 750))}
              />
              <span className="mono muted">highlight_ms</span>
              <input
                type="number"
                min={250}
                max={20_000}
                step={250}
                value={highlight_ms}
                onChange={(e) => set_highlight_ms(Math.max(250, Number(e.target.value || 0) || 2000))}
              />
            </div>
          </div>
        </details>
      </div>

      {error ? (
        <div className="mindmap_error mono">
          {error}
        </div>
      ) : null}

      {recent.length ? (
        <div className="mindmap_recent">
          <div className="mindmap_recent_title mono muted">new assertions</div>
          <div className="mindmap_recent_list">
            {recent
              .slice()
              .sort((a, b) => b.expires_at_ms - a.expires_at_ms)
              .slice(0, 12)
              .map((it) => (
                <div key={it.id} className="mindmap_recent_item mono">
                  {format_assertion_line(it.assertion)}
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {typeof time_bounds.min_ms === "number" && typeof time_bounds.max_ms === "number" ? (
        <div className="mindmap_timeline">
          <div className="field_inline" style={{ justifyContent: "space-between", width: "100%" }}>
            <div className="field_inline" style={{ gap: 8 }}>
              <span className="mono muted">time</span>
              <button
                className={`btn ${follow_latest ? "primary" : ""}`}
                onClick={() => {
                  set_follow_latest(true);
                  if (typeof time_bounds.max_ms === "number") set_time_cursor_ms(time_bounds.max_ms);
                }}
              >
                follow
              </button>
            </div>
            <div className="mono muted">
              {time_cursor_ms ? new Date(time_cursor_ms).toISOString() : "—"} · {filtered_items.length.toLocaleString()} / {items.length.toLocaleString()}
            </div>
          </div>
          <input
            className="mindmap_slider"
            type="range"
            min={time_bounds.min_ms}
            max={time_bounds.max_ms}
            step={1000}
            value={typeof time_cursor_ms === "number" ? time_cursor_ms : time_bounds.max_ms}
            onChange={(e) => {
              set_follow_latest(false);
              set_time_cursor_ms(Number(e.target.value || 0));
            }}
          />
        </div>
      ) : null}

      <div className="mindmap_explorer">
        <KgActiveMemoryExplorer
          title="mindmap"
          resetKey={reset_key}
          queryMode="replace"
          items={filtered_items}
          warnings={warnings}
          onQuery={on_query}
          onItemsReplace={on_items_replace}
        />
      </div>
    </div>
  );
}
