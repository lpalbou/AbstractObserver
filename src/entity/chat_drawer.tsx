/**
 * The chat drawer — talk to the entity while watching its mind move
 * (maintainer's ask, 0007 160200Z item 3; backend = gateway chat door,
 * 161002Z: open/turn/close hosting the driver's ChatSession).
 *
 * Honesty rules in pixels:
 * - `tools_ran` under each reply is DRIVER-AUTHORED truth (the
 *   marker-imitation lesson as API shape); reply prose is never parsed.
 * - Opening may wait for his own-time loop to yield at a tick boundary —
 *   the wait is shown, not hidden. Refusals (asleep by operator, paused,
 *   another visit open) render verbatim.
 * - Closing runs his reflection; the summary and any feelings/interests
 *   that moved are shown.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatComposer, ChatMessageCard, type ChatMessage } from "@abstractframework/panel-chat";

import { ledgerLine } from "./ledger_lines";
import {
  closeChat,
  getChatStatus,
  getChatTranscript,
  getEntitySubstrate,
  openChat,
  sendChatTurn,
  writeEntityWorkspaceFile,
  type ChatStatus,
  type ChatTurnResult,
} from "./stream_source";
import { toolClaimVerdict } from "./tool_claim_guard";
import type { SubstrateChoice } from "./substrate_picker";
import type { ReplayEnvelope } from "./stream_types";
import { TurnDetailModal } from "./turn_detail_modal";

/** A thread message, optionally carrying its turn's probe payload — the
 * discreet "system" badge under a reply opens it (maintainer, 2026-07-08:
 * the facts bubble was louder than the words). */
type DrawerMessage = ChatMessage & { detail?: ChatTurnResult };

