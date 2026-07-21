import { describe, expect, it } from "vitest";

import { artifact_group_key, artifact_human_title, artifact_semantic_label, format_bytes, infer_artifact_modality, normalize_artifact_item } from "./artifacts";

describe("artifacts.ts — wire-shape normalization (ui-rethink P1 step 2)", () => {
  it("normalize_artifact_item folds envelope v1, legacy refs, and tag bags into one shape", () => {
    // Envelope v1 (the modern wire).
    const env = normalize_artifact_item(
      {
        artifact_envelope_v1: {
          artifact_id: "art-1",
          run_id: "run-9",
          content_type: "image/png",
          filename: "chart.png",
          size_bytes: 2048,
          tags: { workflow_id: "wf-1" },
        },
      },
      "search",
    );
    expect(env?.artifact_id).toBe("art-1");
    expect(env?.run_id).toBe("run-9");
    // Verbatim behavior pin: modality INFERENCE reads flat/legacy shapes
    // only — an envelope without an explicit modality field degrades to
    // "artifact" (real envelopes carry modality; the content-type fold
    // lands on render_kind instead, asserted below).
    expect(env?.modality).toBe("artifact");
    expect(env?.render_kind).toBe("image");
    expect(env?.size_bytes).toBe(2048);
    expect(env?.source).toBe("search");

    // Legacy nested ref (pre-envelope runs still replay through history).
    const legacy = normalize_artifact_item({ ref: { artifact_id: "art-2", content_type: "audio/wav" } }, "run");
    expect(legacy?.artifact_id).toBe("art-2");
    expect(legacy?.modality).toBe("audio");

    // No id anywhere = not an artifact, never a fabricated row.
    expect(normalize_artifact_item({ ref: {} }, "run")).toBeNull();
    expect(normalize_artifact_item(null, "run")).toBeNull();
    expect(normalize_artifact_item("string", "session")).toBeNull();
  });

  it("infer_artifact_modality prefers explicit modality, then content-type families", () => {
    expect(infer_artifact_modality({ modality: "Voice" })).toBe("voice");
    expect(infer_artifact_modality({ content_type: "image/webp" })).toBe("image");
    expect(infer_artifact_modality({ content_type: "application/pdf" })).toBe("document");
    expect(infer_artifact_modality({ content_type: "text/markdown" })).toBe("text");
    expect(infer_artifact_modality({})).toBe("artifact");
  });

  it("labels stay honest for sparse rows", () => {
    const bare = normalize_artifact_item({ artifact_id: "abcdef0123456789deadbeef" }, "session")!;
    // No filename/title/path: the human title degrades to a typed label,
    // never an empty string.
    expect(artifact_human_title(bare)).toBeTruthy();
    expect(artifact_semantic_label(bare)).toBe("Other");
    // Unknown time groups honestly rather than fabricating a date.
    expect(artifact_group_key(bare, "time")).toBe("(unknown time)");
    expect(artifact_group_key(bare, "run")).toBe("(no run)");
  });

  it("format_bytes bounds units and refuses junk", () => {
    expect(format_bytes(null)).toBe("—");
    expect(format_bytes(-1)).toBe("—");
    expect(format_bytes(0)).toBe("0 B");
    expect(format_bytes(1536)).toBe("1.50 KB");
    expect(format_bytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
