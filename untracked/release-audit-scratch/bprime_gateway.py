#!/usr/bin/env python3
"""(b') measurement: which of observer's gateway paths exist in the PUBLISHED
abstractgateway 0.2.28 wheel, versus in gateway's source tree.

Method (same as observer.md §8's (b), applied twice): every /api/gateway/...
literal in abstractobserver/src, template segments normalized to {} and query
strings dropped, diffed against a route table built from every
@router.<verb>("...") decorator with its APIRouter prefix and its
include_router mount prefix — once against abstractgateway/src, once against
the abstractgateway 0.2.28 package installed in a venv.
"""
import re
import sys
from pathlib import Path

OBS = Path("/Users/albou/tmp/abstractframework/abstractobserver/src")
GW_SRC = Path("/Users/albou/tmp/abstractframework/abstractgateway/src/abstractgateway")
GW_PUB = Path(
    "/Users/albou/tmp/abstractframework/abstractcode/untracked/audit-logs/gw028/"
    ".venv/lib/python3.12/site-packages/abstractgateway"
)


def scan_literal(line: str, start: int) -> str:
    """Read the path literal beginning at `start`, normalizing ${...} to {} and
    stopping at the query string or the end of the literal."""
    out = []
    i = start
    n = len(line)
    while i < n:
        c = line[i]
        if c in "\"'`":
            break
        if c == "?":
            break
        if c == "$" and i + 1 < n and line[i + 1] == "{":
            depth = 0
            j = i + 1
            while j < n:
                if line[j] == "{":
                    depth += 1
                elif line[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            out.append("{}")
            i = j + 1
            continue
        if c in " ,)":
            break
        out.append(c)
        i += 1
    return "".join(out).rstrip("/")


def observer_paths():
    out = {}
    for f in sorted(OBS.rglob("*")):
        if f.suffix not in (".ts", ".tsx") or not f.is_file():
            continue
        if f.name.endswith(".test.ts") or f.name.endswith(".test.tsx"):
            continue
        for i, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
            for m in re.finditer(r"/api/gateway", line):
                p = scan_literal(line, m.start())
                if p and p != "/api/gateway":
                    out.setdefault(p, []).append(f"{f.relative_to(OBS.parent)}:{i}")
    return out


DECOR_RE = re.compile(
    r"@(\w+)\.(get|post|put|patch|delete|head|options)\(\s*[\"']([^\"']+)[\"']"
)
ROUTER_RE = re.compile(r"(\w+)\s*=\s*APIRouter\(([^)]*)\)", re.S)
PREFIX_RE = re.compile(r"prefix\s*=\s*[\"']([^\"']+)[\"']")
INCLUDE_RE = re.compile(
    r"include_router\(\s*([\w\.]+)\s*(?:,\s*prefix\s*=\s*[\"']([^\"']+)[\"'])?", re.S
)
IMPORT_RE = re.compile(r"from\s+[\w\.]*routes[\.\s]+(?:import\s+)?(\w+)?")


def route_table(root: Path):
    if not root.exists():
        sys.exit(f"missing tree: {root}")
    files = list(root.rglob("*.py"))
    # router variable -> prefix, per file
    router_prefix = {}
    for f in files:
        txt = f.read_text(errors="ignore")
        for m in ROUTER_RE.finditer(txt):
            pm = PREFIX_RE.search(m.group(2))
            router_prefix[(f, m.group(1))] = pm.group(1) if pm else ""
    # module stem -> mount prefixes used by include_router (alias-aware)
    mount = {}
    for f in files:
        txt = f.read_text(errors="ignore")
        # map alias -> module stem from `from .routes.X import router as Y`
        alias = {}
        for m in re.finditer(
            r"from\s+[\.\w]*routes\.(\w+)\s+import\s+router\s+as\s+(\w+)", txt
        ):
            alias[m.group(2)] = m.group(1)
        for m in re.finditer(r"from\s+[\.\w]*routes\s+import\s+([\w,\s]+)", txt):
            for part in m.group(1).split(","):
                part = part.strip()
                if part:
                    alias[part] = part
        for m in INCLUDE_RE.finditer(txt):
            target, pref = m.group(1), m.group(2) or ""
            stem = alias.get(target, target.split(".")[0])
            mount.setdefault(stem, set()).add(pref)
    routes = set()
    for f in files:
        txt = f.read_text(errors="ignore")
        mounts = mount.get(f.stem, {""}) or {""}
        for m in DECOR_RE.finditer(txt):
            var, path = m.group(1), m.group(3)
            pfx = router_prefix.get((f, var), "")
            for mt in mounts:
                routes.add((mt + pfx + path).rstrip("/"))
    return routes


def canon(p: str) -> str:
    """Param names differ between caller and route; compare shapes."""
    return re.sub(r"\{[^}]*\}", "{}", p).rstrip("/")


def main():
    obs = observer_paths()
    src = {canon(r) for r in route_table(GW_SRC)}
    pub = {canon(r) for r in route_table(GW_PUB)}
    print(f"observer distinct gateway paths : {len(obs)}")
    print(f"gateway SOURCE route table      : {len(src)}")
    print(f"gateway 0.2.28 route table      : {len(pub)}")

    in_src = {p for p in obs if canon(p) in src}
    in_pub = {p for p in obs if canon(p) in pub}
    print(f"\n(b)  present in gateway SOURCE      : {len(in_src)}/{len(obs)}")
    print(f"(b') present in PUBLISHED 0.2.28    : {len(in_pub)}/{len(obs)}")

    print("\n--- IN SOURCE, ABSENT from published 0.2.28 ---")
    for p in sorted(in_src - in_pub):
        print(f"  {p}\n      {obs[p][0]}")
    print("\n--- ABSENT from BOTH ---")
    for p in sorted(set(obs) - in_src - in_pub):
        print(f"  {p}\n      {obs[p][0]}")


if __name__ == "__main__":
    main()
