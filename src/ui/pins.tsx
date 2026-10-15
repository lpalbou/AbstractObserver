/**
 * READ-ONLY PINS + THE ONE VALUE COMPONENT — a flow's start/end pins drawn
 * the way the AbstractFlow editor draws them (shapes mirrored from
 * abstractflow src/components/pins/PinShape.tsx, colours from ./pin_palette,
 * a verbatim mirror of flow.ts), each with its name, its type and the value
 * this run carries (backlog 0003 §Agent page). Candidate for the ui-kit
 * `AfPinList`.
 *
 * Observability rule (operator 2026-10-14 11:11): NO character is ever
 * dropped without a control that reveals it. Every value cell on the Agent
 * page (pins, flow defaults, outputs, "also sent"/"also returned", profile
 * facts) renders through `Value`:
 * - short scalars inline; null as `null`; absent as a muted "—";
 * - long strings collapsed by SIZE (280 chars / 6 lines) with
 *   "show all (N chars)" / "show less";
 * - arrays and objects as a summary whose key/item list is COMPLETE (it
 *   wraps; when longer than ~6 lines the LIST collapses with "show all N
 *   keys") plus a `<details>` with the full pretty JSON (rendered only when
 *   opened: a `context` pin can be ~100 KB).
 * Every field row carries a `CopyButton` (hover / focus-within) that copies
 * the FULL raw value — strings raw, JSON pretty-printed — never placed
 * inside a `<summary>` toggle.
 *
 * Pin rules:
 * - an input the flow declares that the run was not sent: "not provided",
 *   plus the flow's own default when the start node declares one (the
 *   runtime applied it, abstractruntime visual/executor.py:2163-2177).
 * - glyphs are FILLED when the pin carries a value and hollow otherwise
 *   (the editor fills a connected pin; here "connected" = "has a value").
 * - values the wire carries that are not declared pins are listed under
 *   the caller's `also_label` ("also sent" / "also returned"): nothing hidden.
 */
import React, { useEffect, useState } from "react";

import { clipboardWrite } from "../lib/secure-context";
import type { PinWithValue } from "./agent_facts";
import { pin_color, pin_shape_kind } from "./pin_palette";

export const STRING_CLAMP_CHARS = 280;
export const STRING_CLAMP_LINES = 6;
/** A key/item list longer than this many characters (~6 lines of a value column) collapses. */
export const LIST_COLLAPSE_CHARS = 360;
/** How long a copy button says "copied" / "copy failed" (the board's value). */
export const COPY_FEEDBACK_MS = 1500;

/** The clamped view of a long string: first N chars or M lines, whichever is shorter. */
export function clamp_string(text: string, max_chars = STRING_CLAMP_CHARS, max_lines = STRING_CLAMP_LINES): { shown: string; clamped: boolean } {
  const s = String(text ?? "");
  let cut = s.length;
  let nl = -1;
  for (let i = 0; i < max_lines; i += 1) {
    nl = s.indexOf("\n", nl + 1);
    if (nl === -1) break;
    if (i === max_lines - 1) cut = Math.min(cut, nl);
  }
  cut = Math.min(cut, max_chars);
  if (cut >= s.length) return { shown: s, clamped: false };
  return { shown: `${s.slice(0, cut).trimEnd()}…`, clamped: true };
}

