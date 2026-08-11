import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AssetPackManager } from './assetPackManager'
import type { AssetPackDB, StoredPack } from './assetPackDB'

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
