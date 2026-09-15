"use strict";

const path = require("path");
const {
    DEBUG_TYPE,
    createDebugAdapterDescriptorFactory
} = require("./debug_adapter");

const RUN_CURRENT_FILE_COMMAND = "protos.runCurrentFile";
const DEFAULT_RUNTIME_EXECUTABLE = "protos";
const EXECUTABLE_RESOURCE_SCHEMES = new Set(["file", "vscode-remote"]);
const LANGUAGE_CLIENT_ID = "protosLanguageServer";
const LANGUAGE_CLIENT_NAME = "Protos Language Server";
const LANGUAGE_SERVER_ARGUMENTS = Object.freeze(["language-server"]);
const LANGUAGE_SERVER_DOCUMENT_SELECTOR = Object.freeze([
    Object.freeze({ language: "protos" })
]);

let languageServerController;

function executionPathForUri(vscode, uri) {
    if (!EXECUTABLE_RESOURCE_SCHEMES.has(uri.scheme)) {
        return undefined;
    }

    if (uri.scheme === "file") {
        return uri.fsPath;
    }

    // A workspace extension runs where the Remote workspace and launcher live.
    // Convert the decoded remote URI path into a file URI in that extension host
    // before applying host-native filesystem path rules.
    return vscode.Uri.from({ scheme: "file", path: uri.path }).fsPath;
}

function remoteWorkspaceAuthority(vscode) {
    const folders = vscode.workspace.workspaceFolders;
    if (!Array.isArray(folders) || folders.length === 0) {
        return undefined;
    }

    const authorities = new Set();
    for (const folder of folders) {
        const uri = folder && folder.uri;
        if (!uri || uri.scheme !== "vscode-remote") {
            return undefined;
        }
        if (typeof uri.authority !== "string" || uri.authority.length === 0) {
            return undefined;
        }
        authorities.add(uri.authority);
    }

    if (authorities.size !== 1) {
        return undefined;
    }
    return authorities.values().next().value;
}

function createProtosLanguageUriConverters(vscode) {
    const remoteAuthority = remoteWorkspaceAuthority(vscode);

    return {
        code2Protocol(uri) {
            if (
                remoteAuthority !== undefined &&
                uri.scheme === "vscode-remote" &&
                uri.authority === remoteAuthority
            ) {
                return vscode.Uri.from({
                    scheme: "file",
                    path: uri.path,
                    query: uri.query,
                    fragment: uri.fragment
                }).toString();
            }
            return uri.toString();
        },

        protocol2Code(value) {
            const uri = vscode.Uri.parse(value);
            if (remoteAuthority !== undefined && uri.scheme === "file") {
                return vscode.Uri.from({
                    scheme: "vscode-remote",
                    authority: remoteAuthority,
                    path: uri.path,
                    query: uri.query,
                    fragment: uri.fragment
                });
            }
            return uri;
        }
    };
}

function createRunCurrentFile(vscode, pathModule = path) {
    return async function runCurrentFile() {
        if (!vscode.workspace.isTrusted) {
            await vscode.window.showErrorMessage(
                "Protos execution is disabled in Restricted Mode. Trust this workspace to run code."
            );
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            await vscode.window.showErrorMessage("Open a Protos file before running it.");
            return;
        }

        const document = editor.document;
        if (document.languageId !== "protos") {
            await vscode.window.showErrorMessage(
                "The active editor is not a Protos document."
            );
            return;
        }

        if (document.isDirty) {
            const saved = await document.save();
            if (!saved) {
                await vscode.window.showWarningMessage(
                    "Protos run cancelled because the current file was not saved."
                );
                return;
            }
        }

        const configuredRuntime = vscode.workspace
            .getConfiguration("protos")
            .get("runtime.executable", DEFAULT_RUNTIME_EXECUTABLE);

        if (
            typeof configuredRuntime !== "string" ||
            configuredRuntime.trim().length === 0
        ) {
            await vscode.window.showErrorMessage(
                "Configure protos.runtime.executable with a Protos launcher executable."
            );
            return;
        }

        const sourcePath = executionPathForUri(vscode, document.uri);
        if (!sourcePath) {
            await vscode.window.showErrorMessage(
                "Run Current File requires a local or VS Code Remote filesystem resource."
            );
            return;
        }

        const cwd = pathModule.dirname(sourcePath);
        const execution = new vscode.ProcessExecution(
            configuredRuntime,
            [sourcePath],
            { cwd }
        );

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const taskScope = workspaceFolder || vscode.TaskScope.Workspace;
        const task = new vscode.Task(
            { type: "protos", command: "runCurrentFile" },
            taskScope,
            "Run Current Protos File",
            "Protos",
            execution,
            []
        );

        task.detail = sourcePath;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true,
            focus: false,
            showReuseMessage: false
        };

        try {
            await vscode.tasks.executeTask(task);
        } catch (error) {
            const detail =
                error instanceof Error ? error.message : String(error);
            await vscode.window.showErrorMessage(
                `Unable to start the Protos runtime: ${detail}`
            );
        }
    };
}

