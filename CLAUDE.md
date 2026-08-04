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

## What gets asked vs what lives in code

The questionnaire asks **only what cannot change later without pain**: identity,
accounts, region, catalog prefix, alert email, tags, and the structural flags
(Object Lock — irreversible; VPC). Every operational tunable — retentions,
thresholds, crons, sizing — lives in `lib/config/environments.ts`, editable per
environment. Deploy-time knobs go in `cdk.json` context (`lfAdminArn`,
`lfStrictMode`, `analystPrincipalArn`, `ingestPrincipalArn`).

Adding a parameter is the expensive option: it lengthens the questionnaire for every
future client and bakes a value that can never be changed without regenerating.
Prefer a field in `environments.ts`.

## Known deliberate choices

- **`IngestionStack` is a doorway, not an implementation** — three resources: the
  `-ingest-writer` role (`grantPut`, never `grantWrite`: a producer must not be able
  to delete what already landed), a Secrets Manager secret for the source database,
  and the role's policy. Ingestion itself varies too much per project for a concrete
  implementation to be reusable — it would be code the client deletes. Vendor-specific
  producers (GA4/Meta Lambdas, an SFTP connector) were removed on purpose; don't add
  them back. If this stack grows past those three resources, question it.
  The secret uses AWS's conventional DB-credential keys (`engine`/`host`/`port`/
  `dbname`/`username`/`password`) so DMS, Glue connections and the SDKs read it
  without translation.
- `enable_vpc` ships a VPC that nothing is attached to. That is intentional: it
  is a building block deployed up front because retrofitting it later forces
  resource recreation. Developers wire Glue/DMS/their own ingestion to it when a
  private-network need appears.
- The data-quality gate is plain PySpark, not Glue Data Quality. `EvaluateDataQuality`
  was tried and removed: `process_rows` returns a `DynamicFrameCollection` (not a
  `DynamicFrame`), the role would need `glue:*DataQuality*`, and the CloudWatch
  namespace condition blocks its metrics. The extension point is `validate()` in
  `raw_to_clean.py` — Python in the repo, reviewable, not DQDL strings in DynamoDB.
- Glue scripts have **no automated tests**: the verification pipeline has no Python
  runtime. They are reviewed by inspection. The one invariant to guard when editing
  `raw_to_clean.py`: PASS means **zero** failed checks, never "passed at least one".
- Crawlers: `recrawlPolicy: CRAWL_NEW_FOLDERS_ONLY` forces `updateBehavior` and
  `deleteBehavior` to `LOG`, so it is applied only to the append-only zones (raw,
  clean) and never to Curated or Quarantine, where partitions get rewritten.
  `Grouping: CombineCompatibleSchemas` is deliberately absent everywhere — it can
  merge two distinct tables into one catalog table.
- The Archive zone has a writer grant but no pipeline writing to it; clients
  attach their own archival process.
- Glue crawlers run on their own schedule rather than inside the Step Functions
  pipeline. Keep `crawler_schedule` comfortably after `pipeline_schedule` — a
  crawler that fires mid-pipeline can infer a schema from partial writes.
- **Iceberg confs go in `--conf` on the job, never `spark.conf.set` in the script.**
  `spark.sql.extensions` is a *static* session conf: setting it after the
  SparkContext exists silently does nothing, and `MERGE INTO` plus every
  `CALL system.*` fails at runtime while synth, tests and cdk-nag stay green.
  `test/foundation.test.ts` guards this.
- The data-quality gate lives **inside** `raw_to_clean.py`, not in a Step Functions
  `Choice`. `GlueStartJobRun` with `RUN_JOB` does not return the job's output, so the
  state machine cannot read the row counts; the job can, so it fails itself.
- LF-Tag keys carry an environment suffix on purpose (LF-Tags are account+region
  singletons). Don't "simplify" it back — the second environment in a shared account
  would fail mid-deploy with `AlreadyExistsException`.
- The `/aws-glue/*` log groups are deliberately **not** managed here: they are shared
  account-wide across every Glue workload, so this stack setting their retention would
  decide for other projects. It's a documented post-generation account task.
- The Iceberg maintenance job discovers tables at runtime instead of taking a list,
  because `glue.CfnTableOptimizer` requires `tableName` at synth time and this
  template creates no tables.
- Object Lock is enabled at bucket creation and is irreversible; the default retention
  *rule* is applied only when `!autoDeleteObjects`, or the auto-delete custom resource
  cannot empty the bucket on `destroy`.
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
