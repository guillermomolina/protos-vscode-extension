# AGENTS.md

## Repository ownership

`guillermomolina/protos-vscode-extension` owns the Protos VS Code extension as a standalone product.

The canonical Protos language, runtime, specification, and core implementation remain owned by `guillermomolina/protos`.

## Issue families

Use issue families owned by this repository only:

- `BUG` — defects in the VS Code extension, debugger, language client, Run integration, packaging, Marketplace/distribution, or extension-specific CI.
- `CI` — continuous-integration and release-pipeline work that does not represent an extension product bug.
- `DOC` — extension-specific documentation.
- `REL` — release and distribution work.

Do not create core Protos language/runtime work here. Such work belongs in `guillermomolina/protos`.

## Issue numbering

Each issue family uses its own monotonically increasing numeric suffix in this repository, for example `BUG001`, `CI001`, `DOC001`, and `REL001`.

Before creating a family issue, inspect existing issues and use the next free identifier. Never reuse an identifier, even for a closed or migrated issue.

## Migrated work

When work moves from another repository:

1. Create the owning issue here using this repository's family/numbering scheme.
2. Preserve the original issue number and URL in the new issue body.
3. Close the original issue in its former repository as migrated/not planned, with a cross-reference to the new issue.
4. Do not maintain two active issues for the same work item.

## Product boundary

Extension issues must not silently broaden into language/runtime semantic decisions. If implementation reveals a substantive Protos language or runtime decision, stop the affected extension work and open or reference the corresponding decision/work item in `guillermomolina/protos`.

## Validation

The repository's primary local test interface is:

```sh
npm test
```

Packaging and VSIX validation are separate product checks and must remain reproducible from the committed dependency lock and `protos-source.lock.json`.