import { cognitoProvider, configureCognito } from './cognitoProvider';
import { mockProvider } from './mockProvider';
import type { AuthProvider, AuthUser, SignInResult } from './types';

export type { AuthUser, SignInResult };

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
 * Called once at startup. Configuring Amplify with an empty user pool id throws,
 * so a Cognito build with missing config is reported as a config error rather
 * than crashing on the first auth call.
 */
export function initializeAuth(): { ok: true } | { ok: false; missing: string[] } {
  if (isMockAuth) return { ok: true };

  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID;

  const missing: string[] = [];
  if (!userPoolId) missing.push('VITE_COGNITO_USER_POOL_ID');
  if (!userPoolClientId) missing.push('VITE_COGNITO_USER_POOL_CLIENT_ID');
  if (!userPoolId || !userPoolClientId) return { ok: false, missing };

  configureCognito(userPoolId, userPoolClientId);
  return { ok: true };
}

export const getCurrentUser = (): Promise<AuthUser | null> => provider.getCurrentUser();
export const getIdToken = (): Promise<string | null> => provider.getIdToken();
export const signIn = (username: string, password: string): Promise<SignInResult> =>
  provider.signIn(username, password);
export const completeNewPassword = (newPassword: string): Promise<SignInResult> =>
  provider.completeNewPassword(newPassword);
export const signOut = (): Promise<void> => provider.signOut();

/** Authorization header for a fetch call, empty when there is no session. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken();
  return {
    Authorization: `Bearer ${token ?? ''}`,
    'Content-Type': 'application/json',
  };
}
