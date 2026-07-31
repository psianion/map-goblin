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

function fakeManager(installed: { packId: string; version: string; entryCount: number }[] = []) {
  return {
    getInstalledPacks: () => installed,
    registerPack: vi.fn(async () => {}),
    uninstallPack: vi.fn(async () => {}),
  } as unknown as AssetPackManager & {
    registerPack: ReturnType<typeof vi.fn>
    uninstallPack: ReturnType<typeof vi.fn>
  }
}

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
    const mgr = fakeManager([{ packId: 'dungeon-classic', version: '1.0.0', entryCount: 1 }])
    expect(await ensureBundledPack(mgr)).toBe(false)
    expect(mgr.uninstallPack).not.toHaveBeenCalled()
    expect(mgr.registerPack).not.toHaveBeenCalled()
  })

  it('reinstalls when the installed pack is outdated', async () => {
    // The bundled manifest ships at a fixed path, so content updates arrive
    // under the same URL — a mere installed-check would pin the stale copy.
    stubManifestFetch()
    const mgr = fakeManager([{ packId: 'dungeon-classic', version: '1.0.0', entryCount: 94 }])
    expect(await ensureBundledPack(mgr)).toBe(true)
    expect(mgr.uninstallPack).toHaveBeenCalledWith('dungeon-classic')
    expect(mgr.registerPack).toHaveBeenCalled()
  })
})
