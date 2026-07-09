#!/usr/bin/env python3
"""Export ANY entity home's replay stream to NDJSON (pure read).

Unlike export_demo_entity.py (which scripts a synthetic life), this opens a
REAL home directory — e.g. one created by `abstractgateway entity create` or
the runtime chat driver's smoke homes — and dumps the frozen stream v1
verbatim via `abstractmemory.export_replay`. If the gateway recorded host
markers for the entity (`<entities_dir>/.host_stream/<slug>.jsonl`), they are
merged at their fractional positions exactly like the serving end does.

Usage:
    python export_home_stream.py <home_dir> [--out life.ndjson]

The home is opened read-only in effect: export_replay is a pure read and
nothing is written back (renders are pure reads — observer charter).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from abstractmemory import MemorySystem, SQLiteJournal, SQLiteTripleStore


def read_host_markers(home_dir: Path) -> List[Dict[str, Any]]:
    """Gateway host markers live OUTSIDE the home (entities/.host_stream/);
    present only for gateway-managed homes. Home-direct sessions (e.g. the
    runtime chat driver) have none — a documented standing gap, not loss."""
    slug = home_dir.name
    path = home_dir.parent / ".host_stream" / f"{slug}.jsonl"
    if not path.exists():
        return []
    markers: List[Dict[str, Any]] = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            markers.append(json.loads(line))
        except ValueError as e:
            print(f"#FALLBACK: unreadable host marker line {i + 1}: {e}", file=sys.stderr)
    markers.sort(key=lambda m: float(m.get("seq") or 0.0))
    return markers


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("home_dir", type=Path, help="Entity home directory (contains memory.sqlite3)")
    parser.add_argument("--out", type=Path, default=None, help="Output NDJSON path (default: <slug>.ndjson)")
    args = parser.parse_args()

    home_dir: Path = args.home_dir.expanduser().resolve()
    db = home_dir / "memory.sqlite3"
    if not db.exists():
        raise SystemExit(f"not an entity home (no memory.sqlite3): {home_dir}")
    out: Path = args.out if args.out is not None else Path(f"{home_dir.name}.ndjson")

    store = SQLiteTripleStore(db)
    journal = SQLiteJournal(db)
    ms = MemorySystem(store=store, journal=journal)
    try:
        envelopes = list(ms.export_replay())
    finally:
        ms.close()

    markers = read_host_markers(home_dir)
    merged: List[Dict[str, Any]] = []
    m_idx = 0
    for env in envelopes:
        seq = float(env["seq"])
        while m_idx < len(markers) and float(markers[m_idx]["seq"]) < seq:
            merged.append(markers[m_idx])
            m_idx += 1
        merged.append(env)
    merged.extend(markers[m_idx:])

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for env in merged:
            f.write(json.dumps(env, ensure_ascii=False) + "\n")

    families: Dict[str, int] = {}
    for env in merged:
        families[env["family"]] = families.get(env["family"], 0) + 1
    print(f"wrote {len(merged)} envelopes to {out}")
    print(f"families: {json.dumps(families, sort_keys=True)}")


if __name__ == "__main__":
    main()
