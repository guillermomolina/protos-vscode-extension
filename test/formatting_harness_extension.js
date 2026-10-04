"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");


function loadHarnessConfig() {
  const configPath =
    process.env.PROTOS_LM011_D2_CONFIG ||
    "/tmp/protos-vscode-lm011-d2.json";

  if (!fs.existsSync(configPath)) {
    return {};
  }

  return JSON.parse(
    fs.readFileSync(
      configPath,
      "utf8"
    )
  );
}


function sleep(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, milliseconds)
  );
}


function readEvidence(filename) {
  if (!fs.existsSync(filename)) {
    return [];
  }

  const entries = [];

  for (
    const line of
    fs.readFileSync(filename, "utf8").split(/\r?\n/)
  ) {
    if (!line.trim()) {
      continue;
    }

    try {
      entries.push(JSON.parse(line));
    } catch (_) {
      // Ignore a partially written final line while the server appends it.
    }
  }

  return entries;
}


function evidenceCount(
  filename,
  eventName
) {
  return readEvidence(filename)
    .filter(
      (entry) =>
        entry.event === eventName
    )
    .length;
}


function evidenceAfter(
  filename,
  eventName,
  offset
) {
  return readEvidence(filename)
    .filter(
      (entry) =>
        entry.event === eventName
    )
    .slice(offset);
}


async function waitFor(
  predicate,
  description,
  timeoutMilliseconds = 30000
) {
  const deadline =
    Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await sleep(100);
  }

  throw new Error(
    "timed out waiting for " +
    description
  );
}


async function replaceDocumentText(
  editor,
  text
) {
  const document =
    editor.document;

  const wholeDocument =
    new vscode.Range(
      document.positionAt(0),
      document.positionAt(
        document.getText().length
      )
    );

  const applied =
    await editor.edit(
      (builder) => {
        builder.replace(
          wholeDocument,
          text
        );
      }
    );

  if (!applied) {
    throw new Error(
      "VS Code refused the acceptance edit"
    );
  }
}


