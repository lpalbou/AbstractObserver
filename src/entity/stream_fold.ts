/**
 * The pure fold: replay envelopes -> graph state.
 *
 * WHY A FOLD: the frozen stream v1 makes `seq` the single total-order axis,
 * so the view state at scrub position T is DEFINED as the fold of every
 * envelope with seq <= T — the engine's own `as_of` semantics applied
 * client-side. Offline replay, live tail, and time scrubbing are one code
 * path: forward = apply incrementally, backward = re-fold from zero
 * (cheap at current scale, and always truthful — there is no separate
 * "past state" approximation that can drift).
 *
 * The fold is a PURE READ of the stream. It never talks to a server; an
 * observer that renders a fold structurally cannot write to a mind.
 */

import type {
  BindingPayload,
  ClosurePayload,
  DisplayBlock,
  EventPayload,
  HostPayload,
  ReplayEnvelope,
  SnapshotPayload,
  TracePayload,
  ValencePayload,
} from "./stream_types";
import {
  ATTENTION_KINDS,
  DECAY_MARKER_KINDS,
  eventWeight,
  pushAttentionEvent,
  rekeyAttentionEvents,
  type AttentionEventLite,
} from "./temporal_activation";

// ---------------------------------------------------------------- state

export interface NodeState {
  /** Digest-assertion row id — the id usage events/traces/snapshots carry. */
  id: string;
  /** Graph id (ex:memory-…) when known from a binding record_id. */
  graph_id: string | null;
  kind: string; // value | purpose | trait | claim | memory | diary | …
  title: string;
  token_estimate: number;
  scope: string;
  owner_id: string;
  first_seq: number;
  /** observed_at of the envelope that created the node (birth time). */
  born_at: string;
  /** Latest binding fold (latest seq wins per record). */
  search_state: string;
  prompt_state: string;
  lifecycle: string;
  source: string;
  /** The maintainer's GLOBAL access count: absolute selected-use, never decays. */
  selected_count: number;
  last_selected_seq: number | null;
  /** Latest admission label seen for this record ("self"|"stm"|"stimulus"|"both"). */
  last_admission: string | null;
  /** Belief lifecycle: set once a closure names this record. */
  closed: { kind: string; reason: string; seq: number; replacement_ids: string[] } | null;
  /** The BOOK entry id (diary projections; from binding provenance) — the
   * operator diary door's key. */
  entry_id: string | null;
  /** Diary projections render content-free (engine-side redaction). */
  diary: boolean;
  redacted: boolean;
  pinned: boolean;
  silenced: boolean;
  /** Engine bookkeeping (engram marker, reembed marker): engine state, not
   * a memory — the engine keeps these off the self and off shelves; the
   * view must not draw them as identity (plan item 3, observer half). */
  bookkeeping: boolean;
  /** Maintenance act name when the record journals one ("reembed"). */
  maintenance: string | null;
  /** Interaction correlation (item 14): the shared moment this episode is
   * one perspective of. Data, never merged — the OTHER leg lives in the
   * other home's stream; this key is how views JOIN, streams never do. */
  visit_id: string | null;
}

export interface EdgeState {
  /** Canonical sorted pair key "a|b". */
  key: string;
  a: string;
  b: string;
  /** Global pair count (cumulative co_selected — never decays). */
  count: number;
  last_seq: number;
}

/** A formation-time recorded edge ("born linked"), from binding
 * display.edges enrichment (0007 ask 2, accepted by memory). Endpoints are
 * GRAPH ids — resolve through graph_to_row at read time, so node re-keys
 * never orphan them. Drawn faint ("known") vs lit usage trails. */
export interface StructuralEdge {
  key: string;
  source_graph_id: string;
  target_graph_id: string;
  relation: string;
  first_seq: number;
}

/** One valence event, kept in full for the inspector's detail view
 * (maintainer round 2: "see the details of the elements perceived
 * positive and negative"). Reasons are REQUIRED engine-side, so every
 * line is explainable. */
export interface FeelingEvent {
  kind: string; // appraisal | scar | healing | bond | break
  sign: number;
  magnitude: number;
  reason: string | null;
  seq: number;
  observed_at: string;
}

/** A standing (valence) target: person:…, tool:…, concept:…, or a record id.
 * Dual clamped channels per the affect charter: G+ and G- accumulate
 * separately so a hundred +1s and one -10 stay BOTH visible. */
