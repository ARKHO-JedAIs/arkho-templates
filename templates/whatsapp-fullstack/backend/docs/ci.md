# CI

Verification is exposed as npm scripts, so it is independent of the CI provider:

```bash
npm ci
npm run verify      # tsc --noEmit + vitest + test/python's unittest suite + cdk synth --quiet
npm run secretlint  # scan the repo for committed secrets
```

Any CI provider satisfies the repository's verification rules by running those
three commands. When the rules change, `package.json` changes and every
pipeline follows without edits.

## Requirements

- Node.js 24+ and npm 11+ (see `engines` in `package.json`).
- Python 3 with `test/python/requirements.txt` installed, for `npm run
  test:python`.
- `ENV_NAME` and `PROJECT_NAME` must be set. They are the only variables
  `cdk synth` requires unconditionally: an absent `.env` is fine.
  `ENTRA_ID_ISSUER_URL` and `SES_FROM_EMAIL` are only required when
  `SSO_PROVIDERS` lists `microsoft` or `EMAIL_MFA_ENABLED` is `true`,
  respectively.
- **No AWS credentials.** `verify` only synthesizes; it never contacts AWS. Do
  not grant a deploy role to the verification pipeline.
- Run from the repository root. Lambda and layer asset paths resolve relative
  to the working directory, so `cdk synth` fails from anywhere else.
- With the AI agent (`AGENT_RUNTIME` agentcore or lambda), Docker: `cdk synth`
  builds the agent's `linux/arm64` image.

## Bitbucket Pipelines

`bitbucket-pipelines.yml` is the pipeline this repository ships with. It
defines two things:

- **Pull requests** run the `Verify` step: installs the Python test
  dependencies, then `npm ci`, `npm run verify`, and `npm run secretlint` with
  placeholder `ENV_NAME` and `PROJECT_NAME`, exported by the step's own
  `script`. No AWS credentials are needed. Bitbucket has no per-step variable
  map: at step level `environment` is the name of a deployment (a string), so
  a `key: value` block there fails validation.
- **Branches** map to environments and deploy: `develop` -> `dev`, `staging`
  -> `staging`, `main` -> `prod`. Each deploy step runs under the matching
  Bitbucket Deployment, which supplies only `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` - just enough to reach AWS. Once
  there, `scripts/with-deploy-config.mjs` fetches the rest (WhatsApp,
  Cognito/SSO, the agent - everything else `.env.example` lists) from a
  Secrets Manager secret and runs `cdk diff` / `cdk deploy` with it merged
  into the environment - see "Deploy-time config" below.
  The Deployments are named `dev`, `staging`, and `prod`, matching `ENV_NAME`.
  The `staging` block stays inert until a `staging` branch and Deployment
  exist.

With the AI agent, the `cdk synth` the Verify/Diff/Deploy steps run builds the
agent's `DockerImageAsset` (`lib/stack/agent/index.ts`), pinned to
`linux/arm64` - the only architecture Bedrock AgentCore Runtime accepts.
Bitbucket's own ARM64 cloud runners (`runtime.cloud.arch: arm`) build it
natively; they need a Standard or Premium Bitbucket plan.

The deploy step resolves `AWS_ACCOUNT_ID` from `sts get-caller-identity`,
bootstraps the environment if `CDKToolkit` is missing, runs `npm run verify`,
prints `cdk diff`, and then deploys.

