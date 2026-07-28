import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * The Sprint 2 browser scenarios (`e2e/sprint2-*.spec.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.sprint2.config.ts
 *
 * Its own config rather than a `testMatch` widening, because the two existing configs are
 * exact-filename matches owned by other lanes (`session-flow.spec.ts`, `metrics.spec.ts`)
 * and this lane's fence is `e2e/**`. Fold the three together whenever that stops mattering.
 *
 * Everything else is `playwright.metrics.config.ts`'s setup, for its reasons: a **production
 * build** served by `vite preview` (a timing taken on the dev server measures Vite's module
 * waterfall), `channel: 'chromium'` + ANGLE so the asset-pack install runs on a real GPU
 * stack instead of SwiftShader, and the game server booted by `global-setup.ts` — the only
 * place the first-run admin pass is ever printed.
 */
const GAME_SERVER = 'http://localhost:8787'

export default defineConfig({
  testDir: '.',
  testMatch: /sprint2-.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:5175',
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=default', '--ignore-gpu-blocklist'] },
  },
  timeout: 120_000,
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --port 5175 --strictPort',
    cwd: join(import.meta.dirname, '..'),
    url: 'http://localhost:5175',
    // Locally the build is reused between runs; re-run `pnpm build` after touching src/.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      ...process.env,
      VITE_HTTP_BASE: GAME_SERVER,
      VITE_WS_BASE: `${GAME_SERVER.replace(/^http/, 'ws')}/ws`,
    },
  },
  // One worker: a single real game server whose invite codes and roster are global state.
  workers: 1,
  reporter: 'list',
})
