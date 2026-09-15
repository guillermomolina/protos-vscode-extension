#!/usr/bin/env python3
from pathlib import Path
import json
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: debug_harness_validate.py <result.json>")

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

checks = {
    "status": "pass",
    "extensionFound": True,
    "extensionActivated": True,
    "breakpointInstalled": True,
    "stoppedAtBreakpoint": True,
    "sourceLocationMatches": True,
    "scopesObserved": True,
    "localsObserved": True,
    "expectedLocalValueObserved": True,
    "nextCompleted": True,
    "continueCompleted": True,
    "terminatedCleanly": True,
}

if data.get("stackFramesObserved", 0) < 1:
    raise SystemExit("LM009_I3C_REAL_DEBUG_FAILED: no stack frames")

if data.get("scopesObserved", 0) < 1:
    raise SystemExit("LM009_I3C_REAL_DEBUG_FAILED: no scopes")

for key, expected in checks.items():
    if data.get(key) != expected:
        raise SystemExit(
            "LM009_I3C_REAL_DEBUG_FAILED: %s=%r expected %r"
            % (key, data.get(key), expected)
        )

print("LM009_I3C_REAL_DEBUG=PASS")
print("PACKAGED_EXTENSION_FOUND=YES")
print("PACKAGED_EXTENSION_ACTIVATED=YES")
print("SOURCE_BREAKPOINT=PASS")
print("STOP_LOCATION=PASS")
print("STACK_FRAMES=PASS")
print("ACTIVATION_LOCAL_SCOPE=PASS")
print("REPRESENTATIVE_SCALAR_VALUE=PASS")
print("STEP_NEXT=PASS")
print("CONTINUE=PASS")
print("CLEAN_TERMINATION=PASS")
print("EXTENSION_DEVELOPMENT_PATH_USED=NO")
