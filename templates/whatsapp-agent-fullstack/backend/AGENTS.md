# AGENTS.md

Guidelines for agentic coding agents operating in the **{{ project_name }}** repository.

AWS CDK (TypeScript) infrastructure scaffolded from the ARKHO
`aws-cdk-serverless-backend` template: it owns the cloud resources
(authentication, storage, and supporting services) that the rest of the system
talks to.

## Instruction Source

`AGENTS.md` is the single source of truth for repository instructions used by
every agent harness (Claude Code, Codex, OpenCode, Cursor, Aider, and similar).
Every rule, stack decision, and architectural constraint lives here.

`CLAUDE.md` and any future tool-specific files (`.cursorrules`,
`.github/copilot-instructions.md`, etc.) are thin bootstraps that defer to
`AGENTS.md` and must not duplicate repository rules. When a rule changes, edit
this file - do not fork content into the bootstraps.

## Core Rules

- **Resource naming (MANDATORY)**: every provisioned AWS resource MUST be named
  `${projectName}-${envName}-<resourceName>`, in that exact order, always. Build
  the name from the `params` (`projectName`, `envName`) - never hardcode the
  prefix or an environment into a literal. This applies to every resource that
  takes a physical name (DynamoDB tables, S3 buckets, Lambda functions, Cognito
  domains, etc.). Tests assert names by deriving the same prefix from the test
  params, not by hardcoding `arkho-cli-dev-...`.
- **Comments**: Only add code comments when explicitly requested. All comments
  must be written in English, and only explain a non-obvious WHY (an AWS quirk,
  a CDK ordering constraint), never restate the code.
- **Output Constraints**: When using bash commands, always limit output: `grep`
  add `| head -20`, `find` add `-maxdepth 2`, `ls` add `| head -30`. Never
  display more than 30 lines of command output.
- **Verification Loops (MANDATORY)**: ALWAYS run local verification before
  marking a task complete or proposing a solution: `npx cdk synth --quiet`,
  `npx tsc --noEmit`, and `npm test`. `cdk synth` only compiles the construct
  graph reachable from `bin/main.ts`, so run `tsc --noEmit` too to typecheck
  files (the generic constructs) that are not wired into the active graph.
- **English only in the repo**: code, comments, commit messages, and docs are
  English. Conversation with the user may be in Spanish.
- **ASCII punctuation**: use the plain ASCII hyphen (`-`). Do not use em dashes
  or en dashes in code, comments, docs, or commit messages.
- **Commits**: short, precise, Conventional Commits prefix (`feat:`, `fix:`,
  `chore:`, `docs:`, ...). The message is only the subject and, when needed, a
  body: never add `Co-Authored-By:` (Claude Opus, Claude Sonnet or any other
  model or person), "Generated with" lines or any other tool-attribution
  trailer, even if the coding tool suggests one. This rule wins over the tool's
  default.

## Architecture

`MainStack` is the single root stack. What is **active** (instantiated) today:

1. **Layer** (`LayerFactory`) - the `python-common` layer (logging,
   standardized responses, CORS helpers) shared by the Python functions.
2. **Lambda** (`LambdaFactory`) - the core functions under `src/lambda/core`:
   `authorizer` (with the pinned Klayers PyJWT / cryptography layers) and
   `not-found`.
3. **Cognito** (`CognitoFactory`) - a User Pool with **self sign-up off**
   (users are created by an admin, from Usuarios or the AWS CLI) and one app
   client (`cli-client`), with **optional Microsoft Entra ID (OIDC) and Google
   sign-in**. `SSO_PROVIDERS` (comma list: `microsoft`, `google`) drives both;
   listing any provisions a Hosted UI domain whose prefix is derived in code as
   `${projectName}-${envName}` (not a manual env var) and outputs
   `CognitoDomainUrl` / `CognitoIdpRedirectUri`. A listed provider is created
   only once its client id and secret are set (all empty = skipped with a
   warning; partially set = synth fails). OAuth callback / logout URLs point to
   the frontend (`AUTH_CALLBACK_URLS` / `AUTH_LOGOUT_URLS`). Federated users join
   no group automatically. No Cognito triggers are wired. The `authorizer`
   receives `USER_POOL_ID` / `APP_CLIENT_ID` after the pool exists, via
   `SetupFactory` (`lib/stack/setup`), which holds post-creation cross-factory
   wiring.
