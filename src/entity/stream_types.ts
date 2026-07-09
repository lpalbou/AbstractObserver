/**
 * Frozen replay stream v1 types (a2a thread 0005).
 *
 * The envelope shape is FROZEN by the memory agent (0005 memory-03):
 *   stream stream_version seq family observed_at
 *   scope owner_id trace_id turn_id run_id
 *   payload display?
 *
 * - `seq` is the single total-order axis (the scrub position and resume
 *   cursor). It is a NUMBER, not an int: gateway host markers take
 *   fractional positions `base + n/1000`.
 * - `family` is hard-coded INCLUDING "host" (reserved in v1 for
 *   gateway-authored markers; never emitted by memory).
 * - Seq gaps under family filters or audience redaction are EXPECTED and
 *   carry no meaning — never data loss (0005 delta 3).
 * - Payloads are verbatim journal records (the ledger IS the stream); we
 *   type only the fields the view reads and carry the rest opaquely.
 */

export const REPLAY_STREAM = "abstractmemory.replay";
export const REPLAY_STREAM_VERSION = 1;

export const REPLAY_FAMILIES = [
  "event",
  "binding",
  "closure",
  "trace",
  "snapshot",
  "valence",
  "host",
] as const;

export type ReplayFamily = (typeof REPLAY_FAMILIES)[number];

/** Enrichment display block for record-bearing items (0005 §3). Diary
 * blocks arrive redacted at the engine source: `{"redacted": "diary"}`. */
export interface DisplayBlock {
  record_id?: string;
  kind?: string;
  title?: string;
  token_estimate?: number;
  redacted?: string;
  /** Formed records carry their graph id (0005 observer delta, additive).
   * CONTRACT DETAIL (memory, 0005 052948Z): in co_selected pair blocks,
   * EDGE members carry the SOURCE record's graph id by construction —
   * a pair's two graph_ids are the two ENDPOINTS' node identities. */
  graph_id?: string;
  /** Formation-time recorded edges on the formed record's binding
   * (0007 ask 2, accepted): "born linked" topology, display-only. */
  edges?: Array<{ relation?: string; target_graph_id?: string }>;
  /** co_selected events carry both pair members. */
  pair?: DisplayBlock[];
  /** Operator-audience diary resolution (gateway serving end, maintainer
   * ruling 2026-07-08): the redaction mark resolved into the entry's GIST
   * — title carries the one-line summary; full text stays one click away. */
  diary?: boolean;
  gist?: string | null;
  entry_kind?: string | null;
  entry_id?: string;
}

export interface ReplayEnvelope {
  stream: string;
  stream_version: number;
  seq: number;
  family: ReplayFamily;
  observed_at: string;
  scope: string;
  owner_id: string;
  trace_id: string | null;
  turn_id: string | null;
  run_id: string | null;
  payload: Record<string, unknown>;
  display?: DisplayBlock;
}

// ---- family payload views (fields the fold reads; everything else opaque) --

export interface EventPayload {
  kind: string; // selected | co_selected | pinned | silenced | refocus | listed | shown | expanded | cited
  scope: string;
  owner_id: string;
  record_id: string | null;
  pair_ids: [string, string] | null;
  weight: number;
  matched: boolean;
  trace_id: string | null;
  reason: string | null;
  event_id: string;
  seq: number;
}

export interface BindingPayload {
  record_id: string;
  scope: string;
  owner_id: string;
  search_state: string; // indexed | hidden
  prompt_state: string; // active | inactive
  lifecycle: string;
  source: string; // remember | election | operator | maintenance | revision
  reason: string | null;
  observed_at?: string;
  provenance?: Record<string, unknown>;
  binding_id: string;
  seq: number;
}

export interface ClosurePayload {
  assertion_id: string;
  kind: string; // retract | supersede
  reason: string;
  replacement_ids: string[];
  closure_id: string;
  seq: number;
}

export interface TracePayload {
  trace_id: string;
  trace_kind: string; // reconstruct | probe
  need: { cue_text?: string; turn_id?: string | null; view?: string } & Record<string, unknown>;
  searched_scopes: Array<{ scope?: string; owner_id?: string }>;
  channels: string[];
  candidates: Array<{ record_id: string; scores: Record<string, number> }>;
  selected: string[];
  dropped: Array<{ record_id: string; score?: number; reason?: string }>;
  cues: string[];
  stop_reason: string;
  warnings: string[];
  /** record_id -> admission label: "self" | "stm" | "stimulus" | "both". */
  admissions: Record<string, string>;
  seq: number;
}

export interface SnapshotDisplayRow {
  record_id: string;
  title?: string;
  digest?: string;
  token_estimate?: number;
}

export interface SnapshotPayload {
  snapshot_id: string;
  trace_id: string;
  used_record_ids: string[];
  display: SnapshotDisplayRow[];
  prompt_token_estimate: number | null;
  seq: number;
}

export interface ValencePayload {
  target_id: string;
  sign: 1 | -1;
  magnitude: number;
  kind: string; // appraisal | scar | healing | bond | break
  scope: string;
  owner_id: string;
  reason: string | null;
  actor: string;
  provenance: Record<string, unknown>;
  event_id: string;
  seq: number;
}

export interface HostPayload {
  kind: string; // summon | prelude_refused | session_closed (+ future)
  session_id?: string | null;
  [key: string]: unknown;
}

/** Admission labels and what they mean to a human (the WHY badges). */
export const ADMISSION_LABELS: Record<string, string> = {
  self: "identity — present by right",
  stm: "continuity — was just working with it",
  stimulus: "matched the stimulus",
  both: "matched + continuity",
};
