"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const {
    DEBUG_TYPE,
    READY_PREFIX,
    READY_VERSION,
    createDebugAdapterDescriptorFactory,
    isNumericLoopback,
    parseDebugReadiness
} = require("../debug_adapter");
const {
    createProtosDebugConfigurationProvider
} = require("../extension");

function fakeChild() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.killCalls = 0;
    child.kill = function kill() {
        this.killCalls += 1;
        this.killed = true;
        return true;
    };
    return child;
}

function vscodeHarness(options = {}) {
    const errors = [];
    const output = [];
    const createdServers = [];
    const documentPath =
        options.documentPath || path.join("/workspace", "demo.protos");
    const document = {
        languageId: options.languageId || "protos",
        uri: {
            scheme: options.scheme || "file",
            path: options.uriPath || documentPath,
            fsPath: documentPath
        }
    };

    class DebugAdapterServer {
        constructor(port, host) {
            this.port = port;
            this.host = host;
            createdServers.push(this);
        }
    }

    const vscode = {
        Uri: {
            from(components) {
                assert.deepEqual(components, {
                    scheme: "file",
                    path: document.uri.path
                });
                return {
                    fsPath:
                        options.convertedFsPath || document.uri.path
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
                        return Object.prototype.hasOwnProperty.call(
                            options,
                            "runtime"
                        )
                            ? options.runtime
                            : fallback;
                    }
                };
            }
        },
        window: {
            activeTextEditor: options.noEditor
                ? undefined
                : { document },
            async showErrorMessage(message) {
                errors.push(message);
            }
        },
        DebugAdapterServer
    };

    const outputChannel = {
        append(text) {
            output.push(text);
        },
        appendLine(text) {
            output.push(text + "\n");
        },
        show() {},
        dispose() {}
    };

    return {
        vscode,
        errors,
        output,
        outputChannel,
        createdServers,
        document
    };
}

function readiness(host = "127.0.0.1", port = 54321, extras = "") {
    return (
        READY_PREFIX +
        `{"version":1,"protocol":"dap","transport":"tcp","host":"${host}","port":${port}${extras}}`
    );
}

function testReadinessParser() {
    assert.equal(DEBUG_TYPE, "protos");
    assert.equal(READY_VERSION, 1);
    assert.equal(isNumericLoopback("127.0.0.1"), true);
    assert.equal(isNumericLoopback("127.99.4.3"), true);
    assert.equal(isNumericLoopback("::1"), true);
    assert.equal(isNumericLoopback("0:0:0:0:0:0:0:1"), true);
    assert.equal(isNumericLoopback("localhost"), false);
    assert.equal(isNumericLoopback("0.0.0.0"), false);
    assert.equal(isNumericLoopback("192.0.2.1"), false);

    assert.deepEqual(parseDebugReadiness(readiness()), {
        host: "127.0.0.1",
        port: 54321
    });
    assert.deepEqual(
        parseDebugReadiness(
            readiness("0:0:0:0:0:0:0:1", 54322, ',"future":"ignored"')
        ),
        {
            host: "0:0:0:0:0:0:0:1",
            port: 54322
        }
    );

    for (const invalid of [
        "ready " + readiness(),
        READY_PREFIX + "{}",
        READY_PREFIX +
            '{"version":2,"protocol":"dap","transport":"tcp","host":"127.0.0.1","port":1}',
        READY_PREFIX +
            '{"version":1,"protocol":"cdp","transport":"tcp","host":"127.0.0.1","port":1}',
        readiness("localhost"),
        readiness("0.0.0.0"),
        readiness("192.0.2.1"),
        readiness("127.0.0.1", 0),
        readiness("127.0.0.1", 65536)
    ]) {
        assert.throws(() => parseDebugReadiness(invalid));
    }
}

async function testProviderSuppliesActiveFileF5Configuration() {
    const h = vscodeHarness();
    const provider = createProtosDebugConfigurationProvider(h.vscode);

    const config = await provider.resolveDebugConfiguration(undefined, {});

    assert.deepEqual(config, {
        type: "protos",
        request: "launch",
        name: "Debug Protos File",
        program: h.document.uri.fsPath,
        args: []
    });
    assert.deepEqual(h.errors, []);
}

