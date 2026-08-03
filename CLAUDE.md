# arkho-templates — agent instructions

Catalog of project templates consumed by `arkho-cli`. This repo ships **template
source**, not a running application: every file under `templates/<name>/` is
materialized into a client project with `{{ token }}` substitution.

## The core constraint

Files here are **both** valid source **and** templates. That means:

- `{{ param }}` tokens are intentional. Never "fix" one by hardcoding a value.
- Editing a stack means editing what every future client gets. Prefer a new
  manifest parameter over a hardcoded value that only suits one client.
- A file that legitimately contains literal `{{ }}` (e.g. JSX `style={{...}}`)
  must be listed in `templating.exclude`, or generation will mangle it.

## Verifying a change

The manifest validating is **not** sufficient — it doesn't catch a template that
renders into a project that won't build. To verify a change to
`templates/aws-datalake-foundation`:

1. Copy the template to a scratch dir and substitute every token with realistic
   values. Do this **twice**, with contrasting answers — e.g. `dev` + retention
   on + VPC off, and `prod` + retention `0` + VPC on. Several past defects only
   appeared in one branch.
2. In each render: `npm install && npm run build && npm test`, then
   `npx cdk synth -c env=<env>` and `npm run nag`.
3. `npm run nag` must exit 0. It is a real gate — cdk-nag suppressions live next
   to the code they excuse and every one carries a `reason`. If you add a
   permission, scope it rather than widening a suppression.
4. Confirm no `{{ }}` survives in the rendered `.ts`/`.json` output.

Note `synth` for stacks with concrete accounts can need AWS credentials if any
construct does a context lookup. `NetworkStack` pins `availabilityZones`
specifically so `synth` works offline — don't replace it with `maxAzs`.

## Publishing

Versions are annotated git tags `<name>@<version>` and are **immutable**. The
manifest `version` must match the tag. Update `registry.json` in the same commit
as a manifest change. See `.claude/skills/arkho-template-publish/`.

## Known deliberate choices

- `enable_vpc` ships a VPC that nothing is attached to. That is intentional: it
  is a building block deployed up front because retrofitting it later forces
  resource recreation. Developers wire Glue/Lambda/DMS to it when a private-network
  need appears.
- The Archive zone has a writer grant but no pipeline writing to it; clients
  attach their own archival process.
- Glue crawlers run on their own schedule rather than inside the Step Functions
  pipeline. Keep `crawler_schedule` comfortably after `pipeline_schedule` — a
  crawler that fires mid-pipeline can infer a schema from partial writes.

## Spec Kit

`.specify/` and the `speckit-*` skills are unused scaffolding in this repo (no
`specs/` directory exists). Ignore them unless explicitly asked.
