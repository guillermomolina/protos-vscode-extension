"use strict";

const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

const DEBUG_TYPE = "protos";
const READY_PREFIX = "PROTOS_DEBUG_READY ";
const READY_VERSION = 1;
const MAX_READY_BYTES = 64 * 1024;

const LOOPBACKS = new net.BlockList();
LOOPBACKS.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACKS.addAddress("::1", "ipv6");

function isNumericLoopback(host) {
    const family = net.isIP(host);
    if (family === 4) {
        return LOOPBACKS.check(host, "ipv4");
    }
    if (family === 6) {
        return LOOPBACKS.check(host, "ipv6");
    }
    return false;
}

function parseDebugReadiness(line) {
    if (typeof line !== "string" || !line.startsWith(READY_PREFIX)) {
        throw new Error("Protos debugger readiness has an invalid framing prefix.");
    }

    let payload;
    try {
        payload = JSON.parse(line.slice(READY_PREFIX.length));
    } catch (error) {
        throw new Error(
            `Protos debugger readiness is not valid JSON: ${error.message}`
        );
    }

    if (
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload)
    ) {
        throw new Error("Protos debugger readiness payload must be a JSON object.");
    }
    if (payload.version !== READY_VERSION) {
        throw new Error(
            `Unsupported Protos debugger readiness version: ${String(payload.version)}`
        );
    }
    if (payload.protocol !== "dap" || payload.transport !== "tcp") {
        throw new Error(
            "Protos debugger readiness must describe the dap/tcp baseline."
        );
    }
    if (
        typeof payload.host !== "string" ||
        !isNumericLoopback(payload.host)
    ) {
        throw new Error(
            "Protos debugger readiness host must be a numeric loopback address."
        );
    }
    if (
        !Number.isInteger(payload.port) ||
        payload.port <= 0 ||
        payload.port > 65535
    ) {
        throw new Error(
            "Protos debugger readiness port must be an integer in 1..65535."
        );
    }

    return { host: payload.host, port: payload.port };
}

function appendOutput(channel, text) {
    if (channel && typeof channel.append === "function" && text.length > 0) {
        channel.append(text);
    }
}

function safeKill(child) {
    if (!child || child.exitCode !== null || child.killed) {
        return;
    }
    try {
        child.kill();
    } catch (_error) {
        // Best-effort cleanup only. The original launch failure remains primary.
    }
}

function awaitDebugReadiness(child, outputChannel) {
    if (!child.stdout) {
        return Promise.reject(
            new Error("Protos debugger launcher stdout is unavailable.")
        );
    }

    return new Promise((resolve, reject) => {
        const decoder = new StringDecoder("utf8");
        let pending = "";
        let settled = false;

        const cleanupStartupListeners = () => {
            child.stdout.removeListener("data", onData);
            child.removeListener("error", onError);
            child.removeListener("exit", onExit);
        };

        const fail = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupStartupListeners();
            reject(error);
        };

        const onError = (error) => {
            fail(
                new Error(
                    `Unable to start the Protos debugger launcher: ${error.message}`
                )
            );
        };

        const onExit = (code, signal) => {
            const detail =
                signal !== null
                    ? `signal ${signal}`
                    : `exit code ${String(code)}`;
            fail(
                new Error(
                    `Protos debugger launcher exited before readiness (${detail}).`
                )
            );
        };

        const onData = (chunk) => {
            if (settled) {
                return;
            }
            pending += decoder.write(chunk);

            const newline = pending.indexOf("\n");
            if (
                newline < 0 &&
                Buffer.byteLength(pending, "utf8") > MAX_READY_BYTES
            ) {
                fail(
                    new Error(
                        "Protos debugger readiness exceeded the bounded startup record size."
                    )
                );
                return;
            }
            if (newline < 0) {
                return;
            }

            const line = pending.slice(0, newline).replace(/\r$/, "");
            const remainder = pending.slice(newline + 1);

            let endpoint;
            try {
                endpoint = parseDebugReadiness(line);
            } catch (error) {
                fail(error);
                return;
            }

            settled = true;
            cleanupStartupListeners();

            if (remainder.length > 0) {
                appendOutput(outputChannel, remainder);
            }
            child.stdout.on("data", (laterChunk) => {
                appendOutput(outputChannel, laterChunk.toString("utf8"));
            });

            resolve(endpoint);
        };

        child.stdout.on("data", onData);
        child.once("error", onError);
        child.once("exit", onExit);
    });
}

