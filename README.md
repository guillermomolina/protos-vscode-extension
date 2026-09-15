# Protos VS Code Extension

VS Code extension for the Protos programming language.

This repository is the product and distribution home for the Protos VS Code
extension. The canonical Protos language/runtime source remains in
[`guillermomolina/protos`](https://github.com/guillermomolina/protos).

## Source authority

The exact Protos revision consumed by this repository is recorded in
`protos-source.lock.json`. It currently pins:

```text
repository = guillermomolina/protos
revision  = 5e33ab7b46a21da0eaecd9d5a5721d95b170518a
```

The extension must not become a second language/runtime authority. Protos
syntax, semantics, parsing, resolution and runtime behavior remain owned by the
canonical Protos repository.

## Extension

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

The extension is intentionally thin. The real Protos launcher remains external
through `protos.runtime.executable`; the extension does not embed the Protos
runtime or implement a second parser/semantic model.

## Local development

Install dependencies and build the production bundle with:

```sh
npm ci
npm run build
npm run package:assets
```

The canonical VSIX packaging path uses `@vscode/vsce`; deterministic artifact
canonicalization is handled by `scripts/canonicalize_vsix.js`.

## Licensing

The extension is distributed under the project's APL-1.0 licensing terms.
The repository and resulting VSIX must include the project license and the
required third-party notices.

## CI and distribution

GitHub Actions in this repository own the complete extension product pipeline:

```text
source revision lock
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

The VSIX is a GitHub Actions artifact during CI. Public release/distribution
policy is separate from ordinary `main` validation.
