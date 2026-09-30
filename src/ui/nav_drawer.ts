// Navigation drawer (< 1024 px, DESIGN.md §5.2) — the state rules, the DOM
// attributes and the focus trap as plain functions so they are unit-tested,
// plus the hook app.tsx uses.
//
// Contract: below 1024 px the sidebar is a MODAL left drawer. Closed, it is
// `inert` + `aria-hidden` (never reachable by Tab or assistive tech). Open, it
// is role="dialog" aria-modal="true", the rest of the shell is `inert`, Tab and
// Shift+Tab cycle inside it, Escape closes it (unless another handler already
// took the key or another modal dialog is open on top), and focus returns to the
// header toggle. It closes on page change and whenever the layout crosses 1024 px.
import { useEffect, useReducer, useRef } from "react";

export type NavDrawerAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "escape"; default_prevented: boolean; other_modal_open: boolean }
  | { type: "page_change" }
  | { type: "layout_change" };

/** Next open state. */
export function nav_drawer_reducer(open: boolean, action: NavDrawerAction): boolean {
  switch (action.type) {
    case "open":
      return true;
    case "close":
    case "page_change":
    case "layout_change":
      return false;
    case "escape":
      // Escape belongs to whoever handled it first (a dialog above, a select).
      if (action.default_prevented || action.other_modal_open) return open;
      return false;
  }
}

export type NavDrawerAttrs = {
  aside: Record<string, string | boolean | undefined>;
  main: Record<string, string | boolean | undefined>;
};

/** DOM attributes for the sidebar (`aside`) and the rest of the shell (`main`). */
export function nav_drawer_attrs(is_drawer: boolean, open: boolean): NavDrawerAttrs {
  if (!is_drawer) return { aside: { "aria-label": "Navigation" }, main: {} };
  if (!open) return { aside: { "aria-label": "Navigation", inert: "", "aria-hidden": "true" }, main: {} };
  return {
    aside: { "aria-label": "Navigation", role: "dialog", "aria-modal": "true" },
    main: { inert: "", "aria-hidden": "true" },
  };
}

/**
 * Focus trap step: index of the element to focus instead of the browser's
 * default Tab move (-1 only when the drawer has nothing focusable).
 * `active` is the index of the focused element among `count` focusables, or -1
 * when focus is outside the drawer.
 */
export function nav_trap_target(count: number, active: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (active < 0) return shift ? count - 1 : 0;
  // Always move focus ourselves: WebKit's default Tab skips buttons and links
  // (the drawer has only those), which would leave the drawer.
  return (active + (shift ? count - 1 : 1)) % count;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Whether a modal dialog other than the drawer itself is open. */
function other_modal_open(drawer: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((el) => el !== drawer);
}

export function use_nav_drawer(opts: { is_drawer: boolean; page: string }) {
  const [open, dispatch] = useReducer(nav_drawer_reducer, false);
  const toggle_ref = useRef<HTMLButtonElement | null>(null);
  const sidebar_ref = useRef<HTMLElement | null>(null);
  const was_open = useRef(false);

  useEffect(() => {
    dispatch({ type: "page_change" });
  }, [opts.page]);

  useEffect(() => {
    dispatch({ type: "layout_change" });
  }, [opts.is_drawer]);

  useEffect(() => {
    if (open) {
      was_open.current = true;
      const root = sidebar_ref.current;
      const first = root?.querySelector<HTMLElement>(".shell_nav_item.active") || root?.querySelector<HTMLElement>(".shell_nav_item");
      first?.focus();
      const on_key = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          dispatch({ type: "escape", default_prevented: e.defaultPrevented, other_modal_open: other_modal_open(sidebar_ref.current) });
          return;
        }
        if (e.key !== "Tab" || !sidebar_ref.current) return;
        const items = Array.from(sidebar_ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
        const target = nav_trap_target(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (target >= 0) {
          e.preventDefault();
          items[target].focus();
        }
      };
      window.addEventListener("keydown", on_key);
      return () => window.removeEventListener("keydown", on_key);
    }
    if (was_open.current) {
      was_open.current = false;
      toggle_ref.current?.focus();
    }
    return undefined;
  }, [open]);

  return {
    open,
    set_open: (next: boolean) => dispatch({ type: next ? "open" : "close" }),
    toggle_ref,
    sidebar_ref,
    attrs: nav_drawer_attrs(opts.is_drawer, open),
  };
}
