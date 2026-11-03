#!/usr/bin/env python3
import json
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise RuntimeError("Expected D237 formatter result.json")

data = json.loads(
    Path(sys.argv[1]).read_text(encoding="utf-8")
)

checks = {
    "status": "pass",
    "extensionFound": True,
    "extensionActivated": True,
    "languageId": "protos",
    "runtimeConfigured": True,
    "serverReady": True,
    "formatDocumentCommandCompleted": True,
    "formatDocumentResultExact": True,
    "unsavedBufferFormatting": True,
    "diskUnchangedDuringUnsavedFormatting": True,
    "formatOnSaveEnabled": True,
    "formatOnSaveResultExact": True,
    "diskContentCanonicalAfterSave": True,
    "extensionDevelopmentPathUsed": False,
    "testServerUsed": False,
    "realTool010Runtime": True,
    "independentTypescriptFormatter": False,
    "ci002NamedFormatter": True,
    "namedIdempotentFormatDocument": True,
    "namedIdempotentFormatOnSave": True,
    "namedLabelsPreserved": True,
}

for key, expected in checks.items():
    actual = data.get(key)

    if type(actual) is not type(expected) or actual != expected:
        raise RuntimeError(
            "CI002_D237_FORMAT_FAILED: "
            f"{key}={actual!r} expected {expected!r}"
        )

if data.get("error") is not None:
    raise RuntimeError("D237 formatter reported an error")

print("CI002_D237_INSTALLED_VSIX_FORMAT=PASS")
print("CI002_D237_FORMAT_DOCUMENT=PASS")
print("CI002_D237_FORMAT_ON_SAVE=PASS")
print("CI002_D237_FORMAT_IDEMPOTENCE=PASS")
print("CI002_D237_NAMED_LABEL_PRESERVATION=PASS")
