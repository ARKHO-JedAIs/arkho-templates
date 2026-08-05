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
| [`aws-datalake-foundation`](templates/aws-datalake-foundation/) | `aws-datalake-foundation@1.0.2` | Foundational AWS Data Lake on CDK v2 (TypeScript) — 5 S3 zones (Raw/Clean/Curated in Iceberg/Archive in Glacier/Quarantine), Glue ETL orchestrated by Step Functions with a validation gate, enforced Lake Formation + Glue Data Catalog governance, KMS encryption, CloudTrail auditing, optional VPC, split into 7–8 stacks. Ingestion is a doorway rather than an implementation: a Raw-zone writer role and a secret for the source database, no producers. You pick which environments the project has (from dev/qa/stg/prod), deployable to one shared AWS account or one account each, with every operational tunable spelled out per environment in code. Governed resource tagging, cdk-nag and tests. |

> Latest versions are the source of truth in git tags: `git tag -l '<name>@*'`.
> `registry.json` mirrors this table and must be updated in the same commit as a
> manifest change. Note: `aws-datalake-foundation` currently has `version: 2.0.0`
> in its manifest, which is **not yet tagged** — the newest published tag is
> `1.0.2`.

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
registry.json           # catalog index: one entry per template (name, version, path)
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
4. Add the template to `registry.json` (`name`, `version`, `category`, `tags`,
   `path`) and to the table above.
5. Render the template with real answers and verify the output actually builds
   and its tests pass — a manifest that validates can still produce a broken
   project (e.g. a `nextSteps` command that doesn't exist for every choice of an
   enum parameter).

See the [`arkho-template-author`](.claude/skills/arkho-template-author/) skill
for the schema-driven workflow.

## Validating & publishing

Before tagging a version, validate the template with `arkho-cli`:

```bash
# Static checks: manifest contract, folder/name match, semver, token
# cross-check (undeclared token errors, unused parameter / optional-without-
# default warns).
npx @jedais/arkho-cli@latest template validate --dir templates/react-spa

# Dry-run through the real generate engine into a temp dir: answers come from
# arkho.template.fixtures.yaml (if present), else each parameter's default,
# else a constraint-satisfying synthesized value. No network, no prompts,
# hooks are declared but never executed, temp dir is always cleaned up.
npx @jedais/arkho-cli@latest template validate --dir templates/react-spa --full

# Preserve the generated project for inspection before tagging a release
# candidate (fails fast if <dir> is non-empty; a failed run leaves nothing
# behind).
npx @jedais/arkho-cli@latest template validate --dir templates/react-spa --full --out /tmp/react-spa-check
cd /tmp/react-spa-check && pnpm install && pnpm run build
```

Exit codes: `0` OK/warnings, `2` validation errors, `3` not a template dir,
`5` target conflict, `7` scaffold write failure, `10` manifest parse error.
`template validate` must exit `0` before tagging.

> 🚧 **`arkho-cli template push` is planned and not yet available** — release
> the tag manually:

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