/** What a copy button puts on the clipboard: strings raw, JSON pretty-printed, scalars as text. */
export function copy_text_of(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

function is_scalar(x: unknown): boolean {
  return x === null || ["string", "number", "boolean"].includes(typeof x);
}

function kind_word(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  return typeof x;
}

export type JsonShape = {
  /** "array · 4 items" / "object · 2 keys" / "artifact <id>" — from the value's shape only. */
  head: string;
  /** The COMPLETE key list (objects) or item list (arrays of scalars); [] otherwise. */
  items: string[];
  /** "keys" / "items" — the word of the list's "show all N …" control. */
  item_word: string;
};

/** The shape of a JSON value, mechanically: nothing clipped, nothing guessed. */
export function json_shape(v: unknown): JsonShape {
  if (Array.isArray(v)) {
    const n = v.length;
    const head = `array · ${n} item${n === 1 ? "" : "s"}`;
    if (!n) return { head, items: [], item_word: "items" };
    if (v.every(is_scalar)) return { head, items: v.map((x) => String(x)), item_word: "items" };
    const kinds = new Map<string, number>();
    for (const x of v) kinds.set(kind_word(x), (kinds.get(kind_word(x)) || 0) + 1);
    const parts = [...kinds.entries()].map(([k, c]) => `${c} ${k}${c === 1 ? "" : k === "null" ? "" : "s"}`);
    return { head: `${head} (${parts.join(", ")})`, items: [], item_word: "items" };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && typeof o.$artifact === "string") return { head: `artifact ${String(o.$artifact)}`, items: [], item_word: "keys" };
    return { head: `object · ${keys.length} key${keys.length === 1 ? "" : "s"}`, items: keys, item_word: "keys" };
  }
  return { head: copy_text_of(v), items: [], item_word: "items" };
}

/** The one-line summary of a JSON value — COMPLETE (never clipped): head plus every key/item. */
export function json_summary(v: unknown): string {
  const s = json_shape(v);
  return s.items.length ? `${s.head}: ${s.items.join(", ")}` : s.head;
}

/** How many items of a list fit the collapsed view (whole items only); = items.length when all fit. */
export function list_fit(items: string[], budget = LIST_COLLAPSE_CHARS): number {
  let used = 0;
  for (let i = 0; i < items.length; i += 1) {
    used += items[i].length + (i ? 2 : 0);
    if (used > budget) return i;
  }
  return items.length;
}

// --- the copy affordance ---------------------------------------------------------------

export type CopyState = "" | "copied" | "failed";

/**
 * ⧉ copies the FULL raw value of a field. Same affordance as the board's
 * `mc_copy` (mission_control.tsx): "copied" / "copy failed" for 1.5 s.
 * Visible on the row's hover and keyboard focus (`.ap_copyable`), always on
 * touch screens. `on_copy` (the host's copy) replaces the clipboard helper.
 */
export function CopyButton(props: { text: string; label: string; on_copy?: (text: string) => void; className?: string }): React.ReactElement {
  const [state, set_state] = useState<CopyState>("");
  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => set_state(""), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(t);
  }, [state]);
  const label = `Copy ${props.label}`;
  return (
    <button
      type="button"
      className={`ap_copy_btn${state ? ` is_${state}` : ""}${props.className ? ` ${props.className}` : ""}`}
      title={label}
      aria-label={label}
      onClick={async (e) => {
        e.stopPropagation();
        if (props.on_copy) {
          props.on_copy(props.text);
          set_state("copied");
          return;
        }
        set_state((await clipboardWrite(props.text)) ? "copied" : "failed");
      }}
    >
      {state === "copied" ? "copied" : state === "failed" ? "copy failed" : "⧉"}
    </button>
  );
}

// --- the one value component -------------------------------------------------------------

