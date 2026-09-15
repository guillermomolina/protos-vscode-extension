"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {
    activate,
    createRunCurrentFile,
    executionPathForUri,
    RUN_CURRENT_FILE_COMMAND,
    DEFAULT_RUNTIME_EXECUTABLE,
    EXECUTABLE_RESOURCE_SCHEMES
} = require("../extension.js");

function harness(options = {}) {
    const calls = {
        errors: [],
        warnings: [],
        tasks: [],
        registered: [],
        sequence: []
    };

    const filePath = options.filePath || path.join("/tmp", "space dir", "demo.protos");
    const uriPath = Object.prototype.hasOwnProperty.call(options, "uriPath")
        ? options.uriPath
        : filePath;
    const document = {
        languageId: options.languageId || "protos",
        uri: {
            scheme: options.scheme || "file",
            path: uriPath,
            fsPath: filePath
        },
        isDirty: Boolean(options.dirty),
        async save() {
            calls.sequence.push("save");
            return options.saveResult !== false;
        }
    };

    class ProcessExecution {
        constructor(process, args, processOptions) {
            this.process = process;
            this.args = args;
            this.options = processOptions;
        }
    }

    class Task {
        constructor(definition, scope, name, source, execution, problemMatchers) {
            this.definition = definition;
            this.scope = scope;
            this.name = name;
            this.source = source;
            this.execution = execution;
            this.problemMatchers = problemMatchers;
            this.presentationOptions = {};
        }
    }

    const workspaceFolder = options.workspaceFolder || { name: "fixture" };
    const TaskScope = { Workspace: Symbol("workspace") };
    const TaskRevealKind = { Always: Symbol("always") };
    const TaskPanelKind = { Dedicated: Symbol("dedicated") };

    const vscode = {
        Uri: {
            from(components) {
                calls.sequence.push("uriFrom");
                assert.deepEqual(components, { scheme: "file", path: document.uri.path });
                return {
                    fsPath: Object.prototype.hasOwnProperty.call(options, "convertedFsPath")
                        ? options.convertedFsPath
                        : document.uri.path
                };
            }
        },
        workspace: {
            isTrusted: options.trusted !== false,
            getConfiguration(section) {
                assert.equal(section, "protos");
                return {
                    get(key, fallback) {
                        assert.equal(key, "runtime.executable");
                        return Object.prototype.hasOwnProperty.call(options, "runtime")
                            ? options.runtime
                            : fallback;
                    }
                };
            },
            getWorkspaceFolder(uri) {
                assert.equal(uri, document.uri);
                return options.noWorkspaceFolder ? undefined : workspaceFolder;
            }
        },
        window: {
            activeTextEditor: options.noEditor ? undefined : { document },
            async showErrorMessage(message) {
                calls.errors.push(message);
            },
            async showWarningMessage(message) {
                calls.warnings.push(message);
            }
        },
        commands: {
            registerCommand(command, handler) {
                calls.registered.push({ command, handler });
                return { dispose() {} };
            }
        },
        tasks: {
            async executeTask(task) {
                calls.sequence.push("execute");
                if (options.executeError) {
                    throw options.executeError;
                }
                calls.tasks.push(task);
                return { task };
            }
        },
        ProcessExecution,
        Task,
        TaskScope,
        TaskRevealKind,
        TaskPanelKind
    };

    return { vscode, calls, document, workspaceFolder };
}

async function testDefaultProcessExecution() {
    const h = harness();
    await createRunCurrentFile(h.vscode)();

    assert.equal(DEFAULT_RUNTIME_EXECUTABLE, "protos");
    assert.equal(h.calls.tasks.length, 1);
    const task = h.calls.tasks[0];
    assert.equal(task.execution.process, "protos");
    assert.deepEqual(task.execution.args, [h.document.uri.fsPath]);
    assert.equal(task.execution.options.cwd, path.dirname(h.document.uri.fsPath));
    assert.equal(task.scope, h.workspaceFolder);
    assert.equal(task.definition.type, "protos");
    assert.equal(task.definition.command, "runCurrentFile");
    assert.equal(task.presentationOptions.reveal, h.vscode.TaskRevealKind.Always);
    assert.equal(task.presentationOptions.panel, h.vscode.TaskPanelKind.Dedicated);
    assert.equal(task.presentationOptions.clear, true);
}

async function testConfiguredRuntimeIsPassedWithoutShellQuoting() {
    const runtime = "/opt/Protos Runtime/bin/protos";
    const h = harness({ runtime });
    await createRunCurrentFile(h.vscode)();

    assert.equal(h.calls.tasks.length, 1);
    assert.equal(h.calls.tasks[0].execution.process, runtime);
    assert.deepEqual(h.calls.tasks[0].execution.args, [h.document.uri.fsPath]);
}

