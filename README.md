# ARKHO Templates

Monorepo of project templates consumed by `arkho-cli`. Each template lives under
`templates/<name>/` and is materialized into a new project with
`arkho-cli create-project`. Template versions are published as git tags
(`<name>/v<semver>`), so a generated project records exactly which template and
version produced it.

## Available templates

| Template | Description |
|---|---|
| [`react-spa`](templates/react-spa/) | React SPA (TypeScript, Vite) wired to Cognito auth and a backend API — atomic-design structure, shadcn/Radix UI, React Query, Axios, Zustand, and Zod. |

## Using a template

```bash
arkho-cli create-project react-spa my-app   # interactive prompts
arkho-cli create-project react-spa my-app --yes   # non-interactive (CI), uses defaults/flags
```

The CLI clones this repo at the resolved tag, asks the template's parameters
(answerable as `--kebab-case` flags), substitutes `{{ tokens }}` in file contents
and path names, and writes an `arkho.json` provenance record into the new project.

## Repository layout

```
templates/<name>/
  arkho.template.yaml   # the manifest (parameters, validation, templating rules)
  ...                   # the template source files (runnable as-is, tokens included)
MANIFESTS.md            # full reference: manifest schema, templating engine, arkho.json
CLAUDE.md               # agent instructions for this repo
.claude/skills/         # authoring & publishing skills
```

## How templates work

- **Manifest** — `templates/<name>/arkho.template.yaml` declares `parameters`
  (snake_case, each `string` carrying a `pattern` + `patternHint`), the
  `templating` rules, and `nextSteps`. The folder name must equal the manifest
  `name`. See [`MANIFESTS.md`](MANIFESTS.md) for the full contract.
- **Token engine** — flat `{{ token }}` substitution only, in file contents and
  path names. No conditionals, loops, or helpers, so template files stay valid,
  runnable source. An unknown token resolves to empty. Make output conditional
  with `templating.include` (whole files), never with in-file logic. Files that
  carry their own literal `{{ }}` (e.g. JSX `style={{...}}`) go in
  `templating.exclude`.
- **Provenance** — at generation the CLI writes `arkho.json` (template name,
  version, tag, commit, and the answers) for reproducibility and upgrades.

## Authoring a new template

1. Create `templates/<name>/` with an `arkho.template.yaml` starting with the
   `$schema` line.
2. Define parameters in ask-order; type-match every validation rule; provide
   defaults so `--yes` works.
3. Mark binaries and files with literal `{{ }}` under `templating.exclude`,
   internal docs under `skip`, and conditional files under `templating.include`.
4. Validate locally, open a PR, and publish after merge.

See the [`arkho-template-author`](.claude/skills/arkho-template-author/) skill for
the schema-driven workflow.

## Validating & publishing

```bash
arkho-cli template validate templates/<name>   # CI gate — no PR merges if invalid
arkho-cli template push templates/<name>        # tags <name>/v<version> (clean tree required)
git tag -l '<name>/*'                            # version history
```

Bump convention: **PATCH** for fixes that don't change parameters or output;
**MINOR** for new optional parameters or files; **MAJOR** for renamed/removed
parameters, type changes, or output restructuring. See the
[`arkho-template-publish`](.claude/skills/arkho-template-publish/) skill.
