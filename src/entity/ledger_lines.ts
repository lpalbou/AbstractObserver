/**
 * One envelope -> one human-readable ledger line.
 *
 * Maintainer language rule (a2a 0003): human words in maintainer-facing
 * text — "what the message reminds it of", "present by right" — never
 * door/admission jargon. Lines describe what HAPPENED to the mind, so a
 * reader can follow a life the way the memory ledger panel in the
 * codex-fork monitor reads, but with the WHY visible.
 */

import { classifyBookkeeping, cleanTitle, relationPredicate } from "./stream_fold";
import type {
  BindingPayload,
  ClosurePayload,
  EventPayload,
  HostPayload,
  ReplayEnvelope,
  SnapshotPayload,
  TracePayload,
  ValencePayload,
} from "./stream_types";

export interface LedgerLine {
  seq: number;
  family: string;
  observed_at: string;
  trace_id: string | null;
  turn_id: string | null;
  /** Short bold heading. */
  title: string;
  /** One-sentence human detail. */
  detail: string;
  /** Node/target this line is about (click-to-inspect), when applicable. */
  subject_id: string | null;
  /** Visual accent: formation | usage | recall | context | feeling | revision | session | boundary | quiet */
  tone: string;
  /** Member names for collapsible burst lines — the panel folds
   * consecutive runs of the SAME groupKind + recall into one row
   * (a single recall deposits one `selected` per shelf record and one
   * `co_selected` per pair; one line per event floods the ledger with
   * sameness — maintainer, 2026-07-10 20:09 + 20:50). */
  members?: string[];
  /** Which burst family this line belongs to: "use" (selected) or
   * "pair" (co_selected). Absent = never grouped. */
  groupKind?: "use" | "pair";
}

