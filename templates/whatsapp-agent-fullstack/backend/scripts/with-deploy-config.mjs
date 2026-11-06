#!/usr/bin/env node
/**
 * Runs the given command with the deploy-time config merged into its
 * environment, fetched from the Secrets Manager secret
 * `${PROJECT_NAME}-${ENV_NAME}-deploy-config` (see push-deploy-config.mjs,
 * which writes it, and docs/ci.md). Used by bitbucket-pipelines.yml so cdk
 * synth sees the same WhatsApp/agent/SSO config a local deploy does, instead
 * of silently falling back to "this feature is off" and deleting it.
 *
 *   node scripts/with-deploy-config.mjs npx cdk deploy --require-approval never
 *
 * Values are passed straight into the child's environment, never through a
 * shell, so nothing here needs escaping for quotes, `$`, or newlines.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const [, , ...command] = process.argv;
if (command.length === 0) {
  console.error('Usage: node scripts/with-deploy-config.mjs <command> [args...]');
  process.exit(1);
}

const { ENV_NAME, PROJECT_NAME, AWS_REGION } = process.env;
if (!ENV_NAME || !PROJECT_NAME || !AWS_REGION) {
  console.error('ENV_NAME, PROJECT_NAME and AWS_REGION must already be set.');
  process.exit(1);
}

const secretName = `${PROJECT_NAME}-${ENV_NAME}-deploy-config`;
const json = execFileSync(
  'aws',
  [
    'secretsmanager',
    'get-secret-value',
    '--secret-id',
    secretName,
    '--region',
    AWS_REGION,
    '--query',
    'SecretString',
    '--output',
    'text',
  ],
  { encoding: 'utf8' }
);
const config = JSON.parse(json);

const result = spawnSync(command[0], command.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, ...config },
});
process.exit(result.status ?? 1);
