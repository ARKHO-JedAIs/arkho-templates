import { cognitoProvider, configureCognito } from './cognitoProvider';
import { mockProvider } from './mockProvider';
import { normalizeCognitoDomain, parseSsoProviders, type SsoProvider } from './sso';
import type { AuthProvider, AuthUser, SignInResult } from './types';

export type { AuthUser, SignInResult, SsoProvider };

/**
 * The single seam between the app and whatever is actually authenticating it.
 * Every screen, guard and service goes through this module - nothing else in
 * src/ imports `aws-amplify` or a provider directly, which is what makes the
 * mock/Cognito swap a one-line env change instead of a refactor.
 */
export const authProviderName: 'cognito' | 'mock' =
  import.meta.env.VITE_AUTH_PROVIDER === 'mock' ? 'mock' : 'cognito';

export const isMockAuth = authProviderName === 'mock';

const provider: AuthProvider = isMockAuth ? mockProvider : cognitoProvider;

/**
 * The federated sign-in buttons to show, from VITE_AUTH_SSO_PROVIDERS. Shown
 * under mock too, as a preview; signInWithSso then explains what to set up.
 */
export const ssoProviders: SsoProvider[] = parseSsoProviders(
  import.meta.env.VITE_AUTH_SSO_PROVIDERS
);

/**
 * Called once at startup. Configuring Amplify with an empty user pool id throws,
 * so a Cognito build with missing config is reported as a config error rather
 * than crashing on the first auth call.
 */
export function initializeAuth(): { ok: true } | { ok: false; missing: string[] } {
  if (isMockAuth) return { ok: true };

  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID;

  const cognitoDomain = normalizeCognitoDomain(import.meta.env.VITE_COGNITO_DOMAIN);

  const missing: string[] = [];
  if (!userPoolId) missing.push('VITE_COGNITO_USER_POOL_ID');
  if (!userPoolClientId) missing.push('VITE_COGNITO_USER_POOL_CLIENT_ID');
  if (ssoProviders.length > 0 && !cognitoDomain) missing.push('VITE_COGNITO_DOMAIN');
  if (!userPoolId || !userPoolClientId || missing.length > 0) return { ok: false, missing };

  configureCognito(
    userPoolId,
    userPoolClientId,
    ssoProviders.length > 0
      ? {
          domain: cognitoDomain,
          redirectSignIn:
            import.meta.env.VITE_AUTH_REDIRECT_SIGN_IN || `${window.location.origin}/auth/callback`,
          redirectSignOut:
            import.meta.env.VITE_AUTH_REDIRECT_SIGN_OUT || `${window.location.origin}/login`,
        }
      : undefined
  );
  return { ok: true };
}

export const getCurrentUser = (options?: { forceRefresh?: boolean }): Promise<AuthUser | null> =>
  provider.getCurrentUser(options);
export const getIdToken = (): Promise<string | null> => provider.getIdToken();
export const signIn = (username: string, password: string): Promise<SignInResult> =>
  provider.signIn(username, password);
export const completeNewPassword = (newPassword: string): Promise<SignInResult> =>
  provider.completeNewPassword(newPassword);
export const confirmOtp = (code: string): Promise<SignInResult> => provider.confirmOtp(code);
export const signInWithSso = (sso: SsoProvider): Promise<void> => provider.signInWithSso(sso);
export const completeSsoSignIn = (): Promise<void> => provider.completeSsoSignIn();
export const signOut = (): Promise<void> => provider.signOut();

/** Authorization header for a fetch call, empty when there is no session. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken();
  return {
    Authorization: `Bearer ${token ?? ''}`,
    'Content-Type': 'application/json',
  };
}
