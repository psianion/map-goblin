import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@map-assets/engine': resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
