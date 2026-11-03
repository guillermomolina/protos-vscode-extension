#!/usr/bin/env python3
import json
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise RuntimeError("Expected D237 Signature Help result.json")

data = json.loads(
    Path(sys.argv[1]).read_text(encoding="utf-8")
)

expected = {
    "named-reordered-third": ("(first, second, third)", 2),
    "named-mixed-first-positional": ("(first, second, third)", 0),
    "named-mixed-second-positional": ("(first, second, third)", 1),
    "named-grouped-positional-slot": ("(first, second)", 0),
    "named-utf16-crlf": ("(first, second, third)", 2),
}

if data.get("status") != "pass":
    raise RuntimeError(
        "D237 Signature Help failed: " + str(data.get("error"))
    )

if data.get("kind") != "named-signatures":
    raise RuntimeError("Wrong D237 acceptance kind")

if data.get("realRuntime") is not True:
    raise RuntimeError("D237 requires real released runtime")

rows = data.get("cases")

if not isinstance(rows, list):
    raise RuntimeError("Missing D237 Signature Help cases")

ids = [row.get("id") for row in rows]

if len(ids) != len(set(ids)) or set(ids) != set(expected):
    raise RuntimeError("D237 Signature Help case coverage mismatch")

for row in rows:
    label, parameter = expected[row["id"]]

    if row.get("status") != "PASS":
        raise RuntimeError("D237 case did not pass: " + str(row))

    if row.get("signatureLabel") != label:
        raise RuntimeError("Wrong formal signature: " + row["id"])

    if type(row.get("activeParameter")) is not int:
        raise RuntimeError("Missing activeParameter: " + row["id"])

    if row["activeParameter"] != parameter:
        raise RuntimeError("Wrong activeParameter: " + row["id"])

    position = row.get("position")

    if (
        not isinstance(position, list)
        or len(position) != 2
        or any(type(value) is not int or value < 0 for value in position)
    ):
        raise RuntimeError("Invalid UTF-16 position: " + row["id"])

    if (
        type(row.get("documentVersion")) is not int
        or row["documentVersion"] < 1
    ):
        raise RuntimeError("Missing document version: " + row["id"])

    if row["id"] == "named-utf16-crlf" and position != [1, 42]:
        raise RuntimeError("D237 UTF-16/CRLF position mismatch")

print("CI002_D237_INSTALLED_VSIX_SIGNATURE_HELP=PASS")
print("CI002_D237_SIGNATURE_CASE_COUNT=" + str(len(rows)))
