---
name: arkho-template-publish
description: "Trigger: validate template, publish template, push template, bump template version, release arkho template, template tag. Validate an ARKHO template with the CLI's `template validate` command, then release it via the manual git-tag flow (`template push` is planned but not yet available)."
license: Apache-2.0
metadata:
  author: sergio-mondragon
  version: "1.1"
---

## Activation Contract

Use when validating a finished template manifest, choosing a version bump, or publishing a template. Do NOT use for authoring parameters/structure (see `arkho-template-author`).

## Status — validate ships, push is planned

`arkho-cli template validate` is available (arkho-cli 0.3.1+, published as `@jedais/arkho-cli`): static manifest/token checks, plus a `--full` dry-run through the real generate engine. Run it and require exit `0` before tagging (steps below). `arkho-cli template push` does NOT exist yet — release the tag MANUALLY. The hard rules on tag namespace, immutability, and version↔tag match still apply regardless of how the tag is created.

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

1. **Validate.** Run static checks while iterating, then `--full` before committing, then `--full --out` + a build of the output before tagging a release candidate. Fix every reported error (and review warnings) at each stage; do not proceed to tagging until the last run exits `0`.
   ```bash
   # Static: manifest contract (zod), folder/name match, semver, token
   # cross-check (undeclared token = ERROR, unused parameter / optional
   # without default = WARN). Honors templating.exclude.
   npx @jedais/arkho-cli@latest template validate --dir templates/<name>

   # Full: dry-runs the real generate engine into a temp dir. Answers come
   # from arkho.template.fixtures.yaml (if present) -> parameter default ->
   # constraint-satisfying synthesized value. Output is scanned for
   # unresolved tokens. Hooks are declared but never executed. No network,
   # no prompts, CI-safe, temp dir always cleaned up.
   npx @jedais/arkho-cli@latest template validate --dir templates/<name> --full

   # Full + out: preserves the generated project for inspection before
   # tagging. Fails with exit 5 if <out-dir> is non-empty; a failed run
   # leaves nothing behind.
   npx @jedais/arkho-cli@latest template validate --dir templates/<name> --full --out <out-dir>
   cd <out-dir> && pnpm install && pnpm run build
   ```
   Exit codes: `0` OK/warnings, `2` validation errors, `3` not a template dir, `5` target conflict, `7` scaffold write failure, `10` manifest parse error. OK/WARN/ERROR markers print on stderr. `template validate` MUST exit `0` before step 4 (Tag).
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
