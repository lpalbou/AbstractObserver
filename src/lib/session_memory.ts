import { sha256Hex } from "./secure-context";

/**
 * The run that holds a session's own media (voice recordings, spoken replies):
 * `session_memory_<sid>`, or a digest form when the session id carries
 * characters a run id may not. Voice requests ride this run so nothing is
 * written into the runs the Observer is watching.
 */
const _SAFE_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function _is_safe_run_id(value: string): boolean {
  return _SAFE_RUN_ID_PATTERN.test(String(value || "").trim());
}

async function _sha256_hex(text: string): Promise<string> {
  const payload = String(text || "");
  // crypto.subtle exists only on https/localhost; sha256Hex falls back to a plain SHA-256 over http.
  return sha256Hex(payload);
}

export async function session_memory_run_id(session_id: string): Promise<string> {
  const sid = String(session_id || "").trim();
  if (!sid) throw new Error("session_id is required");
  if (_is_safe_run_id(sid)) {
    const rid = `session_memory_${sid}`;
    if (_is_safe_run_id(rid)) return rid;
  }
  const digest = await _sha256_hex(sid);
  return `session_memory_sha_${digest.slice(0, 32)}`;
}