export interface StandingState {
  target_id: string;
  positive: number; // G+ accumulated magnitude
  negative: number; // G- accumulated magnitude
  positive_count: number;
  negative_count: number;
  /** Active standing peaks (unresolved). Resolved peaks move to history. */
  scars: Array<{ event_id: string; reason: string | null; seq: number; magnitude: number }>;
  bonds: Array<{ event_id: string; reason: string | null; seq: number; magnitude: number }>;
  healed_count: number;
  broken_count: number;
  last_seq: number;
  last_reason: string | null;
  /** Full event history, oldest first (valence is rare; kept lossless). */
  events: FeelingEvent[];
}

/** One visual beat: a recall trace + its snapshot + same-turn events,
 * grouped by the envelope-level trace_id (0005 delta 1). */
export interface BeatState {
  trace_id: string;
  turn_id: string | null;
  cue_text: string;
  view: string;
  first_seq: number;
  last_seq: number;
  candidate_count: number;
  /** record ids selected by the trace (shelf membership). */
  selected: string[];
  /** record_id -> admission label — the WHY of context entry. */
  admissions: Record<string, string>;
  dropped: Array<{ record_id: string; reason?: string }>;
  /** What ACTUALLY entered the context (snapshot truth, when committed). */
  used_record_ids: string[];
  prompt_token_estimate: number | null;
  committed: boolean;
}

export interface SessionMarker {
  kind: string; // summon | prelude_refused | session_closed | …
  session_id: string | null;
  run_id: string | null;
  seq: number;
  observed_at: string;
  details: Record<string, unknown>;
}

/** A session boundary INFERRED from run_id changes in envelope correlation
 * keys. Home-direct sessions write no host markers (the standing gap), but
 * every driver turn stamps run_id — the first envelope of a new run_id is
 * an honest session boundary. Null run_ids (traces/snapshots) never break
 * a session. */
export interface InferredSession {
  run_id: string;
  first_seq: number;
  observed_at: string;
}

export interface FoldState {
  nodes: Map<string, NodeState>;
  edges: Map<string, EdgeState>;
  /** Formation-time edges (display enrichment); key = "src|relation|tgt". */
  structural_edges: Map<string, StructuralEdge>;
  standings: Map<string, StandingState>;
  beats: Map<string, BeatState>;
  /** Beats in first-seen order (render order for the ledger). */
  beat_order: string[];
  sessions: SessionMarker[];
  /** Sessions inferred from run_id changes (home-direct lives). */
  inferred_sessions: InferredSession[];
  /** The run_id of the latest envelope carrying one (session tracker). */
  current_run_id: string | null;
  /** Highest folded seq (the current scrub position). */
  seq: number;
  applied_count: number;
  /** graph_id -> digest row id (bindings carry graph ids; usage carries row ids). */
  graph_to_row: Map<string, string>;
  /** Recent pulse sources for animation: node id -> seq of last use. */
  last_event_seq: number;
  /** Bounded per-(scope|owner) attention-event windows — the input to the
   * TEMPORAL activation fold (two-count model: global counts live on
   * nodes/edges above and never decay; the temporal count is computed
   * from these windows and decays with activity). */
  attention: Map<string, AttentionEventLite[]>;
  /** observed_at of the newest attention event folded — the wall-clock
   * honesty anchor: activation decays by ACTIVITY, so a stopped life keeps
   * its last recall "warm" forever; the view must say how long ago that
   * head actually was (Castor measured: journal frozen 43h and the head
   * still glowed). */
  last_attention_at: string;
}

export function createFoldState(): FoldState {
  return {
    nodes: new Map(),
    edges: new Map(),
    structural_edges: new Map(),
    standings: new Map(),
    beats: new Map(),
    beat_order: [],
    sessions: [],
    inferred_sessions: [],
    current_run_id: null,
    seq: 0,
    applied_count: 0,
    graph_to_row: new Map(),
    last_event_seq: 0,
    attention: new Map(),
    last_attention_at: "",
  };
}

// ------------------------------------------------------------- helpers

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** When a node re-keys (graph id -> row id), edges created against the old
 * id must follow, or the view silently drops their traffic. */
function rekeyNodeInEdges(state: FoldState, oldId: string, newId: string): void {
  for (const [key, edge] of Array.from(state.edges.entries())) {
    if (edge.a !== oldId && edge.b !== oldId) continue;
    state.edges.delete(key);
    const a = edge.a === oldId ? newId : edge.a;
    const b = edge.b === oldId ? newId : edge.b;
    if (a === b) continue; // merged into a self-loop: drop
    const nk = edgeKey(a, b);
    const existing = state.edges.get(nk);
    if (existing) {
      existing.count += edge.count;
      existing.last_seq = Math.max(existing.last_seq, edge.last_seq);
    } else {
      state.edges.set(nk, { key: nk, a, b, count: edge.count, last_seq: edge.last_seq });
    }
  }
  // The attention windows reference the same ids — warmth must follow the
  // merge exactly like edge traffic does.
  rekeyAttentionEvents(state.attention, oldId, newId);
}