async function testProviderUsesWorkspaceHostPathForRemoteDocument() {
    const remotePath = "/workspaces/protos/examples/demo.protos";
    const h = vscodeHarness({
        scheme: "vscode-remote",
        uriPath: remotePath,
        documentPath: "/must/not/use/uri-fsPath.protos",
        convertedFsPath: remotePath
    });
    const provider = createProtosDebugConfigurationProvider(h.vscode);

    const config = await provider.resolveDebugConfiguration(undefined, {});

    assert.equal(config.program, remotePath);
}

async function testProviderPreservesPersistedLaunchAndArgs() {
    const h = vscodeHarness();
    const provider = createProtosDebugConfigurationProvider(h.vscode);
    const input = {
        type: "protos",
        request: "launch",
        name: "Debug Example",
        program: "/workspace/example.protos",
        args: ["one", "two words"]
    };

    assert.deepEqual(
        await provider.resolveDebugConfiguration(undefined, input),
        input
    );
}

async function testProviderRejectsUnsupportedSurfaces() {
    for (const options of [
        { trusted: false },
        { noEditor: true },
        { languageId: "plaintext" },
        { scheme: "vscode-vfs" }
    ]) {
        const h = vscodeHarness(options);
        const provider = createProtosDebugConfigurationProvider(h.vscode);
        const result = await provider.resolveDebugConfiguration(
            undefined,
            {}
        );
        assert.equal(result, undefined);
        assert.equal(h.errors.length, 1);
    }

    {
        const h = vscodeHarness();
        const provider = createProtosDebugConfigurationProvider(h.vscode);
        assert.equal(
            await provider.resolveDebugConfiguration(undefined, {
                type: "protos",
                request: "attach",
                program: "/workspace/demo.protos"
            }),
            undefined
        );
        assert.equal(h.errors.length, 1);
    }

    {
        const h = vscodeHarness();
        const provider = createProtosDebugConfigurationProvider(h.vscode);
        assert.equal(
            await provider.resolveDebugConfiguration(undefined, {
                type: "protos",
                request: "launch",
                program: "/workspace/demo.protos",
                args: [42]
            }),
            undefined
        );
        assert.equal(h.errors.length, 1);
    }
}

async function testDescriptorSpawnsOneLauncherAndReturnsServer() {
    const h = vscodeHarness({
        runtime: "/opt/Protos Runtime/bin/protos"
    });
    const child = fakeChild();
    const spawns = [];
    const factory = createDebugAdapterDescriptorFactory(h.vscode, {
        outputChannel: h.outputChannel,
        spawn(command, args, options) {
            spawns.push({ command, args, options });
            return child;
        }
    });
    const session = {
        id: "session-1",
        configuration: {
            type: "protos",
            request: "launch",
            program: "/workspace/space dir/demo.protos",
            args: ["one", "two words"]
        }
    };

    const descriptorPromise =
        factory.createDebugAdapterDescriptor(session);
    child.stderr.write("launcher diagnostic\n");
    child.stdout.write("PROTOS_DEBUG_");
    child.stdout.write(
        'READY {"version":1,"protocol":"dap","transport":"tcp",'
    );
    child.stdout.write('"host":"127.0.0.1","port":55001}\n');

    const descriptor = await descriptorPromise;

    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].command, "/opt/Protos Runtime/bin/protos");
    assert.deepEqual(spawns[0].args, [
        "debug",
        "/workspace/space dir/demo.protos",
        "one",
        "two words"
    ]);
    assert.equal(spawns[0].options.cwd, "/workspace/space dir");
    assert.equal(spawns[0].options.shell, false);
    assert.deepEqual(spawns[0].options.stdio, [
        "ignore",
        "pipe",
        "pipe"
    ]);
    assert.equal(descriptor.host, "127.0.0.1");
    assert.equal(descriptor.port, 55001);
    assert.equal(factory.activeSessionCount(), 1);
    assert.match(h.output.join(""), /launcher diagnostic/);

    child.exitCode = 0;
    child.emit("exit", 0, null);
    assert.equal(factory.activeSessionCount(), 0);
}

