import { LedgerStreamEvent } from "./types";
import { SseParser } from "./sse_parser";

export type GatewayClientConfig = {
  base_url: string; // e.g. "http://localhost:8080" (no trailing slash) or "" for same-origin
  auth_token?: string;
};

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

export class GatewayClient {
  private _cfg: GatewayClientConfig;

  constructor(cfg: GatewayClientConfig) {
    this._cfg = { ...cfg, base_url: (cfg.base_url || "").trim() };
  }

  async start_run(flow_id: string | null | undefined, input_data: Record<string, any>, opts?: { bundle_id?: string }): Promise<string> {
    const bundle_id = String(opts?.bundle_id || "").trim();
    const fid = String(flow_id || "").trim();
    const req_body: any = { input_data: input_data || {} };
    if (bundle_id) req_body.bundle_id = bundle_id;
    if (fid) req_body.flow_id = fid;
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
    if (!r.ok) throw new Error(`get_run failed: ${r.status}`);
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
    if (!r.ok) throw new Error(`list_runs failed: ${r.status}`);
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
    if (!r.ok) throw new Error(`get_run_input_data failed: ${r.status}`);
    return await r.json();
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
