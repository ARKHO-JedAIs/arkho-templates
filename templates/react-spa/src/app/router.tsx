import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/app/AppLayout";
import { RequireAuth } from "@/app/RequireAuth";
import { DashboardPage } from "@/pages/DashboardPage";
import { HomePage } from "@/pages/HomePage";
import { ItemsPage } from "@/pages/ItemsPage";
import { SignInPage } from "@/pages/SignInPage";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      // Public routes.
      { index: true, element: <HomePage /> },
      { path: "items", element: <ItemsPage /> },
      { path: "signin", element: <SignInPage /> },
      // Protected route.
      {
        path: "dashboard",
        element: (
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        ),
      },
    ],
  },
]);
