import { Amplify } from 'aws-amplify';
import {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser as amplifyGetCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import type { AuthProvider, AuthUser } from './types';

/**
 * Amplify's way of saying "nobody is signed in" - an expected answer, not a
 * failure. Matched by name because the class isn't exported.
 */
function isNoSessionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'UserUnAuthenticatedException';
}

/**
 * Only ever called by `initializeAuth()`, which has already verified both ids
 * are present - hence the non-null assertions. Configuring Amplify with an
 * empty pool id throws, so that check is the guard, not this function.
 */
export function configureCognito(userPoolId: string, userPoolClientId: string): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
      },
    },
  });
}

/**
 * The user's Cognito groups, or null when they could not be read at all.
 *
 * The distinction matters more than it looks. `cognito:groups` lives in the ID
 * token, and getCurrentUser() can succeed while that token is absent - a
 * refresh that didn't land, for instance. Reading `?? []` off a missing token
 * reports "this user has no groups", which downstream is indistinguishable from
 * "not an admin": a signed-in administrator would silently get the plain user's
 * sidebar. So a missing token earns one forced refresh, and if that still yields
 * nothing the caller keeps what it had rather than concluding anything.
 */
async function readGroups(): Promise<string[] | null> {
  let idToken = (await fetchAuthSession()).tokens?.idToken;
  if (!idToken) {
    idToken = (await fetchAuthSession({ forceRefresh: true })).tokens?.idToken;
  }
  if (!idToken) return null;
  return (idToken.payload['cognito:groups'] as string[] | undefined) ?? [];
}

export const cognitoProvider: AuthProvider = {
  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      const user = await amplifyGetCurrentUser();
      const attributes = await fetchUserAttributes().catch(() => ({}) as Record<string, string>);
      return {
        username: user.username,
        email: attributes.email,
        name: attributes.name,
        // Propagated as-is, null included: collapsing it to [] here is exactly
        // the silent demotion readGroups() exists to prevent.
        groups: await readGroups(),
      };
    } catch (error) {
      if (isNoSessionError(error)) return null;
      throw error;
    }
  },

  async getIdToken(): Promise<string | null> {
    try {
      // No forceRefresh: Amplify already refreshes an expired token on its own,
      // and this runs on every authenticated request - forcing it turned each
      // one into an extra round trip to the Cognito token endpoint.
      const { tokens } = await fetchAuthSession();
      return tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  },

  async signIn(username: string, password: string) {
    const { nextStep } = await amplifySignIn({ username, password });
    if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
      return { status: 'new-password-required' as const };
    }
    return { status: 'signed-in' as const };
  },

  async completeNewPassword(newPassword: string) {
    const { nextStep } = await confirmSignIn({ challengeResponse: newPassword });
    if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
      return { status: 'new-password-required' as const };
    }
    return { status: 'signed-in' as const };
  },

  async signOut() {
    await amplifySignOut();
  },
};