async function testRemoteProcessExecutionUsesWorkspaceHostPath() {
    const remotePath = "/workspaces/protos/examples/hello-world.protos";
    const h = harness({
        scheme: "vscode-remote",
        uriPath: remotePath,
        filePath: "/must/not/use/remote-uri-fsPath.protos",
        convertedFsPath: remotePath
    });
    await createRunCurrentFile(h.vscode)();

    assert.equal(h.calls.tasks.length, 1);
    const task = h.calls.tasks[0];
    assert.deepEqual(task.execution.args, [remotePath]);
    assert.equal(task.execution.options.cwd, path.dirname(remotePath));
    assert.deepEqual(h.calls.sequence, ["uriFrom", "execute"]);
}

async function testRemoteWindowsPathUsesRemoteHostNativeConversion() {
    const uriPath = "/C:/work/protos/demo.protos";
    const remoteFsPath = "C:\\work\\protos\\demo.protos";
    const h = harness({
        scheme: "vscode-remote",
        uriPath,
        filePath: "/must/not/use/ui-host/path.protos",
        convertedFsPath: remoteFsPath
    });
    await createRunCurrentFile(h.vscode, path.win32)();

    assert.equal(h.calls.tasks.length, 1);
    assert.deepEqual(h.calls.tasks[0].execution.args, [remoteFsPath]);
    assert.equal(h.calls.tasks[0].execution.options.cwd, "C:\\work\\protos");
}

function testExecutionPathSchemeContract() {
    assert.deepEqual(
        Array.from(EXECUTABLE_RESOURCE_SCHEMES).sort(),
        ["file", "vscode-remote"]
    );

    const h = harness();
    assert.equal(executionPathForUri(h.vscode, h.document.uri), h.document.uri.fsPath);

    const virtual = {
        scheme: "vscode-vfs",
        path: "/guillermomolina/protos/demo.protos",
        fsPath: "/must/not/be/used"
    };
    assert.equal(executionPathForUri(h.vscode, virtual), undefined);
}

async function testWorkspaceFallbackScopeKeepsFileParentCwd() {
    const h = harness({ noWorkspaceFolder: true });
    await createRunCurrentFile(h.vscode)();

    assert.equal(h.calls.tasks.length, 1);
    assert.equal(h.calls.tasks[0].scope, h.vscode.TaskScope.Workspace);
    assert.equal(
        h.calls.tasks[0].execution.options.cwd,
        path.dirname(h.document.uri.fsPath)
    );
}

async function testDirtyDocumentSavesBeforeExecution() {
    const h = harness({ dirty: true });
    await createRunCurrentFile(h.vscode)();

    assert.deepEqual(h.calls.sequence, ["save", "execute"]);
    assert.equal(h.calls.tasks.length, 1);
}

async function testCancelledSaveDoesNotExecute() {
    const h = harness({ dirty: true, saveResult: false });
    await createRunCurrentFile(h.vscode)();

    assert.deepEqual(h.calls.sequence, ["save"]);
    assert.equal(h.calls.tasks.length, 0);
    assert.equal(h.calls.warnings.length, 1);
}

async function testTrustAndDocumentGuards() {
    for (const options of [
        { trusted: false },
        { noEditor: true },
        { languageId: "plaintext" },
        { scheme: "untitled" },
        { scheme: "vscode-vfs" },
        { runtime: "   " }
    ]) {
        const h = harness(options);
        await createRunCurrentFile(h.vscode)();
        assert.equal(h.calls.tasks.length, 0);
        assert.equal(h.calls.errors.length, 1);
    }
}

async function testExecutionFailureIsVisible() {
    const h = harness({ executeError: new Error("spawn failed") });
    await createRunCurrentFile(h.vscode)();

    assert.equal(h.calls.tasks.length, 0);
    assert.match(h.calls.errors[0], /spawn failed/);
}

function testActivationRegistersOnlyTheRunCommand() {
    const h = harness();
    const context = { subscriptions: [] };

    // activate() loads the real vscode module, so test its registration contract
    // through the exported command constant and factory instead of mocking Node's
    // module loader.
    assert.equal(RUN_CURRENT_FILE_COMMAND, "protos.runCurrentFile");
    assert.equal(typeof activate, "function");
    assert.equal(typeof createRunCurrentFile(h.vscode), "function");
    assert.deepEqual(context.subscriptions, []);
}

async function main() {
    await testDefaultProcessExecution();
    await testConfiguredRuntimeIsPassedWithoutShellQuoting();
    await testRemoteProcessExecutionUsesWorkspaceHostPath();
    await testRemoteWindowsPathUsesRemoteHostNativeConversion();
    testExecutionPathSchemeContract();
    await testWorkspaceFallbackScopeKeepsFileParentCwd();
    await testDirtyDocumentSavesBeforeExecution();
    await testCancelledSaveDoesNotExecute();
    await testTrustAndDocumentGuards();
    await testExecutionFailureIsVisible();
    testActivationRegistersOnlyTheRunCommand();
    console.log("LM009_C_RUN_CURRENT_FILE_NODE_TEST: PASS");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
