/**
 * THE one status→semantic-class map (redesign adversary P0: four private
 * status→color maps rendered contradictory chips for the same run on one
 * screen — waiting was amber in the navigator and blue in the toolbar,
 * "paused" rendered in success-green on the board).
 *
 * Every status chip — navigator rows, Story hero, the observe toolbar,
 * board cards — derives its semantic class here. Colors mean the same
 * thing everywhere: ok=done-well, danger=dead-wrong, warn=needs-eyes,
 * info=in-motion, muted=inert.
 */
/**
 * The one status WORD too (adversary 3 P1-2): a paused run read "paused"
 * on the board and "running" on Observe — the fold belongs beside the
 * color map so every surface says the same word. Paused only overrides
 * non-terminal states (a completed run that was once paused is completed).
 */
export function run_status_word(run: { status?: string | null; paused?: boolean | null } | null | undefined): string {
  const s = String(run?.status ?? "").trim().toLowerCase();
  const terminal = s === "completed" || s === "failed" || s === "cancelled";
  if (run?.paused && !terminal) return "paused";
  return s || "unknown";
}

export function run_status_class(status: unknown): string {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed") return "ok";
  if (s === "failed" || s === "cancelled") return "danger";
  if (s === "waiting" || s === "paused" || s === "suspended") return "warn";
  if (s === "running") return "info";
  if (s === "scheduled") return "info";
  return "muted";
}

/** RunSummary lives here (not in a picker module): it is the wire shape
 * of a run listing row, shared by the navigator, board, and system pages.
 * (Moved verbatim out of run_picker.tsx when the duplicate picker
 * dropdown died and the module became a corpse.) */
export type RunSummary = {
  run_id: string;
  workflow_id?: string | null;
  status?: string;
  created_at?: string | null;
  updated_at?: string | null;
  ledger_len?: number | null;
  parent_run_id?: string | null;
  session_id?: string | null;
  is_scheduled?: boolean | null;
  paused?: boolean | null;
  waiting_reason?: string | null;
  schedule_interval?: string | null;
  schedule_target_workflow_id?: string | null;
  current_node?: string | null;
  llm_calls?: number | null;
  tool_calls?: number | null;
  tokens_total?: number | null;
  error?: any;
  waiting?: any;
};

/** Run-listing view shapes (moved from app.tsx, slice 4a): the
 * navigator/board filter words and the grouped run-tree rows. */
export type RunFilterMode = "all" | "active" | "waiting" | "terminal" | "failed";
export type RunTreeRow = { run: RunSummary; children: RunSummary[] };
export type RunTreeSection = { key: string; label: string; rows: RunTreeRow[] };
