# {{ project_name }}

Serverless backend on AWS CDK v2 (TypeScript): a Cognito User Pool (optional
Microsoft Entra ID federation), a single-table DynamoDB table, a private S3
bucket, Python 3.12 Lambda functions on a shared layer, and an API Gateway REST
API behind a Lambda JWT authorizer, all in one CloudFormation stack.

Generated from the ARKHO `aws-cdk-serverless-backend` template (see `arkho.json`
for the exact version and answers).

## Prerequisites

| Tool | Version | Source |
|---|---|---|
| Node.js | 24+ | `.nvmrc` (`24`), `package.json` `engines.node` |
| npm | 11+ | `package.json` `engines.npm`; `.npmrc` sets `engine-strict=true`, so older versions fail `npm install` |
| AWS CDK CLI | bundled (`aws-cdk` devDependency) | run it with `npx cdk`, no global install needed |
| AWS CLI | v2 | credentials for the target account (profile, SSO or env vars) |
| Git | any | the pre-commit hook needs a Git repository |
| Python | 3.12 (optional) | only to run the Lambda code locally; CDK packages it as-is |

The deploying identity needs permissions to bootstrap CDK and to create IAM
roles, Lambda, API Gateway, DynamoDB, S3, Cognito and CloudWatch Logs resources.

## Getting started

```bash
cd {{ project_name }}
git init                 # husky needs .git, otherwise the hook is not installed
npm install              # also runs "prepare" (husky) to install the pre-commit hook
cp .env.example .env     # then set AWS_ACCOUNT_ID and AWS_REGION
npx cdk synth --quiet    # synthesize the stack
npm test                 # jest assertions over the synthesized template
```

If you ran `npm install` before `git init`, run `npm run prepare` once afterwards.

## Configuration

`bin/main.ts` loads `.env` with `dotenv` (`lib/stack/shared/util/env-config.ts`).
`.env` is gitignored; `.env.example` is the only versioned copy and holds
placeholders only.

| Variable | Default in `.env.example` | Purpose |
|---|---|---|
| `ENV_NAME` | `dev` | **Required.** Environment name: part of every resource name and the API stage name. `prod` switches on production behavior (see below) |
| `PROJECT_NAME` | `{{ project_name }}` | **Required.** Prefix of every resource name. Pre-filled from the CLI parameter `project_name` |
| `AWS_ACCOUNT_ID` | empty | Target account (12 digits). Empty = environment-agnostic synth |
| `AWS_REGION` | `us-east-1` | Target region |
| `ENTRA_ID_ENABLED` | `false` | `true` enables Microsoft Entra ID OIDC federation in Cognito |
| `ENTRA_ID_CLIENT_ID` | empty | Entra ID app registration client ID (required when enabled) |
| `ENTRA_ID_CLIENT_SECRET` | empty | Entra ID client secret (required when enabled) |
| `ENTRA_ID_ISSUER_URL` | `https://login.microsoftonline.com/<tenant-id>/v2.0` | OIDC issuer of your tenant (required when enabled) |

Synth exits with an error if `ENV_NAME` or `PROJECT_NAME` is missing, or if
`ENTRA_ID_ENABLED=true` without the three `ENTRA_ID_*` values. `project_name` is
the template's only CLI parameter; everything else is set by hand.

Not environment variables: the Cognito Hosted UI domain prefix (derived as
`<PROJECT_NAME>-<ENV_NAME>`), the bucket name, and the presigned-URL TTL
(`PRESIGNED_URL_EXPIRY_SECONDS = 3600` in `lib/stack/lambda/index.ts`).

## What's included

`MainStack` (`lib/stack/main-stack.ts`) wires these factories. Every physical
name follows `<PROJECT_NAME>-<ENV_NAME>-<resource>`; the stack is tagged
`Project` and `Environment`.

