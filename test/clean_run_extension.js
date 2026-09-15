const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

async function activate() {
  const resultPath = process.env.PROTOS_I3B_RESULT;
  const fixturePath = process.env.PROTOS_I3B_FIXTURE;
  const runtime = process.env.PROTOS_I3B_RUNTIME;

  const result = {
    status: "running",
    extensionFound: false,
    extensionActivated: false,
    languageId: null,
    runtimeConfigured: false,
    runCommandRegistered: false,
    taskStarted: false,
    taskProcessExitCode: null,
    error: null
  };

  const finish = async (status, error) => {
    result.status = status;
    result.error = error || null;
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await vscode.commands.executeCommand("workbench.action.quit");
  };

  const disposable = vscode.tasks.onDidEndTaskProcess(async (event) => {
    if (!result.taskStarted) {
      return;
    }
    const taskName = event.execution && event.execution.task
      ? event.execution.task.name
      : "";
    if (taskName !== "Run Current Protos File") {
      return;
    }

    result.taskProcessExitCode = event.exitCode;

    if (event.exitCode === 0) {
      await finish("pass", null);
    } else {
      await finish(
        "fail",
        "Run Current Protos File exited with code " + String(event.exitCode)
      );
    }
    disposable.dispose();
  });

  try {
    const extension = vscode.extensions.getExtension("guillermomolina.protos");
    result.extensionFound = !!extension;
    if (!extension) {
      throw new Error("guillermomolina.protos is not installed");
    }

    await extension.activate();
    result.extensionActivated = extension.isActive;

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(fixturePath)
    );
    await vscode.window.showTextDocument(document);
    result.languageId = document.languageId;

    if (result.languageId !== "protos") {
      throw new Error("fixture did not resolve to Protos language");
    }

    await vscode.workspace
      .getConfiguration("protos")
      .update("runtime.executable", runtime, true);
    result.runtimeConfigured = true;

    const commands = await vscode.commands.getCommands(true);
    result.runCommandRegistered =
      commands.indexOf("protos.runCurrentFile") >= 0;

    if (!result.runCommandRegistered) {
      throw new Error("Run Current File command is not registered");
    }

    result.taskStarted = true;

    await vscode.commands.executeCommand("protos.runCurrentFile");
  } catch (error) {
    await finish(
      "fail",
      error instanceof Error ? error.message : String(error)
    );
    disposable.dispose();
  }
}

module.exports = { activate };
