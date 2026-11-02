"use strict";

/*
 * CI002: version eligibility is not release acceptance.
 *
 * The official asset, digest, SOURCE.txt and RUNTIME.txt
 * are verified by install_locked_protos_runtime.py.
 */
const REQUIRED_RELEASE = "0.3.436";

const FEATURE_IDS = Object.freeze([
  "contextual-for-generic",
  "contextual-for-numeric",
  "contextual-for-stepped",
  "contextual-for-binder",
  "bitwise-operators",
  "contextual-return-and-caret",
  "range-and-inverted-range"
]);

function numericVersion(version) {
  const pattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

  if (
    typeof version !== "string" ||
    !pattern.test(version)
  ) {
    throw new Error(
      "CI002 requires a canonical numeric x.y.z version"
    );
  }

  const components =
    version.split(".").map(Number);

  if (
    components.some(
      (n) => !Number.isSafeInteger(n)
    )
  ) {
    throw new Error(
      "CI002 version component exceeds safe integer range"
    );
  }

  return components;
}

function compareVersions(left, right) {
  const a = numericVersion(left);
  const b = numericVersion(right);

  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }

  return 0;
}

function classifyLockedRelease(lock) {
  if (
    !lock ||
    typeof lock !== "object" ||
    Array.isArray(lock)
  ) {
    throw new Error(
      "CI002 requires a locked release identity object"
    );
  }

  if (
    lock.repository !==
    "guillermomolina/protos"
  ) {
    throw new Error(
      "CI002 locked runtime repository mismatch"
    );
  }

  numericVersion(lock.release_version);

  if (
    lock.release_tag !==
    `v${lock.release_version}`
  ) {
    throw new Error(
      "CI002 locked release tag/version mismatch"
    );
  }

  const expectedAsset =
    `protos-${lock.release_version}` +
    "-native-linux-x86_64.zip";

  if (lock.release_asset !== expectedAsset) {
    throw new Error(
      "CI002 locked native release asset mismatch"
    );
  }

  if (
    typeof lock.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(lock.revision)
  ) {
    throw new Error(
      "CI002 invalid source revision"
    );
  }

  if (
    typeof lock.release_asset_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(
      lock.release_asset_sha256
    )
  ) {
    throw new Error(
      "CI002 invalid native release digest"
    );
  }

  const eligible =
    compareVersions(
      lock.release_version,
      REQUIRED_RELEASE
    ) >= 0;

  /*
   * Eligibility never means acceptance PASS.
   * Feature scenarios must actually run against
   * the verified official artifact.
   */
  const status =
    eligible ? "NOT_RUN" : "BLOCKED_RELEASE";

  return {
    requiredRelease: REQUIRED_RELEASE,
    lockedRelease: lock.release_version,
    lockedTag: lock.release_tag,
    lockedRevision: lock.revision,
    lockedAsset: lock.release_asset,
    lockedAssetSha256:
      lock.release_asset_sha256,
    eligibleForFeatureTests: eligible,
    finalFeatureAcceptance: status,
    features: FEATURE_IDS.map(
      (id) => ({ id, status })
    )
  };
}

module.exports = {
  REQUIRED_RELEASE,
  FEATURE_IDS,
  compareVersions,
  classifyLockedRelease
};
