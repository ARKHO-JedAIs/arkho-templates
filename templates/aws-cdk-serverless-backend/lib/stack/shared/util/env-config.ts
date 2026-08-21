import * as dotenv from 'dotenv';

export interface EnvironmentConfig {
  account?: string;
  region?: string;
}

export interface ParamsConfig {
  envName: string;
  projectName: string;
  isProd: boolean;
}

export interface EntraIdConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  issuerUrl?: string;
}

export interface CognitoConfig {
  domainPrefix?: string;
  entraId: EntraIdConfig;
}

export interface AppConfig {
  env: EnvironmentConfig;
  params: ParamsConfig;
  cognito: CognitoConfig;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    console.error(`Error: The environment variable ${name} is not defined`);
    process.exit(1);
  }
  return value;
}

export function loadEnvironment(): AppConfig {
  dotenv.config({ quiet: true });

  const envName = requiredEnv('ENV_NAME');
  const projectName = requiredEnv('PROJECT_NAME');

  const env: EnvironmentConfig = {
    account: optionalEnv('AWS_ACCOUNT_ID'),
    region: optionalEnv('AWS_REGION'),
  };

  const params: ParamsConfig = {
    envName,
    projectName,
    isProd: envName === 'prod',
  };

  const entraIdEnabled = process.env.ENTRA_ID_ENABLED === 'true';
  if (entraIdEnabled && (!optionalEnv('ENTRA_ID_CLIENT_ID') || !optionalEnv('ENTRA_ID_CLIENT_SECRET') || !optionalEnv('ENTRA_ID_ISSUER_URL'))) {
    console.error('Error: ENTRA_ID_ENABLED is true but ENTRA_ID_CLIENT_ID, ENTRA_ID_CLIENT_SECRET or ENTRA_ID_ISSUER_URL is missing');
    process.exit(1);
  }

  const cognito: CognitoConfig = {
    // Hosted UI domain prefix, only needed for federation; derived from the
    // resource-name convention so it does not require manual configuration.
    domainPrefix: entraIdEnabled ? `${projectName}-${envName}` : undefined,
    entraId: {
      enabled: entraIdEnabled,
      clientId: optionalEnv('ENTRA_ID_CLIENT_ID'),
      clientSecret: optionalEnv('ENTRA_ID_CLIENT_SECRET'),
      issuerUrl: optionalEnv('ENTRA_ID_ISSUER_URL'),
    },
  };

  return { env, params, cognito };
}

export const config: AppConfig = loadEnvironment();
