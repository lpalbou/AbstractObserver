/**
 * One envelope -> one human-readable ledger line.
 *
 * Maintainer language rule (a2a 0003): human words in maintainer-facing
 * text — "what the message reminds it of", "present by right" — never
 * door/admission jargon. Lines describe what HAPPENED to the mind, so a
 * reader can follow a life the way the memory ledger panel in the
 * codex-fork monitor reads, but with the WHY visible.
 */

import { cleanTitle, relationPredicate } from "./stream_fold";
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
        return {
          ...base,
          title: "Used",
          detail: displayTitle(env, clip(p.record_id ?? "", 40)),
          subject_id: p.record_id,
          tone: "usage",
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
        return { ...base, title: "Session closed", detail: `the session ended${session}`, subject_id: null, tone: "session" };
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
      // Own-time loop lifecycle (runtime 0010 121500Z: these were silently
      // dropped engine-side before — now they land, so name them).
      if (p.kind === "own_time_started") {
        return { ...base, title: "His own time began", detail: reason || "the tick loop is running", subject_id: null, tone: "session" };
      }
      if (p.kind === "own_time_stop_requested") {
        return { ...base, title: "Own-time stop requested", detail: reason || "halts at the next tick boundary", subject_id: null, tone: "session" };
      }
      if (p.kind === "own_time_frozen") {
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
