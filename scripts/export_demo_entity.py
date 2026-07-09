#!/usr/bin/env python3
"""Export a real entity life as replay-stream NDJSON demo data.

WHY THIS EXISTS: the observer's entity memory view renders the frozen
replay stream v1 (a2a thread 0005). The honest demo dataset is not a
hand-written fixture but a REAL life: this script replays the keystone
re-adoption pattern (abstractruntime/tests/test_readoption_experiment.py)
against a real SQLite entity home — engram, honest work turns
(form -> recall -> commit only what was rendered), elected diary writes,
appraisals with standing peaks (scar/bond), a healing, a belief revision
(supersede) — across THREE sessions with full process-equivalent
re-summons, then dumps `abstractmemory.export_replay(...)` verbatim.

Host markers (family="host") are interleaved at fractional seq positions
exactly as the gateway serving end assigns them (`base + n/1000`, base =
journal high-water at write time) so the view exercises summon moments.

Usage:
    .venv/bin/python abstractobserver/scripts/export_demo_entity.py \
        [--out abstractobserver/public/demo/castor.ndjson]

Pure demo-data generation: writes only to a temp dir + the output file.
"""

from __future__ import annotations

import argparse
import copy
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

from abstractruntime.core.models import Effect, EffectType
from abstractruntime.identity import DiaryStore, build_diary_effect_handlers
from abstractruntime.integrations.abstractmemory import build_memory_seam_effect_handlers
from abstractruntime.storage.sqlite import SqliteDatabase, SqliteLedgerStore

from abstractmemory import (
    DEFAULT_SPARK_TEMPLATE,
    MemorySystem,
    SQLiteJournal,
    SQLiteTripleStore,
    engram,
    lint_spark,
)
from abstractmemory.replay import REPLAY_STREAM, REPLAY_STREAM_VERSION

ENTITY_NAME = "Castor"
ENTITY_ID = "entity:castor@demo-home"
SELF_SCOPE = ("self", ENTITY_ID)
DIARY_SCOPE = ("diary", ENTITY_ID)
LIFE_SCOPE = ("life", ENTITY_ID)
LADDER = [list(SELF_SCOPE), list(DIARY_SCOPE), list(LIFE_SCOPE)]

# The summon posture: identity present by right (self_fraction > 0).
WORK_BUDGET = {"token_budget": 400, "shelf_size": 8, "self_fraction": 0.5}


class _CounterClock:
    """Deterministic strictly-increasing ISO stamps (stable demo renders)."""

    def __init__(self) -> None:
        self._n = 0

    def __call__(self) -> str:
        self._n += 1
        return f"2026-07-06T10:{self._n // 60:02d}:{self._n % 60:02d}+00:00"


class _Run:
    session_id = None
    actor_id = None

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id


@dataclass
class Home:
    ms: Any
    store: Any
    journal: Any
    diary: DiaryStore
    handlers: Dict[EffectType, Any]

    def close(self) -> None:
        for obj in (self.store, self.journal):
            close = getattr(obj, "close", None)
            if callable(close):
                close()


def open_home(home_dir: Path, clock: _CounterClock) -> Home:
    db = home_dir / "memory.sqlite3"  # ONE memory file: store + journal, one seq axis
    store = SQLiteTripleStore(db)
    journal = SQLiteJournal(db)
    ms = MemorySystem(store=store, journal=journal)
    ledger = SqliteLedgerStore(SqliteDatabase(str(home_dir / "home.sqlite3")))
    diary = DiaryStore(entity_id=ENTITY_ID, ledger_store=ledger)
    handlers = {
        **build_memory_seam_effect_handlers(memory_system=ms, run_store=None, now_iso=clock),
        **build_diary_effect_handlers(entity_id=ENTITY_ID, diary_store=diary, memory_system=ms, now_iso=clock),
    }
    return Home(ms=ms, store=store, journal=journal, diary=diary, handlers=handlers)


