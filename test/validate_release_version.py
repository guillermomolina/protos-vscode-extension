#!/usr/bin/env python3
"""REL001 release-version identity guard."""

from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "package.json"

# Files whose committed/working-tree state can change the distributed VSIX
# identity or its canonical artifact. Tests and repository governance are
# deliberately excluded because they do not ship in the extension.
RELEASE_INPUTS = (
    ".vscodeignore",
    "README.md",
    "THIRD_PARTY_NOTICES.txt",
    "debug_adapter.js",
    "extension.js",
    "icon.png",
    "language-configuration.json",
    "license.txt",
    "package-lock.json",
    "package.json",
    "scripts/canonicalize_vsix.js",
    "scripts/sync_package_assets.js",
    "syntaxes/protos.tmLanguage.json",
)


def fail(message):
    print("REL001_RELEASE_VERSION_GUARD_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)


def git(*args):
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


try:
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    fail(str(exc))

version = package.get("version")
if (
    not isinstance(version, str)
    or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) is None
):
    fail("package.json version must be canonical x.y.z")

tag = "v" + version

tag_lookup = git(
    "rev-parse",
    "--verify",
    "--quiet",
    "refs/tags/" + tag,
)

if tag_lookup.returncode != 0:
    print("REL001_RELEASE_VERSION_GUARD: PASS")
    print("EXTENSION_VERSION=" + version)
    print("EXTENSION_RELEASE_TAG=" + tag)
    print("EXTENSION_RELEASE_TAG_EXISTS=NO")
    print("EXTENSION_VERSION_STATE=UNRELEASED_CANDIDATE")
    raise SystemExit(0)

tag_commit = git(
    "rev-list",
    "-n",
    "1",
    tag,
)
if tag_commit.returncode != 0:
    fail("cannot resolve release tag " + tag)

tag_sha = tag_commit.stdout.strip()

material_diff = git(
    "diff",
    "--quiet",
    tag,
    "--",
    *RELEASE_INPUTS,
)

if material_diff.returncode not in (0, 1):
    fail(
        "cannot compare current release inputs with "
        + tag
        + ": "
        + material_diff.stderr.strip()
    )

if material_diff.returncode == 1:
    changed = git(
        "diff",
        "--name-only",
        tag,
        "--",
        *RELEASE_INPUTS,
    )
    names = ", ".join(
        line.strip()
        for line in changed.stdout.splitlines()
        if line.strip()
    )
    fail(
        "extension version "
        + version
        + " is already owned by "
        + tag
        + " at "
        + tag_sha
        + "; distributed release inputs changed"
        + (": " + names if names else "")
        + "; bump package version before changing the released product"
    )

print("REL001_RELEASE_VERSION_GUARD: PASS")
print("EXTENSION_VERSION=" + version)
print("EXTENSION_RELEASE_TAG=" + tag)
print("EXTENSION_RELEASE_TAG_EXISTS=YES")
print("EXTENSION_RELEASE_TAG_COMMIT=" + tag_sha)
print("EXTENSION_RELEASE_INPUTS_CHANGED=NO")
print("EXTENSION_VERSION_STATE=RELEASED_PRODUCT_UNCHANGED")