function displayOf(env: ReplayEnvelope): DisplayBlock {
  return env.display && typeof env.display === "object" ? env.display : {};
}

/** Node ids arrive in two namespaces: bindings carry GRAPH ids
 * (ex:memory-…), usage events/traces carry digest ROW ids. The display
 * block's record_id matches the payload's namespace, so we key nodes by
 * the id the envelope carries and merge when enrichment reveals the pair. */
function ensureNode(state: FoldState, id: string, seq: number, seed?: Partial<NodeState>): NodeState {
  let node = state.nodes.get(id);
  if (!node) {
    node = {
      id,
      graph_id: null,
      kind: "memory",
      title: "",
      token_estimate: 0,
      scope: "",
      owner_id: "",
      first_seq: seq,
      born_at: "",
      search_state: "indexed",
      prompt_state: "inactive",
      lifecycle: "none",
      source: "remember",
      selected_count: 0,
      last_selected_seq: null,
      last_admission: null,
      closed: null,
      entry_id: null,
      diary: false,
      redacted: false,
      pinned: false,
      silenced: false,
      bookkeeping: false,
      maintenance: null,
      visit_id: null,
    };
    state.nodes.set(id, node);
  }
  if (seed) Object.assign(node, seed);
  return node;
}

/** Canonical-text titles render "ex:… dcterms:abstract <prose>"; the prose
 * is the human title. Clean titles pass through unchanged. */
export function cleanTitle(title: string): string {
  const raw = String(title || "").trim();
  const m = raw.match(/^ex:[a-z]+-[0-9a-f]+\s+\S+\s+(.*)$/s);
  return (m ? m[1] : raw).trim();
}

/** Reified relation assertions (recorded edges) enrich as bare
 * "subject predicate" titles — no title attribute, no prose. They ARE part
 * of the usage topology (spreading traverses through them; hop pairs
 * deposit on them), so they render as small relation nodes labeled by the
 * predicate. */
export function relationPredicate(title: string): string | null {
  const m = String(title || "").trim().match(/^ex:[a-z]+-[0-9a-f]+\s+(\S+)$/);
  if (!m) return null;
  return m[1] === "dcterms:abstract" ? null : m[1];
}

/** Engine bookkeeping markers are kind="claim" records with load-bearing
 * title conventions (the engine itself matches "spark-engram v" in
 * prelude.py; the reembed marker titles "reembed: …"). Display-field
 * detection (`bookkeeping`/`maintenance`) is the contract asked of memory;
 * the title match is the labeled fallback for streams exported before the
 * fields ship. Pure so the ledger lines classify the same way. */
export function classifyBookkeeping(
  kind: string,
  title: string,
  display: DisplayBlock,
): { bookkeeping: boolean; maintenance: string | null } {
  if (display.bookkeeping === true) {
    const m = typeof display.maintenance === "string" && display.maintenance ? display.maintenance : null;
    return { bookkeeping: true, maintenance: m };
  }
  if (kind === "claim") {
    if (/^spark-engram v\d+/.test(title)) return { bookkeeping: true, maintenance: null };
    if (/^reembed:/.test(title)) return { bookkeeping: true, maintenance: "reembed" };
  }
  return { bookkeeping: false, maintenance: null };
}

function detectBookkeeping(node: NodeState, display: DisplayBlock): void {
  if (node.bookkeeping) return;
  const c = classifyBookkeeping(node.kind, node.title || "", display);
  if (c.bookkeeping) {
    node.bookkeeping = true;
    if (c.maintenance) node.maintenance = c.maintenance;
  }
}