class Session:
    """The keystone's honest-turn harness: form -> recall -> commit rendered."""

    def __init__(self, home: Home, run_id: str) -> None:
        self.home = home
        self.run = _Run(run_id)

    def effect(self, etype: EffectType, payload: Dict[str, Any]) -> Dict[str, Any]:
        out = self.home.handlers[etype](self.run, Effect(type=etype, payload=payload), None)
        assert out.status == "completed", f"{etype.value} failed: {getattr(out, 'error', None)}"
        return out.result

    def form(self, turn_id: str, record: Dict[str, Any]) -> List[str]:
        rec = dict(record)
        rec.setdefault("kind", "memory")
        result = self.effect(
            EffectType.MEMORY_FORM,
            {"records": [rec], "scope": LIFE_SCOPE[0], "owner_id": LIFE_SCOPE[1], "turn_id": turn_id},
        )
        return list(result["record_ids"])

    def recall(self, cue: str, turn_id: str, **over: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "cue_text": cue,
            "scopes": LADDER,
            "view": "working_set",
            "turn_id": turn_id,
            "budget": dict(WORK_BUDGET),
        }
        payload.update(over)
        return self.effect(EffectType.MEMORY_RECALL, payload)

    def commit(self, result: Dict[str, Any], token_budget: int = 400) -> List[Dict[str, Any]]:
        rendered: List[Dict[str, Any]] = []
        used = 0
        for h in result["handles"]:
            cost = int(h.get("token_estimate") or 0)
            if used + cost > token_budget:
                continue
            rendered.append(h)
            used += cost
        ids = [h["record_id"] for h in rendered]
        if ids:
            self.effect(
                EffectType.MEMORY_ACCESS,
                {
                    "trace_id": result["trace_id"],
                    "used_record_ids": ids,
                    "prompt_token_estimate": used,
                },
            )
        return rendered

    def turn(self, turn_id: str, record: Dict[str, Any], cue: str) -> List[str]:
        formed = self.form(turn_id, record)
        self.commit(self.recall(cue, turn_id))
        return formed

    def recall_turn(self, turn_id: str, cue: str) -> None:
        self.commit(self.recall(cue, turn_id))

    def diary_write(self, turn_id: str, **payload: Any) -> Dict[str, Any]:
        body = {"turn_id": turn_id, "as_of_seq": self.home.ms.current_seq()}
        body.update(payload)
        return self.effect(EffectType.DIARY_WRITE, body)

    def appraise(self, turn_id: str, target: str, *, sign: int, magnitude: float, reason: str, **over: Any) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "target_id": target,
            "sign": sign,
            "magnitude": magnitude,
            "reason": reason,
            "turn_id": turn_id,
            "scope": SELF_SCOPE[0],
            "owner_id": SELF_SCOPE[1],
        }
        body.update(over)
        return self.effect(EffectType.MEMORY_APPRAISE, body)


def host_marker(ms: MemorySystem, markers: List[Dict[str, Any]], kind: str, session_id: str, clock: _CounterClock, **details: Any) -> None:
    """One gateway-shaped host marker at the current journal high-water.

    Mirrors abstractgateway/entity_replay.record_host_marker exactly:
    fractional seq = base + n/1000 where base is the journal seq at write
    time, envelope fields identical to memory's v1 (family="host").
    """
    base = int(ms.current_seq())
    at_base = sum(1 for m in markers if int(float(m["seq"])) == base)
    markers.append(
        {
            "stream": REPLAY_STREAM,
            "stream_version": REPLAY_STREAM_VERSION,
            "seq": base + (at_base + 1) / 1000.0,
            "family": "host",
            "observed_at": clock(),
            "scope": "",
            "owner_id": ENTITY_ID,
            "trace_id": None,
            "turn_id": None,
            "run_id": f"run-{session_id}",
            "payload": {"kind": kind, "session_id": session_id, **details},
        }
    )


