/**
 * The verbatim reader: click a memory, read the words behind it.
 *
 * Maintainer ruling (2026-07-08 00:59): the operator reads WITHOUT
 * ceremony — no reason prompts, no refusals-by-design. One click, the
 * words. Three paths:
 * - RECORD verbatim: the gateway resolves payload_ref into the home's
 *   artifact store; interest/dream records answer `born_digest: true`
 *   (born as words — the digest IS the complete text, never an error).
 * - IDENTITY records serve the attested spark text (the seed).
 * - DIARY entries read one-click through the gateway's diary endpoint
 *   (a standard reason is attached server-side; the read still lands as
 *   a visible diary_read moment in the stream — truth, not friction).
 *
 * Rendering uses the shared panel-chat Markdown component (abstractuic);
 * structured content (YAML/JSON) is fenced so it reads as code.
 */

import React, { useEffect, useState } from "react";

import { Markdown } from "@abstractframework/panel-chat";

import { fetchDiaryEntry, fetchRecordVerbatim, type RecordVerbatim } from "./stream_source";
import type { NodeState } from "./stream_fold";

export interface VerbatimSource {
  baseUrl: string;
  entity: string;
}

export interface VerbatimModalProps {
  node: NodeState;
  source: VerbatimSource;
  /** Present when this is a diary read through the operator door. */
  diaryReason?: string;
  onClose(): void;
}

type FetchState =
  | { phase: "loading" }
  | { phase: "ready"; verbatim: RecordVerbatim; note: string | null }
  | { phase: "error"; message: string; unavailable: boolean };

const IDENTITY_KINDS = new Set(["value", "purpose", "trait", "claim"]);

/** Fence structured content so the Markdown component renders it as code;
 * prose passes through untouched. */
function presentText(text: string, contentType: string | undefined, kind: string): string {
  const t = String(contentType || "").toLowerCase();
  if (t.includes("yaml") || IDENTITY_KINDS.has(kind)) return "```yaml\n" + text + "\n```";
  if (t.includes("json")) return "```json\n" + text + "\n```";
  return text;
}

export function VerbatimModal({ node, source, diaryReason, onClose }: VerbatimModalProps): React.ReactElement {
  const [state, setState] = useState<FetchState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });

    const load = async (): Promise<{ verbatim: RecordVerbatim; note: string | null }> => {
      if (node.diary && node.entry_id) {
        const entry = await fetchDiaryEntry(source.baseUrl, source.entity, node.entry_id, diaryReason || "operator review");
        return {
          verbatim: {
            record_id: node.entry_id,
            title: node.title,
            text: String(entry.text ?? entry.gist ?? ""),
            content_type: "text/plain",
            turn_id: null,
            run_id: null,
            created_at: typeof entry.written_at === "string" ? entry.written_at : null,
            kind: "diary",
          },
          note: null,
        };
      }
      const verbatim = await fetchRecordVerbatim(source.baseUrl, source.entity, node.graph_id ?? node.id);
      let note: string | null = null;
      if (verbatim.born_digest) {
        note = "Born as words — this record was never a compression; the words you see are all the words there are.";
      } else if (IDENTITY_KINDS.has(node.kind)) {
        note = "The seed — this is the attested spark text the identity was engrammed from.";
      }
      return { verbatim, note };
    };

    load()
      .then(({ verbatim, note }) => {
        if (!cancelled) setState({ phase: "ready", verbatim, note });
      })
      .catch((e: Error & { status?: number }) => {
        if (cancelled) return;
        const unavailable = e.status === 404;
        setState({
          phase: "error",
          unavailable,
          message:
            e.status === 403
              ? "The gateway refused this read (403). Maintainer ruling 2026-07-08: operator reads are not to be refused — this refusal is a gateway-side bug; reported on the channel."
              : unavailable
                ? "No verbatim is served for this memory — the record carries none. The digest above remains the honest summary."
                : `Could not read the verbatim: ${e.message}`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [node, source, diaryReason]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ev_backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ev_panel">
        <div className="ev_head">
          <div className="ev_title">
            <span className={`ei_kind ei_kind_${node.diary ? "diary" : node.kind}`}>{node.diary ? "diary" : node.kind}</span>
            <span>{node.title || node.id.slice(0, 24)}</span>
          </div>
          <button className="ev_close" onClick={onClose}>
            close
          </button>
        </div>
        <div className="ev_body">
          {state.phase === "loading" ? <div className="ev_status">reading…</div> : null}
          {state.phase === "error" ? <div className={`ev_status ${state.unavailable ? "" : "ev_status_error"}`}>{state.message}</div> : null}
          {state.phase === "ready" ? (
            <>
              {state.note ? <div className="ev_note">{state.note}</div> : null}
              <Markdown text={presentText(state.verbatim.text, state.verbatim.content_type, node.kind)} className="ev_markdown" />
              <div className="ev_meta">
                {state.verbatim.turn_id ? <span>turn {state.verbatim.turn_id}</span> : null}
                {state.verbatim.run_id ? <span>{state.verbatim.run_id}</span> : null}
                {state.verbatim.created_at ? <span>{state.verbatim.created_at.slice(0, 19)}</span> : null}
                <span>{state.verbatim.born_digest ? "born as words" : node.diary ? "the book" : "lossless verbatim — the digest is what recall carries"}</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
