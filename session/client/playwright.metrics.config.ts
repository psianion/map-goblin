import { defineConfig } from '@playwright/test'
import { CLIENT_PORT, CLIENT_URL, viteApiEnv } from './e2e/ports'

/**
 * The Sprint 1 timed metrics (`e2e/metrics.spec.ts`), run against a **production build**.
 *
 * I1's instrumented run measured 89.6s from link to rendered player map on `pnpm dev`. That
 * is Vite's dev module waterfall and its on-demand optimize pass, not the app: a number
 * taken there measures the bundler. So this config builds and serves `dist/` through
 * `vite preview`, and `playwright.config.ts` keeps the dev-server flow spec exactly as I1
 * left it (the two configs split by `testMatch`).
 *
 * `vite preview` has no dev proxy, so instead of teaching it one the bundle is built with
 * `VITE_HTTP_BASE`/`VITE_WS_BASE` pointed straight at the game server — the D9 seam
 * `endpoints.ts` already exposes for exactly this (a deployment where the API is not the
 * origin). Server CORS is open, so the cross-origin fetch is the same fetch.
 *
 * Both ports come from `e2e/ports.ts` — the E2E lane of the 56xx scheme, overridable via
 * the same env vars.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'metrics.spec.ts',
  // Same real game-server boot as the flow spec: it is the only place the admin pass exists.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: CLIENT_URL,
    // `channel: 'chromium'` is the full browser (headless=new), not Playwright's default
    // headless *shell* — the shell has no GPU stack at all and falls back to SwiftShader.
    // That is not a detail: installing the bundled asset pack uploads 94 textures, which
    // costs 3.9s on a GPU and 35.3s on the software rasterizer. Measured on the shell,
    // every render metric here is a measurement of SwiftShader.
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=default', '--ignore-gpu-blocklist'] },
  },
  timeout: 120_000,
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${CLIENT_PORT} --strictPort`,
    url: CLIENT_URL,
    // Locally the build is reused between runs; re-run `pnpm build` after touching src/.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { ...process.env, ...viteApiEnv() },
  },
  // One worker: a single real server whose invite codes and roster are global state.
  workers: 1,
  reporter: 'list',
})
