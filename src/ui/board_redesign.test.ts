// The Board redesign (2026-11-07, untracked/observer-board/DESIGN.md): identical Done runs as one
// row, empty lanes as headers, whole titles behind an explicit "…", one primary action per card and
// the rest behind one ⋯ menu, a remembered density, a compact Entities row.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BoardCardView,
  DENSITY_STORAGE_KEY,
  GLIMPSE_LINES,
  MissionControlPage,
  TITLE_LINES,
  build_board,
  chain_is_path,
  done_group_key,
  done_sentence_echoes,
  entity_chip_words,
  group_done_cards,
  group_span_words,
  lane_collapses,
  pill_echoes_lane,
  read_density,
  type BoardCard,
  type CardHandlers,
} from "./mission_control";
import type { RunSummary } from "./run_status";
import { gateway_tile } from "./__fixtures__/entity_tile";

const NOW = Date.parse("2026-11-07T22:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const row = (p: Partial<RunSummary> & { run_id: string }): RunSummary =>
  ({ workflow_id: "basic-agent@0.0.5:81795ea9", status: "running", created_at: ago(30), updated_at: ago(10), ledger_len: 4, ...p }) as RunSummary;
const noop = () => {};
const H: CardHandlers = { now_ms: NOW, stall_after_ms: 5 * 60_000, busy: false, on_open_run: noop, on_act: noop };
const html_of = (card: BoardCard, h?: Partial<CardHandlers>) => renderToStaticMarkup(React.createElement(BoardCardView, { card, ...H, ...(h || {}) }));
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const failed = (id: string, min: number, p: Partial<RunSummary> = {}) =>
  row({ run_id: id, status: "failed", error: "provider refused the request", created_at: ago(min + 1), updated_at: ago(min), brief: { title: "Thank you." }, ...p } as any);

const page = (p: Partial<React.ComponentProps<typeof MissionControlPage>> = {}) =>
  renderToStaticMarkup(
    React.createElement(MissionControlPage, {
      gateway_connected: true,
      runs: [],
      all_runs: [],
      runs_refreshed_at: NOW,
      entities: [],
      entities_total: 0,
      entities_error: "",
      on_open_run: noop,
      on_resume_wait: async () => {},
      on_open_automation: noop,
      entity_app_href: "http://entity.test/",
      done_loaded: true,
      ...p,
    }),
  );

describe("Done: identical consecutive runs are one row with a count", () => {
  it("three identical failures fold into one group; a different one starts a new group; order is kept", () => {
    const lanes = build_board({ active: [], done: [failed("f1", 10), failed("f2", 11), failed("f3", 12), failed("x1", 13, { error: "another reason" } as any)], now_ms: NOW });
    const groups = group_done_cards(lanes.done);
    expect(groups.map((g) => g.cards.map((c) => c.run_id))).toEqual([["f1", "f2", "f3"], ["x1"]]);
    expect(done_group_key(lanes.done[0])).toBe(done_group_key(lanes.done[2]));
    expect(done_group_key(lanes.done[0])).not.toBe(done_group_key(lanes.done[3]));
  });

  it("an automation's runs differ by their number only: one group, its span in words", () => {
    const occ = (id: string, n: number) => row({ run_id: id, status: "completed", role: "occurrence", automation_id: "a1", session_kind: "automation", occurrence_index: n, created_at: ago(40 - n), updated_at: ago(40 - n) });
    const lanes = build_board({ active: [], done: [occ("o3", 3), occ("o2", 2), occ("o1", 1)], now_ms: NOW });
    const groups = group_done_cards(lanes.done);
    expect(groups.length).toBe(1);
    expect(groups[0].cards.length).toBe(3);
    expect(group_span_words(groups[0].cards)).toBe("#1 to #3");
  });

  it("the lane shows ONE card for the group with ×3, and the count names what it opens; deleting the grouping would show three", () => {
    const done = [failed("f1", 10), failed("f2", 11), failed("f3", 12)];
    const html = page({ runs: done, all_runs: done });
    const lane = html.slice(html.indexOf('class="mc_column mc_column_done'));
    expect((lane.match(/data-lane="done"/g) || []).length).toBe(1);
    expect(lane).toContain("×3");
    expect(lane).toMatch(/aria-label="3 identical runs: show each"/);
    expect(lane).toContain('aria-expanded="false"');
  });
});

describe("an empty lane is a header, not a column", () => {
  it("collapses only once known empty, never while loading, and Done stays open while runs hide outside its window", () => {
    expect(lane_collapses({ count: 0, loading: false })).toBe(true);
    expect(lane_collapses({ count: 0, loading: true })).toBe(false);
    expect(lane_collapses({ count: 2, loading: false })).toBe(false);
    expect(lane_collapses({ count: 0, loading: false, hidden_outside_window: 4 })).toBe(false);
  });

  it("the page renders empty lanes as collapsed headers with their meaning, and the lane with a card open", () => {
    const html = page({ all_runs: [row({ run_id: "w1", updated_at: ago(1) })] });
    expect(html).toMatch(/class="mc_column mc_column_waiting_on is_collapsed"[^>]*title="Waiting on…: nothing is blocked"/);
    expect(html).toContain('<span class="mc_column_empty_words">nothing is blocked</span>');
    expect(html).toMatch(/class="mc_column mc_column_working"/);
    expect(html).not.toMatch(/mc_column_working is_collapsed/);
    // Five headers whatever their state: the lanes are still five.
    expect((html.match(/<header class="mc_column_head">/g) || []).length).toBe(5);
    // A collapsed lane has no card list and no empty sentence box.
    const waiting = html.slice(html.indexOf("mc_column_waiting_on"), html.indexOf("mc_column_scheduled"));
    expect(waiting).not.toContain("mc_column_cards");
  });

  it("before the first poll no lane collapses (skeletons, a '…' count)", () => {
    const html = page({ runs_refreshed_at: null });
    expect(html).not.toContain("is_collapsed");
    expect((html.match(/mc_card_skeleton/g) || []).length).toBeGreaterThan(5);
  });
});

describe("nothing is cut: the whole title, clamped by lines with an explicit '…'", () => {
  it("an excerpt title renders WHOLE (no 80-character cut) inside the clamp; lines follow the density", () => {
    const long = "What are today's news in the US related to the pharma industry. You write in a style suitable for voice over, with sources, and you keep it under two minutes.";
    const card = build_board({ active: [row({ run_id: "t1", status: "running", brief: { task_excerpt: long } } as any)], now_ms: NOW }).working[0];
    expect(card.title.text.length).toBeLessThan(long.length); // the wire title is cut…
    const html = html_of(card);
    expect(plain(html)).toContain(long); // …the card shows it whole
    expect(html).toMatch(/class="mc_clamp mc_card_title"[\s\S]*?data-lines="2" style="-webkit-line-clamp:2"/);
    expect(html_of(card, { density: "compact" })).toMatch(/data-lines="1" style="-webkit-line-clamp:1"/);
    expect(TITLE_LINES).toEqual({ comfortable: 2, compact: 1 });
    expect(GLIMPSE_LINES).toEqual({ comfortable: 3, compact: 2 });
  });

  it("a failed Done card says why, whole (the sentence cut the error at 120 characters)", () => {
    const reason = "The provider refused the request because the context window was exceeded by the replayed history; reduce the budget or start fresh each run, then retry the automation.";
    const card = build_board({ active: [], done: [failed("f1", 10, { error: reason } as any)], now_ms: NOW }).done[0];
    expect(card.line.text).toContain("…");
    expect(plain(html_of(card))).toContain(reason);
  });

  it("a Done sentence that only repeats the pill and the meta is said once", () => {
    const ok = build_board({ active: [], done: [row({ run_id: "c1", status: "completed", created_at: ago(3), updated_at: ago(2) })], now_ms: NOW }).done[0];
    expect(ok.line.text).toMatch(/^completed in /);
    expect(done_sentence_echoes(ok)).toBe(true);
    const t = plain(html_of(ok));
    expect(t).not.toMatch(/completed in /);
    expect(t).toContain("took 1 minute");
  });
});

describe("one primary action per card; the rest behind one ⋯ menu", () => {
  const approval = () => {
    const r = row({ run_id: "a1", status: "waiting", waiting: { reason: "user" }, session_id: "acode-1", updated_at: ago(9) });
    const calls = [{ name: "web_search", arguments: { query: "pharma news" } }];
    const details = new Map([["a1", { waiting: { reason: "user", wait_key: "wk_a1", details: { tool_calls: calls } } }]]);
    return { card: build_board({ active: [r], done: [], details, now_ms: NOW }).needs_you[0], detail: details.get("a1") };
  };

  it("an approval's decision sits in the foot, after the meta, next to the ⋯ menu; no icon row, no ⧉, no (i)", () => {
    const { card, detail } = approval();
    const html = html_of(card, { detail, on_cancel_run: async () => null });
    const foot = html.slice(html.indexOf('class="mc_card_foot"'));
    expect(foot.indexOf("mc_card_meta")).toBeLessThan(foot.indexOf(">Approve<"));
    expect(foot.indexOf(">Reject<")).toBeLessThan(foot.indexOf("af-menu__button"));
    expect(html).not.toContain("mc_copy");
    expect(html).not.toContain("mc_info_btn");
    expect(html).toContain('aria-label="More actions for');
    // The menu lists what applies: open, cancel, copy, about.
    for (const item of ["Open the run", "Cancel…", "Copy run id", "About this run"]) expect(html).toContain(`>${item}</button>`);
  });

  it("Approve and Reject still post the same payloads through on_act", () => {
    const { card, detail } = approval();
    const sent: any[] = [];
    // The decision component is the card's; call the handler the buttons call.
    const html = html_of(card, { detail, on_act: (c, payload) => sent.push([c.run_id, c.wait_key, payload]) });
    expect(html).toMatch(/class="btn success mc_btn_sm"[^>]*>Approve</);
    expect(html).toMatch(/class="btn danger mc_btn_sm"[^>]*>Reject</);
    H.on_act(card, { approved: true });
    expect(card.wait_key).toBe("wk_a1");
  });

  it("a Working run offers Pause in its menu only when the host wires it", () => {
    const card = build_board({ active: [row({ run_id: "w1", updated_at: ago(1) })], now_ms: NOW }).working[0];
    expect(html_of(card)).not.toContain(">Pause</button>");
    expect(html_of(card, { on_pause_run: async () => null })).toContain(">Pause</button>");
  });

  it("the pill never repeats the lane; other words keep it", () => {
    expect(pill_echoes_lane("working", "running")).toBe(true);
    expect(pill_echoes_lane("needs_you", "waiting")).toBe(true);
    expect(pill_echoes_lane("needs_you", "paused")).toBe(false);
    expect(pill_echoes_lane("done", "completed")).toBe(false);
    const card = build_board({ active: [row({ run_id: "w1", updated_at: ago(1) })], now_ms: NOW }).working[0];
    expect(html_of(card)).not.toContain('class="mc_status');
  });

  it("a straight chain reads as one path; a branching one keeps the tree", () => {
    const path = [
      { run_id: "r", depth: 0, name: "basic-agent", title: "", words: "", stuck: false, asks: false, running: false },
      { run_id: "c", depth: 1, name: "node-2", title: "", words: "", stuck: false, asks: true, running: false },
    ];
    expect(chain_is_path(path)).toBe(true);
    expect(chain_is_path([...path, { ...path[1], run_id: "d", depth: 1 }])).toBe(false);
    expect(chain_is_path([path[0]])).toBe(false);
  });
});

describe("density and the Entities row", () => {
  it("density reads 'compact' only when saved so, and the toggle is one pressed chip next to the filters", () => {
    expect(read_density({ getItem: (k: string) => (k === DENSITY_STORAGE_KEY ? "compact" : null) })).toBe("compact");
    expect(read_density({ getItem: () => "weird" })).toBe("comfortable");
    expect(read_density(null)).toBe("comfortable");
    const html = page();
    expect(html.indexOf("mc_filters")).toBeLessThan(html.indexOf("mc_board"));
    const toggle = html.slice(html.lastIndexOf("<button", html.indexOf("mc_density_toggle")), html.indexOf("</button>", html.indexOf("mc_density_toggle")));
    expect(toggle).toContain('aria-pressed="false"');
    expect(plain(toggle + ">")).toContain("Compact");
    expect(html).toContain('data-density="comfortable"');
  });

  it("each entity is one chip: name, what it is doing and for how long, its last moment (or its trouble); the full kit card opens on demand", () => {
    const tile = gateway_tile("Castor");
    const w = entity_chip_words({ name: "Castor", look: null, tile, status: "ready", as_of_ms: null, reason: "" }, NOW);
    expect(w.name).toBe("Castor");
    expect(w.now.length).toBeGreaterThan(0);
    const html = page({ entities: [{ name: "Castor", look: null, tile, status: "ready", as_of_ms: null, reason: "" }], entities_total: 1 });
    expect(html).toContain('class="mc_entity_chip"');
    expect(html).toContain('aria-haspopup="dialog"');
    // The page reads the clock itself: the words, not the exact duration.
    expect(plain(html)).toContain(w.now.split(" · ")[0]);
    // The kit card is not drawn until a chip is opened.
    expect(html).not.toContain("af-entity-card");
  });
});
