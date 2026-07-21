import { LedgerStreamEvent } from "./types";
import { SseParser } from "./sse_parser";

export type GatewayClientConfig = {
  base_url: string; // e.g. "http://localhost:8081" (no trailing slash) or "" for same-origin
  auth_token?: string;
};

// CI/CD development types (report inbox, email/triage, backlog + codex
// execution) moved to the abstractcontinuum repo (2026-07-12 split).

export type AttachmentRef = {
  $artifact: string;
  [k: string]: any;
};

export type AuditLogTailResponse = {
  bytes: number;
  truncated: boolean;
  content: string;
};

function _join(base_url: string, path: string): string {
  const base = (base_url || "").trim().replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path}`;
}

/** Default fetch deadline (30s), composable with a caller's abort signal.
 * Loops without deadlines wedge silently — the entity strip, discovery,
 * and subrun digest polls each froze forever on one stalled connection
 * (fable5 code adversary P2, 2026-07-13). */
function _deadline(caller?: AbortSignal, ms = 30_000): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!caller) return timeout;
  const any_fn = (AbortSignal as any).any;
  return typeof any_fn === "function" ? any_fn([caller, timeout]) : caller;
}

function _auth_headers(token?: string): Record<string, string> {
  const t = (token || "").trim();
  const out: Record<string, string> = {};
  if (t) out.Authorization = `Bearer ${t}`;
  try {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("abstractobserver_gateway_csrf="))
      ?.slice("abstractobserver_gateway_csrf=".length);
    if (csrf) out["X-AbstractObserver-CSRF"] = decodeURIComponent(csrf);
  } catch {
    // non-browser tests
  }
  return out;
}

async function _read_error(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text?.trim() ? text.trim() : `${resp.status}`;
  } catch {
    return `${resp.status}`;
  }
}

export class GatewayClient {
  private _cfg: GatewayClientConfig;

  constructor(cfg: GatewayClientConfig) {
    this._cfg = { ...cfg, base_url: (cfg.base_url || "").trim() };
  }

  async start_run(
    flow_id: string | null | undefined,
    input_data: Record<string, any>,
    opts?: { bundle_id?: string; session_id?: string | null }
  ): Promise<string> {
    const bundle_id = String(opts?.bundle_id || "").trim();
    const session_id = opts?.session_id === null || opts?.session_id === undefined ? "" : String(opts.session_id || "").trim();
    const fid = String(flow_id || "").trim();
    const req_body: any = { input_data: input_data || {} };
    if (bundle_id) req_body.bundle_id = bundle_id;
    if (fid) req_body.flow_id = fid;
    if (session_id) req_body.session_id = session_id;
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/runs/start"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(req_body),
    });
    if (!r.ok) throw new Error(`start_run failed: ${r.status}`);
    const body = await r.json();
    const run_id = body?.run_id;
    if (typeof run_id !== "string" || !run_id) throw new Error("start_run: missing run_id");
    return run_id;
  }

  async schedule_run(args: {
    bundle_id: string;
    flow_id: string;
    input_data: Record<string, any>;
    start_at?: string | null;
    interval?: string | null;
    repeat_count?: number | null;
    repeat_until?: string | null;
    share_context?: boolean | null;
    session_id?: string | null;
  }): Promise<string> {
    const bundle_id = String(args?.bundle_id || "").trim();
    const flow_id = String(args?.flow_id || "").trim();
    if (!bundle_id) throw new Error("schedule_run: bundle_id is required");
    if (!flow_id) throw new Error("schedule_run: flow_id is required");
    const req_body: any = {
      bundle_id,
      flow_id,
      input_data: args?.input_data || {},
    };
    const start_at = args?.start_at === null || args?.start_at === undefined ? "" : String(args.start_at || "").trim();
    if (start_at) req_body.start_at = start_at;
    const interval = args?.interval === null || args?.interval === undefined ? "" : String(args.interval || "").trim();
    if (interval) req_body.interval = interval;
    if (typeof args?.repeat_count === "number" && Number.isFinite(args.repeat_count)) req_body.repeat_count = Number(args.repeat_count);
    const repeat_until = args?.repeat_until === null || args?.repeat_until === undefined ? "" : String(args.repeat_until || "").trim();
    if (repeat_until) req_body.repeat_until = repeat_until;
    if (typeof args?.share_context === "boolean") req_body.share_context = Boolean(args.share_context);
    const session_id = args?.session_id === null || args?.session_id === undefined ? "" : String(args.session_id || "").trim();
    if (session_id) req_body.session_id = session_id;

    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/runs/schedule"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(req_body),
    });
    if (!r.ok) throw new Error(`schedule_run failed: ${r.status}`);
    const body = await r.json();
    const run_id = body?.run_id;
    if (typeof run_id !== "string" || !run_id) throw new Error("schedule_run: missing run_id");
    return run_id;
  }

  /** Feature-detected MCP server inventory. Returns null when the gateway
   * does not serve one yet — callers render the honest absent state.
   * v1 is a DECLARED registry (gateway c2243: probed:false by design —
   * no faked connect state; tool_count arrives with the probe lane). */
  async list_mcp_servers(): Promise<Array<{ name: string; url?: string; description?: string; auth_required?: boolean }> | null> {
    for (const path of ["/api/gateway/mcp/servers", "/api/gateway/mcp", "/api/gateway/discovery/mcp"]) {
      try {
        const r = await fetch(_join(this._cfg.base_url, path), {
          headers: { ..._auth_headers(this._cfg.auth_token) },
          signal: _deadline(),
        });
        if (r.status === 404) continue;
        if (!r.ok) continue;
        const body = await r.json();
        const items = Array.isArray(body) ? body : Array.isArray(body?.servers) ? body.servers : Array.isArray(body?.items) ? body.items : null;
        if (!items) continue;
        return items
          .map((x: any) => ({
            name: String(x?.name || x?.id || "").trim(),
            url: typeof x?.url === "string" ? x.url : undefined,
            description: typeof x?.description === "string" ? x.description : undefined,
            auth_required: typeof x?.auth_required === "boolean" ? x.auth_required : undefined,
          }))
          .filter((x: any) => x.name);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Feature-detected skills inventory (the abstractskill shelf served by
   * the gateway). Returns null when the gateway does not serve it yet —
   * callers render the honest absent state, never a fabricated list.
   * Shape adopted from the gateway's ruled roster row (c2243): trust
   * verdicts ride each skill — pickers must respect `blocked` and may
   * surface `trust_level`/`requires_review`. */
  async list_skills(): Promise<Array<{
    name: string;
    description?: string;
    version?: string;
    trust_level?: string;
    blocked?: boolean;
    requires_review?: boolean;
    tree_hash?: string;
    reasons?: string[];
  }> | null> {
    for (const path of ["/api/gateway/skills", "/api/gateway/skills/registry"]) {
      try {
        const r = await fetch(_join(this._cfg.base_url, path), {
          headers: { ..._auth_headers(this._cfg.auth_token) },
          signal: _deadline(),
        });
        if (r.status === 404) continue;
        if (!r.ok) continue;
        const body = await r.json();
        const items = Array.isArray(body) ? body : Array.isArray(body?.skills) ? body.skills : Array.isArray(body?.items) ? body.items : null;
        if (!items) continue;
        return items
          .map((x: any) => ({
            name: String(x?.name || x?.id || "").trim(),
            description: typeof x?.description === "string" ? x.description : undefined,
            version: typeof x?.version === "string" ? x.version : undefined,
            trust_level: typeof x?.trust_level === "string" ? x.trust_level : undefined,
            blocked: typeof x?.blocked === "boolean" ? x.blocked : undefined,
            requires_review: typeof x?.requires_review === "boolean" ? x.requires_review : undefined,
            tree_hash: typeof x?.tree_hash === "string" ? x.tree_hash : undefined,
            reasons: Array.isArray(x?.reasons) ? x.reasons.map((r: any) => String(r || "")).filter(Boolean) : undefined,
          }))
          .filter((x: any) => x.name);
      } catch {
        return null;
      }
    }
    return null;
  }

  async get_run(run_id: string): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(run_id)}`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`get_run failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async get_run_history_bundle(
    run_id: string,
    opts?: {
      include_subruns?: boolean;
      include_session?: boolean;
      session_turn_limit?: number;
      ledger_mode?: "tail" | "full";
      ledger_max_items?: number;
    }
  ): Promise<any> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("get_run_history_bundle: run_id is required");
    const qs = new URLSearchParams();
    if (opts?.include_subruns === false) qs.set("include_subruns", "false");
    if (opts?.include_session === true) qs.set("include_session", "true");
    if (typeof opts?.session_turn_limit === "number" && Number.isFinite(opts.session_turn_limit)) qs.set("session_turn_limit", String(Math.max(1, Math.trunc(opts.session_turn_limit))));
    if (opts?.ledger_mode) qs.set("ledger_mode", String(opts.ledger_mode));
    if (typeof opts?.ledger_max_items === "number" && Number.isFinite(opts.ledger_max_items)) qs.set("ledger_max_items", String(Math.max(0, Math.trunc(opts.ledger_max_items))));
    const url = _join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/history_bundle?${qs.toString()}`);
    const r = await fetch(url, { headers: { ..._auth_headers(this._cfg.auth_token) } });
    if (!r.ok) throw new Error(`get_run_history_bundle failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_runs(opts?: {
    limit?: number;
    status?: string;
    workflow_id?: string;
    session_id?: string;
    root_only?: boolean;
    include_ledger_len?: boolean;
    include_metrics?: boolean;
    include_drafts?: boolean;
  }): Promise<any> {
    const limit = typeof opts?.limit === "number" ? opts.limit : 50;
    const status = String(opts?.status || "").trim();
    const workflow_id = String(opts?.workflow_id || "").trim();
    const session_id = String(opts?.session_id || "").trim();
    const root_only = opts?.root_only === true;
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (status) qs.set("status", status);
    if (workflow_id) qs.set("workflow_id", workflow_id);
    if (session_id) qs.set("session_id", session_id);
    if (root_only) qs.set("root_only", "true");
    if (typeof opts?.include_ledger_len === "boolean") qs.set("include_ledger_len", String(opts.include_ledger_len));
    if (typeof opts?.include_metrics === "boolean") qs.set("include_metrics", String(opts.include_metrics));
    if (typeof opts?.include_drafts === "boolean") qs.set("include_drafts", String(opts.include_drafts));
    const url = _join(this._cfg.base_url, `/api/gateway/runs?${qs.toString()}`);
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
      // The board's poll loop rides this call — a stalled-open connection
      // without a deadline wedges the whole poll chain (runs_loading stays
      // true, Refresh stays disabled). 30s is 4× the worst measured server
      // time (2026-07-13).
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`list_runs failed: ${await _read_error(r)}`);
    return await r.json();
  }









  async audit_log_tail(opts?: { max_bytes?: number }): Promise<AuditLogTailResponse> {
    const max_bytes = typeof opts?.max_bytes === "number" ? Math.max(1024, Math.min(400000, Math.floor(opts.max_bytes))) : 80000;
    const url = _join(this._cfg.base_url, `/api/gateway/audit/tail?max_bytes=${encodeURIComponent(String(max_bytes))}`);
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`audit_log_tail failed: ${await _read_error(r)}`);
    return (await r.json()) as AuditLogTailResponse;
  }

  async get_run_input_data(run_id: string): Promise<any> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("get_run_input_data: run_id is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/input_data`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`get_run_input_data failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_run_artifacts(run_id: string, opts?: { limit?: number; offset?: number }): Promise<any> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("list_run_artifacts: run_id is required");
    const limit = typeof opts?.limit === "number" ? opts.limit : 200;
    const offset = typeof opts?.offset === "number" ? Math.max(0, Math.floor(opts.offset)) : 0;
    const url = _join(
      this._cfg.base_url,
      `/api/gateway/runs/${encodeURIComponent(rid)}/artifacts?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
    );
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`list_run_artifacts failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_session_artifacts(session_id: string, opts?: { limit?: number; offset?: number }): Promise<any> {
    const sid = String(session_id || "").trim();
    if (!sid) throw new Error("list_session_artifacts: session_id is required");
    const limit = typeof opts?.limit === "number" ? opts.limit : 200;
    const offset = typeof opts?.offset === "number" ? Math.max(0, Math.floor(opts.offset)) : 0;
    const url = _join(
      this._cfg.base_url,
      `/api/gateway/sessions/${encodeURIComponent(sid)}/artifacts?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
    );
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`list_session_artifacts failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async search_artifacts(opts?: {
    scope?: "all" | "session" | "run" | string;
    session_id?: string | null;
    run_id?: string | null;
    modality?: string | null;
    artifact_kind?: string | null;
    semantic_kind?: string | null;
    render_kind?: string | null;
    workflow_id?: string | null;
    node_id?: string | null;
    content_type?: string | null;
    query?: string | null;
    tags?: string | null;
    limit?: number;
    offset?: number;
    cursor?: string | null;
    order_by?: string | null;
    order?: string | null;
    created_after?: string | null;
    created_before?: string | null;
    include_stats?: boolean;
  }): Promise<any> {
    const params = new URLSearchParams();
    params.set("scope", String(opts?.scope || "all").trim() || "all");
    const session_id = String(opts?.session_id || "").trim();
    const run_id = String(opts?.run_id || "").trim();
    const modality = String(opts?.modality || "").trim();
    const artifact_kind = String(opts?.artifact_kind || "").trim();
    const semantic_kind = String(opts?.semantic_kind || "").trim();
    const render_kind = String(opts?.render_kind || "").trim();
    const workflow_id = String(opts?.workflow_id || "").trim();
    const node_id = String(opts?.node_id || "").trim();
    const content_type = String(opts?.content_type || "").trim();
    const query = String(opts?.query || "").trim();
    const tags = String(opts?.tags || "").trim();
    const cursor = String(opts?.cursor || "").trim();
    const order_by = String(opts?.order_by || "").trim();
    const order = String(opts?.order || "").trim();
    const created_after = String(opts?.created_after || "").trim();
    const created_before = String(opts?.created_before || "").trim();
    const limit = typeof opts?.limit === "number" ? opts.limit : 500;
    const offset = typeof opts?.offset === "number" ? Math.max(0, Math.floor(opts.offset)) : 0;
    if (session_id) params.set("session_id", session_id);
    if (run_id) params.set("run_id", run_id);
    if (modality) params.set("modality", modality);
    if (artifact_kind) params.set("artifact_kind", artifact_kind);
    if (semantic_kind) params.set("semantic_kind", semantic_kind);
    if (render_kind) params.set("render_kind", render_kind);
    if (workflow_id) params.set("workflow_id", workflow_id);
    if (node_id) params.set("node_id", node_id);
    if (content_type) params.set("content_type", content_type);
    if (query) params.set("query", query);
    if (tags) params.set("tags", tags);
    if (cursor) params.set("cursor", cursor);
    if (order_by) params.set("order_by", order_by);
    if (order) params.set("order", order);
    if (created_after) params.set("created_after", created_after);
    if (created_before) params.set("created_before", created_before);
    if (opts?.include_stats) params.set("include_stats", "true");
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/artifacts/search?${params.toString()}`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`search_artifacts failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async artifact_stats(opts?: {
    scope?: "all" | "session" | "run" | string;
    session_id?: string | null;
    run_id?: string | null;
    modality?: string | null;
    semantic_kind?: string | null;
    render_kind?: string | null;
    workflow_id?: string | null;
    node_id?: string | null;
    content_type?: string | null;
    query?: string | null;
    tags?: string | null;
    created_after?: string | null;
    created_before?: string | null;
  }): Promise<any> {
    const params = new URLSearchParams();
    params.set("scope", String(opts?.scope || "all").trim() || "all");
    for (const key of ["session_id", "run_id", "modality", "semantic_kind", "render_kind", "workflow_id", "node_id", "content_type", "query", "tags", "created_after", "created_before"] as const) {
      const value = String(opts?.[key] || "").trim();
      if (value) params.set(key, value);
    }
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/artifacts/stats?${params.toString()}`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`artifact_stats failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async download_run_artifact_content(run_id: string, artifact_id: string, opts?: { access?: "content" | "preview" | "download" | string }): Promise<Blob> {
    const rid = String(run_id || "").trim();
    const aid = String(artifact_id || "").trim();
    if (!rid) throw new Error("download_run_artifact_content: run_id is required");
    if (!aid) throw new Error("download_run_artifact_content: artifact_id is required");
    const access = String(opts?.access || "").trim();
    const qs = access ? `?access=${encodeURIComponent(access)}` : "";
    const url = _join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/artifacts/${encodeURIComponent(aid)}/content${qs}`);
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`download_run_artifact_content failed: ${await _read_error(r)}`);
    return await r.blob();
  }

  // --- Entity observation reads (the entity app owns the deep surfaces;
  // these two power the main app's fleet/board view: roster + the cheap
  // per-entity card — never whole-life replay folds from this client).
  async list_entities(): Promise<{ entities: any[] }> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/entities"), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
      signal: _deadline(),
    });
    if (!r.ok) throw new Error(`list_entities failed: ${await _read_error(r)}`);
    const body = await r.json();
    return { entities: Array.isArray(body?.entities) ? body.entities : [] };
  }

  /** THE one entity phase graph (laurent dm#79 one-graph ruling, c3594):
   * gateway vendors entity's spec/entity_phases.json and serves
   * {spec, vendored, sha256, source}. Every client derives its phase
   * vocabulary from THIS wire payload — sync-by-mechanism, never
   * sync-by-vigilance. 404/401 on pre-wire gateways; callers keep their
   * labeled pre-wire fallback. */
  async get_entity_phases_spec(): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/entities/spec/phases`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
      signal: _deadline(),
    });
    if (!r.ok) throw new Error(`get_entity_phases_spec failed: ${await _read_error(r)}`);
    return await r.json();
  }

  /** B3 cognition wire (gateway c1390): working truth + billed spend for
   * one entity — {working, loop, visit, spend:{lifetime,live_visit,source},
   * warnings[]}. 404 on pre-wire gateways; callers degrade to heuristics. */
  async get_entity_cognition(name: string): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/entities/${encodeURIComponent(name)}/cognition`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
      signal: _deadline(),
    });
    if (!r.ok) throw new Error(`get_entity_cognition failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async get_entity_card(name: string): Promise<any> {
    const n = String(name || "").trim();
    if (!n) throw new Error("get_entity_card: name is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/entities/${encodeURIComponent(n)}/card`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
      signal: _deadline(),
    });
    if (!r.ok) throw new Error(`get_entity_card failed: ${await _read_error(r)}`);
    return await r.json();
  }

  /** Operator diary door (a2a 0007 + the 2026-07-08 no-ceremony ruling):
   * serves one book entry — private included — and the read is MARKER-FIRST:
   * a diary_read event lands in the entity's replay stream BEFORE the words
   * return. Callers surface that fact; they never hide it. Returns
   * {entry, read_recorded_at_seq, reason}. */
  async read_entity_diary_entry(name: string, entry_id: string): Promise<any> {
    const n = String(name || "").trim();
    const e = String(entry_id || "").trim();
    if (!n || !e) throw new Error("read_entity_diary_entry: name and entry_id are required");
    const url = _join(
      this._cfg.base_url,
      `/api/gateway/entities/${encodeURIComponent(n)}/diary/${encodeURIComponent(e)}?reason=${encodeURIComponent("observer board hint chip")}`,
    );
    const r = await fetch(url, { headers: { ..._auth_headers(this._cfg.auth_token) }, signal: _deadline() });
    if (!r.ok) throw new Error(`read_entity_diary_entry failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async get_ledger(
    run_id: string,
    opts: { after: number; limit: number; signal?: AbortSignal },
  ): Promise<{ items: any[]; next_after: number }> {
    const after = Number(opts?.after || 0);
    const limit = Number(opts?.limit || 0);
    const url = _join(
      this._cfg.base_url,
      `/api/gateway/runs/${encodeURIComponent(run_id)}/ledger?after=${encodeURIComponent(String(after))}&limit=${encodeURIComponent(
        String(limit)
      )}`
    );
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
      // Caller signal (attach abort) + deadline: replay paging was the one
      // loop that could neither be cancelled nor time out (fable5 P0).
      signal: _deadline(opts?.signal),
    });
    if (!r.ok) throw new Error(`get_ledger failed: ${r.status}`);
    const body = await r.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const next_after = typeof body?.next_after === "number" ? body.next_after : after;
    return { items, next_after };
  }

  async get_ledger_batch(opts: {
    runs: Array<{ run_id: string; after: number }>;
    limit: number;
  }): Promise<{ runs: Record<string, { items: any[]; next_after: number }> }> {
    const runs = Array.isArray(opts?.runs) ? opts.runs : [];
    const limit = Number(opts?.limit || 0);
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/runs/ledger/batch"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify({ runs, limit }),
      signal: _deadline(),
    });
    if (!r.ok) throw new Error(`get_ledger_batch failed: ${r.status}`);
    const body = await r.json();
    const out = body && typeof body === "object" ? body : {};
    const m = (out as any).runs;
    return { runs: m && typeof m === "object" ? (m as any) : {} };
  }

  async generate_run_summary(
    run_id: string,
    opts?: { provider?: string; model?: string; include_subruns?: boolean }
  ): Promise<{ ok: boolean; run_id: string; provider: string; model: string; generated_at: string; summary: string }> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("generate_run_summary: run_id is required");
    const body: any = { include_subruns: opts?.include_subruns !== false };
    const provider = typeof opts?.provider === "string" ? String(opts.provider).trim() : "";
    if (provider) body.provider = provider;
    const model = typeof opts?.model === "string" ? String(opts.model).trim() : "";
    if (model) body.model = model;
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/summary`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`generate_run_summary failed: ${r.status}`);
    return await r.json();
  }

  async run_chat(
    run_id: string,
    opts: { provider?: string; model?: string; include_subruns?: boolean; messages: Array<{ role: string; content: string }>; persist?: boolean }
  ): Promise<{ ok: boolean; run_id: string; provider: string; model: string; generated_at: string; answer: string }> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("run_chat: run_id is required");
    const body: any = {
      include_subruns: opts?.include_subruns !== false,
      messages: Array.isArray(opts?.messages) ? opts.messages : [],
      persist: Boolean(opts?.persist),
    };
    const provider = typeof opts?.provider === "string" ? String(opts.provider).trim() : "";
    if (provider) body.provider = provider;
    const model = typeof opts?.model === "string" ? String(opts.model).trim() : "";
    if (model) body.model = model;
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/chat`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`run_chat failed: ${r.status}`);
    return await r.json();
  }

  async audio_transcribe(
    run_id: string,
    req: {
      audio_artifact: AttachmentRef;
      language?: string;
      request_id?: string;
    }
  ): Promise<{ ok: boolean; run_id: string; request_id: string; text: string; transcript_artifact: any }> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("audio_transcribe: run_id is required");
    const audio_artifact = req?.audio_artifact;
    if (!audio_artifact || typeof audio_artifact !== "object") throw new Error("audio_transcribe: audio_artifact is required");
    const aid = String((audio_artifact as any).$artifact || "").trim();
    if (!aid) throw new Error("audio_transcribe: audio_artifact.$artifact is required");

    const body: any = { audio_artifact };
    const lang = String(req?.language || "").trim();
    if (lang) body.language = lang;
    const req_id = String(req?.request_id || "").trim();
    if (req_id) body.request_id = req_id;

    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/audio/transcribe`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`audio_transcribe failed: ${await _read_error(r)}`);
    const out: any = await r.json();
    const text = String(out?.text || "");
    return {
      ok: Boolean(out?.ok),
      run_id: String(out?.run_id || ""),
      request_id: String(out?.request_id || ""),
      text,
      transcript_artifact: out?.transcript_artifact,
    };
  }

  async voice_tts(
    run_id: string,
    req: {
      text: string;
      voice?: string;
      format?: string;
      request_id?: string;
    }
  ): Promise<{ ok: boolean; run_id: string; request_id: string; audio_artifact: any }> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("voice_tts: run_id is required");
    const text = String(req?.text || "").trim();
    if (!text) throw new Error("voice_tts: text is required");

    const body: any = { text };
    const voice = String(req?.voice || "").trim();
    if (voice) body.voice = voice;
    const fmt = String(req?.format || "").trim();
    if (fmt) body.format = fmt;
    const req_id = String(req?.request_id || "").trim();
    if (req_id) body.request_id = req_id;

    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/voice/tts`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`voice_tts failed: ${await _read_error(r)}`);
    const out: any = await r.json();
    return {
      ok: Boolean(out?.ok),
      run_id: String(out?.run_id || ""),
      request_id: String(out?.request_id || ""),
      audio_artifact: out?.audio_artifact,
    };
  }

  async save_chat_thread(
    run_id: string,
    opts: {
      provider?: string;
      model?: string;
      include_subruns?: boolean;
      title?: string;
      messages: Array<{ role: string; content: string; ts?: string }>;
    }
  ): Promise<{
    ok: boolean;
    run_id: string;
    workflow_id: string;
    thread_id: string;
    created_at: string;
    duplicate: boolean;
    title?: string | null;
    message_count: number;
    chat_artifact: { $artifact: string };
  }> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("save_chat_thread: run_id is required");
    const body: any = {
      include_subruns: opts?.include_subruns !== false,
      messages: Array.isArray(opts?.messages) ? opts.messages : [],
    };
    const provider = typeof opts?.provider === "string" ? String(opts.provider).trim() : "";
    if (provider) body.provider = provider;
    const model = typeof opts?.model === "string" ? String(opts.model).trim() : "";
    if (model) body.model = model;
    const title = typeof opts?.title === "string" ? String(opts.title).trim() : "";
    if (title) body.title = title;
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/chat_threads`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`save_chat_thread failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_bundles(): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/bundles"), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
      // Discovery rides this call — a hang left discovery_loading true
      // forever (Reload/Upload disabled, "Connecting…" persisting).
      signal: _deadline(),
    });
    if (!r.ok) throw new Error(`list_bundles failed: ${r.status}`);
    return await r.json();
  }

  async reload_bundles(): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/bundles/reload"), {
      method: "POST",
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`reload_bundles failed: ${r.status}`);
    return await r.json();
  }

  async upload_bundle(file: File, opts?: { overwrite?: boolean; reload?: boolean }): Promise<any> {
    const overwrite = opts?.overwrite === true;
    const reload = opts?.reload !== false;
    const fd = new FormData();
    fd.set("overwrite", overwrite ? "true" : "false");
    fd.set("reload", reload ? "true" : "false");
    fd.set("file", file, file.name || "upload.flow");
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/bundles/upload"), {
      method: "POST",
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
      body: fd,
    });
    if (!r.ok) throw new Error(`upload_bundle failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async attachments_upload(
    session_id: string,
    file: File,
    opts?: {
      filename?: string;
      content_type?: string;
    }
  ): Promise<AttachmentRef> {
    const sid = String(session_id || "").trim();
    if (!sid) throw new Error("attachments_upload: session_id is required");
    if (!file) throw new Error("attachments_upload: file is required");

    const filename = String(opts?.filename || "").trim() || String((file as any)?.name || "").trim() || "upload.bin";
    const content_type = String(opts?.content_type || "").trim() || String((file as any)?.type || "").trim();

    const form = new FormData();
    form.append("session_id", sid);
    form.append("file", file, filename);
    if (filename) form.append("filename", filename);
    if (content_type) form.append("content_type", content_type);

    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/attachments/upload"), {
      method: "POST",
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
      body: form,
    });
    if (!r.ok) throw new Error(`attachments_upload failed: ${await _read_error(r)}`);
    const body = await r.json();
    const attachment = body?.attachment;
    if (!attachment || typeof attachment !== "object") throw new Error("attachments_upload: missing attachment");
    const aid = String((attachment as any).$artifact || "").trim();
    if (!aid) throw new Error("attachments_upload: missing attachment.$artifact");
    return attachment as AttachmentRef;
  }

  async remove_bundle(bundle_id: string, opts?: { bundle_version?: string; reload?: boolean }): Promise<any> {
    const bid = String(bundle_id || "").trim();
    if (!bid) throw new Error("remove_bundle: bundle_id is required");
    const qs = new URLSearchParams();
    const ver = String(opts?.bundle_version || "").trim();
    if (ver) qs.set("bundle_version", ver);
    qs.set("reload", opts?.reload === false ? "false" : "true");
    const url = _join(this._cfg.base_url, `/api/gateway/bundles/${encodeURIComponent(bid)}?${qs.toString()}`);
    const r = await fetch(url, { method: "DELETE", headers: { ..._auth_headers(this._cfg.auth_token) } });
    if (!r.ok) throw new Error(`remove_bundle failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async discovery_tools(): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/discovery/tools"), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`discovery_tools failed: ${r.status}`);
    return await r.json();
  }

  async discovery_providers(opts?: { include_models?: boolean }): Promise<any> {
    const include_models = opts?.include_models === true;
    const url = _join(this._cfg.base_url, `/api/gateway/discovery/providers?include_models=${encodeURIComponent(String(include_models))}`);
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`discovery_providers failed: ${r.status}`);
    return await r.json();
  }

  async discovery_provider_models(provider_name: string): Promise<any> {
    const prov = String(provider_name || "").trim();
    if (!prov) throw new Error("discovery_provider_models: provider_name is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/discovery/providers/${encodeURIComponent(prov)}/models`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`discovery_provider_models failed: ${r.status}`);
    return await r.json();
  }

  async get_bundle(bundle_id: string): Promise<any> {
    const bid = String(bundle_id || "").trim();
    if (!bid) throw new Error("get_bundle: bundle_id is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/bundles/${encodeURIComponent(bid)}`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`get_bundle failed: ${r.status}`);
    return await r.json();
  }

  async get_bundle_flow(bundle_id: string, flow_id: string): Promise<any> {
    const bid = String(bundle_id || "").trim();
    const fid = String(flow_id || "").trim();
    if (!bid) throw new Error("get_bundle_flow: bundle_id is required");
    if (!fid) throw new Error("get_bundle_flow: flow_id is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/bundles/${encodeURIComponent(bid)}/flows/${encodeURIComponent(fid)}`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`get_bundle_flow failed: ${r.status}`);
    return await r.json();
  }

  async get_workflow_flow(workflow_id: string): Promise<any> {
    const wid = String(workflow_id || "").trim();
    if (!wid) throw new Error("get_workflow_flow: workflow_id is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/workflows/${encodeURIComponent(wid)}/flow`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`get_workflow_flow failed: ${r.status}`);
    return await r.json();
  }

  async submit_command(command: {
    command_id: string;
    run_id: string;
    type: string;
    payload: any;
    client_id?: string;
  }): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/commands"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(command),
    });
    if (!r.ok) throw new Error(`submit_command failed: ${r.status}`);
    return await r.json();
  }

  async kg_query(opts: {
    run_id?: string | null;
    session_id?: string | null;
    scope?: string | null;
    owner_id?: string | null;
    all_owners?: boolean | null;
    subject?: string | null;
    predicate?: string | null;
    object?: string | null;
    since?: string | null;
    until?: string | null;
    active_at?: string | null;
    query_text?: string | null;
    min_score?: number | null;
    limit?: number | null;
    order?: string | null;
  }): Promise<any> {
    const scope = String(opts?.scope || "session")
      .trim()
      .toLowerCase();
    const order = String(opts?.order || "desc")
      .trim()
      .toLowerCase();
    const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? Number(opts.limit) : 500;

    const req_body: any = { scope, order, limit };

    const run_id = String(opts?.run_id || "").trim();
    if (run_id) req_body.run_id = run_id;
    const session_id = String(opts?.session_id || "").trim();
    if (session_id) req_body.session_id = session_id;
    const owner_id = String(opts?.owner_id || "").trim();
    if (owner_id) req_body.owner_id = owner_id;
    if (opts?.all_owners) req_body.all_owners = true;

    const subject = String(opts?.subject || "").trim();
    if (subject) req_body.subject = subject;
    const predicate = String(opts?.predicate || "").trim();
    if (predicate) req_body.predicate = predicate;
    const object = String(opts?.object || "").trim();
    if (object) req_body.object = object;
    const since = String(opts?.since || "").trim();
    if (since) req_body.since = since;
    const until = String(opts?.until || "").trim();
    if (until) req_body.until = until;
    const active_at = String(opts?.active_at || "").trim();
    if (active_at) req_body.active_at = active_at;
    const query_text = String(opts?.query_text || "").trim();
    if (query_text) req_body.query_text = query_text;
    if (typeof opts?.min_score === "number" && Number.isFinite(opts.min_score)) req_body.min_score = Number(opts.min_score);

    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/kg/query"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(req_body),
    });
    if (!r.ok) throw new Error(`kg_query failed: ${await _read_error(r)}`);
    return await r.json();
  }

  // ------------------------------------------------------------------
  // CI/CD development methods (report inbox, email/triage, backlog CRUD
  // + codex execution pipeline) moved to the abstractcontinuum repo
  // (2026-07-12 split). The continuum app carries its own client copy.
  // ------------------------------------------------------------------

  async stream_ledger(
    run_id: string,
    opts: { after: number; on_step: (ev: LedgerStreamEvent) => void; signal?: AbortSignal }
  ): Promise<void> {
    const after = Number(opts?.after || 0);
    const on_step = opts.on_step;
    const signal = opts.signal;
    const url = _join(
      this._cfg.base_url,
      `/api/gateway/runs/${encodeURIComponent(run_id)}/ledger/stream?after=${encodeURIComponent(String(after))}`
    );
    const r = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        ..._auth_headers(this._cfg.auth_token),
      },
      signal,
    });
    if (!r.ok) throw new Error(`stream_ledger failed: ${r.status}`);
    if (!r.body) throw new Error("stream_ledger: response body is missing");

    const reader = r.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = new SseParser();

    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      const text = decoder.decode(value, { stream: true });
      parser.push(text, (ev) => {
        if (ev.event !== "step" || !ev.data) return;
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed && typeof parsed.cursor === "number" && parsed.record) {
            on_step(parsed as LedgerStreamEvent);
          }
        } catch {
          // Ignore malformed lines (best-effort).
        }
      });
    }
  }
}
