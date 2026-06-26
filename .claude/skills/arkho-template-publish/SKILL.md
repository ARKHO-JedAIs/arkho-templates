---
name: arkho-template-publish
description: "Trigger: validate template, publish template, push template, bump template version, release arkho template, template tag. Validate and release an ARKHO template via the manual git-tag flow (CLI publish commands are planned)."
license: Apache-2.0
metadata:
  author: sergio-mondragon
  version: "1.1"
---

## Activation Contract

Use when validating a finished template manifest, choosing a version bump, or publishing a template. Do NOT use for authoring parameters/structure (see `arkho-template-author`).

## Status — CLI publish commands are planned

> 🚧 `arkho-cli template validate` and `arkho-cli template push` do NOT exist yet. The current CLI's `template` command only LISTS the catalog. Until they ship, validate and release MANUALLY (steps below). The hard rules on tag namespace, immutability, and version↔tag match still apply regardless of how the tag is created.

## Hard Rules

- **Tag namespace is mandatory.** A published version is the annotated git tag `<name>@<version>` (e.g. `react-spa@1.1.0`). The CLI resolves versions by filtering tags on the `<name>@` prefix, so a `<name>/v<version>` tag is NOT recognized.
- The manifest `version` field MUST match the tag — tag `react-spa@1.1.0` requires `version: 1.1.0` in `arkho.template.yaml`.
- Versions are IMMUTABLE. Never move or delete a published tag; to correct a release, bump and push a new tag. Re-tagging an existing `<name>@<version>` is forbidden.
- Tag a clean, committed working tree — the tag must point at a committed state, never local edits.
- Validate before releasing (see Execution Steps). The `$schema` line gives live editor checks for shape; coherence (name↔folder, each `default` satisfies its parameter's rules, every `when` — on parameters AND `templating.include` entries — parses and references only prior parameters, globs compile, `choices` have no duplicate `value`) is enforced by the CLI's manifest parser, the same code path `generate` uses.

## Decision Gates — semver bump

| Change | Bump |
|---|---|
| Fix, no parameter or generated-structure change | PATCH |
| New optional parameter or new files | MINOR |
| Renamed/removed parameter, type change, output restructure | MAJOR |

MAJOR = breaks anyone automating `generate` with flags. First publishable release: `1.0.0` (or `0.x` while experimental).

## Execution Steps (manual release)

1. **Validate.** Confirm the editor shows no `$schema` errors (shape). For coherence, parse the manifest with the CLI's own parser (`parseTemplateManifest` from the CLI's `core/manifest/template-manifest.js`, fed the YAML parsed object) — there is no standalone `validate` command yet. Fix every reported error.
2. **Bump.** Pick the bump from the table; update `version` in `arkho.template.yaml`.
3. **Commit** the change with a clean working tree.
4. **Tag** with the `<name>@<version>` namespace:
   ```bash
   git tag -a 'react-spa@1.1.0' -m 'react-spa template v1.1.0'
   ```
5. **Push** the commit and the tag:
   ```bash
   git push origin main
   git push origin react-spa@1.1.0
   ```
6. **Verify history** (tags are the version record): `git tag -l '<name>@*'`.

## Output Contract

Report: validation result, chosen bump + new version, tag pushed, and any blocker (dirty tree, pre-existing tag, version/tag mismatch, or coherence error).

## References

- `references/release.md` — tag format, immutability rationale, bump examples.
