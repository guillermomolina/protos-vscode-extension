const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

async function activate() {
  const resultPath = process.env.PROTOS_I3_RESULT;
  const fixturePath = process.env.PROTOS_I3_FIXTURE;

  const result = {
    status: "running",
    cleanInstall: false,
    extensionFound: false,
    extensionActivated: false,
    languageId: null,
    runCommandRegistered: false,
    error: null
  };

  try {
    if (!resultPath || !fixturePath) {
      throw new Error("I3 harness environment is incomplete");
    }

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

    const commands = await vscode.commands.getCommands(true);
    result.runCommandRegistered =
      commands.indexOf("protos.runCurrentFile") >= 0;

    if (result.languageId !== "protos") {
      throw new Error("packaged extension did not register .protos language");
    }

    if (!result.runCommandRegistered) {
      throw new Error("packaged extension did not register Run Current File");
    }

    result.cleanInstall = true;
    result.status = "pass";
  } catch (error) {
    result.status = "fail";
    result.error = error instanceof Error ? error.message : String(error);
  }

  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");

  if (result.status === "fail") {
    throw new Error(result.error);
  }
}

module.exports = { activate };