function clip(text: string, max = 96): string {
  const t = String(text || "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Derived rhythm lines (maintainer, 2026-07-08 16:31: "the ledger really
 * doesn't say anything about what's happening during own time"): the
 * stream has no explicit day/tick markers, but every envelope carries
 * run_id/turn_id — boundaries BETWEEN consecutive envelopes are the
 * day and tick structure of his own time, derived, never invented.
 * Pure per (prev, env): the ledger cache stays incremental. */
export function boundaryLines(env: ReplayEnvelope, prev: ReplayEnvelope | null): LedgerLine[] {
  const run = String(env.run_id || "");
  const turn = String(env.turn_id || "");
  if (!run && !turn) return [];
  const prevRun = String(prev?.run_id || "");
  const prevTurn = String(prev?.turn_id || "");
  const out: LedgerLine[] = [];
  const base = {
    seq: env.seq,
    family: "boundary",
    observed_at: env.observed_at,
    trace_id: null,
    turn_id: env.turn_id ?? null,
    subject_id: null,
    tone: "boundary",
  };
  const isOwnTime = run.includes("owntime");
  if (run && run !== prevRun && isOwnTime) {
    const at = String(env.observed_at || "").slice(11, 16);
    out.push({ ...base, title: "— a day of his own begins —", detail: at ? `${at} UTC · he is alone with his time` : "he is alone with his time" });
  }
  if (turn && turn !== prevTurn && (run === prevRun || isOwnTime)) {
    if (turn === "t-reflect") {
      out.push({ ...base, title: "— he closes the day —", detail: "looking back over what he lived (reflection)" });
    } else {
      const n = turn.match(/^t-0*(\d+)$/)?.[1];
      if (n && isOwnTime) {
        out.push({ ...base, title: `— tick ${n} —`, detail: "" });
      }
    }
  }
  return out;
}

function displayTitle(env: ReplayEnvelope, fallback: string): string {
  const d = env.display;
  if (d?.redacted === "diary") {
    // Distinct act-only identity (never content): the id tail keeps two
    // private entries from reading as the same line.
    const tail = d.graph_id ? d.graph_id.replace(/^.*diary-/, "").slice(0, 6) : "";
    return tail ? `a diary entry #${tail} (content private)` : "a diary entry (content private)";
  }
  if (d?.title) {
    const predicate = relationPredicate(d.title);
    if (predicate) return `the “${predicate}” link`;
    return clip(cleanTitle(d.title), 64);
  }
  return fallback;
}

export function ledgerLine(env: ReplayEnvelope): LedgerLine {
  const base = {
    seq: env.seq,
    family: env.family,
    observed_at: env.observed_at,
    trace_id: env.trace_id,
    turn_id: env.turn_id,
  };

  switch (env.family) {
    case "binding": {
      const p = env.payload as unknown as BindingPayload;
      const name = displayTitle(env, clip(p.record_id, 40));
      if (p.source === "remember") {
        // Narrative per kind (maintainer 16:31: the ledger must SAY what
        // is happening during his own time, not catalog index states).
        const kind = env.display?.redacted === "diary" || env.display?.diary === true ? "diary" : String(env.display?.kind || "memory");
        const title = String(env.display?.title || "");
        const gist = clip(cleanTitle(title).replace(/^exchange:\s*/i, ""), 110);
        if (kind === "diary") {
          // Operator surfaces show the entry's gist (maintainer ruling
          // 2026-07-08 21:39: "we must see the content and ideally a
          // 1-sentence summary"); the full text is one click away.
          const summary = String(env.display?.gist || (env.display?.diary === true ? title : "") || "").trim();
          return {
            ...base,
            title: "📖 He wrote in his book",
            detail: summary ? clip(summary, 130) : `${name} — the words are his`,
            subject_id: p.record_id,
            tone: "formation",
          };
        }
        if (kind === "episode") {
          return { ...base, title: "💬 He lived a moment", detail: gist || name, subject_id: p.record_id, tone: "formation" };
        }
        if (kind === "summary") {
          return { ...base, title: "📎 He summed it up", detail: gist || name, subject_id: p.record_id, tone: "formation" };
        }
        if (kind === "interest") {
          return { ...base, title: "✨ An interest took root", detail: gist || name, subject_id: p.record_id, tone: "formation" };
        }
        if (kind === "dream") {
          return { ...base, title: "🌙 He dreamed", detail: gist || name, subject_id: p.record_id, tone: "formation" };
        }
        if (kind === "lesson") {
          return { ...base, title: "📚 A lesson crystallized", detail: gist || name, subject_id: p.record_id, tone: "formation" };
        }
        // Engine bookkeeping (engram/reembed markers): an ACT journaled
        // into the life, not a memory he formed — say what the engine did.
        // The reembed line is the plan's item-3 visibility clause: the
        // stream must show WHEN retrieval geometry changed.
        const bk = classifyBookkeeping(kind, cleanTitle(title), env.display ?? {});
        if (bk.bookkeeping) {
          if (bk.maintenance === "reembed") {
            return { ...base, title: "🔧 Retrieval geometry changed (reembed)", detail: gist || name, subject_id: p.record_id, tone: "session" };
          }
          if (/^spark-engram v\d+/.test(cleanTitle(title))) {
            return { ...base, title: "🌱 The spark was engrammed", detail: gist || name, subject_id: p.record_id, tone: "session" };
          }
          return { ...base, title: `🔧 Engine act${bk.maintenance ? ` (${bk.maintenance})` : ""}`, detail: gist || name, subject_id: p.record_id, tone: "session" };
        }
        return {
          ...base,
          title: "Memory formed",
          detail: name,
          subject_id: p.record_id,
          tone: "formation",
        };
      }
      return {
        ...base,
        title: "Visibility changed",
        detail: `${name} — ${p.search_state}/${p.prompt_state} (${p.source}${p.reason ? `: ${clip(p.reason, 48)}` : ""})`,
        subject_id: p.record_id,
        tone: "formation",
      };
    }
    case "event": {
      const p = env.payload as unknown as EventPayload;
      if (p.kind === "selected") {
        const name = displayTitle(env, clip(p.record_id ?? "", 40));
        return {
          ...base,
          title: "Used",
          detail: name,
          subject_id: p.record_id,
          tone: "usage",
          members: [name],
          groupKind: "use",
        };
      }
      if (p.kind === "co_selected") {
        const pair = env.display?.pair ?? [];
        const names = pair.map((d) => {
          if (d.redacted === "diary") return "a diary entry";
          const predicate = relationPredicate(d.title ?? "");
          if (predicate) return `the “${predicate}” link`;
          return clip(cleanTitle(d.title ?? ""), 36);
        });
        const label = names.filter(Boolean).join("  +  ") || `${p.pair_ids?.[0]?.slice(0, 10)}… + ${p.pair_ids?.[1]?.slice(0, 10)}…`;
        return {
          ...base,
          title: "Used together",
          detail: label,
          subject_id: p.pair_ids?.[0] ?? null,
          tone: "usage",
          members: names.filter(Boolean),
          groupKind: "pair",
        };
      }
      if (p.kind === "pinned" || p.kind === "silenced") {
        return {
          ...base,
          title: p.kind === "pinned" ? "Pinned" : "Silenced",
          detail: `${displayTitle(env, clip(p.record_id ?? "", 40))}${p.reason ? ` — ${clip(p.reason, 60)}` : ""}`,
          subject_id: p.record_id,
          tone: "usage",
        };
      }
      if (p.kind === "refocus") {
        return {
          ...base,
          title: "Refocused",
          detail: p.reason ? clip(p.reason, 80) : "attention refocused",
          subject_id: null,
          tone: "quiet",
        };
      }
      // Audit kinds: reading is not using — quiet lines.
      return {
        ...base,
        title: p.kind === "listed" ? "Considered" : p.kind,
        detail: displayTitle(env, clip(p.record_id ?? "", 40)),
        subject_id: p.record_id,
        tone: "quiet",
      };
    }
    case "trace": {
      const p = env.payload as unknown as TracePayload;
      const cue = String(p.need?.cue_text ?? "");
      const admissions = p.admissions ?? {};
      const counts: Record<string, number> = {};
      for (const label of Object.values(admissions)) counts[label] = (counts[label] ?? 0) + 1;
      const parts: string[] = [];
      if (counts["self"]) parts.push(`${counts["self"]} present by right`);
      if (counts["stm"]) parts.push(`${counts["stm"]} from continuity`);
      const matched = (counts["stimulus"] ?? 0) + (counts["both"] ?? 0);
      if (matched) parts.push(`${matched} matched`);
      return {
        ...base,
        title: cue ? `Recall — “${clip(cue, 56)}”` : "Recall (no cue: the self read)",
        detail: `${p.candidates?.length ?? 0} considered, ${p.selected?.length ?? 0} on the shelf${parts.length ? ` (${parts.join(", ")})` : ""}${(p.dropped?.length ?? 0) > 0 ? `; ${p.dropped.length} dropped` : ""}`,
        subject_id: null,
        tone: "recall",
      };
    }
    case "snapshot": {
      const p = env.payload as unknown as SnapshotPayload;
      return {
        ...base,
        title: "He holds these in mind",
        detail: `${p.used_record_ids?.length ?? 0} memories in context${p.prompt_token_estimate ? ` (~${p.prompt_token_estimate} tokens)` : ""}`,
        subject_id: null,
        tone: "context",
      };
    }
    case "valence": {
      const p = env.payload as unknown as ValencePayload;
      const sign = Number(p.sign) >= 0 ? "+" : "−";
      const mag = Number(p.magnitude ?? 0);
      const reason = p.reason ? ` — ${clip(p.reason, 72)}` : "";
      // Record-targeted feelings: the display block names the memory
      // ("a summary", "a diary entry") — raw graph ids stay for
      // unenriched targets only. Free identity strings pass through.
      const target = p.target_id.startsWith("ex:") ? displayTitle(env, clip(p.target_id, 28)) : p.target_id;
      if (p.kind === "appraisal") {
        return {
          ...base,
          title: `Felt ${sign}${mag} about ${target}`,
          detail: clip(p.reason ?? "", 96),
          subject_id: p.target_id,
          tone: "feeling",
        };
      }
      if (p.kind === "scar") {
        return { ...base, title: `A scar formed — ${target}`, detail: `magnitude ${mag}${reason}`, subject_id: p.target_id, tone: "feeling" };
      }
      if (p.kind === "bond") {
        return { ...base, title: `A bond formed — ${target}`, detail: `magnitude ${mag}${reason}`, subject_id: p.target_id, tone: "feeling" };
      }
      if (p.kind === "healing") {
        return { ...base, title: `A scar healed — ${target}`, detail: clip(p.reason ?? "", 96), subject_id: p.target_id, tone: "feeling" };
      }
      return { ...base, title: `A bond broke — ${target}`, detail: clip(p.reason ?? "", 96), subject_id: p.target_id, tone: "feeling" };
    }
    case "closure": {
      const p = env.payload as unknown as ClosurePayload;
      const name = displayTitle(env, clip(p.assertion_id, 40));
      return {
        ...base,
        title: p.kind === "supersede" ? "Belief revised" : "Belief retracted",
        detail: `${name} — ${clip(p.reason, 80)}`,
        subject_id: p.assertion_id,
        tone: "revision",
      };
    }
    case "host": {
      const p = env.payload as unknown as HostPayload;
      const session = p.session_id ? ` (${p.session_id})` : "";
      const reason = typeof p["reason"] === "string" && p["reason"] ? clip(String(p["reason"]), 80) : "";
      if (p.kind === "summon") {
        return { ...base, title: "Summoned", detail: `a new session begins${session}`, subject_id: null, tone: "session" };
      }
      if (p.kind === "session_closed") {
        // Visit runs close with a WHY (D3 idle deadline / explicit close /
        // state-transition guards) and a WHO (closed_by) — surface both
        // when the door records them; older markers stay a plain close.
        const closeReason = typeof p["close_reason"] === "string" && p["close_reason"] ? String(p["close_reason"]) : reason;
        const closedBy = typeof p["closed_by"] === "string" && p["closed_by"] ? String(p["closed_by"]) : "";
        const why = [closeReason, closedBy ? `by ${closedBy}` : ""].filter(Boolean).join(" — ");
        return {
          ...base,
          title: "Session closed",
          detail: `the session ended${session}${why ? ` — ${clip(why, 96)}` : ""}`,
          subject_id: null,
          tone: "session",
        };
      }
      if (p.kind === "prelude_refused") {
        return { ...base, title: "Prelude refused", detail: `the summon was refused${session}`, subject_id: null, tone: "session" };
      }
      if (p.kind === "sleep") {
        return { ...base, title: "Fell asleep", detail: reason || "the day closed", subject_id: null, tone: "session" };
      }
      if (p.kind === "wake") {
        return { ...base, title: "Woke", detail: reason || "a new day begins", subject_id: null, tone: "session" };
      }
      if (p.kind === "pause") {
        return { ...base, title: "Paused", detail: reason || "own time paused", subject_id: null, tone: "session" };
      }
      if (p.kind === "diary_read") {
        const who = typeof p["channel"] === "string" && p["channel"] ? String(p["channel"]) : "someone";
        return { ...base, title: "The book was read", detail: `${who}${reason ? ` — ${reason}` : ""}`, subject_id: null, tone: "session" };
      }
      if (p.kind === "observation_granted" || p.kind === "observation_revoked") {
        // Being watched is an event in the life being watched (GW-G design
        // commitment, 0017 pin 2 — the diary_read precedent generalized).
        // Payload keys are the DECLARED contract: grantee, granted_by
        // (door-derived), scope (subset array), reason.
        const grantee = typeof p["grantee"] === "string" && p["grantee"] ? String(p["grantee"]) : "someone";
        const grantedBy = typeof p["granted_by"] === "string" && p["granted_by"] ? String(p["granted_by"]) : "";
        const scope = Array.isArray(p["scope"]) ? (p["scope"] as unknown[]).map(String).join(", ") : "";
        const granted = p.kind === "observation_granted";
        return {
          ...base,
          title: granted ? "👁 Someone may now watch" : "An observation ended",
          detail: `${grantee}${scope ? ` (${scope})` : ""}${grantedBy ? ` — ${granted ? "granted" : "revoked"} by ${grantedBy}` : ""}${reason ? ` — ${reason}` : ""}`,
          subject_id: null,
          tone: "session",
        };
      }
      if (p.kind === "reembed") {
        // The door's half of the item-3 maintenance act (memory's claim
        // record is the journal half): name the space change explicitly so
        // a recall-behavior shift is explainable, never mysterious.
        // Payload shape = the SHIPPED gateway verb (entities.py reembed):
        // old_pin/new_pin objects {model_id, dimension}; flat
        // old_model_id/new_model_id tolerated for older exports.
        const pinOf = (v: unknown): { model?: string; dim?: number } => {
          if (v && typeof v === "object") {
            const o = v as Record<string, unknown>;
            return {
              model: typeof o["model_id"] === "string" && o["model_id"] ? String(o["model_id"]) : undefined,
              dim: typeof o["dimension"] === "number" ? Number(o["dimension"]) : undefined,
            };
          }
          return {};
        };
        const oldPin = pinOf(p["old_pin"]);
        const newPin = pinOf(p["new_pin"]);
        const flat = (k: string) => (typeof p[k] === "string" && p[k] ? String(p[k]) : undefined);
        const fmt = (model: string, dim?: number) => (dim ? `${model} (${dim}d)` : model);
        const oldModel = fmt(oldPin.model ?? flat("old_model_id") ?? "unpinned", oldPin.dim);
        const newModel = fmt(newPin.model ?? flat("new_model_id") ?? "unknown model", newPin.dim);
        return {
          ...base,
          title: "🔧 Reembed (operator maintenance)",
          detail: `embedding space ${oldModel} → ${newModel}${reason ? ` — ${reason}` : ""}; same memories, different neighbors`,
          subject_id: null,
          tone: "session",
        };
      }
      if (p.kind === "prompt_overlay_changed") {
        // The operator rewrote prompt layers (marker-first, word-free —
        // layer names + hashes only; the words stay in the home file).
        // Array-shaped `layers` would pass a bare typeof check and render
        // indices as layer names (adversary find) — objects only.
        const layersRaw = p["layers"];
        const layers =
          layersRaw && typeof layersRaw === "object" && !Array.isArray(layersRaw)
            ? Object.keys(layersRaw as Record<string, unknown>).map((k) => clip(k, 32))
            : [];
        const reverted = Array.isArray(p["reverted"]) ? (p["reverted"] as unknown[]).map((v) => clip(String(v), 32)) : [];
        const capped = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", "));
        const parts = [
          layers.length ? `rewrote: ${capped(layers)}` : "",
          reverted.length ? `reverted to default: ${capped(reverted)}` : "",
        ].filter(Boolean);
        return {
          ...base,
          title: "✍️ Standing instructions changed",
          detail: parts.length ? `the operator ${parts.join("; ")}` : "the operator changed the prompt overlay",
          subject_id: null,
          tone: "session",
        };
      }
      if (p.kind === "deposit_refused") {
        // N4's render leg (config-object R5; contract confirmed c746): the
        // deposit gate refused a write from this phase. refused_by
        // distinguishes the sleep phase-gate class from ordinary channel
        // refusals. The reason is the door's sentence — clipped at the
        // file's 96 default (visibly, with an ellipsis), never the tighter
        // 80 shared clip, because the refusal sentence is the load-bearing
        // content of this line.
        const phase = clip(typeof p["phase"] === "string" ? String(p["phase"]) : "", 24);
        const effectType = clip(typeof p["effect_type"] === "string" && p["effect_type"] ? String(p["effect_type"]) : "a deposit", 32);
        const recordKind = clip(typeof p["record_kind"] === "string" ? String(p["record_kind"]) : "", 24);
        const scope = clip(typeof p["scope"] === "string" ? String(p["scope"]) : "", 48);
        const fullReason = typeof p["reason"] === "string" && p["reason"] ? clip(String(p["reason"]), 96) : "";
        const phaseGate = p["refused_by"] === "phase_gate";
        // phase_gate WITHOUT a named phase must not claim the sleep class
        // (a future phase gate would misreport) — name the phase only when
        // the payload does.
        const title = phaseGate
          ? phase
            ? `⛔ A ${phase}-phase deposit was refused`
            : "⛔ A phase-gated deposit was refused"
          : "⛔ A deposit was refused";
        return {
          ...base,
          title,
          detail: `${effectType}${recordKind ? ` (${recordKind})` : ""}${scope ? ` into ${scope}` : ""}${fullReason ? ` — ${fullReason}` : ""}`,
          subject_id: null,
          tone: "session",
        };
      }
      // Personal-time grant lifecycle (contract c746, re-spelled to the
      // RULED vocabulary at c794/c798: phases are visit/work/personal/
      // sleep; "revoke" not "retract" — retract is spent in the identity
      // lane). The old own_time_grant* kinds were NEVER written (no
      // writer shipped), so they die unaliased; the loop-lifecycle kinds
      // below keep their legacy spellings because historical streams
      // carry them. ARM ≠ START (an armed grant PERMITS the loop, never
      // starts it) — granted→started is two events by design; a started
      // with no prior granted is a bug worth seeing.
      if (p.kind === "personal_granted") {
        // Unknown/missing mode must NOT fabricate the strongest claim
        // ("until revoked" = unbounded) — render honestly unknown
        // (adversary find: aged exports missing `mode` would misreport a
        // timer grant as open-ended).
        const mode = typeof p["mode"] === "string" ? String(p["mode"]) : "";
        const expires = clip(typeof p["expires_at"] === "string" ? String(p["expires_at"]) : "", 32);
        const grantedBy = clip(typeof p["granted_by"] === "string" && p["granted_by"] ? String(p["granted_by"]) : "the operator", 48);
        const until =
          mode === "timer" ? (expires ? `timer until ${expires}` : "timed") : mode === "until_revoked" ? "until revoked" : "mode unrecorded";
        return {
          ...base,
          title: "Personal time armed",
          detail: `${grantedBy} granted his personal time (${until}) — armed, not started${reason ? ` — ${reason}` : ""}`,
          subject_id: null,
          tone: "session",
        };
      }
      if (p.kind === "personal_grant_expired") {
        // enforced_by distinguishes the 5s poll from the SIGKILL-surviving
        // backstop — a backstop expiry means the gateway had died, which
        // the operator should see (requirement 2, c746). A MISSING field
        // must not default to the calm claim: the loud case is the one a
        // silent default would suppress (adversary find).
        const enforcedBy = typeof p["enforced_by"] === "string" ? String(p["enforced_by"]) : "";
        const at = typeof p["expired_at"] === "string" && p["expired_at"] ? ` at ${clip(String(p["expired_at"]), 32)}` : "";
        if (enforcedBy === "wall_clock_backstop") {
          return {
            ...base,
            title: "⛔ Personal-time grant expired (backstop)",
            detail: `the loop stopped itself${at} — wall-clock backstop enforced (the gateway was not there to do it)`,
            subject_id: null,
            tone: "session",
          };
        }
        return {
          ...base,
          title: "Personal-time grant expired",
          detail: enforcedBy === "poll" ? `enforced at the tick poll${at}` : `the grant ended${at} (enforcement unrecorded)`,
          subject_id: null,
          tone: "session",
        };
      }
      if (p.kind === "personal_grant_revoked") {
        const revokedBy = clip(typeof p["revoked_by"] === "string" && p["revoked_by"] ? String(p["revoked_by"]) : "the operator", 48);
        return { ...base, title: "Personal-time grant revoked", detail: `${revokedBy} withdrew the grant${reason ? ` — ${reason}` : ""}`, subject_id: null, tone: "session" };
      }
      // Loop lifecycle — BOTH spellings render: own_time_* envelopes exist
      // in historical streams (the 0010 wave); personal_* is the ruled
      // vocabulary going forward.
      if (p.kind === "own_time_started" || p.kind === "personal_started") {
        return { ...base, title: "His own time began", detail: reason || "the tick loop is running", subject_id: null, tone: "session" };
      }
      if (p.kind === "own_time_stop_requested" || p.kind === "personal_stop_requested") {
        return { ...base, title: "Personal-time stop requested", detail: reason || "halts at the next tick boundary", subject_id: null, tone: "session" };
      }
      if (p.kind === "own_time_frozen" || p.kind === "personal_frozen") {
        // FREEZE = admin hibernation (maintainer ruling, commons 52):
        // process killed now, nothing changes, the door closed.
        return { ...base, title: "Frozen", detail: reason || "admin hibernation — nothing changes until the thaw", subject_id: null, tone: "session" };
      }
      return { ...base, title: `Host: ${p.kind}`, detail: reason || session.trim(), subject_id: null, tone: "session" };
    }
    default:
      return { ...base, title: env.family, detail: "", subject_id: null, tone: "quiet" };
  }
}
