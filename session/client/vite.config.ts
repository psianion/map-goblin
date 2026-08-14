import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // ponytail: the renderer resolves floor/wall textures from the bundled asset
  // pack, which @dnd/core hardcodes to `/packs/…`. Serving canvas's public dir
  // is one line instead of a copy step. Point this at the game server's
  // `assetBase` the day it hosts packs itself.
  publicDir: path.resolve(__dirname, '../../canvas/public'),
  server: {
    // Defaults are the dev lane (table 5602, server 5600 — see
    // docs/2026-08-15-dev-runner-ports-plan.md). The E2E harness runs on its own 561x lane
    // and states its ports explicitly via `webServer.env` in playwright.config.ts, so the
    // lanes never collide and both can run at once.
    port: Number(process.env.E2E_DEV_PORT ?? 5602),
    strictPort: true,
    // A player opening `/join/CODE` never types a server address — the whole point of the
    // link — so `endpoints` falls back to `window.location.origin`, which in dev is this
    // dev server. Proxying makes that origin answer for the game server too, which is also
    // how the deployed build will look (one origin, a reverse proxy in front). The DM's
    // typed-in address still bypasses this via `setServerUrl` (CORS is open, see http.ts).
    proxy: {
      '/api': `http://localhost:${process.env.E2E_SERVER_PORT ?? 5600}`,
      '/ws': { target: `ws://localhost:${process.env.E2E_SERVER_PORT ?? 5600}`, ws: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
