/**
 * Stream sources: bounded replay reads + the live tail.
 *
 * One format, two modes (a2a 0005): replay is a bounded read; live is the
 * same read that doesn't stop. This module only performs GET requests —
 * renders are pure reads; an observer never writes to a mind.
 *
 * Gateway endpoints (serving end, 0005 gateway-01):
 *   GET  {base}/api/gateway/entities/{name}/replay          NDJSON, bounded
 *   GET  {base}/api/gateway/entities/{name}/replay/stream   SSE live tail
 *
 * Cursors are FLOATS end-to-end: host markers sit at fractional positions
 * `base + n/1000`, and SSE `id:` carries the seq so the browser's automatic
 * `Last-Event-ID` reconnect resumes exactly (it wins over `since_seq`).
 */

import type { ReplayEnvelope } from "./stream_types";

/** Parse NDJSON text into envelopes. Unparseable lines are surfaced (never
 * silently skipped): a corrupt line in an append-only stream is a bug to see. */
export function parseNdjson(text: string): { envelopes: ReplayEnvelope[]; errors: Array<{ line: number; error: string }> } {
  const envelopes: ReplayEnvelope[] = [];
  const errors: Array<{ line: number; error: string }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const env = JSON.parse(line) as ReplayEnvelope;
      if (typeof env.seq !== "number" || typeof env.family !== "string") {
        errors.push({ line: i + 1, error: "missing seq/family" });
        continue;
      }
      envelopes.push(env);
    } catch (e) {
      errors.push({ line: i + 1, error: String(e) });
    }
  }
  return { envelopes, errors };
}

export interface EntitySummary {
  name: string;
  slug: string;
  entity_id?: string;
  /** `<name>@<declared address>` when the door declares one (GW-F, plan
   * item 5). Reachability, NOT identity — display only, never a key. */
  handle?: string;
}

/** The browser's gateway credential, module-wide (maintainer, 2026-07-08:
 * "the gateway should never work if it receives an unauthenticated
 * request"). Every read helper sends it as a Bearer header; the SSE tail
 * (EventSource cannot set headers) sends it as ?access_token=, which the
 * gateway middleware accepts for READS only. Set by the connect flow;
 * cleared on disconnect. */
let _gatewayToken: string | null = null;

export function setGatewayToken(token: string | null): void {
  const t = String(token || "").trim();
  _gatewayToken = t ? t : null;
}

export function gatewayToken(): string | null {
  return _gatewayToken;
}

export function gatewayReadHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return readHeaders(extra);
}

function readHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (_gatewayToken) h["Authorization"] = `Bearer ${_gatewayToken}`;
  return h;
}

/** The app-origin session proxy's CSRF guard (bin/cli.js): mutating
 * /api/gateway/* calls through the proxy are refused unless they carry
 * X-AbstractObserver-CSRF matching the readable csrf cookie the proxy set
 * at connect time. Same contract as the main observer app
 * (src/lib/gateway_client.ts). Harmless when absent (direct-gateway
 * posture: no such cookie, no header). */
function proxyCsrfHeader(): Record<string, string> {
  try {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("abstractobserver_gateway_csrf="))
      ?.slice("abstractobserver_gateway_csrf=".length);
    if (csrf) return { "X-AbstractObserver-CSRF": decodeURIComponent(csrf) };
  } catch {
    // non-browser tests
  }
  return {};
}

