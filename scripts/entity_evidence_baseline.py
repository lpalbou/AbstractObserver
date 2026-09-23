#!/usr/bin/env python3
"""Entity evidence baseline — the three-number measuring stick for
plans/improving-entity-capabilities.md (observer section, adopted as the
plan's acceptance bar 2026-07-16).

Read-only. Run before/after every teaching change; a wave that doesn't
move the numbers didn't land.

Numbers:
  1. access-keyed recall surface: how many digest texts quote a followable
     key (diary_/#tag/tool command) vs bare act markers.
  2. distinct-title ratio: duplicate-title collapse (retrieval damage).
  3. tool palette by lane: outward vs introspective tool use, from the
     store's tools_used attributes (the evidence-grade layer — replay
     payload greps undercount; see plan v7 correction).

Evolution indicators (iteration-2 wave, adopted from the lived-adversary
report c3126 item 5 — access gauges cannot see evolution):
  I1. question/problem closure + verbatim-duplicate questions.
  I2. write->read ratio per evolved kind (lesson/world_model/dream):
      formed vs EVER selected by recall (memj_selected_counts join on
      the digest assertion_id).
  I3. felt-subject coverage: free-string valence targets vs world_model
      cards over them; plus entity-driven closures (belief revision by
      HIM, not the machine).

Usage: python3 scripts/entity_evidence_baseline.py <home_dir> [--since ISO]
  e.g. python3 scripts/entity_evidence_baseline.py \
       <workspace>/runtime/entities/ephemeral

--since windows sections 1 (keyed cohort), 3 (palette), and I2 (write->read
cohort) by formation time. Vintage honesty: append-only stores keep
unreachable-by-construction cohorts in the all-time denominator forever
(56 boilerplate dreams, memory c3155) — a fix can only show on the cohort
formed AFTER it landed. The cut is an ISO-string compare: pass aware-UTC
timestamps in the store's own form (+00:00), never a different offset.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

INTROSPECTIVE = {"search_memory", "read_memory", "diary_list", "diary_read", "recent_memories"}
# Everything else counts as outward/world-facing (web_search, fetch_url,
# read_file, list_files, write_file, ...). The split follows the plan's
# entity-section palette finding. recent_memories is memory-introspection
# (the breadcrumb tool) — bucketing it outward inflated the outward count
# (adversary audit 2026-07-19, finding 11); reclassified, so palette
# comparisons across that date note the bucket change.

ACT_MARKER_RE = re.compile(r"\[(kept in diary|marked \d+ feeling|kept an interest|used tool)[^\]]*\]")
KEY_RE = re.compile(r"(diary_[0-9a-f]{8,}|#[0-9a-f]{6,}|diary_read\s+\S+|read_memory\s+\S+)")


def ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def main() -> int:
    argv = sys.argv[1:]
    since = ""
    if "--since" in argv:
        idx = argv.index("--since")
        try:
            since = str(argv[idx + 1]).strip()
        except IndexError:
            print(__doc__)
            return 2
        argv = argv[:idx] + argv[idx + 2:]
    if len(argv) != 1:
        print(__doc__)
        return 2
    home = Path(argv[0])
    mem = home / "memory.sqlite3"
    if not mem.exists():
        print(f"no memory.sqlite3 under {home}", file=sys.stderr)
        return 1

    db = ro(mem)

    # -- 1. access-keyed recall surface ------------------------------------
    digest_rows = db.execute(
        "SELECT object, observed_at FROM triples WHERE predicate = 'dcterms:abstract'"
    ).fetchall()
    digests = [d for d, _at in digest_rows]
    act_marked = [d for d in digests if ACT_MARKER_RE.search(d or "")]
    keyed = [d for d in digests if KEY_RE.search(d or "")]
    print("== 1. access-keyed recall surface ==")
    print(f"digests total:            {len(digests)}")
    print(f"  with act markers:       {len(act_marked)}")
    print(f"  quoting a followable key: {len(keyed)}"
          f"  ({(100 * len(keyed) / len(digests)):.1f}% of digests)" if digests else "")
    if since:
        cohort = [d for d, at in digest_rows if str(at or "") > since]
        c_keyed = [d for d in cohort if KEY_RE.search(d or "")]
        pct = f" ({100 * len(c_keyed) / len(cohort):.1f}%)" if cohort else ""
        print(f"  since {since}: {len(c_keyed)} keyed of {len(cohort)} formed{pct}")

    # -- 2. distinct-title ratio -------------------------------------------
    # Titles ride attributes; the consolidation duplicate-title flags are the
    # symptom. Count via the maintenance candidates when present AND the raw
    # title attribute distribution when the schema carries one.
    dup_flags = [d for d in digests if "records carrying the same title" in (d or "")]
    print("\n== 2. duplicate-title collapse ==")
    if dup_flags:
        for d in sorted(set(dup_flags)):
            m = re.search(r"found (\d+) records carrying the same title \((\w+)\)", d)
            if m:
                print(f"  consolidation flag: {m.group(1)} records share one title ({m.group(2)})")
    else:
        print("  no duplicate-title consolidation flags in digests")

    # -- 3. tool palette by store attributes --------------------------------
    # tools_used rides attributes_json, NOT the digest text — the original
    # object-column query matched zero rows forever and only ever printed
    # the fallback note (adversary audit 2026-07-19, P0). Same layer law as
    # I1-I3: attributes are the evidence-grade column.
    window = f" (since {since})" if since else " (all-time)"
    print(f"\n== 3. tool palette (tools_used attributes = evidence layer){window} ==")
    intro: dict[str, int] = {}
    outward: dict[str, int] = {}
    tool_rows = db.execute(
        "SELECT attributes_json, observed_at FROM triples"
        " WHERE predicate = 'dcterms:abstract' AND attributes_json LIKE '%tools_used%'"
    ).fetchall()
    for attrs_json, observed_at in tool_rows:
        if since and str(observed_at or "") <= since:
            continue
        try:
            data = json.loads(attrs_json or "{}")
        except Exception:
            continue
        tools = data.get("tools_used") if isinstance(data, dict) else None
        if not isinstance(tools, list):
            continue
        for t in tools:
            name = str(t).strip()
            bucket = intro if name in INTROSPECTIVE else outward
            bucket[name] = bucket.get(name, 0) + 1
    if not tool_rows:
        print("  (no tools_used attributes in the store — own_time.log /")
        print("   loop_spend.json reads remain the fallback)")
    if intro:
        print(f"  introspective: {sum(intro.values())}  {dict(sorted(intro.items()))}")
    if outward:
        print(f"  outward:       {sum(outward.values())}  {dict(sorted(outward.items()))}")

    # Prose tool mentions (the dishonest layer — should trend to zero as the
    # machine-carried field lands):
    prose_mentions = db.execute(
        "SELECT count(*) FROM triples WHERE object LIKE '%[used tool%'"
    ).fetchone()[0]
    print(f"  prose-only '[used tool …]' mentions in digests: {prose_mentions}")

    # -- I1..I3 evolution indicators -----------------------------------------
    # Layer honesty: kind rides attributes_json (never a predicate — the
    # c3113 LIKE-probe error class); selection rides memj_selected_counts
    # keyed on the digest row's assertion_id; closures/valence ride their
    # journal tables. All pure reads.
    rows = db.execute(
        "SELECT assertion_id, subject, object, attributes_json, observed_at FROM triples"
        " WHERE predicate = 'dcterms:abstract'"
    ).fetchall()
    attrs_by_row = []
    at_by_row: dict[str, str] = {}
    for aid, subj, obj, attrs_json, observed_at in rows:
        try:
            attrs = json.loads(attrs_json or "{}")
        except Exception:
            attrs = {}
        attrs_by_row.append((aid, subj, obj or "", attrs))
        at_by_row[aid] = str(observed_at or "")

    # I1 — question/problem closure + verbatim duplicates.
    resolved_refs: set[str] = set()
    for _aid, _subj, _obj, attrs in attrs_by_row:
        for ref_attr in ("answers", "resolves"):
            ref = attrs.get(ref_attr)
            if isinstance(ref, str) and ref.strip():
                resolved_refs.add(ref.strip())
    print("\n== I1. question/problem closure ==")
    for dtype in ("question", "problem"):
        open_n = res_n = 0
        texts: dict[str, int] = {}
        for _aid, subj, obj, attrs in attrs_by_row:
            if attrs.get("record_kind") != "diary" or attrs.get("diary_type") != dtype:
                continue
            refs = {subj, str(attrs.get("entry_id") or "").strip()} - {""}
            if refs & resolved_refs:
                res_n += 1
            else:
                open_n += 1
            # Verbatim-duplicate detection on the digest text (re-asks that
            # should have merged; the adversary's dedup axis).
            key = " ".join(obj.split()).lower()
            texts[key] = texts.get(key, 0) + 1
        dups = sum(n for n in texts.values() if n > 1)
        print(f"  {dtype}s: open={open_n} resolved={res_n}"
              f"  verbatim-duplicate digests: {dups}")

    # I2 — write->read per evolved kind. All-time AND (when --since given)
    # the post-cut cohort: append-only stores keep unreachable-by-construction
    # cohorts in the all-time denominator forever, so a landed fix can only
    # move the cohort formed after it (the dream-digest lesson, c3155).
    selected_ids = {r[0] for r in db.execute("SELECT record_id FROM memj_selected_counts")}
    print("\n== I2. write->read per evolved kind ==")
    for kind in ("lesson", "world_model", "dream"):
        formed = [aid for aid, _s, _o, attrs in attrs_by_row if attrs.get("record_kind") == kind]
        read = sum(1 for aid in formed if aid in selected_ids)
        line = f"  {kind}: formed={len(formed)} ever-selected={read}"
        if since:
            cohort = [aid for aid in formed if at_by_row.get(aid, "") > since]
            cohort_read = sum(1 for aid in cohort if aid in selected_ids)
            line += f"  | since {since}: formed={len(cohort)} selected={cohort_read}"
        print(line)

    # I3 — felt-subject coverage + entity-driven closures.
    felt = {
        str(r[0]) for r in db.execute("SELECT DISTINCT target_id FROM memj_valence")
        if ":" in str(r[0]) and not str(r[0]).startswith(("ex:", "diary"))
    }
    carded = {
        str(attrs.get("target") or "").strip()
        for _aid, _s, _o, attrs in attrs_by_row
        if attrs.get("record_kind") == "world_model"
    } - {""}
    covered = felt & carded
    closures = dict(db.execute("SELECT actor, count(*) FROM memj_closures GROUP BY actor"))
    entity_closures = sum(n for actor, n in closures.items() if str(actor) != "system")
    print("\n== I3. felt-subject coverage + closure agency ==")
    print(f"  felt subjects (free-string valence targets): {len(felt)}")
    print(f"  with a world_model card: {len(covered)}  {sorted(covered)}")
    print(f"  uncovered: {sorted(felt - carded)}")
    print(f"  closures: total={sum(closures.values())} entity-driven={entity_closures}"
          f"  (by actor: {dict(sorted(closures.items()))})")

    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
