import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AssetPackManager } from './assetPackManager'
import type { AssetPackDB, StoredPack } from './assetPackDB'
import { getAssetSetLRU } from './assetPackDB'
import type { PackManifest, ManifestEntry } from './assetPackManager'
import type { MapTextureSource } from './mapTextureRefs'

// ensureAssetSets/ensureTexturesForMap exercise loadPackTextures with real file
// content — under jsdom, real PIXI.Assets.load() never resolves for a blob: URL
// (no image decode backend), so it hangs rather than fails. Mocked the same way
// other engine tests already mock pixi.js for exactly this reason.
vi.mock('pixi.js', () => {
  class MockSpritesheet {
    textures: Record<string, unknown> = {}
    constructor(_baseTexture: unknown, _data: unknown) {}
    async parse(): Promise<Record<string, unknown>> {
      return this.textures
    }
  }
  return {
    Assets: {
      load: vi.fn(() => Promise.resolve({})),
      unload: vi.fn(() => Promise.resolve()),
    },
    Spritesheet: MockSpritesheet,
    Texture: { from: vi.fn(() => ({})) },
  }
})

describe('AssetPackManager', () => {
  let manager: AssetPackManager

  beforeEach(() => {
    manager = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
  })

  it('starts with no installed packs', () => {
    expect(manager.getInstalledPacks()).toEqual([])
  })

  it('getTextureOrNull returns null for unknown entry', () => {
    expect(manager.getTextureOrNull('nonexistent')).toBeNull()
  })

  it('getFrame returns null for unknown entry', () => {
    expect(manager.getFrame('nonexistent')).toBeNull()
  })

  it('rejects when hourly rate limit exceeded', async () => {
    // Fill up the rate limit timestamps
    for (let i = 0; i < 10; i++) {
      manager['installTimestamps'].push(Date.now())
    }
    await expect(manager.installPack('test')).rejects.toThrow('Rate limit')
  })

  it('rejects on checksum mismatch', async () => {
    // Mock fetch to return a manifest and tampered data
    const manifest = {
      name: 'Test Pack',
      description: 'A test pack',
      version: '1.0.0',
      bundleSize: 100,
      entries: {},
      atlases: {},
      files: {
        'data.bin': { checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', size: 3 },
      },
      themes: ['dungeon'],
    }

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('pack.json')) {
        return { ok: true, json: async () => manifest } as Response
      }
      if (url.includes('data.bin')) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', mockFetch)
    // Mock crypto.subtle.digest
    vi.stubGlobal('crypto', {
      subtle: {
        digest: async () => new Uint8Array(32).buffer, // all zeros won't match
      },
    })

    // The SHA-256 of [1,2,3] won't match the all-zeros checksum
    // But our mock returns all-zeros hash, and checksum is all-zeros, so it would match.
    // Let's make the checksum something else:
    const badManifest = {
      ...manifest,
      files: {
        'data.bin': { checksum: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', size: 3 },
      },
    }
    const mockFetch2 = vi.fn(async (url: string) => {
      if (url.includes('pack.json')) {
        return { ok: true, json: async () => badManifest } as Response
      }
      if (url.includes('data.bin')) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', mockFetch2)

    await expect(manager.installPack('test-pack')).rejects.toThrow('Checksum mismatch')

    vi.unstubAllGlobals()
  })

  it('getCacheUsage returns defaults', () => {
    const usage = manager.getCacheUsage()
    expect(usage.used).toBe(0)
    expect(usage.limit).toBe(200 * 1024 * 1024)
  })

  it('clearCache empties all maps', () => {
    manager['installedPacks'].set('test', {
      packId: 'test',
      version: '1.0.0',
      entryCount: 1,
      themes: [],
      bundleSize: 100,
    })
    manager.clearCache()
    expect(manager.getInstalledPacks()).toEqual([])
  })
})

function createMockDB(packs: StoredPack[]): AssetPackDB {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    getAllPacks: vi.fn().mockResolvedValue(packs),
    getPack: vi.fn().mockResolvedValue(null),
    installPack: vi.fn().mockResolvedValue(undefined),
    deletePack: vi.fn().mockResolvedValue(undefined),
    getCacheUsage: vi.fn().mockResolvedValue({ used: 0, limit: 200 * 1024 * 1024 }),
    evictLRU: vi.fn().mockResolvedValue([]),
    mergeAssetSetBlobs: vi.fn().mockResolvedValue(undefined),
  } as unknown as AssetPackDB
}

function makeStoredPack(packId: string, version: string): StoredPack {
  const manifest = {
    name: packId,
    description: 'test',
    version,
    bundleSize: 100,
    entries: { 'test-entry': { type: 'floor', localId: 'test-entry', atlas: 'a.json', frame: 'test-entry', gridSize: '1x1', tags: [] } },
    atlases: {},
    files: {},
    themes: ['dungeon'],
  }
  return {
    packId,
    version,
    bundleSize: 100,
    manifest: new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer,
    blobs: new Map(),
    lastUsed: Date.now(),
    bundled: false,
  }
}

describe('AssetPackManager.rehydrate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('completes with 0 packs in DB', async () => {
    const db = createMockDB([])
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    await mgr.rehydrate()
    expect(mgr.getInstalledPacks()).toEqual([])
  })

  it('restores installed packs from DB', async () => {
    const packs = [makeStoredPack('pack-a', '1.0.0'), makeStoredPack('pack-b', '2.0.0')]
    const db = createMockDB(packs)
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    await mgr.rehydrate()
    expect(mgr.getInstalledPacks()).toHaveLength(2)
    expect(mgr.getInstalledPacks().map((p) => p.packId).sort()).toEqual(['pack-a', 'pack-b'])
  })

  it('continues rehydrating if one pack is corrupt', async () => {
    const good = makeStoredPack('good-pack', '1.0.0')
    const corrupt: StoredPack = {
      packId: 'bad-pack',
      version: '1.0.0',
      bundleSize: 100,
      manifest: new TextEncoder().encode('NOT VALID JSON{{{').buffer as ArrayBuffer,
      blobs: new Map(),
      lastUsed: Date.now(),
      bundled: false,
    }
    const db = createMockDB([corrupt, good])
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mgr.rehydrate()
    expect(mgr.getInstalledPacks()).toHaveLength(1)
    expect(mgr.getInstalledPacks()[0]!.packId).toBe('good-pack')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to rehydrate pack "bad-pack"'),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it('skips rehydration when no packDB configured', async () => {
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    await mgr.rehydrate()
    expect(mgr.getInstalledPacks()).toEqual([])
  })
})