/** The editor's pin glyph (PinShape.tsx geometry), coloured by type. */
export function PinGlyph(props: { type: string; filled?: boolean; size?: number }): React.ReactElement {
  const size = props.size ?? 12;
  const half = size / 2;
  const fill = props.filled ? "currentColor" : "none";
  const kind = pin_shape_kind(props.type);
  let shape: React.ReactElement;
  if (kind === "triangle") shape = <polygon points={`0,0 ${size},${half} 0,${size}`} fill={fill} stroke="currentColor" strokeWidth="1.5" />;
  else if (kind === "diamond") shape = <polygon points={`${half},0 ${size},${half} ${half},${size} 0,${half}`} fill={fill} stroke="currentColor" strokeWidth="1.5" />;
  else if (kind === "square") shape = <rect x="1" y="1" width={size - 2} height={size - 2} fill={fill} stroke="currentColor" strokeWidth="1.5" />;
  else if (kind === "hexagon") {
    const pts = [
      [half, 0],
      [size, size * 0.25],
      [size, size * 0.75],
      [half, size],
      [0, size * 0.75],
      [0, size * 0.25],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(" ");
    shape = <polygon points={pts} fill={fill} stroke="currentColor" strokeWidth="1.5" />;
  } else shape = <circle cx={half} cy={half} r={half - 1} fill={fill} stroke="currentColor" strokeWidth="1.5" />;
  return (
    <svg
      className="ap_pin_glyph"
      data-pin-shape={kind}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ color: pin_color(props.type) }}
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

function StringValue(props: { text: string }): React.ReactElement {
  const [all, set_all] = useState(false);
  const { shown, clamped } = clamp_string(props.text);
  if (!props.text) return <span className="ap_pin_muted">empty text</span>;
  return (
    <span className="ap_pin_string">
      <span className="ap_pin_text">{all || !clamped ? props.text : shown}</span>
      {clamped ? (
        <button type="button" className="ap_link_btn" aria-expanded={all} onClick={() => set_all((v) => !v)}>
          {all ? "show less" : `show all (${props.text.length.toLocaleString("en-US")} chars)`}
        </button>
      ) : null}
    </span>
  );
}

/** A COMPLETE key/item list: it wraps; past ~6 lines the list itself collapses behind "show all N keys". */
function ItemList(props: { items: string[]; word: string }): React.ReactElement {
  const [all, set_all] = useState(false);
  const fit = list_fit(props.items);
  const collapsed = fit < props.items.length && !all;
  const shown = collapsed ? props.items.slice(0, fit) : props.items;
  return (
    <span className="ap_json_items">
      <span className="ap_json_list">{shown.join(", ")}</span>
      {fit < props.items.length ? (
        <button type="button" className="ap_link_btn" aria-expanded={all} onClick={() => set_all((v) => !v)}>
          {all ? "show less" : `show all ${props.items.length.toLocaleString("en-US")} ${props.word}`}
        </button>
      ) : null}
    </span>
  );
}

function JsonValue(props: { value: unknown }): React.ReactElement {
  const [open, set_open] = useState(false);
  const shape = json_shape(props.value);
  return (
    <div className="ap_json">
      <div className="ap_json_head">
        <span className="ap_json_shape mono">
          {shape.head}
          {shape.items.length ? ":" : ""}
        </span>
        {shape.items.length ? <ItemList items={shape.items} word={shape.item_word} /> : null}
      </div>
      <details className="ap_json_details" open={open} onToggle={(e) => set_open((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="mono">full JSON</summary>
        {open ? <pre className="ap_json_body mono">{copy_text_of(props.value)}</pre> : null}
      </details>
    </div>
  );
}

/** THE value component: any wire value, nothing dropped without a control that reveals it. */
export function Value(props: { value: unknown }): React.ReactElement {
  const v = props.value;
  if (v === undefined) return <span className="ap_pin_muted">—</span>;
  if (v === null) return <code className="ap_pin_scalar ap_pin_muted">null</code>;
  if (typeof v === "string") return <StringValue text={v} />;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return <code className="ap_pin_scalar">{String(v)}</code>;
  if (typeof v === "object") return <JsonValue value={v} />;
  return <code className="ap_pin_scalar">{String(v)}</code>;
}

/** Kept name (lane B): the same component. */
export const ValueCell = Value;

// --- pins ---------------------------------------------------------------------------------

/** What a pin row's copy button copies: the value, else the flow default the runtime applied; null = nothing to copy. */
export function pin_copy_text(pin: PinWithValue): string | null {
  if (pin.state === "value") return copy_text_of(pin.value);
  if (pin.state === "not_provided" && pin.flow_default) return copy_text_of(pin.flow_default.value);
  return null;
}

function PinValueCell(props: { pin: PinWithValue; side: "in" | "out"; outputs_final: boolean }): React.ReactElement {
  const { pin } = props;
  if (pin.state === "value") return <Value value={pin.value} />;
  if (pin.state === "not_provided") {
    return (
      <div className="ap_pin_muted ap_pin_unsent">
        <span>not provided</span>
        {pin.flow_default ? (
          <div className="ap_pin_default">
            <span className="ap_pin_default_label">flow default</span> <Value value={pin.flow_default.value} />
          </div>
        ) : null}
        {pin.required && !pin.flow_default ? <span className="ap_pin_required"> · required</span> : null}
      </div>
    );
  }
  const why = pin.state === "unknown" ? "not loaded" : props.side === "out" ? (props.outputs_final ? "not in the run's output" : "no output until the run ends") : "no value";
  return (
    <span className="ap_pin_muted" title={why}>
      —
    </span>
  );
}

function PinRow(props: { pin: PinWithValue; side: "in" | "out"; outputs_final: boolean; on_copy?: (text: string) => void }): React.ReactElement {
  const { pin } = props;
  const type_text = pin.typed ? pin.type : "untyped";
  const copy = pin_copy_text(pin);
  return (
    <li className={`ap_pin ap_pin_${pin.state} ap_copyable`} data-pin-id={pin.id} data-pin-state={pin.state}>
      <span className="ap_pin_head" title={pin.description || undefined}>
        <PinGlyph type={pin.type} filled={pin.state === "value"} />
        <span className="ap_pin_name">{pin.label}</span>
        <span className="ap_pin_type mono">{type_text}</span>
        {copy !== null ? <CopyButton text={copy} label={pin.state === "value" ? pin.label : `${pin.label} flow default`} on_copy={props.on_copy} /> : null}
      </span>
      <div className="ap_pin_value">
        <PinValueCell pin={pin} side={props.side} outputs_final={props.outputs_final} />
      </div>
    </li>
  );
}

export type PinListProps = {
  pins: PinWithValue[];
  side: "in" | "out";
  /** Values on the wire that are not declared pins. */
  also?: [string, unknown][];
  /** Heading of the `also` block ("also sent" / "also returned"). */
  also_label?: string;
  outputs_final?: boolean;
  /** Shown when there are no pins at all. */
  empty_text?: string;
  label?: string;
  /** Replaces the clipboard helper on every row's copy button. */
  on_copy?: (text: string) => void;
};

export function PinList(props: PinListProps): React.ReactElement {
  const also = props.also || [];
  const final = props.outputs_final === true;
  return (
    <div className="ap_pins" aria-label={props.label}>
      {props.pins.length ? (
        <ul className="ap_pin_list">
          {props.pins.map((p) => (
            <PinRow key={p.id} pin={p} side={props.side} outputs_final={final} on_copy={props.on_copy} />
          ))}
        </ul>
      ) : (
        <p className="ap_pin_muted ap_pins_empty">{props.empty_text || "no pins"}</p>
      )}
      {also.length ? (
        <div className="ap_pins_also">
          <div className="ap_pins_also_label">{props.also_label || "also on the wire"}</div>
          <ul className="ap_pin_list">
            {also.map(([name, value]) => (
              <li key={name} className="ap_pin ap_pin_also ap_copyable" data-pin-id={name} data-pin-state="also">
                <span className="ap_pin_head">
                  <PinGlyph type="any" filled />
                  <span className="ap_pin_name">{name}</span>
                  <span className="ap_pin_type mono">not a pin</span>
                  {value !== undefined ? <CopyButton text={copy_text_of(value)} label={name} on_copy={props.on_copy} /> : null}
                </span>
                <div className="ap_pin_value">
                  <Value value={value} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
