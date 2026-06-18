import { z } from "zod";

// Validate at the boundary: parse import.meta.env once at startup and fail loud
// with an explicit, actionable message if anything required is missing/invalid.
const envSchema = z.object({
  VITE_AWS_REGION: z
    .string()
    .min(1, "VITE_AWS_REGION is required")
    .regex(/^[a-z]{2}-[a-z]+-\d$/, "VITE_AWS_REGION must look like 'us-east-1'"),
  VITE_COGNITO_USER_POOL_ID: z
    .string()
    .min(1, "VITE_COGNITO_USER_POOL_ID is required"),
  VITE_COGNITO_USER_POOL_CLIENT_ID: z
    .string()
    .min(1, "VITE_COGNITO_USER_POOL_CLIENT_ID is required"),
  VITE_COGNITO_DOMAIN: z.string().optional(),
  VITE_API_BASE_URL: z
    .string()
    .min(1, "VITE_API_BASE_URL is required")
    .url("VITE_API_BASE_URL must be a valid URL"),
});

export type AppEnv = z.infer<typeof envSchema>;

export type EnvResult =
  | { ok: true; env: AppEnv }
  | { ok: false; issues: string[] };

// Returns a typed result rather than throwing, so the UI can render a clear
// configuration-error screen (see components/templates/ConfigError).
export function readEnv(source: ImportMetaEnv = import.meta.env): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) {
    return { ok: true, env: parsed.data };
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { ok: false, issues };
}
