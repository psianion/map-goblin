import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, viteApiEnv } from './ports'

/**
 * The door-overhaul table scenarios (`e2e/doors-table.spec.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.doors.config.ts
 *
 * Its own config for the same reason sprint 2 and sprint 3 have theirs: every other
 * config is an exact-filename match owned by another lane, and widening one would drag
 * its specs into this run.
 *
 * The setup is sprint 3's, for sprint 3's reasons: a production build served by
 * `vite preview`, `channel: 'chromium'` + ANGLE so the canvas rows run on a real GPU
 * stack rather than SwiftShader, and the game server booted by `global-setup.ts` — the
 * only place the first-run admin pass is printed.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /doors-.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: CLIENT_URL,
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=default', '--ignore-gpu-blocklist'] },
  },
  timeout: 240_000,
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${CLIENT_PORT} --strictPort`,
    cwd: join(import.meta.dirname, '..'),
    url: CLIENT_URL,
    // Locally the build is reused between runs; re-run `pnpm build` after touching src/.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { ...process.env, ...viteApiEnv() },
  },
  // One worker: a single real game server whose invite codes and roster are global state.
  workers: 1,
  reporter: 'list',
})
