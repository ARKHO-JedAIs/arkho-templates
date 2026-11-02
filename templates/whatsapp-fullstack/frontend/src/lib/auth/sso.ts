/**
 * Federated sign-in ("Iniciar sesión con Microsoft", "Continuar con Google"),
 * kept free of aws-amplify so it can be read and tested on its own.
 */
export type SsoProvider = 'microsoft' | 'google';

const KNOWN: readonly SsoProvider[] = ['microsoft', 'google'];

/**
 * VITE_AUTH_SSO_PROVIDERS as a list, in a fixed order and without unknown or
 * repeated names. Always empty under mock sign-in: there is no Hosted UI to
 * redirect to.
 */
export function parseSsoProviders(raw: string | undefined, isMock: boolean): SsoProvider[] {
  if (isMock) return [];
  const listed = (raw ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  return KNOWN.filter(provider => listed.includes(provider));
}

/** The Hosted UI host Amplify expects: no scheme, no trailing slash. */
export function normalizeCognitoDomain(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}
