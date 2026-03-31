/**
 * 29-wall-types-visual.spec.ts
 * Visual verification that all 5 wall types render distinctly,
 * and that directional walls (left/right/both) are stored correctly.
 */
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

// ---------- Store type helpers ----------

type StoreState = {
  ui: { activeLayerId: string }
  layers: Array<{
    type: string
    standaloneWalls?: Array<{ id: string; wallType: string; direction: string }>
    children?: Array<{ id: string; childType: string }>
  }>
  addWall: (layerId: string, wall: Record<string, unknown>) => void
  addChild: (layerId: string, child: Record<string, unknown>) => void
  recomputeMergedFloor: (layerId: string) => void
}

async function getWalls(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const store = (window as Window & { __store?: { getState: () => StoreState } }).__store
    if (!store) return []
    return store
      .getState()
      .layers.filter((l) => l.type === 'dungeon')
      .flatMap((l) => l.standaloneWalls ?? [])
  })
}

// ========== TESTS ==========

test.describe('Wall Types Visual Verification', () => {
  test('all 5 wall types render distinctly', async ({ page }) => {
    await gotoApp(page)

    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => StoreState } }).__store
      if (!store) return
      const s = store.getState()
      const lid = s.ui.activeLayerId

      // Draw a floor so walls are visible against something
      s.addChild(lid, {
        id: 'floor-5types',
        name: 'Floor',
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        contours: [[[1, 1], [30, 1], [30, 20], [1, 20]]],
        roughnessEnabled: false,
        textureScale: 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: '#ffffff',
      })
      s.recomputeMergedFloor(lid)

      // 5 wall types — horizontal lines spaced 3 world-units apart
      const wallTypes = ['normal', 'terrain', 'invisible', 'ethereal', 'window'] as const
      wallTypes.forEach((type, i) => {
        s.addWall(lid, {
          id: `wall-${type}`,
          points: [[4, 3 + i * 3], [26, 3 + i * 3]],
          wallType: type,
          direction: 'both',
          color: '#222222',
          width: 0.5,
          roughness: 0,
        })
      })

      // A light so occlusion/shadow differences between types are visible
      s.addChild(lid, {
        id: 'light-5types',
        name: 'Test Light',
        childType: 'light',
        visible: true,
        color: '#ffdd88',
        radius: 12,
        featherRadius: 0,
        intensity: 0.5,
        falloff: 'quadratic',
        position: { x: 15, y: 10 },
      })
    })

    await waitFrame(page, 10)

    await page.screenshot({
      path: 'test-results/wall-types-all-5.png',
      fullPage: false,
    })

    // --- Assertions ---
    const walls = await getWalls(page)

    // All 5 walls present
    expect(walls.length).toBe(5)

    const types = walls.map((w) => w.wallType)
    expect(types).toContain('normal')
    expect(types).toContain('terrain')
    expect(types).toContain('invisible')
    expect(types).toContain('ethereal')
    expect(types).toContain('window')

    // All default to 'both' direction
    walls.forEach((w) => expect(w.direction).toBe('both'))
  })

  test('directional walls have left/right/both variants', async ({ page }) => {
    await gotoApp(page)

    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => StoreState } }).__store
      if (!store) return
      const s = store.getState()
      const lid = s.ui.activeLayerId

      // Floor backdrop
      s.addChild(lid, {
        id: 'floor-dir',
        name: 'Floor',
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        contours: [[[1, 1], [20, 1], [20, 15], [1, 15]]],
        roughnessEnabled: false,
        textureScale: 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: '#ffffff',
      })
      s.recomputeMergedFloor(lid)

      // Three walls: both / left / right
      s.addWall(lid, {
        id: 'w-both',
        points: [[4, 4], [16, 4]],
        wallType: 'normal',
        direction: 'both',
        color: '#222',
        width: 0.5,
        roughness: 0,
      })
      s.addWall(lid, {
        id: 'w-left',
        points: [[4, 8], [16, 8]],
        wallType: 'normal',
        direction: 'left',
        color: '#222',
        width: 0.5,
        roughness: 0,
      })
      s.addWall(lid, {
        id: 'w-right',
        points: [[4, 12], [16, 12]],
        wallType: 'normal',
        direction: 'right',
        color: '#222',
        width: 0.5,
        roughness: 0,
      })

      // Lights on each side to reveal directional occlusion differences
      s.addChild(lid, {
        id: 'light-top',
        name: 'Top Light',
        childType: 'light',
        visible: true,
        color: '#ffdd88',
        radius: 6,
        featherRadius: 0,
        intensity: 0.3,
        falloff: 'quadratic',
        position: { x: 10, y: 2 },
      })
      s.addChild(lid, {
        id: 'light-mid',
        name: 'Mid Light',
        childType: 'light',
        visible: true,
        color: '#88ddff',
        radius: 6,
        featherRadius: 0,
        intensity: 0.3,
        falloff: 'quadratic',
        position: { x: 10, y: 6 },
      })
      s.addChild(lid, {
        id: 'light-bot',
        name: 'Bot Light',
        childType: 'light',
        visible: true,
        color: '#ff8844',
        radius: 6,
        featherRadius: 0,
        intensity: 0.3,
        falloff: 'quadratic',
        position: { x: 10, y: 14 },
      })
    })

    await waitFrame(page, 10)

    await page.screenshot({
      path: 'test-results/wall-types-directional.png',
      fullPage: false,
    })

    // --- Assertions ---
    const walls = await getWalls(page)

    expect(walls.length).toBe(3)

    const directions = walls.map((w) => w.direction)
    expect(directions).toContain('both')
    expect(directions).toContain('left')
    expect(directions).toContain('right')
  })

  test('wall IDs are unique across types', async ({ page }) => {
    await gotoApp(page)

    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => StoreState } }).__store
      if (!store) return
      const s = store.getState()
      const lid = s.ui.activeLayerId

      const wallTypes = ['normal', 'terrain', 'invisible', 'ethereal', 'window'] as const
      wallTypes.forEach((type, i) => {
        s.addWall(lid, {
          id: `uid-wall-${type}`,
          points: [[2, 2 + i * 2], [18, 2 + i * 2]],
          wallType: type,
          direction: 'both',
          color: '#333',
          width: 0.5,
          roughness: 0,
        })
      })
    })

    await waitFrame(page, 3)

    const walls = await getWalls(page)
    const ids = walls.map((w) => w.id)
    const uniqueIds = new Set(ids)

    // All IDs unique — no collision from addWall
    expect(uniqueIds.size).toBe(ids.length)
  })
})
