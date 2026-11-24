import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

/**
 * The tests held to a wall-clock budget, or waiting on timers that load can starve. They run
 * after the rest, one file at a time in a single worker, so no other test competes with them.
 */
const TIMED = [
  'src/engine/assetLoading.perf.test.ts',
  'src/engine/assetLoading.test.ts',
  'src/engine/caveWork.test.ts',
  'src/engine/softMask.test.ts',
  'src/engine/subscribeToStore.test.ts',
  'src/engine/tools/scatter.test.ts',
  'src/engine/tools/SelectTool.selection.test.ts',
  'src/engine/tools/StampScatterTool.test.ts',
];

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'jsdom',
    // `vitest run --mode bench` runs the timing scripts (*.bench.ts) alone; never the checks.
    ...(mode === 'bench'
      ? { include: ['src/**/*.bench.ts'] }
      : {
          projects: [
            {
              extends: true,
              test: { name: 'unit', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], exclude: [...configDefaults.exclude, ...TIMED], sequence: { groupOrder: 0 } },
            },
            {
              extends: true,
              test: { name: 'timed', include: TIMED, fileParallelism: false, sequence: { groupOrder: 1 } },
            },
          ],
        }),
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src'),
    },
  },
}));
