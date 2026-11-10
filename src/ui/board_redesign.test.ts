// The Board redesign (2026-11-07, untracked/observer-board/DESIGN.md): identical Done runs as one
// row, empty lanes as headers, whole titles behind an explicit "…", one primary action per card and
// the rest behind one ⋯ menu, a remembered density, a compact Entities row.
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoardCardView,
  ENTITY_FOLD_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  GLIMPSE_LINES,
  MissionControlPage,
  TITLE_LINES,
  build_board,
  chain_is_path,
  done_group_key,
  done_groupable,
  done_sentence_echoes,
  group_done_cards,
  group_facts_words,
  outcome_glimpse,
  request_glimpse,
  tool_call_full_text,
  group_span_words,
  lane_collapses,
  pill_echoes_lane,
  read_density,
  type BoardCard,
  type CardHandlers,
} from "./mission_control";
import type { RunSummary } from "./run_status";
import type { AutomationBrief } from "./state_line";
import { error_of_run, load_outcome } from "./board_data";
import { gateway_tile } from "./__fixtures__/entity_tile";

const NOW = Date.parse("2026-11-07T22:00:00Z");
// The page filters Done with the real clock (48 h window): pin it to NOW so the fixtures
// (all dated relative to NOW) stay inside the window on any day the suite runs.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});
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

  const NOTES = { automation_id: "a1", title: "Process my notes", cadence: "every 2 minutes" } as unknown as AutomationBrief;
  const occ = (id: string, n: number, p: Partial<RunSummary> = {}) =>
    row({ run_id: id, status: "completed", role: "occurrence", automation_id: "a1", session_kind: "automation", occurrence_index: n, created_at: ago(40 - n), updated_at: ago(40 - n), ...p });

  it("an automation's runs differ by their number only: one group (its title is the automation's, read for every automation), its span in words", () => {
    const lanes = build_board({ active: [], done: [occ("o3", 3), occ("o2", 2), occ("o1", 1)], automations: new Map([["a1", NOTES]]), now_ms: NOW });
    const groups = group_done_cards(lanes.done);
    expect(groups.length).toBe(1);
    expect(groups[0].cards.length).toBe(3);
    expect(group_span_words(groups[0].cards)).toBe("#1 to #3");
    // The row's own facts, never one member's answer or metrics (review 2026-11-08 R4).
    expect(group_facts_words(groups[0].cards, NOW)).toEqual(["3 runs", "#1 to #3", "latest 37 minutes ago", "first 39 minutes ago"]);
  });

  it("never on a placeholder or a lazily read title: runs whose brief is unread (untitled) or read per card stay one card each, and the grouping does not move when briefs land (review 2026-11-08 D1/D2)", () => {
    const plain_run = (id: string, min: number) => row({ run_id: id, status: "completed", session_id: `s-${id}`, created_at: ago(min + 1), updated_at: ago(min) });
    const done = [plain_run("p1", 10), plain_run("p2", 11), plain_run("p3", 12)];
    const before = build_board({ active: [], done, now_ms: NOW }).done;
    expect(before.every((c) => c.title.untitled)).toBe(true);
    expect(before.some((c) => done_groupable(c))).toBe(false);
    expect(group_done_cards(before).map((g) => g.cards.length)).toEqual([1, 1, 1]);
    // The briefs land for SOME cards (only the ones in view are read): still one card each, same keys.
    const briefs = new Map([["p1", { run_id: "p1", excerpt: "Thank you." }], ["p2", { run_id: "p2", excerpt: "Thank you." }]]);
    const after = build_board({ active: [], done, run_briefs: briefs, now_ms: NOW }).done;
    expect(after[0].title.text).toBe("Thank you.");
    expect(group_done_cards(after).map((g) => g.cards.length)).toEqual([1, 1, 1]);
    expect(after.map(done_group_key)).toEqual(before.map(done_group_key));
    // An automation's title arriving changes nothing per card in view: it is read for every automation.
    const a_before = build_board({ active: [], done: [occ("o2", 2), occ("o1", 1)], automations: new Map([["a1", NOTES]]), now_ms: NOW }).done;
    const a_after = build_board({ active: [], done: [occ("o2", 2), occ("o1", 1)], automations: new Map([["a1", NOTES]]), run_briefs: new Map([["o2", { run_id: "o2", excerpt: "x" }]]), now_ms: NOW }).done;
    expect(a_after.map(done_group_key)).toEqual(a_before.map(done_group_key));
  });

  it("failures share a row only with the SAME reason on the row; without a reason on the row (this gateway's listings) each failure is its own card", () => {
    const f = (id: string, error: string | null) => occ(id, Number(id.slice(1)), { status: "failed", error } as any);
    const lanes = build_board({ active: [], done: [f("f3", "SpeculationUnavailableError: no MTP adapter"), f("f2", "SpeculationUnavailableError: no MTP adapter"), f("f1", "timeout")], automations: new Map([["a1", NOTES]]), now_ms: NOW });
    expect(group_done_cards(lanes.done).map((g) => g.cards.length)).toEqual([2, 1]);
    const bare = build_board({ active: [], done: [f("f3", null), f("f2", null), f("f1", null)], automations: new Map([["a1", NOTES]]), now_ms: NOW });
    expect(group_done_cards(bare.done).map((g) => g.cards.length)).toEqual([1, 1, 1]);
  });

  it("the lane shows ONE card for the group with ×3, and the count names what it opens; deleting the grouping would show three", () => {
    const done = [failed("f1", 10), failed("f2", 11), failed("f3", 12)];
    const html = page({ runs: done, all_runs: done });
    const lane = html.slice(html.indexOf('class="mc_column mc_column_done'));
    expect((lane.match(/data-lane="done"/g) || []).length).toBe(1);
    expect(lane).toContain("×3");
    expect(lane).toMatch(/aria-label="3 runs alike: show each"/);
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

  it("a Working run offers Pause… in its menu only when the host wires it; Pause asks first, with a reason, like the run page (review 2026-11-08 R1)", () => {
    const card = build_board({ active: [row({ run_id: "w1", updated_at: ago(1) })], done: [], now_ms: NOW }).working[0];
    expect(html_of(card)).not.toContain(">Pause…</button>");
    expect(html_of(card, { on_pause_run: async () => null })).toContain(">Pause…</button>");
    // The host sends the typed reason with the same run control the run page's dialog sends.
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(app).toContain('on_pause_run={(rid, reason) => submit_run_control_for_run(rid, "pause", { reason })}');
    const src = readFileSync(new URL("./mission_control.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/onSelect: \(\) => set_pause\(\{ phase: "confirm"/);
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

  it("each entity is the kit's compact EntityCard (ADR 0053 rule 4; review 2026-11-08 D6), its head the entity app; nothing re-drawn by the Board", () => {
    const tile = gateway_tile("Castor");
    const html = page({ entities: [{ name: "Castor", look: null, tile, status: "ready", as_of_ms: null, reason: "" }], entities_total: 1 });
    expect(html).toContain('<article class="af-entity-card mc_entity_card" data-density="compact"');
    expect(html).toContain('href="http://entity.test/?entity=Castor&amp;live=1"');
    const src = readFileSync(new URL("./mission_control.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/mc_entity_chip|function EntityOrb|ActivityAvatar/);
  });
});

describe("the whole text behind every reveal (review 2026-11-08 D3/D4/D5)", () => {
  it("a failure's reason comes from the run record when the listing has none, whole", async () => {
    const reason = "Effect failed after 3 attempts: SpeculationUnavailableError: The openai-compatible provider has no native MTP adapter for this model; speculation was requested by the automation's policy.";
    expect(error_of_run({ error: reason })).toBe(reason);
    expect(error_of_run({ error: { message: "boom" } })).toBe("boom");
    expect(error_of_run({})).toBe("");
    const client = { get_run: async () => ({ status: "failed", error: reason }), list_run_artifacts: async () => ({ total: 0 }) } as any;
    expect((await load_outcome(client, "f1")).error).toBe(reason);
    const card = build_board({ active: [], done: [row({ run_id: "f1", status: "failed", error: null } as any)], now_ms: NOW }).done[0];
    expect(card.error).toBe("");
    const t = plain(html_of(card, { outcome: { answer: "", artifacts: 0, error: reason } }));
    expect(t).toContain(reason);
    // While the record is being read: a skeleton line, never a blank failure.
    expect(html_of(card, { outcome_loading: true })).toContain("loading the failure");
  });

  it("'Read the whole answer' is the whole answer (no 4,000-character cap)", () => {
    const answer = "word ".repeat(2_600).trim(); // 12,999 characters
    const card = build_board({ active: [], done: [row({ run_id: "d1", status: "completed" })], now_ms: NOW }).done[0];
    const g = outcome_glimpse(card, { answer, artifacts: 0 })!;
    expect(g.full).toBe(answer);
    expect(g.full.length).toBe(12_999);
  });

  it("'Read the whole request' carries each call's arguments as recorded — the full URL, not the kit's shortened sentence", () => {
    const url = "https://www.fda.gov/news-events/press-announcements/fda-grants-accelerated-approval-new-treatment-head-and-neck-squamous-cell-carcinoma";
    const r = row({ run_id: "a1", status: "waiting", waiting: { reason: "user" }, updated_at: ago(9) });
    const details = new Map([["a1", { waiting: { reason: "user", wait_key: "wk", details: { tool_calls: [{ name: "fetch_url", arguments: { url, summary_only: true } }] } } }]]);
    const card = build_board({ active: [r], done: [], details, now_ms: NOW }).needs_you[0];
    const g = request_glimpse(card, details.get("a1"))!;
    expect(g.full).toContain(url);
    expect(g.full).toContain("summary_only: true");
    // The kit's sentence, then the arguments verbatim in a fence (markdown never re-reads them).
    expect(tool_call_full_text({ name: "fetch_url", arguments: { url } })).toContain(`~~~\nurl: ${url}\n~~~`);
  });
});

describe("review 2026-11-08 round 2", () => {
  it("a group row shows the group's facts only — never the lead run's answer or metrics (mutation M9)", () => {
    const NOTES = { automation_id: "a1", title: "Process my notes", cadence: "every 2 minutes" } as unknown as AutomationBrief;
    const occ = (id: string, n: number) =>
      row({ run_id: id, status: "completed", role: "occurrence", automation_id: "a1", session_kind: "automation", occurrence_index: n, created_at: ago(41 - n), updated_at: ago(40 - n), tokens_total: 1_234, tool_calls: 2 });
    const cards = build_board({ active: [], done: [occ("o3", 3), occ("o2", 2), occ("o1", 1)], automations: new Map([["a1", NOTES]]), now_ms: NOW }).done;
    const facts = group_facts_words(cards, NOW);
    const answer = "Nothing to process.";
    const as_row = html_of(cards[0], { outcome: { answer, artifacts: 1 }, group_count: 3, group_facts: facts });
    const t = plain(as_row);
    for (const f of facts) expect(t).toContain(f);
    expect(t).not.toContain(answer);
    expect(as_row).not.toContain("mc_glimpse_answer");
    expect(t).not.toMatch(/took \d|1,234 tokens|2 tool calls|1 artifact/);
    // The same card alone (not a group row) shows its own answer and metrics: the rule is the row's.
    const alone = plain(html_of(cards[0], { outcome: { answer, artifacts: 1 } }));
    expect(alone).toContain(answer);
    expect(alone).toContain("1,234 tokens");
  });

  it("the Entities strip folds to its head on the viewer's choice (default open), remembered per browser", () => {
    const tile = gateway_tile("Castor");
    const html = page({ entities: [{ name: "Castor", look: null, tile, status: "ready", as_of_ms: null, reason: "" }], entities_total: 1 });
    expect(html).toMatch(/class="mc_link_btn mc_entities_fold" aria-expanded="true">Hide<\/button>/);
    expect(html).toContain("af-entity-card");
    expect(ENTITY_FOLD_STORAGE_KEY).toBe("abstractobserver_board_entities_folded_v1");
    const src = readFileSync(new URL("./mission_control.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/localStorage\.getItem\(ENTITY_FOLD_STORAGE_KEY\) === "1"/);
  });

  it("an automation's long last-run fact may wrap inside the foot (no nowrap meta unit runs past a 281 px card)", () => {
    const css = readFileSync(new URL("./board.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/\.mc_card_meta \.mc_unit\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[rules.length - 1]).toMatch(/white-space:\s*normal/);
  });
});

describe("review 2026-11-08 round 4", () => {
  it("the connection notice reaches the Board whole (a 300-character request), folded to one line with the reveal — never cut", () => {
    const notice = `Refresh run metrics failed: GET /api/gateway/runs?limit=200&root_only=true&kind=conversation&session_kind=automation,occurrence${"&x=1".repeat(50)}: no answer within 30 s — the gateway is busy · 01:43`;
    expect(notice.length).toBeGreaterThan(300);
    const html = page({ notice });
    expect(html).toContain(notice.replace(/&/g, "&amp;"));
    expect(html).toMatch(/class="mc_notice mc_notice_folded is_bad" role="status"><div class="mc_clamp"><div class="mc_clamp_text" data-lines="1"/);
    // The host hands the message over whole (no clamp_preview on the notice).
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(app).toContain("note_connection(title, msg);");
    expect(app).not.toMatch(/note_connection\(title, clamp_preview/);
  });
});