function applyDisplayToNode(node: NodeState, display: DisplayBlock): void {
  if (display.redacted === "diary") {
    node.diary = true;
    node.redacted = true;
    if (!node.title) node.title = "diary entry";
    node.kind = "diary";
    return;
  }
  if (display.kind === "diary" || display.diary === true) {
    // Operator-audience serving (maintainer ruling 2026-07-08 21:39): the
    // gateway resolves the engine's redaction mark into the entry's GIST
    // for operator surfaces — a diary node WITH its one-line summary.
    node.diary = true;
    node.redacted = false;
    node.kind = "diary";
    if (display.entry_id && !node.entry_id) node.entry_id = display.entry_id;
    if (display.title) node.title = cleanTitle(display.title);
    return;
  }
  if (display.kind && (node.kind === "memory" || !node.kind)) node.kind = display.kind;
  if (display.title && !node.title) node.title = cleanTitle(display.title);
  if (typeof display.token_estimate === "number" && !node.token_estimate) {
    node.token_estimate = display.token_estimate;
  }
  if (typeof display.visit_id === "string" && display.visit_id && !node.visit_id) {
    node.visit_id = display.visit_id;
  }
  detectBookkeeping(node, display);
}

/** Bindings name records by graph id ("ex:diary-…" / "ex:memory-…"), which
 * also reveals diary-ness when the display block is redacted or absent. */
function isDiaryGraphId(id: string): boolean {
  return /(^|:)diary-/.test(id);
}

/** Distinct label for a diary node from ACT metadata only (never content):
 * "diary · Jul 7 06:10 · #d1817a". Identical "diary entry" labels made 38
 * distinct entries read as duplicates (maintainer concern (d), runtime's
 * forensics: strictly 1:1, zero repeats — a rendering illusion). */
function diaryLabel(graphId: string | null, bornAt: string): string {
  const tail = graphId ? graphId.replace(/^.*diary-/, "").slice(0, 6) : "";
  let when = "";
  if (bornAt) {
    const d = new Date(bornAt);
    if (!Number.isNaN(d.getTime())) {
      when = d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    }
  }
  return ["diary", when, tail ? `#${tail}` : ""].filter(Boolean).join(" · ");
}

function getStanding(state: FoldState, target_id: string, seq: number): StandingState {
  let s = state.standings.get(target_id);
  if (!s) {
    s = {
      target_id,
      positive: 0,
      negative: 0,
      positive_count: 0,
      negative_count: 0,
      scars: [],
      bonds: [],
      healed_count: 0,
      broken_count: 0,
      last_seq: seq,
      last_reason: null,
      events: [],
    };
    state.standings.set(target_id, s);
  }
  return s;
}

function getBeat(state: FoldState, trace_id: string, seq: number): BeatState {
  let beat = state.beats.get(trace_id);
  if (!beat) {
    beat = {
      trace_id,
      turn_id: null,
      cue_text: "",
      view: "",
      first_seq: seq,
      last_seq: seq,
      candidate_count: 0,
      selected: [],
      admissions: {},
      dropped: [],
      used_record_ids: [],
      prompt_token_estimate: null,
      committed: false,
    };
    state.beats.set(trace_id, beat);
    state.beat_order.push(trace_id);
  }
  beat.last_seq = Math.max(beat.last_seq, seq);
  return beat;
}

// ---------------------------------------------------------- appliers

function applyBinding(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as BindingPayload;
  const display = displayOf(env);
  const graphId = String(p.record_id || "");
  // Bindings key nodes by graph id; if a usage row id was already seen for
  // the same record we cannot know the pairing until enrichment reveals it,
  // so graph-id nodes and row-id nodes merge lazily via graph_to_row.
  const rowId = state.graph_to_row.get(graphId);
  const node = ensureNode(state, rowId ?? graphId, env.seq, {
    scope: p.scope,
    owner_id: p.owner_id,
  });
  if (!rowId) node.graph_id = graphId;
  if (!node.born_at) node.born_at = String(p.observed_at || env.observed_at || "");
  // The book entry id (diary projections): the operator diary door's key.
  const provenance = p.provenance && typeof p.provenance === "object" ? (p.provenance as Record<string, unknown>) : {};
  if (!node.entry_id && typeof provenance["entry_id"] === "string") {
    node.entry_id = provenance["entry_id"] as string;
  }
  node.search_state = String(p.search_state || node.search_state);
  node.prompt_state = String(p.prompt_state || node.prompt_state);
  node.lifecycle = String(p.lifecycle || node.lifecycle);
  node.source = String(p.source || node.source);
  applyDisplayToNode(node, display);
  if (isDiaryGraphId(graphId)) {
    node.diary = true;
    node.kind = "diary";
    // Operator-audience displays carry the gist as title (redacted=false
    // set by applyDisplayToNode); only UNRESOLVED entries fall back to the
    // act-only label.
    if (display.kind !== "diary" && display.diary !== true) {
      node.redacted = true;
      if (!node.title || node.title === "diary entry") node.title = diaryLabel(graphId, node.born_at);
    }
  }
  // Formation-time edges ("born linked" — 0007 ask 2 enrichment). Stored
  // by GRAPH ids; the renderer resolves rows at draw time.
  for (const e of Array.isArray(display.edges) ? display.edges : []) {
    const target = String(e?.target_graph_id || "").trim();
    if (!target) continue;
    const relation = String(e?.relation || "linked").trim() || "linked";
    const key = `${graphId}|${relation}|${target}`;
    if (!state.structural_edges.has(key)) {
      state.structural_edges.set(key, {
        key,
        source_graph_id: graphId,
        target_graph_id: target,
        relation,
        first_seq: env.seq,
      });
    }
  }
}

