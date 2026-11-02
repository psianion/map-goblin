import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, GPU_ARGS, viteApiEnv } from './ports'

/**
 * Paths at the table (`e2e/paths-table.spec.ts`): a map with an overhead plank bridge,
 * published over REST and drawn on a DM's and a player's seat, the bridge above the tokens
 * and fading for a token standing under it.
 *
 *   pnpm exec playwright test -c e2e/playwright.paths.config.ts
 *
 * Same setup as the props lane: a production build served by `vite preview`, Chromium on
 * ANGLE, and the game server booted by `global-setup.ts` on a clean data directory.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'paths-table.spec.ts',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: CLIENT_URL,
    channel: 'chromium',
    launchOptions: { args: GPU_ARGS },
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
