/**
 * Host-marker render contracts (gateway c746 confirmation of observer's
 * c745 proposals): the payload keys below are the AGREED wire shapes —
 * gateway writes them the day the N4 gate + own_time grant land; these
 * pins keep the render half honest against the confirmed contract, so a
 * key rename on either side fails a test instead of silently falling to
 * the generic "Host: <kind>" line.
 */

import { describe, expect, it } from "vitest";

import { ledgerLine } from "./ledger_lines";
import type { ReplayEnvelope } from "./stream_types";

function hostEnv(seq: number, payload: Record<string, unknown>): ReplayEnvelope {
  return {
    stream: "abstractmemory.replay",
    stream_version: 1,
    seq,
    family: "host",
    observed_at: "2026-07-11T18:00:00+00:00",
    scope: "life",
    owner_id: "entity:test",
    trace_id: null,
    turn_id: null,
    run_id: null,
    payload,
    display: null,
  } as unknown as ReplayEnvelope;
}

describe("deposit_refused (N4 render leg, R5 — c746 contract)", () => {
  it("renders the sleep phase-gate refusal loud with the door's sentence verbatim", () => {
    const line = ledgerLine(
      hostEnv(1, {
        kind: "deposit_refused",
        phase: "sleep",
        effect_type: "MEMORY_FORM",
        refused_by: "phase_gate",
        record_kind: "episode",
        scope: "self",
        reason: "sleep deposits nothing (N4)",
      }),
    );
    expect(line.title).toBe("⛔ A sleep-phase deposit was refused");
    expect(line.detail).toContain("MEMORY_FORM");
    expect(line.detail).toContain("into self");
    expect(line.detail).toContain("sleep deposits nothing (N4)");
  });

  it("MEMORY_ACCESS is the enum member for the commit-selection refusal (c746 amendment)", () => {
    const line = ledgerLine(
      hostEnv(2, {
        kind: "deposit_refused",
        phase: "sleep",
        effect_type: "MEMORY_ACCESS",
        refused_by: "phase_gate",
        reason: "commit is the strengthening path",
      }),
    );
    expect(line.detail).toContain("MEMORY_ACCESS");
  });

  it("a non-phase-gate refusal renders without claiming the sleep class", () => {
    const line = ledgerLine(
      hostEnv(3, { kind: "deposit_refused", effect_type: "MEMORY_FORM", reason: "not a workplace act" }),
    );
    expect(line.title).toBe("⛔ A deposit was refused");
  });
});

describe("personal-time grant lifecycle (c746 contract, ruled vocabulary c794/c798)", () => {
  it("granted renders as ARM, never start (an armed grant permits, never starts)", () => {
    const line = ledgerLine(
      hostEnv(4, {
        kind: "personal_granted",
        mode: "timer",
        expires_at: "2026-07-11T19:00:00+00:00",
        granted_by: "person:laurent",
      }),
    );
    expect(line.title).toBe("Personal time armed");
    expect(line.detail).toContain("armed, not started");
    expect(line.detail).toContain("person:laurent");
    expect(line.detail).toContain("timer until 2026-07-11T19:00:00+00:00");
  });

  it("until_revoked mode says so (revoke, not retract — c794: retract is spent in the identity lane)", () => {
    const line = ledgerLine(hostEnv(5, { kind: "personal_granted", mode: "until_revoked", granted_by: "person:laurent" }));
    expect(line.detail).toContain("until revoked");
  });

  it("a backstop expiry is LOUD — it means the gateway was not there (c746)", () => {
    const line = ledgerLine(
      hostEnv(6, { kind: "personal_grant_expired", expired_at: "2026-07-11T19:00:05+00:00", enforced_by: "wall_clock_backstop" }),
    );
    expect(line.title).toContain("backstop");
    expect(line.title).toContain("⛔");
    expect(line.detail).toContain("the gateway was not there");
  });

  it("a poll expiry renders calm", () => {
    const line = ledgerLine(hostEnv(7, { kind: "personal_grant_expired", expired_at: "2026-07-11T19:00:05+00:00", enforced_by: "poll" }));
    expect(line.title).toBe("Personal-time grant expired");
    expect(line.detail).toContain("tick poll");
  });

  it("revoked names who withdrew it", () => {
    const line = ledgerLine(hostEnv(8, { kind: "personal_grant_revoked", revoked_by: "person:laurent" }));
    expect(line.title).toBe("Personal-time grant revoked");
    expect(line.detail).toContain("person:laurent");
  });

  it("the DEAD pre-ruling kinds render as generic host lines, never aliased (zero envelopes ever carried them)", () => {
    expect(ledgerLine(hostEnv(20, { kind: "own_time_granted", mode: "timer" })).title).toBe("Host: own_time_granted");
    expect(ledgerLine(hostEnv(21, { kind: "own_time_grant_retracted" })).title).toBe("Host: own_time_grant_retracted");
  });

  it("loop-lifecycle kinds render under BOTH spellings (historical streams carry own_time_*)", () => {
    expect(ledgerLine(hostEnv(22, { kind: "own_time_started" })).title).toBe("His own time began");
    expect(ledgerLine(hostEnv(23, { kind: "personal_started" })).title).toBe("His own time began");
  });
});

