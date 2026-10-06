#!/usr/bin/env python3

from pathlib import Path
import json
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "test" / "formatter_corpus.json"
LOCK = ROOT / "protos-source.lock.json"


def fail(message):
    raise RuntimeError(message)


EXPECTED_NATIVE_FALLBACK_WARNING = (
    "[To redirect Truffle log output to a file use one of the following options:\n"
    "* '--log.file=<path>' if the option is passed using a guest language launcher.\n"
    "* '-Dpolyglot.log.file=<path>' if the option is passed using the host Java launcher.\n"
    "* Configure logging using the polyglot embedding API.]\n"
    "[engine] WARNING: The polyglot engine uses a fallback runtime that does not "
    "support runtime compilation to native code.\n"
    "Execution without runtime compilation will negatively impact the guest "
    "application performance.\n"
    "The following cause was found: The fallback runtime was explicitly selected "
    "using the -Dtruffle.UseFallbackRuntime option.\n"
    "For more information see: "
    "https://www.graalvm.org/latest/reference-manual/embed-languages/"
    "#runtime-optimization-support.\n"
    "To disable this warning use the '--engine.WarnInterpreterOnly=false' option "
    "or the '-Dpolyglot.engine.WarnInterpreterOnly=false' system property.\n"
).encode("utf-8")


def formatter_stderr(stderr):
    if stderr.startswith(
        EXPECTED_NATIVE_FALLBACK_WARNING
    ):
        return stderr[
            len(EXPECTED_NATIVE_FALLBACK_WARNING):
        ]

    return stderr


