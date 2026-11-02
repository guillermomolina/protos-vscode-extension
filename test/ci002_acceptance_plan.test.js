"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "scripts/test_acceptance.js"), "utf8"
);
const begin = source.indexOf("  const scenarios = [");
const end = source.indexOf("  const selectedScenarios =", begin);

assert.ok(begin >= 0 && end > begin);

const build = new Function(
  "ROOT", "fs", "path", "ci002", "BASELINE", "FEATURES",
  source.slice(begin, end) + "\nreturn scenarios;"
);

const cases = require("../scripts/ci002_diagnostics_cases");

function plan(eligible) {
  return build(
    root, fs, path,
    { eligibleForFeatureTests: eligible },
    cases.BASELINE, cases.FEATURES
  );
}

const required = [
  "ci002-lsp-features",
  "ci002-run-features",
  "ci002-format-features",
  "ci002-debug-features"
];

test("old release retains six baseline scenarios", () => {
  const names = plan(false).map(row => row.name);
  assert.equal(names.length, 6);
  assert.ok(names.includes("ci002-lsp-baseline"));
  for (const name of required) {
    assert.ok(!names.includes(name));
  }
});

test("eligible release includes four unique feature scenarios", () => {
  const names = plan(true).map(row => row.name);
  assert.equal(names.length, 10);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    names.filter(n => n.endsWith("-features")).sort(),
    [...required].sort()
  );
});

test("all scenarios reference existing harnesses and validators", () => {
  for (const row of plan(true)) {
    for (const filename of [row.makeHarness, row.validator]) {
      assert.ok(
        fs.isFileSync
          ? fs.isFileSync(filename)
          : fs.statSync(path.join(root, "test", filename)).isFile(),
        filename
      );
    }
  }
});
