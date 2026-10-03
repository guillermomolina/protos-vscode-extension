#!/usr/bin/env python3
"""LM009-B/C/E/F structural validation for the VS Code reference extension."""

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "package.json"
CONFIG = ROOT / "language-configuration.json"
GRAMMAR = ROOT / "syntaxes" / "protos.tmLanguage.json"
EXTENSION = ROOT / "extension.js"
DEBUG_ADAPTER = ROOT / "debug_adapter.js"
PROTOS_SOURCE_LOCK = ROOT / "protos-source.lock.json"
PROTOS_RUNTIME_INSTALLER = (
    ROOT / "scripts" / "install_locked_protos_runtime.py"
)
README = ROOT / "README.md"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "vscode-extension-ci.yaml"


def fail(message):
    print("LM009_EDITOR_EXTENSION_VALIDATION_FAILED: " + message, file=sys.stderr)
    raise SystemExit(2)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail("%s: %s" % (path, exc))


def workflow_job(workflow, name):
    match = re.search(
        r"(?ms)^  %s:\n.*?(?=^  [A-Za-z0-9_-]+:\n|\Z)"
        % re.escape(name),
        workflow,
    )
    if match is None:
        fail("CI workflow missing job: " + name)
    return match.group(0)


def main():
    package = read_json(PACKAGE)
    config = read_json(CONFIG)
    grammar = read_json(GRAMMAR)
    source_lock = read_json(PROTOS_SOURCE_LOCK)

    try:
        readme = README.read_text(encoding="utf-8")
        workflow = CI_WORKFLOW.read_text(encoding="utf-8")
        runtime_installer = PROTOS_RUNTIME_INSTALLER.read_text(
            encoding="utf-8"
        )
    except OSError as exc:
        fail(str(exc))

    if source_lock.get("repository") != "guillermomolina/protos":
        fail("Protos runtime lock repository authority changed")

    revision = source_lock.get("revision")
    if (
        not isinstance(revision, str)
        or re.fullmatch(r"[0-9a-f]{40}", revision) is None
    ):
        fail("Protos runtime lock revision must be an exact 40-hex SHA")

    release_version = source_lock.get("release_version")
    if (
        not isinstance(release_version, str)
        or re.fullmatch(
            r"[0-9]+\.[0-9]+\.[0-9]+",
            release_version,
        ) is None
    ):
        fail("Protos runtime lock release_version is not canonical")

    release_tag = source_lock.get("release_tag")
    if release_tag != "v" + release_version:
        fail("Protos runtime lock release tag/version mismatch")

    release_asset = source_lock.get("release_asset")
    expected_asset = (
        "protos-%s-native-linux-x86_64.zip"
        % release_version
    )
    if release_asset != expected_asset:
        fail("Protos runtime lock Native asset identity changed")

    release_asset_sha256 = source_lock.get(
        "release_asset_sha256"
    )
    if (
        not isinstance(release_asset_sha256, str)
        or re.fullmatch(
            r"[0-9a-f]{64}",
            release_asset_sha256,
        ) is None
    ):
        fail(
            "Protos runtime lock asset SHA-256 must be exact"
        )

    graalvm_release = source_lock.get("graalvm_release")
    if (
        not isinstance(graalvm_release, str)
        or not graalvm_release
    ):
        fail("Protos runtime lock GraalVM release is missing")

    expected_lock_fields = {
        "native_runtime_kind":
            "graalvm-native-image-truffle",
        "target_os": "linux",
        "target_arch": "x86_64",
        "libc_family": "glibc",
        "libc_abi_min": "2.39",
    }

    for key, expected in expected_lock_fields.items():
        if source_lock.get(key) != expected:
            fail(
                "Protos runtime lock %s changed: %r"
                % (key, source_lock.get(key))
            )

    readme_authority = (
        "repository      = guillermomolina/protos\n"
        "source revision = %s\n"
        "release tag     = %s\n"
        "release asset   = %s\n"
        "asset sha256    = %s\n"
        "graalvm release = %s"
        % (
            revision,
            release_tag,
            release_asset,
            release_asset_sha256,
            graalvm_release,
        )
    )

    if readme_authority not in readme:
        fail(
            "README published Protos runtime authority "
            "must agree with the lock"
        )

    expected_scalar = {
        "name": "protos",
        "displayName": "Protos",
        "version": "0.2.0",
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
        "test:release-version": "python3 test/validate_release_version.py",
        "test:run": "node test/run_current_file.test.js",
        "test:debug": "node test/debug_integration.test.js",
        "test:lsp": "node test/language_server_integration.test.js",
        "test": (
            "npm run test:build && "
            "npm run test:grammar && "
            "npm run test:contract && "
            "npm run test:packaging && "
            "npm run test:release-version && "
            "npm run test:run && "
            "npm run test:debug && "
            "npm run test:lsp"
        ),
        "test:acceptance": "node scripts/test_acceptance.js",
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
        "@vscode/test-electron": "3.1.0",
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

    required_installer_markers = (
        "hashlib.sha256()",
        "urllib.request.urlopen(request)",
        "archive.testzip()",
        '"SOURCE.txt"',
        '"RUNTIME.txt"',
        '"source_revision": lock["revision"]',
        '"graalvm_release": lock["graalvm_release"]',
        '"external_java_required": "false"',
        '"/releases/download/"',
        '"release_asset_sha256"',
    )

    for marker in required_installer_markers:
        if marker not in runtime_installer:
            fail(
                "published-runtime installer missing "
                "authority marker: "
                + marker
            )

    required_workflow_markers = (
        "  test:\n",
        "uses: actions/checkout@v5",
        "fetch-depth: 0",
        "uses: devcontainers/ci@v0.3",
        "push: never",
        "runCmd: make test",
        "uses: actions/upload-artifact@v4",
        "protos-vscode.vsix",
        "protos-vscode.vsix.sha256",
    )

    for marker in required_workflow_markers:
        if marker not in workflow:
            fail(
                "CI workflow missing repository-authority marker: "
                + marker
            )

    if workflow.count(
        "uses: devcontainers/ci@v0.3"
    ) != 1:
        fail(
            "CI must have exactly one devcontainer execution authority"
        )

    if workflow.count("runCmd: make test") != 1:
        fail(
            "CI must execute make test exactly once"
        )

    forbidden_workflow_markers = (
        "  package:\n",
        "  clean-install:\n",
        "  real-run:\n",
        "  real-debug:\n",
        "actions/setup-node@",
        "actions/setup-python@",
        "npm test",
        "update.code.visualstudio.com/latest",
        "clean_install_make_vsix.py",
        "clean_run_make_vsix.py",
        "debug_harness_make_vsix.py",
        "install_locked_protos_runtime.py",
    )

    for marker in forbidden_workflow_markers:
        if marker in workflow:
            fail(
                "CI duplicates repository test authority: "
                + marker
            )

    print(
        "DIST006_B2_CI_REPOSITORY_"
        "AUTHORITY_VALIDATION: PASS"
    )
    print("CI_TEST_AUTHORITY=make test")
    print("CI_EXECUTION_ENVIRONMENT=devcontainer")
    print("PROTOS_SOURCE_REVISION=" + revision)
    print("PROTOS_RELEASE_TAG=" + release_tag)
    print("PROTOS_RELEASE_ASSET=" + release_asset)
    print(
        "PROTOS_RELEASE_ASSET_SHA256="
        + release_asset_sha256
    )
    print(
        "PROTOS_GRAALVM_RELEASE="
        + graalvm_release
    )
    print(
        "PROTOS_RUNTIME_SOURCE="
        "PUBLISHED_NATIVE_RELEASE"
    )
    print("PROTOS_EXTERNAL_JAVA_REQUIRED=NO")
    print("LM009_B_EXTENSION_VALIDATION: PASS")
    print("LM009_C_RUN_WIRING_VALIDATION: PASS")
    print("LM009_E_DEBUG_WIRING_VALIDATION: PASS")
    print("EXTENSION_ID=guillermomolina.protos")
    print("EXTENSION_VERSION=0.2.0")
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
