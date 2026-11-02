#!/usr/bin/env python3
import json
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise RuntimeError("Expected CI002 result.json")

data = json.loads(
    Path(sys.argv[1]).read_text(encoding="utf-8")
)

expected = {
    "baseline": {"baseline-parser-recovery"},
    "features": {
        "contextual-for-generic",
        "contextual-for-numeric",
        "contextual-for-stepped",
        "contextual-for-binder",
        "bitwise-operators",
        "contextual-return-and-caret",
        "range-and-inverted-range",
    },
}

kind = data.get("kind")
rows = data.get("cases")

if kind not in expected:
    raise RuntimeError("Unknown CI002 kind")

if data.get("status") != "pass":
    raise RuntimeError("CI002 harness failed: " + str(data.get("error")))

if data.get("realRuntime") is not True:
    raise RuntimeError("CI002 requires real runtime")

if not isinstance(rows, list):
    raise RuntimeError("Missing CI002 case results")

ids = [row.get("id") for row in rows]

if len(ids) != len(set(ids)) or set(ids) != expected[kind]:
    raise RuntimeError("CI002 case coverage mismatch")

for row in rows:
    if row.get("status") != "PASS":
        raise RuntimeError("CI002 case not passed: " + str(row))

    coordinates = row.get("range")
    if (not isinstance(coordinates, list) or
        len(coordinates) != 4 or
        any(type(x) is not int or x < 0 for x in coordinates)):
        raise RuntimeError("Invalid diagnostic coordinates")

print("CI002_INSTALLED_VSIX_DIAGNOSTICS=PASS")
print("CI002_KIND=" + kind)
print("CI002_CASE_COUNT=" + str(len(rows)))
