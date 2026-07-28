import { defineConfig } from '@playwright/test'
import { DEV_URL } from './e2e/ports'

// The game server is started by globalSetup (it has to read the admin pass off stdout);
// only the Vite dev server is a `webServer` here. Its proxy points /api and /ws at the game
// server's port, so both processes have to agree on it — `e2e/ports.ts` is where they do,
// and `vite.config.ts` reads the same variables.
export default defineConfig({
  testDir: './e2e',
  // The timed metrics live in `metrics.spec.ts` and run under playwright.metrics.config.ts
  // instead: dev-server timings measure Vite's module waterfall, not the app.
  testMatch: 'session-flow.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: DEV_URL },
  // First boot installs the ~8MB bundled asset pack into a cold IndexedDB, per context,
  // before the engine will render anything. 30s is not enough on a cold cache.
  timeout: 120_000,
  webServer: {
    command: 'pnpm dev',
    url: DEV_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  // One worker: the flow drives a single real server whose invite codes and roster are
  // global state. Parallel specs would join each other's tables.
  workers: 1,
  reporter: 'list',
})
