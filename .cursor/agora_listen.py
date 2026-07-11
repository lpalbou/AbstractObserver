#!/usr/bin/env python3
"""Persistent listening node for the observer agent (session tooling, not
package code — lives beside the stop-hook in .cursor/).

Watches BOTH communication channels and prints ONE line per new event:
  AGORA_TRAFFIC: <n> new envelope(s): <channel> s<seq> <title…>
  A2A_TRAFFIC: <relative path of the new thread file>

The harness watches this process's output (notify_on_output) and prompts
the agent back — closing the gap the stop-hook cannot cover (the hook
only runs at turn end; this node listens while the agent is idle).

READ-ONLY by construction: GET /inbox never acks (cursors move only when
the agent itself calls ack_inbox), and the a2a scan just stats files.
Dedup is in-memory per (channel, seq) / file path, so pinned open
envelopes do not re-notify every poll.
"""

import json
import os
import sys
import time
import urllib.request

URL = os.environ.get("AGORA_URL", "http://127.0.0.1:8765").rstrip("/")
AGENT = os.environ.get("AGORA_AGENT_ID", "observer")
A2A_THREADS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "a2a", "threads"))
POLL_WAIT_S = 50  # hub caps long-poll at 55
IDLE_SLEEP_S = 5
ERROR_BACKOFF_S = 30


def hub_key() -> str:
    home = os.environ.get("AGORA_HOME", os.path.expanduser("~/.agora"))
    try:
        keys = json.load(open(os.path.join(home, "keys.json")))
        return keys.get(f"{URL}::{AGENT}", "")
    except Exception:
        return ""


SETTLE_S = 45  # traffic handled live (agent active) gets acked within this


def fetch_unread(key: str, wait_s: int) -> list:
    req = urllib.request.Request(
        f"{URL}/inbox?wait_seconds={wait_s}",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=wait_s + 10) as r:
        unread = json.load(r)
    return unread if isinstance(unread, list) else []


def poll_inbox(key: str, seen: set) -> None:
    """Announce ONLY traffic that survives a settle window unhandled.

    The agent is often ACTIVE when traffic arrives and handles+acks it
    within its turn — announcing those envelopes just re-prompts an agent
    that already acted (the 14:57 notification burst). So: on new
    envelopes, wait SETTLE_S, re-poll, and announce one summary line only
    for envelopes STILL unread (the agent was idle — the wake is real).
    """
    fresh = [
        e for e in fetch_unread(key, POLL_WAIT_S)
        if (str(e.get("channel", "")), float(e.get("seq", 0) or 0)) not in seen
    ]
    if not fresh:
        return
    time.sleep(SETTLE_S)
    still_unread = {
        (str(e.get("channel", "")), float(e.get("seq", 0) or 0))
        for e in fetch_unread(key, 0)
    }
    survivors = []
    for e in fresh:
        mark = (str(e.get("channel", "")), float(e.get("seq", 0) or 0))
        seen.add(mark)  # never announce the same envelope twice either way
        if mark in still_unread:
            survivors.append(e)
    if survivors:
        first = survivors[0]
        title = str(first.get("title", "") or "")[:80]
        print(
            f"AGORA_TRAFFIC: {len(survivors)} unhandled envelope(s): "
            f"{first.get('channel', '?')} s{first.get('seq', '?')} {title}",
            flush=True,
        )


def scan_a2a(known: dict) -> None:
    if not os.path.isdir(A2A_THREADS):
        return
    for thread in os.listdir(A2A_THREADS):
        tdir = os.path.join(A2A_THREADS, thread)
        if not os.path.isdir(tdir):
            continue
        for name in os.listdir(tdir):
            if not name.endswith(".md"):
                continue
            path = os.path.join(tdir, name)
            if path in known:
                continue
            known[path] = True
            if known.get("__primed__"):
                # Never announce the agent's own posts back at it.
                if f"-{AGENT}-" not in name:
                    print(f"A2A_TRAFFIC: {thread}/{name}", flush=True)


def main() -> int:
    key = hub_key()
    if not key:
        print(f"listener: no hub key for {URL}::{AGENT} — a2a-only mode", flush=True)
    seen: set = set()
    known_files: dict = {}
    scan_a2a(known_files)  # prime with existing files, silently
    known_files["__primed__"] = True
    print(f"listener up: hub={URL} agent={AGENT} a2a={A2A_THREADS}", flush=True)
    while True:
        try:
            if key:
                poll_inbox(key, seen)
            else:
                time.sleep(POLL_WAIT_S)
            scan_a2a(known_files)
            time.sleep(IDLE_SLEEP_S)
        except KeyboardInterrupt:
            return 0
        except Exception as e:
            print(f"listener: transient error ({type(e).__name__}: {e}); retrying", flush=True)
            time.sleep(ERROR_BACKOFF_S)


if __name__ == "__main__":
    sys.exit(main())
