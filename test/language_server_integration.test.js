"use strict";

const assert = require("node:assert/strict");
const {
    createProtosLanguageClient,
    createProtosLanguageServerController,
    createProtosLanguageUriConverters,
    remoteWorkspaceAuthority,
    LANGUAGE_CLIENT_ID,
    LANGUAGE_CLIENT_NAME,
    LANGUAGE_SERVER_ARGUMENTS,
    LANGUAGE_SERVER_DOCUMENT_SELECTOR,
    DEFAULT_RUNTIME_EXECUTABLE
} = require("../extension.js");

function encodedPath(pathname) {
    return pathname
        .split("/")
        .map((segment, index) => index === 0 ? "" : encodeURIComponent(segment))
        .join("/");
}

function fakeUri(parts) {
    const value = {
        scheme: parts.scheme,
        authority: parts.authority || "",
        path: parts.path || "",
        query: parts.query || "",
        fragment: parts.fragment || "",
        get fsPath() {
            return this.path;
        },
        toString() {
            const hierarchical = this.scheme === "file" || this.authority.length > 0;
            let result = `${this.scheme}:${hierarchical ? "//" + this.authority : ""}${encodedPath(this.path)}`;
            if (this.query.length > 0) {
                result += `?${this.query}`;
            }
            if (this.fragment.length > 0) {
                result += `#${this.fragment}`;
            }
            return result;
        }
    };
    return value;
}

const fakeUriApi = {
    from(parts) {
        return fakeUri(parts);
    },
    parse(value) {
        const parsed = new URL(value);
        return fakeUri({
            scheme: parsed.protocol.slice(0, -1),
            authority: parsed.host,
            path: decodeURIComponent(parsed.pathname),
            query: parsed.search.slice(1),
            fragment: parsed.hash.slice(1)
        });
    }
};

function harness(options = {}) {
    const calls = {
        configurationSections: [],
        configurationKeys: [],
        constructed: [],
        starts: 0,
        stops: 0,
        errors: []
    };

    let remainingStartFailures = options.startFailures || 0;

    class LanguageClient {
        constructor(id, name, serverOptions, clientOptions) {
            this.id = id;
            this.name = name;
            this.serverOptions = serverOptions;
            this.clientOptions = clientOptions;
            calls.constructed.push({ id, name, serverOptions, clientOptions, instance: this });
        }

        async start() {
            calls.starts += 1;
            if (remainingStartFailures > 0) {
                remainingStartFailures -= 1;
                throw new Error("language-server spawn failed");
            }
        }

        async stop() {
            calls.stops += 1;
        }
    }

    const vscode = {
        Uri: fakeUriApi,
        workspace: {
            isTrusted: options.trusted !== false,
            workspaceFolders: options.workspaceFolders,
            getConfiguration(section) {
                calls.configurationSections.push(section);
                return {
                    get(key, fallback) {
                        calls.configurationKeys.push(key);
                        assert.equal(key, "runtime.executable");
                        return Object.prototype.hasOwnProperty.call(options, "runtime")
                            ? options.runtime
                            : fallback;
                    }
                };
            }
        },
        window: {
            async showErrorMessage(message) {
                calls.errors.push(message);
            }
        }
    };

    return { vscode, languageClientApi: { LanguageClient }, calls };
}

async function testExactRatifiedLaunchContract() {
    const runtime = "/opt/Protos Runtime/bin/protos";
    const h = harness({ runtime });

    const client = createProtosLanguageClient(h.vscode, h.languageClientApi);
    assert.ok(client);

    assert.equal(LANGUAGE_CLIENT_ID, "protosLanguageServer");
    assert.equal(LANGUAGE_CLIENT_NAME, "Protos Language Server");
    assert.deepEqual(Array.from(LANGUAGE_SERVER_ARGUMENTS), ["language-server"]);
    assert.deepEqual(
        LANGUAGE_SERVER_DOCUMENT_SELECTOR.map((entry) => ({ ...entry })),
        [{ language: "protos" }]
    );

    const created = h.calls.constructed[0];
    assert.equal(created.serverOptions.command, runtime);
    assert.deepEqual(created.serverOptions.args, ["language-server"]);
    assert.deepEqual(created.serverOptions.options, { shell: false });
    assert.deepEqual(created.clientOptions.documentSelector, [{ language: "protos" }]);
    assert.equal(typeof created.clientOptions.uriConverters.code2Protocol, "function");
    assert.equal(typeof created.clientOptions.uriConverters.protocol2Code, "function");
    assert.deepEqual(h.calls.configurationSections, ["protos"]);
    assert.deepEqual(h.calls.configurationKeys, ["runtime.executable"]);
}

