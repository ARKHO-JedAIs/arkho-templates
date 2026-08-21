# {{ project_name }}

ARKHO serverless backend, scaffolded from the `aws-cdk-serverless-backend`
template. AWS CDK v2 (TypeScript) infrastructure that owns the authentication,
storage, and supporting services the rest of the system talks to.

## What it provisions

`MainStack` is the single root stack. Active (instantiated) today:

| Resource | Factory | Purpose |
|---|---|---|
| DynamoDB | `DynamoFactory` | One single-table-design table (`PK`/`SK`, on-demand): `usage-stats`, which stores arkho-cli usage statistics. Installer telemetry (`INSTALL#...`) and CLI command telemetry (`USAGE#...`) are separated by PK prefix; no TTL, so all events are retained |
| S3 | `S3Factory` | The `templates` bucket (private, SSE-S3, SSL-only) that stores the project templates the CLI scaffolds from |
| Lambda layer | `LayerFactory` | `python-common` layer (logging, standardized responses, CORS helpers) |
| Lambda | `LambdaFactory` | One function per folder under `src/lambda`: hello-world, pre-signup, post-confirmation-signup, not-found, presigned-url-template, authorizer |
| Cognito | `CognitoFactory` | User Pool + app client for the CLI, with optional Microsoft Entra ID (OIDC) federation |
| Setup | `SetupFactory` | Post-creation wiring: injects `USER_POOL_ID` / `APP_CLIENT_ID` into the authorizer once the pool exists |

Authentication and storage notes:

- `pre-signup` and `post-confirmation-signup` are wired as Cognito triggers.
- **Entra ID SSO is optional**, off by default, and gated by `ENTRA_ID_ENABLED`.
  When enabled it creates an OIDC identity provider plus a Hosted UI domain. The
  domain prefix is derived in code from the resource-name convention
  (`${projectName}-${envName}`); it is **not** a manual environment variable.
- `not-found`, `presigned-url-template`, and `authorizer` are API Gateway
  oriented. No API Gateway is created yet, so they exist as standalone functions
  until an API is wired. `presigned-url-template` reads/writes the `templates`
  bucket (`S3Factory`), whose name is passed into the Lambda environment as
  `TEMPLATES_BUCKET_NAME`. The presigned-URL TTL is a constant in `LambdaFactory`.

Everything else under `lib/construct` (rest-api, glue, plus governance:
cloudtrail, guardduty, waf, budget, access-analyzer, github-oidc) stays as
generic, reusable building blocks and is wired in only when a service is
actually needed.

## Prerequisites

- [Node.js](https://nodejs.org/) 24+
- npm 11+
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
- Python 3.12 (runtime of the Lambda functions; optional for local development)
- An AWS account with permissions to create IAM roles, Lambda, DynamoDB, S3, and Cognito

## Installation

### 1. Install dependencies

```bash
npm install
npm run prepare
```

After `npm install`, running `npm run prepare` installs the Husky pre-commit
hooks (secretlint runs on staged files to block committed credentials).

### 2. Configure environment variables

```bash
cp .env.example .env
```

`.env` is gitignored and must never be committed; `.env.example` is the only
versioned copy and ships placeholders only. `PROJECT_NAME` comes pre-filled;
edit the rest:

```env
# Core app
ENV_NAME=dev
PROJECT_NAME={{ project_name }}
AWS_ACCOUNT_ID=          # 12 digits; empty = account-agnostic synth
AWS_REGION=us-east-1

# Microsoft Entra ID SSO (optional, OIDC federation)
ENTRA_ID_ENABLED=false
ENTRA_ID_CLIENT_ID=
ENTRA_ID_CLIENT_SECRET=
ENTRA_ID_ISSUER_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
```

`ENTRA_ID_CLIENT_ID`, `ENTRA_ID_CLIENT_SECRET`, and `ENTRA_ID_ISSUER_URL` are
required only when `ENTRA_ID_ENABLED=true`. The Cognito Hosted UI domain prefix
and the templates bucket name are derived in code, and the presigned-URL TTL is
a constant in `LambdaFactory` - none of them are environment variables.

To find your AWS account ID:

```bash
aws sts get-caller-identity --query Account --output text
```

### 3. Bootstrap CDK (first time only)

CDK needs to provision some resources in your account before deploying. Run this
once per account/region:

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/YOUR_REGION
```

### 4. Verify, preview, deploy

```bash
npx cdk synth --quiet   # synthesize and verify the active graph
npx cdk diff            # preview changes
npx cdk deploy          # deploy
```

After a successful deploy, the stack outputs:

- **Cognito User Pool ID** and **App Client ID** (frontend / CLI auth config)
- **`usage-stats` DynamoDB table name**
- **`templates` S3 bucket name**

## Project structure

```
/bin
  main.ts               # CDK app entry: builds MainStack from env config
/lib
  /construct            # Generic, reusable L2/L3 constructs (one per service)
  /stack
    main-stack.ts       # Root stack: wires the active factories
    /cognito            # Cognito + optional Entra ID federation + triggers
    /dynamo             # usage-stats table
    /s3                 # templates bucket
    /lambda             # one function per src/lambda folder
    /layer              # python-common layer
    /setup              # post-creation wiring (authorizer <- Cognito ids)
    /shared/util        # environment config + helpers
/src
  /lambda/core/*        # hello-world, not-found, presigned-url-template, authorizer
  /lambda/user/*        # Cognito triggers: pre-signup, post-confirmation-signup
  /layer/python-common  # shared Python layer (logger, response, cors)
/test                   # Jest (aws-cdk-lib/assertions) tests
```

## Common commands

```bash
npm install              # install dependencies
npm run prepare          # install Husky hooks after npm install
npx cdk synth --quiet    # synthesize CloudFormation (verifies the active graph)
npx tsc --noEmit         # typecheck the whole repo
npm test                 # run jest
npm run secretlint       # scan the whole repo for secrets
npx cdk diff             # show pending infrastructure changes
npm run build && npx cdk deploy
npx cdk destroy          # tear down the stack
```

## Security

- DynamoDB default encryption at rest; point-in-time recovery and deletion
  protection enabled in production.
- S3 `templates` bucket is private, SSE-S3 encrypted, and SSL-only.
- Least-privilege IAM scoped per Lambda function.
- Cognito JWT validation in the Lambda authorizer.
- No secrets in source: `.env` is gitignored and `.env.example` ships
  placeholders only. A secretlint pre-commit hook blocks committed credentials.
  The Entra ID client secret comes from the environment at synth time; move it to
  AWS Secrets Manager before production use.

## Conventions

`AGENTS.md` is the single source of truth for repository rules, conventions, and
architecture; `CLAUDE.md` is a thin bootstrap that defers to it. Read `AGENTS.md`
before contributing.

## License

MIT.
