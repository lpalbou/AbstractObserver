/**
 * LoadingState — the one visual "please wait" of the Observer (operator 2026-10-15 20:25:
 * "you MUST have some sort of spinning wheel or visual feedback to make people wait when it
 * loads"). A page or pane that has asked the gateway and has nothing to show yet renders THIS,
 * never an empty list, a "0", or a "nothing here" sentence that is not yet true.
 *
 * `what` is the noun of the thing being fetched ("automations", "runs", "artifacts", "ledger",
 * "entities", "automation"); the sentence is "Loading <what>…" unless `label` overrides it.
 * `size="inline"` fits a list row or a pane body; `size="block"` centres in an empty pane.
 * Accessible: role=status + aria-live=polite; the spin stops under prefers-reduced-motion
 * (styles.css `.af_loading_spin`).
 */
import React from "react";

import { Icon } from "@abstractframework/ui-kit";

export type LoadingWhat = "automations" | "automation" | "runs" | "run" | "artifacts" | "ledger" | "audit log" | "provider calls" | "memory" | "entities" | "activity" | (string & {});

export function loading_sentence(what: LoadingWhat, label?: string): string {
  const text = String(label || "").trim();
  if (text) return text;
  const noun = String(what || "").trim() || "data";
  return `Loading ${noun}…`;
}

export function LoadingState(props: { what: LoadingWhat; label?: string; size?: "inline" | "block"; className?: string }): React.ReactElement {
  const sentence = loading_sentence(props.what, props.label);
  const size = props.size === "block" ? "block" : "inline";
  return (
    <div className={`af_loading af_loading_${size}${props.className ? ` ${props.className}` : ""}`} role="status" aria-live="polite" aria-busy="true">
      <span className="af_loading_spin" aria-hidden="true">
        <Icon name="loader" size={size === "block" ? 20 : 16} />
      </span>
      <span className="af_loading_text">{sentence}</span>
    </div>
  );
}
