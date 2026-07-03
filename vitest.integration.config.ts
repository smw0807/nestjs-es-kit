import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        // Run each integration test file in its own process to avoid
        // container port conflicts and metadata-storage cross-contamination.
        singleFork: false,
      },
    },
  },
});
