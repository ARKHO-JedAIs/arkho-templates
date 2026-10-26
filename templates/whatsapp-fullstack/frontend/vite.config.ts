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
    // Just above today's entry chunk (~620 kB), so any real growth trips the
    // warning again. The number is not arbitrary: the entry is dominated by
    // `aws-amplify`, which `src/lib/auth/cognitoProvider.ts` imports statically
    // and therefore ships even in a `VITE_AUTH_PROVIDER=mock` build. Loading it
    // behind `initializeAuth()` would make the auth seam async and is a change
    // of its own; until then this is the honest ceiling. Section pages and the
    // Transcribe SDK are already split out.
    chunkSizeWarningLimit: 650,
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
    // VITE_ADMIN_GROUP is answered at generation time: in the template it is
    // literally `{{ admin_group }}`, and in a generated project it is whatever
    // the team chose. Vitest loads .env, so without pinning it here the auth
    // tests would depend on that answer and fail in any project that did not
    // pick "admin".
    env: {
      VITE_ADMIN_GROUP: 'admin',
    },
  },
});
