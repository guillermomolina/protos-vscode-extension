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
  "guillermomolina.protos@0.2.1";


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
    quitWhenFinished: false
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

  run(
    "python3",
    [
      path.join(
        ROOT,
        "test",
        spec.validator
      ),
      resultPath
    ]
  );
}


async function main() {
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
      name: "real-formatting",
      heading:
        "REAL FORMAT DOCUMENT / FORMAT ON SAVE",
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
    }
  ];

  for (const spec of scenarios) {
    await runScenario(
      vscodeExecutablePath,
      vscodeCliPath,
      runtime,
      spec
    );
  }

  console.log(
    "EXTENSION_DEVELOPMENT_PATH_USED=NO"
  );

  console.log(
    "PROTOS_VSCODE_ACCEPTANCE_TEST=PASS"
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