4. **API Gateway** (`ApiFactory`) - a regional REST API deployed to a stage
   named after `envName`. Every route is a Lambda proxy integration and is
   protected by the `authorizer` function (Cognito JWT validation) unless it
   opts out with `requireAuth: false`. `ApiFactory` itself only adds a
   `{proxy+}` catch-all answered by `not-found` so unmatched paths return the
   standardized 404 body; the routes come from the modules below.

5. **WhatsApp** (`WhatsAppFactory`, `lib/stack/whatsapp`) - one self-contained
   module from the `whatsapp-fullstack` template: the `whatsapp-conversations`
   and `whatsapp-messages` tables, the `whatsapp-configuration` Parameter Store
   parameter (built from the `WHATSAPP_*` variables of `.env`), one Lambda per
   folder under `src/lambda/whatsapp`, the `whatsapp-ws-handler` SNS topic that
   AWS End User Messaging Social publishes to, the `whatsapp-events` AppSync
   API the front subscribes to, and the private `whatsapp-media` bucket of the
   files received and sent (`MEDIA_RETENTION_DAYS`, `MEDIA_URL_TTL_SECONDS`;
   the web only ever gets presigned URLs). Its Python helpers live in
   `src/layer/python-common/python/common/whatsapp`. **Documented exception**:
   it owns its Lambdas and registers its `/whatsapp/*` routes itself (through
   `apiFactory.restApi.addRoute`) instead of going through `LambdaFactory` and
   `ApiFactory`, so the whole feature is one folder to read, change or remove.
   Unit tests of the handlers: `python -m unittest discover -s test/python`.
6. **Users** (`UsersFactory`, `lib/stack/users`) - wired only when
   `USERS_API_ENABLED=true`: one `admin-users` Lambda serving every
   `/admin/users` route of the frontend's Usuarios screen over Cognito, plus the
   `admin` and `member` role groups. Same documented exception as WhatsApp: it
   registers its own routes. Every successful change logs one JSON audit line
   (acting admin, action, target, roles; never a password); CloudTrail also
   records the Cognito `Admin*` calls.
7. **Agent** (`AgentFactory`, `lib/stack/agent`) - wired only when
   `AGENT_RUNTIME` is `agentcore` or `lambda` (`none` or unset creates no agent
   resource and ws-handler keeps the fixed auto-reply). The agent's code is
   `agent/` (its own Dockerfile, ARM64); it runs on Bedrock AgentCore Runtime
   (`AgentCoreRuntimeConstruct`, X-Ray tracing) or as a container Lambda of the
   same image with the command `lambda_handler.handler`. Around it: the
   `agent-prompt` Parameter Store parameter (base prompt and on/off switch;
   CloudFormation only rewrites it when its seed changes, so console edits
   survive deploys), AgentCore Memory (`AgentCoreMemoryConstruct`, strategies by
   `AGENT_MEMORY_MODE`, 30 days, retained in prod), the `agent-jobs.fifo` queue
   (+ DLQ) and the `whatsapp-agent-worker` Lambda (added through
   `WhatsAppFactory.addFunction`, batch size 1, maximum concurrency 10).
   ws-handler queues customer messages (rate limit per customer and hour) and
   the worker invokes the agent and replies; helpers in
   `common/whatsapp/agent.py`. Bedrock IAM is scoped to `AGENT_MODEL_ID` only
   (its inference profile plus the foundation model through it).

