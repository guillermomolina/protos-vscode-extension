#!/usr/bin/env python3
"""LM009-B structural validation for the non-normative TextMate asset."""

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
GRAMMAR = ROOT / "syntaxes" / "protos.tmLanguage.json"
FIXTURE = ROOT / "test" / "fixtures" / "lexical.protos"

RESERVED = {"this", "context", "args", "super", "true", "false", "null"}
FORBIDDEN_FAKE_KEYWORDS = {
    "if", "else", "while", "for", "class", "function", "try", "catch",
    "throw", "async", "await", "var", "let", "const", "global", "import",
    "export",
}

def fail(message):
    print("LM009_B_LEXICAL_VALIDATION_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)

def collect(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield key, value
            yield from collect(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from collect(item)

def main():
    try:
        grammar = json.loads(GRAMMAR.read_text(encoding="utf-8"))
        fixture = FIXTURE.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as exc:
        fail(str(exc))

    if grammar.get("scopeName") != "source.protos":
        fail("scopeName must be source.protos")
    if grammar.get("name") != "Protos":
        fail("grammar name must be Protos")

    repository = grammar.get("repository")
    if not isinstance(repository, dict):
        fail("repository must be an object")

    for required in ("comments", "strings", "escapes", "numbers", "reserved",
                     "ellipsis", "operators", "punctuation"):
        if required not in repository:
            fail("missing repository pattern: " + required)

    operator_rules = [
        item for item in repository["operators"].get("patterns", [])
        if item.get("name") == "keyword.operator.protos"
    ]
    if len(operator_rules) != 1:
        fail("expected exactly one ordinary symbolic-operator rule")
    try:
        operator_re = re.compile(operator_rules[0]["match"])
    except re.error as exc:
        fail("operator pattern is not Python-checkable: " + str(exc))
    maximal = operator_re.match("=>?")
    if maximal is None or maximal.group(0) != "=>?":
        fail("symbolic operator rule must maximal-munch =>? as one token")
    if operator_re.match(":").group(0) != ":":
        fail("slot-creation colon must remain highlighted as an operator")

    serialized = json.dumps(grammar, ensure_ascii=False)
    for token in RESERVED:
        if token not in serialized:
            fail("reserved spelling not represented: " + token)
    for token in FORBIDDEN_FAKE_KEYWORDS:
        # The grammar itself must not promote these spellings into token rules.
        # README/fixture references are outside this JSON-only check.
        if ('"' + token + '"') in serialized:
            fail("non-reserved spelling promoted as explicit grammar token: " + token)

    required_fixture = (
        "// LM009-B lexical fixture",
        "/* block comments may span",
        "'single\\nquoted'",
        '"""',
        "0b1010_0101",
        "0o755",
        "0xDEAD_BEEF",
        "6.022e23",
        "object.true",
        "object.null",
        "x => x * 2",
        "(a, b) =>",
        "(first, ...rest) =>",
        "...object",
        "(1 + 2) @ 3",
        "customMaximal: left =>? right",
        "object === object",
        "truth && false",
    )
    for marker in required_fixture:
        if marker not in fixture:
            fail("fixture missing representative form: " + marker)

    if "# " in fixture:
        fail("fixture accidentally uses # as a comment delimiter")

    print("LM009_B_LEXICAL_VALIDATION: PASS")
    print("GRAMMAR_JSON: PASS")
    print("FIXTURE_COVERAGE: PASS")
    print("RESERVED_SET_GUARD: PASS")
    print("NON_NORMATIVE_BOUNDARY: PASS")

if __name__ == "__main__":
    main()