/** Extract the graph id a display/snapshot title reveals: canonical text
 * rows for DIGEST assertions render "ex:memory-… <predicate> <prose>" with
 * the graph subject first. The prose requirement matters: reified RELATION
 * rows render as bare "subject predicate" (their subject is the SOURCE
 * record's graph id — joining on it would corrupt the namespace map). */
function revealedGraphId(title: string): string | null {
  const m = String(title || "").match(/^(ex:[a-z]+-[0-9a-f]+)\s+\S+\s+\S/);
  return m ? m[1] : null;
}

/** Records live in TWO id namespaces: bindings carry GRAPH ids
 * (ex:memory-…), usage events/traces/snapshots carry digest ROW ids.
 * Since the 0005 observer delta the pairing is FIRST-CLASS: display
 * blocks carry `graph_id` for formed records. The canonical-text title
 * reveal stays as the fallback for pre-delta exports; either way the two
 * nodes merge on reveal — usage counts from the row side, binding
 * metadata from the graph side. */
function resolveUsageNode(state: FoldState, rowId: string, display: DisplayBlock, seq: number): NodeState {
  const graphId =
    (typeof display.graph_id === "string" && display.graph_id.trim() ? display.graph_id.trim() : null) ??
    revealedGraphId(String(display.title || ""));
  // EDGE rows carry the SOURCE record's graph_id BY CONSTRUCTION (memory,
  // 0005 052948Z) — their graph_id names another node's identity, never
  // their own. Two detections, either suffices:
  // 1. structural: one graph record has exactly ONE digest row, so a
  //    second row claiming an already-mapped graph id must be an edge row;
  // 2. title format: bare "subject predicate" canonical text (the only
  //    signal available in pre-delta exports).
  const mappedRow = graphId ? state.graph_to_row.get(graphId) : undefined;
  const isEdgeRow =
    (mappedRow !== undefined && mappedRow !== rowId) ||
    relationPredicate(String(display.title || "")) !== null;
  let node = state.nodes.get(rowId);

  if (!node && isEdgeRow && graphId) {
    // Merge edge traffic onto the source node when we already know its row.
    const sourceRow = state.graph_to_row.get(graphId);
    const sourceNode = sourceRow ? state.nodes.get(sourceRow) : state.nodes.get(graphId);
    if (sourceNode) return sourceNode;
  }

  if (!node) {
    const graphNode = graphId && !isEdgeRow ? state.nodes.get(graphId) : undefined;
    if (graphNode && graphId) {
      // Re-key the binding's node under its row id (usage ids are the
      // stream's dominant namespace; the graph id stays for reference).
      state.nodes.delete(graphId);
      graphNode.id = rowId;
      graphNode.graph_id = graphId;
      state.nodes.set(rowId, graphNode);
      state.graph_to_row.set(graphId, rowId);
      rekeyNodeInEdges(state, graphId, rowId);
      node = graphNode;
    } else {
      node = ensureNode(state, rowId, seq);
      if (graphId && !isEdgeRow) {
        node.graph_id = graphId;
        state.graph_to_row.set(graphId, rowId);
      }
    }
  } else if (graphId && !isEdgeRow && !node.graph_id) {
    // Late reveal: a row node born from an earlier event (clean title, no
    // subject prefix) now proves its graph identity — fold the binding
    // node's metadata in and drop the duplicate.
    const graphNode = state.nodes.get(graphId);
    if (graphNode && graphNode !== node) {
      node.graph_id = graphId;
      if (graphNode.kind !== "memory") node.kind = graphNode.kind;
      if (graphNode.title) node.title = graphNode.title;
      if (!node.scope) node.scope = graphNode.scope;
      if (!node.owner_id) node.owner_id = graphNode.owner_id;
      node.search_state = graphNode.search_state;
      node.prompt_state = graphNode.prompt_state;
      node.lifecycle = graphNode.lifecycle;
      node.source = graphNode.source;
      node.first_seq = Math.min(node.first_seq, graphNode.first_seq);
      node.diary = node.diary || graphNode.diary;
      node.redacted = node.redacted || graphNode.redacted;
      node.closed = node.closed ?? graphNode.closed;
      state.nodes.delete(graphId);
      rekeyNodeInEdges(state, graphId, rowId);
    } else {
      node.graph_id = graphId;
    }
    state.graph_to_row.set(graphId, rowId);
  }

  const predicate = relationPredicate(String(display.title || ""));
  if (predicate && node.kind === "memory" && !node.title) {
    node.kind = "relation";
    node.title = predicate;
  }
  if (isEdgeRow) {
    // Adopt only the relation naming above; the rest of the display block
    // (kind/title/graph_id) describes the SOURCE record, not this row.
    return node;
  }
  applyDisplayToNode(node, display);
  if (node.graph_id && isDiaryGraphId(node.graph_id)) {
    node.diary = true;
    node.kind = "diary";
    if (display.kind !== "diary" && display.diary !== true) {
      node.redacted = true;
      if (!node.title || node.title === "diary entry" || revealedGraphId(node.title)) {
        node.title = diaryLabel(node.graph_id, node.born_at);
      }
    }
  }
  return node;
}

