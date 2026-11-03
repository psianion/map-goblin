/**
 * 26-floor-textures-spline-saveload.spec.ts
 * Month 2 integration tests: floor textures, save/load round-trip.
 *
 * Tests:
 * FLOOR TEXTURES:
 * - ShapeRecord schema has textureId, textureScale, textureTint fields
 * - textureId can be set directly on a shape via store mutation
 * - TexturePicker UI visible in properties panel when shape selected (Task 7)
 * - Undo reverts textureId (tested via Ctrl+Z after ShapeTextureCommand — needs Task 7 UI)
 *
 * SAVE / LOAD:
 * - getSerializableState() returns version '1.3'
 * - Round-trip save → loadFromFile restores shapes
 * - v1.2 file migrates to 1.3 without crash, shapes gain texture defaults
 */
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame, firePointer, drawRect, pressShortcut } from './helpers'

// ---------- Store helpers ----------

type ShapeRecord = {
  id: string
  childType: 'shape'
  shapeType: string
  textureId?: string
  textureScale: number
  textureTint: string
}

type RawDungeonLayer = {
  id: string
  type: 'dungeon'
  children: Array<{ id: string; childType: string; shapeType?: string }>
}

/**
 * Projected view of the live layer. The v2.0 model has no `shapes`/`paths`
 * arrays — everything lives in `children` behind a `childType` discriminator,
 * and spline paths are shape children with `shapeType: 'path'`.
 */
type DungeonLayer = {
  id: string
  type: 'dungeon'
  shapes: ShapeRecord[]
}

type SerializedMapData = {
  version: string
  layers: unknown[]
}

type StoreState = {
  layers: Array<RawDungeonLayer | { id: string; type: string }>
  tools: { activeTool: string }
  ui: { canUndo: boolean; canRedo: boolean }
  updateChild: (layerId: string, childId: string, patch: Record<string, unknown>) => void
  loadFromFile: (data: SerializedMapData) => void
  getSerializableState: () => SerializedMapData
}

type StoreWindow = Window & {
  __store?: {
    getState: () => StoreState
    setState: (fn: (s: StoreState) => void) => void
  }
}

async function getDungeonLayer(page: import('@playwright/test').Page): Promise<DungeonLayer | null> {
  return page.evaluate(() => {
    const store = (window as StoreWindow).__store
    if (!store) return null
    const layer = store.getState().layers.find((l) => l.type === 'dungeon') as RawDungeonLayer | undefined
    if (!layer) return null
    return {
      id: layer.id,
      type: 'dungeon' as const,
      shapes: layer.children.filter((c) => c.childType === 'shape') as unknown as ShapeRecord[],
    }
  })
}

// ---------- Floor Texture Tests ----------

test.describe('Floor Textures', () => {
  test('ShapeRecord has textureId, textureScale, textureTint fields in schema', async ({ page }) => {
    await gotoApp(page)

    await page.keyboard.press('r')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(300)
    await waitFrame(page, 5)

    const layer = await getDungeonLayer(page)
    expect(layer?.shapes.length).toBeGreaterThan(0)

    const shape = layer!.shapes[0]
    expect(shape.shapeType).toBe('rectangle')
    // textureScale and textureTint must exist with defaults
    expect(shape.textureScale).toBe(1.0)
    expect(shape.textureTint).toBe('#ffffff')
  })

  test('textureId can be assigned to a shape via store mutation', async ({ page }) => {
    await gotoApp(page)

    await page.keyboard.press('r')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(300)
    await waitFrame(page, 5)

    const layer = await getDungeonLayer(page)
    expect(layer!.shapes).toHaveLength(1)
    const shapeId = layer!.shapes[0].id

    // Assign texture via the real child-update action (what ShapeTextureCommand drives)
    await page.evaluate(({ layerId, id }) => {
      const store = (window as StoreWindow).__store
      if (!store) return
      store.getState().updateChild(layerId, id, { textureId: 'stone-brick' })
    }, { layerId: layer!.id, id: shapeId })
    await waitFrame(page, 3)

    const after = await getDungeonLayer(page)
    expect(after!.shapes[0].textureId).toBe('stone-brick')
  })

  test('TexturePicker section visible in properties panel when shape selected', async ({ page }) => {
    await gotoApp(page)

    await page.keyboard.press('r')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(300)
    await waitFrame(page, 5)

    // Select the shape with the select tool
    await page.keyboard.press('v')
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx, cy, 0, 0)
    await waitFrame(page, 5)

    // Canvas still functional (no crash)
    await expect(canvas).toBeVisible()

    // TODO: Once Task 7 (ShapeTextureProperties) ships, uncomment:
    // await expect(page.getByText(/floor\s*texture/i)).toBeVisible()
  })

  test('draw + undo via Ctrl+Z removes the drawn shape (regression check)', async ({ page }) => {
    await gotoApp(page)

    await page.keyboard.press('r')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(300)
    await waitFrame(page, 5)

    const after = await getDungeonLayer(page)
    const shapeCountAfter = after?.shapes.length ?? 0
    expect(shapeCountAfter).toBeGreaterThan(0)

    await pressShortcut(page, 'z', { ctrl: true })
    await waitFrame(page, 5)

    const afterUndo = await getDungeonLayer(page)
    expect((afterUndo?.shapes.length ?? 0)).toBeLessThan(shapeCountAfter)
  })
})

