# {{ client_name }} — AWS Data Lake Foundation (CDK v2, TypeScript)

Foundational AWS Data Lake as Infrastructure as Code. Serverless architecture:
3 S3 zones (Raw / Clean / Curated in Apache Iceberg), Glue ETL orchestrated by
Step Functions, native governance with Lake Formation + Glue Data Catalog, KMS
encryption end-to-end, and CloudTrail auditing for compliance.

## Stacks

| Stack | Contents |
|---|---|
| `security` | 2 KMS CMKs (data / ops), SNS alerts topic |
| `storage` | S3: Raw (lifecycle → Glacier IR), Clean, Curated, Athena results, access logs |
| `governance` | Glue Databases per zone, LF-Tags (domain, sensitivity), Lake Formation location registration |
| `ingestion` | Ingestion Lambdas (Node 20, ARM64), Secrets Manager, DLQ, schedules, optional SFTP Connector |
| `processing` | Glue Jobs (auto-scaling, SSE-KMS, bookmarks), Crawlers, DynamoDB config table, Step Functions with retries + SNS alarm |
| `consumption` | Athena WorkGroup (enforced config, bytes-scanned cutoff, encrypted results) |
| `observability` | CloudTrail with S3 data events over the lake zones (compliance) |

## Requirements

- Node.js 20+, AWS CLI configured
- Bootstrapped account: `npx cdk bootstrap aws://<account>/{{ aws_region }}`
- For `governance`: the deploying principal must be a Lake Formation admin
  (or pass `-c lfAdminArn=arn:...`)

## Usage

```bash
{{ package_manager }} install
{{ package_manager }} run build      # compile TypeScript
{{ package_manager }} test           # infrastructure tests (jest + assertions)
{{ package_manager }} run synth:dev  # synthesize CloudFormation
{{ package_manager }} run nag        # validate with cdk-nag (AwsSolutions)
{{ package_manager }} run deploy:dev # deploy dev environment
{{ package_manager }} run deploy:prod
```

## Configuration

Per-environment config lives in `lib/config/environments.ts` (`dev` / `prod`),
with differentiated `RemovalPolicy`, termination protection, Glue worker caps,
schedules, and the Athena bytes-scanned cutoff. Resource names are prefixed with
`{{ project_slug }}-<env>`; Glue catalog databases are named
`{{ catalog_prefix }}_<env>_<zone>`.

## Post-generation

1. Load real values into the secrets `{{ project_slug }}-<env>/ga4-api` and
   `{{ project_slug }}-<env>/meta-ads-api` (and `sftp-origen` if applicable).
2. Set `alertEmail` in `lib/config/environments.ts` and confirm the SNS
   subscription.
3. Enable `sftp.enabled` with `url` + `trustedHostKeys` after validating the
   origin's APIs and SFTP server (Phase 0 GO/NO-GO).
4. Complete the TODO logic in the ingestion Lambdas and Glue scripts.
5. Grant FGAC permissions (LF-Tags → analyst roles) from SageMaker Unified
   Studio or with `CfnPrincipalPermissions`.
6. QuickSight: enable the subscription and point it at the
   `{{ project_slug }}-<env>-analytics` workgroup.

## Practices applied

Typed per-environment config; no physical bucket names (avoids collisions);
CMK encryption with rotation on S3/DynamoDB/SNS/SQS/Secrets/Glue; least
privilege (grants by prefix and per resource); enforced SSL and public-access
block on all buckets; bucket keys to reduce KMS cost; DLQs and 