function applyEvent(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as EventPayload;
  const kind = String(p.kind || "");
  const display = displayOf(env);
  // Attention window bookkeeping (temporal count): the scope STREAM key —
  // the engine scores per (scope, owner) with no cross-scope bleed, so a
  // busy life scope must never flush the self scope's recency.
  const scopeKey = `${String(p.scope || env.scope || "")}|${String(p.owner_id || env.owner_id || "")}`;
  const ttlRaw = (env.payload as Record<string, unknown>)["ttl_activity"];
  const ttl = typeof ttlRaw === "number" && Number.isFinite(ttlRaw) ? ttlRaw : null;
  if ((ATTENTION_KINDS.has(kind) || DECAY_MARKER_KINDS.has(kind)) && env.observed_at) {
    state.last_attention_at = env.observed_at;
  }

  if (kind === "co_selected" && Array.isArray(p.pair_ids) && p.pair_ids.length === 2) {
    // Hebbian trails are digest<->EDGE hops; edge members merge onto their
    // SOURCE record (0005 052948Z), so the two hop pairs of one recorded
    // edge become source<->source (a self-pair, dropped — no self-loops)
    // and source<->target (the association the view draws).
    const pairDisplays = Array.isArray(display.pair) ? display.pair : [];
    const endpoints = [String(p.pair_ids[0]), String(p.pair_ids[1])].map((rid) => {
      const d = pairDisplays.find((x) => x.record_id === rid) ?? {};
      return resolveUsageNode(state, rid, d, env.seq);
    });
    const [na, nb] = endpoints;
    if (na.id !== nb.id) {
      const key = edgeKey(na.id, nb.id);
      const edge = state.edges.get(key);
      if (edge) {
        edge.count += 1;
        edge.last_seq = env.seq;
      } else {
        state.edges.set(key, { key, a: na.id, b: nb.id, count: 1, last_seq: env.seq });
      }
      pushAttentionEvent(state.attention, scopeKey, {
        kind,
        record_id: null,
        pair_key: edgeKey(na.id, nb.id),
        weight: eventWeight(kind, p.weight),
        ttl_activity: null,
        seq: env.seq,
      });
    } else {
      // Merged self-pair: still real activity on the axis — occupies a
      // window slot (engine parity) but credits no rendered edge.
      pushAttentionEvent(state.attention, scopeKey, {
        kind,
        record_id: null,
        pair_key: null,
        weight: eventWeight(kind, p.weight),
        ttl_activity: null,
        seq: env.seq,
      });
    }
    state.last_event_seq = env.seq;
    return;
  }

  const rid = p.record_id ? String(p.record_id) : null;
  if (!rid) {
    // refocus: scope-level decay marker — occupies a window slot and
    // stretches older distances in the temporal fold; ledger-only visually.
    if (DECAY_MARKER_KINDS.has(kind)) {
      pushAttentionEvent(state.attention, scopeKey, {
        kind,
        record_id: null,
        pair_key: null,
        weight: 0,
        ttl_activity: null,
        seq: env.seq,
      });
    }
    return;
  }
  const node = resolveUsageNode(state, rid, display, env.seq);

  if (kind === "selected") {
    node.selected_count += 1;
    node.last_selected_seq = env.seq;
    state.last_event_seq = env.seq;
    if (env.trace_id) {
      const beat = state.beats.get(env.trace_id);
      if (beat) beat.last_seq = Math.max(beat.last_seq, env.seq);
    }
  } else if (kind === "pinned") {
    node.pinned = true;
  } else if (kind === "silenced") {
    node.silenced = true;
  }
  if (ATTENTION_KINDS.has(kind)) {
    pushAttentionEvent(state.attention, scopeKey, {
      kind,
      record_id: node.id,
      pair_key: null,
      weight: eventWeight(kind, p.weight),
      ttl_activity: ttl,
      seq: env.seq,
    });
  }
  // Audit kinds (listed/shown/expanded/cited) are structurally inert for
  // attention; the fold reads them only to reveal nodes early (already done
  // by resolveUsageNode) — reading is not using.
}

