import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/app/RequireAuth";

// Control the auth status without touching Amplify or the real store.
const authState = { status: "unknown" as "unknown" | "authenticated" | "unauthenticated" };

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    status: authState.status,
    user: null,
    signIn: vi.fn(),
    submitNewPassword: vi.fn(),
    signOut: vi.fn(),
  }),
}));

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <p>Protected content</p>
            </RequireAuth>
          }
        />
        <Route path="/signin" element={<p>Sign in here</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    authState.status = "unknown";
  });

  it("redirects unauthenticated users to the sign-in route", () => {
    authState.status = "unauthenticated";
    renderGuarded();
    expect(screen.getByText("Sign in here")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders protected content for authenticated users", () => {
    authState.status = "authenticated";
    renderGuarded();
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});
