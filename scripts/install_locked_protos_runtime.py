#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "protos-source.lock.json"


def fail(message: str) -> None:
    raise RuntimeError(message)


def read_lock() -> dict[str, object]:
    data = json.loads(LOCK_PATH.read_text(encoding="utf-8"))

    required_strings = (
        "repository",
        "revision",
        "release_version",
        "release_tag",
        "release_asset",
        "release_asset_sha256",
        "graalvm_release",
        "native_runtime_kind",
        "target_os",
        "target_arch",
        "libc_family",
        "libc_abi_min",
    )

    for key in required_strings:
        value = data.get(key)
        if not isinstance(value, str) or not value:
            fail(f"invalid locked runtime field: {key}")

    if data["repository"] != "guillermomolina/protos":
        fail(f"unexpected repository: {data['repository']}")

    if not re.fullmatch(r"[0-9a-f]{40}", data["revision"]):
        fail(f"invalid source revision: {data['revision']}")

    if not re.fullmatch(r"[0-9a-f]{64}", data["release_asset_sha256"]):
        fail("invalid release asset SHA-256")

    expected_asset = (
        f"protos-{data['release_version']}-native-linux-x86_64.zip"
    )
    if data["release_asset"] != expected_asset:
        fail(
            "release asset does not match locked version: "
            f"{data['release_asset']} != {expected_asset}"
        )

    if data["release_tag"] != f"v{data['release_version']}":
        fail("release tag/version mismatch")

    return data


def parse_properties(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}

    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw:
            continue
        key, separator, value = raw.partition("=")
        if not separator or not key:
            fail(f"malformed metadata line in {path.name}: {raw!r}")
        result[key] = value

    return result


def download(url: str, target: Path) -> str:
    digest = hashlib.sha256()

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "protos-vscode-extension-acceptance"},
    )

    with urllib.request.urlopen(request) as response:
        with target.open("wb") as output:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                digest.update(block)

    return digest.hexdigest()


def extract_archive(archive_path: Path, destination: Path, root_name: str) -> Path:
    extracted_root = destination / root_name

    if extracted_root.exists():
        shutil.rmtree(extracted_root)

    with zipfile.ZipFile(archive_path) as archive:
        bad = archive.testzip()
        if bad is not None:
            fail(f"archive CRC failure: {bad}")

        prefix = root_name + "/"

        for info in archive.infolist():
            name = info.filename
            posix = PurePosixPath(name)

            if not name.startswith(prefix):
                fail(f"archive entry escapes locked distribution root: {name}")

            if posix.is_absolute() or ".." in posix.parts:
                fail(f"unsafe archive entry: {name}")

            target = destination.joinpath(*posix.parts)

            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue

            target.parent.mkdir(parents=True, exist_ok=True)

            with archive.open(info) as source:
                with target.open("wb") as output:
                    shutil.copyfileobj(source, output)

            mode = (info.external_attr >> 16) & 0o777
            if mode:
                target.chmod(mode)

    return extracted_root


def verify_identity(distribution: Path, lock: dict[str, object]) -> Path:
    source = parse_properties(distribution / "SOURCE.txt")
    runtime = parse_properties(distribution / "RUNTIME.txt")

    expected_source = {
        "implementation_version": lock["release_version"],
        "source_revision": lock["revision"],
        "source_dirty": "false",
        "artifact_kind": "public-prerelease",
        "public_release": "true",
        "release_version": lock["release_version"],
        "release_tag": lock["release_tag"],
    }

    for key, expected in expected_source.items():
        actual = source.get(key)
        if actual != expected:
            fail(
                f"SOURCE.txt identity mismatch for {key}: "
                f"{actual!r} != {expected!r}"
            )

    expected_runtime = {
        "native_runtime_kind": lock["native_runtime_kind"],
        "external_java_required": "false",
        "graalvm_release": lock["graalvm_release"],
        "target_os": lock["target_os"],
        "target_arch": lock["target_arch"],
        "libc_family": lock["libc_family"],
        "libc_abi_min": lock["libc_abi_min"],
    }

    for key, expected in expected_runtime.items():
        actual = runtime.get(key)
        if actual != expected:
            fail(
                f"RUNTIME.txt identity mismatch for {key}: "
                f"{actual!r} != {expected!r}"
            )

    launcher = distribution / "bin/protos"
    native = distribution / "libexec/protos-native"

    if not launcher.is_file():
        fail("published distribution has no bin/protos")

    if not native.is_file():
        fail("published distribution has no libexec/protos-native")

    launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR)
    native.chmod(native.stat().st_mode | stat.S_IXUSR)

    return launcher


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: install_locked_protos_runtime.py <destination>")

    lock = read_lock()
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(parents=True, exist_ok=True)

    asset = str(lock["release_asset"])
    root_name = asset.removesuffix(".zip")
    archive_path = destination / asset

    url = (
        "https://github.com/"
        + str(lock["repository"])
        + "/releases/download/"
        + str(lock["release_tag"])
        + "/"
        + asset
    )

    print(
        f"Downloading locked Protos runtime: {url}",
        file=sys.stderr,
    )

    actual_sha256 = download(url, archive_path)
    expected_sha256 = str(lock["release_asset_sha256"])

    if actual_sha256 != expected_sha256:
        fail(
            "published Native archive SHA-256 mismatch: "
            f"{actual_sha256} != {expected_sha256}"
        )

    distribution = extract_archive(
        archive_path,
        destination,
        root_name,
    )

    launcher = verify_identity(distribution, lock)

    print(
        "LOCKED_PROTOS_RELEASE=PASS",
        file=sys.stderr,
    )
    print(
        f"LOCKED_PROTOS_SOURCE_REVISION={lock['revision']}",
        file=sys.stderr,
    )
    print(
        f"LOCKED_PROTOS_RELEASE_TAG={lock['release_tag']}",
        file=sys.stderr,
    )
    print(
        f"LOCKED_PROTOS_ARCHIVE_SHA256={actual_sha256}",
        file=sys.stderr,
    )
    print(
        f"LOCKED_PROTOS_GRAALVM_RELEASE={lock['graalvm_release']}",
        file=sys.stderr,
    )
    print(
        "LOCKED_PROTOS_EXTERNAL_JAVA_REQUIRED=false",
        file=sys.stderr,
    )

    print(str(launcher))


if __name__ == "__main__":
    main()
