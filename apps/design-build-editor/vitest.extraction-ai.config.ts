import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root: repoRoot,
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/extraction-ai/tests/**/*.test.ts'],
    pool: 'threads',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