/** List entity homes served by the gateway. */
export async function listEntities(baseUrl: string): Promise<EntitySummary[]> {
  const res = await fetch(`${baseUrl}/api/gateway/entities`, { credentials: "include", headers: readHeaders({ Accept: "application/json" }) });
  if (!res.ok) {
    // Status rides the error so the index can tell "sign in required"
    // (401/403 -> connect prompt) from "gateway down" (maintainer incident
    // 2026-07-09 06:1x: silent-unauthenticated rendered as an empty page).
    const err = new Error(`entity list failed: HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { entities?: Array<Record<string, unknown>> };
  return (data.entities ?? []).map((e) => ({
    name: String(e.name ?? e.slug ?? ""),
    slug: String(e.slug ?? e.name ?? ""),
    entity_id: e.entity_id ? String(e.entity_id) : undefined,
    handle: typeof e.handle === "string" && e.handle ? e.handle : undefined,
  }));
}

/** Bounded history read over the gateway's NDJSON endpoint. Errors carry
 * `status` (and the response `detail` when JSON) so consumers can render
 * a 403 observation refusal distinctly from a down gateway (O-E: an
 * ungranted mind must never read as an empty or broken one). */
export async function fetchReplay(baseUrl: string, entity: string, sinceSeq = 0): Promise<ReplayEnvelope[]> {
  const url = `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/replay?since_seq=${sinceSeq}`;
  const res = await fetch(url, { credentials: "include", headers: readHeaders({ Accept: "application/x-ndjson" }) });
  if (!res.ok) {
    const err = new Error(`replay read failed: HTTP ${res.status}`) as Error & { status?: number; detail?: string };
    err.status = res.status;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body && body.detail !== undefined) {
        err.detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // non-JSON error body: status alone is enough
    }
    throw err;
  }
  const { envelopes, errors } = parseNdjson(await res.text());
  if (errors.length) {
    console.warn(`#FALLBACK: ${errors.length} unparseable replay line(s) skipped`, errors.slice(0, 3));
  }
  return envelopes;
}

/**
 * Stream a full life progressively (maintainer, 2026-07-09 04:32: a 98 MB
 * replay loaded as ONE blocking fetch left the page looking empty/broken
 * for ~30s — "this is not castor"). Envelopes are parsed line-by-line off
 * the response stream and delivered in batches, so the graph FILLS as his
 * life loads instead of appearing all-or-nothing at the end.
 * Returns the complete, seq-ordered list (same contract as fetchReplay).
 */
export async function streamReplay(
  baseUrl: string,
  entity: string,
  sinceSeq: number,
  onBatch: (all: ReplayEnvelope[], doneBytes: number) => void,
  batchSize = 800,
): Promise<ReplayEnvelope[]> {
  const url = `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/replay?since_seq=${sinceSeq}`;
  const res = await fetch(url, { credentials: "include", headers: readHeaders({ Accept: "application/x-ndjson" }) });
  if (!res.ok) throw new Error(`replay read failed: HTTP ${res.status}`);
  if (!res.body) {
    // No streaming support (very old browser): the one-shot path still works.
    const { envelopes } = parseNdjson(await res.text());
    onBatch(envelopes, -1);
    return envelopes;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const all: ReplayEnvelope[] = [];
  let carry = "";
  let bytes = 0;
  let sinceEmit = 0;
  let skipped = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      bytes += value.byteLength;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          all.push(JSON.parse(trimmed) as ReplayEnvelope);
          sinceEmit++;
        } catch {
          skipped++;
        }
      }
      if (sinceEmit >= batchSize) {
        sinceEmit = 0;
        onBatch(all, bytes);
      }
    }
    if (done) break;
  }
  const tail = (carry + decoder.decode()).trim();
  if (tail) {
    try {
      all.push(JSON.parse(tail) as ReplayEnvelope);
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) console.warn(`#FALLBACK: ${skipped} unparseable replay line(s) skipped`);
  all.sort((a, b) => a.seq - b.seq);
  onBatch(all, bytes);
  return all;
}

export interface RecordVerbatim {
  record_id: string;
  title?: string;
  text: string;
  content_type?: string;
  turn_id?: string | null;
  run_id?: string | null;
  created_at?: string | null;
  /** True for interest/dream records: born as words — the digest IS the
   * complete text (0007 round 2, endorsed by memory + gateway). */
  born_digest?: boolean;
  kind?: string;
}

/** Fetch a record's lossless verbatim from the gateway (pure read).
 * Endpoint requested from the gateway agent (a2a 0007): resolves the
 * record's payload_ref into the home's artifact store. 404 = endpoint not
 * shipped yet OR record has no verbatim; 403 = refused (diary). */
