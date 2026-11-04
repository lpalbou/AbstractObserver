/**
 * Digital identity in the Observer (framework ADR 0052, backlog 1119): an entity is drawn by the
 * identity its row names, and a conversation's agent page says what its track record is.
 *
 * - The reference: an entity roster row (`GET /entities`) carries its current record (`identity`,
 *   with `rev`) beside its `entity_id` (the subject, `entity:castor`): the ref is that pair. A row
 *   without a record (a home before the gateway's boot pass, a held home) has no ref and keeps the
 *   tile it always had.
 * - The look: `GET /entities/{name}/identity?rev=N`, read once per ref (`IdentityLooks`): a later
 *   poll of the same ref reads nothing; a new rev reads its record. A read that fails, or answers for
 *   another ref, draws NOTHING in its place: the tile shows the gateway's sentence.
 * - The colour reaches the kit's avatar through its palette token: `ActivityAvatar` resolves the
 *   body colour from `--warning` around its canvas (ui-kit `avatarPaletteFromCss`), so a wrapper
 *   setting that one token paints the body in the entity's colour on the theme's background.
 * - The track record: the runtime's numbers as the gateway serves them, in plain words, always
 *   with what they are ("completion rate only, nobody has judged the quality yet").
 */
import React, { useEffect, useState } from "react";
import { ActivityAvatar, avatarDesigns } from "@abstractframework/ui-kit";

import "./identity.css";

/** `{of, rev}`: whose identity, at which revision (`entity:castor#3`). */
export type IdentityRef = { of: string; rev: number };

/** What the board draws and says of one identity record. */
export type IdentityLook = { style: string; color: string; voice: string };

export function ref_text(ref: IdentityRef): string {
  return `${ref.of}#${ref.rev}`;
}

/** The ref of an entity roster row, or null when the row carries no identity record. */
export function entity_row_ref(row: any): IdentityRef | null {
  const identity = row?.identity;
  if (!identity || typeof identity !== "object") return null;
  const of = typeof row?.entity_id === "string" ? row.entity_id.trim() : "";
  const rev = identity.rev;
  if (!of || typeof rev !== "number" || !Number.isInteger(rev) || rev < 1) return null;
  return { of, rev };
}

/** The voice of a record in words: its voice name, or "no voice yet" for a recorded absence. */
function voice_words(voice: any): string {
  if (voice === null) return "no voice yet";
  const name = String(voice?.voice || "").trim();
  if (!name) throw new Error("the record's voice names no voice");
  return name;
}

/** The look of a `GET /identity?rev=N` answer; throws when the answer is not the ref asked for. */
export function look_of_answer(answer: any, ref: IdentityRef): IdentityLook {
  const got = answer?.identity_ref;
  if (!got || got.of !== ref.of || got.rev !== ref.rev) {
    const named = got && typeof got === "object" ? `${got.of}#${got.rev}` : "no identity";
    throw new Error(`The gateway answered ${named} when asked for ${ref_text(ref)}.`);
  }
  const style = String(answer?.identity?.avatar?.style || "").trim();
  const color = String(answer?.identity?.avatar?.color || "").trim();
  if (!style || !color) throw new Error(`The record ${ref_text(ref)} names no design or no colour.`);
  return { style, color, voice: voice_words(answer.identity.voice) };
}

/** One read per identity ref for the page's life. A failed read is not kept: the next ask reads again. */
export class IdentityLooks {
  private readonly cache = new Map<string, Promise<IdentityLook>>();

  constructor(private readonly read: (name: string, rev: number) => Promise<any>) {}

  look(name: string, ref: IdentityRef): Promise<IdentityLook> {
    const key = ref_text(ref);
    const known = this.cache.get(key);
    if (known) return known;
    const pending = this.read(name, ref.rev).then((answer) => look_of_answer(answer, ref));
    this.cache.set(key, pending);
    pending.catch(() => {
      if (this.cache.get(key) === pending) this.cache.delete(key);
    });
    return pending;
  }
}

