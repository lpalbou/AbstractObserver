/**
 * Fabricated-lookup flag (maintainer escalation, entity-society seq 43,
 * FAILURE 1): Castor produced a "World-State Report" with named sources and
 * the claim "the feed was fetched live during this session" — while the
 * driver-authored record shows ZERO tools ran. The marker-honesty guard only
 * catches `[used tool: X]` imitation; free-prose claims passed silently.
 *
 * This is a RENDER-SIDE mismatch flag, not prose-truth parsing: the reply's
 * CLAIM (prose) is compared against the turn's FACTS (driver-authored
 * tools_ran). It fires only when both sides are confident — a first-person
 * live-action claim in the reply AND an empty tool record.
 *
 * Conservative by design (the 2026-06-10 language-guard lesson: detectors
 * must abstain when unsure). Deliberate abstentions, documented:
 * - Named-source citations alone ("according to Reuters") do NOT flag —
 *   a real headline can be honestly recalled from a memory formed by an
 *   earlier, genuine lookup. Liveness must be CLAIMED to flag.
 * - Second/third-person and hypothetical phrasing ("you could search",
 *   "a web search would show") never flags.
 * - Past-visit references ("when I searched yesterday") are not liveness
 *   claims about THIS turn; the sentence must not anchor itself to an
 *   earlier time to flag under the action rule.
 */

/** One matched claim: the rule that fired and the sentence that carried it. */
export interface LookupClaim {
  rule: "live_fetch" | "first_person_lookup" | "tool_name_prose";
  snippet: string;
}

export interface ToolClaimVerdict {
  /** True only when the reply claims a lookup AND zero tools ran. */
  fabricated: boolean;
  claims: LookupClaim[];
}

/** Real tool names an entity can elect (free-prose mentions of these in a
 * "used/ran/called" phrase are claims of execution). Kept in sync with the
 * driver's tier-1 set loosely — unknown names simply never match. */
const TOOL_NAMES = [
  "web_search",
  "search_memory",
  "read_memory",
  "diary_read",
  "diary_list",
  "diary_search",
  "read_file",
  "write_file",
  "list_files",
];

/** First-person live-action verbs that assert an EXECUTED lookup. */
const ACTION_VERBS =
  "fetched|searched|queried|retrieved|pulled|scraped|downloaded|looked\\s+up|checked";

/** External-source nouns that make the action a LOOKUP (not reflection). */
const SOURCE_NOUNS =
  "web|internet|online|news|feed|feeds|rss|api|site|website|wikipedia|search\\s+results?";

/** Sentence anchors to an earlier time — not a claim about THIS turn. */
const PAST_ANCHORS = /\b(yesterday|last\s+(?:time|visit|night|week)|earlier\s+(?:today|visit)|previous(?:ly)?|before\s+this)\b/i;

const LIVE_FETCH_RE = new RegExp(
  // "fetched live", "fetched during this session", "live feed pulled", etc.
  `\\b(?:(?:${ACTION_VERBS})\\s+live|live[- ](?:fetch|fetched|pulled|data|results)|(?:${ACTION_VERBS})[^.!?\\n]{0,60}\\bduring\\s+this\\s+(?:session|visit|conversation)\\b)`,
  "i",
);

const FIRST_PERSON_RE = new RegExp(
  // "I fetched/searched/pulled ... web/feed/news ..." in one sentence.
  `\\bI(?:\\s+(?:just|also|then|quickly))?\\s+(?:have\\s+|'ve\\s+)?(?:${ACTION_VERBS})\\b`,
  "i",
);

const SOURCE_RE = new RegExp(`\\b(?:${SOURCE_NOUNS})\\b`, "i");

const TOOL_PROSE_RE = new RegExp(
  `\\bI\\s+(?:used|ran|called|invoked|executed)\\s+(?:the\\s+)?(?:${TOOL_NAMES.join("|")})\\b`,
  "i",
);

function sentences(text: string): string[] {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Detect lookup CLAIMS in reply prose (independent of tool facts). */
export function detectLookupClaims(reply: string): LookupClaim[] {
  const claims: LookupClaim[] = [];
  for (const sentence of sentences(reply)) {
    if (PAST_ANCHORS.test(sentence)) continue; // about another time, abstain
    if (LIVE_FETCH_RE.test(sentence)) {
      claims.push({ rule: "live_fetch", snippet: sentence.slice(0, 160) });
      continue;
    }
    if (FIRST_PERSON_RE.test(sentence) && SOURCE_RE.test(sentence)) {
      claims.push({ rule: "first_person_lookup", snippet: sentence.slice(0, 160) });
      continue;
    }
    if (TOOL_PROSE_RE.test(sentence)) {
      claims.push({ rule: "tool_name_prose", snippet: sentence.slice(0, 160) });
    }
  }
  return claims;
}

/**
 * The verdict: fabricated only when claims exist AND the driver-authored
 * record says nothing ran. Tools-ran turns never flag (the claim is then
 * plausibly honest; result fidelity is the runtime lane's concern).
 */
export function toolClaimVerdict(reply: string | undefined, toolsRan: readonly string[] | undefined): ToolClaimVerdict {
  const ran = (toolsRan ?? []).length;
  if (ran > 0) return { fabricated: false, claims: [] };
  const claims = detectLookupClaims(reply ?? "");
  return { fabricated: claims.length > 0, claims };
}
