// Throughput of tier 2 and tier 3 with the network out of the way: fetch answers at once
// from the shipped packs (read into memory up front), IndexedDB is fake-indexeddb, a decode
// takes a few milliseconds. What is left is the manager's own work per file.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAssetPackManager, resetAssetPackManager } from './assetPackInstance'
import { bootAssets, resetBootAssets } from './boot'
import { ensureMapAssets, installLibrary } from './firstBootInstall'
import { collectMapTextureIds, type MapTextureSource } from './mapTextureRefs'

vi.mock('pixi.js', () => {
  class MockSpritesheet {
    textures: Record<string, unknown> = {}
    constructor(_base: unknown, data: { frames?: Record<string, unknown> }) {
      for (const id of Object.keys(data.frames ?? {})) this.textures[id] = { width: 32, height: 32 }
    }
    async parse(): Promise<Record<string, unknown>> {
      return this.textures
    }
  }
  return {
    Assets: {
      // An image decode: async, off the main thread, so it costs this code one task each.
      load: vi.fn(() => new Promise((r) => setImmediate(() => r({ width: 64, height: 64 })))),
      unload: vi.fn(async () => {}),
    },
    Spritesheet: MockSpritesheet,
    Texture: { from: vi.fn(() => ({ width: 1, height: 1 })) },
  }
})

const PACKS_DIR = resolve(process.cwd(), '../../canvas/public/packs') + '/'
const bodies = new Map<string, Buffer>()
for (const rel of ['index.json']) bodies.set(rel, readFileSync(PACKS_DIR + rel))
for (const pack of ['gg-forge', 'gg-demo']) {
  for (const f of readdirSync(PACKS_DIR + pack)) bodies.set(`${pack}/${f}`, readFileSync(`${PACKS_DIR}${pack}/${f}`))
}

function serveFromMemory(): string[] {
  const fetched: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const rel = url.replace(/^\/packs\//, '')
      const body = bodies.get(rel)
      if (!body) return { ok: false, status: 404 } as Response
      if (rel.endsWith('.webp') || /atlas-.*\.json$/.test(rel)) fetched.push(rel)
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(body.toString()),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as Response
    }),
  )
  return fetched
}

/** Timings go to PERF_LOG when set (the runner hides console output). */
function report(line: string): void {
  if (process.env.PERF_LOG) appendFileSync(process.env.PERF_LOG, `${line}\n`)
}

function warren(): MapTextureSource {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata/goblin-warren.mapbuilder'), 'utf8'))
}

beforeEach(async () => {
  // Resolve the mocked module once up front: concurrent first imports of a mocked module
  // can each start their own resolution, and one that gets real Pixi never decodes in jsdom.
  await import('pixi.js')
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  resetAssetPackManager()
  resetBootAssets()
  URL.createObjectURL = vi.fn(() => 'blob:perf')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAssetPackManager()
})

describe('download throughput', () => {
  it("the Warren's files land, decoded, in well under a second", { timeout: 60_000 }, async () => {
    const fetched = serveFromMemory()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    const ids = collectMapTextureIds(warren())
    // The renderer asks for every texture as the map builds, before any file is there.
    const packIds = ids.filter((id) => id.includes(':'))
    const waits = packIds.map((id) => pm.waitForTexture(id, 10_000))
    // Meanwhile the renderer re-resolves every texture on each rebuild, a frame apart.
    const frames = setInterval(() => {
      for (const id of packIds) pm.getTextureOrNull(id)
    }, 16)
    let events = 0
    const t = performance.now()
    await ensureMapAssets(pm, ids, () => events++)
    await Promise.all(waits)
    const ms = performance.now() - t
    clearInterval(frames)
    report(`warren: ${fetched.length} files, ${events} progress events, ${ms.toFixed(0)} ms`)
    expect(fetched).toHaveLength(86)
    expect(ms).toBeLessThan(300)
  })

  it('the library lands 400 files in under two seconds', { timeout: 60_000 }, async () => {
    const fetched = serveFromMemory()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    const t = performance.now()
    const ctrl = new AbortController()
    // The Packs sheet re-reads set status as progress arrives.
    await installLibrary(pm, ['gg-forge', 'gg-demo'], () => {
      pm.getAssetSetStatus('gg-demo')
      if (fetched.length >= 400) ctrl.abort()
    }, ctrl.signal)
    const ms = performance.now() - t
    report(`library: ${fetched.length} files, ${ms.toFixed(0)} ms`)
    expect(fetched.length).toBeGreaterThanOrEqual(400)
    expect(ms).toBeLessThan(2_000)
  })
})
