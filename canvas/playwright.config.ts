import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Playwright's default is 30s, which is less than the boot this suite legitimately
  // waits out: `gotoApp` allows 60s for Vite's cold compile plus 60s for the engine
  // (see CLIPPER_TIMEOUT / ENGINE_TIMEOUT in tests/e2e/helpers.ts). The default killed
  // the test before its own wait could succeed, so a cold multi-worker start failed
  // tests that pass fine serially once the server is warm. 180s = that 120s worst-case
  // boot plus a minute of test body.
  timeout: 180_000,
  use: { baseURL: 'http://localhost:5175' },
  webServer: {
    command: 'pnpm dev --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: true,
  },
  reporter: 'list',
})