describe('AssetPackManager.resolveManifestPath', () => {
  afterEach(() => vi.unstubAllGlobals())

  // `pack-builder index` writes CDN-root-relative paths ("<pack>/pack-<hash>.json") so
  // one file describes where everything lives. Callers append it to `<base>/<packId>/`,
  // so leaving the directory on produced /packs/dungeon-classic/dungeon-classic/... — a
  // 404 that only shows up against a real generated index, never against a stub with
  // `manifest: ''`.
  it('strips the pack directory from a root-relative index path', async () => {
    const index = {
      packs: {
        'dungeon-classic': {
          version: '1.2.0', bundleSize: 8340158, entryCount: 167, themes: ['dungeon'],
          preview: 'dungeon-classic/preview-9e0e45e5.webp',
          manifest: 'dungeon-classic/pack-4a9bdbee.json',
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => index }))

    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    expect(await mgr['resolveManifestPath']('dungeon-classic')).toBe('pack-4a9bdbee.json')
  })

  it('passes through a bare filename unchanged', async () => {
    const index = { packs: { 'test-pack': { version: '1.0.0', bundleSize: 1, entryCount: 1, themes: [], preview: '', manifest: 'pack-abc123.json' } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => index }))

    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    expect(await mgr['resolveManifestPath']('test-pack')).toBe('pack-abc123.json')
  })
})

