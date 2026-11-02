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
    "status": "pass",
    "extensionFound": True,
    "extensionActivated": True,
    "languageId": "protos",
    "runtimeConfigured": True,
    "runCommandRegistered": True,
    "taskStarted": True,
    "taskProcessExitCode": 0,
    "ci002RunInvocationMatched": True,
}

for key, value in expected.items():
    actual = data.get(key)
    if type(actual) is not type(value) or actual != value:
        raise RuntimeError(
            f"CI002_RUN_FAILED: {key}={actual!r}, "
            f"expected {value!r}"
        )

if data.get("error") is not None:
    raise RuntimeError("CI002 run reported an error")

print("CI002_INSTALLED_VSIX_RUN=PASS")
print("CI002_RUNTIME_AND_SOURCE_MATCH=PASS")
print("CI002_ASSERTION_PROGRAM_EXIT_CODE=0")
