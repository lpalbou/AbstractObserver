// What a session is FOR, and the Board / Observe filter over it (operator 2026-11-07: "Observer is
// for technical users, so we absolutely need to show anything running on the gateway. However be
// smart, we should have simple filters in the UI").
//
// The gateway marks every listed run with its session's purpose, `kind` (gateway session_kinds.py:
// `conversation`, `docs` for a Docs assistant chat, `notes` for AbstractNote's own work, more later),
// and its turn listings (`GET /runs?root_only=true`, `archived_only=true`) show conversations only
// unless asked for `kind=all`. Observer asks for `kind=all` when the gateway advertises the `kind`
// filter (`capabilities.contracts.common.runs.list.filters`), and filters here, client-side.
//
// Feature detection reads REAL fields only: the advertised filter list, and the `kind` field on the
// rows. A gateway that reports no kinds gets no filter at all (every run shows, as before). Nothing
// is guessed from a workflow id or any other name.

import type { RunSummary } from "./run_status";

export { runs_list_filters_of } from "../lib/gateway_client";

/** The `kind` a turn listing asks for: "all" when the gateway understands the filter (its default
 * hides Docs assistant chats and note sessions), else nothing (an older gateway refuses unknown
 * parameters). */
export function listing_kind(filters: readonly string[] | null | undefined): { kind?: "all" } {
  return filters && filters.includes("kind") ? { kind: "all" } : {};
}

/** The client calls the sweep needs (GatewayClient). */
export type RootsListingClient = {
  runs_list_filters(): Promise<string[] | null>;
  list_runs(opts: { limit?: number; root_only?: boolean; archived_only?: boolean; include_metrics?: boolean; kind?: string }): Promise<any>;
};

/** The sweep's turn listings: the roots of EVERY session (`kind=all` when the gateway understands
 * it), then the archived ones, read only when the roots page says some exist (Observer is the audit
 * view: archived conversations leave the root listing but stay here). */
export async function list_session_roots(client: RootsListingClient, limit = 200): Promise<[any, any]> {
  const kind = listing_kind(await client.runs_list_filters());
  const roots = await client.list_runs({ limit, root_only: true, include_metrics: true, ...kind });
  const archived_count = Number((roots as any)?.archived_sessions);
  if (Number.isFinite(archived_count) && archived_count <= 0) return [roots, { items: [] }];
  const archived = await client.list_runs({ limit, root_only: true, archived_only: true, include_metrics: true, ...kind });
  return [roots, archived];
}

/** The session purpose the gateway reported for a row, or "" when it reported none. */
export function reported_kind(run: Pick<RunSummary, "kind">): string {
  return typeof run.kind === "string" ? run.kind.trim() : "";
}

/** True when any row carries the gateway's `kind` field (the filter is shown only then). */
export function reports_kinds(rows: readonly RunSummary[]): boolean {
  return rows.some((r) => reported_kind(r) !== "");
}

const AUTOMATION_SESSION_KINDS = new Set(["automation", "occurrence"]);
const AUTOMATION_ROLES = new Set(["controller", "occurrence", "descendant"]);

/** A run that belongs to an automation, by the gateway's attribution fields (contract E/F). */
export function is_automation_run(run: RunSummary): boolean {
  if (String(run.automation_id || "").trim()) return true;
  if (AUTOMATION_SESSION_KINDS.has(String(run.session_kind || "").trim())) return true;
  return AUTOMATION_ROLES.has(String(run.role || "").trim());
}

/** The filter group a row falls in: its reported kind when that is not a conversation ("notes",
 * "docs", or any kind a newer gateway adds), else "automations" for an automation's run, else
 * "conversations". A note session run by an automation is a note session. */
export function session_group(run: RunSummary): string {
  const kind = reported_kind(run);
  if (kind && kind !== "conversation") return kind;
  return is_automation_run(run) ? "automations" : "conversations";
}

/** "all", "conversations", "automations", or a reported kind ("notes", "docs", ...). */
export type SessionFilter = string;
export const SESSION_FILTER_ALL = "all";

const KNOWN_LABELS: Record<string, string> = {
  all: "All",
  conversations: "Conversations",
  automations: "Automations",
  notes: "Notes",
  docs: "Docs assistant",
};
/** Known kinds first, in this order; any other reported kind follows, alphabetically. */
const KNOWN_ORDER = ["notes", "docs"];

/** A chip's words: the known ones, else the gateway's own kind word, capitalised. */
export function session_filter_label(id: string): string {
  if (KNOWN_LABELS[id]) return KNOWN_LABELS[id];
  const word = id.split("_").join(" ");
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export type SessionFilterOption = { value: SessionFilter; label: string; count: number };

/** The chips, with how many SESSIONS each would show (a row without a session counts as its own):
 * All, Conversations, Automations, then one per other kind the rows report. Empty when the gateway
 * reports no kinds: no filter is shown then. */
export function session_filter_options(rows: readonly RunSummary[]): SessionFilterOption[] {
  if (!reports_kinds(rows)) return [];
  const sessions = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const r of rows) {
    const key = String(r.session_id || "").trim() || `run:${String(r.run_id || "")}`;
    const group = session_group(r);
    all.add(key);
    (sessions.get(group) ?? sessions.set(group, new Set()).get(group)!).add(key);
  }
  const others = [...sessions.keys()].filter((k) => k !== "conversations" && k !== "automations");
  others.sort((a, b) => {
    const ia = KNOWN_ORDER.indexOf(a);
    const ib = KNOWN_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? KNOWN_ORDER.length : ia) - (ib === -1 ? KNOWN_ORDER.length : ib);
    return a.localeCompare(b);
  });
  return [SESSION_FILTER_ALL, "conversations", "automations", ...others].map((value) => ({
    value,
    label: session_filter_label(value),
    count: value === SESSION_FILTER_ALL ? all.size : sessions.get(value)?.size ?? 0,
  }));
}

/** The rows a filter shows ("all", or a filter the rows no longer offer, shows every row). */
export function filter_sessions<T extends RunSummary>(rows: readonly T[], filter: SessionFilter): T[] {
  if (!filter || filter === SESSION_FILTER_ALL || !reports_kinds(rows)) return [...rows];
  return rows.filter((r) => session_group(r) === filter);
}
