"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NAMED_ARGUMENTS
} = require("../scripts/ci002_diagnostics_cases");

test("D237 diagnostics fixture identities are unique", () => {
  const ids = NAMED_ARGUMENTS.map(row => row.id);

  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, ids.length);

  assert.deepEqual(
    ids.sort(),
    [
      "named-duplicate-array-label",
      "named-duplicate-explicit-label"
    ]
  );
});

test("D237 diagnostics fixtures do not contain escaped newlines", () => {
  for (const row of NAMED_ARGUMENTS) {
    assert.notEqual(row.invalid, row.valid, row.id);

    for (const kind of ["invalid", "valid"]) {
      const source = row[kind];

      assert.equal(typeof source, "string");
      assert.ok(source.length > 0);
      assert.ok(
        !source.includes(String.fromCharCode(92) + "n"),
        row.id + "/" + kind + " contains a literal newline escape"
      );
    }
  }
});
