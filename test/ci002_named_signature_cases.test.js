"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("./ci002_named_signature_cases");

test("D237 signature fixtures contain exactly one cursor", () => {
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);

  for (const c of cases) {
    assert.equal(
      c.source.split("|").length,
      2,
      c.id
    );
    assert.match(c.expectedLabel, /^\(/);
    assert.ok(Number.isInteger(c.expectedActiveParameter));
    assert.ok(c.expectedActiveParameter >= 0);
  }
});

test("D237 UTF-16 case uses CRLF and a non-BMP character", () => {
  const c = cases.find(row => row.id === "named-utf16-crlf");
  assert.ok(c);
  assert.ok(c.source.startsWith('prefix: "😀"' + String.fromCharCode(13, 10)));

  const before = c.source.slice(0, c.source.indexOf("|"));
  const lines = before.split(/\r\n|\n|\r/);

  assert.deepEqual(
    [lines.length - 1, lines[lines.length - 1].length],
    c.expectedPosition
  );
});
