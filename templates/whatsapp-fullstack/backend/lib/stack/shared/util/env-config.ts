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

export interface GoogleConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
}

export type EmailMfaConfig = { enabled: false } | { enabled: true; fromEmail: string };

export const SSO_PROVIDER_NAMES = ['microsoft', 'google'] as const;
export type SsoProviderName = (typeof SSO_PROVIDER_NAMES)[number];

/** Where Cognito may send the browser back to: the frontend's routes. */
export const DEFAULT_AUTH_CALLBACK_URLS = ['http://localhost:5173/auth/callback'];
export const DEFAULT_AUTH_LOGOUT_URLS = ['http://localhost:5173/login'];

export interface CognitoConfig {
  /** Hosted UI domain prefix; set whenever SSO_PROVIDERS lists a provider. */
  domainPrefix?: string;
  entraId: EntraIdConfig;
  google?: GoogleConfig;
  emailMfa: EmailMfaConfig;
  /** AUTH_CALLBACK_URLS; defaults to DEFAULT_AUTH_CALLBACK_URLS. */
  callbackUrls?: string[];
  /** AUTH_LOGOUT_URLS; defaults to DEFAULT_AUTH_LOGOUT_URLS. */
  logoutUrls?: string[];
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
  /** MEDIA_RETENTION_DAYS: files in the media bucket expire after this; unset = kept forever. */
  mediaRetentionDays?: number;
  /** MEDIA_URL_TTL_SECONDS: how long a presigned media URL works (default 900). */
  mediaUrlTtlSeconds?: number;
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

function listEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function ssoProvidersEnv(): SsoProviderName[] {
  const listed = listEnv('SSO_PROVIDERS').map((item) => item.toLowerCase());
  const unknown = listed.filter((item) => !(SSO_PROVIDER_NAMES as readonly string[]).includes(item));
  if (unknown.length > 0) {
    console.error(`Error: SSO_PROVIDERS accepts ${SSO_PROVIDER_NAMES.join(', ')} (comma-separated); got ${unknown.join(', ')}`);
    process.exit(1);
  }
  return listed as SsoProviderName[];
}

/**
 * Whether a provider listed in SSO_PROVIDERS can be created. With none of its
 * credentials set it is left out with a warning instead of failing: the first
 * deploy has to happen without them, because it is what creates the Hosted UI
 * domain whose redirect URI the provider's app registration needs.
 */
function federatedProviderReady(label: string, names: string[]): boolean {
  const missing = names.filter((name) => !optionalEnv(name));
  if (missing.length === names.length) {
    console.warn(`Warning: SSO_PROVIDERS lists ${label} but ${names.join(', ')} are empty; ${label} sign-in is not created until they are set`);
    return false;
  }
  if (missing.length > 0) {
    console.error(`Error: SSO_PROVIDERS lists ${label} but ${missing.join(', ')} is missing`);
    process.exit(1);
  }
  return true;
}

function urlListEnv(name: string, fallback: string[]): string[] {
  const urls = listEnv(name);
  const invalid = urls.filter((url) => !/^https?:\/\/[^\s]+$/.test(url));
  if (invalid.length > 0) {
    console.error(`Error: ${name} must be comma-separated http(s) URLs; got ${invalid.join(', ')}`);
    process.exit(1);
  }
  return urls.length > 0 ? urls : fallback;
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

  // Sign in with Microsoft (Entra ID) and/or Google, through the Cognito Hosted UI.
  const ssoProviders = ssoProvidersEnv();
  const entraIdEnabled =
    ssoProviders.includes('microsoft') &&
    federatedProviderReady('microsoft', ['ENTRA_ID_CLIENT_ID', 'ENTRA_ID_CLIENT_SECRET', 'ENTRA_ID_ISSUER_URL']);
  if (entraIdEnabled && !/^https:\/\/[^\s<>]+$/.test(requiredEnv('ENTRA_ID_ISSUER_URL'))) {
    console.error('Error: ENTRA_ID_ISSUER_URL must look like https://login.microsoftonline.com/<tenant-id>/v2.0');
    process.exit(1);
  }
  const googleEnabled =
    ssoProviders.includes('google') &&
    federatedProviderReady('google', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

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
    domainPrefix: ssoProviders.length > 0 ? `${projectName}-${envName}` : undefined,
    entraId: {
      enabled: entraIdEnabled,
      clientId: optionalEnv('ENTRA_ID_CLIENT_ID'),
      clientSecret: optionalEnv('ENTRA_ID_CLIENT_SECRET'),
      issuerUrl: optionalEnv('ENTRA_ID_ISSUER_URL'),
    },
    google: {
      enabled: googleEnabled,
      clientId: optionalEnv('GOOGLE_CLIENT_ID'),
      clientSecret: optionalEnv('GOOGLE_CLIENT_SECRET'),
    },
    emailMfa,
    callbackUrls: urlListEnv('AUTH_CALLBACK_URLS', DEFAULT_AUTH_CALLBACK_URLS),
    logoutUrls: urlListEnv('AUTH_LOGOUT_URLS', DEFAULT_AUTH_LOGOUT_URLS),
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
  const mediaRetentionDays = optionalEnv('MEDIA_RETENTION_DAYS');
  if (mediaRetentionDays !== undefined) {
    if (!/^[1-9][0-9]{0,4}$/.test(mediaRetentionDays)) {
      console.error('Error: MEDIA_RETENTION_DAYS must be empty (keep forever) or a positive number of days, e.g. 90');
      process.exit(1);
    }
    whatsapp.mediaRetentionDays = Number(mediaRetentionDays);
  }
  const mediaUrlTtlSeconds = optionalEnv('MEDIA_URL_TTL_SECONDS');
  if (mediaUrlTtlSeconds !== undefined) {
    // SigV4 presigned URLs cannot outlive 7 days.
    if (!/^[1-9][0-9]{0,5}$/.test(mediaUrlTtlSeconds) || Number(mediaUrlTtlSeconds) > 604800) {
      console.error('Error: MEDIA_URL_TTL_SECONDS must be 1 to 604800 seconds, e.g. 900');
      process.exit(1);
    }
    whatsapp.mediaUrlTtlSeconds = Number(mediaUrlTtlSeconds);
  }

  const usersApiEnabled = process.env.USERS_API_ENABLED?.trim() === 'true';

  return { env, params, cognito, whatsapp, usersApiEnabled };
}

export const config: AppConfig = loadEnvironment();
