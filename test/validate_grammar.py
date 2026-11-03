#!/usr/bin/env python3
"""LM009-B structural validation for the non-normative TextMate asset."""

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
GRAMMAR = ROOT / "syntaxes" / "protos.tmLanguage.json"
FIXTURE = ROOT / "test" / "fixtures" / "lexical.protos"

RESERVED = {"this", "context", "super", "true", "false", "null"}
FORBIDDEN_FAKE_KEYWORDS = {
    "if", "else", "while", "for", "class", "function", "try", "catch",
    "throw", "async", "await", "var", "let", "const", "global", "import",
    "export", "in", "until", "return", "each", "eachStep",
    "Range", "InvertedRange",
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
    for symbol in (
        ":", "=>", "===", "&&",
        "&", "|", "~", "<<", ">>",
    ):
        if operator_re.fullmatch(symbol) is None:
            fail("operator is not highlighted: " + symbol)

    # D175 highlighting policy is intentionally broad.
    # These are NOT valid Protos operators. Their TextMate
    # coloring must not be interpreted as syntax acceptance.
    for invalid_run in ("@", "=>?"):
        if operator_re.fullmatch(invalid_run) is None:
            fail(
                "broad non-normative operator highlighting "
                "policy changed: " + invalid_run
            )

    expected_reserved_rules = {
        "variable.language.protos": (
            r"(?<![.\p{L}\p{M}\p{N}_])"
            r"(?:this|context)"
            r"(?![\p{L}\p{M}\p{N}_])"
        ),
        "keyword.control.protos": (
            r"(?<![.\p{L}\p{M}\p{N}_])"
            r"super"
            r"(?![\p{L}\p{M}\p{N}_])"
        ),
        "constant.language.protos": (
            r"(?<![.\p{L}\p{M}\p{N}_])"
            r"(?:true|false|null)"
            r"(?![\p{L}\p{M}\p{N}_])"
        ),
    }

    actual_patterns = repository["reserved"].get("patterns", [])
    actual_reserved_rules = {
        rule.get("name"): rule.get("match")
        for rule in actual_patterns
    }

    if (
        len(actual_patterns) != len(expected_reserved_rules)
        or actual_reserved_rules != expected_reserved_rules
    ):
        fail("reserved TextMate scopes differ from Core grammar")

    if RESERVED != {
        "this", "context", "super", "true", "false", "null"
    }:
        fail("reserved-word inventory differs from Core grammar")

    language_scopes = [
        value
        for key, value in collect(grammar)
        if key == "name"
        and isinstance(value, str)
        and value.startswith((
            "variable.language.",
            "keyword.control.",
            "constant.language.",
        ))
    ]

    if sorted(language_scopes) != sorted(expected_reserved_rules):
        fail("language-token scope duplicated or misplaced")

    serialized = json.dumps(grammar, ensure_ascii=False)

    for token in FORBIDDEN_FAKE_KEYWORDS:
        if ('"' + token + '"') in serialized:
            fail(
                "ordinary identifier promoted to explicit token: "
                + token
            )

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
        "object === object",
        "truth && false",
        "args: [1, 2, 3]",
        "(args) => args",
        "(...args) => args",
        "object.args",
        "object.true:",
        "object.null:",
        "object.for",
        "object.return",
        "café: 42",
        "object.λ",
        "Range(0, 4)",
        "Range(4, 0)",
        "invertedPrototype: InvertedRange",
        "args.each(item =>",
        "ascending.eachStep(2, i =>",
        "for(item in args) {",
        "for(i, 0, 4) {",
        "for(i, 4, 0, -2) {",
        "return value",
        "if(truth) { true } else { false }",
        "while(false) { null }",
        "} until(true)",
        "12 & 10",
        "12 | 10",
        "12 ~ 10",
        "bitNotValue: ~0",
        "1 << 8",
        "16 >> 2",
        "12 ~ ~10",
        "namedClosure(third: 3, first: 1, second: 2)",
        "namedClosure(third: 3, 1, 2)",
        "namedClosure(third: 3, ...[1, 2])",
        "namedReceiver.take(value: 42)",
        "namedArray: [item: 5]",
        "groupedArray: [(createdByArray: 5)]",
        "namedClosure((createdByCall: 1), second: 2)",
    )
    for marker in required_fixture:
        if marker not in fixture:
            fail("fixture missing representative form: " + marker)

    for rejected in (
        "customOperatorResult:",
        "customMaximal:",
        "(1 + 2) @ 3",
        "left =>? right",
    ):
        if rejected in fixture:
            fail(
                "invalid operator example in valid-source fixture: "
                + rejected
            )

    if "# " in fixture:
        fail("fixture accidentally uses # as a comment delimiter")

    print("LM009_B_LEXICAL_VALIDATION: PASS")
    print("GRAMMAR_JSON: PASS")
    print("FIXTURE_COVERAGE: PASS")
    print("RESERVED_SET_GUARD: PASS")
    print("NON_NORMATIVE_BOUNDARY: PASS")
    print("BUG002_RESERVED_SCOPE_GUARD: PASS")
    print("BUG002_CONTEXTUAL_FIXTURES: PASS")
    print("CI002_D237_LEXICAL_FIXTURES: PASS")
    print("BUG002_OPERATOR_POLICY: BROAD_TEXTMATE_ONLY")

if __name__ == "__main__":
    main()
