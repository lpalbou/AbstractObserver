/**
 * "After the run" on a run's card (framework ADR-0041, "No hidden effects after a flow"):
 * under each finished run of an automation, what happened after it — what arrived, the note
 * its On Flow End recorded, the alert it raised (or why nothing rang) and each delivery with
 * its channel, route, device and time — read from `GET /api/gateway/runs/{run_id}/after`.
 * The same section as Flow's run window; the words are the same.
 *
 * `AfterTheRunView` is pure (the tests render it in every state); `AfterTheRunLoader` reads the
 * route (LoadingState until it answered, an error with Retry only after every try failed) and
 * reads again for a few seconds while deliveries are still being recorded.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

import { LoadingState } from "./loading";

export type RunAfterDelivery = {
  record_key?: string | null;
  channel: string;
  via: string;
  device?: string;
  device_name?: string;
  time?: string | null;
  state: string;
  reason?: string;
};

export type RunAfterAlert = {
  record_key: string;
  kind?: string | null;
  title?: string | null;
  raised_at?: string | null;
  from?: string;
  run_id?: string | null;
  prompt_ref?: string | null;
  open?: boolean;
};

export type RunAfter = {
  run_id: string;
  trigger: {
    automation_title?: string | null;
    text?: string | null;
    connection?: string | null;
    arrived?: { count: number; noun: string; line?: string | null } | null;
  } | null;
  run: { status?: string; started?: string | null; ended?: string | null; response_excerpt?: string | null; note?: string | null };
  attention: RunAfterAlert | null;
  alerts?: RunAfterAlert[];
  deliveries: RunAfterDelivery[];
  quiet_reason?: string;
};

const CHANNEL_WORDS: Record<string, string> = {
  console: "Console",
  tray: "Tray",
  watch: "Watch",
  phone: "Phone",
  email: "Email",
  assistant: "Assistant",
  code: "Code",
};

export function quiet_sentence(reason: string | undefined): string {
  switch (reason) {
    case "empty title":
      return "Nothing to notify: the title was empty.";
    case "no notify":
      // AbstractGateway 0.17.1 (backlog 0956) also answers "no notify" when the flow has a Notify me
      // step the run did not reach (notify null/absent): one sentence true for both.
      return "Nothing to notify: the run did not reach a Notify me step.";
    case "still running":
      return "Still running: nothing has been sent yet.";
    case "not recorded yet":
      return "Finished; the automation has not recorded what it sends yet.";
    default:
      return reason ? `Nothing was sent (${reason}).` : "Nothing was sent.";
  }
}

export function arrived_sentence(after: RunAfter): string | null {
  const a = after.trigger?.arrived;
  if (!a) return null;
  return a.line ? `${a.count} ${a.noun}: ${a.line}` : `${a.count} ${a.noun}`;
}

export function alert_title(a: RunAfterAlert): string {
  if (a.title) return `“${a.title}”`;
  if (a.from === "wait") return a.kind === "question" ? "A question for you" : "An approval for you";
  if (a.from === "email_when_done") return a.kind === "failure" ? "It failed" : "It finished";
  return "Untitled";
}

export function alert_source(a: RunAfterAlert): string {
  if (a.from === "wait") return a.open ? "waiting for your answer" : "answered";
  if (a.from === "email_when_done") return "Email me when done";
  if (a.from === "notify_me") return "Notify me";
  if (a.from === "failure") return "The run failed";
  if (a.from === "publish") return "Publish to channel, with Alert on";
  return "On Flow End’s notify (older flows)";
}

export function delivery_sentence(d: RunAfterDelivery): string {
  const name = CHANNEL_WORDS[d.channel] || d.channel;
  const where = d.device_name ? `${name} (${d.device_name})` : name;
  const failed = d.state === "failed";
  if (d.channel === "console") return `${where} · listed · ${failed ? "not listed" : "sent"}`;
  const route = d.via === "push" ? "push notification" : d.via === "outbox" ? "email" : "shown by the app";
  return `${where} · ${route} · ${failed ? `not delivered${d.reason ? `: ${d.reason}` : ""}` : "sent"}`;
}

/** Deliveries land after the run ends: read again while the record is still filling, at most a few times. */
export const AFTER_REREAD_MS = 3000;
export const AFTER_REREADS = 5;
export function should_read_again(after: RunAfter, tries: number): boolean {
  if (tries > AFTER_REREADS) return false;
  if (after.quiet_reason === "not recorded yet" || after.quiet_reason === "still running") return true;
  return Boolean(after.attention) && after.deliveries.length === 0;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export type AfterTheRunState =
  | { status: "loading" }
  | { status: "failed"; error: string; on_retry?: () => void }
  | { status: "ready"; after: RunAfter };

export function AfterTheRunView(props: { state: AfterTheRunState }): React.ReactElement {
  const st = props.state;
  return (
    <section className="after_run" data-section="after-the-run" aria-label="After the run">
      <div className="after_run_title">After the run</div>
      {st.status === "loading" ? (
        <LoadingState what="after the run" label="Reading what happened after the run…" />
      ) : st.status === "failed" ? (
        <div className="after_run_error" role="alert">
          <span>Could not read what happened after the run: {st.error}</span>
          {st.on_retry ? (
            <button type="button" className="btn btn_sm" onClick={st.on_retry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : (
        <AfterTheRunBody after={st.after} />
      )}
    </section>
  );
}

function AfterTheRunBody(props: { after: RunAfter }): React.ReactElement {
  const after = props.after;
  const arrived = arrived_sentence(after);
  const alerts = after.alerts && after.alerts.length ? after.alerts : after.attention ? [after.attention] : [];
  return (
    <dl className="after_run_facts">
      {after.trigger && arrived ? (
        <>
          <dt>What arrived</dt>
          <dd data-field="arrived">{arrived}</dd>
        </>
      ) : null}
      {after.run.note ? (
        <>
          <dt>Note</dt>
          <dd data-field="note">{after.run.note}</dd>
        </>
      ) : null}
      <dt>Notified</dt>
      <dd data-field="notified">
        {alerts.length ? (
          <ul className="after_run_alerts">
            {alerts.map((a) => {
              const rows = after.deliveries.filter((d) => !d.record_key || d.record_key === a.record_key);
              return (
                <li key={a.record_key}>
                  <span className="after_run_alert_title">{alert_title(a)}</span>
                  <span className="muted">
                    {" "}
                    · {alert_source(a)}
                    {a.raised_at ? ` · ${when(a.raised_at)}` : ""}
                  </span>
                  {rows.length ? (
                    <ul className="after_run_deliveries">
                      {rows.map((d, i) => (
                        <li key={`${d.channel}:${d.device || ""}:${i}`} data-state={d.state}>
                          {delivery_sentence(d)}
                          {d.time ? <span className="muted"> · {when(d.time)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="muted">No delivery recorded yet.</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <span data-field="quiet">{quiet_sentence(after.quiet_reason)}</span>
        )}
      </dd>
    </dl>
  );
}

const READ_DELAYS_MS = [1000, 3000];

/** Up to 3 tries of one read (ADR-0039): the error is shown only once every try failed. */
export async function read_with_tries<T>(read: () => Promise<T>, delays: readonly number[] = READ_DELAYS_MS): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await read();
    } catch (e) {
      last = e;
      if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw last;
}

export function AfterTheRunLoader(props: { run_id: string; read: (run_id: string) => Promise<RunAfter> }): React.ReactElement {
  const { run_id, read } = props;
  const [state, set_state] = useState<AfterTheRunState>({ status: "loading" });
  const [attempt, set_attempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useCallback(() => {
    set_state({ status: "loading" });
    set_attempt((n) => n + 1);
  }, []);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const go = async () => {
      tries += 1;
      try {
        const after = await read_with_tries(() => read(run_id));
        if (!alive) return;
        set_state({ status: "ready", after });
        if (should_read_again(after, tries)) timer.current = setTimeout(go, AFTER_REREAD_MS);
      } catch (e) {
        if (!alive) return;
        set_state((cur) => (cur.status === "ready" ? cur : { status: "failed", error: e instanceof Error ? e.message : String(e), on_retry: retry }));
      }
    };
    void go();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run_id, read, attempt, retry]);
  return <AfterTheRunView state={state} />;
}