function createDebugAdapterDescriptorFactory(vscode, options = {}) {
    const spawnImpl = options.spawn || spawn;
    const pathModule = options.path || path;
    const outputChannel = options.outputChannel;
    const defaultRuntimeExecutable =
        options.defaultRuntimeExecutable || "protos";
    const children = new Map();

    function configuredRuntimeExecutable() {
        const configured = vscode.workspace
            .getConfiguration("protos")
            .get("runtime.executable", defaultRuntimeExecutable);

        if (
            typeof configured !== "string" ||
            configured.trim().length === 0
        ) {
            throw new Error(
                "Configure protos.runtime.executable with a Protos launcher executable."
            );
        }
        return configured;
    }

    function validateLaunchConfiguration(session) {
        if (!vscode.workspace.isTrusted) {
            throw new Error(
                "Protos debugging is disabled in Restricted Mode."
            );
        }

        const config = session.configuration || {};
        if (config.type !== DEBUG_TYPE || config.request !== "launch") {
            throw new Error(
                "Protos debug adapter startup requires a protos/launch configuration."
            );
        }
        if (
            typeof config.program !== "string" ||
            config.program.trim().length === 0
        ) {
            throw new Error(
                "Protos debug adapter startup requires a source-file program path."
            );
        }
        if (!pathModule.isAbsolute(config.program)) {
            throw new Error(
                "Protos debug program must resolve to an absolute workspace-host path."
            );
        }

        const applicationArgs = config.args === undefined ? [] : config.args;
        if (
            !Array.isArray(applicationArgs) ||
            applicationArgs.some(
                (argument) => typeof argument !== "string"
            )
        ) {
            throw new Error(
                "Protos debug configuration args must be an array of strings."
            );
        }

        return {
            program: config.program,
            applicationArgs
        };
    }

    return {
        async createDebugAdapterDescriptor(session) {
            const { program, applicationArgs } =
                validateLaunchConfiguration(session);
            const runtimeExecutable = configuredRuntimeExecutable();
            const cwd = pathModule.dirname(program);

            let child;
            try {
                child = spawnImpl(
                    runtimeExecutable,
                    ["debug", program, ...applicationArgs],
                    {
                        cwd,
                        shell: false,
                        stdio: ["ignore", "pipe", "pipe"]
                    }
                );
            } catch (error) {
                throw new Error(
                    `Unable to start the Protos debugger launcher: ${error.message}`
                );
            }

            children.set(session.id, child);

            child.once("exit", () => {
                if (children.get(session.id) === child) {
                    children.delete(session.id);
                }
            });

            if (child.stderr) {
                child.stderr.on("data", (chunk) => {
                    appendOutput(outputChannel, chunk.toString("utf8"));
                });
            }

            try {
                const endpoint =
                    await awaitDebugReadiness(child, outputChannel);
                return new vscode.DebugAdapterServer(
                    endpoint.port,
                    endpoint.host
                );
            } catch (error) {
                if (children.get(session.id) === child) {
                    children.delete(session.id);
                }
                safeKill(child);
                if (
                    outputChannel &&
                    typeof outputChannel.appendLine === "function"
                ) {
                    outputChannel.appendLine(error.message);
                }
                if (
                    outputChannel &&
                    typeof outputChannel.show === "function"
                ) {
                    outputChannel.show(true);
                }
                throw error;
            }
        },

        activeSessionCount() {
            return children.size;
        },

        dispose() {
            for (const child of children.values()) {
                safeKill(child);
            }
            children.clear();
        }
    };
}

module.exports = {
    DEBUG_TYPE,
    READY_PREFIX,
    READY_VERSION,
    createDebugAdapterDescriptorFactory,
    isNumericLoopback,
    parseDebugReadiness
};
