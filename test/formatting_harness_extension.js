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



async function activateReal(config) {
  const resultPath =
    config.resultPath;

  const fixturePath =
    config.fixturePath;

  const runtime =
    config.runtime;

  const unsavedSource =
    config.unsavedSource;

  const unsavedExpected =
    config.unsavedExpected;

  const saveSource =
    config.saveSource;

  const saveExpected =
    config.saveExpected;

  const result = {
    status: "running",

    extensionFound: false,
    extensionActivated: false,
    languageId: null,

    runtimeConfigured: false,
    serverReady: false,

    formatDocumentCommandCompleted: false,
    formatDocumentResultExact: false,
    namedIdempotentFormatDocument: false,
    unsavedBufferFormatting: false,
    diskUnchangedDuringUnsavedFormatting: false,

    formatOnSaveEnabled: false,
    formatOnSaveResultExact: false,
    diskContentCanonicalAfterSave: false,
    namedIdempotentFormatOnSave: false,
    namedLabelsPreserved: false,
    ci002NamedFormatter: config.ci002NamedFormatter === true,

    extensionDevelopmentPathUsed: false,
    testServerUsed: false,
    realTool010Runtime: true,
    independentTypescriptFormatter: false,

    error: null
  };

  const writeResult = () => {
    if (!resultPath) {
      throw new Error(
        "LM011-E result path is missing"
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
      !unsavedSource ||
      !unsavedExpected ||
      !saveSource ||
      !saveExpected
    ) {
      throw new Error(
        "LM011-E harness configuration is incomplete"
      );
    }

    if (!fs.existsSync(runtime)) {
      throw new Error(
        "LM011-E locked runtime does not exist: " +
        runtime
      );
    }

    const diskBeforeUnsaved =
      fs.readFileSync(
        fixturePath,
        "utf8"
      );

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

    await replaceDocumentText(
      editor,
      unsavedSource
    );

    if (!document.isDirty) {
      throw new Error(
        "LM011-E unsaved fixture unexpectedly became clean"
      );
    }

    await waitFor(
      async () => {
        await vscode.commands.executeCommand(
          "editor.action.formatDocument"
        );

        return (
          document.getText() ===
          unsavedExpected
        );
      },
      "released-runtime Format Document TextEdit application",
      60000
    );

    result.formatDocumentCommandCompleted =
      true;

    result.serverReady = true;

    result.formatDocumentResultExact =
      document.getText() ===
      unsavedExpected;

    if (config.ci002NamedFormatter) {
      const firstPass = document.getText();

      await vscode.commands.executeCommand(
        "editor.action.formatDocument"
      );

      result.namedIdempotentFormatDocument =
        document.getText() === firstPass &&
        document.isDirty &&
        fs.readFileSync(fixturePath, "utf8") === diskBeforeUnsaved;

      if (!result.namedIdempotentFormatDocument) {
        throw new Error(
          "D237 Format Document is not idempotent"
        );
      }
    }

    result.diskUnchangedDuringUnsavedFormatting =
      fs.readFileSync(
        fixturePath,
        "utf8"
      ) === diskBeforeUnsaved;

    result.unsavedBufferFormatting =
      document.isDirty &&
      result.formatDocumentResultExact &&
      result.diskUnchangedDuringUnsavedFormatting;

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
        "LM011-E language-specific formatOnSave "
        + "configuration is not active"
      );
    }

    await replaceDocumentText(
      editor,
      saveSource
    );

    if (!document.isDirty) {
      throw new Error(
        "LM011-E formatOnSave fixture unexpectedly became clean"
      );
    }

    await vscode.commands.executeCommand(
      "workbench.action.files.save"
    );

    await waitFor(
      () =>
        document.getText() ===
          saveExpected &&
        document.isDirty === false,
      "released-runtime formatOnSave TextEdit and save completion",
      60000
    );

    await waitFor(
      () =>
        fs.existsSync(fixturePath) &&
        fs.readFileSync(
          fixturePath,
          "utf8"
        ) === saveExpected,
      "released-runtime canonical formatted content on disk",
      60000
    );

    result.formatOnSaveResultExact =
      document.getText() ===
      saveExpected;

    result.diskContentCanonicalAfterSave =
      fs.readFileSync(
        fixturePath,
        "utf8"
      ) === saveExpected;

    if (config.ci002NamedFormatter) {
      const savedCanonical = document.getText();

      await vscode.commands.executeCommand(
        "editor.action.formatDocument"
      );

      result.namedIdempotentFormatOnSave =
        document.getText() === savedCanonical &&
        !document.isDirty &&
        fs.readFileSync(fixturePath, "utf8") === savedCanonical;

      result.namedLabelsPreserved =
        unsavedExpected.includes("f(c: 3, 1, 2)") &&
        [
          "identity((created: 41))",
          "[item: 5]",
          "[(createdByArray: 6)]"
        ].every(marker => savedCanonical.includes(marker));

      if (
        !result.namedIdempotentFormatOnSave ||
        !result.namedLabelsPreserved
      ) {
        throw new Error(
          "D237 formatter idempotence or label preservation failed"
        );
      }
    }

    if (!result.extensionActivated) {
      throw new Error(
        "installed Protos extension did not activate"
      );
    }

    if (!result.formatDocumentResultExact) {
      throw new Error(
        "released-runtime Format Document result was not exact"
      );
    }

    if (!result.unsavedBufferFormatting) {
      throw new Error(
        "released-runtime Format Document did not "
        + "operate on the unsaved buffer"
      );
    }

    if (!result.formatOnSaveResultExact) {
      throw new Error(
        "released-runtime formatOnSave result was not exact"
      );
    }

    if (!result.diskContentCanonicalAfterSave) {
      throw new Error(
        "released-runtime formatOnSave did not "
        + "persist canonical text"
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


async function activateCi002Diagnostics(config) {
  const result = {
    status: "running",
    kind: config.ci002Kind,
    realRuntime: true,
    cases: [],
    error: null
  };

  try {
    if (!config.runtime || !Array.isArray(config.cases) ||
        !config.cases.length || !fs.existsSync(config.runtime)) {
      throw new Error("Invalid CI002 runtime or cases");
    }

    await vscode.workspace.getConfiguration("protos").update(
      "runtime.executable",
      config.runtime,
      vscode.ConfigurationTarget.Global
    );

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(config.fixturePath)
    );
    const editor = await vscode.window.showTextDocument(doc);
    const ext = vscode.extensions.getExtension("guillermomolina.protos");

    if (!ext || doc.languageId !== "protos") {
      throw new Error("Installed Protos VSIX unavailable");
    }

    let events = 0;
    const listener = vscode.languages.onDidChangeDiagnostics(event => {
      if (event.uris.some(uri => uri.toString() === doc.uri.toString())) {
        events++;
      }
    });

    try {
      await ext.activate();
      if (!ext.isActive) throw new Error("VSIX did not activate");

      for (const c of config.cases) {
        const errors = () => vscode.languages.getDiagnostics(doc.uri)
          .filter(d => d.severity === vscode.DiagnosticSeverity.Error
            && d.source === "protos");

        const before = events;
        await replaceDocumentText(editor, c.invalid);
        let observedRanges = [];

        try {
          await waitFor(
            () => {
              if (events <= before) {
                return false;
              }

              const current = errors();

              observedRanges = current.map(d => {
                const r = d.range;
                return [
                  r.start.line,
                  r.start.character,
                  r.end.line,
                  r.end.character
                ];
              });

              if (current.length !== 1) {
                return false;
              }

              return !c.range ||
                JSON.stringify(observedRanges[0]) ===
                  JSON.stringify(c.range);
            },
            c.id + " expected parser diagnostic"
          );
        } catch (error) {
          throw new Error(
            c.id + ": expected diagnostic " +
            JSON.stringify(c.range) +
            ", last observed " +
            JSON.stringify(observedRanges) +
            ", diagnostic events=" +
            String(events - before) +
            ", document version=" +
            String(doc.version) +
            "; " + String(error.message)
          );
        }

        if (errors().length !== 1) {
          throw new Error(c.id + ": expected one parser error");
        }

        const r = errors()[0].range;
        const actual = [
          r.start.line, r.start.character,
          r.end.line, r.end.character
        ];

        if (c.range && JSON.stringify(actual) !== JSON.stringify(c.range)) {
          throw new Error(c.id + ": unexpected diagnostic range "
            + JSON.stringify(actual));
        }

        const beforeRepair = events;
        await replaceDocumentText(editor, c.valid);

        const repairVersion = doc.version;

        const diagnosticSnapshot = () =>
          vscode.languages.getDiagnostics(doc.uri).map(d => ({
            source: d.source,
            severity: d.severity,
            code: d.code,
            message: d.message,
            range: [
              d.range.start.line,
              d.range.start.character,
              d.range.end.line,
              d.range.end.character
            ]
          }));

        try {
          await waitFor(
            () =>
              events > beforeRepair &&
              errors().length === 0,
            c.id + " parser-error recovery"
          );
        } catch (error) {
          throw new Error(
            c.id + ": parser recovery failed; " +
            JSON.stringify({
              eventsBeforeRepair: beforeRepair,
              eventsNow: events,
              documentVersion: doc.version,
              repairVersion,
              textMatchesValid: doc.getText() === c.valid,
              diagnostics: diagnosticSnapshot()
            }),
            { cause: error }
          );
        }

        if (doc.getText() !== c.valid) {
          throw new Error(c.id + ": repaired buffer differs");
        }

        result.cases.push({
          id: c.id,
          status: "PASS",
          range: actual
        });
      }
    } finally {
      listener.dispose();
    }

    result.status = "pass";
  } catch (error) {
    result.status = "fail";
    result.error = String(error.stack || error);
  }

  fs.mkdirSync(path.dirname(config.resultPath), { recursive: true });
  fs.writeFileSync(
    config.resultPath,
    JSON.stringify(result, null, 2) + "\n"
  );

  if (result.status !== "pass") throw new Error(result.error);
}



async function activateCi002NamedSignatures(config) {
  const result = {
    status: "running",
    kind: "named-signatures",
    realRuntime: true,
    cases: [],
    error: null
  };

  try {
    if (
      !config.runtime ||
      !fs.existsSync(config.runtime) ||
      !Array.isArray(config.signatureCases) ||
      config.signatureCases.length === 0
    ) {
      throw new Error("Invalid D237 Signature Help configuration");
    }

    await vscode.workspace.getConfiguration("protos").update(
      "runtime.executable",
      config.runtime,
      vscode.ConfigurationTarget.Global
    );

    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(config.fixturePath)
    );
    const editor = await vscode.window.showTextDocument(doc);
    const ext = vscode.extensions.getExtension("guillermomolina.protos");

    if (!ext || doc.languageId !== "protos") {
      throw new Error("Installed Protos VSIX unavailable");
    }

    await ext.activate();

    if (!ext.isActive) {
      throw new Error("Installed Protos VSIX did not activate");
    }

    for (const c of config.signatureCases) {
      const marker = c.source.indexOf("|");

      if (
        marker < 0 ||
        c.source.indexOf("|", marker + 1) >= 0
      ) {
        throw new Error(c.id + ": expected one cursor marker");
      }

      const source =
        c.source.slice(0, marker) +
        c.source.slice(marker + 1);

      const desiredEol = source.includes("\r\n")
        ? vscode.EndOfLine.CRLF
        : vscode.EndOfLine.LF;

      if (doc.eol !== desiredEol) {
        const eolApplied = await editor.edit(
          builder => builder.setEndOfLine(desiredEol)
        );

        if (!eolApplied || doc.eol !== desiredEol) {
          throw new Error(
            c.id + ": failed to configure document EOL"
          );
        }
      }

      await replaceDocumentText(editor, source);

      if (
        doc.getText() !== source ||
        doc.eol !== desiredEol
      ) {
        throw new Error(
          c.id + ": buffer text/EOL mismatch; " +
          JSON.stringify({
            expectedEol: desiredEol,
            actualEol: doc.eol,
            expectedLength: source.length,
            actualLength: doc.getText().length,
            sameNormalizedText:
              doc.getText().replace(/\r\n/g, "\n") ===
              source.replace(/\r\n/g, "\n")
          })
        );
      }

      const version = doc.version;
      const position = doc.positionAt(marker);
      const coordinates = [position.line, position.character];

      if (
        c.expectedPosition &&
        JSON.stringify(coordinates) !==
          JSON.stringify(c.expectedPosition)
      ) {
        throw new Error(
          c.id + ": UTF-16 position mismatch: " +
          JSON.stringify(coordinates)
        );
      }

      let accepted = null;

      await waitFor(
        async () => {
          if (
            doc.version !== version ||
            doc.getText() !== source
          ) {
            throw new Error(c.id + ": document changed during request");
          }

          let help;

          try {
            help = await vscode.commands.executeCommand(
              "vscode.executeSignatureHelpProvider",
              doc.uri,
              position
            );
          } catch (_) {
            return false;
          }

          if (
            !help ||
            !Array.isArray(help.signatures) ||
            help.signatures.length !== 1
          ) {
            return false;
          }

          const signature =
            help.signatures[help.activeSignature || 0];

          if (
            !signature ||
            signature.label !== c.expectedLabel ||
            help.activeParameter !== c.expectedActiveParameter
          ) {
            return false;
          }

          accepted = {
            id: c.id,
            status: "PASS",
            signatureLabel: signature.label,
            activeParameter: help.activeParameter,
            position: coordinates,
            documentVersion: version
          };

          return true;
        },
        c.id + " real named Signature Help",
        60000
      );

      result.cases.push(accepted);
    }

    result.status = "pass";
  } catch (error) {
    result.status = "fail";
    result.error = String(error.stack || error);
  }

  fs.mkdirSync(
    path.dirname(config.resultPath),
    { recursive: true }
  );
  fs.writeFileSync(
    config.resultPath,
    JSON.stringify(result, null, 2) + "\n"
  );

  if (result.status !== "pass") {
    throw new Error(result.error);
  }
}


async function activate() {
  const config =
    loadHarnessConfig();

  if (config.mode === "ci002-signatures") {
    await activateCi002NamedSignatures(config);
    return;
  }

  if (config.mode === "ci002-diagnostics") {
    await activateCi002Diagnostics(config);
    return;
  }

  if (config.mode === "real") {
    await activateReal(config);
    return;
  }

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
     * D2 stops here deliberately.
     *
     * Its authority is the deterministic installed-VSIX protocol boundary:
     * an unsaved Protos buffer must produce the standard
     * textDocument/formatting request and receive the expected TextEdit.
     *
     * Format-on-save belongs to LM011-E's real released-runtime E2E, where
     * VS Code exercises the actual language server and TOOL010. Duplicating
     * that assertion against the fake protocol server made D2 depend on
     * workbench save-participant startup ordering and therefore flaky.
     */
    result.formatOnSaveDelegatedToRealRuntime = true;

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
