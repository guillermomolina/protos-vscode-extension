const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function loadHarnessConfig() {
  const configPath =
    process.env.PROTOS_I3_CONFIG || "/tmp/protos-vscode-i3a.json";

  if (!fs.existsSync(configPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

async function activate() {
  const config = loadHarnessConfig();
  const resultPath =
    process.env.PROTOS_I3_RESULT || config.resultPath;
  const fixturePath =
    process.env.PROTOS_I3_FIXTURE || config.fixturePath;

  const result = {
    status: "running",
    cleanInstall: false,
    extensionFound: false,
    extensionActivated: false,
    languageId: null,
    runCommandRegistered: false,
    installedGrammarValidated: false,
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

    const grammarEntries =
      extension.packageJSON?.contributes?.grammars;

    if (
      !Array.isArray(grammarEntries) ||
      grammarEntries.length !== 1 ||
      grammarEntries[0].language !== "protos" ||
      grammarEntries[0].scopeName !== "source.protos" ||
      grammarEntries[0].path !== "./syntaxes/protos.tmLanguage.json"
    ) {
      throw new Error("installed TextMate contribution mismatch");
    }

    const installedGrammarPath = path.join(
      extension.extensionPath,
      "syntaxes",
      "protos.tmLanguage.json"
    );

    const installedGrammar = JSON.parse(
      fs.readFileSync(installedGrammarPath, "utf8")
    );

    const intrinsicRule =
      installedGrammar.repository?.reserved?.patterns?.find(
        (rule) => rule.name === "variable.language.protos"
      );

    if (
      installedGrammar.scopeName !== "source.protos" ||
      !intrinsicRule ||
      !intrinsicRule.match.includes("(?:this|context)") ||
      intrinsicRule.match.includes("args")
    ) {
      throw new Error("installed TextMate intrinsic scope mismatch");
    }

    result.installedGrammarValidated = true;

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
