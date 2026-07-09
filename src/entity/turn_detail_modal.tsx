/**
 * The turn probe (maintainer ask, 2026-07-08): one click on the discreet
 * "system" badge under a reply opens everything the turn DID —
 *
 * - memories that entered his context (why, lifetime use count, temporal
 *   activation, token cost, digest),
 * - memories/diary entries formed,
 * - tools that actually ran (driver-authored) with their arguments,
 * - files read/written/listed in the workspace,
 * - notices (marker imitation, refusals, fallbacks).
 *
 * "The goal is really to be able to probe the input context and the
 * outcomes." Everything here is driver-authored data; nothing is parsed
 * from reply prose.
 */

import React, { useEffect, useState } from "react";

import type { ChatTurnResult, TurnMemory } from "./stream_source";
import { toolClaimVerdict } from "./tool_claim_guard";

export interface TurnDetailModalProps {
  turn: ChatTurnResult;
  entityName: string;
  onClose(): void;
}

const WHY_LABEL: Record<string, string> = {
  stimulus: "matched what was said",
  stm: "just worked with it",
  both: "matched + just worked with it",
  self: "identity (always present)",
};

/** Render-safe text: the object-as-child class crashed the whole app once
 * (React #31, 2026-07-08 23:49) — every server-shaped field renders
 * through this, never raw. */
function safeText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}