function testRemoteWorkspaceUriBridge() {
    const authority = "dev-container+protos";
    const remoteRoot = fakeUri({
        scheme: "vscode-remote",
        authority,
        path: "/tmp/protos-lm009-g-s5"
    });
    const vscode = harness({
        workspaceFolders: [{ uri: remoteRoot }]
    }).vscode;

    assert.equal(remoteWorkspaceAuthority(vscode), authority);
    const converters = createProtosLanguageUriConverters(vscode);
    const remoteDocument = fakeUri({
        scheme: "vscode-remote",
        authority,
        path: "/tmp/protos-lm009-g-s5/app/Á Main.protos"
    });

    const protocolUri = converters.code2Protocol(remoteDocument);
    assert.equal(
        protocolUri,
        "file:///tmp/protos-lm009-g-s5/app/%C3%81%20Main.protos"
    );

    const editorUri = converters.protocol2Code(protocolUri);
    assert.equal(editorUri.scheme, "vscode-remote");
    assert.equal(editorUri.authority, authority);
    assert.equal(editorUri.path, "/tmp/protos-lm009-g-s5/app/Á Main.protos");
}

function testLocalAndAmbiguousWorkspacesFailClosedToIdentity() {
    const localRoot = fakeUri({ scheme: "file", path: "/workspace/protos" });
    const local = harness({ workspaceFolders: [{ uri: localRoot }] }).vscode;
    assert.equal(remoteWorkspaceAuthority(local), undefined);
    const localConverters = createProtosLanguageUriConverters(local);
    const localDocument = fakeUri({ scheme: "file", path: "/workspace/protos/Main.protos" });
    assert.equal(localConverters.code2Protocol(localDocument), localDocument.toString());
    assert.equal(
        localConverters.protocol2Code(localDocument.toString()).toString(),
        localDocument.toString()
    );

    const mixed = harness({
        workspaceFolders: [
            { uri: fakeUri({ scheme: "vscode-remote", authority: "remote-a", path: "/a" }) },
            { uri: fakeUri({ scheme: "file", path: "/b" }) }
        ]
    }).vscode;
    assert.equal(remoteWorkspaceAuthority(mixed), undefined);

    const twoAuthorities = harness({
        workspaceFolders: [
            { uri: fakeUri({ scheme: "vscode-remote", authority: "remote-a", path: "/a" }) },
            { uri: fakeUri({ scheme: "vscode-remote", authority: "remote-b", path: "/b" }) }
        ]
    }).vscode;
    assert.equal(remoteWorkspaceAuthority(twoAuthorities), undefined);
}

function testRemoteBridgeRejectsForeignRemoteAuthority() {
    const authority = "dev-container+protos";
    const vscode = harness({
        workspaceFolders: [{
            uri: fakeUri({ scheme: "vscode-remote", authority, path: "/workspace" })
        }]
    }).vscode;
    const converters = createProtosLanguageUriConverters(vscode);
    const foreign = fakeUri({
        scheme: "vscode-remote",
        authority: "ssh-remote+elsewhere",
        path: "/workspace/Main.protos"
    });
    assert.equal(converters.code2Protocol(foreign), foreign.toString());
}

async function testDefaultRuntimeUsesExistingToolchainAuthority() {
    const h = harness();
    createProtosLanguageClient(h.vscode, h.languageClientApi);
    assert.equal(DEFAULT_RUNTIME_EXECUTABLE, "protos");
    assert.equal(h.calls.constructed[0].serverOptions.command, "protos");
    assert.deepEqual(h.calls.configurationKeys, ["runtime.executable"]);
}

async function testRestrictedModeCreatesNoServerProcess() {
    const h = harness({ trusted: false });
    const controller = createProtosLanguageServerController(h.vscode, h.languageClientApi);
    assert.equal(await controller.start(), undefined);
    assert.equal(h.calls.constructed.length, 0);
    assert.equal(h.calls.starts, 0);
    await controller.stop();
    assert.equal(h.calls.stops, 0);
}

async function testControllerOwnsOneClientAndStopsItCleanly() {
    const h = harness();
    const controller = createProtosLanguageServerController(h.vscode, h.languageClientApi);
    const first = await controller.start();
    const second = await controller.start();
    assert.equal(first, second);
    assert.equal(h.calls.constructed.length, 1);
    assert.equal(h.calls.starts, 1);
    await controller.stop();
    assert.equal(h.calls.stops, 1);
    await controller.stop();
    assert.equal(h.calls.stops, 1);
}

async function testFailedStartupIsVisibleAndRetryable() {
    const h = harness({ startFailures: 1 });
    const controller = createProtosLanguageServerController(h.vscode, h.languageClientApi);

    assert.equal(await controller.start(), undefined);
    assert.equal(h.calls.constructed.length, 1);
    assert.equal(h.calls.starts, 1);
    assert.equal(h.calls.errors.length, 1);
    assert.match(h.calls.errors[0], /language-server spawn failed/);

    assert.ok(await controller.start());
    assert.equal(h.calls.constructed.length, 2);
    assert.equal(h.calls.starts, 2);
    await controller.stop();
    assert.equal(h.calls.stops, 1);
}

async function main() {
    await testExactRatifiedLaunchContract();
    testRemoteWorkspaceUriBridge();
    testLocalAndAmbiguousWorkspacesFailClosedToIdentity();
    testRemoteBridgeRejectsForeignRemoteAuthority();
    await testDefaultRuntimeUsesExistingToolchainAuthority();
    await testRestrictedModeCreatesNoServerProcess();
    await testControllerOwnsOneClientAndStopsItCleanly();
    await testFailedStartupIsVisibleAndRetryable();
    console.log("LM009_F4_LANGUAGE_SERVER_CLIENT_NODE_TEST: PASS");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
