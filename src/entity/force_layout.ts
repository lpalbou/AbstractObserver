/**
 * A small deterministic force layout for the memory graph.
 *
 * No dependency: the graph is organic (nodes appear over a life, edges
 * strengthen with use) and the fork monitor's look is a gently settling
 * force field, which ~90 lines of velocity-Verlet covers. Determinism
 * matters for replay: initial positions derive from a hash of the node id,
 * so scrubbing to the same seq always shows the same shape.
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual radius (collision + repulsion scale). */
  r: number;
  /** Pinned nodes (identity ring) feel a stronger anchor pull. */
  anchor?: { x: number; y: number; strength: number };
}

export interface LayoutEdge {
  a: string;
  b: string;
  /** Spring strength scale (usage count). */
  weight: number;
}

/** Deterministic hash -> [0, 1). */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Seed position on a ring whose radius depends on the node class. */
export function seedPosition(id: string, ringRadius: number): { x: number; y: number } {
  const angle = hash01(id, 1) * Math.PI * 2;
  const jitter = 0.75 + hash01(id, 2) * 0.5;
  return { x: Math.cos(angle) * ringRadius * jitter, y: Math.sin(angle) * ringRadius * jitter };
}

export interface ForceParams {
  repulsion: number;
  springLength: number;
  springStrength: number;
  gravity: number;
  damping: number;
  maxVelocity: number;
  /** Spring force saturation (px/tick). Springs are LOCAL relaxation:
   * without a cap, a long edge (e.g. diary written_amid an episode across
   * the disc) exerts unbounded pull and drags seated nodes into streaks —
   * the 2026-07-07 layout smear. Capped, a spring can nudge a node ~its
   * anchor-balance distance and no further. */
  maxSpringForce: number;
}

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  repulsion: 2600,
  springLength: 90,
  springStrength: 0.03,
  gravity: 0.012,
  damping: 0.86,
  maxVelocity: 14,
  maxSpringForce: 1.6,
};

/** One simulation tick over the given nodes/edges (in place). O(n²)
 * repulsion is fine at entity-graph scale (hundreds of nodes).
 *
 * `alpha` (0..1) scales every force — the cooling dial (adversarial
 * stability review P0-2): 1 = full placement energy, near 0 = settled.
 * The caller decays it and STOPS calling when below threshold, so the
 * layout becomes a stable spatial reference instead of a screensaver. */
export function tickForces(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  params: ForceParams = DEFAULT_FORCE_PARAMS,
  alpha = 1,
): void {
  const byId = new Map<string, LayoutNode>();
  for (const n of nodes) byId.set(n.id, n);

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        // Coincident seeds: nudge apart deterministically.
        dx = hash01(a.id + b.id, 3) - 0.5;
        dy = hash01(a.id + b.id, 4) - 0.5;
        d2 = dx * dx + dy * dy + 0.01;
      }
      const d = Math.sqrt(d2);
      const push = (params.repulsion * (a.r + b.r) * 0.02) / d2;
      const fx = (dx / d) * push;
      const fy = (dy / d) * push;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  for (const e of edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const strength = params.springStrength * Math.min(3, 0.6 + Math.log1p(e.weight));
    let f = (d - params.springLength) * strength;
    // Saturate: relatedness is drawn as an edge either way; position
    // should stay owned by the seat anchor, not by edge length.
    if (f > params.maxSpringForce) f = params.maxSpringForce;
    else if (f < -params.maxSpringForce) f = -params.maxSpringForce;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const n of nodes) {
    if (n.anchor) {
      n.vx += (n.anchor.x - n.x) * n.anchor.strength;
      n.vy += (n.anchor.y - n.y) * n.anchor.strength;
    } else {
      n.vx += -n.x * params.gravity;
      n.vy += -n.y * params.gravity;
    }
    n.vx *= params.damping * alpha;
    n.vy *= params.damping * alpha;
    const v = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
    if (v > params.maxVelocity) {
      n.vx = (n.vx / v) * params.maxVelocity;
      n.vy = (n.vy / v) * params.maxVelocity;
    }
    n.x += n.vx * alpha;
    n.y += n.vy * alpha;
  }
}

/** Max node speed — the caller's settle detector. */
export function maxVelocity(nodes: LayoutNode[]): number {
  let max = 0;
  for (const n of nodes) {
    const v = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
    if (v > max) max = v;
  }
  return max;
}
