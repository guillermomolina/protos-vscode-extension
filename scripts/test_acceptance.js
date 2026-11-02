"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  spawn,
  spawnSync
} = require("child_process");

const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath
} = require("@vscode/test-electron");

const { classifyLockedRelease } = require("./ci002_release_gate");
const { BASELINE, FEATURES } = require("./ci002_diagnostics_cases");

const ROOT =
  path.resolve(__dirname, "..");

const ACCEPTANCE_ROOT =
  "/tmp/protos-vscode-acceptance";

const RUNTIME_ROOT =
  "/tmp/protos-vscode-runtime";

const RAW_VSIX =
  "/tmp/protos-vscode-extension-raw.vsix";

const CANONICAL_VSIX =
  path.join(ROOT, "protos-vscode.vsix");

const CANONICAL_SHA =
  path.join(ROOT, "protos-vscode.vsix.sha256");

const VSCODE_VERSION =
  "1.140.0";

const EXTENSION_INSTALL_ID =
  "guillermomolina.protos@" +
  require("../package.json").version;


function commandText(command, args) {
  return [command, ...args]
    .map((value) => JSON.stringify(String(value)))
    .join(" ");
}


function removePath(target) {
  fs.rmSync(
    target,
    {
      recursive: true,
      force: true
    }
  );
}


function run(command, args, options = {}) {
  console.log(
    "\n>>> " + commandText(command, args)
  );

  const result =
    spawnSync(
      command,
      args,
      {
        cwd: options.cwd || ROOT,
        env: options.env || process.env,
        stdio: "inherit",
        encoding: "utf8",
        shell: false
      }
    );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      command +
      " failed with status " +
      String(result.status)
    );
  }
}


function runCapture(
  command,
  args,
  options = {}
) {
  console.log(
    "\n>>> " + commandText(command, args)
  );

  const result =
    spawnSync(
      command,
      args,
      {
        cwd: options.cwd || ROOT,
        env: options.env || process.env,
        stdio: [
          "ignore",
          "pipe",
          "inherit"
        ],
        encoding: "utf8",
        shell: false
      }
    );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      command +
      " failed with status " +
      String(result.status)
    );
  }

  return String(result.stdout || "").trim();
}


function sha256File(filename) {
  const digest =
    crypto.createHash("sha256");

  digest.update(
    fs.readFileSync(filename)
  );

  return digest.digest("hex");
}


function writeJson(filename, value) {
  fs.writeFileSync(
    filename,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );
}


function sleep(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, milliseconds)
  );
}


async function waitForFile(
  filename,
  timeoutMilliseconds
) {
  const deadline =
    Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    if (fs.existsSync(filename)) {
      return;
    }

    await sleep(500);
  }

  throw new Error(
    "acceptance harness produced no result: " +
    filename
  );
}


function stopProcessGroup(child) {
  if (!child || !child.pid) {
    return;
  }

  try {
    process.kill(
      -child.pid,
      "SIGTERM"
    );
  } catch (_) {
    // Already gone.
  }
}


async function launchScenario(
  vscodeExecutablePath,
  launchArgs,
  resultPath,
  logPath,
  timeoutMilliseconds
) {
  const logFd =
    fs.openSync(
      logPath,
      "w"
    );

  console.log(
    "\n>>> " +
    commandText(
      "xvfb-run",
      launchArgs
    )
  );

  const child =
    spawn(
      "xvfb-run",
      launchArgs,
      {
        cwd: ROOT,
        env: process.env,
        detached: true,
        stdio: [
          "ignore",
          logFd,
          logFd
        ],
        shell: false
      }
    );

  fs.closeSync(logFd);

  child.unref();

  try {
    await waitForFile(
      resultPath,
      timeoutMilliseconds
    );
  } catch (error) {
    if (fs.existsSync(logPath)) {
      const log =
        fs.readFileSync(
          logPath,
          "utf8"
        );

      if (log) {
        process.stderr.write(log);
      }
    }

    throw error;
  } finally {
    stopProcessGroup(child);
  }
}