| Factory (`lib/stack/*`) | Resources |
|---|---|
| `DynamoFactory` | Table `<prefix>-usage-stats`: `PK`/`SK` strings, on-demand billing, no TTL |
| `S3Factory` | Bucket `<prefix>-templates`: private (block all public access), SSE-S3, SSL-only |
| `LayerFactory` | Layer `python-common` from `src/layer/python-common` (logger, standardized responses, CORS decorator), Python 3.12, x86_64 and arm64 |
| `LambdaFactory` | Six Python 3.12 functions, one per `src/lambda` folder, logs kept one month (see below) |
| `CognitoFactory` | User Pool `<prefix>-user-pool` and app client `<prefix>-cli-client`, resource server `<prefix>-api` with `read`/`write` scopes |
| `ApiFactory` | Regional REST API `<prefix>-api`, stage = `ENV_NAME`, TOKEN Lambda authorizer `<prefix>-lambda-authorizer` |
| `SetupFactory` | Injects `USER_POOL_ID` and `APP_CLIENT_ID` into the authorizer after the pool exists |

**Lambda functions** (`src/lambda`)

| Function | Role |
|---|---|
| `core/hello-world` | Public `GET /hello-world`, static payload. Reference example: delete it once real routes exist |
| `core/presigned-url-template` | `GET /presigned-url` (authorized): returns a presigned PUT URL for `templates/<user-id>/<timestamp>.zip` in the bucket, valid 3600 s. Has read/write on the whole bucket |
| `core/not-found` | `ANY /{proxy+}` catch-all, standardized 404 body |
| `core/authorizer` | Validates Cognito access or ID tokens (JWKS signature, issuer, app client) from `Authorization: Bearer <token>`; results cached 5 min. Uses public Klayers layers `Klayers-p312-PyJWT:4` and `Klayers-p312-cryptography:25` resolved in the deploy region |
| `user/pre-signup` | Cognito pre-sign-up trigger (placeholder for custom validation; does not auto-confirm) |
| `user/post-confirmation-signup` | Cognito post-confirmation trigger (logs the confirmed user) |

**API behavior** (`lib/construct/rest-api-construct.ts`): every route is a Lambda
proxy integration protected by the authorizer unless it sets
`requireAuth: false`; CORS preflight (`OPTIONS`) and the `{proxy+}` catch-all are
unauthenticated. CORS allows all origins by default. Stage throttling is 100
burst / 50 rps, with JSON access logs in
`/aws/apigateway/<prefix>-access-logs`. Add new routes in `ApiFactory`
(`lib/stack/api/index.ts`).

**Cognito**: self sign-up with email as the sign-in alias and email
verification, password minimum 8 chars with upper, lower and digits, email-only
account recovery, no client secret, SRP and user-password auth, authorization
code grant. Callback/logout URLs are `http://localhost:8976` and
`http://localhost:3000` (`/callback`, `/logout`) outside `prod`, and the
placeholder `https://example.com/...` in `prod`: set real URLs in
`lib/stack/cognito/index.ts` before a production deploy.

**Optional: Entra ID SSO** (`ENTRA_ID_ENABLED=true`): adds an OIDC identity
provider and a Cognito Hosted UI domain `<PROJECT_NAME>-<ENV_NAME>`.

**Production behavior** (`ENV_NAME=prod`): DynamoDB point-in-time recovery and
deletion protection on; table, bucket, user pool, layer and API log group are
retained on stack deletion, as are the Lambda log groups. Outside `prod` they are destroyed (the bucket is
emptied automatically) and API Gateway X-Ray tracing and data trace logging are
on.

**Not wired (reusable constructs)**: `lib/construct` also contains `glue`,
`cloudtrail`, `guardduty`, `waf`, `budget`, `access-analyzer` and `github-oidc`
constructs. They create nothing until you instantiate them from a factory.

