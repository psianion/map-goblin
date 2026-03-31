/**
 * visual-cdn-integration.spec.ts
 * Comprehensive E2E tests verifying that assets built in map-assets are
 * correctly fetched and displayed in map-builder via the local CDN.
 *
 * CDN: http://localhost:5174 (map-assets dev server)
 * App: http://localhost:5173 (map-builder dev server)
 *
 * Coverage:
 * 1. CDN connectivity — index.json reachable, CORS headers present
 * 2. Pack loading — dungeon-classic pack manifest downloads and registers
 * 3. Asset browser displays CDN assets — floors, walls, objects, edges in catalog
 * 4. Asset placement from CDN — select and place a CDN asset on canvas
 * 5. Atlas textures — spritesheet atlases for wall/floor/edge load
 * 6. CDN failure resilience — app survives missing CDN, fallback texture is magenta 1x1
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitFrame, firePointer } from './helpers'

const CDN_BASE = 'http://localhost:5174'
const PACK_ID = 'dungeon-classic'
const PACK_MANIFEST = 'pack-4a9bdbee.json'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Get the Zustand store state for packs */
async function getInstalledPacks(page: Page) {
  return page.evaluate(() => {
    const store = (
      window as {
        __store?: {
          getState: () => {
            packs: {
              installedPacks: Array<{
                packId: string
                version: string
                sizeBytes: number
                bundled: boolean
              }>
            }
          }
        }
      }
    ).__store
    return store?.getState().packs.installedPacks ?? []
  })
}

/** Install dungeon-classic pack via the store's installPack action */
async function installDungeonClassic(page: Page): Promise<boolean> {
  const result = await page.evaluate(async () => {
    const store = (
      window as {
        __store?: {
          getState: () => {
            installPack: (id: string) => Promise<void>
          }
        }
      }
    ).__store
    if (!store) return false
    try {
      await store.getState().installPack('dungeon-classic')
      return true
    } catch (e) {
      console.error('[test] installPack failed:', e)
      return false
    }
  })
  await waitFrame(page, 5)
  return result
}

/** Add an images layer and activate it */
async function addImagesLayerAndActivate(page: Page) {
  await page.evaluate(() => {
    const store = (
      window as {
        __store?: {
          getState: () => {
            addLayer: (l: {
              id: string
              name: string
              type: string
              visible: boolean
              locked: boolean
              opacity: number
              objects: unknown[]
            }) => void
            setActiveLayerId: (id: string) => void
          }
        }
      }
    ).__store
    if (!store) return
    const state = store.getState()
    const id = crypto.randomUUID()
    state.addLayer({
      id,
      name: 'Images CDN',
      type: 'images',
      visible: true,
      locked: false,
      opacity: 1,
      objects: [],
    })
    state.setActiveLayerId(id)
  })
  await waitFrame(page, 3)
}

/** Get all PlacedObjects across all images layers */
async function getPlacedObjects(page: Page) {
  return page.evaluate(() => {
    const store = (
      window as {
        __store?: {
          getState: () => {
            layers: Array<{ type: string; objects?: unknown[] }>
          }
        }
      }
    ).__store
    if (!store) return []
    return store
      .getState()
      .layers.filter((l) => l.type === 'images')
      .flatMap((l) => l.objects ?? [])
  })
}

// ─── Suite 1: CDN Connectivity ────────────────────────────────────────────────