export async function fetchRecordVerbatim(baseUrl: string, entity: string, graphId: string): Promise<RecordVerbatim> {
  const url = `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/records/${encodeURIComponent(graphId)}/verbatim`;
  const res = await fetch(url, { credentials: "include", headers: readHeaders({ Accept: "application/json" }) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as RecordVerbatim;
}

export interface DiaryEntryRead {
  entry_id: string;
  text?: string;
  gist?: string;
  kind?: string;
  visibility?: string;
  written_at?: string;
  [key: string]: unknown;
}

/** The OPERATOR diary door (0007 ruling 1; gateway 135641Z): a reasoned,
 * marker-first read of the book — every disclosure lands a `diary_read`
 * host marker in the stream BEFORE the words return, so the read itself
 * is visible in the entity's biography. Reason is REQUIRED (422 without). */
export async function fetchDiaryEntry(baseUrl: string, entity: string, entryId: string, reason: string): Promise<DiaryEntryRead> {
  const url = `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/diary/${encodeURIComponent(entryId)}?reason=${encodeURIComponent(reason)}`;
  const res = await fetch(url, { credentials: "include", headers: readHeaders({ Accept: "application/json" }) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  // The gateway wraps the entry ({entry, read_recorded_at_seq, reason});
  // reading `text` off the WRAPPER rendered an empty body under a happy
  // status line (live failure 2026-07-08: "the book" and nothing else).
  const body = (await res.json()) as { entry?: DiaryEntryRead } & DiaryEntryRead;
  return (body.entry ?? body) as DiaryEntryRead;
}

/** Operator state control: POST through the gateway door — the DOOR
 * decides (authenticated writes only); the view just carries the request
 * and renders the refusal or the resulting host marker honestly. */
export async function postEntityState(
  baseUrl: string,
  entity: string,
  state: string,
  reason: string,
  token: string | null,
): Promise<EntityStateInfo> {
  const res = await fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/state`, {
    credentials: "include",
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ state, reason }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as EntityStateInfo;
}

export interface EntityStateInfo {
  state: string; // awake | asleep | resting | paused | …
  /** "visiting" while a human is in conversation (runtime 0007 160200Z) —
   * the auto-yield writes state=asleep for old-loop safety, and mode
   * carries the truth; the badge must prefer it. */
  mode?: string | null;
  changed_at?: string | null;
  reason?: string | null;
  written_by?: string | null;
}

/** The entity's current lifecycle state (gateway thread-0008 surface).
 * Pure read; the view shows a badge and never offers state writes. */
export async function fetchEntityState(baseUrl: string, entity: string): Promise<EntityStateInfo> {
  const res = await fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/state`, {
    credentials: "include",
    headers: readHeaders({ Accept: "application/json" }),
  });
  if (!res.ok) throw new Error(`state read failed: HTTP ${res.status}`);
  return (await res.json()) as EntityStateInfo;
}

export interface OperatorAuthProbe {
  operator?: boolean;
  user_id?: string | null;
  admin?: boolean;
}

/** The operator-auth probe (0007 165942Z): deliberately WRITE-classed —
 * dev posture exempts loopback GETs, so only a write-classed request
 * answers "would the state/chat/diary doors accept me?". 200 = yes;
 * 401/403 = no. Controls and the visit door gate on this. */
export async function probeOperatorAuth(baseUrl: string, token: string | null): Promise<OperatorAuthProbe | null> {
  const r = await classifyOperatorAuth(baseUrl, token);
  return r.kind === "operator" ? r.probe : null;
}

/** The probe with its REASON (parity-contract fix, adversarial audit V5:
 * "network errors read as auth refusals"): a definitive 401/403 means the
 * door refused THIS credential — sign-in is the answer; anything else
 * (gateway down, DNS, 5xx) means UNREACHABLE — re-asking the operator to
 * sign in cannot help and must not be the response. */
export type OperatorAuthClassification =
  | { kind: "operator"; probe: OperatorAuthProbe }
  | { kind: "refused"; status: number }
  | { kind: "unreachable"; error: string };

export async function classifyOperatorAuth(baseUrl: string, token: string | null): Promise<OperatorAuthClassification> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", ...proxyCsrfHeader() };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/api/gateway/entities/auth/probe`, { credentials: "include", method: "POST", headers, body: "{}" });
    if (res.ok) {
      const probe = (await res.json()) as OperatorAuthProbe;
      if (probe?.operator) return { kind: "operator", probe };
      return { kind: "refused", status: 200 };
    }
    if (res.status === 401 || res.status === 403) return { kind: "refused", status: res.status };
    return { kind: "unreachable", error: `HTTP ${res.status}` };
  } catch (e) {
    return { kind: "unreachable", error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- the chat door (0007 161002Z: operator-authed visits, one turn loop
// with the CLI; auto-yield built in; visits land as summon markers) -------

export interface ChatStatus {
  open: boolean;
  chat_id?: string;
  session_id?: string;
  opened_at?: string;
  turns?: number;
  model_info?: Record<string, unknown>;
}

export interface ChatOpenResult {
  chat_id: string;
  session_id: string;
  participants?: string[];
  prelude_tokens?: number;
  budget_profile?: Record<string, unknown>;
  yielded_loop?: boolean;
  warnings?: string[];
}

/** One memory that entered the prompt — the probe surface (2026-07-08):
 * digest, token cost, lifetime use count, temporal activation. */
export interface TurnMemory {
  tag?: string;
  graph_id?: string;
  record_id?: string;
  kind?: string;
  title?: string;
  why?: string;
  admission?: string;
  digest?: string;
  tokens?: number;
  global_count?: number;
  activation?: Record<string, number>;
  /** When this memory was born (seq 43 R1: undated memories made "last
   * time" unanswerable). Tolerant: absent on older drivers. */
  born_at?: string;
  /** Where it came from (lived conversation / his own retelling / dream…)
   * — self-copies must not read as corroborations (seq 43 FAILURE 4). */
  origin?: string;
}

export interface ChatTurnResult {
  reply: string;
  turn_id?: string;
  /** DRIVER-AUTHORED tool truth — the marker-imitation lesson as API
   * shape. Render THIS, never tool claims from reply prose. */
  tools_ran?: string[];
  memories_in_context?: number;
  records_formed?: number;
  diary_entries?: number;
  notices?: string[];
  /** Enriched probe payload (driver-authored; absent on older gateways). */
  memories?: TurnMemory[];
  /** Tool elections: name + argument, and (field-asked from runtime,
   * 2026-07-09) the RESULT the tool returned to the entity. */
  tool_details?: Array<{ name: string; arg?: string; result?: string }>;
  files?: Array<{ path: string; action: string }>;
  /** The exact system prompt sent this turn (field-asked from runtime,
   * 2026-07-09: "I didn't see any system prompt — that's not good
   * observability"). Absent on gateways that don't yet return it. */
  system_prompt?: string;
}

// ------------------------------------------------------------- workspace

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: "file" | "dir" | "mount";
  size?: number | null;
  mode?: string;
  target?: string;
}

export interface WorkspaceListing {
  path: string;
  writable: boolean;
  mount: string | null;
  entries: WorkspaceEntry[];
}

export interface WorkspaceMount {
  name: string;
  path: string;
  mode: string; // ro | rw
}

export interface ToolPolicyInfo {
  phases: Record<string, { tools: string[]; source: string; notes: string[] }>;
  all_tools: string[];
  tiers: Record<string, string[]>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: readHeaders({ Accept: "application/json" }) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

async function putJson<T>(url: string, body: unknown, token: string | null): Promise<T> {
  const headers = authHeaders(token);
  const res = await fetch(url, { credentials: "include", method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { detail?: string };
      detail = String(data.detail ?? "");
    } catch {
      detail = await res.text().catch(() => "");
    }
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function listWorkspace(baseUrl: string, entity: string, path = "."): Promise<WorkspaceListing> {
  return getJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/workspace?path=${encodeURIComponent(path)}`);
}

export function readWorkspaceFile(
  baseUrl: string,
  entity: string,
  path: string,
): Promise<{ path: string; size: number; truncated: boolean; text: string }> {
  return getJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/workspace/file?path=${encodeURIComponent(path)}`);
}

export function getWorkspaceMounts(baseUrl: string, entity: string): Promise<{ mounts: WorkspaceMount[] }> {
  return getJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/workspace/mounts`);
}

export function putWorkspaceMounts(
  baseUrl: string,
  entity: string,
  mounts: WorkspaceMount[],
  token: string | null,
): Promise<{ mounts: WorkspaceMount[] }> {
  return putJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/workspace/mounts`, { mounts }, token);
}

export function getToolPolicy(baseUrl: string, entity: string): Promise<ToolPolicyInfo> {
  return getJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/tool-policy`);
}

export function putToolPolicy(
  baseUrl: string,
  entity: string,
  policy: Record<string, string[]>,
  token: string | null,
): Promise<ToolPolicyInfo> {
  return putJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/tool-policy`, { policy }, token);
}

/** The system prompt as its layers (maintainer, 2026-07-11): the rendered
 * identity prelude is read-only truth; `layers` are the operator-editable
 * ones (source says whether the built-in default or an overlay is live);
 * `preview` is the exact next-summon head composition. */
export interface PromptLayerInfo {
  layers: Record<string, { text: string; source: "default" | "overlay" }>;
  defaults: Record<string, string>;
  prelude: string;
  preview: string;
  warnings: string[];
  editable: string[];
  /** Raw bytes of an UNPARSEABLE system_prompt.yaml (recovery surface —
   * absent when the file is healthy or missing). */
  raw_file?: string | null;
}

export function getEntityPrompt(baseUrl: string, entity: string): Promise<PromptLayerInfo> {
  return getJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/prompt`);
}

export function putEntityPrompt(
  baseUrl: string,
  entity: string,
  overlay: Record<string, string>,
  token: string | null,
): Promise<PromptLayerInfo> {
  return putJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/prompt`, { overlay }, token);
}

export interface ChatCloseResult {
  summary?: string;
  turns?: number;
  reflection?: { reply?: string; feelings_applied?: number; interests?: string[] };
  warnings?: string[];
}

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", ...proxyCsrfHeader() };
  const effective = token || _gatewayToken;
  if (effective) headers["Authorization"] = `Bearer ${effective}`;
  return headers;
}

async function postJson<T>(url: string, body: unknown, token: string | null, timeoutMs = 120000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: "include", method: "POST", headers: authHeaders(token), body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(detail || `HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getChatStatus(baseUrl: string, entity: string): Promise<ChatStatus> {
  // readHeaders, not bare Accept (audit V8): on a strict-auth gateway a
  // credential-less status read 401s and the drawer degrades silently.
  return fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/chat`, { credentials: "include", headers: readHeaders({ Accept: "application/json" }) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ChatStatus>;
  });
}

export interface ChatOpenOptions {
  /** Mind-substrate override (0010 200500Z: operator config) — empty =
   * the gateway's configured default. */
  provider?: string;
  model?: string;
  base_url?: string;
}

export function openChat(
  baseUrl: string,
  entity: string,
  participant: string,
  token: string | null,
  options: ChatOpenOptions = {},
): Promise<ChatOpenResult> {
  const body: Record<string, unknown> = { participants: [participant] };
  if (options.provider?.trim()) body["provider"] = options.provider.trim();
  if (options.model?.trim()) body["model"] = options.model.trim();
  if (options.base_url?.trim()) body["base_url"] = options.base_url.trim();
  // The open may wait up to ~55s for the entity's own-time loop to yield
  // at a tick boundary — the timeout must outlast that, honestly.
  return postJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/chat/open`, body, token, 90000);
}

export function sendChatTurn(
  baseUrl: string,
  entity: string,
  chatId: string,
  text: string,
  token: string | null,
  speaker?: string,
): Promise<ChatTurnResult> {
  // `speaker` rides on every turn (shared-room attribution): the gateway
  // stamps the voice and lets a REJOINED room attribute turns correctly —
  // never to whoever originally opened the session.
  const body: Record<string, unknown> = { text };
  if (speaker?.trim()) body["speaker"] = speaker.trim();
  // 10 min: the turn budget is 20 tool calls (maintainer ruling 2026-07-11)
  // and a research-heavy turn legitimately chains many lookups — the client
  // must not abort a healthy turn the server is still working.
  return postJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/chat/${encodeURIComponent(chatId)}/turn`, body, token, 600000);
}

export function closeChat(baseUrl: string, entity: string, chatId: string, token: string | null): Promise<ChatCloseResult> {
  return postJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/chat/${encodeURIComponent(chatId)}/close`, { reflect: true }, token, 300000);
}

export interface ChatTranscriptTurn {
  turn_id?: string;
  speaker?: string;
  text?: string;
  reply?: string;
  tools_ran?: string[];
  at?: string;
}

export interface ChatTranscript {
  chat_id: string;
  participants?: string[];
  turns: ChatTranscriptTurn[];
}

/** The shared room's common view (pure read) — the rehydration source when
 * the drawer remounts or the page reloads mid-visit. */
export function getChatTranscript(baseUrl: string, entity: string, chatId: string): Promise<ChatTranscript> {
  return fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/chat/${encodeURIComponent(chatId)}/transcript`, {
    credentials: "include",
    headers: readHeaders({ Accept: "application/json" }),
  }).then((res) => {
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return res.json() as Promise<ChatTranscript>;
  });
}

