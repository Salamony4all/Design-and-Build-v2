import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: 'C:/Users/Mohamad60025/Desktop/Design-And-Build-Stable-5d93e63',
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/extraction-ai/tests/**/*.test.ts'],
    pool: 'threads',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
