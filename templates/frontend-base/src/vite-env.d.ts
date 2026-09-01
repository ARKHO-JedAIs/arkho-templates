/// <reference types="vite/client" />

/**
 * Every environment variable this app reads.
 *
 * Declaring them all matters more than it looks: `vite/client` ships an index
 * signature, so a variable missing from here silently resolves to `any` and a
 * typo in its name goes unnoticed. Keep this in sync with `.env.example`.
 *
 * All optional, because a `.env` can legitimately leave any of them blank -
 * missing required configuration is reported at startup by `initializeAuth()`,
 * not by the type system.
 */
interface ImportMetaEnv {
  // Authentication
  readonly VITE_AUTH_PROVIDER?: string;
  readonly VITE_MOCK_AUTH_GROUPS?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string;
  readonly VITE_ADMIN_GROUP?: string;

  // Backend API
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USERS_API_PATH?: string;

  // Chat
  readonly VITE_AGENT_CHAT_API_URL?: string;
  readonly VITE_CHAT_CAPABILITIES?: string;
  readonly VITE_CHAT_VOICE_LANGUAGE?: string;
  readonly VITE_COGNITO_IDENTITY_POOL_ID?: string;
  readonly VITE_CHAT_IMAGES_UPLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