export interface LiveTailHandle {
  close(): void;
}

/** Open the SSE live tail. The stream has no terminal state (a life does
 * not end) — the CALLER closes. Browser EventSource auto-reconnects with
 * `Last-Event-ID` from the last `id:` line, resuming exactly. */
export function openLiveTail(
  baseUrl: string,
  entity: string,
  sinceSeq: number,
  onEnvelope: (env: ReplayEnvelope) => void,
  onStatus?: (status: "open" | "reconnecting") => void,
): LiveTailHandle {
  // EventSource cannot set headers: the credential rides as ?access_token=
  // (accepted by the gateway middleware for READS only; audit logs redact
  // query values).
  const tokenPart = _gatewayToken ? `&access_token=${encodeURIComponent(_gatewayToken)}` : "";
  const url = `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/replay/stream?since_seq=${sinceSeq}${tokenPart}`;
  const source = new EventSource(url);
  const handler = (ev: MessageEvent) => {
    try {
      onEnvelope(JSON.parse(String(ev.data)) as ReplayEnvelope);
    } catch (e) {
      console.warn("#FALLBACK: unparseable live envelope skipped", e);
    }
  };
  source.addEventListener("replay", handler as EventListener);
  source.onopen = () => onStatus?.("open");
  source.onerror = () => onStatus?.("reconnecting");
  return {
    close() {
      source.removeEventListener("replay", handler as EventListener);
      source.close();
    },
  };
}

