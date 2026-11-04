// Digital identity in the Observer (framework ADR 0052, backlog 1119). The fixtures are live
// answers of a scratch gateway (AbstractGateway main + the record routes, AbstractRuntime 0.18.0,
// abstractavatar 0.1.1): `GET /entities`, `GET /entities/castor/identity?rev=1`,
// `GET /sessions/{id}/track-record` and `/reputation`. A missing fixture THROWS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EntityLookView,
  IdentityLooks,
  TrackRecordLine,
  entity_row_ref,
  look_of_answer,
  track_record_words,
  type IdentityRef,
  type RecordRead,
} from "./identity";

const fix = (name: string): any => JSON.parse(readFileSync(join(__dirname, "__fixtures__", name), "utf8"));
const ROWS = fix("identity_entities_rows.json").entities;
const CASTOR_REV1 = fix("identity_castor_rev1.json");
const SESSION_RECORD = fix("identity_session_track_record.json");
const SESSION_REPUTATION = fix("identity_session_reputation.json");
const EMPTY_RECORD = fix("identity_castor_track_record_empty.json");
const EMPTY_REPUTATION = fix("identity_castor_reputation_empty.json");

const text = (el: React.ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const CASTOR: IdentityRef = { of: "entity:castor", rev: 1 };

describe("the ref of a roster row", () => {
  it("is the row's entity_id at its identity's rev", () => {
    expect(entity_row_ref(ROWS[0])).toEqual({ of: "entity:castor", rev: 1 });
    expect(entity_row_ref(ROWS[1])).toEqual({ of: "entity:pollux", rev: 1 });
  });
  it("is null when the row carries no identity (a home before the boot pass, a held home)", () => {
    expect(entity_row_ref({ ...ROWS[0], identity: null })).toBeNull();
    expect(entity_row_ref({ entity_id: "entity:castor", name: "Castor" })).toBeNull();
    expect(entity_row_ref({ ...ROWS[0], identity: { ...ROWS[0].identity, rev: 0 } })).toBeNull();
  });
});

describe("the look a ref names", () => {
  it("reads design, colour and voice from the gateway's answer", () => {
    expect(look_of_answer(CASTOR_REV1, CASTOR)).toEqual({ style: "watch-nebula", color: "#d06439", voice: "no voice yet" });
    const voiced = { ...CASTOR_REV1, identity: { ...CASTOR_REV1.identity, voice: { provider: "openai", model: "gpt-4o-mini-tts", voice: "nova" } } };
    expect(look_of_answer(voiced, CASTOR).voice).toBe("nova");
  });
  it("refuses an answer for another ref instead of drawing it", () => {
    expect(() => look_of_answer(CASTOR_REV1, { of: "entity:castor", rev: 2 })).toThrow("The gateway answered entity:castor#1 when asked for entity:castor#2.");
    expect(() => look_of_answer({ ...CASTOR_REV1, identity_ref: undefined }, CASTOR)).toThrow("answered no identity");
  });
});

describe("IdentityLooks: one read per ref", () => {
  const reader = (answers: Record<number, any>) => {
    const calls: string[] = [];
    const read = async (name: string, rev: number) => {
      calls.push(`${name}#${rev}`);
      const a = answers[rev];
      if (a instanceof Error) throw a;
      return a;
    };
    return { calls, read };
  };

  it("a second ask for the same ref reads nothing; a new rev reads its record", async () => {
    const rev2 = { ...CASTOR_REV1, identity: { ...CASTOR_REV1.identity, rev: 2, avatar: { style: "watch-lotus", color: "#3b82f6" } }, identity_ref: { of: "entity:castor", rev: 2 } };
    const r = reader({ 1: CASTOR_REV1, 2: rev2 });
    const looks = new IdentityLooks(r.read);
    expect((await looks.look("Castor", CASTOR)).style).toBe("watch-nebula");
    expect((await looks.look("Castor", { ...CASTOR })).style).toBe("watch-nebula");
    expect(r.calls).toEqual(["Castor#1"]);
    expect((await looks.look("Castor", { of: "entity:castor", rev: 2 })).style).toBe("watch-lotus");
    expect(r.calls).toEqual(["Castor#1", "Castor#2"]);
  });

  it("a failed read is not kept: the next ask reads again", async () => {
    const r = reader({ 1: new Error("Castor's look could not be read (HTTP 503): castor has no identity yet") });
    const looks = new IdentityLooks(r.read);
    await expect(looks.look("Castor", CASTOR)).rejects.toThrow("castor has no identity yet");
    await expect(looks.look("Castor", CASTOR)).rejects.toThrow("castor has no identity yet");
    expect(r.calls).toEqual(["Castor#1", "Castor#1"]);
  });
});

describe("a tile's look: the ref's look or the gateway's sentence, never another look", () => {
  const view = (over: Partial<React.ComponentProps<typeof EntityLookView>>) =>
    renderToStaticMarkup(
      <EntityLookView name="Castor" identity_ref={CASTOR} size={32} look={null} error="" design="Watch Nebula" on_draw_error={() => undefined} {...over} />,
    );

  it("draws the design and colour the ref names", () => {
    const m = view({ look: look_of_answer(CASTOR_REV1, CASTOR) });
    expect(m).toContain('data-testid="identity-orb"');
    expect(m).toContain('data-ref="entity:castor#1"');
    expect(m).toContain('data-style="watch-nebula"');
    expect(m).toContain("--warning:#d06439");
    expect(m).toContain('title="Castor: Watch Nebula, #d06439; voice: no voice yet"');
  });

  it("a failed read shows the gateway's sentence and draws nothing", () => {
    const sentence = "Castor's look could not be read (HTTP 404): castor has no identity rev 1";
    const m = view({ error: sentence, look: look_of_answer(CASTOR_REV1, CASTOR) });
    expect(m).toContain('data-testid="identity-look-error"');
    expect(m).toContain(`title="${sentence.replace(/'/g, "&#x27;")}"`);
    expect(m).not.toContain("identity-orb");
    expect(m).not.toContain("<canvas");
    expect(m).not.toContain("--warning");
  });

  it("while the ref is being read: an empty circle, no colour, no design", () => {
    const m = view({});
    expect(m).toContain('data-testid="identity-look-reading"');
    expect(m).not.toContain("<canvas");
    expect(m).not.toContain("--warning");
  });
});

describe("the track record in plain words", () => {
  it("live session answer: counts, trust with its support, what the numbers are", () => {
    expect(track_record_words(SESSION_RECORD, SESSION_REPUTATION)).toEqual({
      counts: "2 runs · 2 succeeded · 0 failed",
      trust: "trust 0.67 over 2 outcomes",
      gloss: "2 of 2 finished; trust starts in the middle and moves with each outcome",
      basis: "A success here only means the task finished: nobody has judged the quality of the work yet.",
    });
  });
  it("no outcome yet reads 'No experience yet', never a trust number", () => {
    const w = track_record_words(EMPTY_RECORD, EMPTY_REPUTATION);
    expect(w).toEqual({ counts: "", trust: "No experience yet", gloss: "", basis: "" });
    expect(EMPTY_REPUTATION.overall.trust).toBe(0.5);
    // Runs without an outcome yet (all still running): the counts, and still no trust number.
    const running = { ...EMPTY_RECORD, runs: 2, in_progress: 2 };
    expect(track_record_words(running, EMPTY_REPUTATION)).toEqual({ counts: "2 runs · 0 succeeded · 0 failed", trust: "No experience yet", gloss: "", basis: "" });
  });
  it("one outcome is singular; a basis the Observer does not know is shown as the gateway wrote it", () => {
    const one = { ...SESSION_REPUTATION, overall: { ...SESSION_REPUTATION.overall, support: 1, successes: 1, trust: 2 / 3 } };
    expect(track_record_words({ ...SESSION_RECORD, runs: 1, successes: 1 }, one).trust).toBe("trust 0.67 over 1 outcome");
    expect(track_record_words({ ...SESSION_RECORD, runs: 1, successes: 1 }, one).gloss).toBe("1 of 1 finished; trust starts in the middle and moves with each outcome");
    expect(track_record_words(SESSION_RECORD, { ...SESSION_REPUTATION, basis: "assessed by people" }).basis).toBe("assessed by people");
  });
  it("an answer without its counts fails loudly", () => {
    expect(() => track_record_words({ ...SESSION_RECORD, runs: undefined }, SESSION_REPUTATION)).toThrow("The track record has no runs count.");
    expect(() => track_record_words(SESSION_RECORD, { ...SESSION_REPUTATION, overall: {} })).toThrow("The trust has no support count.");
  });
});

describe("TrackRecordLine", () => {
  const read = (over: Partial<RecordRead>): RecordRead => ({ session_id: "q7-demo", loading: false, error: "", record: SESSION_RECORD, reputation: SESSION_REPUTATION, ...over });
  it("one line, plain copy, no jargon", () => {
    const t = text(<TrackRecordLine read={read({})} />);
    expect(t).toBe(
      "Track record: 2 runs · 2 succeeded · 0 failed · trust 0.67 over 2 outcomes (2 of 2 finished; trust starts in the middle and moves with each outcome)" +
        "A success here only means the task finished: nobody has judged the quality of the work yet.",
    );
    for (const word of ["ledger", "basis", "run_id", "session:", "completion-rate", "q7-demo"]) expect(t).not.toContain(word);
  });
  it("'No experience yet' leads the line when nothing has an outcome", () => {
    expect(text(<TrackRecordLine read={read({ record: EMPTY_RECORD, reputation: EMPTY_REPUTATION })} />)).toBe("Track record: No experience yet");
  });
  it("the gateway's refusal verbatim; reading; a run outside any conversation", () => {
    const refusal = "The track record could not be read (HTTP 404): Session q7-demo does not exist.";
    expect(text(<TrackRecordLine read={read({ error: refusal, record: null, reputation: null })} />)).toBe(`Track record: ${refusal}`);
    expect(text(<TrackRecordLine read={read({ loading: true, record: null, reputation: null })} />)).toBe("Track record: reading…");
    expect(text(<TrackRecordLine read={read({ session_id: "", record: null, reputation: null })} />)).toBe("Track record: none: this run belongs to no conversation");
  });
});
