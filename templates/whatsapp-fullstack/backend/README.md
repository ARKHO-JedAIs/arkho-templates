# {{ project_name }}

ARKHO serverless backend, scaffolded from the `aws-cdk-serverless-backend`
template. AWS CDK v2 (TypeScript) infrastructure that owns the authentication,
storage, and supporting services the rest of the system talks to.

## What it provisions

`MainStack` is the single root stack. Active (instantiated) today:

| Resource | Factory | Purpose |
|---|---|---|
| Lambda layer | `LayerFactory` | `python-common` layer (logging, standardized responses, CORS helpers) |
| Lambda | `LambdaFactory` | The core functions under `src/lambda/core`: `authorizer` and `not-found` |
| Cognito | `CognitoFactory` | User Pool (self sign-up off) + app client, with optional Microsoft Entra ID (OIDC) and Google sign-in |
| API Gateway | `ApiFactory` | Regional REST API behind the Lambda authorizer, with a `{proxy+}` catch-all served by `not-found` |
| Setup | `SetupFactory` | Post-creation wiring: injects `USER_POOL_ID` / `APP_CLIENT_ID` into the authorizer once the pool exists |
| WhatsApp | `WhatsAppFactory` | The WhatsApp module (`lib/stack/whatsapp`): tables, Lambdas, SNS topic, AppSync, the private `whatsapp-media` bucket, and its `/whatsapp/*` routes |
| Users | `UsersFactory` | With `USERS_API_ENABLED=true`: the `admin-users` Lambda behind `/admin/users` and the `admin` / `member` groups |

Authentication notes:

- **Self sign-up is off.** Users are created by an administrator, from the
  frontend's Usuarios screen or with `aws cognito-idp admin-create-user`.
- **Microsoft (Entra ID) and Google sign-in are optional**, listed in
  `SSO_PROVIDERS`. Listing any creates a Hosted UI domain whose prefix is
  derived in code (`${projectName}-${envName}`); each provider is created once
  its client id and secret are set. Outputs `CognitoDomainUrl` and
  `CognitoIdpRedirectUri` (the redirect URI to register at the providers). Step
  by step: root README, "Sign in with Microsoft or Google". A federated user
  joins no group automatically: an admin assigns `admin` from Usuarios.
- The REST API is deployed to a stage named after `ENV_NAME` and every route is
  a Lambda proxy integration protected by the `authorizer` function (Cognito JWT
  validation) unless it opts out with `requireAuth: false`. The WhatsApp and
  Users modules register their own routes; those are what attach the authorizer.
- `admin-users` logs one JSON audit line per successful change (acting admin,
  action, target user, roles; never a password). CloudTrail also records the
  Cognito `Admin*` calls.

Everything else under `lib/construct` (glue, plus governance: cloudtrail,
guardduty, waf, budget, access-analyzer, github-oidc) stays as generic, reusable
building blocks and is wired in only when a service is actually needed.

## Prerequisites

