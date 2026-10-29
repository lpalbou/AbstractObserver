/** The waiting card's sentence (operator QA 2026-10-29, ADR 0043: readable labels only).
 *
 * The card said "waiting · user · wait_key: tool_approval:dac02daa-…": the reason code and the
 * raw key. It now says what the run waits for and since when ("Waiting for your approval of
 * 4 tools since 7h 22m"), and, for an automation run, where that is decided (a tooltip hint).
 * Pure: the caller passes the run's facts and the clock. */
import { compact_duration } from "./state_line";

export type WaitCardInput = {
  reason: string;
  tool_calls: number;
  prompt?: string;
  event_name?: string;
  /** When the run started waiting (its last update), ms since the epoch; null when unknown. */
  since_ms: number | null;
  now_ms: number;
  session_id?: string;
};

export type WaitCardText = { text: string; hint: string };

export function wait_card_text(input: WaitCardInput): WaitCardText {
  const since = input.since_ms === null ? "" : ` since ${compact_duration(input.now_ms - input.since_ms)}`;
  const automation = String(input.session_id || "").startsWith("automation:");
  if (input.tool_calls > 0) {
    const n = input.tool_calls;
    return {
      text: `Waiting for your approval of ${n === 1 ? "1 tool" : `${n} tools`}${since}`,
      hint: automation
        ? "This automation asks before these tools. To let it run unattended, set them to Auto in the automation's Tools."
        : "",
    };
  }
  const reason = String(input.reason || "").trim().toLowerCase();
  if (reason === "user") return { text: `Waiting for your answer${since}`, hint: "" };
  if (reason === "event") {
    const name = String(input.event_name || "").trim();
    return { text: name ? `Waiting for the event ${name}${since}` : `Waiting for an event${since}`, hint: "" };
  }
  if (reason === "subworkflow") return { text: `Waiting for a child run to finish${since}`, hint: "" };
  if (reason === "job") return { text: `Waiting for a background job${since}`, hint: "" };
  if (reason === "until") return { text: "Waiting for its next scheduled time", hint: "" };
  return { text: `Waiting${since}`, hint: "" };
}