**Stack outputs** (export names): `<prefix>-UsageStatsTableName`,
`<prefix>-TemplateBucketName`, `<prefix>-python-common-LayerArn`,
`<prefix>-python-common-LayerVersionArn`, `<prefix>-UserPoolId`,
`<prefix>-UserPoolClientId`, `<prefix>-UserPoolArn`, `<prefix>-RestApiId`,
`<prefix>-RestApiUrl`, `<prefix>-RestApiArn`.

**Security tooling**: `secretlint` (recommended preset, `.secretlintrc.json`)
runs on staged files through `husky` + `lint-staged` on every commit.

## Project structure

```
{{ project_name }}/
├── bin/main.ts                  # CDK app entry: reads .env, creates MainStack
├── lib/
│   ├── construct/               # generic, reusable constructs (one per service)
│   └── stack/
│       ├── main-stack.ts        # root stack wiring the factories
│       ├── api/  cognito/  dynamo/  lambda/  layer/  s3/  setup/
│       └── shared/util/         # env-config.ts, runtime.ts, capitalize.ts
├── src/
│   ├── lambda/core/             # authorizer, hello-world, not-found, presigned-url-template
│   ├── lambda/user/             # pre-signup, post-confirmation-signup
│   └── layer/python-common/     # python/common: logger, response, cors_middleware
├── test/
│   ├── helpers/setup.ts         # getTemplate(), TEST_PARAMS, TEST_ENV
│   └── main-stack.test.ts       # MainStack assertions
├── .env.example  .nvmrc  .npmrc  .secretlintrc.json  .husky/pre-commit
├── cdk.json  jest.config.js  tsconfig.json  package.json
├── AGENTS.md  CLAUDE.md         # agent instructions (AGENTS.md is the source of truth)
└── arkho.json                   # generation provenance (written by the CLI)
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | `tsc`: compile TypeScript into `build/` (not needed for CDK, which runs `bin/main.ts` with `ts-node`) |
| `npm run watch` | `tsc -w` |
| `npm test` | `jest` over `test/**/*.test.ts` |
| `npm run cdk -- <args>` | Run the project's CDK CLI (same as `npx cdk <args>`) |
| `npm run secretlint` | Scan the whole repo for secrets |
| `npm run prepare` | `husky`: install the Git hooks (runs automatically on `npm install`) |

## Deploy

```bash
# once per account/region
npx cdk bootstrap aws://<AWS_ACCOUNT_ID>/<AWS_REGION>

npx cdk diff      # review changes
npx cdk deploy    # deploy the single stack
```

The stack is named `<ProjectName><EnvName>Stack` with the first letter of each
part capitalized (`bin/main.ts`), e.g. `Acme-backendDevStack` for
`PROJECT_NAME=acme-backend` and `ENV_NAME=dev`. Use another `ENV_NAME` in `.env`
to deploy a separate environment.

Smoke test the public route (replace `dev` if you changed `ENV_NAME`):

```bash
API_URL=$(aws cloudformation list-exports \
  --query "Exports[?Name=='{{ project_name }}-dev-RestApiUrl'].Value" --output text)
curl "${API_URL}hello-world"
```

`GET /presigned-url` needs `Authorization: Bearer <Cognito access or ID token>`.

Region note: the authorizer's Klayers layer versions are region-local and
Klayers does not publish to `ap-northeast-3`; re-check the pins in
`lib/stack/lambda/index.ts` before deploying to a new region.

Tear down with `npx cdk destroy` (in `prod` the retained resources stay).

## Testing & quality

```bash
npm test                # jest + aws-cdk-lib/assertions (fixed test env, independent of .env)
npx tsc --noEmit        # typecheck everything, including constructs not in the synth graph
npx cdk synth --quiet   # synthesize the active graph
npm run secretlint      # secret scan
```

There is no linter or formatter configured. `AGENTS.md` asks to run the first
three commands before finishing any change.

## Regenerating / upgrading

`arkho.json` records the template name, version, Git tag and commit plus your
answers (`project_name`). The template version is pinned there; to compare with
a newer template release, generate a fresh project with the same answers and the
desired `--template-version`, then port the differences.
