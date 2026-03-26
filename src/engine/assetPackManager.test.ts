import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AssetPackManager } from './assetPackManager'

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
      version: '1.0.0',
      atlases: {},
      files: {
        'data.bin': { checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
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
        'data.bin': { checksum: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' },
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
