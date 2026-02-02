export type ExecEventStatusKind = "info" | "ok" | "error";

export function first_line_snippet(text: string, max_len: number): string {
  const t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";
  const first = t.split("\n", 1)[0] || "";
  const s = first.trim();
  if (s.length <= max_len) return s;
  return `${s.slice(0, Math.max(0, max_len - 1))}…`;
}

function _strip_outer_quotes(text: string): string {
  const s = String(text || "").trim();
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return s.slice(1, -1);
  }
  return s;
}

export function humanize_shell_command(raw_cmd: string): string {
  const cmd = String(raw_cmd || "").trim();
  if (!cmd) return "";

  // Common wrapper: `/bin/zsh -lc '...'` or `bash -lc "..."`.
  const m = cmd.match(/^(?:\/bin\/)?(?:zsh|bash)\s+-lc\s+([\s\S]+)$/);
  if (!m) return cmd;
  return _strip_outer_quotes(String(m[1] || "").trim());
}

export function classify_exec_event_status_kind(event_type: string, payload: any): ExecEventStatusKind {
  const t = String(event_type || "")
    .trim()
    .toLowerCase();
  if (t === "error" || t === "turn.failed") return "error";
  if (t === "turn.completed" || t === "turn.succeeded" || t === "turn.success") return "ok";

  const p = payload && typeof payload === "object" ? payload : null;
  const item = p && typeof p.item === "object" ? p.item : null;
  if (item && String(item.type || "").trim() === "command_execution") {
    const status = String(item.status || "")
      .trim()
      .toLowerCase();
    if (status === "failed") return "error";
    const exit_code = item.exit_code;
    const exit_num = typeof exit_code === "number" ? exit_code : Number.isFinite(Number(exit_code)) ? Number(exit_code) : null;
    if (exit_num != null) return exit_num === 0 ? "ok" : "error";
    if (status === "completed") return "ok";
  }

  return "info";
}

export function infer_exec_event_main_text(event_type: string, payload: any): string {
  const p = payload && typeof payload === "object" ? payload : {};
  const item = (p as any).item && typeof (p as any).item === "object" ? (p as any).item : null;

  const item_type = item ? String(item.type || "").trim() : "";
  const item_text = item ? String(item.text || "").trim() : "";
  const item_cmd = item ? String(item.command || "").trim() : "";
  const todo_items = item && Array.isArray(item.items) ? item.items : [];

  const msg = String((p as any)?.message || (p as any)?.error?.message || "").trim();

  if (item_type === "command_execution" && item_cmd) {
    return humanize_shell_command(item_cmd) || item_cmd;
  }

  if (item_type === "todo_list" && todo_items.length > 0) {
    const total = todo_items.length;
    const done = todo_items.filter((t: any) => (t && t.completed) === true).length;
    const first_open = todo_items.find((t: any) => (t && t.completed) !== true);
    const first_text = String(first_open?.text || "").trim();
    const suffix = total > 1 ? ` (+${total - 1})` : "";
    const progress = total > 0 ? ` (${done}/${total})` : "";
    const head = first_text ? `todo: ${first_text}${suffix}` : `todo list (${total})`;
    return first_line_snippet(`${head}${progress}`, 96);
  }

  if (item_text) return first_line_snippet(item_text, 96) || item_text;
  if (msg) return first_line_snippet(msg, 96) || msg;
  if (item_type) return item_type;
  return String(event_type || "").trim() || "event";
}

function _format_hhmm(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function infer_exec_event_time_label(payload: any): string | null {
  const p = payload && typeof payload === "object" ? (payload as any) : {};

  const candidates: any[] = [p.at, p.created_at, p.timestamp, p.time, p.ts, p.datetime, p.item?.at, p.item?.created_at, p.item?.timestamp];

  for (const cand of candidates) {
    if (cand == null) continue;
    if (typeof cand === "number" && Number.isFinite(cand)) {
      const ms = cand > 1e11 ? cand : cand * 1000;
      return _format_hhmm(ms);
    }
    if (typeof cand === "string") {
      const s = cand.trim();
      if (!s) continue;
      const ms = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
      if (Number.isFinite(ms)) return _format_hhmm(ms);
    }
  }

  return null;
}

