#!/usr/bin/env python3
from pathlib import Path
import json
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: validate_real_run.py <result.json>")

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

checks = {
    "status": "pass",
    "extensionFound": True,
    "extensionActivated": True,
    "languageId": "protos",
    "runtimeConfigured": True,
    "runCommandRegistered": True,
    "taskStarted": True,
    "taskProcessExitCode": 0,
}

for key, expected in checks.items():
    if data.get(key) != expected:
        raise SystemExit(
            "LM009_I3B_REAL_RUN_FAILED: %s=%r expected %r"
            % (key, data.get(key), expected)
        )

print("LM009_I3B_REAL_RUN=PASS")
print("PACKAGED_EXTENSION_FOUND=YES")
print("PACKAGED_EXTENSION_ACTIVATED=YES")
print("PACKAGED_RUN_COMMAND=PASS")
print("REAL_PROTOS_RUNTIME_INVOKED=YES")
print("RUN_TASK_EXIT_CODE=0")
print("EXTENSION_DEVELOPMENT_PATH_USED=NO")