`PROJECT_NAME` is fixed in `x-resolve-branch-env` (`{{ project_name }}`), not
left as a Bitbucket variable: it never changes across environments, and a
Bitbucket Deployment or Repository variable named `PROJECT_NAME` with any
other value (the repository's own name is an easy mix-up) silently deploys a
second, empty stack instead of updating this one. The stack name is derived
from it as `<ProjectName><EnvName>Stack`. Do not add a `PROJECT_NAME`
variable in Bitbucket.

### Deploy-time config: why Secrets Manager and not more Bitbucket variables

`AGENT_RUNTIME`, `USERS_API_ENABLED`, `SSO_PROVIDERS`, the WhatsApp ids and
most of `.env.example` are read only at `cdk synth` time, to decide whether to
declare the agent, the Users API, and the Cognito Hosted UI domain at all
(`lib/stack/shared/util/env-config.ts`: an unset `AGENT_RUNTIME` means no
agent). A deploy that does not pass them is not inert: it tells
CloudFormation those resources are no longer wanted. A Deployment with only
the AWS credentials set deploys "successfully" and deletes the agent, the
Users API and the SSO domain in one shot, because from `cdk synth`'s point of
view they were turned off.

Keeping ~25 more variables in sync by hand in the Bitbucket UI invites that
drift the moment anyone changes `.env` locally and forgets Bitbucket.
Instead, `scripts/with-deploy-config.mjs` fetches them as one JSON blob from a
Secrets Manager secret named `${PROJECT_NAME}-${ENV_NAME}-deploy-config`
(e.g. `{{ project_name }}-dev-deploy-config`) and merges it into the
environment of the command it wraps - `cdk diff`, `cdk deploy` - so `cdk
synth` sees exactly what a local deploy would. There is one secret per
environment, keyed the same way the stack itself is.

It wraps only `cdk diff`/`cdk deploy`, never `npm run verify`: that also runs
the Python test suite, which has to stay hermetic. With the real
`WHATSAPP_ADMIN_GROUP` merged into the test process, `is_allowed()` rejects
every test's unprivileged fake caller with 403 - a pipeline-only failure
invisible locally, since nothing loads `.env` for a plain `python -m unittest`
run.

**Keeping it in sync**: whenever `.env` changes, run
`node scripts/push-deploy-config.mjs` (or
`AWS_PROFILE=<profile> node scripts/push-deploy-config.mjs` for a non-default
profile) from the repository root. It reads `.env`, writes every key the
pipeline needs to that same secret (creating it the first time), and never
prints a value - only which keys it found and the secret's name/ARN - so it
is safe to run, and safe to paste its output anywhere.

**IAM**: whichever IAM user's keys are in a Deployment needs
`secretsmanager:GetSecretValue` on
`arn:aws:secretsmanager:<region>:<account>:secret:{{ project_name }}-<env>-deploy-config-*`.
Whoever runs `push-deploy-config.mjs` needs `secretsmanager:CreateSecret` the
first time and `secretsmanager:PutSecretValue` afterwards (or create the
secret once by hand, then let the script update it).

### The production gate

`dev` and `staging` deploy automatically on a merge. Production does not:
`main` runs a read-only `Diff (Production)` step first, then waits for an
explicit click on `Deploy to Production (manual)`.

The diff step declares `environment: prod` rather than `deployment: prod`.
Bitbucket rejects a pipeline that references the same deployment twice, and
that step only reads; it still receives the production variables, while the
deploy step keeps the deployment, its lock, and the tracking entry. Because
CDK has no saved-plan artifact, the deploy re-synthesizes and prints its own
diff as the last thing before applying.

## Before this pipeline can run

A new Bitbucket repository has neither Pipelines nor these Deployments. Before
any push actually deploys:

1. Enable Pipelines in Repository settings.
2. Repository settings > Deployments: rename the three defaults to `dev`,
   `staging`, and `prod`.
3. On each Deployment, set only `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
   (secured) for an IAM user able to deploy this stack, and `AWS_REGION`. Do
   **not** add `PROJECT_NAME` (fixed in the pipeline) or the WhatsApp/agent/SSO
   variables (they come from Secrets Manager - see "Deploy-time config").
   If the stack was already deployed by hand, point the `dev` credentials at
   that same AWS account, so the pipeline updates it instead of creating a
   second one.
4. Create the `{{ project_name }}-dev-deploy-config` secret by running
   `node scripts/push-deploy-config.mjs` from a machine with a working `.env`
   and permission to create it, then grant the Deployment's IAM user
   `secretsmanager:GetSecretValue` on it.
5. Create a `staging` branch and Deployment only when a real staging
   environment is wanted; until then that part of the pipeline is inert.

## Moving to another provider

Replace `bitbucket-pipelines.yml` with the provider's equivalent and call the
same three commands. The replacement must export placeholder `ENV_NAME` and
`PROJECT_NAME` for the verification job, keep that job free of AWS
credentials, wrap only `cdk diff`/`cdk deploy` with
`scripts/with-deploy-config.mjs`, and preserve the manual approval in front
of production.

## Deployment safety

A reviewed `cdk diff` runs before every apply, production needs an explicit
manual approval, and the verification job never holds AWS credentials.
