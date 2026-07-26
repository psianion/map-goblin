import { defineConfig } from '@playwright/test'

// The game server is started by globalSetup (it has to read the admin pass off stdout);
// only the Vite dev server is a `webServer` here. Its proxy points /api and /ws at :8787,
// so both processes have to agree on that port — see vite.config.ts.
export default defineConfig({
  testDir: './e2e',
  // The timed metrics live in `metrics.spec.ts` and run under playwright.metrics.config.ts
  // instead: dev-server timings measure Vite's module waterfall, not the app.
  testMatch: 'session-flow.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5174' },
  // First boot installs the ~8MB bundled asset pack into a cold IndexedDB, per context,
  // before the engine will render anything. 30s is not enough on a cold cache.
  timeout: 120_000,
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  // One worker: the flow drives a single real server whose invite codes and roster are
  // global state. Parallel specs would join each other's tables.
  workers: 1,
  reporter: 'list',
})
