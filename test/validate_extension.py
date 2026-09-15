#!/usr/bin/env python3
"""LM009-B/C/E/F structural validation for the VS Code reference extension."""

from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "package.json"
CONFIG = ROOT / "language-configuration.json"
GRAMMAR = ROOT / "syntaxes" / "protos.tmLanguage.json"
EXTENSION = ROOT / "extension.js"
DEBUG_ADAPTER = ROOT / "debug_adapter.js"


def fail(message):
    print("LM009_EDITOR_EXTENSION_VALIDATION_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail("%s: %s" % (path, exc))


def main():
    package = read_json(PACKAGE)
    config = read_json(CONFIG)
    grammar = read_json(GRAMMAR)

    expected_scalar = {
        "name": "protos",
        "displayName": "Protos",
        "version": "0.1.0",
        "publisher": "guillermomolina",
        "license": "APL-1.0",
        "main": "./dist/extension.js",
        "icon": "icon.png",
    }
    for key, expected in expected_scalar.items():
        if package.get(key) != expected:
            fail("%s must be %r" % (key, expected))

    if package.get("engines") != {"vscode": "^1.104.0"}:
        fail("engines.vscode must remain exactly ^1.104.0")
    if package.get("categories") != ["Programming Languages"]:
        fail("category must remain Programming Languages")
    if package.get("extensionKind") != ["workspace"]:
        fail("executable editor integration must remain a workspace extension")

    for forbidden in (
        "browser",
        "activationEvents",
    ):
        if forbidden in package:
            fail("LM009 must not add %s" % forbidden)

    if package.get("dependencies") != {"vscode-languageclient": "10.1.1"}:
        fail("LM009-F4 requires exactly vscode-languageclient 10.1.1")

    expected_scripts = {
        "build": (
            "esbuild extension.js --bundle --platform=node --format=cjs "
            "--target=node22 --external:vscode --metafile=dist/meta.json "
            "--outfile=dist/extension.js"
        ),
        "package:assets": "node scripts/sync_package_assets.js --check",
        "vscode:prepublish": "npm run build && npm run package:assets",
        "test:build": "npm run build",
        "test:grammar": "python3 test/validate_grammar.py",
        "test:contract": "python3 test/validate_extension.py",
        "test:packaging": "python3 test/validate_packaging.py",
        "test:run": "node test/run_current_file.test.js",
        "test:debug": "node test/debug_integration.test.js",
        "test:lsp": "node test/language_server_integration.test.js",
        "test": (
            "npm run test:build && "
            "npm run test:grammar && "
            "npm run test:contract && "
            "npm run test:packaging && "
            "npm run test:run && "
            "npm run test:debug && "
            "npm run test:lsp"
        ),
        "package:vsix": "vsce package --no-dependencies",
        "package:vsix:canonical": "node scripts/canonicalize_vsix.js",
        "test:vsix": (
            "rm -f /tmp/protos-vscode-extension.vsix && "
            "npm run package:vsix -- --out /tmp/protos-vscode-extension.vsix && "
            "python3 test/validate_vsix.py /tmp/protos-vscode-extension.vsix && "
            "python3 test/validate_reproducibility.py "
            "/tmp/protos-vscode-extension.vsix"
        ),
    }
    if package.get("scripts") != expected_scripts:
        fail("D127/I1-A/B build scripts changed")

    expected_dev_dependencies = {
        "@vscode/vsce": "3.9.2",
        "esbuild": "0.28.2",
        "yauzl": "^3.4.0",
        "yazl": "^2.5.1",
    }
    if package.get("devDependencies") != expected_dev_dependencies:
        fail("D127/I1-A pinned build tooling changed")

    expected_capabilities = {
        "untrustedWorkspaces": {
            "supported": "limited",
            "restrictedConfigurations": ["protos.runtime.executable"],
        }
    }
    if package.get("capabilities") != expected_capabilities:
        fail("Workspace Trust capability changed")

    contributes = package.get("contributes")
    if not isinstance(contributes, dict):
        fail("contributes must be an object")
    if set(contributes.keys()) != {
        "languages",
        "grammars",
        "commands",
        "menus",
        "configuration",
        "breakpoints",
        "debuggers",
    }:
        fail("unexpected VS Code contribution surface")

    if contributes["languages"] != [{
        "id": "protos",
        "aliases": ["Protos"],
        "extensions": [".protos"],
        "configuration": "./language-configuration.json",
    }]:
        fail("LM009-B language association changed")

    if contributes["grammars"] != [{
        "language": "protos",
        "scopeName": "source.protos",
        "path": "./syntaxes/protos.tmLanguage.json",
    }]:
        fail("LM009-B grammar contribution changed")

    if contributes["commands"] != [{
        "command": "protos.runCurrentFile",
        "title": "Run Current File",
        "category": "Protos",
        "enablement": (
            "editorLangId == protos && "
            "(resourceScheme == file || resourceScheme == vscode-remote) && "
            "isWorkspaceTrusted"
        ),
    }]:
        fail("Run Current File command contribution changed")

    if contributes["menus"] != {
        "commandPalette": [{
            "command": "protos.runCurrentFile",
            "when": (
                "editorLangId == protos && "
                "(resourceScheme == file || resourceScheme == vscode-remote) && "
                "isWorkspaceTrusted"
            ),
        }]
    }:
        fail("Run Current File command-palette gating changed")

    expected_runtime = {
        "title": "Protos",
        "properties": {
            "protos.runtime.executable": {
                "type": "string",
                "default": "protos",
                "scope": "machine",
                "description": (
                    "Protos launcher executable used by Run Current File, "
                    "debugging, and the static language server. Defaults to "
                    "'protos' resolved through PATH."
                ),
            }
        },
    }
    if contributes["configuration"] != expected_runtime:
        fail("runtime executable configuration changed outside LM009-C/E contract")

    if contributes["breakpoints"] != [{"language": "protos"}]:
        fail("LM009-E must enable breakpoints only for Protos")

    expected_debugger = [{
        "type": "protos",
        "label": "Protos",
        "languages": ["protos"],
        "configurationAttributes": {
            "launch": {
                "required": ["program"],
                "properties": {
                    "program": {
                        "type": "string",
                        "description": (
                            "Absolute Protos source-file path to debug after "
                            "VS Code variable substitution."
                        ),
                    },
                    "args": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": [],
                        "description": (
                            "Application arguments passed after the Protos source file."
                        ),
                    },
                },
            }
        },
        "initialConfigurations": [{
            "type": "protos",
            "request": "launch",
            "name": "Debug Protos File",
            "program": "${file}",
            "args": [],
        }],
    }]
    if contributes["debuggers"] != expected_debugger:
        fail("LM009-E debugger contribution changed")

    if grammar.get("name") != "Protos" or grammar.get("scopeName") != "source.protos":
        fail("existing TextMate grammar identity changed unexpectedly")

    try:
        extension = EXTENSION.read_text(encoding="utf-8")
        debug_adapter = DEBUG_ADAPTER.read_text(encoding="utf-8")
    except OSError as exc:
        fail(str(exc))

    required_extension_markers = (
        'RUN_CURRENT_FILE_COMMAND = "protos.runCurrentFile"',
        'DEFAULT_RUNTIME_EXECUTABLE = "protos"',
        'EXECUTABLE_RESOURCE_SCHEMES = new Set(["file", "vscode-remote"])',
        "vscode.workspace.isTrusted",
        'document.languageId !== "protos"',
        'vscode.Uri.from({ scheme: "file", path: uri.path }).fsPath',
        "await document.save()",
        "new vscode.ProcessExecution(",
        "vscode.tasks.executeTask(task)",
        "createProtosDebugConfigurationProvider",
        'config.request !== "launch"',
        'createOutputChannel("Protos Debug")',
        "registerDebugConfigurationProvider",
        "registerDebugAdapterDescriptorFactory",
        'require("vscode-languageclient/node")',
        'LANGUAGE_SERVER_ARGUMENTS = Object.freeze(["language-server"])',
        'LANGUAGE_SERVER_DOCUMENT_SELECTOR = Object.freeze([',
        "createProtosLanguageClient",
        "createProtosLanguageServerController",
        '.get("runtime.executable", DEFAULT_RUNTIME_EXECUTABLE)',
        "options: { shell: false }",
        "await candidate.start()",
        "await current.stop()",
        "onDidGrantWorkspaceTrust",
    )
    for marker in required_extension_markers:
        if marker not in extension:
            fail("extension.js missing approved policy marker: " + marker)

    required_debug_markers = (
        'require("node:child_process")',
        'READY_PREFIX = "PROTOS_DEBUG_READY "',
        'READY_VERSION = 1',
        "new net.BlockList()",
        'LOOPBACKS.addSubnet("127.0.0.0", 8, "ipv4")',
        'LOOPBACKS.addAddress("::1", "ipv6")',
        '.get("runtime.executable", defaultRuntimeExecutable)',
        '["debug", program, ...applicationArgs]',
        "shell: false",
        'stdio: ["ignore", "pipe", "pipe"]',
        "awaitDebugReadiness(child, outputChannel)",
        "new vscode.DebugAdapterServer(",
        "children.set(session.id, child)",
        "children.delete(session.id)",
    )
    for marker in required_debug_markers:
        if marker not in debug_adapter:
            fail("debug_adapter.js missing approved LM009-E marker: " + marker)

    for forbidden in (
        "protos.languageServer.executable",
        "ProtosLanguageServerMain",
        "protos-language-server",
        "java -jar",
        "DebugAdapterExecutable",
        "DebugAdapterInlineImplementation",
        "debugServer",
        "--listen",
        "dap.WaitAttached",
        "dap.Suspend",
        "[Graal DAP]",
        "com.guillermomolina.protos.cli.ProtosCli",
    ):
        if forbidden in extension or forbidden in debug_adapter:
            fail("editor must not cross the approved debugger boundary: " + forbidden)

    print("LM009_B_EXTENSION_VALIDATION: PASS")
    print("LM009_C_RUN_WIRING_VALIDATION: PASS")
    print("LM009_E_DEBUG_WIRING_VALIDATION: PASS")
    print("EXTENSION_ID=guillermomolina.protos")
    print("EXTENSION_VERSION=0.1.0")
    print("ENGINES_VSCODE=^1.104.0")
    print("EXTENSION_KIND=workspace")
    print("RUNTIME_BOUNDARY=EXTERNAL_PROTOS_LAUNCHER")
    print("DEBUG_TYPE=protos")
    print("DEBUG_REQUEST=launch")
    print("DEBUG_LAUNCHER=protos_debug_file")
    print("DEBUG_ADAPTER=REAL_DAP_SERVER")
    print("DEBUG_ENDPOINT_SOURCE=D060_STDOUT_READINESS")
    print("DEBUG_PORT_ALLOCATION=RUNTIME_OS_EPHEMERAL")
    print("DEBUG_PROXY=NO")
    print("DEBUG_ATTACH=NO")
    print("DEBUG_REMOTE_LISTEN=NO")
    print("DEBUG_STOP_ON_ENTRY=NO")
    print("LM009_F4_LANGUAGE_SERVER_WIRING_VALIDATION: PASS")
    print("LANGUAGE_SERVER_LAUNCH=protos language-server")
    print("LANGUAGE_SERVER_TOOLCHAIN_AUTHORITY=protos.runtime.executable")
    print("LANGUAGE_SERVER_TRANSPORT=LSP_STDIO")
    print("LANGUAGE_SERVER_SECOND_EXECUTABLE_SETTING=NO")
    print("LANGUAGE_SERVER_EDITOR_SEMANTICS=NO")


if __name__ == "__main__":
    main()
