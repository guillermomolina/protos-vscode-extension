#!/usr/bin/env python3
from pathlib import Path
import json
import sys


if len(sys.argv) != 2:
    raise RuntimeError(
        "usage: formatting_harness_validate.py <result.json>"
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
    "formatRequestObserved": True,
    "formatDocumentResultExact": True,
    "unsavedBufferFormatting": True,

    "formatOnSaveEnabled": True,
    "formatOnSaveRequestObserved": True,
    "formatOnSaveResultExact": True,
    "diskContentCanonicalAfterSave": True,

    "extensionDevelopmentPathUsed": False,
    "testServerUsed": True,
    "realTool010Runtime": False,
    "independentTypescriptFormatter": False,
}

for key, expected in checks.items():
    actual = data.get(key)

    if actual != expected:
        raise RuntimeError(
            "LM011_D2_FORMATTING_FAILED: "
            "%s=%r expected %r"
            % (
                key,
                actual,
                expected,
            )
        )

request_count = data.get(
    "formatRequestCount"
)

if (
    not isinstance(request_count, int) or
    request_count < 2
):
    raise RuntimeError(
        "LM011_D2_FORMATTING_FAILED: "
        "formatRequestCount=%r expected >= 2"
        % request_count
    )

print(
    "LM011_D2_INSTALLED_VSIX_FORMAT_DOCUMENT=PASS"
)
print(
    "LM011_D2_UNSAVED_BUFFER_FORMATTING=PASS"
)
print(
    "LM011_D2_FORMAT_ON_SAVE=PASS"
)
print(
    "STANDARD_LSP_FORMATTING_REQUEST_OBSERVED=YES"
)
print(
    "FORMAT_REQUEST_COUNT=%d"
    % request_count
)
print(
    "INDEPENDENT_TYPESCRIPT_FORMATTER=NO"
)
print(
    "EXTENSION_DEVELOPMENT_PATH_USED=NO"
)
print(
    "TEST_SERVER_RUNTIME=YES"
)
print(
    "REAL_TOOL010_RUNTIME=NO"
)
