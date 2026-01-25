import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  KgActiveMemoryExplorer,
  type JsonValue,
  type KgAssertion,
  type KgQueryParams,
  type KgQueryResult,
  type MemoryScope,
} from "@abstractuic/monitor-active-memory";
import { Markdown } from "@abstractuic/panel-chat";

import { GatewayClient } from "../lib/gateway_client";
import { Modal } from "./modal";

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

function format_utc_minute(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function format_transcript_timestamp(value: string): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(s)) return s;
  const ms = parse_iso_ms(s);
  if (ms !== null) return format_utc_minute(ms);
  return s;
}

function decode_escaped_whitespace(text: unknown): string {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (!s) return "";
  if (!s.includes("\\n") && !s.includes("\\r") && !s.includes("\\t")) return s;
  return s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function strip_markdown_markers(text: string): string {
  // Keep content but remove common lightweight Markdown markers used in our transcripts.
  // This is deliberately conservative (best-effort) to avoid unexpected loss.
  return String(text ?? "").replace(/[*_`~]/g, "");
}

function normalize_for_match(text: string, opts?: { strip_punct?: boolean }): string {
  const strip_punct = Boolean(opts?.strip_punct);
  const s0 = decode_escaped_whitespace(text);
  let s = strip_markdown_markers(s0)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!strip_punct) return s;
  // Remove most punctuation to tolerate minor formatting diffs (quotes, dashes, etc).
  // Unicode property escapes are supported (target ES2020).
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, "").replace(/\s+/g, " ").trim();
  return s;
}

function contains_evidence(text: string, evidence: string): boolean {
  const needle = String(evidence ?? "").trim();
  if (!needle) return false;
  const n = normalize_for_match(needle, { strip_punct: false });
  if (!n) return false;
  const hay = normalize_for_match(String(text ?? ""), { strip_punct: false });
  if (hay.includes(n)) return true;
  const n2 = normalize_for_match(needle, { strip_punct: true });
  if (!n2) return false;
  const hay2 = normalize_for_match(String(text ?? ""), { strip_punct: true });
  return hay2.includes(n2);
}

function highlight_fragments_from_evidence(evidence: string): string[] {
  const e = decode_escaped_whitespace(evidence).trim();
  if (!e) return [];
  const out: string[] = [];

  const add = (value: string) => {
    const t = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!t) return;
    if (t.length < 6) return;
    if (!out.includes(t)) out.push(t);
  };

  // If evidence contains Markdown markers, also highlight the plain-text prefix
  // so the user sees more than just the emphasized fragment.
  const first_marker = e.search(/[`*_~]/);
  if (first_marker > 0) {
    const prefix = e.slice(0, first_marker);
    if (prefix.replace(/\s+/g, " ").trim().length >= 10) add(prefix);
  }

  // Prefer inner content of formatting markers to avoid crossing Markdown node boundaries.
  const patterns: RegExp[] = [
    /`([^`]+)`/g, // code
    /\*\*([^*]+)\*\*/g, // bold
    /__([^_]+)__/g, // bold
    /\*([^*]+)\*/g, // italic
    /_([^_]+)_/g, // italic
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(e)) !== null) {
      const inner = String(m[1] ?? "").trim();
      if (inner) add(inner);
    }
  }

  add(strip_markdown_markers(e));

  return out;
}

type ParsedNoteChat = {
  created_at?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

function parse_note_chat(note: string): ParsedNoteChat | null {
  const raw = String(note ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw) return null;
  const lines = raw.split("\n");

  let created_at: string | undefined;
  const preamble: string[] = [];
  const messages: Array<{ role: "user" | "assistant" | "system"; lines: string[] }> = [];
  let cur_role: "user" | "assistant" | "system" | null = null;
  let cur_lines: string[] = [];
  let saw_marker = false;

  const flush = () => {
    if (!cur_role) return;
    const content = cur_lines.join("\n").trim();
    if (content) messages.push({ role: cur_role, lines: [content] });
    cur_role = null;
    cur_lines = [];
  };

  for (const line of lines) {
    const created_m = !created_at ? line.match(/^\s*created_at\s*=\s*(.+)\s*$/i) : null;
    if (created_m && created_m[1]) {
      created_at = created_m[1].trim();
      continue;
    }

    const m = line.match(/^\s*(USER|ASSISTANT|SYSTEM)\s*:\s*(.*)$/i);
    if (m) {
      saw_marker = true;
      flush();
      const kind = String(m[1] || "").trim().toLowerCase();
      cur_role = kind === "user" ? "user" : kind === "assistant" ? "assistant" : "system";
      const rest = String(m[2] ?? "");
      cur_lines = rest ? [rest] : [];
      continue;
    }

    if (cur_role) cur_lines.push(line);
    else preamble.push(line);
  }
  flush();

  if (!saw_marker || !messages.length) return null;

  const pre = preamble.join("\n").trim();
  const out: ParsedNoteChat = { messages: [] };
  if (created_at) out.created_at = created_at;
  if (pre) out.messages.push({ role: "system", content: pre });
  for (const m of messages) out.messages.push({ role: m.role, content: m.lines.join("\n") });
  return out.messages.length ? out : null;
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
  const [highlight_ms, set_highlight_ms] = useState(5000);

  const [items, set_items] = useState<KgAssertion[]>([]);
  const [warnings, set_warnings] = useState<JsonValue | undefined>(undefined);
  const [error, set_error] = useState<string>("");
  const [loading, set_loading] = useState(false);

  const [recent, set_recent] = useState<RecentAssertion[]>([]);

  const [source_open, set_source_open] = useState(false);
  const [source_loading, set_source_loading] = useState(false);
  const [source_error, set_source_error] = useState<string>("");
  const [source_title, set_source_title] = useState<string>("");
  const [source_run_id, set_source_run_id] = useState<string>("");
  const [source_span_id, set_source_span_id] = useState<string>("");
  const [source_origin, set_source_origin] = useState<"artifact" | "run_input">("artifact");
  const [source_json, set_source_json] = useState<any>(null);
  const [source_text, set_source_text] = useState<string>("");
  const [source_assertion, set_source_assertion] = useState<KgAssertion | null>(null);
  const source_scrolled_ref = useRef(false);

  const source_evidence_quote = useMemo(() => {
    const a = source_assertion;
    const attrs = a?.attributes && typeof a.attributes === "object" && !Array.isArray(a.attributes) ? (a.attributes as any) : null;
    const evidence = attrs && typeof attrs.evidence_quote === "string" ? String(attrs.evidence_quote) : "";
    return evidence.trim();
  }, [source_assertion]);

  const source_note = useMemo(() => {
    const data = source_json;
    const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as any) : null;
    const note = obj && typeof obj.note === "string" ? String(obj.note) : "";
    return decode_escaped_whitespace(note).trim();
  }, [source_json]);

  const source_messages = useMemo(() => {
    const obj = source_json && typeof source_json === "object" && !Array.isArray(source_json) ? (source_json as any) : null;
    const messages = obj && Array.isArray(obj.messages) ? obj.messages : null;
    return Array.isArray(messages) ? messages : null;
  }, [source_json]);

  const source_note_has_match = useMemo(() => {
    const note = source_note;
    const evidence = source_evidence_quote;
    if (!note || !evidence) return false;
    return contains_evidence(note, evidence);
  }, [source_evidence_quote, source_note]);

  const source_message_matches = useMemo(() => {
    const messages = source_messages;
    const evidence = source_evidence_quote;
    if (!messages || !evidence) return [];
    const out: number[] = [];
    for (let i = 0; i < Math.min(messages.length, 500); i++) {
      const m = messages[i];
      const content = m?.content == null ? "" : String(m.content);
      if (contains_evidence(content, evidence)) out.push(i);
    }
    return out;
  }, [source_evidence_quote, source_messages]);

  const source_message_match_set = useMemo(() => new Set(source_message_matches), [source_message_matches]);
  const source_first_match = source_message_matches.length ? source_message_matches[0] : null;

  const scroll_to_source_message = useCallback((idx: number) => {
    const el = document.getElementById(`source_msg_${idx}`);
    if (el && typeof (el as any).scrollIntoView === "function") {
      (el as any).scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  const scroll_to_source_note = useCallback(() => {
    const el = document.getElementById("source_note_hit_0") || document.getElementById("source_note_msg_hit_0");
    if (el && typeof (el as any).scrollIntoView === "function") {
      (el as any).scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    if (!source_open) return;
    if (source_loading || source_error) return;
    if (source_scrolled_ref.current) return;
    if (source_first_match !== null) {
      source_scrolled_ref.current = true;
      window.setTimeout(() => scroll_to_source_message(source_first_match), 0);
      return;
    }
    if (source_note_has_match) {
      source_scrolled_ref.current = true;
      window.setTimeout(() => scroll_to_source_note(), 0);
      return;
    }
  }, [scroll_to_source_message, scroll_to_source_note, source_error, source_first_match, source_loading, source_note_has_match, source_open]);

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
    const prev_last_seen = String(last_seen_observed_at_ref.current || "").trim();
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
    last_seen_observed_at_ref.current = last_seen || prev_last_seen;
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

  const open_source_span = useCallback(
    async (args: { run_id: string; span_id: string; assertion?: KgAssertion }) => {
      const run_id = String(args.run_id || "").trim();
      const span_id = String(args.span_id || "").trim();
      if (!run_id || !span_id) return;

      set_source_open(true);
      set_source_loading(true);
      set_source_error("");
      set_source_run_id(run_id);
      set_source_span_id(span_id);
      set_source_origin("artifact");
      set_source_title(`source span:${span_id}`);
      set_source_json(null);
      set_source_text("");
      set_source_assertion(args.assertion && typeof args.assertion === "object" ? (args.assertion as KgAssertion) : null);
      source_scrolled_ref.current = false;

      try {
        const candidates = [run_id];
        const owner_fallback = typeof args.assertion?.owner_id === "string" ? String(args.assertion.owner_id).trim() : "";
        if (owner_fallback && owner_fallback !== run_id) candidates.push(owner_fallback);

        let last_error: string | null = null;
        let loaded_text: string | null = null;
        for (const rid of candidates) {
          try {
            const blob = await gateway.download_run_artifact_content(rid, span_id);
            loaded_text = await blob.text();
            if (rid !== run_id) set_source_run_id(rid);
            break;
          } catch (e) {
            last_error = e instanceof Error ? e.message : String(e);
          }
        }

        if (loaded_text == null) throw new Error(last_error || "Failed to load source span");

        set_source_text(loaded_text);
        try {
          const parsed = JSON.parse(loaded_text);
          set_source_json(parsed);
        } catch {
          set_source_json(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set_source_error(msg || "Failed to load source span");
      } finally {
        set_source_loading(false);
      }
    },
    [gateway]
  );

  const recover_span_id_from_run = useCallback(
    async (args: { run_id: string; assertion?: KgAssertion }): Promise<string | null> => {
      const run_id = String(args.run_id || "").trim();
      if (!run_id) return null;

      try {
        const res = await gateway.list_run_artifacts(run_id, { limit: 200 });
        const items = Array.isArray(res?.items) ? res.items : [];
        const candidates = items
          .map((it: any) => {
            const artifact_id = typeof it?.artifact_id === "string" ? String(it.artifact_id).trim() : "";
            const tags = it?.tags && typeof it.tags === "object" && !Array.isArray(it.tags) ? (it.tags as any) : null;
            const kind = tags && typeof tags.kind === "string" ? String(tags.kind).trim() : "";
            return { artifact_id, kind };
          })
          .filter((it: { artifact_id: string; kind: string }) => Boolean(it.artifact_id && (it.kind === "conversation_span" || it.kind === "memory_note")));

        if (!candidates.length) return null;
        if (candidates.length === 1) return candidates[0].artifact_id;

        const a = args.assertion;
        const attrs = a?.attributes && typeof a.attributes === "object" && !Array.isArray(a.attributes) ? (a.attributes as any) : null;
        const evidence = attrs && typeof attrs.evidence_quote === "string" ? String(attrs.evidence_quote) : "";
        const needle = evidence.trim();
        if (!needle) return null;

        for (const cand of candidates.slice(0, 10)) {
          try {
            const blob = await gateway.download_run_artifact_content(run_id, cand.artifact_id);
            const txt = await blob.text();
            const parsed = JSON.parse(txt);
            if (parsed && typeof parsed === "object") {
              const note = typeof (parsed as any).note === "string" ? String((parsed as any).note) : "";
              if (note && note.includes(needle)) return cand.artifact_id;
              const messages = Array.isArray((parsed as any).messages) ? (parsed as any).messages : null;
              if (messages) {
                for (const m of messages.slice(0, 200)) {
                  const content = m?.content == null ? "" : String(m.content);
                  if (content.includes(needle)) return cand.artifact_id;
                }
              }
            }
          } catch {
            // Best-effort.
          }
        }
      } catch {
        // Best-effort.
      }

      return null;
    },
    [gateway]
  );

  const open_run_input_transcript = useCallback(
    async (args: { run_id: string; assertion?: KgAssertion }) => {
      const run_id = String(args.run_id || "").trim();
      if (!run_id) return;

      set_source_open(true);
      set_source_loading(true);
      set_source_error("");
      set_source_run_id(run_id);
      set_source_span_id("");
      set_source_origin("run_input");
      set_source_title(`transcript run:${run_id}`);
      set_source_json(null);
      set_source_text("");
      set_source_assertion(args.assertion && typeof args.assertion === "object" ? (args.assertion as KgAssertion) : null);
      source_scrolled_ref.current = false;

      try {
        const recovered_span_id = await recover_span_id_from_run({ run_id, assertion: args.assertion });
        if (recovered_span_id) {
          await open_source_span({ run_id, span_id: recovered_span_id, assertion: args.assertion });
          return;
        }

        const raw = await gateway.get_run_input_data(run_id);
        const input_data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as any).input_data : null;
        const src: any = { kind: "run_input_data", run_id };
        if (raw && typeof raw?.workflow_id === "string") src.workflow_id = String(raw.workflow_id);
        if (input_data && typeof input_data === "object" && !Array.isArray(input_data)) {
          const ctx = (input_data as any).context;
          const ctx_messages = ctx && typeof ctx === "object" && Array.isArray((ctx as any).messages) ? (ctx as any).messages : null;
          const messages = ctx_messages || (Array.isArray((input_data as any).messages) ? (input_data as any).messages : null);
          if (Array.isArray(messages)) src.messages = messages;

          const candidates = ["text", "prompt", "task", "message"];
          for (const k of candidates) {
            const v = (input_data as any)[k];
            if (typeof v === "string" && v.trim()) {
              src.note = v.trim();
              break;
            }
          }

          src.input_data = input_data;
        }

        if (!src.messages && !src.note) {
          src.note = JSON.stringify(input_data ?? raw ?? {}, null, 2);
        }

        try {
          const run = await gateway.get_run(run_id);
          const created_at = run && typeof run?.created_at === "string" ? String(run.created_at) : "";
          if (created_at) src.created_at = created_at;
        } catch {
          // Best-effort.
        }

        set_source_json(src);
        set_source_text(JSON.stringify(raw, null, 2));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set_source_error(msg || "Failed to load run input transcript");
      } finally {
        set_source_loading(false);
      }
    },
    [gateway, open_source_span, recover_span_id_from_run]
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
                onChange={(e) => set_highlight_ms(Math.max(250, Number(e.target.value || 0) || 5000))}
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

      <div className="mindmap_explorer">
        <KgActiveMemoryExplorer
          title="mindmap"
          resetKey={reset_key}
          queryMode="replace"
          items={filtered_items}
          warnings={warnings}
          onQuery={on_query}
          onItemsReplace={on_items_replace}
          onOpenSpan={({ run_id, span_id, assertion }) => {
            void open_source_span({ run_id, span_id, assertion });
          }}
          onOpenTranscript={({ run_id, span_id, assertion }) => {
            const rid = String(run_id || "").trim();
            const sid = typeof span_id === "string" ? String(span_id).trim() : "";
            if (!rid) return;
            if (sid) void open_source_span({ run_id: rid, span_id: sid, assertion });
            else void open_run_input_transcript({ run_id: rid, assertion });
          }}
        />

        {recent.length ? (
          <div className="mindmap_recent mindmap_overlay mindmap_overlay_recent">
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
          <div className="mindmap_timeline mindmap_overlay mindmap_overlay_timeline">
            <div className="mindmap_timeline_row">
              <button
                className={`btn mindmap_timeline_btn ${follow_latest ? "primary" : ""}`}
                onClick={() => {
                  set_follow_latest(true);
                  if (typeof time_bounds.max_ms === "number") set_time_cursor_ms(time_bounds.max_ms);
                }}
              >
                follow
              </button>
              <div className="mindmap_timeline_label mono muted">{format_utc_minute(time_cursor_ms)}</div>
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
              <div className="mindmap_timeline_counts mono muted">
                {filtered_items.length.toLocaleString()}/{items.length.toLocaleString()}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={source_open}
        title={source_title || "source"}
        onClose={() => {
          set_source_open(false);
        }}
      >
        {source_loading ? <div className="mono muted">Loading…</div> : null}
        {source_error ? <div className="mindmap_error mono">{source_error}</div> : null}
        {!source_loading && !source_error ? (
          <div className="source_span">
            {(() => {
              const a = source_assertion;
              if (!a) return null;
              const s = String(a.subject || "").trim();
              const p = String(a.predicate || "").trim();
              const o = String(a.object || "").trim();
              const t = format_utc_minute(parse_iso_ms(a.observed_at));
              const attrs = a.attributes && typeof a.attributes === "object" && !Array.isArray(a.attributes) ? (a.attributes as any) : null;
              const evidence = attrs && typeof attrs.evidence_quote === "string" ? String(attrs.evidence_quote) : "";
              const ctx = attrs && typeof attrs.original_context === "string" ? String(attrs.original_context) : "";
              return (
                <div className="source_header">
                  <div className="mono source_triple" title={`${s} --${p}--> ${o}`}>
                    {s} <span className="muted">—{p}→</span> {o} {t ? <span className="muted">[{t}]</span> : null}
                  </div>
                  {evidence ? (
                    <div className="source_evidence">
                      <div className="mono muted" style={{ fontSize: 11, marginBottom: 6 }}>
                        evidence_quote
                      </div>
                      <pre className="mono source_evidence_quote">{evidence}</pre>
                      {ctx ? (
                        <details className="source_evidence_more">
                          <summary className="mono muted">original_context</summary>
                          <pre className="mono source_evidence_quote">{ctx}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })()}
            <div className="mono muted" style={{ marginBottom: 10 }}>
              run_id={source_run_id} · {source_origin === "artifact" ? `span_id=${source_span_id}` : "source=input_data"}
            </div>
            <div className="source_actions">
              {source_first_match !== null ? (
                <button className="btn" onClick={() => scroll_to_source_message(source_first_match)}>
                  Jump to evidence
                </button>
              ) : null}
              {source_first_match === null && source_note_has_match ? (
                <button className="btn" onClick={() => scroll_to_source_note()}>
                  Jump to evidence
                </button>
              ) : null}
            </div>
            {(() => {
              const data = source_json;
              const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as any) : null;
              const messages = source_messages;
              const note = source_note;
              const created_at = obj && typeof obj.created_at === "string" ? String(obj.created_at) : "";
              const created_at_ms = created_at ? parse_iso_ms(created_at) : null;
              const created_at_display = created_at_ms !== null ? format_utc_minute(created_at_ms) : created_at;
              const span_meta = obj && obj.span && typeof obj.span === "object" && !Array.isArray(obj.span) ? (obj.span as any) : null;
              const span_from = span_meta && typeof span_meta.from_timestamp === "string" ? String(span_meta.from_timestamp) : "";
              const span_to = span_meta && typeof span_meta.to_timestamp === "string" ? String(span_meta.to_timestamp) : "";
              const span_from_ms = span_from ? parse_iso_ms(span_from) : null;
              const span_to_ms = span_to ? parse_iso_ms(span_to) : null;
              const span_range =
                span_from_ms !== null && span_to_ms !== null ? `${format_utc_minute(span_from_ms)} → ${format_utc_minute(span_to_ms)}` : "";

              if (note) {
                const parsed = parse_note_chat(note);
                if (parsed) {
                  const evidence = source_evidence_quote;
                  const hit_idx = evidence ? parsed.messages.findIndex((m) => contains_evidence(m.content, evidence)) : -1;
                  const highlight_fragments = evidence ? highlight_fragments_from_evidence(evidence) : [];
                  const bubble_ts_raw = parsed.created_at || created_at;
                  const bubble_ts = bubble_ts_raw ? format_transcript_timestamp(bubble_ts_raw) : created_at ? created_at_display : "";
                  return (
                    <div className="source_chat">
                      {parsed.messages.map((m, idx) => {
                        const role = m.role;
                        const is_match = Boolean(evidence && contains_evidence(m.content, evidence));
                        const role_label = role === "user" ? "USER" : role === "assistant" ? "ASSISTANT" : "SYSTEM";
                        return (
                          <div
                            key={`note_msg:${idx}`}
                            id={idx === hit_idx ? "source_note_msg_hit_0" : undefined}
                            className={`source_msg source_${role} ${is_match ? "source_match" : ""}`}
                          >
                            <div className="source_msg_meta mono muted">
                              <span>
                                #{idx + 1} · {role_label}
                                {is_match ? <span className="source_match_badge">evidence</span> : null}
                              </span>
                              {bubble_ts ? <span title={bubble_ts_raw || ""}>{bubble_ts}</span> : null}
                            </div>
                            <div className="source_msg_body">
                              <Markdown
                                text={m.content}
                                highlights={is_match && highlight_fragments.length ? highlight_fragments : undefined}
                                highlightClassName="source_note_hit"
                                highlightId={idx === hit_idx ? "source_note_hit_0" : undefined}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                return (
                  <div className="source_note">
                    {created_at ? (
                      <div className="mono muted" style={{ marginBottom: 10 }}>
                        <span title={created_at}>created_at={created_at_display}</span>
                      </div>
                    ) : null}
                    <Markdown
                      text={note}
                      highlights={source_evidence_quote ? highlight_fragments_from_evidence(source_evidence_quote) : undefined}
                      highlightClassName="source_note_hit"
                      highlightId="source_note_hit_0"
                    />
                  </div>
                );
              }

              if (messages) {
                const participants = new Map<string, number>();
                for (const m of messages) {
                  const role = typeof m?.role === "string" ? String(m.role) : "unknown";
                  participants.set(role, (participants.get(role) || 0) + 1);
                }
                const participants_list = Array.from(participants.entries())
                  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                  .map(([r, c]) => `${r}×${c}`)
                  .join(" · ");

                return (
                  <div className="source_chat">
                    {created_at ? (
                      <div className="mono muted" style={{ marginBottom: 10 }}>
                        <span title={created_at}>created_at={created_at_display}</span> · messages={messages.length}
                      </div>
                    ) : null}
                    {span_range ? (
                      <div className="mono muted" style={{ marginBottom: 10 }}>
                        span={span_range}
                      </div>
                    ) : null}
                    {participants_list ? (
                      <div className="mono muted" style={{ marginBottom: 10 }}>
                        participants: {participants_list}
                      </div>
                    ) : null}
                    {messages.slice(0, 200).map((m: any, idx: number) => {
                      const role = typeof m?.role === "string" ? String(m.role) : "unknown";
                      const content = m?.content == null ? "" : String(m.content);
                      const ts = typeof m?.timestamp === "string" ? String(m.timestamp) : "";
                      const ts_ms = ts ? parse_iso_ms(ts) : null;
                      const ts_display = ts_ms !== null ? format_utc_minute(ts_ms) : ts;
                      const msg_id =
                        typeof m?.message_id === "string"
                          ? String(m.message_id)
                          : typeof m?.metadata?.message_id === "string"
                            ? String(m.metadata.message_id)
                            : typeof m?.metadata?.id === "string"
                              ? String(m.metadata.id)
                              : "";
                      const is_match = source_message_match_set.has(idx);
                      return (
                        <div key={idx} id={`source_msg_${idx}`} className={`source_msg source_${role} ${is_match ? "source_match" : ""}`}>
                          <div className="source_msg_meta mono muted">
                            <span>
                              #{idx + 1} · {role}
                              {is_match ? <span className="source_match_badge">evidence</span> : null}
                              {msg_id ? <span className="source_msg_id">{msg_id}</span> : null}
                            </span>
                            {ts ? <span title={ts}>{ts_display}</span> : null}
                          </div>
                          <div className="source_msg_body">
                            <Markdown text={content} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Fallback: show raw JSON/text.
              return (
                <pre className="mono source_raw" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {(typeof data === "string" ? data : source_text) || "(empty)"}
                </pre>
              );
            })()}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
