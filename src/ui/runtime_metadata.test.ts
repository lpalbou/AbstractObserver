import { describe, expect, it } from "vitest";

import { merge_runtime_metadata, split_runtime_metadata_envelope } from "./runtime_metadata";

describe("runtime metadata envelope helpers", () => {
  it("strips runtime metadata from user-visible text and exposes it as metadata", () => {
    const split = split_runtime_metadata_envelope(
      '<runtime_metadata>{"country":"FR","display":"[2026-05-24 20:21:42 FR]","timezone":"Europe/Paris","user":"albou"}</runtime_metadata>\nwho are you ?'
    );

    expect(split.text).toBe("who are you ?");
    expect(split.metadata?.country).toBe("FR");
    expect(split.metadata?.timezone).toBe("Europe/Paris");
    expect(split.metadata?.user).toBe("albou");
  });

  it("merges explicit message metadata over envelope metadata", () => {
    const merged = merge_runtime_metadata({ country: "FR", user: "albou" }, { user: "ops", timezone: "Europe/Paris" });

    expect(merged).toEqual({ country: "FR", user: "ops", timezone: "Europe/Paris" });
  });
});