function MemoryRow({ m }: { m: TurnMemory }): React.ReactElement {
  const activation = m.activation ?? {};
  const total = typeof activation.total === "number" ? activation.total : null;
  return (
    <div className="tdm_mem">
      <div className="tdm_mem_head">
        <span className={`ei_kind ei_kind_${safeText(m.kind) || "memory"}`}>{safeText(m.kind) || "memory"}</span>
        <span className="tdm_mem_title">{safeText(m.title) || safeText(m.tag) || m.graph_id?.slice(0, 22) || "?"}</span>
        {m.tag ? <span className="tdm_tag">#{safeText(m.tag)}</span> : null}
      </div>
      {m.digest ? <div className="tdm_mem_digest">{safeText(m.digest)}</div> : null}
      <div className="tdm_mem_meta">
        <span title="Why this memory entered the context">{WHY_LABEL[m.admission ?? ""] ?? m.why ?? "recalled"}</span>
        {m.born_at ? (
          <span title="When this memory was born — 'last time' is answerable">{safeText(m.born_at).slice(0, 16).replace("T", " ")}</span>
        ) : null}
        {m.origin ? (
          <span title="Where it came from — his own retellings are not corroborations">{safeText(m.origin)}</span>
        ) : null}
        <span title="Lifetime selected count — never decays">used {m.global_count ?? 0}×</span>
        {total !== null ? <span title="Temporal activation right now (decays with disuse)">warmth {total.toFixed(1)}</span> : null}
        {m.tokens ? <span title="Prompt tokens this handle cost">~{m.tokens} tok</span> : null}
      </div>
    </div>
  );
}

type ProbeTab = "context" | "tools" | "system";

async function copyToClipboard(text: string, done: (msg: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    done("copied");
  } catch {
    done("copy failed");
  }
}

export function TurnDetailModal({ turn, entityName, onClose }: TurnDetailModalProps): React.ReactElement {
  const [tab, setTab] = useState<ProbeTab>("context");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const memories = turn.memories ?? [];
  const formed = turn.records_formed ?? [];
  const diary = turn.diary_entries ?? [];
  const tools: Array<{ name: string; arg?: string; result?: string }> =
    turn.tool_details ?? (turn.tools_ran ?? []).map((name) => ({ name }));
  const files = turn.files ?? [];
  const notices = turn.notices ?? [];
  const formedList = Array.isArray(formed) ? formed : [];
  const diaryList = Array.isArray(diary) ? diary : [];
  const systemPrompt = turn.system_prompt ?? "";
  // Prose-claim vs driver-fact mismatch (seq 43 R6): flagged, never parsed
  // into facts — tools_ran stays the only authority on what ran.
  const claimVerdict = toolClaimVerdict(turn.reply, turn.tools_ran);

  const contextText = (): string => {
    const lines = [`# Context — ${turn.turn_id ?? "this turn"} (${memories.length} memories)`, ""];
    for (const m of memories) {
      lines.push(`## ${safeText(m.kind) || "memory"} — ${safeText(m.title) || safeText(m.tag) || m.graph_id || "?"}`);
      const meta = [`why: ${WHY_LABEL[m.admission ?? ""] ?? safeText(m.why) ?? "recalled"}`];
      if (m.born_at) meta.push(`born ${safeText(m.born_at).slice(0, 16)}`);
      if (m.origin) meta.push(`origin ${safeText(m.origin)}`);
      meta.push(`used ${m.global_count ?? 0}×`, `~${m.tokens ?? "?"} tok`);
      lines.push(meta.join(" · "));
      if (m.digest) lines.push(safeText(m.digest));
      lines.push("");
    }
    return lines.join("\n");
  };
  const toolsText = (): string =>
    tools.length === 0
      ? "no tools ran this turn"
      : tools
          .map((t) => `## ${safeText(t.name)} ${safeText(t.arg)}\n${t.result ? safeText(t.result) : "(no result returned to the entity — see the agency note)"}`)
          .join("\n\n");

  const flash = (msg: string) => {
    setCopied(msg);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div
      className="ev_backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ev_panel tdm_panel">
        <div className="ev_head">
          <div className="ev_title">
            <span className="ei_kind ei_kind_summary">turn</span>
            <span>
              {turn.turn_id ?? "this turn"} — what moved in {entityName}'s mind
            </span>
          </div>
          <button className="ev_close" onClick={onClose}>
            close
          </button>
        </div>
        <div className="tdm_tabs">
          <button className={`tdm_tab ${tab === "context" ? "tdm_tab_on" : ""}`} onClick={() => setTab("context")}>
            Context <span className="tdm_count">{memories.length}</span>
          </button>
          <button className={`tdm_tab ${tab === "tools" ? "tdm_tab_on" : ""}`} onClick={() => setTab("tools")}>
            Tools <span className="tdm_count">{tools.length}</span>
          </button>
          <button className={`tdm_tab ${tab === "system" ? "tdm_tab_on" : ""}`} onClick={() => setTab("system")}>
            System prompt
          </button>
          <span className="tdm_tab_spacer" />
          <button
            className="tdm_copy"
            title="Copy this tab's content to the clipboard"
            onClick={() =>
              void copyToClipboard(tab === "context" ? contextText() : tab === "tools" ? toolsText() : systemPrompt, flash)
            }
          >
            {copied ?? "⧉ copy"}
          </button>
        </div>
        <div className="ev_body tdm_body">
          {tab === "context" ? (
            <>
              <section>
                {memories.length === 0 ? (
                  <p className="tdm_quiet">No memories beyond his identity core entered this turn.</p>
                ) : (
                  memories.map((m, i) => <MemoryRow key={m.record_id ?? m.tag ?? i} m={m} />)
                )}
              </section>
              <section>
                <h4 className="tdm_h">
                  Formed this turn <span className="tdm_count">{formedList.length + diaryList.length}</span>
                </h4>
                {formedList.length === 0 && diaryList.length === 0 ? (
                  <p className="tdm_quiet">Nothing formed (the turn did not complete a memory).</p>
                ) : (
                  <ul className="tdm_list">
                    {formedList.map((id) => (
                      <li key={id}>
                        <span className="ei_kind ei_kind_episode">memory</span> <code>{id}</code>
                      </li>
                    ))}
                    {diaryList.map((id) => (
                      <li key={id}>
                        <span className="ei_kind ei_kind_diary">diary</span> <code>{id}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {files.length > 0 ? (
                <section>
                  <h4 className="tdm_h">
                    Files touched <span className="tdm_count">{files.length}</span>
                  </h4>
                  <ul className="tdm_list">
                    {files.map((f, i) => (
                      <li key={i}>
                        <span className={`tdm_action tdm_action_${safeText(f.action)}`}>{safeText(f.action)}</span> <code>{safeText(f.path)}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}

          {tab === "tools" ? (
            <section>
              {claimVerdict.fabricated ? (
                <div className="tdm_fabricated" title="The reply's prose claims a lookup; the driver-authored record shows zero tools ran. The claimed evidence was never fetched.">
                  ⚠ The reply claims a lookup, but no tools ran this turn — the claimed evidence was not fetched.
                  {claimVerdict.claims.slice(0, 3).map((c, i) => (
                    <div key={i} className="tdm_claim_snippet">
                      “{c.snippet}”
                    </div>
                  ))}
                </div>
              ) : null}
              {tools.length === 0 ? (
                <p className="tdm_quiet">No lookups — the reply came from context alone.</p>
              ) : (
                tools.map((t, i) => (
                  <div key={i} className="tdm_tool">
                    <div className="tdm_tool_head">
                      <code>{safeText(t.name)}</code>
                      {t.arg ? <span className="tdm_arg">{safeText(t.arg)}</span> : null}
                    </div>
                    {t.result ? (
                      <pre className="tdm_tool_result">{safeText(t.result)}</pre>
                    ) : (
                      <p className="tdm_quiet tdm_tool_noresult">
                        No result recorded for this tool — the gateway did not return what the lookup produced. Reported to
                        the runtime/agency lanes (2026-07-09).
                      </p>
                    )}
                  </div>
                ))
              )}
              {notices.length > 0 ? (
                <div className="tdm_notices_block">
                  <h4 className="tdm_h">Notices</h4>
                  <ul className="tdm_list tdm_notices">
                    {notices.map((n, i) => (
                      <li key={i}>{safeText(n)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "system" ? (
            <section>
              {systemPrompt ? (
                <pre className="tdm_system">{systemPrompt}</pre>
              ) : (
                <p className="tdm_quiet">
                  The gateway did not return the system prompt for this turn. Requested from the runtime lane
                  (2026-07-09) — once it rides the turn response, the exact prompt sent to the model shows here.
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
