import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // raptorq only declares `module:` in package.json (no `main` or `exports`);
      // Vite/Vitest can't auto-resolve it, so we point directly at the ESM file.
      raptorq: resolve(__dirname, 'node_modules/raptorq/raptorq.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/ci/**/*.test.ts'],
    globals: false,
    testTimeout: 60_000,
  },
});