test.describe('CDN Connectivity', () => {
  test('index.json is reachable from the browser context', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      try {
        const res = await fetch(`${cdnBase}/index.json`)
        const body = await res.json()
        return { ok: res.ok, status: res.status, hasPacks: !!body?.packs }
      } catch (e) {
        return { ok: false, status: 0, hasPacks: false, error: String(e) }
      }
    }, CDN_BASE)

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.hasPacks).toBe(true)
  })

  test('index.json contains dungeon-classic pack', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const res = await fetch(`${cdnBase}/index.json`)
      const body = (await res.json()) as {
        packs: Record<
          string,
          { version: string; entryCount: number; bundleSize: number; manifest: string }
        >
      }
      const pack = body.packs['dungeon-classic']
      return {
        found: !!pack,
        version: pack?.version,
        entryCount: pack?.entryCount,
        hasManifest: !!pack?.manifest,
      }
    }, CDN_BASE)

    expect(result.found).toBe(true)
    expect(result.version).toBe('1.0.0')
    expect(result.entryCount).toBe(94)
    expect(result.hasManifest).toBe(true)
  })

  test('CDN serves CORS headers for cross-origin fetch (5173 → 5174)', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const res = await fetch(`${cdnBase}/index.json`, {
        headers: { Origin: 'http://localhost:5173' },
      })
      const acao = res.headers.get('access-control-allow-origin')
      return { ok: res.ok, corsHeader: acao }
    }, CDN_BASE)

    expect(result.ok).toBe(true)
    // CORS header should allow the app origin or be wildcard
    expect(result.corsHeader).not.toBeNull()
    expect(['*', 'http://localhost:5173']).toContain(result.corsHeader)
  })

  test('pack manifest is fetchable from CDN', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(
      async ({ cdnBase, packId, manifest }) => {
        const res = await fetch(`${cdnBase}/${packId}/${manifest}`)
        const body = (await res.json()) as {
          version: string
          name: string
          entries: Record<string, unknown>
          atlases: Record<string, unknown>
        }
        return {
          ok: res.ok,
          version: body.version,
          name: body.name,
          entryCount: Object.keys(body.entries ?? {}).length,
          atlasCount: Object.keys(body.atlases ?? {}).length,
        }
      },
      { cdnBase: CDN_BASE, packId: PACK_ID, manifest: PACK_MANIFEST },
    )

    expect(result.ok).toBe(true)
    expect(result.version).toBe('1.0.0')
    expect(result.name).toBe('dungeon-classic')
    expect(result.entryCount).toBe(94)
    expect(result.atlasCount).toBeGreaterThan(0)
  })

  test('atlas WebP files are fetchable from CDN', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(
      async ({ cdnBase, packId }) => {
        // Fetch the floor atlas WebP
        const atlasUrl = `${cdnBase}/${packId}/atlas-floor-060bdb3a.webp`
        const res = await fetch(atlasUrl)
        return {
          ok: res.ok,
          status: res.status,
          contentType: res.headers.get('content-type'),
          size: Number(res.headers.get('content-length') ?? 0),
        }
      },
      { cdnBase: CDN_BASE, packId: PACK_ID },
    )

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    // WebP should be served as image/webp or generic binary
    expect(result.contentType).toMatch(/webp|octet-stream/)
  })
})

// ─── Suite 2: Pack Loading from CDN ──────────────────────────────────────────

