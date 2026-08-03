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
   values. Do this **twice**, with contrasting answers — e.g. `account_strategy`
   `shared` + retention on + VPC off + no extra tags, and `per_environment` +
   retention `0` + VPC on + extra tags set. Several past defects only appeared in
   one branch.
2. In each render: `npm install && npm run build && npm test`, then
   `npx cdk synth -c env=<env>` for **all four** environments and `npm run nag:all`.
3. `npm run nag:all` must exit 0 for every environment. It is a real gate —
   cdk-nag suppressions live next to the code they excuse and every one carries a
   `reason`. If you add a permission, scope it rather than widening a suppression.
4. Confirm no `{{ }}` survives in the rendered `.ts`/`.json` output.
5. Check `cdk.out/manifest.json` — every artifact's `environment` must be
   `aws://<expected-account>/<region>`. In `shared` all four envs show the same
   account; in `per_environment` they differ. This is what catches broken account
   coalescing.

**Token substitution gotcha that shapes the design:** a parameter with no answer
and no `default` renders the **literal** `{{ token }}` into the output file (see
`arkho-cli` `core/scaffold/materialize.ts`), not an empty string. So every
parameter carrying a `when` MUST declare a `default`. `environments.ts` relies on
this: the per-environment account tokens render as `''` in `shared` mode and are
coalesced in TypeScript by `accountOr()`. That empty string is by design.

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
- LF-Tag keys are suffixed with the environment (`dominio_dev`). This is load
  bearing, not cosmetic: LF-Tags are singletons per account+region, so fixed keys
  make the second environment deployed into a shared account fail with
  `AlreadyExistsException` mid-deploy. Don't "simplify" it back.
- `Tags.of(app)` covers every taggable resource, including the Glue L1s (CDK models
  Glue's free-form JSON tag map via `TagType.MAP`). The types in
  `UNTAGGABLE_TYPES` genuinely have no `Tags` property in their CloudFormation
  schema — an aspect with `addPropertyOverride('Tags', …)` would produce a template
  CloudFormation rejects, so don't add one.
- Don't add the `@aws-cdk/core:explicitStackTags` feature flag to `cdk.json`: it
  makes `Tags.of()` stop emitting stack-level tags.

## Spec Kit

`.specify/` and the `speckit-*` skills are unused scaffolding in this repo (no
`specs/` directory exists). Ignore them unless explicitly asked.
