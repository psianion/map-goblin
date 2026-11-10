import { describe, it, expect, vi, afterEach } from 'vitest'
import { installBundledIndex } from './firstBootInstall'
import type { AssetPackManager } from './assetPackManager'

function manifest() {
  const atlases: Record<string, unknown> = {}
  const files: Record<string, unknown> = {}
  for (let i = 0; i < 10; i++) atlases[`atlas-${i}.webp`] = { checksum: 'x', size: 1 }
  for (let i = 0; i < 15; i++) files[`file-${i}.webp`] = { checksum: 'x', size: 1 }
  return { name: 'p', description: '', version: '1.0.0', bundleSize: 1, entries: { a: {} }, atlases, files }
}

function fakeManager(
  installed: { packId: string; version: string; entryCount: number }[] = [],
  // What rehydrate put back in the manifest cache for the already-installed copy.
  // Staleness is decided against this, not against the summary above.
  manifests: { packId: string; manifest: unknown }[] = [],
  bundledIds: string[] = [],
) {
  return {
    catalogVersion: 0,
    getInstalledPacks: () => installed,
    getPackManifests: () => manifests,
    bundledInstalledIds: async () => bundledIds,
    registerManifest: vi.fn(async () => {}),
    uninstallPack: vi.fn(async () => {}),
  } as unknown as AssetPackManager & {
    registerManifest: ReturnType<typeof vi.fn>
    uninstallPack: ReturnType<typeof vi.fn>
  }
}

const INSTALLED = [{ packId: 'dungeon-classic', version: '1.0.0', entryCount: 1 }]

const INDEX_RESPONSE = {
  packs: { 'dungeon-classic': { manifest: 'dungeon-classic/pack-abc123.json' } },
}

/** Answers the index and the manifest; records every URL asked for. */
function stubManifestFetch(fetched: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      if (url.endsWith('index.json')) {
        return { ok: true, json: async () => INDEX_RESPONSE } as unknown as Response
      }
      if (url.endsWith('.json') && url.includes('pack-')) {
        return { ok: true, json: async () => manifest() } as unknown as Response
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response
    }),
  )
  return fetched
}

afterEach(() => vi.unstubAllGlobals())

describe('installBundledIndex', () => {
  it('registers each manifest and fetches no pack file', async () => {
    const fetched = stubManifestFetch()
    const mgr = fakeManager()
    await installBundledIndex(mgr)
    expect(fetched).toEqual(['/packs/index.json', '/packs/dungeon-classic/pack-abc123.json'])
    expect(mgr.registerManifest).toHaveBeenCalledWith('dungeon-classic', expect.objectContaining({ version: '1.0.0' }))
    expect(mgr.catalogVersion).toBe(1)
  })

  it('skips when the installed pack matches the bundled manifest', async () => {
    stubManifestFetch()
    const mgr = fakeManager(INSTALLED, [{ packId: 'dungeon-classic', manifest: manifest() }])
    await installBundledIndex(mgr)
    expect(mgr.uninstallPack).not.toHaveBeenCalled()
    expect(mgr.registerManifest).not.toHaveBeenCalled()
  })

  // Once the same pack is also published to a CDN, the bundled manifest is frozen at
  // whatever shipped in the image while the installed copy moves ahead. A content-only
  // staleness test reads that as "differs, therefore stale" and reinstalls the *older*
  // bundled copy — silently undoing the update on every reload.
  it('leaves an installed copy alone when it is newer than the bundled one', async () => {
    stubManifestFetch() // bundled manifest is 1.0.0
    const updated = manifest()
    updated.version = '1.3.0'
    ;(updated.files['file-3.webp'] as { checksum: string }).checksum = 'newfloors'
    const mgr = fakeManager(
      [{ packId: 'dungeon-classic', version: '1.3.0', entryCount: 1 }],
      [{ packId: 'dungeon-classic', manifest: updated }],
    )
    await installBundledIndex(mgr)
    expect(mgr.uninstallPack).not.toHaveBeenCalled()
    expect(mgr.registerManifest).not.toHaveBeenCalled()
  })

  it('drops an outdated copy, files and all, and registers the bundled manifest', async () => {
    stubManifestFetch()
    const stale = manifest()
    stale.version = '0.9.0'
    const mgr = fakeManager(
      [{ packId: 'dungeon-classic', version: '0.9.0', entryCount: 1 }],
      [{ packId: 'dungeon-classic', manifest: stale }],
    )
    await installBundledIndex(mgr)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
    expect(mgr.registerManifest).toHaveBeenCalled()
  })

  // The defect this content key exists for: the door art was swapped under an
  // entry that kept its id, and the version and entry count both stayed put, so
  // every returning browser went on serving the old blob out of IndexedDB.
  it('re-registers when a file checksum moved but version and entry count did not', async () => {
    stubManifestFetch()
    const swapped = manifest()
    ;(swapped.files['file-3.webp'] as { checksum: string }).checksum = 'newbytes'
    const mgr = fakeManager(INSTALLED, [{ packId: 'dungeon-classic', manifest: swapped }])
    await installBundledIndex(mgr)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
    expect(mgr.registerManifest).toHaveBeenCalled()
  })

  it('re-registers an installed copy that has no cached manifest to compare', async () => {
    stubManifestFetch()
    const mgr = fakeManager(INSTALLED, [])
    await installBundledIndex(mgr)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
  })

  it('re-registers when an entry id is added without a version bump', async () => {
    stubManifestFetch()
    const fewer = manifest()
    delete (fewer.entries as Record<string, unknown>).a
    ;(fewer.entries as Record<string, unknown>).b = {}
    const mgr = fakeManager(INSTALLED, [{ packId: 'dungeon-classic', manifest: fewer }])
    await installBundledIndex(mgr)
    expect(mgr.registerManifest).toHaveBeenCalled()
  })

  it('retires bundled packs the index no longer lists', async () => {
    stubManifestFetch()
    const mgr = fakeManager([], [], ['dungeon-classic', 'retired'])
    await installBundledIndex(mgr)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('retired')
    expect(mgr.uninstallPack).not.toHaveBeenCalledWith('dungeon-classic')
  })

  it('one broken pack never costs the others', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('index.json')) {
          return {
            ok: true,
            json: async () => ({ packs: { bad: { manifest: 'bad/pack-1.json' }, good: { manifest: 'good/pack-2.json' } } }),
          } as unknown as Response
        }
        if (url.includes('bad/')) throw new Error('network')
        return { ok: true, json: async () => manifest() } as unknown as Response
      }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mgr = fakeManager()
    await installBundledIndex(mgr)
    expect(mgr.registerManifest).toHaveBeenCalledTimes(1)
    expect(mgr.registerManifest).toHaveBeenCalledWith('good', expect.anything())
  })

  it('throws when the bundled index cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response))
    await expect(installBundledIndex(fakeManager())).rejects.toThrow('Bundled pack index not found')
  })

  it('registers nothing when the bundled index lists no packs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ packs: {} }) }) as unknown as Response),
    )
    const mgr = fakeManager()
    await installBundledIndex(mgr)
    expect(mgr.registerManifest).not.toHaveBeenCalled()
  })

})
