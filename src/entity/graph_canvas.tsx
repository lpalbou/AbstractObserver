/**
 * Canvas renderer for the entity memory graph.
 *
 * Reads a FoldState + the current scrub seq and draws:
 * - nodes colored by class (identity gold, memories blue, diary green in
 *   its own lane, standing targets violet diamonds on the outer orbit);
 * - node size = GLOBAL selected count (the never-decaying count) — what
 *   mattered over a lifetime shapes the structure;
 * - green warmth (edge color, node bloom) = the TEMPORAL count — the
 *   engine's decaying activation, so green means "recently selected",
 *   never "selected often long ago" (the two-count model rendered:
 *   maintainer correction 2026-07-10 21:27);
 * - pulses on recent use, colored by WHY the memory entered context
 *   (identity present-by-right / continuity / matched);
 * - edges flash amber when just traveled;
 * - scar (red) and bond (warm) halos on standing targets;
 * - closed beliefs as ghosts.
 *
 * The renderer owns layout positions (persistent per node id) but never
 * owns truth: everything drawn derives from the fold at the scrub seq.
 */

import React, { useEffect, useRef, useState } from "react";

import type { FoldState, NodeState, StandingState } from "./stream_fold";
import { nodeWarmth, pairWarmth, type TemporalActivation } from "./temporal_activation";
import { DEFAULT_FORCE_PARAMS, hash01, maxVelocity, seedPosition, tickForces, type LayoutEdge, type LayoutNode } from "./force_layout";

export interface GraphCanvasProps {
  fold: FoldState;
  /** The decaying activation at the scrub position (computed from the
   * fold's attention windows — recomputed whenever the fold changes). */
  temporal: TemporalActivation;
  /** Current scrub position (seq); pulses measure recency against it. */
  scrubSeq: number;
  selectedId: string | null;
  /** Search matches (node ids): emphasized, everything else dims. Hover
   * uses the same emphasis mechanism with the hovered node's neighborhood
   * ("one mechanism, two triggers" — 0007 round 2 item 4). */
  searchIds: Set<string> | null;
  /** Stable key for layout persistence (entity slug or source label). */
  layoutKey: string | null;
  onSelect(id: string | null): void;
  height?: number;
}

export const IDENTITY_KINDS = new Set(["value", "purpose", "trait", "claim"]);

/** Mirror of the ENGINE's canonical record-kind set — root-exported as
 * `abstractmemory.MEMORY_RECORD_KINDS` (the one authoritative place;
 * engine validation vocabulary stays engine-owned, semantics c319 ruling).
 * SYNC-ON-WIDENING: when memory widens the set, diff against
 * `python -c "from abstractmemory import MEMORY_RECORD_KINDS; print(sorted(MEMORY_RECORD_KINDS))"`
 * and extend KIND_COLORS — the drift test fails if a canonical kind would
 * render as "unknown" gray (the diary_type-clamp gotcha class). */
export const ENGINE_RECORD_KINDS = [
  "answer",
  "claim",
  "decision",
  "diary",
  "dream",
  "episode",
  "instruction",
  "interest",
  "lesson",
  "memory",
  "plan",
  "purpose",
  "question",
  "summary",
  "trait",
  "value",
] as const;

export const KIND_COLORS: Record<string, string> = {
  identity: "#e7b45a",
  memory: "#6ea8d8",
  episode: "#6ea8d8", // lived exchanges are memories
  summary: "#4fb8a8", // consolidation products (0023)
  dream: "#8f7ce8", // what formed while nothing was running
  interest: "#a8c46a", // self-grown direction
  lesson: "#d89a5a",
  diary: "#7bc98c",
  question: "#d87ab0", // open questions — wake-reason kind, stands out
  answer: "#5aa9a0", // beside summary: a question resolved
  decision: "#c9705a",
  plan: "#5ab8d8",
  instruction: "#7a8fd8",
  standing: "#c084dd",
  relation: "#54657d",
  bookkeeping: "#5d6a7a", // engine acts (engram/reembed markers) — not memories
  unknown: "#8a94a6",
};

const ADMISSION_COLORS: Record<string, string> = {
  self: "#f0c060",
  stm: "#a58fe0",
  stimulus: "#59c2d8",
  both: "#6fd8b0",
};

/** Structural ("born linked") edges are TYPED; the type is encoded as a
 * dash pattern (color stays reserved for activation/usage), assigned
 * deterministically per relation name so the same relation always draws
 * the same way — and the legend can show the mapping. */
export const RELATION_DASH_PATTERNS: number[][] = [
  [6, 3],       // long dash
  [2, 3],       // dots
  [8, 3, 2, 3], // dash-dot
  [4, 4],       // even dash
  [1, 2],       // fine dots
  [10, 4],      // wide dash
];

export function relationDash(relation: string): number[] {
  return RELATION_DASH_PATTERNS[Math.floor(hash01(relation, 11) * RELATION_DASH_PATTERNS.length) % RELATION_DASH_PATTERNS.length];
}

