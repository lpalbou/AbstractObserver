/**
 * THE pure format/time module (ui-rethink P1 step 1, 2026-07-21).
 *
 * Extraction rationale: app.tsx (9,980 lines) and runtime_activity.ts each
 * carried private copies of the same folds, and the copies had DRIFTED —
 * app.tsx's parse_iso_ms clamps sub-millisecond ISO fractions (some
 * backends emit `.123456Z`, which some JS engines refuse to Date.parse)
 * while runtime_activity's copy did not. One source kills the class.
 *
 * Everything here is pure (no React, no app state, no I/O) — moved
 * verbatim from app.tsx module scope; the microsecond-clamping
 * parse_iso_ms is the survivor of the merge.
 */

export function now_iso(): string {
  return new Date().toISOString();
}

export function safe_json(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function safe_json_inline(v: any, max_len: number): string {
  try {
    const s = JSON.stringify(v);
    if (typeof s !== "string") return String(v);
    if (s.length <= max_len) return s;
    return `${s.slice(0, Math.max(0, max_len - 1))}…`;
  } catch {
    const s = String(v);
    if (s.length <= max_len) return s;
    return `${s.slice(0, Math.max(0, max_len - 1))}…`;
  }
}

export function clamp_preview(text: string, opts?: { max_chars?: number; max_lines?: number }): string {
  const max_chars = typeof opts?.max_chars === "number" ? opts.max_chars : 360;
  const max_lines = typeof opts?.max_lines === "number" ? opts.max_lines : 2;
  const raw = String(text || "");
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const head = lines.slice(0, Math.max(1, max_lines)).join("\n");
  const more_lines = lines.length > max_lines;
  const trimmed = head.length > max_chars ? `${head.slice(0, Math.max(0, max_chars - 1))}…` : head;
  if (more_lines && trimmed === head) return `${head}…`;
  return trimmed;
}

export function short_id(id: string, keep: number): string {
  const s = String(id || "");
  if (s.length <= keep) return s;
  return `${s.slice(0, Math.max(0, keep - 1))}…`;
}

export function sanitize_filename_part(value: string): string {
  const s = String(value || "").trim();
  if (!s) return "untitled";
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "untitled";
}

export function parse_iso_ms(ts: any): number | null {
  const s = typeof ts === "string" ? ts.trim() : "";
  if (!s) return null;
  // Some backends emit ISO timestamps with microseconds (e.g. `.123456Z`).
  // JS `Date.parse` can be picky across environments; clamp to milliseconds.
  const normalized = s.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function format_relative_time_from_ms(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days <= 3) return `${days}d ago`;

  // Beyond 3 days, show date (matches AbstractFlow's "history" feel and avoids stale "Xd ago").
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function format_time_ago(ts: any): string {
  const ms = parse_iso_ms(ts);
  if (ms === null) return "—";
  return format_relative_time_from_ms(ms);
}

export function format_time_until_from_ms(ms_until: number): string {
  if (!Number.isFinite(ms_until)) return "";
  const total_s = Math.floor(ms_until / 1000);
  if (total_s <= 0) return "now";

  const total_m = Math.floor(total_s / 60);
  const total_h = Math.floor(total_m / 60);
  const total_d = Math.floor(total_h / 24);

  const s = total_s % 60;
  const m = total_m % 60;
  const h = total_h % 24;

  if (total_d > 0) return `${total_d}d ${h}h`;
  if (total_h > 0) return `${total_h}h ${m}m`;
  if (total_m > 0) return `${total_m}m ${s}s`;
  return `${total_s}s`;
}

export function format_duration_ms(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const total_s = Math.floor(ms / 1000);
  const s = total_s % 60;
  const total_m = Math.floor(total_s / 60);
  const m = total_m % 60;
  const total_h = Math.floor(total_m / 60);
  const h = total_h % 24;
  const d = Math.floor(total_h / 24);
  if (d > 0) return `${d}d ${h}h`;
  if (total_h > 0) return `${total_h}h ${m}m`;
  if (total_m > 0) return `${total_m}m ${s}s`;
  return `${Math.max(0, total_s)}s`;
}

export function display_datetime(ts: any): string {
  const ms = parse_iso_ms(ts);
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
}

export function first_string(...values: any[]): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

/** Verbatim from app.tsx — NOTE the coercion quirk is preserved:
 * Number(null) and Number("") are 0 (finite), so a null/empty candidate
 * short-circuits to 0 rather than falling through. Callers depend on
 * position order; changing this is a behavior change, not a cleanup. */
export function number_or_null(...values: any[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Minimal structural shape for the run-clock helpers: RunSummary
 * (run_status.ts) and RuntimeActivityRun (runtime_activity.ts) both
 * satisfy it — the helpers never needed more than these fields. */
export type RunClockFields = {
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export function terminal_run_status(status: any): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "completed" || s === "failed" || s === "cancelled";
}

export function active_run_status(status: any): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "running" || s === "waiting";
}

export function run_started_at(run: RunClockFields | null | undefined): string {
  return String(run?.started_at || run?.created_at || "").trim();
}

export function run_finished_at(run: RunClockFields | null | undefined): string {
  const st = String(run?.status || "").trim();
  if (!terminal_run_status(st)) return "";
  return String(run?.finished_at || run?.updated_at || "").trim();
}

export function run_duration_ms(run: RunClockFields | null | undefined, now_ms = Date.now()): number {
  const start = parse_iso_ms(run_started_at(run));
  if (start === null) return -1;
  const end = parse_iso_ms(run_finished_at(run));
  const stop = end !== null ? end : now_ms;
  return Math.max(0, stop - start);
}

export function run_duration_label(run: RunClockFields | null | undefined, now_ms = Date.now()): string {
  return format_duration_ms(run_duration_ms(run, now_ms));
}
