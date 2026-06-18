import type { AuthUser } from "aws-amplify/auth";
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import {
  completeNewPassword,
  getActiveUser,
  signIn as authSignIn,
  signOut as authSignOut,
} from "@/lib/auth/auth";

type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  setStatus: (status: AuthStatus) => void;
}

// Zustand store holding the auth status/user. Session restore and the sign-in /
// sign-out actions are exposed through the useAuth hook below.
const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  user: null,
  setUser: (user) =>
    set({ user, status: user ? "authenticated" : "unauthenticated" }),
  setStatus: (status) => set({ status }),
}));

export function useAuth() {
  const { status, user, setUser, setStatus } = useAuthStore();

  // Restore the session on first mount so a reload keeps the user signed in.
  useEffect(() => {
    if (status !== "unknown") {
      return;
    }
    let active = true;
    void getActiveUser().then((current) => {
      if (active) {
        setUser(current);
      }
    });
    return () => {
      active = false;
    };
  }, [status, setUser]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const result = await authSignIn(username, password);
      if (result.isSignedIn) {
        setUser(await getActiveUser());
      }
      return result;
    },
    [setUser],
  );

  const submitNewPassword = useCallback(
    async (newPassword: string) => {
      const result = await completeNewPassword(newPassword);
      if (result.isSignedIn) {
        setUser(await getActiveUser());
      }
      return result;
    },
    [setUser],
  );

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setStatus("unauthenticated");
  }, [setUser, setStatus]);

  return { status, user, signIn, submitNewPassword, signOut };
}