describe('AssetPackManager.checkForUpdates', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns empty array when CDN is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    const updates = await mgr.checkForUpdates()
    expect(updates).toEqual([])
  })

  it('detects newer version available', async () => {
    const index = { packs: { 'test-pack': { version: '2.0.0', bundleSize: 200, entryCount: 5, themes: [], preview: '', manifest: '' } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => index }))
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })

    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    mgr['installedPacks'].set('test-pack', { packId: 'test-pack', version: '1.0.0', entryCount: 3, themes: [], bundleSize: 100 })
    const updates = await mgr.checkForUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({ packId: 'test-pack', currentVersion: '1.0.0', availableVersion: '2.0.0' })
  })

  it('returns empty when all packs are up-to-date', async () => {
    const index = { packs: { 'test-pack': { version: '1.0.0', bundleSize: 100, entryCount: 3, themes: [], preview: '', manifest: '' } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => index }))
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })

    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    mgr['installedPacks'].set('test-pack', { packId: 'test-pack', version: '1.0.0', entryCount: 3, themes: [], bundleSize: 100 })
    const updates = await mgr.checkForUpdates()
    expect(updates).toEqual([])
  })

  it('says so when the index answers with an error status', async () => {
    // A 503 on /packs/index.json used to return [] exactly like "no updates",
    // so a deployed build could fail this check on every load and never once
    // mention it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, headers: { get: () => null } }))
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })

    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    expect(await mgr.checkForUpdates()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('503'))
    warn.mockRestore()
  })

  it('says so when the index cannot be reached at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })

    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    expect(await mgr.checkForUpdates()).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unreachable'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('returns empty on 304 Not Modified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 304, headers: { get: () => null } }))
    vi.stubGlobal('localStorage', { getItem: () => '"etag-123"', setItem: () => {} })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    const updates = await mgr.checkForUpdates()
    expect(updates).toEqual([])
  })
})

// ─── Asset sets ──────────────────────────────────────────────────────

function wallEntry(id: string, material: string, gridSize: string, set?: string): ManifestEntry {
  return {
    type: 'wall',
    localId: id,
    atlas: '',
    frame: id,
    gridSize,
    tags: [],
    set,
    material,
    variant: 'A',
  } as ManifestEntry
}

const ZERO_HASH = '0'.repeat(64)

/** A manifest with two set-tagged wall families (loose files, no atlas) plus one setless base entry. */
function makeSetManifest(): PackManifest {
  return {
    name: 'dungeon-classic',
    description: 'test',
    version: '1.0.0',
    bundleSize: 0,
    entries: {
      GG_Fieldstone_Straight_3x1_A_3x1_wall_A: wallEntry(
        'GG_Fieldstone_Straight_3x1_A_3x1_wall_A', 'GG_Fieldstone_Straight_3x1_A', '3x1', 'GG_Fieldstone',
      ),
      GG_Palisade_Straight_3x1_A_3x1_wall_A: wallEntry(
        'GG_Palisade_Straight_3x1_A_3x1_wall_A', 'GG_Palisade_Straight_3x1_A', '3x1', 'GG_Palisade',
      ),
      'stone-slate_1x1_floor_A': wallEntry('stone-slate_1x1_floor_A', 'stone-slate', '1x1', undefined),
    },
    atlases: {},
    files: {
      'GG_Fieldstone_Straight_3x1_A_3x1_A-hash1.webp': { checksum: `sha256:${ZERO_HASH}`, size: 3 },
      'GG_Palisade_Straight_3x1_A_3x1_A-hash2.webp': { checksum: `sha256:${ZERO_HASH}`, size: 3 },
      'stone-slate_1x1_A-hash3.webp': { checksum: `sha256:${ZERO_HASH}`, size: 3 },
    },
    themes: ['dungeon'],
  }
}

function stubZeroDigest(): void {
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } })
}

function stubFetchOk(onUrl?: (url: string) => void): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      onUrl?.(url)
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response
    }),
  )
}