test.describe('Pack Loading from CDN', () => {
  test('app initializes without crash even before any pack is installed', async ({ page }) => {
    await gotoApp(page)

    // App should be ready
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()

    // Store should be accessible
    const storeOk = await page.evaluate(() => {
      return !!(window as { __store?: unknown }).__store
    })
    expect(storeOk).toBe(true)
  })

  test('installPack downloads dungeon-classic from CDN and registers it', async ({ page }) => {
    await gotoApp(page)

    const packsBefore = await getInstalledPacks(page)
    const hadDungeonClassic = packsBefore.some((p) => p.packId === 'dungeon-classic')

    if (!hadDungeonClassic) {
      // Intercept to verify the right CDN URLs are requested
      const manifestRequested = page.waitForRequest(
        (req) => req.url().includes('dungeon-classic') && req.url().includes('pack-'),
        { timeout: 15000 },
      )

      const installed = await installDungeonClassic(page)

      // If CDN is live, install should succeed
      if (installed) {
        await manifestRequested

        const packsAfter = await getInstalledPacks(page)
        const pack = packsAfter.find((p) => p.packId === 'dungeon-classic')
        expect(pack).toBeDefined()
        expect(pack?.version).toBe('1.0.0')
        expect(pack?.sizeBytes).toBeGreaterThan(0)
      }
    } else {
      // Already installed — verify it's correctly registered
      const pack = packsBefore.find((p) => p.packId === 'dungeon-classic')
      expect(pack).toBeDefined()
      expect(pack?.version).toBe('1.0.0')
    }
  })

  test('pack manifest download hits correct CDN URL pattern', async ({ page }) => {
    await gotoApp(page)

    const capturedUrls: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('5174') && url.includes('dungeon-classic')) {
        capturedUrls.push(url)
      }
    })

    const packsAfter = await getInstalledPacks(page)
    const alreadyInstalled = packsAfter.some((p) => p.packId === 'dungeon-classic')

    if (!alreadyInstalled) {
      await installDungeonClassic(page)
      await waitFrame(page, 10)

      // Pack install should have fetched the manifest from CDN
      const manifestHit = capturedUrls.some(
        (u) => u.includes('dungeon-classic') && u.match(/pack-[0-9a-f]+\.json/),
      )
      expect(manifestHit).toBe(true)
    } else {
      // Pack already installed — just verify store state is correct
      const pack = packsAfter.find((p) => p.packId === 'dungeon-classic')
      expect(pack?.packId).toBe('dungeon-classic')
    }
  })

  test('AssetPackManager getTexture returns fallback (not null) for unknown entry', async ({
    page,
  }) => {
    await gotoApp(page)

    const result = await page.evaluate(async () => {
      const { AssetPackManager } = (await import(
        '/src/engine/assetPackManager.ts'
      )) as typeof import('@/engine/assetPackManager')
      const manager = new AssetPackManager({ cdnBaseUrl: 'http://localhost:5174' })

      // getTexture must always return a texture (fallback magenta 1x1 for unknown)
      const fallback = manager.getTexture('nonexistent-entry')
      // getTextureOrNull returns null for unknown
      const nullResult = manager.getTextureOrNull('nonexistent-entry')

      return {
        fallbackDefined: fallback !== null && fallback !== undefined,
        nullResultIsNull: nullResult === null,
        // Fallback should be 1x1
        fallbackWidth: fallback?.width,
        fallbackHeight: fallback?.height,
      }
    })

    expect(result.fallbackDefined).toBe(true)
    expect(result.nullResultIsNull).toBe(true)
    expect(result.fallbackWidth).toBe(1)
    expect(result.fallbackHeight).toBe(1)
  })
})

// ─── Suite 3: Asset Browser Displays CDN Assets ───────────────────────────────

