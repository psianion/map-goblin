import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, viteApiEnv } from './ports'

/**
 * The M4 triggers flagship (`e2e/triggers-flagship.spec.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.triggers.config.ts
 *
 * Its own config for the reason sprint2/sprint3/doors/publish all have theirs: every other
 * config is an exact-filename match owned by another lane, and widening one would drag its
 * specs into this run.
 *
 * An exact filename, not a `/triggers-.*\.spec\.ts/` pattern: this worktree's own directory is
 * `triggers-runtime`, and an unanchored regex matches that substring in *every* spec file's
 * absolute path here — `.*` then reaches any file's trailing `.spec.ts` and the "own lane"
 * config runs the whole suite (`doors-flagship.spec.ts` included). `playwright.publish.config.ts`
 * hit the identical trap for `publish-library` and fixed it the same way: one file, so the
 * exact-filename form sidesteps path anchoring instead of fighting it.
 *
 * Same setup as those: a production build served by `vite preview`, `channel: 'chromium'` +
 * ANGLE so the canvas stays on a real GPU stack rather than SwiftShader, and the game server
 * booted by `global-setup.ts` — the only place the first-run admin pass is ever printed.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'triggers-flagship.spec.ts',
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