function applyTrace(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as TracePayload;
  const beat = getBeat(state, String(p.trace_id), env.seq);
  const need = p.need && typeof p.need === "object" ? p.need : {};
  beat.cue_text = String(need.cue_text ?? "");
  beat.turn_id = typeof need.turn_id === "string" ? need.turn_id : beat.turn_id;
  beat.view = String(need.view ?? "");
  beat.candidate_count = Array.isArray(p.candidates) ? p.candidates.length : 0;
  beat.selected = Array.isArray(p.selected) ? p.selected.map(String) : [];
  beat.admissions = p.admissions && typeof p.admissions === "object" ? { ...p.admissions } : {};
  beat.dropped = Array.isArray(p.dropped)
    ? p.dropped.map((d) => ({ record_id: String(d.record_id), reason: d.reason ? String(d.reason) : undefined }))
    : [];
  // Admission labels annotate nodes (presence != use: labels only).
  for (const [rid, admission] of Object.entries(beat.admissions)) {
    const node = state.nodes.get(rid);
    if (node) node.last_admission = String(admission);
  }
}

function applySnapshot(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as SnapshotPayload;
  const beat = getBeat(state, String(p.trace_id), env.seq);
  beat.used_record_ids = Array.isArray(p.used_record_ids) ? p.used_record_ids.map(String) : [];
  beat.prompt_token_estimate = typeof p.prompt_token_estimate === "number" ? p.prompt_token_estimate : null;
  beat.committed = true;
  // Snapshot display rows carry title+digest for what entered the context —
  // the richest node text in the stream; adopt for untitled nodes.
  for (const row of Array.isArray(p.display) ? p.display : []) {
    const rid = String(row.record_id || "");
    if (!rid) continue;
    resolveUsageNode(state, rid, { record_id: rid, title: row.title, token_estimate: row.token_estimate }, env.seq);
  }
}

function applyValence(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as ValencePayload;
  const target = String(p.target_id || "");
  if (!target) return;
  const s = getStanding(state, target, env.seq);
  const kind = String(p.kind || "appraisal");
  const magnitude = Number(p.magnitude || 0);
  const provenance = p.provenance && typeof p.provenance === "object" ? p.provenance : {};
  s.last_seq = env.seq;
  s.last_reason = p.reason ? String(p.reason) : s.last_reason;
  s.events.push({
    kind,
    sign: Number(p.sign) || 0,
    magnitude,
    reason: p.reason ? String(p.reason) : null,
    seq: env.seq,
    observed_at: env.observed_at,
  });

  if (kind === "appraisal") {
    if (Number(p.sign) >= 0) {
      s.positive += magnitude;
      s.positive_count += 1;
    } else {
      s.negative += magnitude;
      s.negative_count += 1;
    }
  } else if (kind === "scar") {
    s.scars.push({ event_id: String(p.event_id), reason: p.reason ?? null, seq: env.seq, magnitude });
  } else if (kind === "bond") {
    s.bonds.push({ event_id: String(p.event_id), reason: p.reason ?? null, seq: env.seq, magnitude });
  } else if (kind === "healing") {
    const heals = String(provenance["heals"] ?? "");
    const idx = s.scars.findIndex((x) => x.event_id === heals);
    if (idx >= 0) s.scars.splice(idx, 1);
    s.healed_count += 1;
  } else if (kind === "break") {
    const breaks = String(provenance["breaks"] ?? "");
    const idx = s.bonds.findIndex((x) => x.event_id === breaks);
    if (idx >= 0) s.bonds.splice(idx, 1);
    s.broken_count += 1;
  }
}

