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
    const retrieved = await db.getPackMeta('test')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.version).toBe('1.0.0')
  })

  it('returns null for non-existent pack', async () => {
    expect(await db.getPackMeta('nonexistent')).toBeNull()
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
    const pack = await db.getPackMeta('x')
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
    expect(await db.getPackMeta('d')).toBeNull()
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
    expect(await db.getPackMeta('old')).toBeNull()
    expect(await db.getPackMeta('new')).not.toBeNull()
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
    const pack = await db.getPackMeta('dungeon-classic')
    expect(Array.from((await db.getFile('dungeon-classic', 'palisade-atlas.webp')) ?? [])).toEqual([1, 2, 3])
    expect(Array.from((await db.getFile('dungeon-classic', 'base.webp')) ?? [])).toEqual([1]) // untouched
    expect(pack?.installedAssetSets).toEqual(expect.arrayContaining(['GG_Fieldstone', 'GG_Palisade']))
    expect(pack?.dynamicAssetSets).toEqual(['GG_Palisade']) // bundle baseline stays non-dynamic
    expect(pack?.assetSetBytes?.GG_Palisade).toBe(3)
    expect(pack?.assetSetFiles?.GG_Palisade).toEqual(['palisade-atlas.webp'])
  })

  it('is a no-op for an uninstalled pack', async () => {
    await db.mergeAssetSetBlobs('nonexistent', new Map([['f', new Uint8Array([1])]]), { X: ['f'] })
    expect(await db.getPackMeta('nonexistent')).toBeNull()
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

  it('evicts the oldest dynamic asset set of a non-bundled pack before a newer whole pack', async () => {
    await db.installPack({
      packId: 'file-pack',
      version: '1.0.0',
      bundleSize: 0,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map([['palisade.webp', new Uint8Array(1000)]]),
      lastUsed: 1000,
      bundled: false,
      installedAssetSets: ['GG_Fieldstone', 'GG_Palisade'],
      dynamicAssetSets: ['GG_Palisade'],
      assetSetBytes: { GG_Palisade: 1000 },
      assetSetFiles: { GG_Palisade: ['palisade.webp'] },
    })
    bumpAssetSetLRU('file-pack', 'GG_Palisade')
    // Force the asset set to look older than any whole-pack candidate below.
    const lru = getAssetSetLRU()
    lru['file-pack:GG_Palisade'] = 1
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
    expect(evicted).toEqual(['file-pack:GG_Palisade'])

    const pack = await db.getPackMeta('file-pack')
    expect(await db.getFile('file-pack', 'palisade.webp')).toBeNull()
    expect(pack?.installedAssetSets).toEqual(['GG_Fieldstone'])
    expect(pack?.dynamicAssetSets).toEqual([])
    expect(getAssetSetLRU()['file-pack:GG_Palisade']).toBeUndefined()
  })

  it('never evicts a bundled pack, dynamic sets included', async () => {
    await db.installPack({
      packId: 'bundled-pack',
      version: '1.0.0',
      bundleSize: 0,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map([['fieldstone.webp', new Uint8Array(1000)]]),
      lastUsed: 1,
      bundled: true,
      installedAssetSets: ['GG_Fieldstone'],
      dynamicAssetSets: ['GG_Fieldstone'],
      assetSetBytes: { GG_Fieldstone: 1000 },
      assetSetFiles: { GG_Fieldstone: ['fieldstone.webp'] },
    })
    const evicted = await db.evictLRU(1_000_000)
    expect(evicted).toEqual([])
    expect(await db.getFile('bundled-pack', 'fieldstone.webp')).not.toBeNull()
    expect((await db.getPackMeta('bundled-pack'))?.installedAssetSets).toEqual(['GG_Fieldstone'])
  })

  it('never evicts the pack being written to', async () => {
    await db.installPack({
      packId: 'target',
      version: '1.0.0',
      bundleSize: 1000,
      manifest: new TextEncoder().encode('').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: 1,
      bundled: false,
    })
    expect(await db.evictLRU(500, 'target')).toEqual([])
  })
})

