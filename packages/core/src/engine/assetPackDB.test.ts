import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  AssetPackDB,
  type StoredPack,
  getAssetSetLRU,
  bumpAssetSetLRU,
  removeAssetSetLRU,
} from './assetPackDB'

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

describe('asset-set LRU helpers', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a bump through getAssetSetLRU', () => {
    expect(getAssetSetLRU()).toEqual({})
    bumpAssetSetLRU('dungeon-classic', 'GG_Fieldstone')
    const lru = getAssetSetLRU()
    expect(lru['dungeon-classic:GG_Fieldstone']).toEqual(expect.any(Number))
  })

  it('removeAssetSetLRU drops only the named entry', () => {
    bumpAssetSetLRU('dungeon-classic', 'GG_Fieldstone')
    bumpAssetSetLRU('dungeon-classic', 'GG_Palisade')
    removeAssetSetLRU('dungeon-classic', 'GG_Fieldstone')
    const lru = getAssetSetLRU()
    expect(lru['dungeon-classic:GG_Fieldstone']).toBeUndefined()
    expect(lru['dungeon-classic:GG_Palisade']).toEqual(expect.any(Number))
  })

  it('getAssetSetLRU tolerates corrupt storage', () => {
    localStorage.setItem('asset-set-lru', 'not json{{{')
    expect(getAssetSetLRU()).toEqual({})
  })
})

describe('AssetPackDB.mergeAssetSetBlobs', () => {
  let db: AssetPackDB

  beforeEach(async () => {
    testCounter++
    db = new AssetPackDB(`test-packs-merge-${testCounter}`)
    await db.open()
    localStorage.clear()
    await db.installPack({
      packId: 'dungeon-classic',
      version: '1.0.0',
      bundleSize: 100,
      manifest: new TextEncoder().encode('{}').buffer as ArrayBuffer,
      blobs: new Map([['base.webp', new Uint8Array([1])]]),
      lastUsed: 1000,
      bundled: true,
      installedAssetSets: ['GG_Fieldstone'],
    })
  })

  it('adds the new blobs and marks the set installed + dynamic', async () => {
    await db.mergeAssetSetBlobs(
      'dungeon-classic',
      new Map([['palisade-atlas.webp', new Uint8Array([1, 2, 3])]]),
      { GG_Palisade: ['palisade-atlas.webp'] },
    )
    const pack = await db.getPack('dungeon-classic')
    expect(Array.from(pack?.blobs.get('palisade-atlas.webp') ?? [])).toEqual([1, 2, 3])
    expect(Array.from(pack?.blobs.get('base.webp') ?? [])).toEqual([1]) // untouched
    expect(pack?.installedAssetSets).toEqual(expect.arrayContaining(['GG_Fieldstone', 'GG_Palisade']))
    expect(pack?.dynamicAssetSets).toEqual(['GG_Palisade']) // bundle baseline stays non-dynamic
    expect(pack?.assetSetBytes?.GG_Palisade).toBe(3)
    expect(pack?.assetSetFiles?.GG_Palisade).toEqual(['palisade-atlas.webp'])
  })

  it('is a no-op for an uninstalled pack', async () => {
    await db.mergeAssetSetBlobs('nonexistent', new Map([['f', new Uint8Array([1])]]), { X: ['f'] })
    expect(await db.getPack('nonexistent')).toBeNull()
  })
})

describe('AssetPackDB.getCacheUsage — asset sets', () => {
  let db: AssetPackDB

  beforeEach(async () => {
    testCounter++
    db = new AssetPackDB(`test-packs-usage-${testCounter}`)
    await db.open()
  })

  it('counts only dynamic asset sets of a bundled pack, not the baseline', async () => {
    await db.installPack({
      packId: 'dungeon-classic',
      version: '1.0.0',
      bundleSize: 9_000_000, // baseline size — not counted for bundled packs
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: 1000,
      bundled: true,
      installedAssetSets: ['GG_Fieldstone', 'GG_Palisade'],
      dynamicAssetSets: ['GG_Palisade'],
      assetSetBytes: { GG_Fieldstone: 500_000, GG_Palisade: 300_000 },
    })
    const usage = await db.getCacheUsage()
    expect(usage.used).toBe(300_000) // only the dynamic one
  })
})

describe('AssetPackDB.evictLRU — unified candidates', () => {
  let db: AssetPackDB

  beforeEach(async () => {
    testCounter++
    db = new AssetPackDB(`test-packs-evict-${testCounter}`)
    await db.open()
    localStorage.clear()
  })

  it('evicts the oldest dynamic asset set before a newer whole pack', async () => {
    await db.installPack({
      packId: 'bundled-pack',
      version: '1.0.0',
      bundleSize: 0,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map([['palisade.webp', new Uint8Array(1000)]]),
      lastUsed: 1000,
      bundled: true,
      installedAssetSets: ['GG_Fieldstone', 'GG_Palisade'],
      dynamicAssetSets: ['GG_Palisade'],
      assetSetBytes: { GG_Palisade: 1000 },
      assetSetFiles: { GG_Palisade: ['palisade.webp'] },
    })
    bumpAssetSetLRU('bundled-pack', 'GG_Palisade')
    // Force the asset set to look older than any whole-pack candidate below.
    const lru = getAssetSetLRU()
    lru['bundled-pack:GG_Palisade'] = 1
    localStorage.setItem('asset-set-lru', JSON.stringify(lru))

    await db.installPack({
      packId: 'newer-whole-pack',
      version: '1.0.0',
      bundleSize: 1000,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: 9999,
      bundled: false,
    })

    const evicted = await db.evictLRU(500)
    expect(evicted).toEqual(['bundled-pack:GG_Palisade'])

    const pack = await db.getPack('bundled-pack')
    expect(pack?.blobs.has('palisade.webp')).toBe(false)
    expect(pack?.installedAssetSets).toEqual(['GG_Fieldstone'])
    expect(pack?.dynamicAssetSets).toEqual([])
    expect(getAssetSetLRU()['bundled-pack:GG_Palisade']).toBeUndefined()
  })

  it('never evicts the bundle-baseline set (not in dynamicAssetSets)', async () => {
    await db.installPack({
      packId: 'bundled-pack',
      version: '1.0.0',
      bundleSize: 0,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map([['fieldstone.webp', new Uint8Array(1000)]]),
      lastUsed: 1000,
      bundled: true,
      installedAssetSets: ['GG_Fieldstone'], // baseline — no dynamicAssetSets entry
      assetSetBytes: { GG_Fieldstone: 1000 },
      assetSetFiles: { GG_Fieldstone: ['fieldstone.webp'] },
    })
    const evicted = await db.evictLRU(1_000_000)
    expect(evicted).toEqual([]) // nothing evictable — baseline is off-limits
    const pack = await db.getPack('bundled-pack')
    expect(pack?.blobs.has('fieldstone.webp')).toBe(true)
  })
})
