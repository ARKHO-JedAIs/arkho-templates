---
name: arkho-template-author
description: "Trigger: new arkho template, author arkho.template.yaml, add template parameter, define prompt/validation, conditional when, template manifest. Scaffold and fill an ARKHO template manifest per its schema contract."
license: Apache-2.0
metadata:
  author: sergio-mondragon
  version: "1.0"
---

## Activation Contract

Use when creating a template folder under `templates/<name>/` or editing its `arkho.template.yaml` — defining parameters, validation, conditional prompts (`when`), interpolation, hooks, or next-steps. Do NOT use for the release flow (see `arkho-template-publish`) or for editing a generated `arkho.json` (machine-written, never hand-edited).

## Hard Rules

- Manifest lives at `templates/<name>/arkho.template.yaml`. A folder without it is not a template. `.json` is accepted but YAML is the convention.
- First line MUST be the `# yaml-language-server: $schema=https://unpkg.com/@jedais/arkho-cli/schema/arkho.template.schema.json` reference (resolves to the latest published schema), for editor validation and autocomplete. Pin `@<version>` only when a specific contract is required.
- Required top-level: `schemaVersion: 1`, `name`, `description` (<=500), `version` (strict semver). `name` MUST equal the folder name, kebab-case `^[a-z][a-z0-9-]{1,40}$`.
- Parameter `name` is snake_case `^[a-z][a-z0-9_]{1,40}$`; it becomes the `{{ param }}` interpolation var, the `arkho.json` key, and the auto `--kebab-case` flag.
- `additionalProperties: false` everywhere — an unknown field or typo (`defualt:`) is a hard error, never silently ignored.
- A validation rule MUST match its type (`pattern` on an `integer` fails). `secret` forbids `default` — no plaintext credentials versioned in the repo.
- Every `pattern` MUST ship a `patternHint` (actionable message, not the raw regex).
- `when` references ONLY prior parameters; small grammar (`== != > >= < <=`, `'x' in multichoice`, `&& || !`), no arithmetic/functions/external access.
- `templating.engine: token` (default) does FLAT `{{ token }}` substitution only — in **file contents** (the CLI does NOT substitute file/path names). NO conditionals/loops/helpers (`{{#if}}`/`{{#each}}` do not exist); an unknown/absent token becomes empty (give optional params a `default`). Conditionality is whole-file (`include`/`skip`/`exclude`), NEVER logic inside a file — template files stay runnable source.
- `hooks.post` executes template code on the consumer's machine — reserve for mechanical init (`git init`, `chmod +x`). NOT dependency installs; route those through `nextSteps`.

## Decision Gates

| Need | Do |
|---|---|
| Fixed set of options | `choice` (single) / `multichoice` (list), with `choices` |
| Node project toolchain | declare conventional `package_manager`; interpolate as `{{ package_manager }}` (avoid pinning a cross-PM corepack `packageManager` version — see `references/parameters.md`) |
| Binary/asset files, or files with their own `{{ }}` | `templating.exclude` (copied, no substitution — engine would corrupt binaries / mangle literal `{{ }}`) |
| Internal docs/fixtures | `templating.skip` (not copied; the manifest itself is always skipped) |
| Token/credential at gen time | `secret` (masked, never persisted) — last resort, prefer runtime env |
| Ask a parameter only in some cases | `when` over a prior parameter (governs the prompt, not files) |
| Emit a FILE only in some cases | `templating.include` entry `{ path, when }` — the only way to make output conditional |
| Literal copy, no variables | `templating.engine: none` |

## Execution Steps

1. Copy `assets/arkho.template.yaml` into `templates/<name>/` and set the `$schema` line.
2. Set `name` (= folder), `description`, `version` (`1.0.0` if usable, `0.x` if experimental); optional `title`/`category`/`tags`/`maintainers`/`requires`.
3. Define `parameters` in ask-order (list order = prompt order). Per parameter: pick `type`, write `prompt` as a real question, set `required`/`default`/`when`, add type-matched validation — see `references/parameters.md`.
4. Configure `templating.exclude`/`skip`, and `templating.include` (`{ path, when }`) for any file that should appear only under a condition; add `hooks.post` only for mechanical init; fill `nextSteps` (supports `{{ }}`).
5. Validate before opening a PR — hand off to `arkho-template-publish`.

## Output Contract

Report: manifest path, parameter list (name / type / required / when), any `hooks` added, and any unresolved validation concern.

## References

- `assets/arkho.template.yaml` — annotated starter skeleton.
- `references/parameters.md` — per-type fields, validation rules, conventions, and the `when` mini-language.
