/**
 * The vertical tab rail (maintainer's reference: blackpixel's right
 * sidebar — a narrow rail of vertical-text tabs on the panel's edge, ONE
 * panel shown at a time, clicking the active tab collapses to the rail).
 *
 * Not stacked accordions: tabs. The rail faces the canvas; the active tab
 * protrudes and carries the accent.
 */

import React, { useEffect, useState } from "react";

import { ErrorBoundary } from "./error_boundary";

const STORAGE_KEY = "abstractobserver_entity_side_tab_v1";

export interface SideTab {
  id: string;
  icon: string;
  title: string;
  /** Small live hint rendered as a dot on the tab (e.g. visiting). */
  hint?: boolean;
  content: React.ReactNode;
}

const WIDTH_KEY = "abstractobserver_entity_side_width_v1";
const MIN_WIDTH = 300;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 380;

export interface SideTabsProps {
  tabs: SideTab[];
  defaultTab?: string;
  /** Controlled active tab (roster-open lands on chat: "join its room"). */
  activeTab?: string | null;
}

export function SideTabs({ tabs, defaultTab, activeTab: controlledTab }: SideTabsProps): React.ReactElement {
  const [active, setActive] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "") return null; // collapsed by choice
      if (stored && tabs.some((t) => t.id === stored)) return stored;
    } catch {
      // presentation state only
    }
    return defaultTab ?? tabs[0]?.id ?? null;
  });

  // A parent may request a tab (e.g. "chat" when entering a room), carried
  // as "<tab>#<nonce>" so re-entering the same entity re-applies it. The
  // request only steers when it CHANGES; the user switches freely after.
  const lastRequestRef = React.useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (controlledTab !== undefined && controlledTab !== lastRequestRef.current) {
      lastRequestRef.current = controlledTab;
      const tabId = controlledTab ? controlledTab.split("#", 1)[0] : null;
      if (tabId && tabs.some((t) => t.id === tabId)) setActive(tabId);
    }
  }, [controlledTab, tabs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, active ?? "");
    } catch {
      // best-effort
    }
  }, [active]);

  // Resizable width (maintainer ask, 2026-07-09: "more room for the right
  // panel, including for better conversations"). Persisted; drag the border.
  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
      if (!Number.isNaN(raw)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
    } catch {
      // presentation only
    }
    return DEFAULT_WIDTH;
  });
  const dragRef = React.useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // The panel is on the RIGHT: dragging left (negative dx) widens it.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, d.startW + (d.startX - e.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
      } catch {
        // best-effort
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const activeTab = tabs.find((t) => t.id === active) ?? null;

  return (
    <div className={`side_tabs ${activeTab ? "" : "side_tabs_collapsed"}`} style={activeTab ? { width } : undefined}>
      {activeTab ? (
        <div
          className="st_resize"
          title="Drag to resize — more room for the conversation"
          onMouseDown={(e) => {
            dragRef.current = { startX: e.clientX, startW: width };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
          }}
        />
      ) : null}
      <div className="st_rail">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`st_tab ${tab.id === active ? "st_tab_active" : ""}`}
            title={tab.id === active ? `Collapse ${tab.title}` : tab.title}
            onClick={() => setActive((cur) => (cur === tab.id ? null : tab.id))}
          >
            <span className="st_tab_label">{tab.title}</span>
            {tab.hint ? <span className="st_tab_hint" /> : null}
          </button>
        ))}
      </div>
      {/* Every panel stays MOUNTED; inactive ones hide via CSS. Unmounting
        * killed live component state — the chat drawer forgot its own open
        * session on tab switch and greeted it as a foreign visit (the
        * maintainer's live P0, and the same bug class as the AbstractFlow
        * assistant drawer keep-alive). Each panel is error-bounded: one
        * panel's render error may never take the app down (the 23:49
        * critical — a chat 409 followed by React #31 killed the whole
        * window). */}
      {tabs.map((tab) => (
        <div key={tab.id} className="st_panel" style={tab.id === active ? undefined : { display: "none" }}>
          <ErrorBoundary label={`the ${tab.title.toLowerCase()} panel`}>{tab.content}</ErrorBoundary>
        </div>
      ))}
    </div>
  );
}