describe('AssetPackDB — split layout', () => {
  let db: AssetPackDB

  beforeEach(async () => {
    testCounter++
    db = new AssetPackDB(`test-packs-split-${testCounter}`)
    await db.open()
  })

  it('keeps file bytes out of the metadata record', async () => {
    await db.installPack({
      packId: 'p',
      version: '1.0.0',
      bundleSize: 3,
      manifest: new TextEncoder().encode('{}').buffer as ArrayBuffer,
      blobs: new Map([['a.webp', new Uint8Array([1, 2, 3])]]),
      lastUsed: 1,
      bundled: false,
    })
    const meta = await db.getPackMeta('p')
    expect(meta).not.toHaveProperty('blobs')
    expect((await db.getAllPackMeta()).map((m) => m.packId)).toEqual(['p'])
    expect(Array.from((await db.getFile('p', 'a.webp')) ?? [])).toEqual([1, 2, 3])
  })

  it('reads, writes and deletes files by pack', async () => {
    await db.putFiles('p', new Map([['a', new Uint8Array([1])], ['b', new Uint8Array([2])]]))
    await db.putFiles('q', new Map([['a', new Uint8Array([9])]]))
    const got = await db.getFiles('p', ['a', 'b', 'missing'])
    expect([...got.keys()].sort()).toEqual(['a', 'b'])
    await db.deleteFiles('p', ['a'])
    expect(await db.getFile('p', 'a')).toBeNull()
    expect(await db.getFile('q', 'a')).not.toBeNull()
  })

  it('re-installing a pack drops the files the old copy held', async () => {
    const base = {
      packId: 'p', version: '1.0.0', bundleSize: 1, lastUsed: 1, bundled: false,
      manifest: new TextEncoder().encode('{}').buffer as ArrayBuffer,
    }
    await db.installPack({ ...base, blobs: new Map([['old.webp', new Uint8Array([1])]]) })
    await db.installPack({ ...base, blobs: new Map([['new.webp', new Uint8Array([2])]]) })
    expect(await db.getFile('p', 'old.webp')).toBeNull()
    expect(await db.getFile('p', 'new.webp')).not.toBeNull()
  })

  it('deletePack drops the record and only that pack\'s files', async () => {
    const base = { version: '1.0.0', bundleSize: 1, lastUsed: 1, bundled: false, manifest: new ArrayBuffer(0) }
    await db.installPack({ ...base, packId: 'p', blobs: new Map([['a', new Uint8Array([1])]]) })
    await db.installPack({ ...base, packId: 'p2', blobs: new Map([['a', new Uint8Array([1])]]) })
    await db.deletePack('p')
    expect(await db.getPackMeta('p')).toBeNull()
    expect(await db.getFile('p', 'a')).toBeNull()
    expect(await db.getFile('p2', 'a')).not.toBeNull()
  })
})

describe('AssetPackDB — upgrade from v1', () => {
  /** A v1 database as the old build wrote it: one store, files inline on each record. */
  function seedV1(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('packs', { keyPath: 'packId' })
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('packs', 'readwrite')
        tx.objectStore('packs').put({
          packId: 'gg-forge',
          version: '1.0.0',
          bundleSize: 3,
          manifest: new TextEncoder().encode('{}').buffer,
          blobs: { 'a.webp': new Uint8Array([1, 2, 3]) },
          lastUsed: 1,
          bundled: true,
          installedAssetSets: ['GG_Fieldstone'],
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }

  it('creates the files store and drops every v1 record', async () => {
    testCounter++
    const name = `test-packs-upgrade-${testCounter}`
    await seedV1(name)
    const db = new AssetPackDB(name)
    await db.open()
    expect(await db.getAllPackMeta()).toEqual([])
    expect(await db.getPackMeta('gg-forge')).toBeNull()
    // The files store exists and takes writes.
    await db.putFiles('gg-forge', new Map([['a.webp', new Uint8Array([4])]]))
    expect(Array.from((await db.getFile('gg-forge', 'a.webp')) ?? [])).toEqual([4])
  })

  it('closes on versionchange so a newer tab is not blocked', async () => {
    testCounter++
    const name = `test-packs-vc-${testCounter}`
    const db = new AssetPackDB(name)
    await db.open()
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 3)
      req.onblocked = () => reject(new Error('blocked'))
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
    await expect(db.getAllPackMeta()).rejects.toThrow('not open')
  })
})
