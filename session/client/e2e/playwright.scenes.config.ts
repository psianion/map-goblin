import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, viteApiEnv } from './ports'

/**
 * The scene-switch lane (`e2e/scene-switch.spec.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.scenes.config.ts
 *
 * Same setup as `playwright.sprint2.config.ts`, for its reasons: production build via
 * `vite preview` (the F1 blank-frame sampler must measure the build players run, and
 * `__testProbe` exists in both), real GPU stack, game server from `global-setup.ts`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /scene-switch\.spec\.ts/,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: CLIENT_URL,
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=default', '--ignore-gpu-blocklist'] },
  },
  timeout: 120_000,
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${CLIENT_PORT} --strictPort`,
    cwd: join(import.meta.dirname, '..'),
    url: CLIENT_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { ...process.env, ...viteApiEnv() },
  },
  workers: 1,
  reporter: 'list',
})
