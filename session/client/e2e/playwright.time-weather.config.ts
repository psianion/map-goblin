import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, viteApiEnv } from './ports'

/**
 * The M5 time-weather flagship (`e2e/time-weather.spec.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.time-weather.config.ts
 *
 * Its own config for the reason sprint2/sprint3/doors/publish/triggers all have theirs: every
 * other config is an exact-filename match owned by another lane, and widening one would drag
 * its specs into this run.
 *
 * An exact filename, not a `/time-weather.*\.spec\.ts/` pattern — see
 * `playwright.triggers.config.ts`'s own note: this worktree's directory name substring-matches
 * an unanchored regex across every spec file's absolute path here, so a widened pattern would
 * pull in specs this lane does not own.
 *
 * Same setup as those: a production build served by `vite preview`, `channel: 'chromium'` +
 * ANGLE so the canvas stays on a real GPU stack rather than SwiftShader, and the game server
 * booted by `global-setup.ts` — the only place the first-run admin pass is ever printed.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'time-weather.spec.ts',
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
