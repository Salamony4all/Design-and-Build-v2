import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    pool: 'threads',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@pascal-app/core': path.resolve(__dirname, 'test-stubs/pascal-core.ts'),
      '@pascal-app/editor/catalog': path.resolve(__dirname, 'node_modules/@pascal-app/editor/src/components/ui/item-catalog/catalog-items.tsx'),
    },
  },
});
