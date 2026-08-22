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
/**
 * A run's `status` is about the RUN. It is not about the TURN.
 *
 * An agent turn that was cut short — the iteration budget ran out, or the
 * loop's stuck-streak guard ended it — still reports `status: "completed"`,
 * because the run really did complete: it ran its terminal node and produced
 * an output. The turn did not. Reading `status` alone therefore paints an
 * unfinished turn in success-green and calls it done-well, which is the same
 * misreading AbstractCode's TUI shipped for two days before its own fix.
 *
 * The loop says which it was, in `output.stop_reason` (2026-08-21 contract):
 * `finished` is the boolean, and `label` is a sentence the SERVER authored so
 * that every host — this one, the TUI, a chat bridge — says the same thing.
 * Pass it wherever you have it; where you only have a listing row you do not,
 * and the chip degrades to the status word (see the note in the audit).
 */
export type StopReason = {
  code?: string | null;
  finished?: boolean | null;
  label?: string | null;
  headline?: string | null;
  remedy?: string | null;
};

/** The stop_reason of a run detail (`get_run`), if it carries one. */
export function stop_reason_of(run: any): StopReason | null {
  const sr = run?.output?.stop_reason ?? run?.stop_reason ?? null;
  return sr && typeof sr === "object" ? (sr as StopReason) : null;
}

export function run_status_word(
  run:
    | { status?: string | null; paused?: boolean | null; stop_reason?: StopReason | null }
    | null
    | undefined,
): string {
  const s = String(run?.status ?? "").trim().toLowerCase();
  const terminal = s === "completed" || s === "failed" || s === "cancelled";
  if (run?.paused && !terminal) return "paused";
  // A completed RUN whose TURN did not finish is "stopped", never "completed".
  // Only the server's own boolean may say so: absent stop_reason changes
  // nothing, so listing rows keep their existing word.
  if (s === "completed" && run?.stop_reason && run.stop_reason.finished === false) return "stopped";
  return s || "unknown";
}

export function run_status_class(status: unknown, stop_reason?: StopReason | null): string {
  const s = String(status ?? "").trim().toLowerCase();
  // Same rule as the word: an unfinished turn needs eyes, it is not a success.
  if (s === "stopped") return "warn";
  if (s === "completed") return stop_reason && stop_reason.finished === false ? "warn" : "ok";
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