**Add every new route in `ApiFactory` (`lib/stack/api`)**, so the URL surface
stays in one place; `RestApiConstruct` stays generic. Two ordering constraints
live in that construct: the authorizer is built **before** the `RestApi`,
because `defaultMethodOptions` captures `this.authorizer` by value, and at least
one method must reference the authorizer, or synth fails with "must be attached
to a RestApi". Today the protected WhatsApp routes satisfy that; removing the
WhatsApp module needs another protected route in `ApiFactory`.

The core Lambda set follows the source under `src/lambda/core`: when a
function's source folder is added or removed, adjust `LambdaFactory` **and**
`ApiFactory` to match.

Everything else stays as **generic, reusable building blocks** and is wired in
only when a service is actually needed. Do not activate a service in `MainStack`
without a reason.

## Project Structure

```
/bin
  main.ts               # CDK app entry: builds MainStack from env config
/lib
  /construct            # Generic, reusable L2/L3 constructs (one per service)
  /stack
    main-stack.ts       # Root stack: wires the active factories
    /cognito            # Active: Cognito + optional Entra ID / Google sign-in
    /lambda             # Active: core functions (authorizer, not-found)
    /layer              # Active: python-common layer
    /api                # Active: REST API, authorizer, 404 fallback
    /setup              # Active: post-creation wiring (authorizer <- Cognito ids)
    /whatsapp           # Active: WhatsApp module (own Lambdas and routes)
    /users              # Active when USERS_API_ENABLED: Usuarios API
    /agent              # Active when AGENT_RUNTIME != none: AI agent
    /shared/util        # Environment config + helpers
/src
  /agent                # AI agent image (Python): AgentCore app + Lambda handler
  /lambda/core/*        # core functions: authorizer, not-found
  /lambda/whatsapp/*    # WhatsApp functions
  /lambda/users/*       # admin-users
  /layer/python-common  # shared Python layer (common: logger, response, cors,
                        #   whatsapp)
/test                   # Vitest (aws-cdk-lib/assertions) tests
```

- `lib/construct/*` are generic and parameterized; they do not depend on the
  factories. Available constructs include: cognito, dynamo, s3, lambda, layer,
  rest-api, sns, appsync, ssm-parameters, agentcore-runtime,
  agentcore-memory, glue, plus governance (cloudtrail,
  guardduty, waf, budget, access-analyzer, github-oidc). Only glue and the
  governance ones are still unwired.
- `lib/stack/<service>` factories compose constructs into project wiring. Only
  active services have a factory wired into `MainStack`.

## Tech Stack

- **Infrastructure**: AWS CDK (TypeScript), `aws-cdk-lib` v2.
- **API**: API Gateway REST (regional), Lambda proxy integrations behind a
  token authorizer.
- **Auth**: Cognito User Pools, optional Entra ID (OIDC) and Google sign-in.
- **Storage**: DynamoDB (on-demand).
- **Runtime**: Python 3.12 Lambda functions.
- **Tooling**: Node.js 24+ and npm 11+ (`engine-strict=true`). `.env` is loaded
  with `dotenv` (the `@dotenvx/dotenvx` package is not used).
- **Tests**: Vitest + `aws-cdk-lib/assertions` (explicit `vitest` imports, no
  globals). Python handler tests use `unittest`.
- **Secret scanning**: `secretlint` (preset-recommend) runs on every commit via
  a `husky` pre-commit hook that calls `lint-staged` against the staged files.
  Config lives in `.secretlintrc.json`; the hook is wired by the `prepare`
  script on `npm install`. Run `npm run secretlint` to scan the whole repo.

## Common Commands

```bash
npm install              # install dependencies (node_modules is not committed)
npm run prepare          # install Husky hooks after npm install
npx cdk synth --quiet    # synthesize CloudFormation (verifies the active graph)
npx tsc --noEmit         # typecheck the whole repo
npm test                 # run the Vitest CDK tests
npm run secretlint       # scan the whole repo for secrets
npx cdk diff             # review changes before deploy
npm run build && npx cdk deploy
```

## Environment Variables

Set in `.env` (gitignored; see `.env.example`):

