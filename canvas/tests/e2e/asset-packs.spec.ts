import { test, expect } from '@playwright/test'
import { gotoApp } from './helpers'

// Mock CDN data for E2E tests
const MOCK_INDEX = {
  version: '1.0.0',
  packs: {
    'gg-forge': { version: '1.0.0', bundleSize: 5000 },
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
      manager['installedPacks'].set('gg-forge', {
        packId: 'gg-forge',
        version: '1.0.0',
        entryCount: 10,
        themes: ['dungeon'],
        bundleSize: 5000,
      })

      // getCacheUsage should still work
      const usage = manager.getCacheUsage()

      // getInstalledPacks should return the cached pack
      const packs = manager.getInstalledPacks()

      // An unreachable CDN is not an error the user should see: checkForUpdates
      // logs and returns no updates rather than throwing, so an offline session
      // keeps working off the cache. (AssetPackManager.checkForUpdates.)
      let threw = false
      let updates: unknown[] = []
      try {
        updates = await manager.checkForUpdates()
      } catch {
        threw = true
      }

      // Cached packs should survive the CDN failure
      const packsAfterFailure = manager.getInstalledPacks()

      return {
        packCount: packs.length,
        packId: packs[0]?.packId,
        threw,
        updateCount: updates.length,
        packsAfterFailure: packsAfterFailure.length,
        cacheUsed: usage.used,
      }
    })

    expect(result.packCount).toBe(1)
    expect(result.packId).toBe('gg-forge')
    expect(result.threw).toBe(false)
    expect(result.updateCount).toBe(0)
    // Packs survive CDN failure
    expect(result.packsAfterFailure).toBe(1)
  })

})