// ------------------------------------------------------------- own time
// The ticking mode from the webapp (2026-07-08): wake/sleep/pause GATE a
// running loop; these start/stop the loop process itself.

export interface LoopStatus {
  phase: string; // day | between | stopped
  running: boolean;
  stop_requested?: boolean;
  pid?: number;
  updated_at?: string;
  note?: string;
  /** #FALLBACK from the command-inbox read — surface it, never hide it
   * (runtime heads-up, 0010 121500Z). */
  inbox_warning?: string;
  /** Why the loop ended (gateway fleet review: "failures" = 3 consecutive
   * tick timeouts culled it — the operator must SEE that, not a silent
   * stopped). Tolerant: absent on older runtimes. */
  stopped_by?: string;
}

export function getLoopStatus(baseUrl: string, entity: string): Promise<LoopStatus> {
  return getJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/loop`);
}

/** The gateway-computed composite life phase (commons seq 96: ONE mutually-
 * exclusive answer computed server-side so clients never re-derive — and
 * never re-bug — the chat/state/loop trio). */
export interface ServerLifeState {
  phase: "visiting" | "paused" | "asleep" | "own_time" | "resting" | "awake" | string;
  chat_open?: boolean;
  chat_id?: string | null;
  state?: string | null;
  state_mode?: string | null;
  state_reason?: string | null;
  own_time_running?: boolean;
  own_time_phase?: string | null;
}

/** Null when the endpoint is absent (older gateway) — the caller falls back
 * to client-side derivation, labeled #FALLBACK in the derived state. */
export function getServerLifeState(baseUrl: string, entity: string): Promise<ServerLifeState | null> {
  return fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/life_state`, {
    credentials: "include",
    headers: readHeaders({ Accept: "application/json" }),
  }).then((res) => {
    if (res.status === 404 || res.status === 405) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ServerLifeState>;
  });
}

