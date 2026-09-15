const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function failResult(result, message) {
  result.status = "fail";
  result.error = message;
}

function scalarValueString(variable) {
  if (!variable) return "";
  if (typeof variable.value === "string") return variable.value;
  return String(variable.value);
}

async function activate() {
  const resultPath = process.env.PROTOS_I3C_RESULT;
  const fixturePath = process.env.PROTOS_I3C_FIXTURE;
  const runtime = process.env.PROTOS_I3C_RUNTIME;

  const result = {
    status: "running",
    extensionFound: false,
    extensionActivated: false,
    breakpointInstalled: false,
    stoppedAtBreakpoint: false,
    stackFramesObserved: 0,
    sourceLocationMatches: false,
    scopesObserved: 0,
    localsObserved: false,
    expectedLocalValueObserved: false,
    nextCompleted: false,
    continueCompleted: false,
    terminatedCleanly: false,
    error: null
  };

  let finished = false;

  const writeResult = () => {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(
      resultPath,
      JSON.stringify(result, null, 2) + "\n",
      "utf8"
    );
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    writeResult();
    await new Promise((resolve) => setTimeout(resolve, 700));
    await vscode.commands.executeCommand("workbench.action.quit");
  };

  try {
    const extension = vscode.extensions.getExtension("guillermomolina.protos");
    result.extensionFound = !!extension;
    if (!extension) {
      throw new Error("guillermomolina.protos is not installed");
    }

    await extension.activate();
    result.extensionActivated = extension.isActive;

    if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) {
      throw new Error("debug harness requires a workspace folder");
    }

    await vscode.workspace.getConfiguration("protos").update(
      "runtime.executable",
      runtime,
      vscode.ConfigurationTarget.Global
    );

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(fixturePath)
    );
    await vscode.window.showTextDocument(document);

    const breakpoint = new vscode.SourceBreakpoint(
      new vscode.Location(document.uri, new vscode.Position(1, 0)),
      true
    );
    vscode.debug.addBreakpoints([breakpoint]);
    result.breakpointInstalled = true;

    const terminated = new Promise((resolve) => {
      const disposable = vscode.debug.onDidTerminateDebugSession(async (session) => {
        if (session && session.type === "protos") {
          result.terminatedCleanly = true;
          disposable.dispose();
          resolve();
        }
      });
    });

    const started = await vscode.debug.startDebugging(
      vscode.workspace.workspaceFolders[0],
      {
        type: "protos",
        request: "launch",
        name: "LM009-I3-C Debug",
        program: fixturePath,
        args: []
      }
    );

    if (!started) {
      throw new Error("VS Code refused to start the Protos debug session");
    }

    let session = vscode.debug.activeDebugSession;
    for (let attempt = 0; attempt < 60 && !session; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      session = vscode.debug.activeDebugSession;
    }

    if (!session || session.type !== "protos") {
      throw new Error("active debug session is not the Protos debugger");
    }

    let stackResponse;
    let threadId;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const threads = await session.customRequest("threads");
        if (threads && Array.isArray(threads.threads) && threads.threads.length) {
          threadId = threads.threads[0].id;
          stackResponse = await session.customRequest("stackTrace", {
            threadId,
            startFrame: 0,
            levels: 20
          });
          if (
            stackResponse &&
            Array.isArray(stackResponse.stackFrames) &&
            stackResponse.stackFrames.length
          ) {
            break;
          }
        }
      } catch (_) {
        // The request can race startup; retry until the bounded timeout.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (
      !stackResponse ||
      !Array.isArray(stackResponse.stackFrames) ||
      !stackResponse.stackFrames.length
    ) {
      throw new Error("no stopped stack frame observed after breakpoint");
    }

    result.stoppedAtBreakpoint = true;
    result.stackFramesObserved = stackResponse.stackFrames.length;

    const top = stackResponse.stackFrames[0];
    if (
      top.source &&
      top.source.path &&
      path.resolve(top.source.path) === path.resolve(fixturePath) &&
      Number.isInteger(top.line) &&
      top.line === 2
    ) {
      result.sourceLocationMatches = true;
    }

    if (threadId === undefined) {
      throw new Error("no debugger thread id available");
    }

    const scopes = await session.customRequest("scopes", {
      frameId: top.id
    });

    if (scopes && Array.isArray(scopes.scopes)) {
      result.scopesObserved = scopes.scopes.length;
      for (const scope of scopes.scopes) {
        if (!scope || !scope.variablesReference) continue;

        let variables;
        try {
          variables = await session.customRequest("variables", {
            variablesReference: scope.variablesReference,
            start: 0,
            count: 100
          });
        } catch (_) {
          continue;
        }

        if (!variables || !Array.isArray(variables.variables)) continue;

        const localNames = variables.variables.map((v) => v.name);
        if (localNames.includes("x")) {
          result.localsObserved = true;
          const x = variables.variables.find((v) => v.name === "x");
          result.expectedLocalValueObserved =
            scalarValueString(x) === "41";
          break;
        }
      }
    }

    await session.customRequest("next", {
      threadId,
      singleThread: true
    });

    for (let attempt = 0; attempt < 60; attempt++) {
      const nextStack = await session.customRequest("stackTrace", {
        threadId,
        startFrame: 0,
        levels: 1
      });
      const nextTop =
        nextStack &&
        Array.isArray(nextStack.stackFrames) &&
        nextStack.stackFrames[0];
      if (nextTop && nextTop.line && nextTop.line !== top.line) {
        result.nextCompleted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await session.customRequest("continue", {
      threadId,
      singleThread: false
    });
    result.continueCompleted = true;

    await Promise.race([
      terminated,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("debug session did not terminate")), 30000)
      )
    ]);

    if (!result.sourceLocationMatches) {
      throw new Error("breakpoint stop location did not match the fixture");
    }
    if (result.stackFramesObserved < 1) {
      throw new Error("no stack frames observed");
    }
    if (result.scopesObserved < 1) {
      throw new Error("no debugger scopes observed");
    }
    if (!result.localsObserved) {
      throw new Error("activation-local x was not observed");
    }
    if (!result.expectedLocalValueObserved) {
      throw new Error("debugger value for x was not 41");
    }
    if (!result.nextCompleted) {
      throw new Error("step next did not reach a subsequent source line");
    }
    if (!result.continueCompleted || !result.terminatedCleanly) {
      throw new Error("debug session did not continue and terminate cleanly");
    }

    result.status = "pass";
  } catch (error) {
    failResult(
      result,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    vscode.debug.removeBreakpoints(
      vscode.debug.breakpoints.filter(
        (bp) => bp.location && bp.location.uri && bp.location.uri.fsPath === path.resolve(fixturePath)
      )
    );
    await finish();
  }
}

module.exports = { activate };
