import {
  type AuthUser,
  fetchAuthSession,
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  confirmSignIn,
} from "aws-amplify/auth";

export interface SignInResult {
  isSignedIn: boolean;
  // Present when Cognito requires an additional step (e.g. NEW_PASSWORD_REQUIRED).
  nextStep?: string;
}

// Thin wrappers over the aws-amplify/auth v6 API so UI components depend on a
// small, typed surface instead of Amplify directly (easier to test and swap).
export async function signIn(username: string, password: string): Promise<SignInResult> {
  const result = await amplifySignIn({ username, password });
  return {
    isSignedIn: result.isSignedIn,
    nextStep: result.nextStep?.signInStep,
  };
}

export async function completeNewPassword(newPassword: string): Promise<SignInResult> {
  const result = await confirmSignIn({ challengeResponse: newPassword });
  return {
    isSignedIn: result.isSignedIn,
    nextStep: result.nextStep?.signInStep,
  };
}

export async function signOut(): Promise<void> {
  await amplifySignOut();
}

export async function getActiveUser(): Promise<AuthUser | null> {
  try {
    const session = await fetchAuthSession();
    if (!session.tokens) {
      return null;
    }
    return await getCurrentUser();
  } catch {
    return null;
  }
}