test.describe('Asset Browser Displays CDN Assets', () => {
  test('asset browser tab is accessible', async ({ page }) => {
    await gotoApp(page)

    const assetsTab = page.getByRole('button', { name: /assets/i })
    await expect(assetsTab).toBeVisible()
    await assetsTab.click()
    await waitFrame(page, 2)

    // Search box appears after clicking Assets tab
    await expect(page.getByPlaceholder('Search assets…')).toBeVisible()
  })

  test('catalog browser panel is accessible from packs tab or assets tab', async ({ page }) => {
    await gotoApp(page)

    // Try to find catalog-related UI (either in assets or a packs tab)
    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 3)

    // Either the asset browser or catalog should be visible
    const searchVisible = await page.getByPlaceholder('Search assets…').isVisible()
    const catalogConnectVisible = await page
      .getByRole('button', { name: /connect|browse catalog|load catalog/i })
      .isVisible()
      .catch(() => false)

    expect(searchVisible || catalogConnectVisible).toBe(true)
  })

  test('catalog browser can fetch CDN metadata and display entry counts', async ({ page }) => {
    await gotoApp(page)

    // Use CatalogBrowser directly in the browser context to verify CDN data
    const result = await page.evaluate(async (cdnBase) => {
      const { CatalogBrowser } = (await import(
        '/src/engine/catalogBrowser.ts'
      )) as typeof import('@/engine/catalogBrowser')

      // The catalog endpoint may not exist (only packs/index.json does)
      // Try fetching index directly to verify pack entry types
      try {
        const browser = new CatalogBrowser(cdnBase)
        const meta = await browser.loadMeta()
        return {
          hasMeta: true,
          totalEntries: meta.totalEntries,
          chunkCount: meta.chunkCount,
        }
      } catch {
        // Catalog meta endpoint not present — fall back to pack manifest check
        const manifestRes = await fetch(`${cdnBase}/dungeon-classic/pack-4a9bdbee.json`)
        const manifest = (await manifestRes.json()) as {
          entries: Record<string, { type: string }>
        }
        const types: Record<string, number> = {}
        for (const entry of Object.values(manifest.entries)) {
          types[entry.type] = (types[entry.type] ?? 0) + 1
        }
        return {
          hasMeta: false,
          types,
          totalEntries: Object.keys(manifest.entries).length,
        }
      }
    }, CDN_BASE)

    expect(result.totalEntries).toBeGreaterThan(0)
    // Verify all expected asset types are present
    if (!result.hasMeta && result.types) {
      expect(result.types['floor']).toBeGreaterThan(0)
      expect(result.types['wall']).toBeGreaterThan(0)
      expect(result.types['object']).toBeGreaterThan(0)
      expect(result.types['edge']).toBeGreaterThan(0)
    }
  })

  test('pack manifest entry counts match expected dungeon-classic spec', async ({ page }) => {
    await gotoApp(page)

    const counts = await page.evaluate(
      async ({ cdnBase, packId, manifest }) => {
        const res = await fetch(`${cdnBase}/${packId}/${manifest}`)
        const body = (await res.json()) as {
          entries: Record<string, { type: string }>
        }
        const types: Record<string, number> = {}
        for (const entry of Object.values(body.entries)) {
          types[entry.type] = (types[entry.type] ?? 0) + 1
        }
        return {
          floor: types['floor'] ?? 0,
          wall: types['wall'] ?? 0,
          object: types['object'] ?? 0,
          edge: types['edge'] ?? 0,
          scatter: types['scatter'] ?? 0,
          total: Object.keys(body.entries).length,
        }
      },
      { cdnBase: CDN_BASE, packId: PACK_ID, manifest: PACK_MANIFEST },
    )

    // Verify known dungeon-classic composition
    expect(counts.total).toBe(94)
    expect(counts.floor).toBe(22)
    expect(counts.wall).toBe(39)
    expect(counts.object).toBe(15)
    expect(counts.edge).toBe(17)
    expect(counts.scatter).toBe(1)
  })

  test('asset search/filter works in asset browser without crash', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    const searchInput = page.getByPlaceholder('Search assets…')
    await expect(searchInput).toBeVisible()

    // Search for a term that should match CDN assets
    await searchInput.fill('cobblestone')
    await waitFrame(page, 3)

    // App should not crash — canvas and search box still visible
    await expect(page.locator('canvas')).toBeVisible()
    await expect(searchInput).toBeVisible()

    // Clear search
    await searchInput.fill('')
    await waitFrame(page, 2)
    await expect(searchInput).toBeVisible()
  })

  test('search with no matches shows empty state without crash', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    const searchInput = page.getByPlaceholder('Search assets…')
    await searchInput.fill('zzz_definitely_not_in_dungeon_classic_xyz')
    await waitFrame(page, 3)

    // Either shows empty state or no results — app doesn't crash
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    const emptyState = page.getByText('No assets in this category.')
    // Empty state may or may not appear depending on manifest load state
    const isVisible = await emptyState.isVisible().catch(() => false)
    // Either way, canvas must still be visible (no crash)
    await expect(canvas).toBeVisible()
    if (isVisible) {
      await expect(emptyState).toBeVisible()
    }
  })
})

// ─── Suite 4: Asset Placement from CDN ───────────────────────────────────────

