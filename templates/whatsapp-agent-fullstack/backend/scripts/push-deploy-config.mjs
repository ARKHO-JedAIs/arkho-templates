#!/usr/bin/env node
/**
 * Pushes this machine's .env into the Secrets Manager secret the pipeline
 * reads at deploy time, so the two never drift apart.
 *
 * Run by hand, from the repository root, whenever .env changes:
 *   node scripts/push-deploy-config.mjs
 *   AWS_PROFILE=<profile> node scripts/push-deploy-config.mjs   (a non-default profile)
 *
 * Never prints a value - only which keys it found and the secret's name/ARN -
 * so running it, or pasting its output anywhere, never leaks a secret.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Everything cdk synth reads except ENV_NAME/PROJECT_NAME (fixed in
// bitbucket-pipelines.yml) and the AWS_* ones (stay as Bitbucket Deployment
// variables - the pipeline needs them before it can even reach this secret).
const KEYS = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_DEFAULT_PHONE_PREFIX',
  'WHATSAPP_AUTO_REPLY_MESSAGE',
  'WHATSAPP_META_API_VERSION',
  'WHATSAPP_ADMIN_GROUP',
  'WHATSAPP_REQUIRE_ADMIN',
  'MEDIA_RETENTION_DAYS',
  'MEDIA_URL_TTL_SECONDS',
  'AGENT_RUNTIME',
  'AGENT_MODEL_ID',
  'AGENT_BUSINESS_DESCRIPTION',
  'AGENT_MEMORY_MODE',
  'AGENT_RATE_LIMIT_PER_HOUR',
  'AGENT_BUSINESS_API_URL',
  'USERS_API_ENABLED',
  'DEVELOPER_EMAILS',
  'SSO_PROVIDERS',
  'ENTRA_ID_CLIENT_ID',
  'ENTRA_ID_CLIENT_SECRET',
  'ENTRA_ID_ISSUER_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'AUTH_CALLBACK_URLS',
  'AUTH_LOGOUT_URLS',
  'EMAIL_MFA_ENABLED',
  'SES_FROM_EMAIL',
];

const envName = process.env.ENV_NAME;
const projectName = process.env.PROJECT_NAME;
if (!envName || !projectName) {
  console.error('ENV_NAME and PROJECT_NAME must be set in .env - see .env.example.');
  process.exit(1);
}

const config = {};
const missing = [];
for (const key of KEYS) {
  const value = process.env[key];
  if (value === undefined) {
    missing.push(key);
    continue;
  }
  config[key] = value;
}

const secretName = `${projectName}-${envName}-deploy-config`;
const region = process.env.AWS_REGION || 'us-east-1';
const awsArgs = ['--region', region];
if (process.env.AWS_PROFILE) awsArgs.push('--profile', process.env.AWS_PROFILE);

const dir = mkdtempSync(join(tmpdir(), 'deploy-config-'));
const file = join(dir, 'secret.json');
try {
  writeFileSync(file, JSON.stringify(config));
  let arn;
  try {
    const result = execFileSync(
      'aws',
      [
        'secretsmanager',
        'put-secret-value',
        '--secret-id',
        secretName,
        '--secret-string',
        `file://${file}`,
        '--query',
        'ARN',
        '--output',
        'text',
        ...awsArgs,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    arn = result.trim();
  } catch {
    // The secret does not exist yet: create it instead.
    const result = execFileSync(
      'aws',
      [
        'secretsmanager',
        'create-secret',
        '--name',
        secretName,
        '--description',
        `Deploy-time config for ${projectName} (${envName}), read by bitbucket-pipelines.yml`,
        '--secret-string',
        `file://${file}`,
        '--query',
        'ARN',
        '--output',
        'text',
        ...awsArgs,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    arn = result.trim();
  }
  console.log(`Pushed ${Object.keys(config).length} keys to ${secretName}`);
  console.log(`ARN: ${arn}`);
  if (missing.length) {
    console.log(`Not in .env, so not pushed (fine if intentionally unset): ${missing.join(', ')}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
