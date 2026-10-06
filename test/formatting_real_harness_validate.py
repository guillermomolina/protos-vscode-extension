#!/usr/bin/env python3

from pathlib import Path
import json
import sys


if len(sys.argv) != 2:
    raise RuntimeError(
        "usage: formatting_real_harness_validate.py "
        "<result.json>"
    )

data = json.loads(
    Path(sys.argv[1]).read_text(
        encoding="utf-8"
    )
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
}

for key, expected in checks.items():
    actual = data.get(key)

    if actual != expected:
        raise RuntimeError(
            "LM011_E_REAL_FORMATTING_FAILED: "
            "%s=%r expected %r"
            % (
                key,
                actual,
                expected,
            )
        )

print(
    "LM011_E_INSTALLED_PACKAGED_EXTENSION=PASS"
)
print(
    "LM011_E_FORMAT_DOCUMENT=PASS"
)
print(
    "LM011_E_UNSAVED_BUFFER_FORMATTING=PASS"
)
print(
    "LM011_E_FORMAT_ON_SAVE=PASS"
)
print(
    "LM011_E_DISK_CONTENT_CANONICAL_AFTER_SAVE=PASS"
)
print(
    "EXTENSION_DEVELOPMENT_PATH_USED=NO"
)
print(
    "TEST_SERVER_RUNTIME_FOR_FINAL_E2E=NO"
)
print(
    "REAL_TOOL010_RUNTIME=YES"
)
print(
    "PRODUCT_TYPESCRIPT_FORMATTER=NO"
)