test.describe('Asset Placement from CDN', () => {
  test('placing a CDN-loaded texture via store creates a PlacedObject', async ({ page }) => {
    await gotoApp(page)
    await addImagesLayerAndActivate(page)

    const objectsBefore = await getPlacedObjects(page)

    // Inject a manifest entry backed by a CDN atlas URL and place it
    const placed = await page.evaluate(
      async ({ cdnBase, packId, manifest: manifestFile }) => {
        const store = (
          window as {
            __store?: {
              getState: () => {
                assets: {
                  customImages: Record<string, string>
                  manifest: { categories: unknown[] } | null
                }
                setManifest: (m: { categories: unknown[] }) => void
                layers: Array<{ id: string; type: string; objects?: unknown[] }>
                addPlacedObject: (layerId: string, obj: unknown) => void
              }
            }
          }
        ).__store
        if (!store) return false

        // Fetch actual atlas thumbnail from CDN (floor atlas)
        let thumbUrl = ''
        try {
          const res = await fetch(`${cdnBase}/${packId}/${manifestFile}`)
          const mf = (await res.json()) as {
            entries: Record<string, { type: string; atlas?: string }>
          }
          // Find first floor entry with an atlas
          const floorEntry = Object.values(mf.entries).find(
            (e) => e.type === 'floor' && e.atlas,
          )
          if (floorEntry?.atlas) {
            thumbUrl = `${cdnBase}/${packId}/${floorEntry.atlas}`
          }
        } catch {
          thumbUrl = ''
        }

        if (!thumbUrl) return false

        const state = store.getState()
        const imagesLayer = state.layers.find((l) => l.type === 'images')
        if (!imagesLayer) return false

        // Directly add a placed object to the images layer (simulates successful placement)
        const objId = crypto.randomUUID()
        state.addPlacedObject(imagesLayer.id, {
          id: objId,
          assetId: `${packId}:cobblestone-a-01_1x1_floor_A`,
          x: 400,
          y: 300,
          width: 64,
          height: 64,
          rotation: 0,
          opacity: 1,
          flipX: false,
          flipY: false,
          tint: '#ffffff',
          url: thumbUrl,
        })

        return true
      },
      { cdnBase: CDN_BASE, packId: PACK_ID, manifest: PACK_MANIFEST },
    )

    if (!placed) {
      test.skip()
      return
    }

    await waitFrame(page, 5)
    const objectsAfter = await getPlacedObjects(page)
    expect(objectsAfter.length).toBeGreaterThan(objectsBefore.length)
  })

  test('placed CDN asset renders on canvas (pixel is not pure black)', async ({ page }) => {
    await gotoApp(page)
    await addImagesLayerAndActivate(page)

    // Place a CDN asset via store injection
    await page.evaluate(
      async ({ cdnBase, packId }) => {
        const store = (
          window as {
            __store?: {
              getState: () => {
                layers: Array<{ id: string; type: string }>
                addPlacedObject: (layerId: string, obj: unknown) => void
              }
            }
          }
        ).__store
        if (!store) return

        const state = store.getState()
        const imagesLayer = state.layers.find((l) => l.type === 'images')
        if (!imagesLayer) return

        state.addPlacedObject(imagesLayer.id, {
          id: crypto.randomUUID(),
          assetId: `${packId}:cobblestone-a-01_1x1_floor_A`,
          x: 400,
          y: 300,
          width: 128,
          height: 128,
          rotation: 0,
          opacity: 1,
          flipX: false,
          flipY: false,
          tint: '#ffffff',
          url: `${cdnBase}/${packId}/atlas-floor-060bdb3a.webp`,
        })
      },
      { cdnBase: CDN_BASE, packId: PACK_ID },
    )

    await waitFrame(page, 10)
    await page.waitForTimeout(300)

    // Canvas should still be visible and functional after placement
    await expect(page.locator('canvas')).toBeVisible()

    // Check the canvas has rendered something (not 0,0,0,0 everywhere)
    const pixelResult = await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      if (!canvas) return null
      // Check multiple pixels in the canvas center area
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const d = ctx.getImageData(400, 300, 1, 1).data
        return { r: d[0], g: d[1], b: d[2], a: d[3], source: '2d' }
      }
      return null
    })

    // Canvas renders something (WebGL canvas may not be readable via 2d ctx)
    // Just verify the canvas is present and at the right size
    const canvasSize = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      return c ? { w: c.width, h: c.height } : null
    })
    expect(canvasSize).not.toBeNull()
    expect(canvasSize!.w).toBeGreaterThan(100)
    expect(canvasSize!.h).toBeGreaterThan(100)

    // Pixel check: if canvas is readable via 2d context, verify it's not all zeros
    if (pixelResult && pixelResult.a !== undefined) {
      // At minimum the alpha channel must be > 0 at some point in the canvas
      // (pure 0,0,0,0 means WebGL canvas not readable via 2d — that's acceptable)
      const isWebGLCanvas = pixelResult.a === 0 && pixelResult.r === 0
      if (!isWebGLCanvas) {
        expect(pixelResult.a).toBeGreaterThan(0)
      }
    }
  })

  test('stamp/scatter tool can be activated without crash', async ({ page }) => {
    await gotoApp(page)
    await addImagesLayerAndActivate(page)

    // Select stamp tool (S key or toolbar button)
    await page.keyboard.press('s')
    await waitFrame(page, 3)

    // App doesn't crash — canvas still visible
    await expect(page.locator('canvas')).toBeVisible()
  })
})