def live_a_life(home_dir: Path, clock: _CounterClock) -> tuple:
    """Three sessions of one life; returns (host_markers, open_home_for_export).

    The final home is returned OPEN so the export reads the same store/journal
    objects; the caller closes it."""
    markers: List[Dict[str, Any]] = []
    spark = copy.deepcopy(dict(DEFAULT_SPARK_TEMPLATE))
    spark["name"] = ENTITY_NAME
    spark["spark"] = 1
    assert lint_spark(spark) == [], "demo spark must be lint-clean"

    # ---------------------------------------------- session 1: birth + work
    home = open_home(home_dir, clock)
    s1 = Session(home, "summon-s1")
    r1 = engram(home.ms, spark, owner_id=ENTITY_ID)
    assert r1.created is True
    host_marker(home.ms, markers, "summon", "summon-s1", clock, prelude_tokens=263)

    media_ids = s1.turn(
        "s1-t1",
        {
            "title": "media server",
            "digest": "media server runs jellyfin on port 8096 behind the caddy proxy",
            "keywords": ["jellyfin", "port", "media", "caddy"],
        },
        "set up the media server",
    )
    backup_ids = s1.turn(
        "s1-t2",
        {"title": "backups", "digest": "nightly restic backups to the nas at 0300", "keywords": ["backup", "restic", "nas"]},
        "backup schedule",
    )
    old_dns_ids = s1.turn(
        "s1-t3",
        {"title": "dns", "digest": "local dns is handled by pihole at 192.168.1.2", "keywords": ["pihole", "dns"]},
        "dns resolution",
    )
    # Structural edges make co-usage deposit Hebbian pair trails
    # (selection.py hop pairs) — the edges the observer's graph lights up.
    proxy_ids = s1.turn(
        "s1-t4",
        {
            "title": "reverse proxy",
            "digest": "caddy terminates tls and proxies jellyfin and the nas ui",
            "keywords": ["caddy", "proxy", "tls", "jellyfin"],
            "edges": [["routes_to", media_ids[0]]],
        },
        "how does the caddy proxy route to the media server",
    )
    s1.turn(
        "s1-t5",
        {
            "title": "nas storage",
            "digest": "the nas exports storage that backups and the media server both use",
            "keywords": ["nas", "storage", "backup", "media"],
            "edges": [["stores_for", backup_ids[0]], ["stores_for", media_ids[0]]],
        },
        "where do the nas backups and media files live",
    )

    s1.diary_write(
        "s1-d1",
        text="First day at the home lab. Set up the media server and it felt like the right call — quiet, fast, mine.",
        gist="First day at the home lab; the media server decision felt right.",
        kind="reflection",
    )
    s1.diary_write(
        "s1-d2",
        text="Backups succeed but are unverified. A weekly restore drill would turn hope into knowledge.",
        gist="Idea: automate backup verification with a weekly restore drill.",
        kind="idea",
    )
    s1.diary_write(
        "s1-d3",
        text="Some thoughts are only mine: the silverfin project stays unwritten anywhere else.",
        visibility="private",
    )
    s1.diary_write(
        "s1-d4",
        text="How long should backup retention be? Thirty days feels arbitrary; I want a reasoned answer.",
        gist="Open question: what is the right backup retention window?",
        kind="question",
    )

    s1.appraise("s1-a1", "tool:restic", sign=1, magnitude=1, reason="backup completed clean")
    s1.appraise("s1-a2", "tool:flaky_dns", sign=-1, magnitude=2, reason="dns flapped twice during setup")
    s1.appraise(
        "s1-a3",
        "person:maintainer",
        sign=1,
        magnitude=9,
        reason="trusted me with the home lab and the long project",
        bond=True,
        actor="entity-reflection",
    )
    s1.appraise("s1-a4", "concept:home-lab", sign=1, magnitude=1, reason="the work itself was a joy")

    host_marker(home.ms, markers, "session_closed", "summon-s1", clock)
    home.close()
    del home, s1

    # ------------------------------- session 2: re-summon, trouble, revision
    home2 = open_home(home_dir, clock)
    s2 = Session(home2, "summon-s2")
    r2 = engram(home2.ms, spark, owner_id=ENTITY_ID)
    assert r2.created is False, "re-summon must re-adopt, never re-create"
    host_marker(home2.ms, markers, "summon", "summon-s2", clock, prelude_tokens=311)

    # The re-adoption beat: session-1 experience recalled by cue after restart.
    s2.recall_turn("s2-t1", "which port is the jellyfin media server on")

    # The dns outage: a problem, a scar, and a belief revision.
    scar_result = s2.appraise(
        "s2-a1",
        "tool:flaky_dns",
        sign=-1,
        magnitude=8,
        reason="dns outage corrupted the nightly sync job",
        scar=True,
        actor="entity-reflection",
    )
    scar_event_id = next((e for e in scar_result["event_ids"] if e.endswith(":scar")), None)
    assert scar_event_id, f"scar marker id missing from {scar_result['event_ids']}"

    s2.diary_write(
        "s2-d1",
        text="The dns outage broke the nightly sync. Something is wrong with pihole under load and it needs fixing.",
        gist="Problem: pihole fails under load; nightly sync broke.",
        kind="problem",
    )

    new_dns_ids = s2.form(
        "s2-t2",
        {
            "title": "dns (revised)",
            "digest": "local dns migrated to unbound at 192.168.1.3 after the pihole outage",
            "keywords": ["unbound", "dns", "migration"],
            "edges": [["replaces", old_dns_ids[0]]],
        },
    )
    # Belief revision: the session-1 dns record is superseded by the new one
    # (close_record accepts the graph id remember_many returned).
    home2.ms.close_record(
        old_dns_ids[0],
        kind="supersede",
        replacement_ids=[new_dns_ids[0]],
        reason="dns migrated from pihole to unbound after the outage",
    )

    s2.recall_turn("s2-t3", "backup schedule for the nas")
    s2.appraise("s2-a2", "tool:restic", sign=1, magnitude=1, reason="restic restored the corrupted sync cleanly")

    host_marker(home2.ms, markers, "session_closed", "summon-s2", clock)
    home2.close()
    del home2, s2

    # ---------------------------------------- session 3: healing and growth
    home3 = open_home(home_dir, clock)
    s3 = Session(home3, "summon-s3")
    engram(home3.ms, spark, owner_id=ENTITY_ID)
    host_marker(home3.ms, markers, "summon", "summon-s3", clock, prelude_tokens=356)

    s3.recall_turn("s3-t1", "how is dns resolved now")
    s3.turn(
        "s3-t2",
        {
            "title": "restore drill",
            "digest": "weekly restore drill verified the restic backups end to end",
            "keywords": ["restore", "drill", "restic", "backup", "nas"],
            "edges": [["verifies", backup_ids[0]]],
        },
        "verify the backups with a restore drill",
    )
    s3.recall_turn("s3-t2b", "nas storage for the media server and backups")
    s3.recall_turn("s3-t2c", "caddy proxy in front of jellyfin")
    del proxy_ids  # formed for the edge topology; recalls above exercise it

    lesson_ids = s3.form(
        "s3-t3",
        {
            "title": "lesson: single points of failure",
            "digest": "lesson learned: dns was a single point of failure; critical services need a fallback resolver",
            "keywords": ["lesson", "dns", "resilience"],
            "edges": [["learned_from", new_dns_ids[0]]],
        },
    )
    s3.effect(
        EffectType.MEMORY_APPRAISE,
        {
            "op": "heal_scar",
            "scar_event_id": scar_event_id,
            "reason": "the outage became a lesson: fallback resolver deployed, sync verified",
            "lesson_record_id": lesson_ids[0],
            "scope": SELF_SCOPE[0],
            "owner_id": SELF_SCOPE[1],
            "turn_id": "s3-a1",
        },
    )
    s3.diary_write(
        "s3-d1",
        text="The dns problem is fixed: unbound with a fallback resolver, and the restore drill proves the backups. The outage taught me more than the setup did.",
        gist="Resolved the dns problem; the outage became a lesson.",
        kind="reflection",
    )
    s3.appraise("s3-a2", "concept:home-lab", sign=1, magnitude=1, reason="the lab survived its first real failure")
    s3.recall_turn("s3-t4", "jellyfin media server behind caddy")

    host_marker(home3.ms, markers, "session_closed", "summon-s3", clock)

    # The last home stays open for the export read; the caller closes it.
    return markers, home3


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    default_out = Path(__file__).resolve().parent.parent / "public" / "demo" / "castor.ndjson"
    parser.add_argument("--out", type=Path, default=default_out)
    args = parser.parse_args()

    clock = _CounterClock()
    with tempfile.TemporaryDirectory(prefix="castor_demo_home_") as tmp:
        markers, home = live_a_life(Path(tmp), clock)
        envelopes = list(home.ms.export_replay())
        home.close()

    # Merge host markers at their fractional positions (strict seq order).
    merged: List[Dict[str, Any]] = []
    m_idx = 0
    markers.sort(key=lambda m: float(m["seq"]))
    for env in envelopes:
        seq = float(env["seq"])
        while m_idx < len(markers) and float(markers[m_idx]["seq"]) < seq:
            merged.append(markers[m_idx])
            m_idx += 1
        merged.append(env)
    merged.extend(markers[m_idx:])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for env in merged:
            f.write(json.dumps(env, ensure_ascii=False) + "\n")

    families: Dict[str, int] = {}
    for env in merged:
        families[env["family"]] = families.get(env["family"], 0) + 1
    print(f"wrote {len(merged)} envelopes to {args.out}")
    print(f"families: {json.dumps(families, sort_keys=True)}")
    private_leak = sum(1 for env in merged if "silverfin" in json.dumps(env))
    print(f"private-token leak check (must be 0): {private_leak}")


if __name__ == "__main__":
    main()
