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

export type EmailMfaConfig = { enabled: false } | { enabled: true; fromEmail: string };

export interface CognitoConfig {
  domainPrefix?: string;
  entraId: EntraIdConfig;
  emailMfa: EmailMfaConfig;
}

/**
 * WhatsApp settings, from .env (gitignored): the phone number ARN carries the
 * AWS account id, so it must not live in a committed file. WhatsAppFactory
 * writes them to a Parameter Store parameter the Lambdas read at runtime, so
 * they can also be edited there without a deploy.
 */
export interface WhatsAppConfig {
  phoneNumberId: string;
  businessAccountId: string;
  defaultPhonePrefix: string;
  autoReplyMessage: string;
  metaApiVersion: string;
  /**
   * Cognito group the WhatsApp API and realtime channel require. Empty when the
   * project has a single profile (WHATSAPP_REQUIRE_ADMIN=false): then any
   * signed-in user may use them, as the frontend shows them to everyone.
   */
  adminGroup: string;
}

export interface AppConfig {
  env: EnvironmentConfig;
  params: ParamsConfig;
  cognito: CognitoConfig;
  whatsapp: WhatsAppConfig;
  /** USERS_API_ENABLED: wire the /admin/users API of the Usuarios screen. */
  usersApiEnabled: boolean;
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

  // Email OTP as a second sign-in step. Cognito sends the code through SES, so
  // the sender must be a verified SES identity in the deployment region.
  const emailMfaEnabledValue = process.env.EMAIL_MFA_ENABLED?.trim();
  if (emailMfaEnabledValue && emailMfaEnabledValue !== 'true' && emailMfaEnabledValue !== 'false') {
    console.error('Error: EMAIL_MFA_ENABLED must be true, false, empty, or undefined');
    process.exit(1);
  }
  const emailMfa: EmailMfaConfig =
    emailMfaEnabledValue === 'true'
      ? { enabled: true, fromEmail: requiredEnv('SES_FROM_EMAIL') }
      : { enabled: false };
  if (emailMfa.enabled && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailMfa.fromEmail)) {
    console.error('Error: SES_FROM_EMAIL must be an email address, e.g. no-reply@example.com');
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
    emailMfa,
  };

  const whatsapp: WhatsAppConfig = {
    phoneNumberId: optionalEnv('WHATSAPP_PHONE_NUMBER_ID') ?? '',
    businessAccountId: optionalEnv('WHATSAPP_BUSINESS_ACCOUNT_ID') ?? '',
    defaultPhonePrefix: (optionalEnv('WHATSAPP_DEFAULT_PHONE_PREFIX') ?? '').replace(/^\+/, ''),
    autoReplyMessage: optionalEnv('WHATSAPP_AUTO_REPLY_MESSAGE') ?? '',
    metaApiVersion: optionalEnv('WHATSAPP_META_API_VERSION') ?? 'v20.0',
    adminGroup:
      process.env.WHATSAPP_REQUIRE_ADMIN?.trim() === 'false'
        ? ''
        : (optionalEnv('WHATSAPP_ADMIN_GROUP') ?? 'admin'),
  };
  if (whatsapp.defaultPhonePrefix && !/^[0-9]{1,3}$/.test(whatsapp.defaultPhonePrefix)) {
    console.error('Error: WHATSAPP_DEFAULT_PHONE_PREFIX must be 1 to 3 digits, e.g. 56');
    process.exit(1);
  }

  const usersApiEnabled = process.env.USERS_API_ENABLED?.trim() === 'true';

  return { env, params, cognito, whatsapp, usersApiEnabled };
}

export const config: AppConfig = loadEnvironment();