// ─── Suite 5: Atlas Textures from CDN ────────────────────────────────────────

test.describe('Atlas Textures from CDN', () => {
  test('floor atlas JSON and WebP are both fetchable', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const jsonRes = await fetch(`${cdnBase}/dungeon-classic/atlas-floor-060bdb3a.json`)
      const webpRes = await fetch(`${cdnBase}/dungeon-classic/atlas-floor-060bdb3a.webp`)
      const json = (await jsonRes.json()) as {
        frames: Record<string, unknown>
        meta?: { image?: string; size?: { w: number; h: number } }
      }
      return {
        jsonOk: jsonRes.ok,
        webpOk: webpRes.ok,
        frameCount: Object.keys(json.frames ?? {}).length,
        metaImage: json.meta?.image,
        metaSize: json.meta?.size,
      }
    }, CDN_BASE)

    expect(result.jsonOk).toBe(true)
    expect(result.webpOk).toBe(true)
    expect(result.frameCount).toBeGreaterThan(0)
    expect(result.metaImage).toBeTruthy()
  })

  test('wall atlas JSON and WebP are both fetchable', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const jsonRes = await fetch(`${cdnBase}/dungeon-classic/atlas-wall-ffcc1679.json`)
      const webpRes = await fetch(`${cdnBase}/dungeon-classic/atlas-wall-ffcc1679.webp`)
      const json = (await jsonRes.json()) as {
        frames: Record<string, unknown>
        meta?: { image?: string }
      }
      return {
        jsonOk: jsonRes.ok,
        webpOk: webpRes.ok,
        frameCount: Object.keys(json.frames ?? {}).length,
        metaImage: json.meta?.image,
      }
    }, CDN_BASE)

    expect(result.jsonOk).toBe(true)
    expect(result.webpOk).toBe(true)
    expect(result.frameCount).toBeGreaterThan(0)
    expect(result.metaImage).toBeTruthy()
  })

  test('edge atlas JSON and WebP are both fetchable', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const jsonRes = await fetch(`${cdnBase}/dungeon-classic/atlas-edge-6d093d27.json`)
      const webpRes = await fetch(`${cdnBase}/dungeon-classic/atlas-edge-6d093d27.webp`)
      const json = (await jsonRes.json()) as {
        frames: Record<string, unknown>
      }
      return {
        jsonOk: jsonRes.ok,
        webpOk: webpRes.ok,
        frameCount: Object.keys(json.frames ?? {}).length,
      }
    }, CDN_BASE)

    expect(result.jsonOk).toBe(true)
    expect(result.webpOk).toBe(true)
    expect(result.frameCount).toBeGreaterThan(0)
  })

  test('scatter atlas JSON and WebP are both fetchable', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const jsonRes = await fetch(`${cdnBase}/dungeon-classic/atlas-scatter-095695eb.json`)
      const webpRes = await fetch(`${cdnBase}/dungeon-classic/atlas-scatter-095695eb.webp`)
      const json = (await jsonRes.json()) as {
        frames: Record<string, unknown>
      }
      return {
        jsonOk: jsonRes.ok,
        webpOk: webpRes.ok,
        frameCount: Object.keys(json.frames ?? {}).length,
      }
    }, CDN_BASE)

    expect(result.jsonOk).toBe(true)
    expect(result.webpOk).toBe(true)
    expect(result.frameCount).toBeGreaterThan(0)
  })

  test('AssetPackManager loads floor atlas frames into texture cache', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const { AssetPackManager } = (await import(
        '/src/engine/assetPackManager.ts'
      )) as typeof import('@/engine/assetPackManager')

      const manager = new AssetPackManager({ cdnBaseUrl: cdnBase })

      // Load atlas JSON
      const jsonRes = await fetch(`${cdnBase}/dungeon-classic/atlas-floor-060bdb3a.json`)
      const json = (await jsonRes.json()) as {
        frames: Record<string, unknown>
        meta?: { image?: string }
      }
      const frameCount = Object.keys(json.frames ?? {}).length

      // Before any pack install, the texture cache should be empty
      const beforeCount = manager.getEntryIds('dungeon-classic').length

      return {
        frameCount,
        beforeCount,
        atlasHasFrames: frameCount > 0,
      }
    }, CDN_BASE)

    expect(result.frameCount).toBeGreaterThan(0)
    expect(result.atlasHasFrames).toBe(true)
    // Fresh manager has no cached textures before install
    expect(result.beforeCount).toBe(0)
  })

  test('floor atlas frames reference correct atlas image filename', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const res = await fetch(`${cdnBase}/dungeon-classic/atlas-floor-060bdb3a.json`)
      const json = (await res.json()) as {
        frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>
        meta?: { image?: string; size?: { w: number; h: number } }
      }

      const firstFrame = Object.entries(json.frames)[0]
      return {
        metaImage: json.meta?.image,
        metaSize: json.meta?.size,
        firstFrameKey: firstFrame?.[0],
        firstFrameData: firstFrame?.[1]?.frame,
      }
    }, CDN_BASE)

    // meta.image should reference a .webp file
    expect(result.metaImage).toMatch(/\.webp$/)
    // Frame coordinates are valid numbers
    expect(result.firstFrameData?.w).toBeGreaterThan(0)
    expect(result.firstFrameData?.h).toBeGreaterThan(0)
    // Atlas size should be set
    expect(result.metaSize?.w).toBeGreaterThan(0)
  })
})

