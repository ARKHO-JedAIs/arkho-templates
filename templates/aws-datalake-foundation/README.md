# {{ client_name }} — AWS Data Lake Foundation

Infrastructure as Code (AWS CDK v2, TypeScript) for a serverless data lake:
four S3 zones (Raw, Clean, Curated in Apache Iceberg, Archive in Glacier Instant
Retrieval), Glue ETL orchestrated by Step Functions, Glue Data Catalog + Lake
Formation governance, customer-managed KMS keys, CloudTrail data-event auditing,
an Athena workgroup, and optional ingestion Lambdas and VPC.

Generated from the ARKHO `aws-datalake-foundation` template (see `arkho.json`
for the exact version and answers).

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20 | Matches `@types/node` 20.x and the Lambda runtime (`nodejs20.x`). No `.nvmrc` or `engines` field is pinned. |
| {{ package_manager }} | Package manager chosen at generation. |
| AWS CDK CLI | Installed locally as the `aws-cdk` dev dependency (`^2.170.0`); run it with `npx cdk`. |
| AWS CLI + credentials | Credentials for account `{{ aws_account_id }}`, region `{{ aws_region }}`. |
| CDK bootstrap | Required once per account/region (Lambda code and Glue scripts are deployed as CDK assets). |
| Lake Formation admin | The deploying principal must be a Lake Formation administrator for the `governance` stack, or pass `-c lfAdminArn=<role/user ARN>` to register one through IaC. |

No local Python is needed: the Glue scripts in `glue/jobs/` run on AWS Glue 4.0.

## Getting started

```bash
{{ package_manager }} install
{{ package_manager }} run build      # type-check / compile with tsc
{{ package_manager }} test           # Jest + CDK assertions
npx cdk bootstrap aws://{{ aws_account_id }}/{{ aws_region }}   # once per account/region
{{ package_manager }} run synth:dev  # synthesize CloudFormation for dev
```

