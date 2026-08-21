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
  `chore:`, `docs:`, ...). No co-authorship or tool-attribution trailers.

## Architecture

`MainStack` is the single root stack. What is **active** (instantiated) today:

1. **DynamoDB** (`DynamoFactory`) - one single-table-design table (`PK`/`SK`,
   on-demand): `usage-stats`, which stores arkho-cli usage statistics.
   Installer telemetry and CLI command telemetry are tracked separately via PK
   prefixes (`INSTALL#...` vs `USAGE#...`). No TTL is set, so all events are
   retained. Users are centralized in Cognito.
2. **S3** (`S3Factory`) - the `templates` bucket (private, SSE-S3, SSL-only)
   that stores the project templates the CLI scaffolds from (e.g. reactjs). The
   presigned-url-template Lambda is granted read/write over the whole bucket.
3. **Layer** (`LayerFactory`) - the `python-common` layer (logging,
   standardized responses, CORS helpers) shared by the Python functions.
4. **Lambda** (`LambdaFactory`) - one function per source folder under
   `src/lambda`: hello-world, pre-signup, post-confirmation-signup, not-found,
   presigned-url-template, authorizer.
5. **Cognito** (`CognitoFactory`) - a User Pool plus an app client for the CLI,
   with **optional Microsoft Entra ID (OIDC) federation**. Federation is off by
   default and gated by env (`ENTRA_ID_ENABLED`); when enabled it provisions a
   Hosted UI domain whose prefix is derived in code as
   `${projectName}-${envName}` (not a manual env var). `pre-signup` and
   `post-confirmation-signup` are wired as triggers; the `authorizer` receives
   `USER_POOL_ID` / `APP_CLIENT_ID` after the pool exists, via `SetupFactory`
   (`lib/stack/setup`), which holds post-creation cross-factory wiring.

The Lambda set follows the source under `src/lambda`: when a function's source
folder is added or removed, adjust `LambdaFactory` to match. `not-found`,
`presigned-url-template`, and `authorizer` are API Gateway oriented; no API
Gateway is created yet, so they exist as standalone functions until an API is
wired. `presigned-url-template` writes to the project `templates` bucket
(`S3Factory`), whose name is passed directly into the Lambda environment; the
presigned-URL TTL is a constant in `LambdaFactory`.

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
    /cognito            # Active: Cognito + optional Entra ID federation + triggers
    /dynamo             # Active: usage-stats table
    /s3                 # Active: templates bucket
    /lambda             # Active: one function per src/lambda folder
    /layer              # Active: python-common layer
    /setup              # Active: post-creation wiring (authorizer <- Cognito ids)
    /shared/util        # Environment config + helpers
/src
  /lambda/core/*        # core functions: hello-world, not-found,
                        #   presigned-url-template, authorizer
  /lambda/user/*        # Cognito trigger functions: pre-signup,
                        #   post-confirmation-signup
  /layer/python-common  # shared Python layer (common: logger, response, cors)
/test                   # Jest (aws-cdk-lib/assertions) tests
```

- `lib/construct/*` are generic and parameterized; they do not depend on the
  factories. Available constructs include: cognito, dynamo, s3, lambda, layer,
  rest-api, glue, plus governance (cloudtrail, guardduty, waf, budget,
  access-analyzer, github-oidc).
- `lib/stack/<service>` factories compose constructs into project wiring. Only
  active services have a factory wired into `MainStack`.

## Tech Stack

- **Infrastructure**: AWS CDK (TypeScript), `aws-cdk-lib` v2.
- **Auth**: Cognito User Pools, optional Entra ID OIDC federation.
- **Storage**: DynamoDB (on-demand).
- **Runtime**: Python 3.12 Lambda functions.
- **Tooling**: Node.js 24+ and npm 11+ (`engine-strict=true`). `.env` is loaded
  with `dotenv` (the `@dotenvx/dotenvx` package is not used).
- **Tests**: Jest + `aws-cdk-lib/assertions`.
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
npm test                 # run jest
npm run secretlint       # scan the whole repo for secrets
npx cdk diff             # review changes before deploy
npm run build && npx cdk deploy
```

## Environment Variables

Set in `.env` (gitignored; see `.env.example`):

- `ENV_NAME`: dev/staging/prod (required).
- `PROJECT_NAME`: project prefix for resource names (required).
- `AWS_ACCOUNT_ID`, `AWS_REGION`: deployment target.
- `ENTRA_ID_ENABLED`: `true` to enable Entra ID OIDC federation (default off).
- `ENTRA_ID_CLIENT_ID`, `ENTRA_ID_CLIENT_SECRET`, `ENTRA_ID_ISSUER_URL`: required
  only when `ENTRA_ID_ENABLED=true`.

The templates bucket is provisioned by `S3Factory` and its name is passed
directly into the presigned-url-template Lambda environment as
`TEMPLATES_BUCKET_NAME` (no env var). The presigned-URL TTL is a constant in
`LambdaFactory` (`lib/stack/lambda`).

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
ships placeholders only. The Entra ID client secret comes from the environment
at synth time; move it to AWS Secrets Manager before production use.

A `secretlint` pre-commit hook (`husky` + `lint-staged`) blocks commits that
contain credentials. Do not bypass it with `git commit --no-verify`. If a real
secret is ever flagged, rotate it; do not just remove it from the diff.
