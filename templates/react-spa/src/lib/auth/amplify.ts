import { Amplify } from "aws-amplify";
import type { AppEnv } from "@/lib/config/env";

// Configure Amplify Auth (Cognito) from validated env values. Custom in-app forms
// call the aws-amplify/auth APIs directly; no hosted UI is configured here.
export function configureAmplify(env: AppEnv): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: env.VITE_COGNITO_USER_POOL_CLIENT_ID,
      },
    },
  });
}
