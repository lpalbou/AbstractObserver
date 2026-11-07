import React from "react";
import { AfFilterFacetRow } from "@abstractframework/ui-kit";
import type { SessionFilter, SessionFilterOption } from "./session_kinds";

/** The "Sessions" chips (session_kinds.ts): All, Conversations, Automations, Notes and any other
 * kind the gateway reports; the chip in use is pressed. No counts (the gateway returns no per-kind
 * total). Nothing renders when the gateway does not advertise the kind filter. */
export function SessionFilterRow(props: { options: SessionFilterOption[]; value: SessionFilter; on_change: (value: SessionFilter) => void; className?: string }): React.ReactElement | null {
  if (!props.options.length) return null;
  return (
    <div className={`session_filter_row${props.className ? ` ${props.className}` : ""}`}>
      <AfFilterFacetRow
        facet={{ id: "sessions", label: "Sessions", value: props.value, options: props.options.map((o) => ({ value: o.value, label: o.label })) }}
        onSelect={(_facet, value) => props.on_change(value)}
      />
    </div>
  );
}