function applyClosure(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as ClosurePayload;
  const display = displayOf(env);
  const rid = String(p.assertion_id || "");
  if (!rid) return;
  const node = resolveUsageNode(state, rid, display, env.seq);
  // close_record closes the digest AND its edge assertions; edge-assertion
  // closures reference ids that never appeared as nodes — keep only the
  // first closure per visual node (the digest's), which arrives first.
  if (!node.closed) {
    node.closed = {
      kind: String(p.kind || "retract"),
      reason: String(p.reason || ""),
      seq: env.seq,
      replacement_ids: Array.isArray(p.replacement_ids) ? p.replacement_ids.map(String) : [],
    };
  }
}

function applyHost(state: FoldState, env: ReplayEnvelope): void {
  const p = env.payload as unknown as HostPayload;
  const { kind, session_id, ...details } = p;
  state.sessions.push({
    kind: String(kind || ""),
    session_id: session_id != null ? String(session_id) : null,
    run_id: env.run_id,
    seq: env.seq,
    observed_at: env.observed_at,
    details: details as Record<string, unknown>,
  });
}

// ------------------------------------------------------------ the fold

/** Apply ONE envelope. Envelopes must arrive in ascending seq order (the
 * stream contract); a stale seq is ignored loudly in dev via console. */
export function applyEnvelope(state: FoldState, env: ReplayEnvelope): void {
  if (typeof env.seq !== "number" || Number.isNaN(env.seq)) return;
  if (env.seq <= state.seq && state.applied_count > 0) {
    // Duplicate delivery (SSE reconnect overlap) — the fold is idempotent
    // only via this guard; the stream itself never re-issues a seq.
    return;
  }
  // Session inference from correlation keys: a NEW run_id marks a session
  // boundary (host markers cover gateway summons; run_ids cover the
  // home-direct lives that have none).
  if (env.run_id && env.run_id !== state.current_run_id) {
    state.current_run_id = env.run_id;
    state.inferred_sessions.push({ run_id: env.run_id, first_seq: env.seq, observed_at: env.observed_at });
  }
  switch (env.family) {
    case "binding":
      applyBinding(state, env);
      break;
    case "event":
      applyEvent(state, env);
      break;
    case "trace":
      applyTrace(state, env);
      break;
    case "snapshot":
      applySnapshot(state, env);
      break;
    case "valence":
      applyValence(state, env);
      break;
    case "closure":
      applyClosure(state, env);
      break;
    case "host":
      applyHost(state, env);
      break;
    default:
      // Unknown family in a NEWER stream version: skip visibly (dev only).
      break;
  }
  state.seq = env.seq;
  state.applied_count += 1;
}

/** Fold a prefix: every envelope with seq <= untilSeq (Infinity = all).
 * This IS the time scrub — state at T is the fold of the prefix at T. */
export function foldEnvelopes(envelopes: ReplayEnvelope[], untilSeq: number = Infinity): FoldState {
  const state = createFoldState();
  for (const env of envelopes) {
    if (env.seq > untilSeq) break;
    applyEnvelope(state, env);
  }
  return state;
}

/** Incremental fold cache (adversarial scale review, finding 2.1): a live
 * tail moves the scrub head forward one envelope at a time, and a full
 * refold per arrival is O(N) each = O(N²) cumulative — user-visible within
 * a day of 24/7 life. Forward moves now APPLY the delta; backward scrubs
 * and source switches rebuild (still the truthful prefix fold, just not
 * recomputed from zero when nothing behind the head changed). */
export interface FoldCache {
  state: FoldState;
  /** Index of the last applied envelope in the array the cache follows. */
  index: number;
  /** Seq of that envelope — validates that the array is a pure extension
   * of what was folded (live appends create new array identities). */
  last_seq: number;
}

export function foldUpToIndex(envelopes: ReplayEnvelope[], uptoIndex: number, cache: FoldCache | null): FoldCache {
  const target = Math.min(uptoIndex, envelopes.length - 1);
  const extendable =
    cache !== null &&
    cache.index <= target &&
    cache.index >= 0 &&
    cache.index < envelopes.length &&
    envelopes[cache.index]?.seq === cache.last_seq;
  if (extendable && cache) {
    for (let i = cache.index + 1; i <= target; i++) applyEnvelope(cache.state, envelopes[i]);
  }
  if (extendable && cache) {
    return { state: cache.state, index: target, last_seq: target >= 0 ? envelopes[target].seq : -1 };
  }
  const state = createFoldState();
  for (let i = 0; i <= target; i++) applyEnvelope(state, envelopes[i]);
  return { state, index: target, last_seq: target >= 0 ? envelopes[target].seq : -1 };
}