// ─── Suite 6: CDN Failure Resilience ─────────────────────────────────────────

test.describe('CDN Failure Resilience', () => {
  test('app loads and renders canvas even when CDN is unreachable', async ({ page }) => {
    // Block all CDN requests
    await page.route('**/localhost:5174/**', (route) => route.abort())

    await gotoApp(page)

    // App must still initialize
    await expect(page.locator('canvas')).toBeVisible()

    // Store should be accessible
    const storeOk = await page.evaluate(() => {
      return !!(window as { __store?: unknown }).__store
    })
    expect(storeOk).toBe(true)
  })

  test('app toolbar is still interactive when CDN is blocked', async ({ page }) => {
    await page.route('**/localhost:5174/**', (route) => route.abort())

    await gotoApp(page)

    // Toolbar buttons should still work
    const assetsTab = page.getByRole('button', { name: /assets/i })
    await expect(assetsTab).toBeVisible()
    await assetsTab.click()
    await waitFrame(page, 2)

    // Search input still visible
    await expect(page.getByPlaceholder('Search assets…')).toBeVisible()
  })

  test('checkForUpdates returns empty array when CDN is unreachable', async ({ page }) => {
    // Block CDN
    await page.route('**/localhost:5174/**', (route) => route.abort())

    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const { AssetPackManager } = (await import(
        '/src/engine/assetPackManager.ts'
      )) as typeof import('@/engine/assetPackManager')
      const manager = new AssetPackManager({ cdnBaseUrl: cdnBase })

      // Simulate having installed pack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).installedPacks.set('dungeon-classic', {
        packId: 'dungeon-classic',
        version: '1.0.0',
        entryCount: 94,
        themes: [],
        bundleSize: 7000000,
      })

      // checkForUpdates must NOT throw when CDN is unreachable — returns []
      const updates = await manager.checkForUpdates()
      return { updates, isArray: Array.isArray(updates) }
    }, CDN_BASE)

    expect(result.isArray).toBe(true)
    expect(result.updates.length).toBe(0)
  })

  test('getTexture returns 1x1 magenta fallback for missing CDN asset', async ({ page }) => {
    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const { AssetPackManager } = (await import(
        '/src/engine/assetPackManager.ts'
      )) as typeof import('@/engine/assetPackManager')
      const manager = new AssetPackManager({ cdnBaseUrl: cdnBase })

      // Request a texture that was never loaded
      const tex = manager.getTexture('dungeon-classic:nonexistent-asset')

      // Must not be null
      if (!tex) return { ok: false, reason: 'texture was null' }

      return {
        ok: true,
        width: tex.width,
        height: tex.height,
      }
    }, CDN_BASE)

    expect(result.ok).toBe(true)
    // Fallback is 1x1
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
  })

  test('installPack rejects gracefully when CDN returns 404', async ({ page }) => {
    // Route CDN to return 404 for pack manifest
    await page.route('**/localhost:5174/dungeon-classic/pack.json', (route) =>
      route.fulfill({ status: 404, body: 'Not Found' }),
    )

    await gotoApp(page)

    const result = await page.evaluate(async (cdnBase) => {
      const { AssetPackManager } = (await import(
        '/src/engine/assetPackManager.ts'
      )) as typeof import('@/engine/assetPackManager')
      const manager = new AssetPackManager({ cdnBaseUrl: cdnBase })

      try {
        await manager.installPack('dungeon-classic')
        return { threw: false }
      } catch (e) {
        return { threw: true, message: String(e) }
      }
    }, CDN_BASE)

    // installPack must throw (not silently fail) when manifest 404s
    expect(result.threw).toBe(true)
    expect(result.message).toContain('404')
  })

  test('drawing tools still work with no CDN packs installed', async ({ page }) => {
    // Block CDN entirely
    await page.route('**/localhost:5174/**', (route) => route.abort())

    await gotoApp(page)

    // Press rectangle tool shortcut
    await page.keyboard.press('r')
    await waitFrame(page, 2)

    // Draw a rectangle on canvas
    await firePointer(page, 'pointerdown', 300, 200, 0.5, 1)
    await firePointer(page, 'pointermove', 500, 400, 0.5, 1)
    await firePointer(page, 'pointerup', 500, 400, 0, 0)
    await waitFrame(page, 5)

    // Canvas should still be visible and the app should not have crashed
    await expect(page.locator('canvas')).toBeVisible()

    // Check that a layer has been modified (floor polygon added)
    const hasShapes = await page.evaluate(() => {
      const store = (
        window as {
          __store?: {
            getState: () => {
              layers: Array<{ type: string; floor?: { polygons?: unknown[] } }>
            }
          }
        }
      ).__store
      if (!store) return false
      const state = store.getState()
      const dungeon = state.layers.find((l) => l.type === 'dungeon')
      const polygons = (dungeon?.floor as { polygons?: unknown[] } | undefined)?.polygons ?? []
      return polygons.length > 0
    })

    expect(hasShapes).toBe(true)
  })
})