/** Visible-but-quiet grey for typed topology (maintainer feedback: the
 * old rgba(90,110,138,0.22) was barely visible on the dark field). */
const STRUCTURAL_EDGE_COLOR = "rgba(148, 168, 194, 0.5)";
const STRUCTURAL_LABEL_COLOR = "rgba(160, 178, 200, 0.85)";

function nodeClass(node: NodeState): string {
  if (node.diary) return "diary";
  // Bookkeeping markers are kind="claim" like identity claims, but the
  // engine keeps them OFF the self (self_component excludes
  // attributes.bookkeeping) — drawing them on the identity ring would
  // misstate who he is. They seat with the free memories, in engine gray.
  if (node.bookkeeping) return "bookkeeping";
  if (IDENTITY_KINDS.has(node.kind)) return "identity";
  if (KIND_COLORS[node.kind]) return node.kind;
  return "unknown";
}

function nodeRadius(node: NodeState): number {
  const base = node.kind === "relation" ? 2.5 : 4;
  return base + Math.min(9, Math.log1p(node.selected_count) * 3);
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// World-space anchor geometry: CONSTANTS, never viewport/zoom-derived.
// The adversarial stability review's biggest find: anchors computed from
// viewR re-pulled the whole layout on every zoom and resize — spatial
// memory was being rewritten by the camera. World coordinates are the
// durable reference; the camera only looks at them.
const WORLD_IDENTITY_R = 110;
const WORLD_STANDING_R = 360;
const WORLD_DIARY_Y = 320;
const WORLD_DIARY_SLOT = 44;
/** Diary shelf wraps into rows: fixed-left slots at 57+ entries grew a
 * 2600px tail that smeared the whole layout (maintainer screenshot,
 * 2026-07-07 22:03). Wrapping keeps the lane BOUNDED; slots stay stable
 * per birth index, so old entries never move. */
const DIARY_SHELF_COLS = 14;
const DIARY_SHELF_ROW_H = 40;

/** Phyllotaxis seating for free memories (episodes/summaries/dreams/…):
 * seat i sits at golden-angle position — compact sunflower packing that
 * GROWS AT THE RIM. A memory's seat is assigned once at first sight and
 * never changes: permanent spatial memory with bounded growth, instead of
 * free-floating nodes that springs (written_amid, continues) can drag
 * into streaks. The force sim relaxes locally AROUND seats. */
const GOLDEN_ANGLE = 2.399963229728653;
const PHYLLO_INNER_R = 175; // outside the identity ring
// Nearest-neighbor distance ≈ spacing. At 48px the repulsion between two
// typical nodes is ~0.14 px/tick — a 0.1-strength anchor counters that
// within ~1.4px, so seats HOLD and the disc stays readable (at 30px the
// field inflated the disc into webs; verified live 2026-07-07).
const PHYLLO_SPACING = 48;

function phyllotaxisSeat(i: number): { x: number; y: number } {
  const r = PHYLLO_INNER_R + PHYLLO_SPACING * Math.sqrt(i);
  const a = i * GOLDEN_ANGLE;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** Layout persistence (P0-4): the same memory in the same place across
 * reloads. Positions are presentation, not truth — safe to persist.
 * v2: phyllotaxis seats + seat indexes (v1 free-float positions would
 * fight the new anchors). */
function layoutStorageKey(key: string): string {
  return `abstractobserver_entity_layout_v2:${key}`;
}

export function GraphCanvas({ fold, temporal, scrubSeq, selectedId, searchIds, layoutKey, onSelect, height }: GraphCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Map<string, LayoutNode>>(new Map());
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1.05 });
  const stateRef = useRef({ fold, temporal, scrubSeq, selectedId, searchIds });
  const hoverRef = useRef<string | null>(null);
  /** The small memory card beside the cursor (maintainer ask, 2026-07-08):
   * set when the hovered node CHANGES (never per mousemove — no jitter). */
  const [hoverCard, setHoverCard] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onSelectRef = useRef(onSelect);
  // Cooling state (P0-2/3): alpha decays toward freeze; arrivals reheat.
  const simRef = useRef({ alpha: 1, frozen: false, lastSaveAt: 0, autoFitDone: false, lastCount: 0, stableFrames: 0 });
  const reducedMotionRef = useRef(false);
  const [motionUi, setMotionUi] = useState<"live" | "frozen">("live");
  /** Phyllotaxis seat per node id — assigned once at first sight, kept
   * for the node's lifetime (and persisted): permanent spatial memory. */
  const seatRef = useRef<{ seats: Map<string, number>; next: number }>({ seats: new Map(), next: 0 });

  stateRef.current = { fold, temporal, scrubSeq, selectedId, searchIds };
  onSelectRef.current = onSelect;

  // Load persisted positions + seats once per layout key.
  useEffect(() => {
    layoutRef.current = new Map();
    seatRef.current = { seats: new Map(), next: 0 };
    simRef.current.alpha = 1;
    simRef.current.autoFitDone = false;
    if (!layoutKey) return;
    try {
      const raw = localStorage.getItem(layoutStorageKey(layoutKey));
      if (!raw) return;
      const stored = JSON.parse(raw) as {
        nodes?: Array<{ id: string; x: number; y: number }>;
        seats?: Array<[string, number]>;
        next?: number;
      };
      for (const s of stored.nodes ?? []) {
        layoutRef.current.set(s.id, { id: s.id, x: s.x, y: s.y, vx: 0, vy: 0, r: 4 });
      }
      for (const [key, seat] of stored.seats ?? []) {
        seatRef.current.seats.set(key, seat);
        seatRef.current.next = Math.max(seatRef.current.next, seat + 1);
      }
      if (typeof stored.next === "number") {
        seatRef.current.next = Math.max(seatRef.current.next, stored.next);
      }
      // Restored layouts start nearly settled: brief alpha to absorb drift.
      simRef.current.alpha = 0.15;
    } catch {
      // Corrupt storage: start fresh (positions are presentation only).
    }
  }, [layoutKey]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  // Center the camera on selection changes (P0-6: "find the node again").
  useEffect(() => {
    if (!selectedId) return;
    const ln = layoutRef.current.get(selectedId);
    if (ln) {
      cameraRef.current.x = ln.x;
      cameraRef.current.y = ln.y;
    }
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = () => {
      if (disposed) return;
      const { fold, temporal, scrubSeq, selectedId, searchIds } = stateRef.current;
      const layout = layoutRef.current;
      const sim = simRef.current;

      // ---- sync layout population with the fold (stable world anchors) --
      // The fold is already prefix-limited to the scrub seq, so everything
      // in it exists "now"; layout only mirrors membership. Anchors are
      // WORLD constants: zoom/resize never move a single node.
      const diaryLane: LayoutNode[] = [];
      const liveIds = new Set<string>();
      const seats = seatRef.current;
      let arrivals = 0;
      for (const node of fold.nodes.values()) {
        liveIds.add(node.id);
        let ln = layout.get(node.id);
        const cls = nodeClass(node);
        const isFree = cls !== "identity" && cls !== "diary";
        // Every free memory gets a PERMANENT phyllotaxis seat at first
        // sight — compact sunflower packing, grows at the rim, never
        // rearranges (the fixed-slot diary tail + free-floating episodes
        // smeared the layout once written_amid edges landed). Seats key
        // on graph_id when known: row-id re-keys must not reseat a node.
        const seatKey = node.graph_id ?? node.id;
        if (isFree && !seats.seats.has(seatKey)) {
          // graph_id learned after first sight: migrate the row-id seat
          // instead of assigning a new one (the node must not jump).
          const rowSeat = seats.seats.get(node.id);
          if (seatKey !== node.id && rowSeat !== undefined) {
            seats.seats.set(seatKey, rowSeat);
          } else {
            seats.seats.set(seatKey, seats.next);
            seats.next += 1;
          }
        }
        if (!ln) {
          const seat = isFree ? phyllotaxisSeat(seats.seats.get(seatKey) ?? 0) : null;
          const seed = seat ?? seedPosition(node.id, WORLD_IDENTITY_R);
          ln = { id: node.id, x: seed.x, y: seed.y, vx: 0, vy: 0, r: nodeRadius(node) };
          layout.set(node.id, ln);
          arrivals += 1;
        }
        ln.r = nodeRadius(node);
        if (cls === "identity") {
          const angle = hash01(node.id, 7) * Math.PI * 2;
          ln.anchor = { x: Math.cos(angle) * WORLD_IDENTITY_R, y: Math.sin(angle) * WORLD_IDENTITY_R, strength: 0.02 };
        } else if (cls === "diary") {
          diaryLane.push(ln);
        } else {
          // Strength 0.1 beats the spring cap (1.6) at ~16px displacement:
          // springs can pull a node toward its relations by a visible nudge,
          // but the seat owns the position (readable, stable disc).
          const seat = phyllotaxisSeat(seats.seats.get(seatKey) ?? 0);
          ln.anchor = { x: seat.x, y: seat.y, strength: 0.1 };
        }
      }
      // Lane radius: the phyllotaxis disc grows as sqrt(seats), so outer
      // lanes derive from the MONOTONIC seat counter, quantized to 80px
      // steps — they step outward rarely and never move back in.
      const discR = PHYLLO_INNER_R + PHYLLO_SPACING * Math.sqrt(Math.max(1, seats.next));
      const laneR = Math.max(WORLD_STANDING_R, Math.ceil((discR + 70) / 80) * 80);
      // The diary SHELF: fixed slots by birth order, WRAPPED into rows —
      // bounded width; existing entries never move; new rows grow down.
      diaryLane.sort((a, b) => (fold.nodes.get(a.id)?.first_seq ?? 0) - (fold.nodes.get(b.id)?.first_seq ?? 0));
      const shelfWidth = DIARY_SHELF_COLS * WORLD_DIARY_SLOT;
      diaryLane.forEach((ln, i) => {
        const col = i % DIARY_SHELF_COLS;
        const row = Math.floor(i / DIARY_SHELF_COLS);
        ln.anchor = {
          x: col * WORLD_DIARY_SLOT - shelfWidth / 2,
          y: Math.max(WORLD_DIARY_Y, laneR + 40) + row * DIARY_SHELF_ROW_H,
          strength: 0.06,
        };
      });
      // Standing targets: feelings about a RECORD attach to its node; free
      // identity strings orbit the top arc at a HASH-STABLE angle — a new
      // feeling never rearranges the existing ones.
      const recordStanding = new Map<string, StandingState>();
      for (const standing of fold.standings.values()) {
        const t = standing.target_id;
        const rowId = fold.graph_to_row.get(t) ?? t;
        const targetNode = fold.nodes.get(rowId);
        if (targetNode) {
          recordStanding.set(targetNode.id, standing);
          continue;
        }
        const id = `standing:${t}`;
        liveIds.add(id);
        let ln = layout.get(id);
        if (!ln) {
          ln = { id, x: 0, y: -laneR, vx: 0, vy: 0, r: 6 };
          layout.set(id, ln);
          arrivals += 1;
        }
        const arc = Math.PI * 0.9;
        const angle = -Math.PI / 2 - arc / 2 + arc * hash01(t, 9);
        ln.anchor = { x: Math.cos(angle) * laneR, y: Math.sin(angle) * laneR, strength: 0.06 };
      }
      for (const id of Array.from(layout.keys())) {
        if (!liveIds.has(id)) layout.delete(id);
      }

      // Edges: the fold is prefix-limited, so every edge in it exists now.
      const edges: LayoutEdge[] = [];
      for (const e of fold.edges.values()) {
        if (!layout.has(e.a) || !layout.has(e.b)) continue;
        edges.push({ a: e.a, b: e.b, weight: e.count });
      }
      // Structural ("born linked") edges: weak springs + faint draw. Graph
      // ids resolve through graph_to_row at draw time (re-key safe).
      const structuralResolved: Array<{ a: string; b: string; relation: string }> = [];
      for (const se of fold.structural_edges.values()) {
        const a = fold.graph_to_row.get(se.source_graph_id) ?? se.source_graph_id;
        const b = fold.graph_to_row.get(se.target_graph_id) ?? se.target_graph_id;
        if (!layout.has(a) || !layout.has(b) || a === b) continue;
        structuralResolved.push({ a, b, relation: se.relation });
        edges.push({ a, b, weight: 0.4 });
      }

      // ---- cooling: place with energy, then HOLD STILL (P0-2/3) ----
      // Arrivals reheat gently (skipped under prefers-reduced-motion:
      // neighbor seeding already placed them sensibly).
      if (arrivals > 0 && !reducedMotionRef.current && !sim.frozen) {
        sim.alpha = Math.max(sim.alpha, 0.25);
      }
      const nodes = Array.from(layout.values());
      if (!sim.frozen && sim.alpha > 0.02) {
        tickForces(nodes, edges, DEFAULT_FORCE_PARAMS, Math.min(1, sim.alpha));
        sim.alpha *= maxVelocity(nodes) < 0.05 ? 0.85 : 0.995;
      }
      // One-time auto-fit once the graph has substance AND membership has
      // settled (~0.5s without new nodes): fitting on the first few
      // envelopes framed a half-loaded world.
      if (!sim.autoFitDone && nodes.length > 3) {
        sim.stableFrames = nodes.length === sim.lastCount ? sim.stableFrames + 1 : 0;
        sim.lastCount = nodes.length;
      }
      if (!sim.autoFitDone && nodes.length > 3 && sim.stableFrames >= 30) {
        sim.autoFitDone = true;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
          minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
          minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
        }
        const rect = canvas.getBoundingClientRect();
        const cam0 = cameraRef.current;
        cam0.x = (minX + maxX) / 2;
        cam0.y = (minY + maxY) / 2;
        const spanX = Math.max(120, maxX - minX + 160);
        const spanY = Math.max(120, maxY - minY + 160);
        cam0.zoom = Math.min(6, Math.max(0.12, Math.min(rect.width / spanX, rect.height / spanY)));
      }
      // Persist settled positions (debounced): same memory, same place,
      // across reloads.
      const nowMs = performance.now();
      if (layoutKey && sim.alpha <= 0.02 && nowMs - sim.lastSaveAt > 5000) {
        sim.lastSaveAt = nowMs;
        try {
          localStorage.setItem(
            layoutStorageKey(layoutKey),
            JSON.stringify({
              nodes: nodes.map((n) => ({
                id: n.id,
                x: Math.round(n.x * 10) / 10,
                y: Math.round(n.y * 10) / 10,
              })),
              seats: Array.from(seats.seats.entries()),
              next: seats.next,
            }),
          );
        } catch {
          // Quota/private mode: persistence is best-effort presentation.
        }
      }

      // ------------------------------------------------ draw
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cam = cameraRef.current;
      const toScreen = (x: number, y: number) => ({
        x: w / 2 + (x - cam.x) * cam.zoom,
        y: h / 2 + (y - cam.y) * cam.zoom,
      });

      // Edge recency window: measured in seq distance (truthful under scrub).
      const pulseWindow = 14;

      // Emphasis: search matches win; otherwise the hovered/selected node's
      // neighborhood. Everything outside the emphasis set dims.
      let emphasis: Set<string> | null = null;
      if (searchIds && searchIds.size > 0) {
        emphasis = searchIds;
      } else {
        const focus = hoverRef.current ?? selectedId;
        if (focus && layout.has(focus)) {
          emphasis = new Set([focus]);
          for (const e of fold.edges.values()) {
            if (e.a === focus) emphasis.add(e.b);
            if (e.b === focus) emphasis.add(e.a);
          }
          for (const se of structuralResolved) {
            if (se.a === focus) emphasis.add(se.b);
            if (se.b === focus) emphasis.add(se.a);
          }
        }
      }
      const nodeDim = (id: string) => (emphasis && !emphasis.has(id) ? 0.15 : 1);
      const edgeDim = (a: string, b: string) => (emphasis && !(emphasis.has(a) && emphasis.has(b)) ? 0.12 : 1);

      // "Born linked" topology first — typed dashes under the usage trails.
      // Dash pattern encodes the relation TYPE (color stays activation's);
      // relation labels draw at readable zoom or when an endpoint is
      // selected, at the edge midpoint.
      const labelEdges = cam.zoom > 1.7;
      for (const se of structuralResolved) {
        const la = layout.get(se.a);
        const lb = layout.get(se.b);
        if (!la || !lb) continue;
        const a = toScreen(la.x, la.y);
        const b = toScreen(lb.x, lb.y);
        const dim = edgeDim(se.a, se.b);
        ctx.globalAlpha = dim;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.setLineDash(relationDash(se.relation));
        ctx.strokeStyle = STRUCTURAL_EDGE_COLOR;
        ctx.lineWidth = 1;
        ctx.stroke();
        const focus = hoverRef.current ?? selectedId;
        const touchesFocus = focus !== null && (se.a === focus || se.b === focus);
        if ((labelEdges || touchesFocus) && dim === 1) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          ctx.setLineDash([]);
          ctx.font = "9px Menlo, Monaco, monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = STRUCTURAL_LABEL_COLOR;
          ctx.fillText(se.relation, mx, my - 3);
        }
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]);

      // Trail intensity is COLOR, not just alpha (maintainer, 2026-07-10
      // 20:50, the fork monitor as the bar) — and the color keys on the
      // TEMPORAL count (maintainer correction 21:27): green means "these
      // two served a recent moment together", decaying with activity like
      // the engine's trail activation. Width and base alpha stay GLOBAL
      // (lifetime co-use = structure); the amber flash stays the "just
      // traveled" overlay. A trail deep in lifetime count but cold now
      // renders grey — history is the shape, warmth is the color.
      const trailColor = (t: number, alpha: number) => {
        const r = Math.round(148 + (126 - 148) * t);
        const g = Math.round(168 + (220 - 168) * t);
        const bl = Math.round(194 + (160 - 194) * t);
        return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
      };
      for (const e of fold.edges.values()) {
        const la = layout.get(e.a);
        const lb = layout.get(e.b);
        if (!la || !lb) continue;
        const a = toScreen(la.x, la.y);
        const b = toScreen(lb.x, lb.y);
        const age = scrubSeq - e.last_seq;
        const recent = age >= 0 && age <= pulseWindow ? 1 - age / pulseWindow : 0;
        const warmth = pairWarmth(temporal.pairs.get(e.key) ?? 0);
        // One-time co-use stays a whisper (0.09); lifetime depth brightens
        // the line, recent warmth greens it — otherwise 200 count-1 edges
        // read as a hairball and a deep trail reads no different from a
        // shallow one. Warm trails get an alpha floor so a cold-but-deep
        // history never outshines what is actually happening now.
        const baseAlpha = Math.max(
          e.count <= 1 ? 0.09 : Math.min(0.6, 0.14 + Math.log1p(e.count) * 0.12),
          warmth * 0.55,
        );
        ctx.globalAlpha = edgeDim(e.a, e.b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (recent > 0) {
          ctx.strokeStyle = `rgba(232, 165, 74, ${0.25 + recent * 0.6})`;
          ctx.lineWidth = 1 + recent * 1.6 + Math.log1p(e.count) * 0.4;
        } else {
          ctx.strokeStyle = trailColor(warmth, baseAlpha);
          ctx.lineWidth = 0.8 + Math.log1p(e.count) * 0.4;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const drawHalo = (x: number, y: number, r: number, color: string) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // Standing targets (violet diamonds + scar/bond halos). Targets may
      // be free identity strings ("person:albou") or RECORD ids — resolve
      // record targets to their node's title, and only label the diamonds
      // that carry signal (hover/selection/peaks) to keep big lives legible.
      for (const standing of fold.standings.values()) {
        const ln = layout.get(`standing:${standing.target_id}`);
        if (!ln) continue; // record-targeted feelings render on their node below
        const p = toScreen(ln.x, ln.y);
        const r = (5 + Math.min(6, Math.log1p(standing.positive + standing.negative) * 2)) * cam.zoom * 0.8;
        const isSelected = selectedId === `standing:${standing.target_id}`;
        const isHovered = hoverRef.current === `standing:${standing.target_id}`;
        const standingDim = nodeDim(`standing:${standing.target_id}`);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = KIND_COLORS.standing;
        ctx.globalAlpha = 0.9 * standingDim;
        ctx.fillRect(-r / 1.5, -r / 1.5, (r / 1.5) * 2, (r / 1.5) * 2);
        ctx.restore();
        ctx.globalAlpha = standingDim;
        if (standing.scars.length > 0) drawHalo(p.x, p.y, r + 5, "rgba(224, 85, 85, 0.9)");
        if (standing.bonds.length > 0) drawHalo(p.x, p.y, r + (standing.scars.length ? 9 : 5), "rgba(240, 192, 96, 0.9)");
        if (isSelected || isHovered) {
          drawHalo(p.x, p.y, r + 12, "rgba(255,255,255,0.7)");
        }
        const hasPeaks = standing.scars.length > 0 || standing.bonds.length > 0;
        if ((isSelected || isHovered || hasPeaks || !standing.target_id.startsWith("ex:")) && standingDim === 1) {
          let label = standing.target_id;
          if (label.startsWith("ex:")) {
            const rowId = fold.graph_to_row.get(label);
            const target = rowId ? fold.nodes.get(rowId) : fold.nodes.get(label);
            label = target?.redacted ? "a diary entry" : target?.title || `${label.slice(0, 18)}…`;
          }
          if (label.length > 34) label = `${label.slice(0, 33)}…`;
          ctx.fillStyle = "rgba(200, 190, 220, 0.85)";
          ctx.font = `${Math.max(9, 10 * cam.zoom * 0.7)}px Menlo, Monaco, monospace`;
          ctx.textAlign = "center";
          ctx.fillText(label, p.x, p.y - r - 8);
        }
        ctx.globalAlpha = 1;
      }

      // Memory nodes.
      for (const node of fold.nodes.values()) {
        const ln = layout.get(node.id);
        if (!ln) continue;
        const p = toScreen(ln.x, ln.y);
        const r = Math.max(2.5, ln.r * cam.zoom * 0.75);
        const cls = nodeClass(node);
        const color = KIND_COLORS[cls] ?? KIND_COLORS.unknown;
        const isGhost = node.closed !== null || node.search_state === "hidden";
        const isSelected = selectedId === node.id;
        const isHover = hoverRef.current === node.id;
        const dim = nodeDim(node.id);
        ctx.globalAlpha = dim;

        // Use pulse: seq-distance from the scrub head, colored by WHY.
        const lastUse = node.last_selected_seq;
        if (lastUse !== null && lastUse <= scrubSeq) {
          const age = scrubSeq - lastUse;
          if (age <= pulseWindow) {
            const intensity = 1 - age / pulseWindow;
            const admissionColor = ADMISSION_COLORS[node.last_admission ?? ""] ?? "rgba(232,165,74,1)";
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 3 + intensity * 9, 0, Math.PI * 2);
            ctx.strokeStyle = admissionColor;
            ctx.globalAlpha = intensity * 0.65 * dim;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = dim;
          }
        }

        // Selection bloom (maintainer, 2026-07-10 20:50; corrected 21:27):
        // a memory GLOWS green behind its kind color when it is WARM —
        // the TEMPORAL activation (decays with activity), not the lifetime
        // count. A record selected 300 times over a life but not recently
        // shows no bloom; size already carries its lifetime weight. Drawn
        // UNDER the fill so the kind color stays crisp.
        const warmth = nodeWarmth(temporal.records.get(node.id) ?? 0);
        if (!isGhost && warmth > 0.02) {
          const bloomR = r * (1.7 + warmth * 1.5);
          const glow = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, bloomR);
          glow.addColorStop(0, `rgba(110, 220, 160, ${0.12 + warmth * 0.4})`);
          glow.addColorStop(1, "rgba(110, 220, 160, 0)");
          ctx.beginPath();
          ctx.arc(p.x, p.y, bloomR, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        if (isGhost) {
          ctx.globalAlpha = 0.35 * dim;
          ctx.fillStyle = "#232a35";
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = dim;
        } else {
          ctx.fillStyle = color;
          ctx.fill();
          if (node.diary) {
            ctx.strokeStyle = "rgba(20, 40, 26, 0.9)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        if (node.pinned) drawHalo(p.x, p.y, r + 4, "rgba(240, 220, 140, 0.8)");
        if (node.silenced) drawHalo(p.x, p.y, r + 4, "rgba(120, 120, 130, 0.8)");
        // Feelings ABOUT this record: a violet ring, scar/bond accents.
        const feeling = recordStanding.get(node.id);
        if (feeling) {
          drawHalo(p.x, p.y, r + 3.5, "rgba(192, 132, 221, 0.75)");
          if (feeling.scars.length > 0) drawHalo(p.x, p.y, r + 7, "rgba(224, 85, 85, 0.9)");
          if (feeling.bonds.length > 0) drawHalo(p.x, p.y, r + (feeling.scars.length ? 10.5 : 7), "rgba(240, 192, 96, 0.9)");
        }
        if (isSelected || isHover) drawHalo(p.x, p.y, r + 6, "rgba(255,255,255,0.75)");

        if ((isHover || isSelected || (cam.zoom > 2.4 && dim === 1) || (emphasis !== null && emphasis.size <= 25 && dim === 1)) && node.title) {
          ctx.fillStyle = "rgba(226, 232, 240, 0.92)";
          ctx.font = `${Math.max(9, 10 * Math.min(1.2, cam.zoom * 0.6))}px Menlo, Monaco, monospace`;
          ctx.textAlign = "center";
          const label = node.title.length > 42 ? `${node.title.slice(0, 41)}…` : node.title;
          ctx.fillText(label, p.x, p.y - r - 6);
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // ----------------------------------------------------- interactions
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const cam = cameraRef.current;
      return {
        x: (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x,
        y: (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y,
      };
    };
    const hitTest = (clientX: number, clientY: number): string | null => {
      const { x, y } = toWorld(clientX, clientY);
      let best: string | null = null;
      let bestD = Infinity;
      for (const ln of layoutRef.current.values()) {
        const dx = ln.x - x;
        const dy = ln.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const hitR = Math.max(9, ln.r + 5);
        if (d < hitR && d < bestD) {
          best = ln.id;
          bestD = d;
        }
      }
      return best;
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const cam = cameraRef.current;
      // Cursor-anchored zoom (P0-5): the world point under the cursor
      // stays under the cursor — zooming never loses the reference.
      const before = toWorld(ev.clientX, ev.clientY);
      const factor = Math.exp(-ev.deltaY * 0.0016);
      cam.zoom = Math.min(6, Math.max(0.35, cam.zoom * factor));
      const after = toWorld(ev.clientX, ev.clientY);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    };
    const onDown = (ev: MouseEvent) => {
      dragRef.current = { x: ev.clientX, y: ev.clientY, moved: false };
      setHoverCard(null);
    };
    // Drag pans ride the WINDOW (a pan must keep following the cursor after
    // it leaves the canvas mid-drag); hover hit-testing rides the CANVAS
    // ELEMENT only — overlaying panels (chat drawer, inspector, modals)
    // capture the pointer above it, so a node hidden behind the chat can
    // never raise a hovercard through it (maintainer, 2026-07-09 03:14).
    const onWindowDragMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const cam = cameraRef.current;
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      drag.x = ev.clientX;
      drag.y = ev.clientY;
    };
    const onCanvasHover = (ev: MouseEvent) => {
      if (dragRef.current) return; // mid-drag: no hover churn
      const hit = hitTest(ev.clientX, ev.clientY);
      if (hit !== hoverRef.current) {
        hoverRef.current = hit;
        setHoverCard(hit ? { id: hit, x: ev.clientX, y: ev.clientY } : null);
      }
      canvas.style.cursor = hoverRef.current ? "pointer" : "grab";
    };
    const onCanvasLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        setHoverCard(null);
      }
      canvas.style.cursor = "grab";
    };
    const onUp = (ev: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && !drag.moved) {
        onSelectRef.current(hitTest(ev.clientX, ev.clientY));
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onCanvasHover);
    canvas.addEventListener("mouseleave", onCanvasLeave);
    window.addEventListener("mousemove", onWindowDragMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onCanvasHover);
      canvas.removeEventListener("mouseleave", onCanvasLeave);
      window.removeEventListener("mousemove", onWindowDragMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const hoverNode = hoverCard ? fold.nodes.get(hoverCard.id) ?? null : null;
  const hoverStanding = hoverCard && !hoverNode && hoverCard.id.startsWith("standing:")
    ? fold.standings.get(hoverCard.id.slice("standing:".length)) ?? null
    : null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="entity_graph_canvas"
        style={{ width: "100%", height: height ? `${height}px` : "100%", display: "block" }}
      />
      {hoverCard && (hoverNode || hoverStanding) ? (
        <div
          className="gc_hovercard"
          style={{
            left: Math.min(hoverCard.x + 16, window.innerWidth - 300),
            top: Math.min(hoverCard.y + 12, window.innerHeight - 190),
          }}
        >
          {hoverNode ? (
            <>
              <div className="gc_hc_head">
                <span className={`ei_kind ei_kind_${hoverNode.diary ? "diary" : hoverNode.kind}`}>
                  {hoverNode.diary ? "diary" : hoverNode.kind}
                </span>
                <span className="gc_hc_title">{hoverNode.redacted ? "a diary entry" : hoverNode.title || hoverNode.id.slice(0, 22)}</span>
              </div>
              <div className="gc_hc_rows">
                <span>used</span>
                <span>
                  {hoverNode.selected_count} time{hoverNode.selected_count === 1 ? "" : "s"} (lifetime)
                  {hoverNode.last_admission ? ` · admitted as ${hoverNode.last_admission}` : ""}
                </span>
                <span>warm</span>
                <span>
                  {(temporal.records.get(hoverNode.id) ?? 0) > 0.05
                    ? `${(temporal.records.get(hoverNode.id) ?? 0).toFixed(1)} now (recent selections; decays)`
                    : "cold (not recently selected)"}
                </span>
                <span>scope</span>
                <span>{hoverNode.scope}</span>
                <span>born</span>
                <span>
                  {hoverNode.born_at ? hoverNode.born_at.slice(0, 16).replace("T", " ") : "?"} · seq {hoverNode.first_seq}
                </span>
                <span>state</span>
                <span>
                  {hoverNode.search_state}/{hoverNode.prompt_state}
                  {hoverNode.token_estimate ? ` · ~${hoverNode.token_estimate} tok` : ""}
                </span>
              </div>
              {hoverNode.closed ? (
                <div className="gc_hc_note">closed: {hoverNode.closed.kind} — {hoverNode.closed.reason}</div>
              ) : null}
              <div className="gc_hc_hint">click to open</div>
            </>
          ) : hoverStanding ? (
            <>
              <div className="gc_hc_head">
                <span className="ei_kind ei_kind_standing">standing</span>
                <span className="gc_hc_title">{hoverStanding.target_id}</span>
              </div>
              <div className="gc_hc_rows">
                <span>feelings</span>
                <span>+{hoverStanding.positive.toFixed(1)} / −{hoverStanding.negative.toFixed(1)}</span>
                <span>marks</span>
                <span>
                  {hoverStanding.bonds.length} bond{hoverStanding.bonds.length === 1 ? "" : "s"} · {hoverStanding.scars.length} scar{hoverStanding.scars.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="gc_hc_hint">click to open</div>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="gc_motion_controls">
        <button
          className={`gc_btn ${motionUi === "frozen" ? "gc_btn_on" : ""}`}
          title={motionUi === "frozen" ? "Layout frozen — click to let it move again" : "Freeze the layout (nodes hold still)"}
          onClick={() => {
            simRef.current.frozen = !simRef.current.frozen;
            setMotionUi(simRef.current.frozen ? "frozen" : "live");
          }}
        >
          {motionUi === "frozen" ? "🧊" : "🌊"}
        </button>
        <button
          className="gc_btn"
          title="Settle now — stop remaining motion"
          onClick={() => {
            simRef.current.alpha = 0;
          }}
        >
          ⚓
        </button>
        <button
          className="gc_btn"
          title="Reset layout — forget saved positions and re-place every node"
          onClick={() => {
            if (layoutKey) {
              try {
                localStorage.removeItem(layoutStorageKey(layoutKey));
              } catch {
                // best-effort
              }
            }
            layoutRef.current = new Map();
            seatRef.current = { seats: new Map(), next: 0 };
            simRef.current.alpha = 1;
            simRef.current.frozen = false;
            setMotionUi("live");
          }}
        >
          ♻️
        </button>
        <button
          className="gc_btn"
          title="Fit view — recenter the camera on the whole graph"
          onClick={() => {
            const nodes = Array.from(layoutRef.current.values());
            if (nodes.length === 0) return;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const n of nodes) {
              minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
              minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
            }
            const canvas = canvasRef.current;
            const rect = canvas?.getBoundingClientRect();
            const cam = cameraRef.current;
            cam.x = (minX + maxX) / 2;
            cam.y = (minY + maxY) / 2;
            if (rect) {
              const spanX = Math.max(120, maxX - minX + 120);
              const spanY = Math.max(120, maxY - minY + 120);
              cam.zoom = Math.min(6, Math.max(0.12, Math.min(rect.width / spanX, rect.height / spanY)));
            }
          }}
        >
          🎯
        </button>
      </div>
    </>
  );
}