describe("prompt_overlay_changed (marker-first prompt edits, word-free)", () => {
  it("names rewritten and reverted layers without any prompt words", () => {
    const line = ledgerLine(
      hostEnv(9, {
        kind: "prompt_overlay_changed",
        channel: "operator",
        layers: { conversation: "ab12cd34", operator: "ef56ab78" },
        reverted: ["visit"],
      }),
    );
    expect(line.title).toBe("✍️ Standing instructions changed");
    expect(line.detail).toContain("conversation");
    expect(line.detail).toContain("operator");
    expect(line.detail).toContain("reverted to default: visit");
    // Word-free invariant: hashes never render as content, and no layer
    // TEXT exists in the payload to leak in the first place.
    expect(line.detail).not.toContain("ab12cd34");
  });
});

describe("unknown host kinds stay honest", () => {
  it("falls to the generic line instead of guessing", () => {
    const line = ledgerLine(hostEnv(10, { kind: "some_future_marker", reason: "new thing" }));
    expect(line.title).toBe("Host: some_future_marker");
  });
});

describe("malformed payloads never fabricate claims (adversary pins)", () => {
  it("missing mode renders 'mode unrecorded', never the strongest 'until revoked' claim", () => {
    const line = ledgerLine(hostEnv(11, { kind: "personal_granted", granted_by: "person:laurent" }));
    expect(line.detail).toContain("mode unrecorded");
    expect(line.detail).not.toContain("until revoked");
  });

  it("missing enforced_by renders 'enforcement unrecorded', never the calm poll claim", () => {
    const line = ledgerLine(hostEnv(12, { kind: "personal_grant_expired", expired_at: "2026-07-11T19:00:05+00:00" }));
    expect(line.detail).toContain("enforcement unrecorded");
    expect(line.detail).not.toContain("tick poll");
    expect(line.title).not.toContain("backstop");
  });

  it("layers as an ARRAY never renders indices as layer names", () => {
    const line = ledgerLine(hostEnv(13, { kind: "prompt_overlay_changed", layers: ["conversation", "visit"] }));
    expect(line.detail).not.toContain("rewrote: 0");
    expect(line.detail).toBe("the operator changed the prompt overlay");
  });

  it("phase_gate without a named phase never claims the sleep class", () => {
    const line = ledgerLine(hostEnv(14, { kind: "deposit_refused", refused_by: "phase_gate", effect_type: "MEMORY_FORM" }));
    expect(line.title).toBe("⛔ A phase-gated deposit was refused");
    expect(line.title).not.toContain("sleep");
  });

  it("deposit_refused reason clips at 96 visibly (the door's sentence is the load-bearing content)", () => {
    const long = "x".repeat(200);
    const line = ledgerLine(hostEnv(15, { kind: "deposit_refused", effect_type: "MEMORY_FORM", reason: long }));
    expect(line.detail).toContain("…");
    expect(line.detail.length).toBeLessThan(160);
  });

  it("record_kind renders when present (contract completeness)", () => {
    const line = ledgerLine(
      hostEnv(16, { kind: "deposit_refused", refused_by: "phase_gate", phase: "sleep", effect_type: "MEMORY_FORM", record_kind: "episode", scope: "self" }),
    );
    expect(line.detail).toContain("(episode)");
  });
});
