import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, viteApiEnv } from './ports'

/**
 * The Sprint 3 browser scenarios (`e2e/sprint3-fog.spec.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.sprint3.config.ts
 *
 * Its own config for the same reason sprint 2 has one: the other configs are exact-filename
 * matches owned by other lanes, and widening one would drag its specs into this run.
 *
 * Everything else is `playwright.metrics.config.ts`'s setup, for its reasons: a **production
 * build** served by `vite preview` (a timing taken on the dev server measures Vite's module
 * waterfall), `channel: 'chromium'` + ANGLE so the render metrics run on a real GPU stack
 * instead of SwiftShader, and the game server booted by `global-setup.ts` — the only place
 * the first-run admin pass is ever printed.
 *
 * The timeout is the outlier: this spec reloads a player mid-session and screenshots a
 * 1280x720 canvas a dozen times on the dressed map, on top of the asset-pack install every
 * cold context pays.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /sprint3-.*\.spec\.ts/,
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
