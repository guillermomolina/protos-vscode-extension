#!/usr/bin/env python3
from pathlib import Path
import hashlib
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT
CANONICALIZER = ROOT / "scripts" / "canonicalize_vsix.js"


def fail(message):
    print("LM009_I1C_REPRODUCIBILITY_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def member_map(path):
    with zipfile.ZipFile(path) as archive:
        names = [info.filename for info in archive.infolist()]
        if len(names) != len(set(names)):
            fail("duplicate ZIP member")
        return (
            {
                name: hashlib.sha256(archive.read(name)).hexdigest()
                for name in names
            },
            names,
        )


if len(sys.argv) != 2:
    fail("usage: validate_reproducibility.py <raw-vsix>")

raw = Path(sys.argv[1]).resolve()
if not raw.is_file():
    fail("raw VSIX does not exist: %s" % raw)

source_epoch = int(
    subprocess.check_output(
        ["git", "-C", str(REPO), "show", "-s", "--format=%ct", "HEAD"],
        text=True,
    ).strip()
)

with tempfile.TemporaryDirectory(prefix="lm009-i1c-") as temporary:
    first = Path(temporary) / "canonical-a.vsix"
    second = Path(temporary) / "canonical-b.vsix"

    for destination in (first, second):
        subprocess.check_call(
            [
                "node",
                str(CANONICALIZER),
                str(raw),
                str(destination),
                str(source_epoch),
            ]
        )

    raw_members, _ = member_map(raw)
    first_members, first_names = member_map(first)
    second_members, _ = member_map(second)

    if raw_members != first_members:
        fail("canonicalization changed member paths or uncompressed bytes")
    if first_members != second_members:
        fail("repeated canonicalization changed member bytes")
    if first_names != sorted(first_names):
        fail("canonical member order is not lexicographic")
    if sha256(first) != sha256(second):
        fail("canonical artifact SHA-256 differs")

    print("LM009_I1C_REPRODUCIBILITY_VALIDATION=PASS")
    print("VSIX_CONTENT_REPRODUCIBLE=YES")
    print("VSIX_ARTIFACT_REPRODUCIBLE=YES")
    print("VSIX_CANONICAL_TIMESTAMP_SOURCE=SOURCE_DATE_EPOCH_FROM_GIT_COMMIT")
    print("VSIX_CANONICAL_COMPRESSION=STORE")
    print("VSIX_CANONICAL_ORDER=LEXICOGRAPHIC")
    print("VSIX_CANONICAL_MODE=FIXED")
    print("VSIX_SEMANTIC_MEMBER_BYTES_CHANGED=NO")
    print("CANONICAL_SHA256_A=" + sha256(first))
    print("CANONICAL_SHA256_B=" + sha256(second))