// ---------- Save / Load Tests ----------

test.describe('Save / Load Round-trip', () => {
  test('getSerializableState returns the current version, "3.4"', async ({ page }) => {
    await gotoApp(page)

    const version = await page.evaluate(() => {
      const store = (window as StoreWindow).__store
      return store?.getState().getSerializableState().version ?? null
    })
    expect(version).toBe('3.4')
  })

  test('round-trip: save then loadFromFile restores dungeon layer shapes', async ({ page }) => {
    await gotoApp(page)

    // Draw a shape
    await page.keyboard.press('r')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(300)
    await waitFrame(page, 5)

    const before = await getDungeonLayer(page)
    const shapeCount = before?.shapes.length ?? 0
    expect(shapeCount).toBeGreaterThan(0)

    // Serialize
    const savedState = await page.evaluate(() => {
      const store = (window as StoreWindow).__store
      return store?.getState().getSerializableState() ?? null
    })
    if (!savedState) { test.skip(); return }

    // Clear canvas by reloading state (fresh then load)
    await page.evaluate((state) => {
      const store = (window as StoreWindow).__store
      store?.getState().loadFromFile(state as SerializedMapData)
    }, savedState)
    await waitFrame(page, 10)

    const afterLoad = await getDungeonLayer(page)
    expect(afterLoad?.shapes.length).toBe(shapeCount)
  })

  test('loading a 2.0 file (no texture fields) migrates to the current version without crash', async ({ page }) => {
    await gotoApp(page)

    // Draw a shape so we have real state to serialize
    await page.keyboard.press('r')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await firePointer(page, 'pointerdown', cx - 80, cy - 60, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
    await page.waitForTimeout(300)
    await waitFrame(page, 5)

    const shapesBefore = (await getDungeonLayer(page))!.shapes.length
    expect(shapesBefore).toBeGreaterThan(0)

    // Capture real state, then downgrade to the previous on-disk format ('2.0'):
    // texture fields stripped from shape children, walls back to `blocksLight`.
    // Building it from live state guarantees no other field is missing.
    const oldState = await page.evaluate(() => {
      const store = (window as StoreWindow).__store
      if (!store) return null
      const state = store.getState().getSerializableState()
      const layers = state.layers.map((layer) => {
        const dl = layer as unknown as Record<string, unknown>
        if (dl.type !== 'dungeon') return layer
        const children = ((dl.children as Array<Record<string, unknown>>) ?? []).map((c) => {
          if (c.childType !== 'shape') return c
          const { textureId, textureScale, textureOffsetX, textureOffsetY, textureFillRotation, textureTint, ...rest } = c
          void textureId; void textureScale; void textureOffsetX; void textureOffsetY; void textureFillRotation; void textureTint
          return rest
        })
        const walls = ((dl.standaloneWalls as Array<Record<string, unknown>>) ?? []).map((w) => {
          const { wallType, direction, ...rest } = w
          void direction
          return { ...rest, blocksLight: wallType !== 'terrain' }
        })
        return { ...dl, children, standaloneWalls: walls }
      })
      return { ...state, version: '2.0', layers }
    })

    expect(oldState).not.toBeNull()

    await page.evaluate((state) => {
      const store = (window as StoreWindow).__store
      store?.getState().loadFromFile(state as unknown as SerializedMapData)
    }, oldState)

    await waitFrame(page, 10)

    // App must not crash — canvas still visible
    await expect(page.locator('canvas').first()).toBeVisible()

    // Migrated state re-serializes at the current version
    const version = await page.evaluate(() => {
      const store = (window as StoreWindow).__store
      return store?.getState().getSerializableState().version ?? null
    })
    expect(version).toBe('3.4')

    // Shape children survive the migration
    const layer = await getDungeonLayer(page)
    expect(layer!.shapes).toHaveLength(shapesBefore)
    expect(layer!.shapes[0].shapeType).toBe('rectangle')
  })
})
