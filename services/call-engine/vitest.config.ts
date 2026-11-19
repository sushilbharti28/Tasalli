import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Postgres and Redis integration tests share local services; run files one at a time.
    fileParallelism: false,
  },
});
