// packages/extraction-mupdf/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'threads',
    // Live Pure MuPDF extraction of CODE_06 runs ~8s; allow headroom.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
