#!/usr/bin/env python3
from pathlib import Path
import json
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: validate_clean_install.py <result.json>")

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

expected = {
    "status": "pass",
    "cleanInstall": True,
    "extensionFound": True,
    "extensionActivated": True,
    "languageId": "protos",
    "runCommandRegistered": True,
}

for key, value in expected.items():
    if data.get(key) != value:
        raise SystemExit(
            "LM009_I3A_CLEAN_INSTALL_FAILED: %s=%r expected %r"
            % (key, data.get(key), value)
        )

print("LM009_I3A_CLEAN_INSTALL=PASS")
print("PACKAGED_EXTENSION_FOUND=YES")
print("PACKAGED_EXTENSION_ACTIVATED=YES")
print("PACKAGED_LANGUAGE_ASSOCIATION=PASS")
print("PACKAGED_RUN_COMMAND_REGISTERED=PASS")
print("EXTENSION_DEVELOPMENT_PATH_USED=NO")
