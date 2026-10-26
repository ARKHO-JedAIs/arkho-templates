import type { AuthProvider, AuthUser } from './types';

/**
 * A no-backend auth provider so the app runs with `npm install && npm run dev`
 * before any Cognito user pool exists. Every credential is accepted and the
 * session lives in localStorage.
 *
 * Deliberately NOT a security boundary: it exists so screens, guards and role
 * branches are all reachable on day one. Switch VITE_AUTH_PROVIDER to `cognito`
 * and the exact same call sites start talking to a real user pool.
 */
const STORAGE_KEY = 'mock-auth-user';

/**
 * Groups the mock user belongs to, so role-gated screens are reachable in mock
 * mode. Comma-separated, e.g. VITE_MOCK_AUTH_GROUPS="admin".
 */
function mockGroups(): string[] {
  const raw = import.meta.env.VITE_MOCK_AUTH_GROUPS ?? '';
  return raw
    .split(',')
    .map((group: string) => group.trim())
    .filter(Boolean);
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

/** Simulates the MFA challenge locally, gated behind its own flag so mock
 * mode still signs straight in by default - set VITE_MOCK_AUTH_OTP=true to
 * exercise the OTP screen before the user pool has real MFA configured.
 * Unlike every other mock credential, the code is NOT "anything goes": it
 * has to be MOCK_OTP_CODE exactly, so the screen's own validation (wrong
 * code, retry) is actually exercisable too. Held between signIn and
 * confirmOtp only, so a page reload mid-challenge just restarts the sign-in
 * - there is no real session yet to lose. */
let pendingUser: AuthUser | null = null;

const MOCK_OTP_CODE = '000000';

function mockOtpEnabled(): boolean {
  return import.meta.env.VITE_MOCK_AUTH_OTP === 'true';
}

export const mockProvider: AuthProvider = {
  async getCurrentUser() {
    // No token expiry in mock mode, so `forceRefresh` has nothing to do -
    // groups always come straight from whatever signIn stored.
    return readStoredUser();
  },

  async getIdToken() {
    // A syntactically plausible placeholder - never accepted by a real backend,
    // which is the point: a misconfigured "mock in production" fails loudly at
    // the API instead of silently authorizing anything.
    return readStoredUser() ? 'mock-id-token' : null;
  },

  async signIn(username: string) {
    const user: AuthUser = {
      username,
      email: username.includes('@') ? username : `${username}@example.com`,
      name: username,
      groups: mockGroups(),
    };

    if (mockOtpEnabled()) {
      pendingUser = user;
      return {
        status: 'otp-required' as const,
        method: 'email' as const,
        destination: 'd•••@example.com',
      };
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return { status: 'signed-in' as const };
  },

  async completeNewPassword() {
    return { status: 'signed-in' as const };
  },

  async confirmOtp(code: string) {
    if (code.trim() !== MOCK_OTP_CODE) {
      throw new Error('Invalid code');
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingUser));
    pendingUser = null;
    return { status: 'signed-in' as const };
  },

  async signOut() {
    localStorage.removeItem(STORAGE_KEY);
  },
};
