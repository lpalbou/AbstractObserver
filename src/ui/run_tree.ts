/**
 * The Observe navigator's grouped run tree (moved out of app.tsx so the
 * grouping rules are testable). Children hang under their parent run;
 * automation OCCURRENCES hang under their automation (`automation_id`, the
 * controller root's run id) even when the controller row is outside the
 * loaded window — a placeholder root stands in for it then.
 */
import { active_run_status, parse_iso_ms, terminal_run_status } from "./format";
import type { RunFilterMode, RunSummary, RunTreeSection } from "./run_status";

export type RunTreeOptions = {
  query: string;
  filter: RunFilterMode;
  group_by: "status" | "workflow" | "session";
  workflow_label_by_id: Record<string, string>;
  /** Extra parent links the app learned from ledgers (subruns). */
  parent_hint?: (run_id: string) => string;
};

/** The grouping parent of a row: its automation for an occurrence, else its parent run. */
export function tree_parent_of(run: RunSummary, hint = ""): string {
  const role = String(run.role || "").trim();
  const automation_id = String(run.automation_id || "").trim();
  if (role === "occurrence" && automation_id && automation_id !== run.run_id) return automation_id;
  return String(run.parent_run_id || hint || "").trim();
}

function newest_first(a: RunSummary, b: RunSummary): number {
  const am = parse_iso_ms(a.updated_at || a.created_at) ?? 0;
  const bm = parse_iso_ms(b.updated_at || b.created_at) ?? 0;
  return bm - am;
}

export function build_run_tree_sections(input: RunSummary[], opts: RunTreeOptions): RunTreeSection[] {
  const q = opts.query.trim().toLowerCase();
  const rows = [...input];
  const by_id: Record<string, RunSummary> = {};
  for (const r of rows) {
    const rid = String(r.run_id || "").trim();
    if (rid) by_id[rid] = r;
  }
  // Placeholder automation roots for occurrences whose controller row is not loaded.
  for (const r of input) {
    const parent = tree_parent_of(r);
    if (String(r.role || "") === "occurrence" && parent && !by_id[parent]) {
      const placeholder: RunSummary = {
        run_id: parent,
        workflow_id: null,
        status: "",
        role: "controller",
        session_kind: "automation",
        automation_id: parent,
        updated_at: r.updated_at ?? null,
        created_at: r.created_at ?? null,
      };
      by_id[parent] = placeholder;
      rows.push(placeholder);
    }
  }
  const children_by_parent: Record<string, RunSummary[]> = {};
  const parent_of: Record<string, string> = {};
  for (const r of rows) {
    const rid = String(r.run_id || "").trim();
    if (!rid) continue;
    const parent = tree_parent_of(r, opts.parent_hint ? opts.parent_hint(rid) : "");
    parent_of[rid] = parent;
    if (parent) (children_by_parent[parent] ||= []).push(r);
  }

  const matches_status = (r: RunSummary): boolean => {
    const st = String(r.status || "").trim().toLowerCase();
    if (opts.filter === "all") return true;
    if (opts.filter === "active") return active_run_status(st);
    if (opts.filter === "waiting") return st === "waiting";
    if (opts.filter === "terminal") return terminal_run_status(st);
    if (opts.filter === "failed") return st === "failed";
    return true;
  };
  const matches_query = (r: RunSummary): boolean => {
    if (!q) return true;
    const wid = String(r.workflow_id || r.schedule_target_workflow_id || "").trim();
    const label = wid ? opts.workflow_label_by_id[wid] || wid : "";
    const hay = [r.run_id, wid, label, r.session_id, r.status, r.session_kind, r.automation_id].join(" ").toLowerCase();
    return hay.includes(q);
  };
  const root_ids: string[] = [];
  for (const r of rows) {
    const rid = String(r.run_id || "").trim();
    if (!rid) continue;
    const parent = parent_of[rid];
    if (!parent || !by_id[parent]) root_ids.push(rid);
  }

  const section_map: Record<string, RunTreeSection> = {};
  const group_for = (r: RunSummary): { key: string; label: string } => {
    if (opts.group_by === "workflow") {
      const wid = String(r.schedule_target_workflow_id || r.workflow_id || "").trim() || "(unknown workflow)";
      return { key: wid, label: opts.workflow_label_by_id[wid] || wid };
    }
    if (opts.group_by === "session") {
      const sid = String(r.session_id || "").trim() || "(no session)";
      return { key: sid, label: sid };
    }
    const st = String(r.status || "").trim().toLowerCase() || "unknown";
    if (active_run_status(st)) return { key: "active", label: "Active" };
    if (st === "failed") return { key: "failed", label: "Failed" };
    if (terminal_run_status(st)) return { key: "finished", label: "Finished" };
    return { key: st, label: st };
  };

  for (const rid of root_ids) {
    const root = by_id[rid];
    if (!root) continue;
    const children = [...(children_by_parent[rid] || [])].sort(newest_first);
    const child_matches = children.some((c) => matches_status(c) && matches_query(c));
    if (!(matches_status(root) && matches_query(root)) && !child_matches) continue;
    const g = group_for(root);
    if (!section_map[g.key]) section_map[g.key] = { key: g.key, label: g.label, rows: [] };
    section_map[g.key].rows.push({ run: root, children });
  }

  return Object.values(section_map).sort((a, b) => {
    const order: Record<string, number> = { active: 0, waiting: 1, failed: 2, finished: 3 };
    const ao = order[a.key] ?? 10;
    const bo = order[b.key] ?? 10;
    if (ao !== bo) return ao - bo;
    return a.label.localeCompare(b.label);
  });
}
