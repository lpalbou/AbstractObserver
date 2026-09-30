/**
 * Collapsible list panels (DESIGN §12, "Space on phones and tablets").
 *
 * Every list that sits next to a detail (Automations, Observe's run list,
 * System → Activity's queues and runs, the Board columns) has a disclosure
 * header: a real `<button type="button">` (Enter and Space toggle it, like any
 * button) with a chevron, `aria-expanded` and `aria-controls`. The list is
 * open by default; the choice is remembered per viewer in localStorage (every
 * access inside try/catch: a private window or blocked storage keeps the
 * default and never throws). Collapsing the list gives the detail the whole
 * viewport; the header stays visible so the list can be reopened.
 */
import React, { useCallback, useState } from "react";

import { Icon } from "@abstractframework/ui-kit";

/** localStorage key of one list panel's open/closed state. */
export function list_open_key(id: string): string {
  return `abstractobserver_list_open_${id}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function default_storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The remembered state of list `id`: open unless the viewer closed it. */
export function read_list_open(id: string, storage: StorageLike | null = default_storage()): boolean {
  try {
    return storage?.getItem(list_open_key(id)) !== "0";
  } catch {
    return true;
  }
}

/** Remembers the state of list `id`; storage failures are ignored (in-memory only). */
export function write_list_open(id: string, open: boolean, storage: StorageLike | null = default_storage()): void {
  try {
    storage?.setItem(list_open_key(id), open ? "1" : "0");
  } catch {
    // blocked or full storage: the state lives for this page view only
  }
}

/** One list panel's open state, remembered per viewer. */
export function useListOpen(id: string): [boolean, () => void] {
  const [open, set_open] = useState(() => read_list_open(id));
  const toggle = useCallback(() => {
    set_open((cur) => {
      const next = !cur;
      write_list_open(id, next);
      return next;
    });
  }, [id]);
  return [open, toggle];
}

/** The disclosure header button: chevron + the panel title (+ an optional count). */
export function ListDisclosure(props: {
  open: boolean;
  on_toggle: () => void;
  /** id of the element the button shows and hides. */
  controls: string;
  title: string;
  count?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`list_disclosure${props.className ? ` ${props.className}` : ""}`}
      aria-expanded={props.open}
      aria-controls={props.controls}
      onClick={props.on_toggle}
      title={props.open ? `Hide ${props.title.toLowerCase()}` : `Show ${props.title.toLowerCase()}`}
    >
      <Icon name={props.open ? "chevronDown" : "chevronRight"} size={14} />
      <span className="pane_title">{props.title}</span>
      {props.count !== undefined ? <span className="pane_count">{props.count}</span> : null}
    </button>
  );
}
