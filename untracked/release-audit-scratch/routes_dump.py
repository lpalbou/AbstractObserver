#!/usr/bin/env python3
"""Dump the REAL route table of whichever abstractgateway is importable.

Materializes the lazy `_IncludedRouter` wrappers by reading each one's
original_router plus its include prefix, so the table is what the app would
actually serve rather than what a decorator grep suggests.
"""
import json
import sys

from abstractgateway.app import app  # noqa: E402

paths = set()
for x in app.routes:
    if type(x).__name__ == "_IncludedRouter":
        prefix = getattr(x.include_context, "prefix", "") or ""
        for r in x.original_router.routes:
            paths.add(prefix + r.path)
    else:
        p = getattr(x, "path", None)
        if p:
            paths.add(p)

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/routes.json"
with open(out, "w") as fh:
    json.dump(sorted(paths), fh, indent=1)
import abstractgateway  # noqa: E402

print(f"{abstractgateway.__file__} -> {len(paths)} paths -> {out}")