function createProtosDebugConfigurationProvider(vscode) {
    return {
        async resolveDebugConfiguration(_folder, configuration) {
            if (!vscode.workspace.isTrusted) {
                await vscode.window.showErrorMessage(
                    "Protos debugging is disabled in Restricted Mode. Trust this workspace to debug code."
                );
                return undefined;
            }

            const config = { ...(configuration || {}) };
            const needsActiveFileDefaults =
                !config.request && !config.name && !config.program;

            if (needsActiveFileDefaults) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    await vscode.window.showErrorMessage(
                        "Open a Protos file before starting a debug session."
                    );
                    return undefined;
                }

                const document = editor.document;
                if (document.languageId !== "protos") {
                    await vscode.window.showErrorMessage(
                        "The active editor is not a Protos document."
                    );
                    return undefined;
                }

                const program = executionPathForUri(vscode, document.uri);
                if (!program) {
                    await vscode.window.showErrorMessage(
                        "Protos debugging requires a local or VS Code Remote filesystem resource."
                    );
                    return undefined;
                }

                config.type = DEBUG_TYPE;
                config.request = "launch";
                config.name = "Debug Protos File";
                config.program = program;
                config.args = [];
            }

            if (!config.type) {
                config.type = DEBUG_TYPE;
            }
            if (config.type !== DEBUG_TYPE) {
                return config;
            }

            if (config.request !== "launch") {
                await vscode.window.showErrorMessage(
                    'The current Protos debugger baseline supports request: "launch" only.'
                );
                return undefined;
            }

            if (
                typeof config.program !== "string" ||
                config.program.trim().length === 0
            ) {
                await vscode.window.showErrorMessage(
                    "A Protos debug configuration requires a source-file program path."
                );
                return undefined;
            }

            if (config.args === undefined) {
                config.args = [];
            }
            if (
                !Array.isArray(config.args) ||
                config.args.some((argument) => typeof argument !== "string")
            ) {
                await vscode.window.showErrorMessage(
                    "Protos debug configuration args must be an array of strings."
                );
                return undefined;
            }

            return config;
        }
    };
}

function configuredRuntimeExecutable(vscode) {
    const configuredRuntime = vscode.workspace
        .getConfiguration("protos")
        .get("runtime.executable", DEFAULT_RUNTIME_EXECUTABLE);

    if (
        typeof configuredRuntime !== "string" ||
        configuredRuntime.trim().length === 0
    ) {
        throw new Error(
            "Configure protos.runtime.executable with a Protos launcher executable."
        );
    }
    return configuredRuntime;
}

function createProtosLanguageClient(vscode, languageClientApi) {
    const api = languageClientApi || require("vscode-languageclient/node");
    const runtimeExecutable = configuredRuntimeExecutable(vscode);

    const serverOptions = {
        command: runtimeExecutable,
        args: Array.from(LANGUAGE_SERVER_ARGUMENTS),
        options: { shell: false }
    };
    const clientOptions = {
        documentSelector: LANGUAGE_SERVER_DOCUMENT_SELECTOR.map(
            (selector) => ({ ...selector })
        ),
        uriConverters: createProtosLanguageUriConverters(vscode)
    };

    return new api.LanguageClient(
        LANGUAGE_CLIENT_ID,
        LANGUAGE_CLIENT_NAME,
        serverOptions,
        clientOptions
    );
}

function createProtosLanguageServerController(vscode, languageClientApi) {
    let client;

    return {
        async start() {
            if (!vscode.workspace.isTrusted) {
                return undefined;
            }
            if (client) {
                return client;
            }

            try {
                const candidate =
                    createProtosLanguageClient(vscode, languageClientApi);
                await candidate.start();
                client = candidate;
                return client;
            } catch (error) {
                const detail =
                    error instanceof Error ? error.message : String(error);
                await vscode.window.showErrorMessage(
                    `Unable to start the Protos language server: ${detail}`
                );
                client = undefined;
                return undefined;
            }
        },

        async stop() {
            const current = client;
            client = undefined;
            if (current) {
                await current.stop();
            }
        }
    };
}

async function activate(context) {
    const vscode = require("vscode");

    const runDisposable = vscode.commands.registerCommand(
        RUN_CURRENT_FILE_COMMAND,
        createRunCurrentFile(vscode)
    );

    const debugOutput = vscode.window.createOutputChannel("Protos Debug");
    const debugProvider = createProtosDebugConfigurationProvider(vscode);
    const debugFactory = createDebugAdapterDescriptorFactory(vscode, {
        outputChannel: debugOutput,
        defaultRuntimeExecutable: DEFAULT_RUNTIME_EXECUTABLE
    });

    const debugProviderDisposable =
        vscode.debug.registerDebugConfigurationProvider(
            DEBUG_TYPE,
            debugProvider
        );
    const debugFactoryDisposable =
        vscode.debug.registerDebugAdapterDescriptorFactory(
            DEBUG_TYPE,
            debugFactory
        );

    languageServerController =
        createProtosLanguageServerController(vscode);

    const trustDisposable =
        typeof vscode.workspace.onDidGrantWorkspaceTrust === "function"
            ? vscode.workspace.onDidGrantWorkspaceTrust(() => {
                void languageServerController.start();
            })
            : { dispose() {} };

    context.subscriptions.push(
        runDisposable,
        debugOutput,
        debugFactory,
        debugProviderDisposable,
        debugFactoryDisposable,
        trustDisposable
    );

    await languageServerController.start();
}

async function deactivate() {
    if (languageServerController) {
        const current = languageServerController;
        languageServerController = undefined;
        await current.stop();
    }
}

module.exports = {
    activate,
    deactivate,
    createRunCurrentFile,
    createProtosDebugConfigurationProvider,
    createProtosLanguageClient,
    createProtosLanguageServerController,
    configuredRuntimeExecutable,
    executionPathForUri,
    remoteWorkspaceAuthority,
    createProtosLanguageUriConverters,
    RUN_CURRENT_FILE_COMMAND,
    DEFAULT_RUNTIME_EXECUTABLE,
    EXECUTABLE_RESOURCE_SCHEMES,
    LANGUAGE_CLIENT_ID,
    LANGUAGE_CLIENT_NAME,
    LANGUAGE_SERVER_ARGUMENTS,
    LANGUAGE_SERVER_DOCUMENT_SELECTOR
};
