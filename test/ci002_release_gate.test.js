"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  REQUIRED_RELEASE,
  FEATURE_IDS,
  NAMED_ARGUMENTS_REQUIRED_RELEASE,
  NAMED_ARGUMENT_FEATURE_IDS,
  compareVersions,
  classifyLockedRelease
} = require("../scripts/ci002_release_gate");

function fixture(version) {
  return {
    repository: "guillermomolina/protos",
    revision: "a".repeat(40),
    release_version: version,
    release_tag: `v${version}`,
    release_asset:
      `protos-${version}-native-linux-x86_64.zip`,
    release_asset_sha256: "b".repeat(64)
  };
}

test(
  "numeric versions compare by components",
  () => {
    assert.equal(
      compareVersions("0.3.428", "0.3.436"),
      -1
    );

    assert.equal(
      compareVersions("0.3.436", "0.3.436"),
      0
    );

    assert.equal(
      compareVersions("0.3.1000", "0.3.436"),
      1
    );

    assert.equal(
      compareVersions("0.4.0", "0.3.436"),
      1
    );

    assert.throws(
      () => compareVersions(
        "0.3.436-SNAPSHOT",
        REQUIRED_RELEASE
      )
    );

    assert.throws(
      () => compareVersions(
        "0.3.04",
        "0.3.4"
      )
    );
  }
);

test(
  "older locks cannot pass the feature gate",
  () => {
    for (
      const version of [
        "0.3.237",
        "0.3.428",
        "0.3.435"
      ]
    ) {
      const gate =
        classifyLockedRelease(fixture(version));

      assert.equal(
        gate.eligibleForFeatureTests,
        false
      );

      assert.equal(
        gate.finalFeatureAcceptance,
        "BLOCKED_RELEASE"
      );

      assert.equal(
        gate.features.length,
        FEATURE_IDS.length
      );

      assert.ok(
        gate.features.every(
          (row) =>
            row.status === "BLOCKED_RELEASE"
        )
      );
    }
  }
);

test(
  "qualifying release is NOT_RUN, never PASS",
  () => {
    for (
      const version of [
        "0.3.436",
        "0.3.437",
        "0.4.0"
      ]
    ) {
      const gate =
        classifyLockedRelease(fixture(version));

      assert.equal(
        gate.eligibleForFeatureTests,
        true
      );

      assert.equal(
        gate.finalFeatureAcceptance,
        "NOT_RUN"
      );

      assert.ok(
        gate.features.every(
          (row) => row.status === "NOT_RUN"
        )
      );
    }
  }
);

test(
  "D237 requires 0.3.440 independently of the original gate",
  () => {
    assert.equal(
      NAMED_ARGUMENTS_REQUIRED_RELEASE,
      "0.3.440"
    );

    for (const version of [
      "0.3.237",
      "0.3.436",
      "0.3.439"
    ]) {
      const gate = classifyLockedRelease(fixture(version));

      assert.equal(gate.eligibleForNamedArgumentTests, false);
      assert.equal(
        gate.finalNamedArgumentAcceptance,
        "BLOCKED_RELEASE"
      );
      assert.equal(
        gate.namedArgumentFeatures.length,
        NAMED_ARGUMENT_FEATURE_IDS.length
      );
      assert.ok(gate.namedArgumentFeatures.every(
        row => row.status === "BLOCKED_RELEASE"
      ));
    }

    const previous = classifyLockedRelease(fixture("0.3.439"));
    assert.equal(previous.eligibleForFeatureTests, true);
    assert.equal(previous.eligibleForNamedArgumentTests, false);

    for (const version of [
      "0.3.440",
      "0.3.442",
      "0.4.0"
    ]) {
      const gate = classifyLockedRelease(fixture(version));

      assert.equal(gate.eligibleForNamedArgumentTests, true);
      assert.equal(gate.finalNamedArgumentAcceptance, "NOT_RUN");
      assert.ok(gate.namedArgumentFeatures.every(
        row => row.status === "NOT_RUN"
      ));
    }
  }
);

test(
  "tampered release identities are rejected",
  () => {
    const original = fixture("0.3.436");

    const invalidCases = [
      ["repository", "other/protos"],
      ["release_tag", "main"],
      ["release_tag", "v0.3.435"],
      ["release_asset", "snapshot.zip"],
      ["revision", "HEAD"],
      ["release_asset_sha256", "unknown"],
      ["release_version", "0.3.436-SNAPSHOT"]
    ];

    for (const [key, invalid] of invalidCases) {
      assert.throws(
        () => classifyLockedRelease({
          ...original,
          [key]: invalid
        }),
        key
      );
    }
  }
);

test(
  "committed lock is classified without mutation",
  () => {
    const filename = path.join(
      __dirname,
      "..",
      "protos-source.lock.json"
    );

    const lock = JSON.parse(
      fs.readFileSync(filename, "utf8")
    );

    const before = JSON.stringify(lock);

    const gate = classifyLockedRelease(lock);

    assert.equal(JSON.stringify(lock), before);
    assert.equal(
      gate.lockedTag,
      lock.release_tag
    );
    assert.equal(
      gate.lockedRevision,
      lock.revision
    );
    assert.equal(
      gate.lockedAssetSha256,
      lock.release_asset_sha256
    );
    assert.notEqual(
      gate.finalFeatureAcceptance,
      "PASS"
    );
    assert.notEqual(
      gate.finalNamedArgumentAcceptance,
      "PASS"
    );
  }
);
