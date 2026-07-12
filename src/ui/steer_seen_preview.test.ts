import { describe, expect, it } from "vitest";

import { steer_seen_preview } from "./app";

// Pins the render contract for runtime's H4 steer-delivery ack
// (`abstract.steer_seen`, EMIT_EVENT-shaped, payload {seqs, count, node_id}).
// The payload carries no prose, so without a dedicated preview the ledger row
// rendered empty. Runtime's ship note (c996): "flow/observer: ONE new name" —
// this is the observer half.
describe("steer_seen_preview", () => {
  it("names the count and the node the loop folds it before", () => {
    const text = steer_seen_preview({ seqs: [3], count: 1, node_id: "reason" });
    expect(text).toBe("1 steer message folded into the run before reason — the loop sees it at this boundary");
  });

  it("pluralizes multiple messages", () => {
    const text = steer_seen_preview({ seqs: [4, 5], count: 2, node_id: "reason" });
    expect(text).toContain("2 steer messages folded into the run");
  });

  it("missing count renders honest wording, never NaN or a fabricated number", () => {
    const text = steer_seen_preview({ node_id: "reason" });
    expect(text).toContain("steering folded into the run");
    expect(text).not.toContain("NaN");
  });

  it("missing node_id drops the location instead of inventing one", () => {
    const text = steer_seen_preview({ count: 1 });
    expect(text).toBe("1 steer message folded into the run — the loop sees it at this boundary");
  });

  it("malformed payload (non-object) still renders", () => {
    expect(steer_seen_preview(null)).toContain("steering folded into the run");
    expect(steer_seen_preview("junk")).toContain("steering folded into the run");
  });
});