/** The look a ref names, or the sentence saying why it cannot be drawn. */
export function use_identity_look(looks: IdentityLooks, name: string, ref: IdentityRef): { look: IdentityLook | null; error: string } {
  const key = ref_text(ref);
  const [state, set_state] = useState<{ key: string; look: IdentityLook | null; error: string }>({ key: "", look: null, error: "" });
  useEffect(() => {
    let alive = true;
    looks.look(name, ref).then(
      (look) => alive && set_state({ key, look, error: "" }),
      (e: unknown) => alive && set_state({ key, look: null, error: String((e as Error)?.message || e) }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looks, name, key]);
  return state.key === key ? { look: state.look, error: state.error } : { look: null, error: "" };
}

let design_names_read: Promise<Map<string, string>> | null = null;

/** The kit's design names (`watch-nebula` → "Watch Nebula"), read once. */
function design_names(): Promise<Map<string, string>> {
  if (!design_names_read) {
    design_names_read = avatarDesigns().then((designs) => new Map(designs.map((d) => [d.id, d.name])));
    design_names_read.catch(() => {
      design_names_read = null;
    });
  }
  return design_names_read;
}

function use_design_name(style: string): string {
  const [names, set_names] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    design_names().then(
      (m) => alive && set_names(m),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return names?.get(style) || style;
}

/** The wrapper style carrying the identity's colour to the avatar's palette. */
export function identity_orb_style(color: string, size: number): React.CSSProperties {
  return { "--warning": color, width: size, height: size } as React.CSSProperties;
}

/** What one tile shows for its identity ref: the orb of the look read, the gateway's sentence when
 * it could not be read or drawn, and an empty reserved circle while it is being read. Never a look
 * the ref did not name. */
export function EntityLookView(props: {
  name: string;
  identity_ref: IdentityRef;
  size: number;
  look: IdentityLook | null;
  error: string;
  design: string;
  on_draw_error(message: string): void;
}): React.ReactElement {
  const { look, error } = props;
  if (error) {
    return (
      <span className="idn_look_error" data-testid="identity-look-error" role="note" title={error}>
        {error}
      </span>
    );
  }
  if (!look) return <span className="idn_orb idn_orb_reading" data-testid="identity-look-reading" style={{ width: props.size, height: props.size }} aria-hidden="true" />;
  const key = ref_text(props.identity_ref);
  const words = `${props.name}: ${props.design}, ${look.color}; voice: ${look.voice}`;
  return (
    <span className="idn_orb" style={identity_orb_style(look.color, props.size)} data-testid="identity-orb" data-ref={key} data-style={look.style} data-color={look.color} title={words}>
      <ActivityAvatar
        key={`${key}|${look.color}`}
        design={look.style}
        pose="ready"
        size={props.size}
        animated={false}
        quality="high"
        label={words}
        onError={(e) => props.on_draw_error(`${props.name}'s ${props.design} design could not be drawn: ${e.message}`)}
      />
    </span>
  );
}

/** An entity's orb drawn from the look its identity ref names (read once per ref by `looks`). */
export function EntityLook(props: { looks: IdentityLooks; name: string; identity_ref: IdentityRef; size: number }): React.ReactElement {
  const { look, error } = use_identity_look(props.looks, props.name, props.identity_ref);
  const key = ref_text(props.identity_ref);
  const [draw_error, set_draw_error] = useState({ key: "", message: "" });
  const design = use_design_name(look?.style || "");
  return (
    <EntityLookView
      name={props.name}
      identity_ref={props.identity_ref}
      size={props.size}
      look={look}
      error={error || (draw_error.key === key ? draw_error.message : "")}
      design={design}
      on_draw_error={(message) => set_draw_error({ key, message })}
    />
  );
}

// --- track record ------------------------------------------------------------------------

/** The track record of a conversation, as the agent page holds it. */
export type RecordRead = { session_id: string; loading: boolean; error: string; record: any | null; reputation: any | null };

const COMPLETION_ONLY = "completion-rate only";

function count_of(body: any, field: string, what: string): number {
  const n = body?.[field];
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error(`The ${what} has no ${field} count.`);
  return n;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The track record in words: counts, trust with its support, and what the numbers are. */
export function track_record_words(record: any, reputation: any): { counts: string; trust: string; gloss: string; basis: string } {
  const runs = count_of(record, "runs", "track record");
  const successes = count_of(record, "successes", "track record");
  const failures = count_of(record, "failures", "track record");
  const overall = reputation?.overall;
  const support = count_of(overall, "support", "trust");
  const finished = count_of(overall, "successes", "trust");
  const trust = overall?.trust;
  if (typeof trust !== "number" || !Number.isFinite(trust)) throw new Error("The trust has no value.");
  const counts = runs ? `${plural(runs, "run", "runs")} · ${successes.toLocaleString("en-US")} succeeded · ${failures.toLocaleString("en-US")} failed` : "";
  if (!support) return { counts, trust: "No experience yet", gloss: "", basis: "" };
  const basis = String(reputation?.basis ?? record?.basis ?? "").trim();
  return {
    counts,
    trust: `trust ${trust.toFixed(2)} over ${plural(support, "outcome", "outcomes")}`,
    // The same words as the Entity app's track record (one wording for both apps).
    gloss: `${finished.toLocaleString("en-US")} of ${support.toLocaleString("en-US")} finished; trust starts in the middle and moves with each outcome`,
    basis: basis === COMPLETION_ONLY ? "A success here only means the task finished: nobody has judged the quality of the work yet." : basis,
  };
}

function record_body(r: RecordRead): React.ReactNode {
  if (!r.session_id) return <span className="ap_record_note">none: this run belongs to no conversation</span>;
  if (r.error) return <span className="ap_record_error" role="alert">{r.error}</span>;
  if (r.loading || !r.record || !r.reputation) return <span className="ap_record_note">reading…</span>;
  let words: ReturnType<typeof track_record_words>;
  try {
    words = track_record_words(r.record, r.reputation);
  } catch (e) {
    return <span className="ap_record_error" role="alert">{String((e as Error)?.message || e)}</span>;
  }
  return (
    <>
      {words.counts ? <span className="ap_record_counts">{words.counts} · </span> : null}
      <span className="ap_record_trust">{words.counts ? words.trust.charAt(0).toLowerCase() + words.trust.slice(1) : words.trust}</span>
      {words.gloss ? <span className="ap_record_gloss"> ({words.gloss})</span> : null}
      {words.basis ? <span className="ap_record_basis">{words.basis}</span> : null}
    </>
  );
}

/** The agent page's one track-record line (the conversation's, read when the page opens). */
export function TrackRecordLine(props: { read: RecordRead }): React.ReactElement {
  return (
    <p className="ap_record" data-testid="track-record">
      <span className="ap_record_label">Track record: </span>
      {record_body(props.read)}
    </p>
  );
}
