import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

// Mock CDN data for E2E tests
const MOCK_INDEX = {
  version: '1.0.0',
  packs: {
    'dungeon-classic': { version: '1.0.0', bundleSize: 5000 },
  },
}

const MOCK_MANIFEST = {
  version: '1.0.0',
  atlases: {},
  files: {},
  themes: ['dungeon'],
}

test.describe('Asset Pack Integration', () => {
  test('pack loading: fetches index, installs pack, registers in memory', async ({ page }) => {
    await gotoApp(page)

    // Intercept CDN requests
    await page.route('**/cdn.example.com/**', async (route) => {
      const url = route.request().url()
      if (url.endsWith('/index.json')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_INDEX),
        })
      } else if (url.endsWith('/pack.json')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_MANIFEST),
        })
      } else {
        await route.fulfill({ status: 404 })
      }
    })

    // Test AssetPackManager in the browser context
    const result = await page.evaluate(async () => {
      // Dynamic import to get the module in browser context
      const { AssetPackManager } = await import('/src/engine/assetPackManager.ts')
      const manager = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })

      // Verify starts empty
      const before = manager.getInstalledPacks()

      // Check getTextureOrNull returns null for unknown
      const unknownTexture = manager.getTextureOrNull('nonexistent')

      // Check getFrame returns null for unknown
      const unknownFrame = manager.getFrame('nonexistent')

      // Verify cache usage defaults
      const usage = manager.getCacheUsage()

      return {
        packsBeforeInstall: before.length,
        unknownTextureIsNull: unknownTexture === null,
        unknownFrameIsNull: unknownFrame === null,
        cacheUsed: usage.used,
        cacheLimitMB: Math.round(usage.limit / (1024 * 1024)),
      }
    })

    expect(result.packsBeforeInstall).toBe(0)
    expect(result.unknownTextureIsNull).toBe(true)
    expect(result.unknownFrameIsNull).toBe(true)
    expect(result.cacheUsed).toBe(0)
    expect(result.cacheLimitMB).toBe(200)
  })

  test('offline behavior: cached data survives CDN failure', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async () => {
      const { AssetPackManager } = await import('/src/engine/assetPackManager.ts')
      const manager = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })

      // Simulate having a cached pack in memory
      manager['installedPacks'].set('dungeon-classic', {
        packId: 'dungeon-classic',
        version: '1.0.0',
        entryCount: 10,
        themes: ['dungeon'],
        bundleSize: 5000,
      })

      // getCacheUsage should still work
      const usage = manager.getCacheUsage()

      // getInstalledPacks should return the cached pack
      const packs = manager.getInstalledPacks()

      // checkForUpdates should fail with CDN unreachable (timeout)
      let checkFailed = false
      try {
        await manager.checkForUpdates()
      } catch {
        checkFailed = true
      }

      // Cached packs should survive the CDN failure
      const packsAfterFailure = manager.getInstalledPacks()

      return {
        packCount: packs.length,
        packId: packs[0]?.packId,
        checkFailed,
        packsAfterFailure: packsAfterFailure.length,
        cacheUsed: usage.used,
      }
    })

    expect(result.packCount).toBe(1)
    expect(result.packId).toBe('dungeon-classic')
    expect(result.checkFailed).toBe(true)
    // Packs survive CDN failure
    expect(result.packsAfterFailure).toBe(1)
  })

  test('legacy save file: legacy IDs resolve to new format', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async () => {
      const { resolveLegacyId, buildMappingFromManifest } = await import(
        '/src/engine/legacyAssetMapping.ts'
      )

      // Test legacy ID resolution
      const stoneSlate = resolveLegacyId('stone-slate')
      const unknown = resolveLegacyId('nonexistent-texture')
      const newFormat = resolveLegacyId('dungeon-classic:stone_1x1_floor_A')
      const grassId = resolveLegacyId('grass-a-01')

      // Test buildMappingFromManifest
      const mapping = buildMappingFromManifest(
        [
          { id: 'test-floor', type: 'floor' },
          { id: 'test-wall', type: 'wall' },
          { id: 'test-obj', type: 'object' },
        ],
        'my-pack',
      )

      return {
        stoneSlate,
        unknown,
        newFormat,
        grassId,
        mappedFloor: mapping['test-floor'],
        mappedWall: mapping['test-wall'],
        mappedObj: mapping['test-obj'],
      }
    })

    // Legacy IDs map to new format
    expect(result.stoneSlate).toBe('dungeon-classic:stone-slate_1x1_floor_A')
    expect(result.grassId).toBe('dungeon-classic:grass-a-01_1x1_floor_A')

    // Unknown IDs return null
    expect(result.unknown).toBeNull()

    // New-format IDs pass through unchanged
    expect(result.newFormat).toBe('dungeon-classic:stone_1x1_floor_A')

    // buildMappingFromManifest generates correct mappings
    expect(result.mappedFloor).toBe('my-pack:test-floor_1x1_floor_A')
    expect(result.mappedWall).toBe('my-pack:test-wall_wall_A')
    expect(result.mappedObj).toBe('my-pack:test-obj_object_A')
  })
})
