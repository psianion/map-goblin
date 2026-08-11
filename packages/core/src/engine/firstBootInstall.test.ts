import { describe, it, expect, vi, afterEach } from 'vitest'
import { ensureBundledPack } from './firstBootInstall'
import type { AssetPackManager } from './assetPackManager'

const FILE_COUNT = 25 // matches the shipped dungeon-classic pack (10 atlas parts + 15 files)

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
) {
  return {
    getInstalledPacks: () => installed,
    getPackManifests: () => manifests,
    registerPack: vi.fn(async () => {}),
    uninstallPack: vi.fn(async () => {}),
  } as unknown as AssetPackManager & {
    registerPack: ReturnType<typeof vi.fn>
    uninstallPack: ReturnType<typeof vi.fn>
  }
}

const INSTALLED = [{ packId: 'dungeon-classic', version: '1.0.0', entryCount: 1 }]

function stubManifestFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('.json') && url.includes('pack-')) {
        return { ok: true, json: async () => manifest() } as unknown as Response
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ensureBundledPack', () => {
  it('fetches pack files concurrently, capped at 8 in flight', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('.json') && url.includes('pack-')) {
          return { ok: true, json: async () => manifest() } as unknown as Response
        }
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response
      }),
    )

    const mgr = fakeManager()
    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(peak).toBeGreaterThan(1) // was 1 when the loop was serial
    expect(peak).toBeLessThanOrEqual(8)
    expect(mgr.registerPack.mock.calls[0][2].size).toBe(FILE_COUNT)
  })

  it('aborts (does not hang) when one file 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('.json') && url.includes('pack-')) {
          return { ok: true, json: async () => manifest() } as unknown as Response
        }
        if (url.includes('file-7.webp')) return { ok: false, status: 404 } as unknown as Response
        return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response
      }),
    )

    const mgr = fakeManager()
    expect(await ensureBundledPack(mgr)).toBe(false)
    expect(mgr.registerPack).not.toHaveBeenCalled()
  })

  it('skips when the installed pack matches the bundled manifest', async () => {
    stubManifestFetch()
    const mgr = fakeManager(INSTALLED, [{ packId: 'dungeon-classic', manifest: manifest() }])
    expect(await ensureBundledPack(mgr)).toBe(false)
    expect(mgr.uninstallPack).not.toHaveBeenCalled()
    expect(mgr.registerPack).not.toHaveBeenCalled()
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

    expect(await ensureBundledPack(mgr)).toBe(false)
    expect(mgr.uninstallPack).not.toHaveBeenCalled()
    expect(mgr.registerPack).not.toHaveBeenCalled()
  })

  it('still reinstalls when the bundle ships a version newer than the installed copy', async () => {
    // The other direction has to keep working: a new build with newer art must win.
    stubManifestFetch() // bundled manifest is 1.0.0
    const older = manifest()
    older.version = '0.9.0'

    const mgr = fakeManager(
      [{ packId: 'dungeon-classic', version: '0.9.0', entryCount: 1 }],
      [{ packId: 'dungeon-classic', manifest: older }],
    )

    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
  })

  it('reinstalls when the installed pack is outdated', async () => {
    // The bundled manifest ships at a fixed path, so content updates arrive
    // under the same URL — a mere installed-check would pin the stale copy.
    stubManifestFetch()
    const stale = manifest()
    stale.version = '0.9.0'
    const mgr = fakeManager(
      [{ packId: 'dungeon-classic', version: '0.9.0', entryCount: 1 }],
      [{ packId: 'dungeon-classic', manifest: stale }],
    )
    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
    expect(mgr.registerPack).toHaveBeenCalled()
  })

  // The defect this content key exists for: the door art was swapped under an
  // entry that kept its id, and the version and entry count both stayed put, so
  // every returning browser went on serving the old blob out of IndexedDB.
  it('reinstalls when a file checksum moved but version and entry count did not', async () => {
    stubManifestFetch()
    const swapped = manifest()
    ;(swapped.files['file-3.webp'] as { checksum: string }).checksum = 'newbytes'

    const mgr = fakeManager(INSTALLED, [{ packId: 'dungeon-classic', manifest: swapped }])

    // Same version, same entry count — the old check saw nothing to do here.
    expect(swapped.version).toBe(manifest().version)
    expect(Object.keys(swapped.entries).length).toBe(Object.keys(manifest().entries).length)

    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
    expect(mgr.registerPack).toHaveBeenCalled()
  })

  it('reinstalls an installed copy that has no cached manifest to compare', async () => {
    // Profiles that installed before the content key existed — reinstall once to
    // get them onto a known key rather than trusting the version alone.
    stubManifestFetch()
    const mgr = fakeManager(INSTALLED, [])
    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
  })

  it('reinstalls when an entry id is added without a version bump', async () => {
    stubManifestFetch()
    const fewer = manifest()
    delete (fewer.entries as Record<string, unknown>).a
    ;(fewer.entries as Record<string, unknown>).b = {}

    const mgr = fakeManager(INSTALLED, [{ packId: 'dungeon-classic', manifest: fewer }])
    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(mgr.registerPack).toHaveBeenCalled()
  })
})
