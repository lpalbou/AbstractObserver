import { LedgerStreamEvent } from "./types";
import { SseParser } from "./sse_parser";

export type GatewayClientConfig = {
  base_url: string; // e.g. "http://localhost:8080" (no trailing slash) or "" for same-origin
  auth_token?: string;
};

export type ReportInboxItem = {
  report_type: "bug" | "feature";
  filename: string;
  relpath: string;
  title: string;
  created_at?: string;
  session_id?: string;
  workflow_id?: string;
  active_run_id?: string;
  decision_id?: string;
  triage_status?: string;
};

export type ReportInboxListResponse = { items: ReportInboxItem[] };

export type ReportContentResponse = {
  report_type: "bug" | "feature";
  filename: string;
  relpath: string;
  content: string;
};

export type TriageDecisionSummary = {
  decision_id: string;
  report_type: "bug" | "feature";
  report_relpath: string;
  status: "pending" | "approved" | "deferred" | "rejected" | string;
  created_at?: string;
  updated_at?: string;
  defer_until?: string;
  missing_fields?: string[];
  duplicates?: Array<{ kind?: string; ref?: string; score?: number; title?: string }>;
  draft_relpath?: string;
};

export type TriageDecisionListResponse = { decisions: TriageDecisionSummary[] };

export type TriageRunResponse = {
  ok: boolean;
  reports: number;
  updated_decisions: number;
  decisions_dir: string;
  drafts_written: string[];
};

export type BacklogItemSummary = {
  kind: "planned" | "completed" | "proposed" | "recurrent";
  filename: string;
  item_id: number;
  package: string;
  title: string;
  summary?: string;
  parsed?: boolean;
};

export type BacklogListResponse = { items: BacklogItemSummary[] };

export type BacklogContentResponse = { kind: string; filename: string; content: string };

