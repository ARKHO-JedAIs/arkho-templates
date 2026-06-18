import type { AxiosInstance } from "axios";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { AppEnv } from "@/lib/config/env";
import { createApiClient } from "@/lib/http/client";

interface AppConfigValue {
  env: AppEnv;
  apiClient: AxiosInstance;
}

const AppConfigContext = createContext<AppConfigValue | null>(null);

// Provides validated env and the shared Axios client to the tree. Mounted only
// after env validation succeeds, so consumers can assume config is present.
export function AppConfigProvider({ env, children }: { env: AppEnv; children: ReactNode }) {
  const value = useMemo<AppConfigValue>(
    () => ({ env, apiClient: createApiClient(env.VITE_API_BASE_URL) }),
    [env],
  );
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

function useAppConfig(): AppConfigValue {
  const ctx = useContext(AppConfigContext);
  if (!ctx) {
    throw new Error("useAppConfig must be used within an AppConfigProvider");
  }
  return ctx;
}

export function useAppEnv(): AppEnv {
  return useAppConfig().env;
}

export function useApiClient(): AxiosInstance {
  return useAppConfig().apiClient;
}
