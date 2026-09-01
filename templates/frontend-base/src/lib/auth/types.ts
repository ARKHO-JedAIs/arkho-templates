/** The shape every auth provider must satisfy. Nothing outside lib/auth imports a provider directly. */
export interface AuthUser {
  username: string;
  email?: string;
  name?: string;
  /**
   * The user's groups, or `null` when they could not be read at all.
   *
   * The distinction is load-bearing and must survive all the way to the store.
   * `[]` means "this account belongs to no group"; `null` means "the ID token
   * was unreadable this time". Collapsing the second into the first is what
   * silently demotes a signed-in administrator to a regular user - so callers
   * must keep whatever they already knew rather than conclude anything.
   */
  groups: string[] | null;
}

export interface AuthProvider {
  /**
   * The signed-in user, or `null` when nobody is signed in.
   *
   * "Nobody is signed in" is an answer, not a failure, so it returns `null`.
   * Anything else - a network error, an unreadable token endpoint - throws, and
   * the caller must not mistake that for a signed-out user.
   */
  getCurrentUser(): Promise<AuthUser | null>;
  /** The raw ID token for Authorization headers, or null when there is no session. */
  getIdToken(): Promise<string | null>;
  signIn(username: string, password: string): Promise<SignInResult>;
  /** Completes the NEW_PASSWORD_REQUIRED challenge Cognito raises for a temporary password. */
  completeNewPassword(newPassword: string): Promise<SignInResult>;
  signOut(): Promise<void>;
}

export type SignInResult = { status: 'signed-in' } | { status: 'new-password-required' };
