export function random_id(): string {
  // Browser-first. crypto.randomUUID exists on modern Safari/Chrome.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (not cryptographically strong, but fine for local dev/testing idempotency keys).
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}


