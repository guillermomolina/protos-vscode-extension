#!/usr/bin/env python3
from pathlib import Path
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_EXTENSION_FILES = {
    "extension/readme.md",
    "extension/THIRD_PARTY_NOTICES.txt",
    "extension/dist/extension.js",
    "extension/icon.png",
    "extension/language-configuration.json",
    "extension/license.txt",
    "extension/package.json",
    "extension/syntaxes/protos.tmLanguage.json",
}


def fail(message):
    print("LM009_I1B_VSIX_VALIDATION_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)


def main():
    if len(sys.argv) != 2:
        fail("usage: validate_vsix.py <artifact.vsix>")

    vsix = Path(sys.argv[1])
    if not vsix.is_file():
        fail("VSIX does not exist: %s" % vsix)

    try:
        with zipfile.ZipFile(vsix) as archive:
            names = {
                name for name in archive.namelist()
                if name.startswith("extension/") and not name.endswith("/")
            }

            if names != EXPECTED_EXTENSION_FILES:
                missing = sorted(EXPECTED_EXTENSION_FILES - names)
                extra = sorted(names - EXPECTED_EXTENSION_FILES)
                fail("package content mismatch; missing=%r extra=%r" % (missing, extra))

            forbidden_fragments = (
                "/node_modules/",
                "/test/",
                "/scripts/",
                "/fixtures/",
            )
            for name in archive.namelist():
                normalized = name.replace("\\", "/")
                if any(fragment in normalized for fragment in forbidden_fragments):
                    fail("forbidden package content: " + normalized)
                if normalized == "extension/extension.js":
                    fail("raw extension.js must not ship")
                if normalized == "extension/debug_adapter.js":
                    fail("raw debug_adapter.js must not ship")
                if normalized == "extension/package-lock.json":
                    fail("package-lock.json is build input, not VSIX content")
                if normalized == "extension/dist/meta.json":
                    fail("esbuild metafile is build-only and must not ship")

            if archive.read("extension/license.txt") != (ROOT / "license.txt").read_bytes():
                fail("packaged license.txt differs from package-root license.txt")
            if archive.read("extension/THIRD_PARTY_NOTICES.txt") != (
                ROOT / "THIRD_PARTY_NOTICES.txt"
            ).read_bytes():
                fail("packaged THIRD_PARTY_NOTICES.txt differs from package root")

            package = json.loads(archive.read("extension/package.json").decode("utf-8"))
            if package.get("main") != "./dist/extension.js":
                fail("packaged production entry changed")
    except (OSError, zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
        fail(str(exc))

    print("LM009_I1B_VSIX_VALIDATION: PASS")
    print("PACKAGE_CONTENT_BOUNDED=YES")
    print("LICENSE_PACKAGED=YES")
    print("THIRD_PARTY_NOTICES_PACKAGED=YES")
    print("PRODUCTION_NODE_MODULES_IN_VSIX=NO")
    print("TESTS_IN_VSIX=NO")
    print("FIXTURES_IN_VSIX=NO")
    print("RAW_EDITOR_SOURCES_IN_VSIX=NO")


if __name__ == "__main__":
    main()
