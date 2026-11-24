import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'jsdom',
    // `vitest run --mode bench` runs the timing scripts (*.bench.ts) alone; never the checks.
    include: mode === 'bench' ? ['src/**/*.bench.ts'] : ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src'),
    },
  },
}));
