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
  "NAMED_ARGUMENTS", "SIGNATURE_CASES",
  source.slice(begin, end) + "\nreturn scenarios;"
);

const cases = require("../scripts/ci002_diagnostics_cases");
const signatures = require("./ci002_named_signature_cases");

function plan(eligible, namedEligible = false) {
  return build(
    root, fs, path,
    {
      eligibleForFeatureTests: eligible,
      eligibleForNamedArgumentTests: namedEligible
    },
    cases.BASELINE,
    cases.FEATURES,
    cases.NAMED_ARGUMENTS,
    signatures
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

test("D237 release registers five distinct real VSIX scenarios", () => {
  const names = plan(true, true).map(row => row.name);
  assert.equal(names.length, 15);
  assert.equal(new Set(names).size, names.length);

  assert.ok(names.includes("ci002-named-diagnostics"));
  assert.ok(names.includes("ci002-named-signatures"));
  assert.ok(names.includes("ci002-named-format"));
  assert.ok(names.includes("ci002-named-run"));
  assert.ok(names.includes("ci002-named-debug"));

  const old = plan(true, false).map(row => row.name);
  assert.ok(!old.includes("ci002-named-diagnostics"));
  assert.ok(!old.includes("ci002-named-signatures"));
  assert.ok(!old.includes("ci002-named-format"));
  assert.ok(!old.includes("ci002-named-run"));
  assert.ok(!old.includes("ci002-named-debug"));
});

test("D237 formatter, Run and Debug scenarios retain their contracts", () => {
  const scenarios = plan(true, true);
  const byName = new Map(
    scenarios.map(row => [row.name, row])
  );

  const format = byName.get("ci002-named-format");

  assert.equal(format.ci002NamedFormatter, true);
  assert.equal(format.formattingMode, "real");
  assert.ok(
    format.unsavedExpected.includes("f(c: 3, 1, 2)")
  );
  assert.ok(
    format.saveExpected.includes("[item: 5]")
  );
  assert.ok(
    format.saveExpected.includes("identity((created: 41))")
  );

  const run = byName.get("ci002-named-run");

  assert.equal(run.ci002RunFeature, true);
  assert.match(
    run.fixture,
    /CI002_D237_EXECUTION_ASSERTIONS_COMPLETED/
  );

  const debug = byName.get("ci002-named-debug");

  assert.equal(debug.ci002ExpectedLocalValue, "123");

  const lines = debug.fixture
    .trimEnd()
    .split(String.fromCharCode(10));

  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("(c: 3, 1, 2)"));
  assert.equal(lines[1], "print(x)");
});

test("D237 focal selector contains exactly its five scenarios", () => {
  const begin = source.indexOf("  const selectedScenarios =");
  const end = source.indexOf(
    "  if (ci002Focal && selectedScenarios.length",
    begin
  );

  assert.ok(begin >= 0 && end > begin);

  const select = new Function(
    "scenarios",
    "ci002Focal",
    "ci002D237Focal",
    source.slice(begin, end) + String.fromCharCode(10) + "return selectedScenarios;"
  );

  const scenarios = plan(true, true);
  const selected = select(scenarios, false, true);

  assert.equal(selected.length, 5);
  assert.deepEqual(
    selected.map(row => row.name).sort(),
    [
      "ci002-named-debug",
      "ci002-named-diagnostics",
      "ci002-named-format",
      "ci002-named-run",
      "ci002-named-signatures"
    ]
  );

  assert.equal(select(scenarios, true, false).length, 1);
  assert.equal(
    select(scenarios, false, false).length,
    15
  );
});

test("all scenarios reference existing harnesses and validators", () => {
  for (const row of plan(true, true)) {
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
