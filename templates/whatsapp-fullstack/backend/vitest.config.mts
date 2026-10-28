import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Synthesizing MainStack stages the Lambda and layer assets, which takes
    // well over Vitest's 5s default when the test files run in parallel.
    testTimeout: 60_000,
  },
});