Then deploy (see [Deploy](#deploy)) and confirm the SNS subscription email sent
to **{{ admin_email }}**.

## Configuration

There is no `.env` file. Configuration lives in two places, already filled from
your CLI answers.

**`cdk.json` → `context`** (override any key with `-c key=value`):

| Key | Value | Parameter | Purpose |
|---|---|---|---|
| `env` | `{{ environment }}` | `environment` | Default environment when no `-c env=` is passed (the npm scripts pass it explicitly). |
| `enableIngestionLambdas` | `{{ enable_ingestion_lambdas }}` | `enable_ingestion_lambdas` | Creates the `ingestion` stack unless set to `false`. |
| `enableVpc` | `{{ enable_vpc }}` | `enable_vpc` | Creates the `network` stack only when `true`. |
| `vpcCidr` | `{{ vpc_cidr }}` | `vpc_cidr` | VPC CIDR used by the `network` stack. |
| `nag` | (unset) | — | `true` adds cdk-nag `AwsSolutionsChecks` (used by the `nag` script). |
| `lfAdminArn` | (unset) | — | Optional Lake Formation admin to register in the `governance` stack. |

**`lib/config/environments.ts`** — typed per-environment settings (`dev`,
`staging`, `prod`), all in region `{{ aws_region }}` with alerts to
`{{ admin_email }}`:

| Setting | `dev` | `staging` | `prod` |
|---|---|---|---|
| `removalPolicy` / `autoDeleteObjects` | DESTROY / yes | RETAIN / no | RETAIN / no |
| `terminationProtection` | no | no | yes |
| `glueMaxWorkers` | 3 | 3 | 5 |
| `athenaBytesCutoff` (per query) | 5 GiB | 5 GiB | 10 GiB |
| `rawTransitionDays` / `archiveRetentionYears` | 90 / 7 | 90 / 7 | 90 / 7 |
| `ingestSchedule` / `pipelineSchedule` / `crawlerSchedule` | 06:00 / 07:00 / 08:30 UTC daily | same | same |
| `sftp.enabled` | false | false | false |

> **Retention answers:** you answered `raw_retention_days` = {{ raw_retention_days }}
> and `archive_retention_years` = {{ archive_retention_years }}, but the generated
> config sets `rawTransitionDays: 90` and `archiveRetentionYears: 7` in every
> environment. If your answers differ, edit those values in
> `lib/config/environments.ts`.

Naming: resources and stacks use the prefix `{{ project_slug }}-<env>`; Glue
databases are `{{ catalog_prefix }}_<env>_<zone>`. Every resource is tagged
`proyecto={{ project_slug }}`, `cliente={{ client_name }}`, `ambiente=<env>`,
`gestionado-por=cdk`, `owner=arkho`.

## What's included

Stacks are named `{{ project_slug }}-<env>-<stack>` (see `bin/app.ts`):

| Stack | Created when | Resources |
|---|---|---|
| `network` | `enableVpc=true` (`enable_vpc`) | VPC (2 AZs, private + public subnets, 1 NAT gateway), S3 gateway endpoint, Glue and Secrets Manager interface endpoints; outputs `VpcId` and `PrivateSubnetIds`. Nothing is attached to it yet. |
| `security` | always | KMS CMKs `alias/<prefix>-data` and `alias/<prefix>-ops` (rotation on), encrypted SNS topic `<prefix>-alerts` with an email subscription to `{{ admin_email }}`. |
| `storage` | always | Raw, Clean, Curated, Archive and Athena-results buckets (SSE-KMS with the data key, bucket keys, versioning, SSL enforced, public access blocked) plus an SSE-S3 access-logs bucket. Lifecycle: Raw → Glacier IR after `rawTransitionDays`; Archive → Glacier IR after 1 day, expires after `archiveRetentionYears`; Athena results expire after 30 days. No physical bucket names. |
| `governance` | always | Glue databases for raw, clean and curated; LF-Tags `dominio` (marketing, operaciones, finanzas) and `sensibilidad` (pii, interno, publico); Raw/Clean/Curated registered as Lake Formation locations; data lake settings only when `lfAdminArn` is passed. |
| `ingestion` | `enableIngestionLambdas` is not `false` (`enable_ingestion_lambdas`) | GA4 and Meta Ads Lambdas (Node 20, ARM64, X-Ray, EventBridge schedule), Secrets Manager secrets `<prefix>/ga4-api` and `<prefix>/meta-ads-api`, encrypted SQS DLQ. SFTP Connector (Transfer Family) and secret `<prefix>/sftp-origen` only when `sftp.enabled` and `sftp.url` are set in `environments.ts`. |
| `processing` | always | Glue 4.0 jobs `raw-to-clean` and `clean-to-curated` (G.1X, auto-scaling, bookmarks, SSE-KMS security configuration, Iceberg on the curated job), crawlers for clean and curated, DynamoDB table `<prefix>-job-config`, Step Functions pipeline with retries/backoff and SNS on failure, daily schedule, failure alarm. |
| `consumption` | always | Athena workgroup `<prefix>-analytics` (enforced config, per-query bytes cutoff, KMS-encrypted results). |
| `observability` | always | CloudTrail trail with log file validation, management events and S3 data events on the four zone buckets. |

The Lambda handlers (`lambda/*/index.js`) and Glue scripts (`glue/jobs/*.py`)
are placeholders with `TODO` blocks: they write empty output until you implement
the API calls and transformations.

## Project structure

```
.
├── bin/app.ts                    # CDK app: wires stacks, tags, cdk-nag
├── lib/
│   ├── config/environments.ts    # per-environment settings
│   └── stacks/                   # network, security, storage, governance,
│                                 # ingestion, processing, consumption, observability
├── lambda/
│   ├── ga4-ingest/index.js       # GA4 → Raw zone (placeholder)
│   └── meta-ads-ingest/index.js  # Meta Ads → Raw zone (placeholder)
├── glue/jobs/
│   ├── raw_to_clean.py           # Raw → Clean (placeholder)
│   └── clean_to_curated.py       # Clean → Curated, Iceberg (placeholder)
├── test/storage-stack.test.ts    # CDK assertion tests
├── cdk.json                      # CDK app command + context flags
├── jest.config.js
├── tsconfig.json
├── package.json
└── arkho.json                    # template provenance
```

## Scripts

| Script | Command | What it does |
|---|---|---|
| `build` | `tsc` | Compiles TypeScript (type check). |
| `watch` | `tsc -w` | Compiles on change. |
| `test` | `jest` | Runs the tests in `test/`. |
| `cdk` | `cdk` | Runs the local CDK CLI. |
| `synth:dev` | `cdk synth --quiet -c env=dev` | Synthesizes all dev stacks. |
| `diff:dev` | `cdk diff -c env=dev` | Diffs dev against the deployed stacks. |
| `deploy:dev` | `cdk deploy --all -c env=dev` | Deploys all dev stacks. |
| `deploy:prod` | `cdk deploy --all -c env=prod --require-approval broadening` | Deploys all prod stacks, asking before security-broadening changes. |
| `nag` | `cdk synth --quiet -c env=dev -c nag=true` | Synthesizes dev with cdk-nag AWS Solutions checks. |

There are no `staging` scripts, and no synth/diff scripts for `prod`; use the CDK
CLI directly for those (see below).

## Deploy

1. Bootstrap once: `npx cdk bootstrap aws://{{ aws_account_id }}/{{ aws_region }}`.
2. Make sure the deploying principal is a Lake Formation admin, or add
   `-c lfAdminArn=<ARN>` to the deploy command.
3. Deploy an environment:

   ```bash
   {{ package_manager }} run deploy:dev                   # dev
   npx cdk deploy --all -c env=staging                    # staging
   {{ package_manager }} run deploy:prod                  # prod
   npx cdk diff -c env=prod                               # preview prod first
   ```

   One stack only: `npx cdk deploy {{ project_slug }}-<env>-storage -c env=<env>`.
4. Confirm the SNS subscription email sent to **{{ admin_email }}**.
5. If ingestion is enabled, load real values into the secrets
   `{{ project_slug }}-<env>/ga4-api` (the handler requires `property_id`) and
   `{{ project_slug }}-<env>/meta-ads-api` (requires `access_token`), then
   implement the `TODO` blocks in `lambda/` and `glue/jobs/`.
6. To pull files over SFTP, set `sftp.enabled`, `url` and `trustedHostKeys` in
   `lib/config/environments.ts`, redeploy, load `{{ project_slug }}-<env>/sftp-origen`,
   and schedule the transfers yourself (no `StartFileTransfer` schedule is defined).
7. Grant fine-grained access (LF-Tag permissions for analyst roles) in Lake
   Formation / SageMaker Unified Studio or with additional `CfnPrincipalPermissions`.
8. If the VPC is enabled, attach the Glue jobs or Lambdas to it using the
   `PrivateSubnetIds` output of the `network` stack.

To enable an optional stack after generation, change its flag in `cdk.json`
(or pass `-c enableVpc=true` / `-c enableIngestionLambdas=false`) and redeploy.

## Testing & quality

```bash
{{ package_manager }} run build   # TypeScript strict type check
{{ package_manager }} test        # storage stack: 6 buckets, public access blocked, SSE-KMS, lifecycle rules
{{ package_manager }} run nag     # cdk-nag AwsSolutionsChecks on the dev synth
```

There is no linter configured.

## Regenerating / upgrading

`arkho.json` records the template name, version, git tag and your answers. The
template version is pinned there, so regenerating with the same version and
answers reproduces this project; compare against a newer template version to
pick up upstream changes.
