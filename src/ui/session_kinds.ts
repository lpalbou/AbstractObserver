// What a session is FOR, and the Board / Observe "Sessions" chips (operator 2026-11-07: "Observer
// is for technical users, so we absolutely need to show anything running on the gateway. However be
// smart, we should have simple filters in the UI").
//
// The gateway marks every listed run with its session's purpose, `kind` (gateway session_kinds.py:
// `conversation`, `docs` for a Docs assistant chat, `notes` for AbstractNote's own work, more
// later), and its turn listings (`GET /runs?root_only=true`, `archived_only=true`) show
// conversations only unless asked for another `kind` or `kind=all`.
//
// EACH CHIP ASKS THE GATEWAY FOR ITS OWN SESSIONS (coordinator 2026-11-07): the listing is limited
// (the newest 200), and AbstractNote's automation alone fills that window every few hours, so a
// chip that filtered the mixed window here would show a slice ("Conversations 3"). "All" asks
// `kind=all`, a kind chip asks `kind=<kind>`, Conversations / Automations add the gateway's
// `session_kind` filter. The complete active listings (running, waiting: every active run) are
// matched by the same query, client-side; the limited window never is. No counts: the gateway
// returns no per-kind total, and a count of a window is not a total.
//
// Feature detection reads REAL fields only: the advertised filter list
// (`capabilities.contracts.common.runs.list.filters`) and the `kind` the gateway reports on rows.
// A gateway that does not advertise `kind` gets no chips and is asked nothing new. Nothing is
// guessed from a workflow id or any other name.

import type { RunSummary } from "./run_status";

export { runs_list_filters_of } from "../lib/gateway_client";

/** `kind=all` when the gateway understands the filter (its default hides Docs assistant chats and
 * note sessions), else nothing (an older gateway refuses unknown parameters). */
export function listing_kind(filters: readonly string[] | null | undefined): { kind?: "all" } {
  return filters && filters.includes("kind") ? { kind: "all" } : {};
}

/** "all", "conversations", "automations", or a kind the gateway reports ("notes", "docs", ...). */
export type SessionFilter = string;
export const SESSION_FILTER_ALL = "all";

/** The listing parameters a chip sends (also what an active row must match). */
export type SessionQuery = { kind?: string; session_kind?: string };

const CONVERSATION_SESSION_KINDS = "chat,discussion";
const AUTOMATION_SESSION_KINDS = "automation,occurrence";

/** What a chip asks the gateway for: {} when the gateway does not advertise `kind`. */
export function session_filter_query(filter: SessionFilter, filters: readonly string[] | null | undefined): SessionQuery {
  if (!filters || !filters.includes("kind")) return {};
  const by_session_kind = filters.includes("session_kind");
  if (!filter || filter === SESSION_FILTER_ALL) return { kind: "all" };
  // A conversation as a chat list shows it (the gateway's own `chat,discussion`, GET /runs).
  if (filter === "conversations") return by_session_kind ? { kind: "conversation", session_kind: CONVERSATION_SESSION_KINDS } : { kind: "conversation" };
  if (filter === "automations") return by_session_kind ? { kind: "conversation", session_kind: AUTOMATION_SESSION_KINDS } : { kind: "conversation" };
  return { kind: filter };
}

/** Does a row from the COMPLETE active listings match a chip's query (the same words the gateway
 * applies to the turn listing)? An empty query matches every row. */
export function row_matches_query(run: RunSummary, q: SessionQuery): boolean {
  if (q.kind && q.kind !== "all" && reported_kind(run) !== q.kind) return false;
  if (q.session_kind && !q.session_kind.split(",").includes(String(run.session_kind || "").trim())) return false;
  return true;
}

/** The client calls the sweep needs (GatewayClient). */
export type RootsListingClient = {
  runs_list_filters(): Promise<string[] | null>;
  list_runs(opts: { limit?: number; root_only?: boolean; archived_only?: boolean; include_metrics?: boolean; kind?: string; session_kind?: string }): Promise<any>;
};

/** The sweep's turn listings for a chip: the roots of its sessions (asked of the gateway), then the
 * archived ones, read only when the roots page says some exist (Observer is the audit view:
 * archived conversations leave the root listing but stay here). */
export async function list_session_roots(client: RootsListingClient, filter: SessionFilter = SESSION_FILTER_ALL, limit = 200): Promise<[any, any]> {
  const q = session_filter_query(filter, await client.runs_list_filters());
  const roots = await client.list_runs({ limit, root_only: true, include_metrics: true, ...q });
  const archived_count = Number((roots as any)?.archived_sessions);
  if (Number.isFinite(archived_count) && archived_count <= 0) return [roots, { items: [] }];
  const archived = await client.list_runs({ limit, root_only: true, archived_only: true, include_metrics: true, ...q });
  return [roots, archived];
}

/** The session purpose the gateway reported for a row, or "" when it reported none. */
export function reported_kind(run: Pick<RunSummary, "kind">): string {
  return typeof run.kind === "string" ? run.kind.trim() : "";
}

/** The kinds other than a conversation that rows report, in order of first appearance. */
export function kinds_reported(rows: readonly RunSummary[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const k = reported_kind(r);
    if (k && k !== "conversation" && !out.includes(k)) out.push(k);
  }
  return out;
}

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

export type SessionFilterOption = { value: SessionFilter; label: string };

/** The chips: All, Conversations, Automations (when the gateway advertises `session_kind`), then
 * every other kind the gateway has reported on a row. Empty when it does not advertise `kind`. */
export function session_filter_options(filters: readonly string[] | null | undefined, seen_kinds: readonly string[]): SessionFilterOption[] {
  if (!filters || !filters.includes("kind")) return [];
  const others = [...new Set(seen_kinds.filter((k) => k && k !== "conversation"))].sort((a, b) => {
    const ia = KNOWN_ORDER.indexOf(a);
    const ib = KNOWN_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? KNOWN_ORDER.length : ia) - (ib === -1 ? KNOWN_ORDER.length : ib);
    return a.localeCompare(b);
  });
  const base = filters.includes("session_kind") ? [SESSION_FILTER_ALL, "conversations", "automations"] : [SESSION_FILTER_ALL, "conversations"];
  return [...base, ...others].map((value) => ({ value, label: session_filter_label(value) }));
}