function writeScenarioConfig(
  spec,
  resultPath,
  fixturePath,
  runtime
) {
  const config = {
    resultPath,
    fixturePath,
    quitWhenFinished: false,
    mode: spec.formattingMode || null,
    ci002Kind: spec.ci002Kind || null,
    ci002RunFeature:
      spec.ci002RunFeature === true,
    ci002ExpectedLocalValue:
      spec.ci002ExpectedLocalValue || null,
    cases: spec.ci002Cases || null,
    unsavedSource:
      spec.unsavedSource || null,
    unsavedExpected:
      spec.unsavedExpected || null,
    saveSource:
      spec.saveSource || null,
    saveExpected:
      spec.saveExpected || null
  };

  if (runtime) {
    config.runtime = runtime;
  }

  writeJson(
    spec.configPath,
    config
  );
}


async function runScenario(
  vscodeExecutablePath,
  vscodeCliPath,
  lockedRuntime,
  spec
) {
  console.log(
    "\n=== " + spec.heading + " ==="
  );

  const scenarioRoot =
    path.join(
      ACCEPTANCE_ROOT,
      spec.name
    );

  const userDataDir =
    path.join(
      scenarioRoot,
      "user-data"
    );

  const extensionsDir =
    path.join(
      scenarioRoot,
      "extensions"
    );

  const harnessVsix =
    path.join(
      scenarioRoot,
      "harness.vsix"
    );

  const fixturePath =
    path.join(
      scenarioRoot,
      spec.fixtureName
    );

  const resultPath =
    path.join(
      scenarioRoot,
      "result.json"
    );

  const logPath =
    path.join(
      scenarioRoot,
      "vscode.log"
    );

  removePath(scenarioRoot);

  fs.mkdirSync(
    userDataDir,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    extensionsDir,
    {
      recursive: true
    }
  );

  let scenarioRuntime =
    lockedRuntime;

  if (
    spec.runtimeKind ===
    "formatting-test-server"
  ) {
    scenarioRuntime =
      path.join(
        scenarioRoot,
        "formatting-fake-server.py"
      );

    fs.copyFileSync(
      path.join(
        ROOT,
        "test",
        "formatting_fake_server.py"
      ),
      scenarioRuntime
    );

    fs.chmodSync(
      scenarioRuntime,
      0o755
    );
  } else if (
    spec.runtimeKind !== undefined &&
    spec.runtimeKind !== "locked-runtime"
  ) {
    throw new Error(
      "unknown acceptance runtime kind: " +
      String(spec.runtimeKind)
    );
  }

  fs.writeFileSync(
    fixturePath,
    spec.fixture,
    "utf8"
  );

  /*
   * Formatting acceptance must start with the standard VS Code formatting
   * policy already loaded by the workspace. Updating editor.formatOnSave and
   * immediately saving from the harness races VS Code's save participants:
   * the extension host may observe the new configuration before the workbench
   * format-on-save participant does.
   *
   * Preconfigure the workspace exactly as a user would instead. The harness
   * still verifies the effective configuration and registers no formatter of
   * its own.
   */
  if (spec.formattingMode === "real") {
    const workspaceSettingsPath =
      path.join(
        scenarioRoot,
        ".vscode",
        "settings.json"
      );

    fs.mkdirSync(
      path.dirname(workspaceSettingsPath),
      {
        recursive: true
      }
    );

    writeJson(
      workspaceSettingsPath,
      {
        "[protos]": {
          "editor.defaultFormatter":
            "guillermomolina.protos",
          "editor.formatOnSave": true
        }
      }
    );
  }

  writeScenarioConfig(
    spec,
    resultPath,
    fixturePath,
    scenarioRuntime
  );

  run(
    "python3",
    [
      path.join(
        ROOT,
        "test",
        spec.makeHarness
      ),
      harnessVsix
    ]
  );

  const commonCliArgs = [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`
  ];

  run(
    vscodeCliPath,
    [
      ...commonCliArgs,
      "--install-extension",
      CANONICAL_VSIX,
      "--force"
    ]
  );

  run(
    vscodeCliPath,
    [
      ...commonCliArgs,
      "--install-extension",
      harnessVsix,
      "--force"
    ]
  );

  const installed =
    runCapture(
      vscodeCliPath,
      [
        ...commonCliArgs,
        "--list-extensions",
        "--show-versions"
      ]
    );

  if (installed) {
    console.log(installed);
  }

  if (
    !installed
      .split(/\r?\n/)
      .some(
        (line) =>
          line.trim() ===
          EXTENSION_INSTALL_ID
      )
  ) {
    throw new Error(
      "expected packaged Protos extension " +
      EXTENSION_INSTALL_ID +
      " was not installed"
    );
  }

  console.log(
    "INSTALLED_EXTENSION_IDENTITY=" +
    EXTENSION_INSTALL_ID
  );

  const launchArgs = [
    "-a",
    vscodeExecutablePath,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-cached-data",
    "--disable-workspace-trust",
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    "--new-window",
    spec.name === "clean-install"
      ? fixturePath
      : scenarioRoot
  ];

  const forbiddenOption =
    "--extensionDevelopment" + "Path";

  if (
    launchArgs.some(
      (argument) =>
        String(argument).includes(
          forbiddenOption
        )
    )
  ) {
    throw new Error(
      "forbidden extension development " +
      "path option detected"
    );
  }

  await launchScenario(
    vscodeExecutablePath,
    launchArgs,
    resultPath,
    logPath,
    spec.timeoutMilliseconds
  );

  try {
    run(
      "python3",
      [
        path.join(ROOT, "test", spec.validator),
        resultPath
      ]
    );
  } catch (error) {
    console.error("CI002_VALIDATOR_FAILED=" + spec.name);

    for (const [label, filename] of [
      ["RESULT", resultPath],
      ["VSCODE_LOG", logPath]
    ]) {
      if (fs.existsSync(filename)) {
        console.error("CI002_" + label + "_PATH=" + filename);
        console.error(
          fs.readFileSync(filename, "utf8").slice(-12000)
        );
      }
    }

    throw error;
  }

  const result = JSON.parse(
    fs.readFileSync(resultPath, "utf8")
  );

  if (result.status !== "pass") {
    throw new Error(
      "CI002 scenario did not pass: " + spec.name
    );
  }

  return {
    name: spec.name,
    status: "PASS",
    resultPath,
    resultSha256: sha256File(resultPath),
    result
  };
}


async function main() {
  const ci002Focal =
    process.argv.length === 3 &&
    process.argv[2] === "--ci002-lsp-baseline-only";

  if (process.argv.length !== 2 && !ci002Focal) {
    throw new Error("Unknown acceptance argument");
  }

  console.log(
    "PROTOS_VSCODE_ACCEPTANCE_TEST=BEGIN"
  );

  console.log(
    "VS_CODE_TEST_VERSION=" +
    VSCODE_VERSION
  );

  if (
    process.platform !== "linux" ||
    process.arch !== "x64"
  ) {
    throw new Error(
      "acceptance requires linux x64"
    );
  }

  const ci002 = classifyLockedRelease(
    JSON.parse(fs.readFileSync(
      path.join(ROOT, "protos-source.lock.json"),
      "utf8"
    ))
  );

  console.log(
    "CI002_REQUIRED_RELEASE=" + ci002.requiredRelease
  );
  console.log(
    "CI002_LOCKED_RELEASE=" + ci002.lockedTag
  );
  console.log(
    "CI002_RELEASE_GATE=" +
    (ci002.eligibleForFeatureTests
      ? "ELIGIBLE"
      : "BLOCKED_RELEASE")
  );

  removePath(RAW_VSIX);
  removePath(CANONICAL_VSIX);
  removePath(CANONICAL_SHA);
  removePath(ACCEPTANCE_ROOT);
  removePath(RUNTIME_ROOT);

  run(
    "npm",
    [
      "run",
      "package:vsix",
      "--",
      "--out",
      RAW_VSIX
    ]
  );

  run(
    "python3",
    [
      path.join(
        ROOT,
        "test",
        "validate_vsix.py"
      ),
      RAW_VSIX
    ]
  );

  const sourceEpoch =
    runCapture(
      "git",
      [
        "show",
        "-s",
        "--format=%ct",
        "HEAD"
      ]
    );

  run(
    "node",
    [
      path.join(
        ROOT,
        "scripts",
        "canonicalize_vsix.js"
      ),
      RAW_VSIX,
      CANONICAL_VSIX,
      sourceEpoch
    ]
  );

  run(
    "python3",
    [
      path.join(
        ROOT,
        "test",
        "validate_reproducibility.py"
      ),
      RAW_VSIX
    ]
  );

  const canonicalSha =
    sha256File(
      CANONICAL_VSIX
    );

  fs.writeFileSync(
    CANONICAL_SHA,
    canonicalSha +
      "  protos-vscode.vsix\n",
    "utf8"
  );

  const vsixSourceRevision = runCapture(
    "git",
    ["rev-parse", "HEAD"]
  );

  console.log(
    "CI002_VSIX_SHA256=" + canonicalSha
  );
  console.log(
    "CI002_VSIX_SOURCE_REVISION=" + vsixSourceRevision
  );

  const runtime =
    runCapture(
      "python3",
      [
        path.join(
          ROOT,
          "scripts",
          "install_locked_protos_runtime.py"
        ),
        RUNTIME_ROOT
      ]
    );

  console.log(
    "LOCKED_RUNTIME=" +
    runtime
  );

  run(
    runtime,
    [
      "--version"
    ]
  );

  run(
    "python3",
    [
      path.join(
        ROOT,
        "test",
        "released_formatter_acceptance.py"
      ),
      runtime
    ]
  );

  process.chdir(ROOT);

  const vscodeExecutablePath =
    await downloadAndUnzipVSCode(
      VSCODE_VERSION
    );

  console.log(
    "VS_CODE_EXECUTABLE=" +
    vscodeExecutablePath
  );

  const [
    vscodeCliPath
  ] =
    resolveCliArgsFromVSCodeExecutablePath(
      vscodeExecutablePath,
      {
        reuseMachineInstall: true
      }
    );

  const scenarios = [
    {
      name: "ci002-lsp-baseline",
      heading: "CI002 REAL LSP DIAGNOSTICS",
      makeHarness: "formatting_harness_make_vsix.py",
      validator: "ci002_diagnostics_validate.py",
      configPath: "/tmp/protos-vscode-lm011-d2.json",
      fixtureName: "diagnostics.protos",
      fixture: "name\\nother",
      timeoutMilliseconds: 90000,
      runtimeKind: "locked-runtime",
      formattingMode: "ci002-diagnostics",
      ci002Kind: "baseline",
      ci002Cases: BASELINE
    },
    {
      name: "clean-install",
      heading:
        "CLEAN INSTALLED EXTENSION",
      makeHarness:
        "clean_install_make_vsix.py",
      validator:
        "clean_install_validate.py",
      configPath:
        "/tmp/protos-vscode-i3a.json",
      fixtureName:
        "fixture.protos",
      fixture:
        'print("clean-install")\n',
      timeoutMilliseconds:
        60000
    },
    {
      name: "real-run",
      heading:
        "REAL RUN",
      makeHarness:
        "clean_run_make_vsix.py",
      validator:
        "clean_run_validate.py",
      configPath:
        "/tmp/protos-vscode-i3b.json",
      fixtureName:
        "fixture.protos",
      fixture:
        'print("VS_CODE_RUN")\n',
      timeoutMilliseconds:
        90000
    },
    {
      name: "real-debug",
      heading:
        "REAL DEBUG",
      makeHarness:
        "debug_harness_make_vsix.py",
      validator:
        "debug_harness_validate.py",
      configPath:
        "/tmp/protos-vscode-i3c.json",
      fixtureName:
        "debug_fixture.protos",
      fixture:
        'x: 41\n' +
        'print(x)\n' +
        'print("done")\n',
      timeoutMilliseconds:
        120000
    },
    {
      name: "formatting-protocol",
      heading:
        "DETERMINISTIC FORMAT DOCUMENT PROTOCOL",
      makeHarness:
        "formatting_harness_make_vsix.py",
      validator:
        "formatting_harness_validate.py",
      configPath:
        "/tmp/protos-vscode-lm011-d2.json",
      fixtureName:
        "formatting_fixture.protos",
      fixture:
        "value: 1\n",
      timeoutMilliseconds:
        90000,
      runtimeKind:
        "formatting-test-server"
    },
    {
      name: "real-formatting",
      heading:
        "REAL RELEASED RUNTIME FORMAT DOCUMENT / FORMAT ON SAVE",
      makeHarness:
        "formatting_harness_make_vsix.py",
      validator:
        "formatting_real_harness_validate.py",
      configPath:
        "/tmp/protos-vscode-lm011-d2.json",
      fixtureName:
        "formatting_fixture.protos",
      fixture:
        "diskValue: 9\n",
      timeoutMilliseconds:
        120000,
      runtimeKind:
        "locked-runtime",
      formattingMode:
        "real",
      unsavedSource:
        "value:1",
      unsavedExpected:
        "value: 1\n",
      saveSource:
        "saved:2",
      saveExpected:
        "saved: 2\n"
    }
  ];

  if (ci002.eligibleForFeatureTests) {
    scenarios.push({
      name: "ci002-lsp-features",
      heading: "CI002 RELEASED FEATURE DIAGNOSTICS",
      makeHarness: "formatting_harness_make_vsix.py",
      validator: "ci002_diagnostics_validate.py",
      configPath: "/tmp/protos-vscode-lm011-d2.json",
      fixtureName: "features.protos",
      fixture: "name\\nother",
      timeoutMilliseconds: 480000,
      runtimeKind: "locked-runtime",
      formattingMode: "ci002-diagnostics",
      ci002Kind: "features",
      ci002Cases: FEATURES
    });

    scenarios.push({
      name: "ci002-format-features",
      heading: "CI002 REAL FEATURE FORMATTING",
      makeHarness: "formatting_harness_make_vsix.py",
      validator: "formatting_real_harness_validate.py",
      configPath: "/tmp/protos-vscode-lm011-d2.json",
      fixtureName: "features-format.protos",
      fixture: "value: 1\n",
      timeoutMilliseconds: 120000,
      runtimeKind: "locked-runtime",
      formattingMode: "real",
      unsavedSource:
        "for(x in xs){x}\n" +
        "for(i,0,5){i}\n" +
        "for(i,10,0,-2){i}",
      unsavedExpected:
        "for(x in xs) { x }\n" +
        "for(i, 0, 5) { i }\n" +
        "for(i, 10, 0, -2) { i }\n",
      saveSource:
        "x:a~ ~b& -c\n" +
        "f:()=>{return 1}\n" +
        "ascending:Range(0,4)\n" +
        "descending:InvertedRange(4,0)",
      saveExpected:
        "x: a ~ ~b & -c\n" +
        "f: () => { return 1 }\n" +
        "ascending: Range(0, 4)\n" +
        "descending: InvertedRange(4, 0)\n"
    });

    scenarios.push({
      name: "ci002-run-features",
      heading: "CI002 REAL FEATURE EXECUTION",
      makeHarness: "clean_run_make_vsix.py",
      validator: "ci002_run_validate.py",
      configPath: "/tmp/protos-vscode-i3b.json",
      fixtureName: "ci002-run.protos",
      fixture: fs.readFileSync(
        path.join(
          ROOT, "test", "fixtures",
          "ci002_run_features.protos"
        ),
        "utf8"
      ),
      timeoutMilliseconds: 120000,
      runtimeKind: "locked-runtime",
      ci002RunFeature: true
    });

    scenarios.push({
      name: "ci002-debug-features",
      heading: "CI002 REAL BITWISE DEBUG",
      makeHarness: "debug_harness_make_vsix.py",
      validator: "debug_harness_validate.py",
      configPath: "/tmp/protos-vscode-i3c.json",
      fixtureName: "ci002-debug.protos",
      fixture:
        'x: 12 & 10\n' +
        'print(x)\n' +
        'print("done")\n',
      timeoutMilliseconds: 120000,
      runtimeKind: "locked-runtime",
      ci002ExpectedLocalValue: "8"
    });
  }

  const selectedScenarios = ci002Focal
    ? scenarios.filter(
        (spec) => spec.name === "ci002-lsp-baseline"
      )
    : scenarios;

  if (ci002Focal && selectedScenarios.length !== 1) {
    throw new Error("CI002 focal scenario is missing");
  }

  const requiredCi002Scenarios = [
    "ci002-lsp-features",
    "ci002-run-features",
    "ci002-format-features",
    "ci002-debug-features"
  ];

  if (!ci002Focal && ci002.eligibleForFeatureTests) {
    const registered = new Set(
      scenarios.map((scenario) => scenario.name)
    );

    for (const name of requiredCi002Scenarios) {
      if (!registered.has(name)) {
        throw new Error(
          "CI002 missing required scenario: " + name
        );
      }
    }
  }

  const scenarioResults = [];

  for (const spec of selectedScenarios) {
    scenarioResults.push(
      await runScenario(
        vscodeExecutablePath,
        vscodeCliPath,
        runtime,
        spec
      )
    );
  }

  if (!ci002Focal && ci002.eligibleForFeatureTests) {
    const completed = new Set(
      scenarioResults.map((row) => row.name)
    );

    for (const name of requiredCi002Scenarios) {
      if (!completed.has(name)) {
        throw new Error(
          "CI002 required scenario not completed: " + name
        );
      }
    }
  }

  const ci002FinalStatus =
    !ci002.eligibleForFeatureTests
      ? "BLOCKED_RELEASE"
      : ci002Focal
        ? "NOT_RUN"
        : "PASS";

  const featureSurfaceStatus =
    !ci002.eligibleForFeatureTests
      ? "BLOCKED_RELEASE"
      : ci002Focal
        ? "NOT_RUN"
        : "PASS";

  writeJson(
    path.join(ACCEPTANCE_ROOT, "ci002-evidence.json"),
    {
      schemaVersion: 1,
      vscodeVersion: VSCODE_VERSION,
      installedExtension: EXTENSION_INSTALL_ID,
      vsixSourceRevision,
      vsixSha256: canonicalSha,
      scenarioResults,
      baselineScenarios: scenarioResults
        .filter((scenario) =>
          !scenario.name.endsWith("-features")
        )
        .map((scenario) => scenario.name),
      featureScenarios: scenarioResults
        .filter((scenario) =>
          scenario.name.endsWith("-features")
        )
        .map((scenario) => scenario.name),
      baselineStatus: ci002Focal ? "NOT_RUN" : "PASS",
      lspDiagnosticsBaseline: "PASS",
      lspDiagnosticsFeatures:
        featureSurfaceStatus,
      runFeatureAcceptance:
        featureSurfaceStatus,
      formatFeatureAcceptance:
        featureSurfaceStatus,
      debugFeatureAcceptance:
        featureSurfaceStatus,
      ...ci002,
      finalFeatureAcceptance: ci002FinalStatus,
      features: ci002.features.map((feature) => ({
        ...feature,
        status: ci002FinalStatus
      }))
    }
  );

  console.log(
    "CI002_FEATURE_ACCEPTANCE=" +
    ci002FinalStatus
  );
  console.log(
    "CI002_EVIDENCE=" +
    path.join(ACCEPTANCE_ROOT, "ci002-evidence.json")
  );

  console.log(
    "EXTENSION_DEVELOPMENT_PATH_USED=NO"
  );

  console.log(
    ci002Focal
      ? "PROTOS_VSCODE_ACCEPTANCE_TEST=FOCAL_PASS"
      : "PROTOS_VSCODE_ACCEPTANCE_TEST=PASS"
  );
}


main().catch((error) => {
  console.error(
    "PROTOS_VSCODE_ACCEPTANCE_TEST=FAIL"
  );

  console.error(
    error &&
    error.stack
      ? error.stack
      : String(error)
  );

  process.exitCode = 1;
});