- [Node.js](https://nodejs.org/) 24+
- npm 11+
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
- Python 3.12 (runtime of the Lambda functions; optional for local development)
- An AWS account with permissions to create IAM roles, Lambda, API Gateway,
  DynamoDB, S3, and Cognito

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

# Sign in with Microsoft and/or Google (comma-separated; empty = none)
SSO_PROVIDERS=
ENTRA_ID_CLIENT_ID=
ENTRA_ID_CLIENT_SECRET=
ENTRA_ID_ISSUER_URL=     # https://login.microsoftonline.com/<tenant-id>/v2.0
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_CALLBACK_URLS=http://localhost:5173/auth/callback
AUTH_LOGOUT_URLS=http://localhost:5173/login
```

`SSO_PROVIDERS` accepts `microsoft` and `google`. A listed provider with all of
its values empty is skipped with a warning (so the first deploy can create the
Hosted UI domain); with only some of them set, synth fails naming the missing
ones. `AUTH_CALLBACK_URLS` / `AUTH_LOGOUT_URLS` are the frontend URLs Cognito
may return to (comma-separated). The Hosted UI domain prefix is derived in code
and is not an environment variable.

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

- **Cognito User Pool ID** and **App Client ID** (frontend auth config)
- **`CognitoDomainUrl`** and **`CognitoIdpRedirectUri`** when `SSO_PROVIDERS`
  lists a provider
- **REST API id, URL, and ARN**, plus the WhatsApp outputs

Smoke-test the API: every route needs a Cognito token, so an unauthenticated
call must be refused (401/403) - that alone proves the API and the authorizer
are up:

```bash
curl -i "$(aws cloudformation describe-stacks \
  --stack-name <StackName> \
  --query "Stacks[0].Outputs[?ends_with(OutputKey,'RestApiUrl')].OutputValue" \
  --output text)whatsapp/conversations"
```

With a signed-in user's ID token, add `-H "Authorization: Bearer <id-token>"`
and expect `200`.

## Project structure

```
/bin
  main.ts               # CDK app entry: builds MainStack from env config
/lib
  /construct            # Generic, reusable L2/L3 constructs (one per service)
  /stack
    main-stack.ts       # Root stack: wires the active factories
    /cognito            # Cognito + optional Entra ID / Google sign-in
    /lambda             # core functions: authorizer, not-found
    /layer              # python-common layer
    /api                # REST API: authorizer, 404 fallback
    /setup              # post-creation wiring (authorizer <- Cognito ids)
    /whatsapp           # WhatsApp module (owns its Lambdas and routes)
    /users              # Usuarios API (owns its Lambda and routes)
    /shared/util        # environment config + helpers
/src
  /lambda/core/*        # authorizer, not-found
  /lambda/whatsapp/*    # WhatsApp functions
  /lambda/users/*       # admin-users
  /layer/python-common  # shared Python layer (logger, response, cors, whatsapp)
/test                   # Vitest (aws-cdk-lib/assertions) tests
```

## Common commands

```bash
npm install              # install dependencies
npm run prepare          # install Husky hooks after npm install
npx cdk synth --quiet    # synthesize CloudFormation (verifies the active graph)
npx tsc --noEmit         # typecheck the whole repo
npm test                 # run the Vitest CDK tests
npm run test:python      # run the Lambdas' own Python test suite (test/python)
npm run verify           # everything above that CI runs before a deploy
npm run secretlint       # scan the whole repo for secrets
npx cdk diff             # show pending infrastructure changes
npm run build && npx cdk deploy
npx cdk destroy          # tear down the stack
```

`npm run test:python` needs Python 3 with `test/python/requirements.txt`
installed (`pip install -r test/python/requirements.txt`).

## Continuous integration

`bitbucket-pipelines.yml` runs `npm run verify` on every pull request, and
deploys `develop`/`staging`/`main` to the `dev`/`staging`/`prod` Bitbucket
Deployments, with production gated behind a manual approval. See
[`docs/ci.md`](docs/ci.md) for what each step does and what to set up in
Bitbucket before it can deploy anything.

Whenever `.env` changes, run `node scripts/push-deploy-config.mjs` to push
the WhatsApp/agent/SSO config the pipeline deploys with into Secrets Manager -
otherwise the next deploy still uses the old values.

## Security

- DynamoDB default encryption at rest; point-in-time recovery and deletion
  protection enabled in production.
- Least-privilege IAM scoped per Lambda function.
- Cognito JWT validation in the Lambda authorizer; every REST API route is
  protected by it unless it explicitly opts out with `requireAuth: false`.
- Cognito self sign-up is off: only an administrator creates users.
- User-management changes are audited: one JSON log line per change from
  `admin-users`, and CloudTrail records the Cognito `Admin*` calls.
- No secrets in source: `.env` is gitignored and `.env.example` ships
  placeholders only. A secretlint pre-commit hook blocks committed credentials.
  The Entra ID and Google client secrets come from the environment at synth
  time; move them to AWS Secrets Manager before production use.

## Conventions

`AGENTS.md` is the single source of truth for repository rules, conventions, and
architecture; `CLAUDE.md` is a thin bootstrap that defers to it. Read `AGENTS.md`
before contributing.

## License

MIT.