describe('AssetPackManager.ensureAssetSets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('is a no-op when no packDB is configured', async () => {
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    await expect(mgr.ensureAssetSets('dungeon-classic', ['GG_Fieldstone'])).resolves.toBeUndefined()
  })

  it('is a no-op for an empty set list', async () => {
    const db = createMockDB([])
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    await mgr.ensureAssetSets('dungeon-classic', [])
    expect(db.getPack).not.toHaveBeenCalled()
  })

  it('warns and returns when the pack has no cached manifest', async () => {
    const db = createMockDB([])
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mgr.ensureAssetSets('unknown-pack', ['GG_Fieldstone'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no cached manifest'))
    expect(db.getPack).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('is a fast no-op when every requested set is already installed — no fetch, no merge', async () => {
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue({
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      installedAssetSets: ['GG_Fieldstone', 'GG_Palisade'],
    })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await mgr.ensureAssetSets('dungeon-classic', ['GG_Fieldstone'])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(db.mergeAssetSetBlobs).not.toHaveBeenCalled()
  })

  it('bumps the asset-set LRU for every requested set, hit or miss', async () => {
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue({
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      installedAssetSets: ['GG_Fieldstone'],
    })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    stubZeroDigest()
    stubFetchOk()
    await mgr.ensureAssetSets('dungeon-classic', ['GG_Fieldstone', 'GG_Palisade'])
    const lru = getAssetSetLRU()
    expect(lru['dungeon-classic:GG_Fieldstone']).toEqual(expect.any(Number))
    expect(lru['dungeon-classic:GG_Palisade']).toEqual(expect.any(Number))
  })

  it("fetches and merges only the missing set's files, checksum-verified", async () => {
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue({
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      installedAssetSets: ['GG_Fieldstone'],
    })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    stubZeroDigest()
    const fetched: string[] = []
    stubFetchOk((url) => fetched.push(url))

    await mgr.ensureAssetSets('dungeon-classic', ['GG_Fieldstone', 'GG_Palisade'])

    expect(fetched).toEqual([
      'https://cdn.example.com/dungeon-classic/GG_Palisade_Straight_3x1_A_3x1_A-hash2.webp',
    ])
    expect(db.mergeAssetSetBlobs).toHaveBeenCalledWith(
      'dungeon-classic',
      expect.any(Map),
      { GG_Palisade: ['GG_Palisade_Straight_3x1_A_3x1_A-hash2.webp'] },
    )
  })

  it('throws on checksum mismatch and never merges', async () => {
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue({
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      installedAssetSets: [],
    })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    const manifest = makeSetManifest()
    manifest.files['GG_Fieldstone_Straight_3x1_A_3x1_A-hash1.webp']!.checksum = `sha256:${'f'.repeat(64)}`
    mgr['manifestCache'].set('dungeon-classic', manifest)
    stubZeroDigest()
    stubFetchOk()

    await expect(mgr.ensureAssetSets('dungeon-classic', ['GG_Fieldstone'])).rejects.toThrow('Checksum mismatch')
    expect(db.mergeAssetSetBlobs).not.toHaveBeenCalled()
  })

  it('evicts before writing when the cap would be breached', async () => {
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue({
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      installedAssetSets: [],
    })
    db.getCacheUsage = vi.fn().mockResolvedValue({ used: 200 * 1024 * 1024 - 1, limit: 200 * 1024 * 1024 })
    db.evictLRU = vi.fn().mockResolvedValue(['some-other-pack'])
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    stubZeroDigest()
    stubFetchOk()

    await mgr.ensureAssetSets('dungeon-classic', ['GG_Fieldstone'])

    expect(db.evictLRU).toHaveBeenCalled()
    expect(db.mergeAssetSetBlobs).toHaveBeenCalled()
  })
})

describe('AssetPackManager.assetSetsForTextureIds', () => {
  it('resolves ids through the cached manifest', () => {
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    const result = mgr.assetSetsForTextureIds(['wall-fieldstone-straight-3x1-a', 'wall-palisade-straight-3x1-a'])
    expect(result.get('dungeon-classic')).toEqual(new Set(['GG_Fieldstone', 'GG_Palisade']))
  })

  it('ignores ids with no matching pack manifest', () => {
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    const result = mgr.assetSetsForTextureIds(['wall-fieldstone-straight-3x1-a'])
    expect(result.size).toBe(0)
  })
})

describe('AssetPackManager.ensureTexturesForMap', () => {
  afterEach(() => vi.unstubAllGlobals())

  function mapWithFieldstone(): MapTextureSource {
    return {
      mapSettings: { name: 'x', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000' },
      layers: [
        {
          id: 'l1',
          name: 'L',
          type: 'dungeon',
          visible: true,
          locked: false,
          opacity: 1,
          children: [],
          standaloneWalls: [
            {
              id: 'w1',
              points: [[0, 0], [3, 0]],
              wallType: 'normal',
              direction: 'both',
              color: '#000',
              width: 0.5,
              roughness: 0,
              textureSetId: 'fieldstone',
            },
          ],
          mergedFloor: null,
          style: {
            floorColor: '#fff', wallColor: '#000', wallWidth: 0.5, shadowEnabled: false,
            shadowColor: '#000', shadowOffset: { x: 0, y: 0 }, shadowIntensity: 0, roughnessAmplitude: 0,
            lineWidth: 0.04, edgeTransitionWidth: 0.5, showEdgeTransitions: false, wallTextureTint: '#fff',
          },
          sublayerVisibility: { floor: true, grid: true, walls: true },
        },
      ],
    } as unknown as MapTextureSource
  }

  it('never throws for a map with no dungeon layers', async () => {
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
    const map: MapTextureSource = {
      mapSettings: { name: 'x', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000' },
      layers: [],
    }
    await expect(mgr.ensureTexturesForMap(map)).resolves.toBeUndefined()
  })

  it('is a fast no-op when the resolved pack has no set to fetch', async () => {
    const db = createMockDB([])
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    // No manifest cached at all — resolution finds nothing, so ensureAssetSets never runs.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await mgr.ensureTexturesForMap(mapWithFieldstone())
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches the missing set once a manifest is cached', async () => {
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue({
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      installedAssetSets: [],
    })
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    mgr['manifestCache'].set('dungeon-classic', makeSetManifest())
    stubZeroDigest()
    stubFetchOk()

    await mgr.ensureTexturesForMap(mapWithFieldstone())

    expect(db.mergeAssetSetBlobs).toHaveBeenCalledWith(
      'dungeon-classic',
      expect.any(Map),
      { GG_Fieldstone: ['GG_Fieldstone_Straight_3x1_A_3x1_A-hash1.webp'] },
    )
  })
})

describe('AssetPackManager.updatePack — asset sets', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubManifestFetch(manifest: PackManifest, fetched: string[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url)
        if (url.includes('pack.json')) {
          return { ok: true, json: async () => manifest } as Response
        }
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response
      }),
    )
  }

  it('skips files exclusive to a set that was never installed locally', async () => {
    const manifest = makeSetManifest()
    const oldStored: StoredPack = {
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      manifest: new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer,
      // Content for the two files this update should keep and reuse (unchanged
      // checksums below), so a real presence/absence check is possible —
      // Palisade's file is deliberately NOT here, matching "never installed".
      blobs: new Map([
        ['GG_Fieldstone_Straight_3x1_A_3x1_A-hash1.webp', new Uint8Array([9])],
        ['stone-slate_1x1_A-hash3.webp', new Uint8Array([9])],
      ]),
      installedAssetSets: ['GG_Fieldstone'], // Palisade was never fetched locally
    }
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue(oldStored)
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    stubZeroDigest()
    const fetched: string[] = []
    stubManifestFetch(manifest, fetched)

    const diff = await mgr.updatePack('dungeon-classic')

    expect(fetched.some((u) => u.includes('GG_Palisade'))).toBe(false)
    const installArgs = (db.installPack as ReturnType<typeof vi.fn>).mock.calls[0][0] as StoredPack
    expect(installArgs.installedAssetSets).toEqual(['GG_Fieldstone'])
    const keptFiles = [...installArgs.blobs.keys()]
    expect(keptFiles).toEqual(
      expect.arrayContaining([
        'GG_Fieldstone_Straight_3x1_A_3x1_A-hash1.webp',
        'stone-slate_1x1_A-hash3.webp',
      ]),
    )
    expect(keptFiles).not.toContain('GG_Palisade_Straight_3x1_A_3x1_A-hash2.webp')
    // setless base file + the installed set's file both still update; Palisade's is skipped
    expect(diff.totalFiles).toBe(2)
  })

  it('falls back to full download when there is no prior set bookkeeping', async () => {
    const manifest = makeSetManifest()
    const oldStored: StoredPack = {
      ...makeStoredPack('dungeon-classic', '1.0.0'),
      manifest: new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer,
      // no installedAssetSets — legacy record predating this feature
    }
    const db = createMockDB([])
    db.getPack = vi.fn().mockResolvedValue(oldStored)
    const mgr = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com', packDB: db })
    stubZeroDigest()
    const fetched: string[] = []
    stubManifestFetch(manifest, fetched)

    const diff = await mgr.updatePack('dungeon-classic')

    expect(diff.totalFiles).toBe(3) // every file, both sets plus the setless one
  })
})
