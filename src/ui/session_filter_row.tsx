import React from "react";
import { AfFilterFacetRow } from "@abstractframework/ui-kit";
import type { SessionFilter, SessionFilterOption } from "./session_kinds";

/** The "Show" chips over the sessions (session_kinds.ts): All, Conversations, Automations, Notes,
 * and any other kind the gateway reports, each with how many sessions it shows; the chip in use is
 * pressed. Nothing renders when the gateway reports no kinds. */
export function SessionFilterRow(props: { options: SessionFilterOption[]; value: SessionFilter; on_change: (value: SessionFilter) => void; className?: string }): React.ReactElement | null {
  if (!props.options.length) return null;
  return (
    <div className={`session_filter_row${props.className ? ` ${props.className}` : ""}`}>
      <AfFilterFacetRow
        facet={{ id: "sessions", label: "Show", value: props.value, options: props.options.map((o) => ({ value: o.value, label: o.label, count: o.count, title: `${o.count} session${o.count === 1 ? "" : "s"}` })) }}
        onSelect={(_facet, value) => props.on_change(value)}
      />
    </div>
  );
}