function badgeLabel(detail: ChatTurnResult): string {
  const parts: string[] = [];
  if (typeof detail.memories_in_context === "number") parts.push(`${detail.memories_in_context} memories`);
  const formed = Array.isArray(detail.records_formed) ? detail.records_formed.length : detail.records_formed ? 1 : 0;
  if (formed) parts.push(`${formed} formed`);
  const diary = Array.isArray(detail.diary_entries) ? detail.diary_entries.length : detail.diary_entries ? 1 : 0;
  if (diary) parts.push(`${diary} diary`);
  // The tool count is ALWAYS shown, zero included (seq 43: a reader must
  // SEE the zero next to a reply that talks like it looked things up).
  const toolCount = (detail.tools_ran ?? []).length;
  parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  if (detail.files && detail.files.length > 0) parts.push(`${detail.files.length} file${detail.files.length === 1 ? "" : "s"}`);
  if ((detail.notices ?? []).length > 0) parts.push(`${(detail.notices ?? []).length} notice${(detail.notices ?? []).length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "details";
}

/** The drawer's own open visit, per entity — survives remounts and page
 * reloads so the drawer never mistakes its own session for a foreign one
 * (the maintainer's live P0: tab switch showed "a visit is already open
 * through another door" for the visit HE had opened). */
function chatSessionStorageKey(entity: string): string {
  return `abstractobserver_entity_chat_session:${entity}`;
}

export interface ChatDrawerProps {
  baseUrl: string;
  entity: string;
  entityName: string;
  token: string | null;
  participant: string;
  /** The live stream (for realtime turn activity: while OUR turn runs,
   * new envelopes on this home ARE this turn's activity — one life, one
   * summon). tools_ran in the turn response remains the tool authority. */
  envelopes: ReplayEnvelope[];
  onParticipantChange(value: string): void;
}

export function ChatDrawer(props: ChatDrawerProps): React.ReactElement {
  const { baseUrl, entity, entityName, token, participant, envelopes } = props;
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DrawerMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"idle" | "opening" | "turn" | "closing">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [detailTurn, setDetailTurn] = useState<ChatTurnResult | null>(null);
  // ONE substrate per entity (maintainer ruling 2026-07-09 06:32): the
  // drawer only DISPLAYS the gateway-stored mind; it is changed in the
  // controls strip (🧠) and resolved by the gateway on open — the visit
  // never asks separately.
  const [substrate, setSubstrate] = useState<SubstrateChoice | null>(null);
  useEffect(() => {
    let cancelled = false;
    getEntitySubstrate(baseUrl, entity)
      .then((s) => {
        if (!cancelled) setSubstrate(s && s.provider && s.model ? { provider: s.provider, model: s.model } : null);
      })
      .catch(() => undefined); // display-only; the open's refusal is the authority
    return () => {
      cancelled = true;
    };
  }, [baseUrl, entity]);
  // Files handed to the entity (maintainer ask, 2026-07-09): dropped or
  // picked, uploaded to his workspace/shared, referenced in the next turn.
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idRef = useRef(0);
  /** Seq high-water when the current turn started — live envelopes above
   * it render as realtime activity lines under the thinking shimmer. */
  const turnStartSeqRef = useRef<number>(Infinity);
  /** Chat ids we already rehydrated — the transcript fetch runs once per
   * adopted session, not once per status poll. */
  const rehydratedRef = useRef<Set<string>>(new Set());

  const liveActivity = useMemo(() => {
    if (busy !== "turn") return [];
    const lines: string[] = [];
    for (let i = envelopes.length - 1; i >= 0 && lines.length < 5; i--) {
      const env = envelopes[i];
      if (env.seq <= turnStartSeqRef.current) break;
      const line = ledgerLine(env);
      if (line.tone === "quiet") continue;
      lines.push(line.title + (line.detail ? ` — ${line.detail}` : ""));
    }
    return lines.reverse();
  }, [busy, envelopes]);

  const push = useCallback((msg: Omit<DrawerMessage, "id">) => {
    idRef.current += 1;
    // Never hand React (or any card) a non-string content — the object-as-
    // child class killed the whole app once (React #31, maintainer's
    // critical 2026-07-08 23:49). Coerce at the single entry point.
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
    setMessages((prev) => [...prev, { ...msg, content, id: `m${idRef.current}`, ts: new Date().toISOString() }]);
  }, []);

  /** Door refusals arrive as raw response text — either
   * '{"detail":"a visit is open…"}' or the summon-refusal shape
   * '{"detail":{"refused":true,"reasons":[…]}}'. Surface the human
   * sentences, never JSON armor. */
  const refusalText = (e: Error & { status?: number }): string => {
    const raw = String(e.message || "");
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      const detail = parsed?.detail;
      if (typeof detail === "string") return detail;
      if (detail && typeof detail === "object") {
        const reasons = (detail as { reasons?: unknown }).reasons;
        if (Array.isArray(reasons) && reasons.length > 0) {
          return reasons.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join(" · ");
        }
        return JSON.stringify(detail);
      }
    } catch {
      // not JSON: raw text IS the message
    }
    return raw;
  };

  /** Resume a session after a remount/reload: the transcript endpoint (the
   * shared room's pure read) rebuilds the thread, every voice included.
   * Called automatically when the stored chat id matches the open visit,
   * and manually via the REJOIN button when it does not (maintainer,
   * 2026-07-09: a reload lost the stored id and the drawer dead-ended on
   * "another door" for HIS OWN discussion — the operator can always step
   * back into an open room; turns carry `speaker` so voices stay honest). */
  const rehydrate = useCallback(
    (ownChatId: string) => {
      try {
        localStorage.setItem(chatSessionStorageKey(entity), ownChatId);
      } catch {
        // presentation state only
      }
      if (rehydratedRef.current.has(ownChatId)) {
        setChatId(ownChatId);
        return;
      }
      rehydratedRef.current.add(ownChatId);
      setChatId(ownChatId);
      getChatTranscript(baseUrl, entity, ownChatId)
        .then((t) => {
          const rebuilt: DrawerMessage[] = [];
          let mid = 0;
          rebuilt.push({ id: `r${++mid}`, role: "system", content: `Rejoined the open visit with ${entityName}.` });
          for (const turn of t.turns ?? []) {
            if (turn.text) rebuilt.push({ id: `r${++mid}`, role: "user", content: turn.text, title: turn.speaker, ts: turn.at });
            if (turn.reply) rebuilt.push({ id: `r${++mid}`, role: "assistant", content: turn.reply, title: entityName, ts: turn.at });
            // Tools are ALWAYS stated, zero included — a reader must SEE
            // the zero under a reply that talks like it looked things up
            // (seq 43). A claim over an empty record is flagged verbatim.
            const ran = turn.tools_ran ?? [];
            rebuilt.push({
              id: `r${++mid}`,
              role: "system",
              content: ran.length > 0 ? `tools ran this turn: ${ran.join(", ")}` : "no tools ran this turn",
              level: "info",
            });
            const verdict = toolClaimVerdict(turn.reply, ran);
            if (verdict.fabricated) {
              rebuilt.push({
                id: `r${++mid}`,
                role: "system",
                content: `⚠ This reply claims a lookup, but no tools ran — the claimed evidence was not fetched. (${verdict.claims[0]?.snippet ?? ""})`,
                level: "warn",
              });
            }
          }
          idRef.current = mid;
          setMessages(rebuilt);
        })
        .catch((e: Error) => {
          push({ role: "system", content: `Rejoined the open visit; earlier turns could not be fetched (${e.message}).`, level: "warn" });
        });
    },
    [baseUrl, entity, entityName, push],
  );

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getChatStatus(baseUrl, entity)
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          if (s.open && !chatId) {
            // An open session that WE started (stored id matches) resumes
            // automatically. Any other open visit renders with a REJOIN
            // button instead of a dead end — never auto-hijacked, but the
            // operator can always step back in (their reload may have lost
            // the stored id; the room is still theirs to enter).
            let stored: string | null = null;
            try {
              stored = localStorage.getItem(chatSessionStorageKey(entity));
            } catch {
              // presentation state only
            }
            if (stored && s.chat_id === stored) rehydrate(stored);
          }
          if (!s.open && chatId) {
            setChatId(null);
            try {
              localStorage.removeItem(chatSessionStorageKey(entity));
            } catch {
              // best-effort
            }
          }
        })
        .catch(() => !cancelled && setStatus(null));
    };
    poll();
    const interval = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [baseUrl, entity, chatId, rehydrate]);

  const open = useCallback(() => {
    // Maintainer ruling (2026-07-08): never block the operator. An empty
    // name defaults to person:operator instead of refusing.
    const who = participant.trim() || "person:operator";
    // ONE substrate per entity (2026-07-09 06:32): the gateway resolves the
    // entity's persisted choice — the visit never asks separately. If no
    // choice exists anywhere, the gateway's refusal names the fix.
    setBusy("opening");
    setNote("Opening — if his own time is running, this waits for the tick boundary (up to a minute)…");
    openChat(baseUrl, entity, who, token, {})
      .then((r) => {
        setChatId(r.chat_id);
        rehydratedRef.current.add(r.chat_id); // freshly opened: nothing to fetch
        try {
          localStorage.setItem(chatSessionStorageKey(entity), r.chat_id);
        } catch {
          // best-effort
        }
        setNote(null);
        push({
          role: "system",
          content: `The door opened: ${entityName} is visiting with you${r.yielded_loop ? " (his own time yielded for this visit)" : ""}. Prelude ${r.prelude_tokens ?? "?"} tokens.`,
        });
      })
      .catch((e: Error & { status?: number }) => {
        // 409 = someone (or his own time) holds the room; the next status
        // poll will show the foreign-visit note — refresh it NOW so the
        // operator is not left with a stale start screen (the 23:49 race:
        // status said closed, the click met a conflict).
        setNote(
          e.status === 401 || e.status === 403
            ? "The door refused: operator auth required (set the token in the controls strip)."
            : `The door refused: ${refusalText(e)}`,
        );
        getChatStatus(baseUrl, entity)
          .then(setStatus)
          .catch(() => undefined);
      })
      .finally(() => setBusy("idle"));
  }, [baseUrl, entity, entityName, participant, token, push, substrate]);

  /** Sanitize a dropped filename into a safe workspace leaf. */
  const safeName = (name: string): string =>
    (name.split(/[\\/]/).pop() || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || uploading) return;
      setUploading(true);
      setNote(null);
      const landed: Array<{ name: string; path: string }> = [];
      try {
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const dest = `shared/${safeName(file.name)}`;
          await writeEntityWorkspaceFile(baseUrl, entity, dest, bytes, token);
          landed.push({ name: file.name, path: dest });
        }
        setPendingFiles((prev) => [...prev, ...landed]);
        push({
          role: "system",
          content: `Placed in his workspace: ${landed.map((f) => f.path).join(", ")} — he can read ${landed.length === 1 ? "it" : "them"} with read_file. Referenced in your next message.`,
          level: "info",
        });
      } catch (e) {
        setNote(`Could not hand over the file: ${refusalText(e as Error & { status?: number })}`);
      } finally {
        setUploading(false);
      }
    },
    [baseUrl, entity, token, uploading, push],
  );

  const send = useCallback(() => {
    let text = draft.trim();
    // Reference any handed-over files so the entity knows to read them.
    if (pendingFiles.length > 0) {
      const refs = pendingFiles.map((f) => `- ${f.path}`).join("\n");
      const preface = `I've placed ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} in your workspace (read with read_file):\n${refs}`;
      text = text ? `${preface}\n\n${text}` : preface;
    }
    if (!text || !chatId || busy !== "idle") return;
    setDraft("");
    setPendingFiles([]);
    push({ role: "user", content: text });
    turnStartSeqRef.current = envelopes.length > 0 ? envelopes[envelopes.length - 1].seq : 0;
    setBusy("turn");
    // The speaker rides on every turn: in a rejoined room the session opener
    // may differ from who is typing NOW — attribution follows the voice.
    const speaker = participant.trim() || undefined;
    sendChatTurn(baseUrl, entity, chatId, text, token, speaker)
      .then((r) => {
        // The turn's facts ride WITH the reply as a discreet badge (the
        // maintainer's ask: the system bubble was louder than the words);
        // one click opens the full probe modal. reply coerced by push().
        push({ role: "assistant", content: r.reply, title: entityName, detail: r });
        // Fabricated-lookup flag (seq 43 FAILURE 1): prose CLAIM vs driver
        // FACT mismatch is called out in the thread, loudly, at the moment
        // it happens — not discovered later in forensics.
        const verdict = toolClaimVerdict(r.reply, r.tools_ran);
        if (verdict.fabricated) {
          push({
            role: "system",
            content: `⚠ This reply claims a lookup, but no tools ran this turn — the claimed evidence was not fetched. (${verdict.claims[0]?.snippet ?? ""})`,
            level: "warn",
          });
        }
      })
      .catch((e: Error & { status?: number }) => push({ role: "system", content: `The turn failed: ${refusalText(e)}`, level: "error" }))
      .finally(() => setBusy("idle"));
  }, [draft, chatId, busy, baseUrl, entity, entityName, token, push, pendingFiles, participant]);

  const close = useCallback(() => {
    if (!chatId || busy !== "idle") return;
    setBusy("closing");
    setNote("Closing — his reflection runs now (feelings may move)…");
    closeChat(baseUrl, entity, chatId, token)
      .then((r) => {
        setNote(null);
        const parts: string[] = [];
        if (r.summary) parts.push(r.summary);
        if (r.reflection?.feelings_applied) parts.push(`${r.reflection.feelings_applied} feelings moved`);
        if (r.reflection?.interests?.length) parts.push(`new interest: ${r.reflection.interests.join("; ")}`);
        push({ role: "system", content: parts.length ? `Visit closed. ${parts.join(" · ")}` : "Visit closed." });
        setChatId(null);
        try {
          localStorage.removeItem(chatSessionStorageKey(entity));
        } catch {
          // best-effort
        }
      })
      .catch((e: Error) => {
        setNote(`Close failed: ${e.message}`);
      })
      .finally(() => setBusy("idle"));
  }, [chatId, busy, baseUrl, entity, token, push]);

  /** Copy the FULL visit verbatim to the clipboard (maintainer ask,
   * 2026-07-09: "a way to copy the verbatim of a full visit, for us, to
   * debug"). Pulls the shared-room transcript (every voice, every tool)
   * and renders it as plain text — the debugging artifact. */
  const copyVisit = useCallback(async () => {
    if (!chatId) return;
    try {
      const t = await getChatTranscript(baseUrl, entity, chatId);
      const lines: string[] = [
        `# Visit transcript — ${entityName}`,
        `chat_id: ${chatId}`,
        `participants: ${(t.participants ?? []).join(", ")}`,
        "",
      ];
      for (const turn of t.turns ?? []) {
        lines.push(`## ${turn.speaker ?? "?"}  (${turn.turn_id ?? ""}${turn.at ? ` · ${turn.at}` : ""})`);
        if (turn.text) lines.push(turn.text);
        lines.push("");
        lines.push(`### ${entityName}`);
        if (turn.reply) lines.push(turn.reply);
        const ran = turn.tools_ran ?? [];
        lines.push(ran.length > 0 ? `[tools ran: ${ran.join(", ")}]` : `[tools ran: none]`);
        const verdict = toolClaimVerdict(turn.reply, ran);
        if (verdict.fabricated) lines.push(`[⚠ FABRICATED LOOKUP CLAIM — reply claims a lookup, zero tools ran]`);
        lines.push("", "---", "");
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      setNote(`Copied the full visit (${(t.turns ?? []).length} turns) to the clipboard.`);
    } catch (e) {
      setNote(`Could not copy the visit: ${refusalText(e as Error & { status?: number })}`);
    }
  }, [baseUrl, entity, chatId, entityName]);

  const foreignVisit = status?.open && !chatId;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    if (!chatId) return; // a room must be open to hand him something
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) void uploadFiles(files);
  };

  return (
    <div
      className={`chat_drawer ${dropActive ? "cd_drop_active" : ""}`}
      onDragOver={(e) => {
        if (chatId && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      {!chatId ? (
        <div className="cd_start">
          {foreignVisit ? (
            <>
              <p className="cd_note">
                A visit is open{status?.opened_at ? ` since ${new Date(status.opened_at).toLocaleTimeString()}` : ""}
                {typeof status?.turns === "number" ? ` (${status.turns} turn${status.turns === 1 ? "" : "s"})` : ""}. If it's yours
                — a reload can lose the drawer's memory of it — step back in; the whole conversation returns.
              </p>
              <button className="cd_open_btn" onClick={() => status?.chat_id && rehydrate(status.chat_id)} disabled={!status?.chat_id}>
                rejoin this visit
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                className="cd_participant"
                placeholder="who are you? (person:…)"
                value={participant}
                onChange={(e) => props.onParticipantChange(e.target.value)}
                title="Stamped into his memories as WHO he lived this with"
              />
              {/* ONE substrate per entity (2026-07-09 06:32): the visit uses
                * the SAME stored mind as his own time — shown here, changed
                * only in the controls strip (🧠). No second picker. */}
              <p className="cd_note" title="Visits and his own time share one mind — change it with the 🧠 control in the strip above">
                {substrate?.provider && substrate?.model
                  ? `mind: ${substrate.provider} / ${substrate.model}`
                  : "mind: the gateway's stored choice for him (set it once with 🧠 in the controls strip)"}
              </p>
              <button className="cd_open_btn" onClick={open} disabled={busy === "opening"}>
                {busy === "opening" ? "opening…" : `visit ${entityName}`}
              </button>
            </>
          )}
          {note ? <p className="cd_note">{note}</p> : null}
        </div>
      ) : (
        <>
          <ChatMessageList messages={messages} onDetail={setDetailTurn} />
          {detailTurn ? <TurnDetailModal turn={detailTurn} entityName={entityName} onClose={() => setDetailTurn(null)} /> : null}
          {busy === "turn" ? (
            <div className="cd_thinking" aria-live="polite">
              <span className="cd_shimmer" />
              <span className="cd_shimmer cd_shimmer_2" />
              <span className="cd_shimmer cd_shimmer_3" />
              {liveActivity.map((line, i) => (
                <span key={i} className="cd_activity">
                  {line}
                </span>
              ))}
            </div>
          ) : null}
          {note ? <p className="cd_note">{note}</p> : null}
          {pendingFiles.length > 0 ? (
            <div className="cd_files">
              {pendingFiles.map((f, i) => (
                <span key={i} className="cd_file_chip" title={`in his workspace: ${f.path}`}>
                  📎 {f.name}
                  <button
                    className="cd_file_x"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                    title="Don't reference this file (it stays in his workspace)"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {dropActive ? <div className="cd_drop_hint">drop to place in {entityName}'s workspace</div> : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) void uploadFiles(files);
              e.target.value = "";
            }}
          />
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            placeholder={`talk with ${entityName}…  (drop or attach files)`}
            busy={busy === "turn"}
            disabled={busy !== "idle"}
            rows={2}
            actions={
              <>
                <button
                  className="cd_attach_btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || busy !== "idle"}
                  title="Give him a file — placed in his workspace, he reads it with read_file"
                >
                  {uploading ? "…" : "📎"}
                </button>
                <button className="cd_attach_btn" onClick={() => void copyVisit()} title="Copy the full visit verbatim to the clipboard (every voice + tools, for debugging)">
                  ⧉
                </button>
                <button className="cd_close_btn" onClick={close} disabled={busy !== "idle"} title="Close the visit — his reflection runs, then his own time resumes">
                  end visit
                </button>
              </>
            }
          />
        </>
      )}
    </div>
  );
}

/** The drawer's own thread: message cards + the discreet per-turn "system"
 * badge under each reply that carries a probe payload. Replaces the shared
 * ChatThread (which can only render whole cards — the facts bubble read as
 * loud as the words). Keeps its stick-to-bottom behavior. */
function ChatMessageList({
  messages,
  onDetail,
}: {
  messages: DrawerMessage[];
  onDetail(detail: ChatTurnResult): void;
}): React.ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div ref={listRef} className="pc-chat-thread cd_thread">
      {messages.length === 0 ? <span className="cd_note">Say hello — he knows you knocked.</span> : null}
      {messages.map((m) => (
        <React.Fragment key={m.id}>
          <ChatMessageCard message={m} />
          {m.detail ? (
            <button
              className="cd_sysbadge"
              onClick={() => onDetail(m.detail!)}
              title="What moved in his mind this turn — memories in context, formations, tools, files"
            >
              <span className="cd_sysbadge_dot" aria-hidden="true" />
              system · {badgeLabel(m.detail)}
            </button>
          ) : null}
        </React.Fragment>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
