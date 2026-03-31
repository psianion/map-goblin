import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { AssetPackDB, type StoredPack } from './assetPackDB'

let testCounter = 0

describe('AssetPackDB', () => {
  let db: AssetPackDB

  beforeEach(async () => {
    // Use unique DB name per test to avoid fake-indexeddb shared state
    testCounter++
    db = new AssetPackDB(`test-packs-${testCounter}`)
    await db.open()
  })

  it('stores and retrieves a pack atomically', async () => {
    const pack: StoredPack = {
      packId: 'test',
      version: '1.0.0',
      bundleSize: 1000,
      manifest: new TextEncoder().encode('{}').buffer as ArrayBuffer,
      blobs: new Map([['atlas.webp', new Uint8Array([1, 2, 3])]]),
      lastUsed: Date.now(),
      bundled: false,
    }
    await db.installPack(pack)
    const retrieved = await db.getPack('test')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.version).toBe('1.0.0')
  })

  it('returns null for non-existent pack', async () => {
    expect(await db.getPack('nonexistent')).toBeNull()
  })

  it('overwrites pack on re-install', async () => {
    const v1: StoredPack = {
      packId: 'x',
      version: '1.0.0',
      bundleSize: 500,
      manifest: new TextEncoder().encode('v1').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: Date.now(),
      bundled: false,
    }
    const v2: StoredPack = {
      packId: 'x',
      version: '2.0.0',
      bundleSize: 500,
      manifest: new TextEncoder().encode('v2').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: Date.now(),
      bundled: false,
    }
    await db.installPack(v1)
    await db.installPack(v2)
    const pack = await db.getPack('x')
    expect(pack?.version).toBe('2.0.0')
  })

  it('deletes a pack', async () => {
    await db.installPack({
      packId: 'd',
      version: '1.0.0',
      bundleSize: 100,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: Date.now(),
      bundled: false,
    })
    await db.deletePack('d')
    expect(await db.getPack('d')).toBeNull()
  })

  it('getCacheUsage sums non-bundled pack sizes', async () => {
    await db.installPack({
      packId: 'a',
      version: '1.0.0',
      bundleSize: 1000,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: Date.now(),
      bundled: false,
    })
    await db.installPack({
      packId: 'b',
      version: '1.0.0',
      bundleSize: 2000,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: Date.now(),
      bundled: true,
    })
    const usage = await db.getCacheUsage()
    expect(usage.used).toBe(1000) // bundled excluded
  })

  it('evictLRU removes least recently used non-bundled pack', async () => {
    await db.installPack({
      packId: 'old',
      version: '1.0.0',
      bundleSize: 1000,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: 1000,
      bundled: false,
    })
    await db.installPack({
      packId: 'new',
      version: '1.0.0',
      bundleSize: 1000,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: 9999,
      bundled: false,
    })
    const evicted = await db.evictLRU(500)
    expect(evicted).toContain('old')
    expect(await db.getPack('old')).toBeNull()
    expect(await db.getPack('new')).not.toBeNull()
  })
})