function _join(base_url: string, path: string): string {
  const base = (base_url || "").trim().replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path}`;
}

function _auth_headers(token?: string): Record<string, string> {
  const t = (token || "").trim();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
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

  async get_run(run_id: string): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(run_id)}`), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`get_run failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_runs(opts?: { limit?: number; status?: string; workflow_id?: string; session_id?: string; root_only?: boolean }): Promise<any> {
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
    const url = _join(this._cfg.base_url, `/api/gateway/runs?${qs.toString()}`);
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`list_runs failed: ${await _read_error(r)}`);
    return await r.json();
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

  async list_run_artifacts(run_id: string, opts?: { limit?: number }): Promise<any> {
    const rid = String(run_id || "").trim();
    if (!rid) throw new Error("list_run_artifacts: run_id is required");
    const limit = typeof opts?.limit === "number" ? opts.limit : 200;
    const url = _join(
      this._cfg.base_url,
      `/api/gateway/runs/${encodeURIComponent(rid)}/artifacts?limit=${encodeURIComponent(String(limit))}`
    );
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`list_run_artifacts failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async download_run_artifact_content(run_id: string, artifact_id: string): Promise<Blob> {
    const rid = String(run_id || "").trim();
    const aid = String(artifact_id || "").trim();
    if (!rid) throw new Error("download_run_artifact_content: run_id is required");
    if (!aid) throw new Error("download_run_artifact_content: artifact_id is required");
    const url = _join(this._cfg.base_url, `/api/gateway/runs/${encodeURIComponent(rid)}/artifacts/${encodeURIComponent(aid)}/content`);
    const r = await fetch(url, {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
    });
    if (!r.ok) throw new Error(`download_run_artifact_content failed: ${await _read_error(r)}`);
    return await r.blob();
  }

  async get_ledger(run_id: string, opts: { after: number; limit: number }): Promise<{ items: any[]; next_after: number }> {
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
    const body: any = {
      provider: String(opts?.provider || "lmstudio"),
      model: String(opts?.model || "qwen/qwen3-next-80b"),
      include_subruns: opts?.include_subruns !== false,
    };
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
      provider: String(opts?.provider || "lmstudio"),
      model: String(opts?.model || "qwen/qwen3-next-80b"),
      include_subruns: opts?.include_subruns !== false,
      messages: Array.isArray(opts?.messages) ? opts.messages : [],
      persist: Boolean(opts?.persist),
    };
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

  async list_bundles(): Promise<any> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/bundles"), {
      headers: {
        ..._auth_headers(this._cfg.auth_token),
      },
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

  async list_bug_reports(): Promise<ReportInboxListResponse> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/reports/bugs"), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
    });
    if (!r.ok) throw new Error(`list_bug_reports failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_feature_requests(): Promise<ReportInboxListResponse> {
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/reports/features"), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
    });
    if (!r.ok) throw new Error(`list_feature_requests failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async get_bug_report_content(filename: string): Promise<ReportContentResponse> {
    const name = String(filename || "").trim();
    if (!name) throw new Error("get_bug_report_content: filename is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/reports/bugs/${encodeURIComponent(name)}/content`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
    });
    if (!r.ok) throw new Error(`get_bug_report_content failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async get_feature_request_content(filename: string): Promise<ReportContentResponse> {
    const name = String(filename || "").trim();
    if (!name) throw new Error("get_feature_request_content: filename is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/reports/features/${encodeURIComponent(name)}/content`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
    });
    if (!r.ok) throw new Error(`get_feature_request_content failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async triage_run(opts?: { write_drafts?: boolean; enable_llm?: boolean }): Promise<TriageRunResponse> {
    const body: any = {};
    if (typeof opts?.write_drafts === "boolean") body.write_drafts = Boolean(opts.write_drafts);
    if (typeof opts?.enable_llm === "boolean") body.enable_llm = Boolean(opts.enable_llm);
    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/triage/run"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ..._auth_headers(this._cfg.auth_token) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`triage_run failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async list_triage_decisions(opts?: { status?: string; limit?: number }): Promise<TriageDecisionListResponse> {
    const qs = new URLSearchParams();
    const status = String(opts?.status || "").trim();
    if (status) qs.set("status", status);
    const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? Number(opts.limit) : 200;
    qs.set("limit", String(limit));
    const url = _join(this._cfg.base_url, `/api/gateway/triage/decisions?${qs.toString()}`);
    const r = await fetch(url, { headers: { ..._auth_headers(this._cfg.auth_token) } });
    if (!r.ok) throw new Error(`list_triage_decisions failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async apply_triage_decision(
    decision_id: string,
    args: { action: "approve" | "reject" | "defer"; defer_days?: number | null }
  ): Promise<TriageDecisionSummary> {
    const did = String(decision_id || "").trim();
    if (!did) throw new Error("apply_triage_decision: decision_id is required");
    const action = String(args?.action || "").trim();
    if (!action) throw new Error("apply_triage_decision: action is required");
    const body: any = { action };
    if (action === "defer") {
      const d = args?.defer_days;
      if (typeof d === "number" && Number.isFinite(d) && d > 0) body.defer_days = Number(d);
    }
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/triage/decisions/${encodeURIComponent(did)}/apply`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ..._auth_headers(this._cfg.auth_token) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`apply_triage_decision failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async backlog_list(kind: "planned" | "completed" | "proposed" | "recurrent"): Promise<BacklogListResponse> {
    const k = String(kind || "").trim();
    if (!k) throw new Error("backlog_list: kind is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/backlog/${encodeURIComponent(k)}`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
    });
    if (!r.ok) throw new Error(`backlog_list failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async backlog_content(kind: "planned" | "completed" | "proposed" | "recurrent", filename: string): Promise<BacklogContentResponse> {
    const k = String(kind || "").trim();
    const name = String(filename || "").trim();
    if (!k) throw new Error("backlog_content: kind is required");
    if (!name) throw new Error("backlog_content: filename is required");
    const r = await fetch(_join(this._cfg.base_url, `/api/gateway/backlog/${encodeURIComponent(k)}/${encodeURIComponent(name)}/content`), {
      headers: { ..._auth_headers(this._cfg.auth_token) },
    });
    if (!r.ok) throw new Error(`backlog_content failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async bug_report_create(req: {
    session_id: string;
    description: string;
    active_run_id?: string | null;
    workflow_id?: string | null;
    client?: string | null;
    client_version?: string | null;
    user_agent?: string | null;
    url?: string | null;
    provider?: string | null;
    model?: string | null;
    template?: string | null;
    context?: any;
  }): Promise<any> {
    const sid = String(req?.session_id || "").trim();
    if (!sid) throw new Error("bug_report_create: session_id is required");
    const description = String(req?.description || "").trim();
    if (!description) throw new Error("bug_report_create: description is required");

    const body: any = { session_id: sid, description };

    const active_run_id = String(req?.active_run_id || "").trim();
    if (active_run_id) body.active_run_id = active_run_id;
    const workflow_id = String(req?.workflow_id || "").trim();
    if (workflow_id) body.workflow_id = workflow_id;

    const client = String(req?.client || "").trim();
    if (client) body.client = client;
    const client_version = String(req?.client_version || "").trim();
    if (client_version) body.client_version = client_version;
    const user_agent = String(req?.user_agent || "").trim();
    if (user_agent) body.user_agent = user_agent;
    const url = String(req?.url || "").trim();
    if (url) body.url = url;

    const provider = String(req?.provider || "").trim();
    if (provider) body.provider = provider;
    const model = String(req?.model || "").trim();
    if (model) body.model = model;
    const template = String(req?.template || "").trim();
    if (template) body.template = template;

    const context = req?.context;
    if (context && typeof context === "object") body.context = context;

    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/bugs/report"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ..._auth_headers(this._cfg.auth_token) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`bug_report_create failed: ${await _read_error(r)}`);
    return await r.json();
  }

  async feature_report_create(req: {
    session_id: string;
    description: string;
    active_run_id?: string | null;
    workflow_id?: string | null;
    client?: string | null;
    client_version?: string | null;
    user_agent?: string | null;
    url?: string | null;
    provider?: string | null;
    model?: string | null;
    template?: string | null;
    context?: any;
  }): Promise<any> {
    const sid = String(req?.session_id || "").trim();
    if (!sid) throw new Error("feature_report_create: session_id is required");
    const description = String(req?.description || "").trim();
    if (!description) throw new Error("feature_report_create: description is required");

    const body: any = { session_id: sid, description };

    const active_run_id = String(req?.active_run_id || "").trim();
    if (active_run_id) body.active_run_id = active_run_id;
    const workflow_id = String(req?.workflow_id || "").trim();
    if (workflow_id) body.workflow_id = workflow_id;

    const client = String(req?.client || "").trim();
    if (client) body.client = client;
    const client_version = String(req?.client_version || "").trim();
    if (client_version) body.client_version = client_version;
    const user_agent = String(req?.user_agent || "").trim();
    if (user_agent) body.user_agent = user_agent;
    const url = String(req?.url || "").trim();
    if (url) body.url = url;

    const provider = String(req?.provider || "").trim();
    if (provider) body.provider = provider;
    const model = String(req?.model || "").trim();
    if (model) body.model = model;
    const template = String(req?.template || "").trim();
    if (template) body.template = template;

    const context = req?.context;
    if (context && typeof context === "object") body.context = context;

    const r = await fetch(_join(this._cfg.base_url, "/api/gateway/features/report"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ..._auth_headers(this._cfg.auth_token) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`feature_report_create failed: ${await _read_error(r)}`);
    return await r.json();
  }

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
