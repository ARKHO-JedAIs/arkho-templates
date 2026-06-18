import { fetchAuthSession } from "aws-amplify/auth";
import axios, { type AxiosInstance } from "axios";

// Single shared HTTP client. Base URL comes from validated config; a request
// interceptor attaches the current Cognito token when a session exists.
export function createApiClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 15_000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use(async (config) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (token) {
        config.headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {
      // No active session: send the request unauthenticated and let the API
      // respond with 401 if the endpoint requires auth.
    }
    return config;
  });

  return client;
}