export function startLoop(
  baseUrl: string,
  entity: string,
  token: string | null,
  options: { provider?: string; model?: string } = {},
): Promise<{ started: boolean; pid?: number; status?: LoopStatus }> {
  const body: Record<string, unknown> = {};
  if (options.provider?.trim()) body["provider"] = options.provider.trim();
  if (options.model?.trim()) body["model"] = options.model.trim();
  return postJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/loop/start`, body, token, 30000);
}

// ------------------------------------------------------------- substrate
// ONE mind substrate per entity (maintainer ruling 2026-07-09 06:32: no
// separate models for visit vs own time). The gateway persists the choice
// in the entity's home; the UI reads it here and writes changes back —
// pickers never gate an open/start again.

export interface EntitySubstrate {
  provider: string | null;
  model: string | null;
  source: "entity" | "operator-env" | "unset";
}

export function getEntitySubstrate(baseUrl: string, entity: string): Promise<EntitySubstrate | null> {
  return fetch(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/substrate`, {
    credentials: "include",
    headers: gatewayReadHeaders({ Accept: "application/json" }),
  }).then((res) => {
    if (res.status === 404 || res.status === 405) return null; // older gateway
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<EntitySubstrate>;
  });
}

export function putEntitySubstrate(
  baseUrl: string,
  entity: string,
  token: string | null,
  choice: { provider: string; model: string },
): Promise<EntitySubstrate> {
  const url = `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/substrate`;
  return fetch(url, { credentials: "include", method: "PUT", headers: authHeaders(token), body: JSON.stringify(choice) }).then((res) => {
    if (!res.ok) return res.json().then((b) => Promise.reject(new Error(String(b?.detail || `HTTP ${res.status}`))));
    return res.json() as Promise<EntitySubstrate>;
  });
}

