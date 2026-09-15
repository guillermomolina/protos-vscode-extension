# Protos VS Code Extension

VS Code extension for the Protos programming language.

This repository is the product and distribution home for the Protos VS Code
extension. The canonical Protos language, specification, parser, resolver and
runtime remain owned by the
[`guillermomolina/protos`](https://github.com/guillermomolina/protos) repository.

## Source authority

This repository consumes the canonical Protos implementation at an exact,
explicit Git revision.

The consumed revision is recorded in
[`protos-source.lock.json`](protos-source.lock.json):

```text
repository = guillermomolina/protos
revision  = 5e33ab7b46a21da0eaecd9d5a5721d95b170518a
```

The lock file is the authority for the Protos source revision used by the
extension CI and release pipeline.

The extension must remain a thin editor integration. It must not become a
second implementation of the Protos language or runtime.

In particular, this repository does not own:

- Protos grammar or language semantics;
- parsing or semantic analysis;
- name resolution;
- runtime implementation;
- Java/GraalVM implementation details;
- Protos launcher internals.

Those responsibilities remain in the canonical Protos repository.

## Extension identity

```text
extension id:    guillermomolina.protos
extension name:  protos
publisher:       guillermomolina
extension ver.:  0.1.0
engines.vscode:  ^1.104.0
language id:     protos
file extension:  .protos
TextMate scope:  source.protos
```

The extension uses the external Protos launcher configured through:

```text
protos.runtime.executable
```

The default value is:

```text
protos
```

The extension does not embed the Protos runtime.

## Features

The current extension provides the following integration surfaces:

- Protos language identification for `.protos` files;
- non-normative TextMate syntax highlighting;
- language configuration for comments and structural delimiters;
- `Protos: Run Current File`;
- Protos debugging through VS Code's Debug Adapter Protocol integration;
- Protos language-server client integration;
- local and VS Code Remote workspace support where the corresponding Protos
  launcher is available in the workspace extension host.

The extension intentionally keeps these responsibilities at the editor boundary.
Language semantics remain external to the extension.

## Local development

Install the exact dependency set recorded in the lockfile:

```sh
npm ci
```

Build the production extension bundle:

```sh
npm run build
```

Generate or validate the committed packaging assets:

```sh
npm run package:assets
```

Run the structural validators:

```sh
python3 test/validate_grammar.py
python3 test/validate_extension.py
python3 test/validate_packaging.py
python3 test/validate_vsix.py
python3 test/validate_reproducibility.py
```

Run the Node.js integration tests:

```sh
node test/run_current_file.test.js
node test/debug_integration.test.js
node test/language_server_integration.test.js
```

The extension can also be loaded directly into an Extension Development Host:

```sh
npm ci
npm run build
code --new-window --extensionDevelopmentPath="$PWD"
```

A real Protos launcher must be available through `PATH` or through the
`protos.runtime.executable` setting.

## Packaging

The production VSIX is built with the pinned
[`@vscode/vsce`](https://github.com/microsoft/vscode-vsce) packaging tool.

The normal packaging flow is:

```sh
npm ci
npm run vscode:prepublish
npm run package:vsix -- --out /tmp/protos.vsix
python3 test/validate_vsix.py /tmp/protos.vsix
```

The production package contains only the approved extension surface.

Development-only material such as source-only JavaScript, tests, fixtures,
packaging scripts, the npm lockfile, generated metadata and raw
`node_modules` content must not be shipped inside the VSIX.

The package boundary is enforced by `.vscodeignore` and the packaging
validators.

## Deterministic VSIX artifacts

The CI pipeline canonicalizes the VSIX after packaging.

The canonicalization performed by
[`scripts/canonicalize_vsix.js`](scripts/canonicalize_vsix.js) fixes the
artifact properties that are otherwise dependent on the local packaging
environment, including:

```text
ZIP member ordering      = lexicographic
ZIP compression           = STORE
ZIP member permissions    = fixed
ZIP timestamps            = derived from Git source revision
semantic member bytes    = unchanged
```

The resulting VSIX is therefore reproducible from the same extension source
revision and dependency lock.

The CI pipeline also records the SHA-256 digest of the canonical VSIX.

## Package assets and notices

The production bundle includes the JavaScript dependencies required by the
extension.

The corresponding third-party licensing information is maintained in:

```text
THIRD_PARTY_NOTICES.txt
```

The file is generated deterministically from the installed dependency set and
the production bundle metadata. It must not be edited manually.

The package also contains:

```text
license.txt
```

which is the license file required inside the VSIX.

The repository-level license is:

```text
LICENSE.TXT
```

Both the repository and distributed VSIX must preserve the applicable
APL-1.0 licensing terms and required third-party notices.

## Continuous integration

GitHub Actions in this repository own the complete VS Code extension
validation and distribution pipeline.

The pipeline consumes the exact Protos revision from
`protos-source.lock.json` and validates the resulting packaged product.

The intended pipeline is:

```text
protos-source.lock.json
          ↓
      package
          ↓
 canonical VSIX artifact
          ↓
 clean VS Code installation
          ↓
       real Run
          ↓
      real Debug
```

The canonical VSIX is produced once and then reused by the downstream
validation jobs. The downstream jobs must test the same packaged artifact that
would be distributed, rather than rebuilding separate VSIX copies.

CI artifacts are stored as GitHub Actions artifacts associated with the
workflow run. They are not committed to this repository.

## Reproducibility

A successful CI run must establish all of the following:

```text
exact Protos source revision
        +
exact npm dependency lock
        +
deterministic package assets
        +
deterministic VSIX canonicalization
        =
reproducible VSIX artifact
```

Changing the pinned Protos revision, extension source, dependency lock,
packaging inputs or package assets must therefore produce a corresponding
artifact change or an explicit, reviewable reason why the semantic package
content remains unchanged.

## Issue tracking

This repository has independent issue tracking from
[`guillermomolina/protos`](https://github.com/guillermomolina/protos/issues).

Issues concerning the VS Code extension belong here, including:

- VS Code editor integration;
- language-server client behavior;
- debugger and DAP integration;
- Run Current File;
- VS Code Remote integration;
- extension packaging and VSIX reproducibility;
- Marketplace/release concerns;
- extension-specific CI and distribution failures.

Issues concerning the Protos language, runtime, compiler, standard library or
other core implementation remain in the canonical Protos repository.

Historical work that originally produced the extension may reference project
milestones such as LM009, but those historical identifiers do not make the
Protos repository the owner of current extension work.

## Repository boundary

The repository boundary is intentionally:

```text
guillermomolina/protos
    canonical language/runtime source
                │
                │ exact Git revision
                ▼
guillermomolina/protos-vscode-extension
    editor integration
    packaging
    CI
    VSIX artifacts
    distribution
```

The dependency therefore flows from the canonical language/runtime repository
to the editor product repository.

The extension repository must not copy or fork the Protos runtime merely to
make the editor pipeline self-contained.

## License

Protos and this extension are distributed under the
[Adaptive Public License 1.0](LICENSE.TXT).

The complete license text is included in `LICENSE.TXT` and the VSIX-compatible
copy is provided as `license.txt`.

Third-party dependency notices are included in
[`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt).