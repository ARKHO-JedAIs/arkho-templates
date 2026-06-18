import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppConfigProvider } from "@/app/AppConfig";
import { router } from "@/app/router";
import { ConfigError } from "@/components/templates/ConfigError";
import { configureAmplify } from "@/lib/auth/amplify";
import { readEnv } from "@/lib/config/env";
import "@/styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);
const result = readEnv();

if (!result.ok) {
  // Fail loud: render an explicit configuration-error screen (FR-015).
  root.render(
    <StrictMode>
      <ConfigError issues={result.issues} />
    </StrictMode>,
  );
} else {
  configureAmplify(result.env);
  const queryClient = new QueryClient();

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppConfigProvider env={result.env}>
          <RouterProvider router={router} />
        </AppConfigProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
