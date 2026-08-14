import { defineConfig } from '@playwright/test'
import { DEV_PORT, DEV_URL, SERVER_PORT } from './e2e/ports'

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
    // vite.config.ts defaults to the dev lane (560x); the E2E lane states its own ports so
    // a suite can run while `pnpm dev` is up (docs/2026-08-15-dev-runner-ports-plan.md).
    env: {
      ...process.env,
      E2E_DEV_PORT: String(DEV_PORT),
      E2E_SERVER_PORT: String(SERVER_PORT),
    },
  },
  // One worker: the flow drives a single real server whose invite codes and roster are
  // global state. Parallel specs would join each other's tables.
  workers: 1,
  reporter: 'list',
})
