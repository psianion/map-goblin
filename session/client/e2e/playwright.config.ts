import { defineConfig } from '@playwright/test'
import { DEV_PORT, DEV_URL, SERVER_PORT } from './ports'

// The table's one Playwright config (plan section 7). One spec file per scope, tagged:
// @shell, @host, @publish, @map, @play, @story, @scenes, @player. Run a scope with
// `pnpm e2e --grep @map`. The game server is started by globalSetup (it reads the admin pass
// off stdout); the Vite dev server is the `webServer`, proxying /api and /ws to it.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  use: { baseURL: DEV_URL },
  // First boot installs the bundled asset pack into a cold IndexedDB, per context.
  timeout: 120_000,
  webServer: {
    command: 'pnpm dev',
    cwd: '..',
    url: DEV_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      ...process.env,
      E2E_DEV_PORT: String(DEV_PORT),
      E2E_SERVER_PORT: String(SERVER_PORT),
    },
  },
  // One worker: every spec drives the one real server, whose codes and rosters are global.
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
})