export function stopLoop(baseUrl: string, entity: string, token: string | null): Promise<{ stop_requested: boolean; status?: LoopStatus }> {
  return postJson(`${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/loop/stop`, {}, token, 30000);
}

// ---------------------------------------------------- files to the entity
// The operator's side of drag-and-drop (maintainer ask, 2026-07-09): place
// a file into the entity's writable workspace so its own read_file reaches
// it. Binary-safe via base64; the gateway enforces containment + cap.

export interface WorkspaceFileResult {
  path: string;
  size: number;
  written: boolean;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Upload one file into the entity's workspace at `destPath` (writable). */
export async function writeEntityWorkspaceFile(
  baseUrl: string,
  entity: string,
  destPath: string,
  bytes: Uint8Array,
  token: string | null,
): Promise<WorkspaceFileResult> {
  return postJson(
    `${baseUrl}/api/gateway/entities/${encodeURIComponent(entity)}/workspace/file`,
    { path: destPath, content_base64: base64FromBytes(bytes) },
    token,
    60000,
  );
}

// -------------------------------------------------------- entity creation
// The multi-entity manager (maintainer ask, 0010 121500Z / commons 44):
// the server owns DEFAULT_SPARK_TEMPLATE and the framework lint.

export interface CreateEntityResult {
  created: boolean;
  name?: string;
  slug?: string;
  entity_id?: string;
  spark_version?: number;
  [key: string]: unknown;
}

/** Create an entity home. `spark_text` optional (server template fills it);
 * `framework: true` lint REQUIRES the shared_vulnerability core value.
 * 409s carry human-written refusals — callers surface them VERBATIM. */
export function createEntity(
  baseUrl: string,
  name: string,
  token: string | null,
  options: { spark_text?: string; framework?: boolean } = {},
): Promise<CreateEntityResult> {
  const body: Record<string, unknown> = { name, framework: options.framework ?? true };
  if (options.spark_text?.trim()) body["spark_text"] = options.spark_text;
  return postJson(`${baseUrl}/api/gateway/entities`, body, token, 60000);
}