async function testDescriptorRejectsInvalidEndpointAndKillsChild() {
    const h = vscodeHarness();
    const child = fakeChild();
    const factory = createDebugAdapterDescriptorFactory(h.vscode, {
        outputChannel: h.outputChannel,
        spawn() {
            return child;
        }
    });

    const promise = factory.createDebugAdapterDescriptor({
        id: "bad-endpoint",
        configuration: {
            type: "protos",
            request: "launch",
            program: "/workspace/demo.protos"
        }
    });

    child.stdout.write(readiness("192.0.2.1") + "\n");

    await assert.rejects(promise, /numeric loopback/);
    assert.equal(child.killCalls, 1);
    assert.equal(factory.activeSessionCount(), 0);
}

async function testDescriptorRejectsExitBeforeReadiness() {
    const h = vscodeHarness();
    const child = fakeChild();
    const factory = createDebugAdapterDescriptorFactory(h.vscode, {
        outputChannel: h.outputChannel,
        spawn() {
            return child;
        }
    });

    const promise = factory.createDebugAdapterDescriptor({
        id: "early-exit",
        configuration: {
            type: "protos",
            request: "launch",
            program: "/workspace/demo.protos"
        }
    });

    child.exitCode = 7;
    child.emit("exit", 7, null);

    await assert.rejects(promise, /exited before readiness/);
    assert.equal(factory.activeSessionCount(), 0);
}

async function testConcurrentSessionsRemainIndependent() {
    const h = vscodeHarness();
    const children = [fakeChild(), fakeChild()];
    let next = 0;
    const factory = createDebugAdapterDescriptorFactory(h.vscode, {
        outputChannel: h.outputChannel,
        spawn() {
            return children[next++];
        }
    });

    const first = factory.createDebugAdapterDescriptor({
        id: "session-a",
        configuration: {
            type: "protos",
            request: "launch",
            program: "/workspace/a.protos"
        }
    });
    const second = factory.createDebugAdapterDescriptor({
        id: "session-b",
        configuration: {
            type: "protos",
            request: "launch",
            program: "/workspace/b.protos"
        }
    });

    children[0].stdout.write(readiness("127.0.0.1", 55101) + "\n");
    children[1].stdout.write(readiness("127.0.0.1", 55102) + "\n");

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.port, 55101);
    assert.equal(b.port, 55102);
    assert.equal(factory.activeSessionCount(), 2);

    children[0].exitCode = 0;
    children[0].emit("exit", 0, null);
    assert.equal(factory.activeSessionCount(), 1);

    factory.dispose();
    assert.equal(children[1].killCalls, 1);
    assert.equal(factory.activeSessionCount(), 0);
}

async function testDescriptorGuardsTrustRuntimeAndAbsoluteProgram() {
    {
        const h = vscodeHarness({ trusted: false });
        const factory = createDebugAdapterDescriptorFactory(h.vscode);
        await assert.rejects(
            factory.createDebugAdapterDescriptor({
                id: "restricted",
                configuration: {
                    type: "protos",
                    request: "launch",
                    program: "/workspace/demo.protos"
                }
            }),
            /Restricted Mode/
        );
    }

    {
        const h = vscodeHarness({ runtime: "   " });
        const factory = createDebugAdapterDescriptorFactory(h.vscode);
        await assert.rejects(
            factory.createDebugAdapterDescriptor({
                id: "runtime",
                configuration: {
                    type: "protos",
                    request: "launch",
                    program: "/workspace/demo.protos"
                }
            }),
            /protos.runtime.executable/
        );
    }

    {
        const h = vscodeHarness();
        const factory = createDebugAdapterDescriptorFactory(h.vscode);
        await assert.rejects(
            factory.createDebugAdapterDescriptor({
                id: "relative",
                configuration: {
                    type: "protos",
                    request: "launch",
                    program: "demo.protos"
                }
            }),
            /absolute workspace-host path/
        );
    }
}

async function main() {
    testReadinessParser();
    await testProviderSuppliesActiveFileF5Configuration();
    await testProviderUsesWorkspaceHostPathForRemoteDocument();
    await testProviderPreservesPersistedLaunchAndArgs();
    await testProviderRejectsUnsupportedSurfaces();
    await testDescriptorSpawnsOneLauncherAndReturnsServer();
    await testDescriptorRejectsInvalidEndpointAndKillsChild();
    await testDescriptorRejectsExitBeforeReadiness();
    await testConcurrentSessionsRemainIndependent();
    await testDescriptorGuardsTrustRuntimeAndAbsoluteProgram();
    console.log("LM009_E_VSCODE_DEBUG_WIRING_NODE_TEST: PASS");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
