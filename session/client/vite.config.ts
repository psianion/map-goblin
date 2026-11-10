import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vendor and workspace code in chunks of their own, so an app release does not
 * invalidate Pixi or React in the browser cache. Matched on the module path: @dnd/core
 * ships as source and is imported by deep path. Same rules as canvas/vite.config.ts,
 * which explains why `core` holds only the core modules that do not reach Pixi.
 */
const PIXI_PATH = /\/node_modules\/(pixi\.js|@pixi)\//
type ModuleInfoOf = (id: string) => { importedIds: readonly string[] } | null
const pullsPixi = new Map<string, boolean>()

function walk(id: string, info: ModuleInfoOf, seen: Set<string>): boolean {
  const known = pullsPixi.get(id)
  if (known !== undefined) return known
  if (seen.has(id)) return false
  seen.add(id)
  const hit = PIXI_PATH.test(id.replace(/\\/g, '/')) || (info(id)?.importedIds ?? []).some((n) => walk(n, info, seen))
  // A false found mid-walk may hang on a cycle still open; only a hit is certain.
  if (hit) pullsPixi.set(id, true)
  return hit
}

function reachesPixi(id: string, info: ModuleInfoOf): boolean {
  const hit = walk(id, info, new Set())
  pullsPixi.set(id, hit)
  return hit
}

function manualChunks(id: string, { getModuleInfo }: { getModuleInfo: ModuleInfoOf }): string | undefined {
  const p = id.replace(/\\/g, '/')
  if (PIXI_PATH.test(p)) return 'pixi'
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(p)) return 'react'
  if (p.includes('/packages/ui/') || /\/node_modules\/(@base-ui|lucide-react|sonner)\//.test(p)) return 'ui'
  if (p.includes('/packages/core/') && !reachesPixi(id, getModuleInfo)) return 'core'
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks } },
  },
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
