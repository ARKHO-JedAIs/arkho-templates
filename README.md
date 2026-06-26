# ARKHO Templates

Monorepo of project templates consumed by `arkho-cli`. Each template lives under
`templates/<name>/` and is materialized into a new project with
`arkho-cli generate`. Template versions are published as git tags
(`<name>@<version>`), so a generated project records exactly which template and
version produced it.

## Available templates

| Template | Latest | Description |
|---|---|---|
| [`react-spa`](templates/react-spa/) | `react-spa@1.1.0` | React SPA (TypeScript, Vite) wired to Cognito auth and a backend API — atomic-design structure, shadcn/Radix UI, React Query, Axios, Zustand, and Zod. |

> Latest versions are the source of truth in git tags: `git tag -l '<name>@*'`.

## Using a template

```bash
# Interactive: pick a template from the catalog, then answer its prompts
arkho-cli generate

# Target a template and project name directly
arkho-cli generate --template react-spa --name my-app

# Pin an exact template version (default: latest published tag)
arkho-cli generate --template react-spa --name my-app --template-version 1.1.0

# Choose the parent directory for the new project (default: current dir)
arkho-cli generate --template react-spa --name my-app --dir ./apps

# Non-interactive (CI): use defaults/flags and skip overwrite/hook confirmations
arkho-cli generate --template react-spa --name my-app --yes
```

The CLI fetches this repo at the resolved `<name>@<version>` tag, asks the
template's parameters (each answerable as a `--kebab-case` flag, e.g.
`--aws-region`), substitutes `{{ tokens }}` in file contents, runs any
post-generation hooks, prints the template's `nextSteps`, and writes an
`arkho.json` provenance record into the new project.

## Repository layout

```
templates/<name>/
  arkho.template.yaml   # the manifest (parameters, validation, templating rules)
  ...                   # the template source files (runnable as-is, tokens included)
CLAUDE.md               # agent instructions for this repo
.claude/skills/         # authoring & publishing skills
```

## How templates work

- **Manifest** — `templates/<name>/arkho.template.yaml` declares `parameters`
  (snake_case, with type-matched validation), the `templating` rules, and
  `nextSteps`. The folder name must equal the manifest `name`.
- **Token engine** — flat `{{ token }}` substitution in **file contents**. No
  conditionals, loops, or helpers, so template files stay valid, runnable
  source. An unknown or unanswered token resolves to empty, so give optional
  parameters a `default` (e.g. `default: ""`) to avoid leaking a literal
  `{{ token }}` into output. Make output conditional with `templating.include`
  (whole files), never with in-file logic. Files that carry their own literal
  `{{ }}` (e.g. JSX `style={{...}}`) go in `templating.exclude`.
- **Provenance** — at generation the CLI writes `arkho.json` (template name,
  version, tag, commit, and the answers) for reproducibility and upgrades.

## Authoring a new template

> 🚧 **CLI-assisted scaffolding is planned and not yet available.** For now,
> author the manifest by hand:

1. Create `templates/<name>/` with an `arkho.template.yaml` starting with the
   `$schema` line; the folder name must equal the manifest `name`.
2. Define parameters in ask-order; type-match every validation rule; give
   optional parameters a `default` so `--yes` and token substitution behave.
3. Mark binaries and files with literal `{{ }}` under `templating.exclude`,
   internal docs under `skip`, and conditional files under `templating.include`.

See the [`arkho-template-author`](.claude/skills/arkho-template-author/) skill
for the schema-driven workflow.

## Validating & publishing

> 🚧 **`arkho-cli template validate` and `arkho-cli template push` are planned
> and not yet available** — the current CLI's `template` command only lists the
> catalog. Until they ship, release manually:

```bash
# 1. Bump `version` in templates/<name>/arkho.template.yaml, then commit (clean tree).

# 2. Tag with the mandatory <name>@<version> namespace. The CLI resolves versions
#    by filtering tags on the `<name>@` prefix, so a `<name>/v<version>` tag is
#    NOT recognized.
git tag -a 'react-spa@1.1.0' -m 'react-spa template v1.1.0'

# 3. Push the commit and the tag.
git push origin main
git push origin react-spa@1.1.0

# Version history
git tag -l 'react-spa@*'
```

Published versions are **immutable** — never move or delete a tag; bump instead.

Bump convention: **PATCH** for fixes that don't change parameters or output;
**MINOR** for new optional parameters or files; **MAJOR** for renamed/removed
parameters, type changes, or output restructuring. See the
[`arkho-template-publish`](.claude/skills/arkho-template-publish/) skill.
