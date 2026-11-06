import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
//
// Test config lives here rather than in a separate vitest.config.ts on purpose:
// a second file would have to redeclare the `@` alias, and the day the two
// definitions drift the symptom is "tests cannot resolve @/lib/... but the build
// can". Vite ignores the `test` key.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Above today's largest chunk (the entry, ~555 kB), so real growth trips the
    // warning again. `aws-amplify` ships even in a `VITE_AUTH_PROVIDER=mock`
    // build because `src/lib/auth/cognitoProvider.ts` imports it statically;
    // loading it behind `initializeAuth()` would make the auth seam async and is
    // a change of its own. Section pages are already split out.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // aws-amplify changes far less often than the app: its own chunk keeps
        // the entry under the limit and stays cached across deploys.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](@aws-amplify|aws-amplify|@aws-sdk|@smithy)[\\/]/.test(id)) {
            return 'amplify';
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Vitest loads .env, so VITE_ADMIN_GROUP is pinned here: the auth tests
    // then do not depend on what a project writes there.
    env: {
      VITE_ADMIN_GROUP: 'admin',
    },
  },
});
