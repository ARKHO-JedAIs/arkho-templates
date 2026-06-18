import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/useAuth";

// Route guard: redirects unauthenticated users to the sign-in page, preserving
// the attempted location so they can be returned after signing in.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "unknown") {
    return <p className="text-sm text-muted-foreground">Checking your session...</p>;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