def invoke(runtime, source):
    return subprocess.run(
        [str(runtime), "format"],
        input=source.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def main():
    if len(sys.argv) != 2:
        fail(
            "usage: released_formatter_acceptance.py "
            "<installed-protos-launcher>"
        )

    runtime = Path(sys.argv[1]).resolve()

    if not runtime.is_file():
        fail(
            "locked runtime launcher does not exist: "
            + str(runtime)
        )

    data = json.loads(
        CORPUS.read_text(encoding="utf-8")
    )

    lock = json.loads(
        LOCK.read_text(encoding="utf-8")
    )

    required_coverage = {
        "structural-whitespace",
        "line-comment",
        "block-comment",
        "comment-placement",
        "raw-literal",
        "unicode",
        "explicit-grouping",
        "closure-source-form",
        "trailing-closure",
        "semicolon",
        "logical-newline",
    }

    actual_coverage = set()

    for case in data["cases"]:
        name = case["name"]
        source = case["source"]
        expected = case["expected"]

        actual_coverage.update(
            case.get("covers", [])
        )

        first = invoke(runtime, source)

        if first.returncode != 0:
            fail(
                "%s first format exit=%d stderr=%r"
                % (
                    name,
                    first.returncode,
                    first.stderr.decode(
                        "utf-8",
                        errors="replace",
                    ),
                )
            )

        first_formatter_stderr = formatter_stderr(
            first.stderr
        )

        if first_formatter_stderr != b"":
            fail(
                "%s first format wrote unexpected stderr=%r"
                % (
                    name,
                    first_formatter_stderr.decode(
                        "utf-8",
                        errors="replace",
                    ),
                )
            )

        expected_bytes = expected.encode("utf-8")

        if first.stdout != expected_bytes:
            fail(
                "%s canonical output mismatch\n"
                "EXPECTED=%r\nACTUAL=%r"
                % (
                    name,
                    expected,
                    first.stdout.decode(
                        "utf-8",
                        errors="replace",
                    ),
                )
            )

        second = invoke(
            runtime,
            first.stdout.decode("utf-8"),
        )

        if second.returncode != 0:
            fail(
                "%s second format exit=%d stderr=%r"
                % (
                    name,
                    second.returncode,
                    second.stderr.decode(
                        "utf-8",
                        errors="replace",
                    ),
                )
            )

        second_formatter_stderr = formatter_stderr(
            second.stderr
        )

        if second_formatter_stderr != b"":
            fail(
                "%s second format wrote unexpected stderr=%r"
                % (
                    name,
                    second_formatter_stderr.decode(
                        "utf-8",
                        errors="replace",
                    ),
                )
            )

        if second.stdout != first.stdout:
            fail(
                "%s formatter is not idempotent"
                % name
            )

        for preserved in case.get(
            "preserve",
            [],
        ):
            if preserved not in expected:
                fail(
                    "%s preservation marker missing: %r"
                    % (
                        name,
                        preserved,
                    )
                )

    missing_coverage = (
        required_coverage - actual_coverage
    )

    if missing_coverage:
        fail(
            "released formatter corpus lacks coverage: "
            + ", ".join(
                sorted(missing_coverage)
            )
        )

    invalid_source = (
        data["invalid"]["source"]
    )

    invalid = invoke(
        runtime,
        invalid_source,
    )

    if invalid.returncode != 1:
        fail(
            "invalid source exit=%d expected 1"
            % invalid.returncode
        )

    if (
        invalid.stdout
        != invalid_source.encode("utf-8")
    ):
        fail(
            "invalid source stdout was not "
            "the exact original source"
        )

    invalid_formatter_stderr = formatter_stderr(
        invalid.stderr
    )

    if not invalid_formatter_stderr.startswith(
        b"protos format:"
    ):
        fail(
            "invalid source formatter diagnostic does not "
            "start with 'protos format:'; stderr=%r"
            % invalid_formatter_stderr.decode(
                "utf-8",
                errors="replace",
            )
        )

    file_case = data["cases"][0]

    with tempfile.TemporaryDirectory(
        prefix="protos-format-release-"
    ) as temporary:
        source_path = (
            Path(temporary)
            / "fixture.protos"
        )

        original = (
            file_case["source"]
            .encode("utf-8")
        )

        source_path.write_bytes(original)

        file_result = subprocess.run(
            [
                str(runtime),
                "format",
                str(source_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        if file_result.returncode != 0:
            fail(
                "file operand format exit=%d stderr=%r"
                % (
                    file_result.returncode,
                    file_result.stderr.decode(
                        "utf-8",
                        errors="replace",
                    ),
                )
            )

        if (
            file_result.stdout
            != file_case["expected"].encode(
                "utf-8"
            )
        ):
            fail(
                "file operand canonical output mismatch"
            )

        file_formatter_stderr = formatter_stderr(
            file_result.stderr
        )

        if file_formatter_stderr != b"":
            fail(
                "file operand wrote unexpected stderr=%r"
                % file_formatter_stderr.decode(
                    "utf-8",
                    errors="replace",
                )
            )

        if source_path.read_bytes() != original:
            fail(
                "protos format <file> mutated source file"
            )

    print(
        "PROTOS_LOCK_RELEASE="
        + str(lock["release_tag"])
    )
    print(
        "PROTOS_LOCK_REVISION="
        + str(lock["revision"])
    )
    print(
        "PROTOS_LOCK_ASSET_SHA256="
        + str(lock["release_asset_sha256"])
    )
    print(
        "RELEASED_TOOL010_CORPUS_CASES=%d"
        % len(data["cases"])
    )
    print(
        "RELEASED_TOOL010_CORPUS=PASS"
    )
    print(
        "RELEASED_TOOL010_IDEMPOTENCE=PASS"
    )
    print(
        "RELEASED_TOOL010_REPARSE=PASS"
    )
    print(
        "RELEASED_TOOL010_PRESERVATION=PASS"
    )
    print(
        "RELEASED_TOOL010_INVALID_FAIL_CLOSED=PASS"
    )
    print(
        "RELEASED_TOOL010_FILE_MODE_NON_MUTATING=PASS"
    )


if __name__ == "__main__":
    main()
