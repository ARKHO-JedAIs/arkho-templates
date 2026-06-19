---
name: arkho-template-publish
description: "Trigger: validate template, publish template, push template, bump template version, release arkho template, template tag. Validate and publish an ARKHO template through its CLI release workflow."
license: Apache-2.0
metadata:
  author: sergio-mondragon
  version: "1.0"
---

## Activation Contract

Use when validating a finished template manifest, choosing a version bump, or publishing a template. Do NOT use for authoring parameters/structure (see `arkho-template-author`).

## Hard Rules

- `arkho-cli template validate [folder]` is the gate. It checks schema shape PLUS coherence the schema cannot express: `name` equals the folder, each `default` satisfies its own parameter's rules, every `when` (on parameters AND on `templating.include` entries) parses and references only prior parameters, globs compile, and `choices` have no duplicate `value`. No PR merges with an invalid manifest — it is the CI gate.
- `arkho-cli template push [folder]` requires a clean working tree, re-runs validation, then creates and pushes the annotated tag `<name>@<version>`. The CLI resolves template versions by filtering tags on the `<name>@` prefix, so this namespace is mandatory — a `<name>/v<version>` tag is NOT recognized.
- Versions are IMMUTABLE. `push` fails if `<name>@<version>` already exists. To correct a release, bump — never move or delete a tag.
- The manifest `version` field MUST match the tag being pushed; a mismatch fails the push.
- Editor validation catches shape errors; `validate` catches coherence errors. Run `validate` even when the editor is green.

## Decision Gates — semver bump

| Change | Bump |
|---|---|
| Fix, no parameter or generated-structure change | PATCH |
| New optional parameter or new files | MINOR |
| Renamed/removed parameter, type change, output restructure | MAJOR |

MAJOR = breaks anyone automating `create-project` with flags. First publishable release: `1.0.0` (or `0.x` while experimental).

## Execution Steps

1. Run `arkho-cli template validate <folder>`; fix every reported error.
2. Pick the bump from the table; update `version` in `arkho.template.yaml`.
3. Commit — a clean working tree is required for push.
4. Run `arkho-cli template push <folder>` → publishes tag `<name>@<version>`.
5. Verify history (tags are the version record): `git tag -l '<name>@*'`.

## Output Contract

Report: validation result, chosen bump + new version, tag pushed, and any blocker (dirty tree, pre-existing tag, version/tag mismatch, or coherence error).

## References

- `references/release.md` — tag format, immutability rationale, bump examples.
