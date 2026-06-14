export type RuntimeMetadata = Record<string, unknown>;

export type RuntimeMetadataSplit = {
  text: string;
  metadata: RuntimeMetadata | null;
  stripped: boolean;
};

const RUNTIME_METADATA_ENVELOPE_RE = /^\s*<runtime_metadata>\s*([\s\S]*?)\s*<\/runtime_metadata>\s*/i;

export function split_runtime_metadata_envelope(value: unknown): RuntimeMetadataSplit {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const match = RUNTIME_METADATA_ENVELOPE_RE.exec(raw);
  if (!match) return { text: raw.trim(), metadata: null, stripped: false };

  let metadata: RuntimeMetadata | null = null;
  try {
    const parsed = JSON.parse(String(match[1] || "").trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as RuntimeMetadata;
    }
  } catch {
    metadata = null;
  }

  return {
    text: raw.slice(match[0].length).trim(),
    metadata,
    stripped: true,
  };
}

export function merge_runtime_metadata(...items: Array<RuntimeMetadata | null | undefined>): RuntimeMetadata | null {
  const out: RuntimeMetadata = {};
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      if (value === null || value === undefined || String(value).trim() === "") continue;
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}