- `ENV_NAME`: dev/staging/prod (required).
- `PROJECT_NAME`: project prefix for resource names (required).
- `AWS_ACCOUNT_ID`, `AWS_REGION`: deployment target.
- `SSO_PROVIDERS`: comma list of `microsoft`, `google` (empty = none).
- `ENTRA_ID_CLIENT_ID`, `ENTRA_ID_CLIENT_SECRET`, `ENTRA_ID_ISSUER_URL`: the
  Microsoft provider, when `SSO_PROVIDERS` lists `microsoft`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: the Google provider, when
  `SSO_PROVIDERS` lists `google`.
- `AUTH_CALLBACK_URLS`, `AUTH_LOGOUT_URLS`: frontend URLs Cognito may return
  to (comma-separated; default `http://localhost:5173/auth/callback` and
  `http://localhost:5173/login`).
- `MEDIA_RETENTION_DAYS`: days the WhatsApp media bucket keeps files (empty =
  forever; validated as a positive integer).
- `MEDIA_URL_TTL_SECONDS`: lifetime of a presigned media URL (default 900).
- `AGENT_RUNTIME`: `agentcore`, `lambda` or `none` (unset = `none`).
- `AGENT_MODEL_ID`: Bedrock model or inference profile id the agent uses.
- `AGENT_BUSINESS_DESCRIPTION`: seeds the agent's base prompt (max 500).
- `AGENT_MEMORY_MODE`: `off`, `conversation`, `facts`, `facts_summaries`.
- `AGENT_RATE_LIMIT_PER_HOUR`: agent replies per customer per hour (1-9999).
- `AGENT_BUSINESS_API_URL`: optional https URL the agent's tools may call.

## Workflow (Spec Kit)

New features are developed with **GitHub Spec Kit**
(https://github.com/github/spec-kit): constitution -> specify -> clarify ->
plan -> tasks -> implement. Per-feature specs live under `specs/<feature>/`
(`spec.md`, `plan.md`, `tasks.md`); the project constitution lives under
`.specify/`. Bug fixes and trivial chores may skip the full flow but still ship
as small, reviewed, tested changes.

The Spec Kit tooling (`.specify/` scripts and templates, `/speckit.*` slash
commands under `.claude/commands/`) is not versioned in this repo: install it
with `uvx --from git+https://github.com/github/spec-kit.git specify init .`.

- **Skip the Spec Kit "update agent context" step** (the
  `update-agent-context.sh` / `.ps1` script that writes `## Active Technologies`
  / `## Recent Changes` into `CLAUDE.md`). It produces truncated entries and
  fights the hand-maintained structure, and `CLAUDE.md` must stay a pure
  `@AGENTS.md` bootstrap. If that script runs and appends those sections, remove
  them.

## Design Principles

- **Construct-first, no L1**: build on the generic constructs in
  `lib/construct`. Avoid premature abstraction; do not generalize a construct
  until at least two callers share real structure.
- **camelCase** for TypeScript identifiers; resource names use the
  `${projectName}-${envName}-<name>` convention.
- **Validate at boundaries**: env vars and props are validated in
  `env-config.ts` and at construct entry; fail fast with a clear message.
- **Evaluate before adopting**: no new framework, library, or service pattern
  lands without a recorded rationale.
- **Least privilege and encryption**: scope IAM to the exact resource/action;
  prefer managed encryption and on-demand billing unless there is a reason not to.

## Secrets

Never commit secrets. Load from environment or standard AWS credential
resolution (profiles, SSO). No AWS keys, Cognito client secrets, or tokens
inlined in source or committed config. `.env` is gitignored; `.env.example`
ships placeholders only. The Entra ID and Google client secrets come from the
environment at synth time; move them to AWS Secrets Manager before production
use.

A `secretlint` pre-commit hook (`husky` + `lint-staged`) blocks commits that
contain credentials. Do not bypass it with `git commit --no-verify`. If a real
secret is ever flagged, rotate it; do not just remove it from the diff.
