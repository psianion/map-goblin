import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vendor and workspace code in chunks of their own, so an app release does not
 * invalidate Pixi or React in the browser cache. Matched on the module path: @dnd/core
 * ships as source and is imported by deep path. `scripts/bundle-report.mjs` checks the
 * result (the home screen must load without `pixi`).
 *
 * `core` holds only the core modules that do not import Pixi, statically and
 * transitively: one chunk with the renderer in it would import `pixi` on every page. The
 * rest of core goes where Rollup puts it, next to the lazy editor.
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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Dev lane: canvas 5601, game server 5600 (docs/2026-08-15-dev-runner-ports-plan.md).
    // strictPort because ports mean things in that scheme — a silent bump would leave the
    // proxy pointing somewhere a different app answers.
    port: Number(process.env.CANVAS_PORT ?? 5601),
    strictPort: true,
    // Same-origin `/api/...` in dev too — prod nginx does this for real.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:5600',
        changeOrigin: true,
      },
    },
  },
})
