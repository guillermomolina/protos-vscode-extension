#!/usr/bin/env python3
# LM009-I1-A/B validation for D127 deterministic VS Code packaging.

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT
PACKAGE = ROOT / "package.json"
LOCK = ROOT / "package-lock.json"
BUNDLE = ROOT / "dist" / "extension.js"
GITIGNORE = REPO / ".gitignore"

EXPECTED_DEPENDENCIES = {
    "vscode-languageclient": "10.1.1",
}
EXPECTED_DEV_DEPENDENCIES = {
    "@vscode/vsce": "3.9.2",
    "esbuild": "0.28.2",
    "yauzl": "^3.4.0",
    "yazl": "^2.5.1",
}
EXPECTED_SCRIPTS = {
    "build": (
        "esbuild extension.js --bundle --platform=node --format=cjs "
        "--target=node22 --external:vscode --metafile=dist/meta.json "
        "--outfile=dist/extension.js"
    ),
    "package:assets": "node scripts/sync_package_assets.js --check",
    "vscode:prepublish": "npm run build && npm run package:assets",
    "package:vsix": "vsce package --no-dependencies",
    "package:vsix:canonical": "node scripts/canonicalize_vsix.js",
}

PACKAGE_LICENSE = ROOT / "license.txt"
SOURCE_LICENSE = REPO / "LICENSE.TXT"
THIRD_PARTY_NOTICES = ROOT / "THIRD_PARTY_NOTICES.txt"
VSCODEIGNORE = ROOT / ".vscodeignore"
EXPECTED_VSCODEIGNORE = """# LM009-I1-B explicit package boundary.
# The exact allowed shipping set is enforced by test/validate_vsix.py.
.vscodeignore
extension.js
debug_adapter.js
package-lock.json
node_modules/**
test/**
scripts/**
dist/meta.json
*.vsix
LICENSE.TXT
"""

def fail(message):
    print("LM009_I1A_PACKAGING_VALIDATION_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)

def load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail("%s: %s" % (path, exc))

def main():
    package = load(PACKAGE)
    lock = load(LOCK)

    if package.get("main") != "./dist/extension.js":
        fail("production extension entry must be ./dist/extension.js")
    if package.get("dependencies") != EXPECTED_DEPENDENCIES:
        fail("runtime dependency set changed")
    if package.get("devDependencies") != EXPECTED_DEV_DEPENDENCIES:
        fail("pinned build/package toolchain changed")
    if package.get("scripts") != EXPECTED_SCRIPTS:
        fail("build scripts changed")

    if lock.get("lockfileVersion") != 3:
        fail("package-lock.json must use lockfileVersion 3")
    root = lock.get("packages", {}).get("")
    if not isinstance(root, dict):
        fail("package-lock root package metadata missing")
    if root.get("dependencies") != EXPECTED_DEPENDENCIES:
        fail("package-lock runtime dependencies differ from package.json")
    if root.get("devDependencies") != EXPECTED_DEV_DEPENDENCIES:
        fail("package-lock devDependencies differ from package.json")

    try:
        ignored = GITIGNORE.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        fail(str(exc))
    if "dist/" not in ignored:
        fail("generated bundle directory must remain repository-ignored")
    if "*.vsix" not in ignored:
        fail("generated VSIX artifacts must remain repository-ignored")

    if not BUNDLE.is_file():
        fail("production bundle missing; run npm run build")
    try:
        bundle = BUNDLE.read_text(encoding="utf-8")
    except OSError as exc:
        fail(str(exc))

    if BUNDLE.stat().st_size <= 0:
        fail("production bundle is empty")
    if BUNDLE.stat().st_size > 4 * 1024 * 1024:
        fail("generation-1 client bundle unexpectedly exceeds 4 MiB")

    if not re.search(r"require\([\"']vscode[\"']\)", bundle):
        fail("bundle does not preserve host-provided vscode as external")
    if re.search(r"require\([\"']vscode-languageclient(?:/node)?[\"']\)", bundle):
        fail("vscode-languageclient remains a runtime filesystem require")
    if re.search(r"require\([\"']\./debug_adapter[\"']\)", bundle):
        fail("debug_adapter remains a runtime filesystem require")

    try:
        if PACKAGE_LICENSE.read_bytes() != SOURCE_LICENSE.read_bytes():
            fail("package-root license.txt must equal repository LICENSE.TXT exactly")
        notices = THIRD_PARTY_NOTICES.read_text(encoding="utf-8")
        vscodeignore = VSCODEIGNORE.read_text(encoding="utf-8")
    except OSError as exc:
        fail(str(exc))

    if "=== vscode-languageclient@10.1.1 ===" not in notices:
        fail("third-party notices do not cover the bundled vscode-languageclient")
    if "@vscode/vsce@" in notices or "esbuild@" in notices:
        fail("build-only dependencies must not be reported as bundled runtime code")
    if vscodeignore != EXPECTED_VSCODEIGNORE:
        fail(".vscodeignore package boundary changed")

    print("LM009_I1A_PACKAGING_VALIDATION: PASS")
    print("LM009_I1B_PACKAGE_ASSET_VALIDATION: PASS")
    print("PACKAGE_LOCKFILE=COMMITTED")
    print("CLEAN_INSTALL_COMMAND=npm_ci")
    print("PRODUCTION_CLIENT=BUNDLED")
    print("VSCODE_MODULE=EXTERNAL_HOST_PROVIDED")
    print("PRODUCTION_ENTRY=dist/extension.js")
    print("BUILD_TOOL_ESBUILD=0.28.2")
    print("PACKAGE_TOOL_VSCE=3.9.2")
    print("PRODUCTION_NODE_MODULES_IN_VSIX_POLICY=NO")
    print("PROTOS_RUNTIME_IN_VSIX=NO")
    print("PACKAGE_LICENSE=license.txt")
    print("THIRD_PARTY_NOTICES=THIRD_PARTY_NOTICES.txt")
    print("PACKAGE_CONTENT_BOUNDARY=EXPLICIT")

if __name__ == "__main__":
    main()
