/**
 * Tool-descriptor render facts — the observer's render-consumer half of
 * the tool-inventory descriptor contract (commons fs
 * plans/tool-inventory-descriptor-contract.md, SETTLED at v6).
 *
 * Built AHEAD of the served payload (laurent's completion directive,
 * c916: downstream halves land ready so they connect the hour runtime's
 * emission + gateway's GET ship). Pure functions over served rows —
 * no fetch, no state; the workspace matrix consumes these when the
 * gateway serves the inventory.
 *
 * Contract rules this module carries (v6):
 * - Row IDENTITY is the pair (executes_via, name) — a name-keyed dict
 *   silently loses the 5 colliding names (rule 2's serialization rule).
 * - grant_lane is PRESENT ONLY on entity_walled rows; core_registry rows
 *   badge "core registry", never a lane badge.
 * - capability_class has deny-safe ABSENCE: absent = treat as
 *   tier2_world (never invented upstream; the deny-safe reading is the
 *   CONSUMER's duty).
 * - remote_write_capable derivation rule: approval/exposure surfaces
 *   consult BOTH mutating AND remote_write_capable — auto-deciding on
 *   mutating=false alone is the defect (core c901, fetch_url).
 * - Unknown values in any closed set render labeled-unknown (gray),
 *   never crash, never guess (the kind_vocabulary precedent).
 * - Total order (executes_via, owner, name) ascending (rule 4).
 */

/** Served row, v6 shape. Unknown extra fields are ignored on read. */
export interface ToolDescriptor {
  name: string;
  owner: string;
  executes_via: string;
  grant_lane?: string | null;
  capability_class?: string | null;
  mutating?: boolean;
  remote_write_capable?: boolean;
  act_only?: boolean;
  description?: string;
  parameters?: Record<string, unknown>;
  module?: string;
}

/** Closed sets per contract v6 — used for labeled-unknown detection ONLY
 * (render vocabulary; membership truth always comes from the served
 * rows, never from these constants — rule 1). */
export const EXECUTES_VIA_VALUES = ["entity_walled", "core_registry"] as const;
export const GRANT_LANE_VALUES = ["tier1", "workspace"] as const;
export const CAPABILITY_CLASS_VALUES = ["tier0_core", "tier1_self", "tier2_world"] as const;

/** The pair identity (rule 2). ONE canonical spelling for keyed views. */
export function descriptorKey(d: Pick<ToolDescriptor, "name" | "executes_via">): string {
  return `${d.executes_via}\u0000${d.name}`;
}

/** Keyed view honoring the serialization rule: keys on (executes_via,
 * name), so both containments of one colliding name survive. */
export function keyedDescriptors(rows: readonly ToolDescriptor[]): Map<string, ToolDescriptor> {
  const out = new Map<string, ToolDescriptor>();
  for (const row of rows) out.set(descriptorKey(row), row);
  return out;
}

/** Total order (executes_via, owner, name) ascending — rule 4's byte
 * stability, applied at render so lists read identically everywhere. */
export function sortDescriptors(rows: readonly ToolDescriptor[]): ToolDescriptor[] {
  return [...rows].sort(
    (a, b) =>
      a.executes_via.localeCompare(b.executes_via) ||
      String(a.owner).localeCompare(String(b.owner)) ||
      a.name.localeCompare(b.name),
  );
}

export interface LaneBadge {
  /** Short badge text ("● tier-1" / "workspace" / "core registry"). */
  label: string;
  /** "lane" = a grant lane; "containment" = the core-registry badge;
   * "unknown" = labeled-unknown rendering (gray). */
  kind: "lane" | "containment" | "unknown";
}

/** The badge a matrix row shows where the lane column sits (rule 5):
 * walled rows show their grant lane; core_registry rows show the
 * containment badge (grant_lane is null there BY CONTRACT); unknown
 * values render labeled, never guessed. */
export function laneBadge(d: ToolDescriptor): LaneBadge {
  if (d.executes_via === "core_registry") return { label: "core registry", kind: "containment" };
  if (d.executes_via === "entity_walled") {
    if (d.grant_lane === "tier1") return { label: "● tier-1", kind: "lane" };
    if (d.grant_lane === "workspace") return { label: "workspace", kind: "lane" };
    return { label: `lane: ${String(d.grant_lane ?? "unrecorded")}`, kind: "unknown" };
  }
  return { label: `via: ${String(d.executes_via || "unrecorded")}`, kind: "unknown" };
}

/** Boundary indicator with the DENY-SAFE absence reading (absent =
 * tier2_world — the consumer's duty per v6; upstream never invents). */
export function boundaryClass(d: ToolDescriptor): { value: string; declared: boolean; known: boolean } {
  const raw = d.capability_class;
  if (raw === null || raw === undefined || raw === "") {
    return { value: "tier2_world", declared: false, known: true };
  }
  const known = (CAPABILITY_CLASS_VALUES as readonly string[]).includes(raw);
  return { value: raw, declared: true, known };
}

/** True when the tool crosses the world boundary — the egress-honesty
 * cue renders even inside the tier-1 lane (web_search/fetch_url). */
export function crossesWorldBoundary(d: ToolDescriptor): boolean {
  return boundaryClass(d).value === "tier2_world";
}

/** THE DERIVATION RULE (core c901, contract v6): any approval/exposure
 * decision consults BOTH local and remote effect. Never branch on
 * `mutating` alone. */
export function hasEffect(d: ToolDescriptor): boolean {
  return d.mutating === true || d.remote_write_capable === true;
}

/** The remote-write cue (rule 5): visible wherever approval/exposure is
 * decided — fetch_url's class (mutating=false, remote_write_capable). */
export function remoteWriteCue(d: ToolDescriptor): string | null {
  return d.remote_write_capable === true ? "can write remotely (method/data arguments)" : null;
}

/** Prose name with the containment named when the bare name is
 * ambiguous within the rendered set (rule 2's human-facing prose duty). */
export function proseName(d: ToolDescriptor, rows: readonly ToolDescriptor[]): string {
  const collides = rows.some((r) => r.name === d.name && r.executes_via !== d.executes_via);
  if (!collides) return d.name;
  return d.executes_via === "entity_walled" ? `${d.name} (entity-walled)` : `${d.name} (core registry)`;
}
