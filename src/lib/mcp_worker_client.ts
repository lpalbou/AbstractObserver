import { ToolCall, ToolResult } from "./types";
import { random_id } from "./ids";

export type McpWorkerClientConfig = {
  url: string; // HTTP endpoint (POST JSON-RPC), e.g. https://worker.example/mcp
  auth_token?: string;
};

function _auth_headers(token?: string): Record<string, string> {
  const t = (token || "").trim();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

export class McpWorkerClient {
  private _cfg: McpWorkerClientConfig;

  constructor(cfg: McpWorkerClientConfig) {
    this._cfg = { ...cfg, url: (cfg.url || "").trim() };
  }

  async call_tool(tc: ToolCall): Promise<ToolResult> {
    const name = String(tc?.name || "").trim();
    const call_id = String(tc?.call_id || tc?.id || random_id());
    const args = tc?.arguments && typeof tc.arguments === "object" ? tc.arguments : {};

    if (!name) {
      return { call_id, name: "", success: false, output: null, error: "Missing tool name" };
    }

    const req = {
      jsonrpc: "2.0",
      id: random_id(),
      method: "tools/call",
      params: { name, arguments: args },
    };

    const r = await fetch(this._cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._auth_headers(this._cfg.auth_token),
      },
      body: JSON.stringify(req),
    });

    if (!r.ok) {
      return { call_id, name, success: false, output: null, error: `Worker HTTP ${r.status}` };
    }

    const body = await r.json().catch(() => null);
    const result = body?.result;
    const is_error = Boolean(result?.isError);
    const content = Array.isArray(result?.content) ? result.content : [];
    const text_item = content.find((c: any) => c && c.type === "text" && typeof c.text === "string");
    const text = text_item?.text ?? "";

    if (is_error) {
      return { call_id, name, success: false, output: null, error: text || "Tool failed" };
    }

    return { call_id, name, success: true, output: text, error: null };
  }
}