async function activate() {
  const config =
    loadHarnessConfig();

  const resultPath =
    process.env.PROTOS_LM011_D2_RESULT ||
    config.resultPath;

  const fixturePath =
    process.env.PROTOS_LM011_D2_FIXTURE ||
    config.fixturePath;

  const runtime =
    process.env.PROTOS_LM011_D2_RUNTIME ||
    config.runtime;

  const evidencePath =
    runtime
      ? path.join(
          path.dirname(runtime),
          "lsp-evidence.jsonl"
        )
      : null;

  const result = {
    status: "running",

    extensionFound: false,
    extensionActivated: false,
    languageId: null,

    runtimeConfigured: false,
    serverReady: false,

    formatDocumentCommandCompleted: false,
    formatRequestObserved: false,
    formatRequestCount: 0,
    formatDocumentResultExact: false,
    unsavedBufferFormatting: false,

    formatOnSaveEnabled: false,
    formatOnSaveRequestObserved: false,
    formatOnSaveResultExact: false,
    diskContentCanonicalAfterSave: false,

    extensionDevelopmentPathUsed: false,
    testServerUsed: true,
    realTool010Runtime: false,
    independentTypescriptFormatter: false,

    error: null
  };

  const writeResult = () => {
    if (!resultPath) {
      throw new Error(
        "LM011-D2 result path is missing"
      );
    }

    fs.mkdirSync(
      path.dirname(resultPath),
      {
        recursive: true
      }
    );

    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        result,
        null,
        2
      ) + "\n",
      "utf8"
    );
  };

  try {
    if (
      !resultPath ||
      !fixturePath ||
      !runtime ||
      !evidencePath
    ) {
      throw new Error(
        "LM011-D2 harness configuration is incomplete"
      );
    }

    if (!fs.existsSync(runtime)) {
      throw new Error(
        "LM011-D2 test runtime does not exist: " +
        runtime
      );
    }

    /*
     * Configure the scenario-local runtime before activating the installed
     * production extension. The extension therefore follows its real
     * protos.runtime.executable -> <runtime> language-server contract.
     */
    await vscode.workspace
      .getConfiguration("protos")
      .update(
        "runtime.executable",
        runtime,
        vscode.ConfigurationTarget.Global
      );

    result.runtimeConfigured = true;

    const extension =
      vscode.extensions.getExtension(
        "guillermomolina.protos"
      );

    result.extensionFound =
      Boolean(extension);

    if (!extension) {
      throw new Error(
        "guillermomolina.protos is not installed"
      );
    }

    /*
     * Open the Protos document before activating the installed extension.
     * Language contributions are manifest-driven and already available.
     * This lets vscode-languageclient synchronize the already-open document
     * deterministically when its text-document synchronization feature starts,
     * instead of racing document open against asynchronous client startup.
     */
    const document =
      await vscode.workspace.openTextDocument(
        vscode.Uri.file(fixturePath)
      );

    const editor =
      await vscode.window.showTextDocument(
        document
      );

    result.languageId =
      document.languageId;

    if (result.languageId !== "protos") {
      throw new Error(
        "fixture did not resolve to Protos language"
      );
    }

    await extension.activate();

    result.extensionActivated =
      extension.isActive;

    await waitFor(
      () => {
        const evidence =
          readEvidence(evidencePath);

        return (
          evidence.some(
            (entry) =>
              entry.event === "initialize"
          ) &&
          evidence.some(
            (entry) =>
              entry.event === "didOpen" &&
              entry.uri === document.uri.toString()
          )
        );
      },
      "installed extension language client/server initialization"
    );

    result.serverReady = true;

    /*
     * Format Document on an unsaved buffer.
     */
    await replaceDocumentText(
      editor,
      "value:1"
    );

    if (!document.isDirty) {
      throw new Error(
        "unsaved formatting fixture unexpectedly became clean"
      );
    }

    const beforeFormatDocument =
      evidenceCount(
        evidencePath,
        "formatting"
      );

    await vscode.commands.executeCommand(
      "editor.action.formatDocument"
    );

    result.formatDocumentCommandCompleted =
      true;

    await waitFor(
      () =>
        document.getText() ===
        "value: 1\n",
      "Format Document TextEdit application"
    );

    await waitFor(
      () =>
        evidenceCount(
          evidencePath,
          "formatting"
        ) > beforeFormatDocument,
      "Format Document textDocument/formatting request"
    );

    const formatDocumentRequests =
      evidenceAfter(
        evidencePath,
        "formatting",
        beforeFormatDocument
      );

    result.formatRequestObserved =
      formatDocumentRequests.length > 0;

    result.formatDocumentResultExact =
      document.getText() ===
      "value: 1\n";

    result.unsavedBufferFormatting =
      document.isDirty &&
      formatDocumentRequests.some(
        (entry) =>
          entry.text === "value:1"
      );

    /*
     * Enable language-specific standard VS Code format-on-save behaviour.
     * The harness registers no formatter itself.
     */
    const editorConfiguration =
      vscode.workspace.getConfiguration(
        "editor",
        document.uri
      );

    await editorConfiguration.update(
      "defaultFormatter",
      "guillermomolina.protos",
      vscode.ConfigurationTarget.Workspace,
      true
    );

    await editorConfiguration.update(
      "formatOnSave",
      true,
      vscode.ConfigurationTarget.Workspace,
      true
    );

    const effectiveConfiguration =
      vscode.workspace.getConfiguration(
        "editor",
        document.uri
      );

    result.formatOnSaveEnabled =
      effectiveConfiguration.get(
        "formatOnSave"
      ) === true &&
      effectiveConfiguration.get(
        "defaultFormatter"
      ) === "guillermomolina.protos";

    if (!result.formatOnSaveEnabled) {
      throw new Error(
        "language-specific formatOnSave configuration is not active"
      );
    }

    await replaceDocumentText(
      editor,
      "value:1"
    );

    if (!document.isDirty) {
      throw new Error(
        "formatOnSave fixture unexpectedly became clean"
      );
    }

    const beforeSave =
      evidenceCount(
        evidencePath,
        "formatting"
      );

    await vscode.commands.executeCommand(
      "workbench.action.files.save"
    );

    await waitFor(
      () =>
        evidenceCount(
          evidencePath,
          "formatting"
        ) > beforeSave,
      "formatOnSave textDocument/formatting request"
    );

    await waitFor(
      () =>
        document.getText() ===
          "value: 1\n" &&
        document.isDirty === false,
      "formatOnSave TextEdit and save completion"
    );

    await waitFor(
      () =>
        fs.existsSync(fixturePath) &&
        fs.readFileSync(
          fixturePath,
          "utf8"
        ) === "value: 1\n",
      "canonical formatted content on disk"
    );

    const saveRequests =
      evidenceAfter(
        evidencePath,
        "formatting",
        beforeSave
      );

    result.formatOnSaveRequestObserved =
      saveRequests.some(
        (entry) =>
          entry.text === "value:1"
      );

    result.formatOnSaveResultExact =
      document.getText() ===
      "value: 1\n";

    result.diskContentCanonicalAfterSave =
      fs.readFileSync(
        fixturePath,
        "utf8"
      ) === "value: 1\n";

    result.formatRequestCount =
      evidenceCount(
        evidencePath,
        "formatting"
      );

    if (!result.extensionActivated) {
      throw new Error(
        "installed Protos extension did not activate"
      );
    }

    if (!result.formatRequestObserved) {
      throw new Error(
        "Format Document produced no LSP formatting request"
      );
    }

    if (!result.formatDocumentResultExact) {
      throw new Error(
        "Format Document result was not exact"
      );
    }

    if (!result.unsavedBufferFormatting) {
      throw new Error(
        "Format Document did not operate on the unsaved buffer"
      );
    }

    if (!result.formatOnSaveRequestObserved) {
      throw new Error(
        "formatOnSave produced no LSP formatting request"
      );
    }

    if (!result.formatOnSaveResultExact) {
      throw new Error(
        "formatOnSave result was not exact"
      );
    }

    if (!result.diskContentCanonicalAfterSave) {
      throw new Error(
        "formatOnSave did not persist canonical text"
      );
    }

    result.status = "pass";
  } catch (error) {
    result.status = "fail";
    result.error =
      error instanceof Error
        ? error.stack || error.message
        : String(error);
  }

  writeResult();

  if (result.status !== "pass") {
    throw new Error(result.error);
  }
}


module.exports = {
  activate
};
