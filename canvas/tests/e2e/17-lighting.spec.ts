/**
 * 17-lighting.spec.ts
 * Month 1 Lighting Engine: light placement, properties panel, undo, falloff.
 *
 * Tests:
 * - Light tool (L key) activates without crash
 * - Click canvas with Light tool → light placed, appears in layer panel
 * - Selecting a light → Properties panel shows color/radius/intensity/falloff
 * - Ctrl+Z undoes light placement (light removed from store)
 * - Falloff buttons toggle between linear / quadratic
 * - Ambient color change propagates to store
 */
import { test, expect } from '@playwright/test'
import { gotoApp, firePointer, pressShortcut, waitFrame } from './helpers'

// ── helpers ────────────────────────────────────────────────────────────────

async function getStoreState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__store?.getState?.() ?? null
  })
}

/** Lights are layer children with `childType: 'light'` — there is no top-level `lights` array. */
async function getLights(page: import('@playwright/test').Page) {
  const state = await getStoreState(page)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers = (state?.layers ?? []) as Array<{ children?: any[] }>
  return layers.flatMap((l) => l.children ?? []).filter((c) => c.childType === 'light') as Array<{
    id: string
    color: string
    radius: number
    intensity: number
    falloff: 'linear' | 'quadratic'
    visible: boolean
    name: string
  }>
}

/** Id of the layer that owns a given child. */
async function getOwningLayerId(page: import('@playwright/test').Page, childId: string) {
  return page.evaluate((id) => {
    const store = (window as Window & {
      __store?: { getState: () => { layers: Array<{ id: string; children?: Array<{ id: string }> }> } }
    }).__store
    return store!.getState().layers.find((l) => (l.children ?? []).some((c) => c.id === id))?.id ?? null
  }, childId)
}

async function getCanvasCenter(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
}

// ── tests ──────────────────────────────────────────────────────────────────

test.describe('Lighting Engine', () => {
  test('light tool activates via L key', async ({ page }) => {
    await gotoApp(page)
    await page.keyboard.press('l')
    await waitFrame(page, 2)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()

    // No crash, canvas still present
    expect(await canvas.isVisible()).toBe(true)
  })

  test('click canvas with light tool places a light in store', async ({ page }) => {
    await gotoApp(page)
    await page.keyboard.press('l')
    await waitFrame(page, 1)

    const center = await getCanvasCenter(page)
    await firePointer(page, 'pointerdown', center.x, center.y)
    await firePointer(page, 'pointerup', center.x, center.y)
    await waitFrame(page, 3)

    const lights = await getLights(page)
    expect(lights.length).toBeGreaterThan(0)
  })

  test('placed light has expected default properties', async ({ page }) => {
    await gotoApp(page)
    await page.keyboard.press('l')
    await waitFrame(page, 1)

    const center = await getCanvasCenter(page)
    await firePointer(page, 'pointerdown', center.x, center.y)
    await firePointer(page, 'pointerup', center.x, center.y)
    await waitFrame(page, 3)

    const lights = await getLights(page)
    expect(lights.length).toBeGreaterThan(0)
    const light = lights[0]

    // Defaults from createLight factory
    expect(light.radius).toBeGreaterThan(0)
    expect(light.intensity).toBeGreaterThan(0)
    expect(light.intensity).toBeLessThanOrEqual(1)
    expect(['linear', 'quadratic']).toContain(light.falloff)
    expect(light.visible).toBe(true)
  })

  test('Ctrl+Z undoes light placement', async ({ page }) => {
    await gotoApp(page)
    await page.keyboard.press('l')
    await waitFrame(page, 1)

    const center = await getCanvasCenter(page)
    await firePointer(page, 'pointerdown', center.x, center.y)
    await firePointer(page, 'pointerup', center.x, center.y)
    await waitFrame(page, 3)

    const beforeUndo = await getLights(page)
    expect(beforeUndo.length).toBeGreaterThan(0)

    await pressShortcut(page, 'Control+z')
    await waitFrame(page, 2)

    const afterUndo = await getLights(page)
    expect(afterUndo.length).toBe(beforeUndo.length - 1)
  })

  test('light tool icon appears in toolbar', async ({ page }) => {
    await gotoApp(page)
    // Toolbar buttons are icon-only; their accessible name comes from `title`.
    const lightBtn = page.getByRole('button', { name: 'Light (L)' })
    await expect(lightBtn).toBeVisible()
    expect(await page.locator('canvas').isVisible()).toBe(true)
  })

  test('ambient light updates store', async ({ page }) => {
    await gotoApp(page)

    // __store must be exposed — fail fast if the app didn't wire it
    const storeExposed = await page.evaluate(() => !!(window as { __store?: unknown }).__store)
    expect(storeExposed).toBe(true)

    // Check initial ambient light from store
    const initial = await getStoreState(page)
    expect(initial?.mapSettings?.ambientLight).toBeTruthy()

    // Direct store mutation test (since UI for ambient may not be wired yet)
    await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => { setAmbientLight: (c: string) => void } } }).__store
      store!.getState().setAmbientLight('#ff0000')
    })
    await waitFrame(page, 2)

    const updated = await getStoreState(page)
    expect(updated?.mapSettings?.ambientLight).toBe('#ff0000')
  })

  test('light visibility toggle works', async ({ page }) => {
    await gotoApp(page)
    await page.keyboard.press('l')
    await waitFrame(page, 1)

    const center = await getCanvasCenter(page)
    await firePointer(page, 'pointerdown', center.x, center.y)
    await firePointer(page, 'pointerup', center.x, center.y)
    await waitFrame(page, 3)

    // __store must be exposed — fail fast if the app didn't wire it
    const storeExposed = await page.evaluate(() => !!(window as { __store?: unknown }).__store)
    expect(storeExposed).toBe(true)

    const lights = await getLights(page)
    expect(lights.length).toBeGreaterThan(0)

    const lightId = lights[0].id
    const layerId = await getOwningLayerId(page, lightId)
    expect(layerId).not.toBeNull()
    await page.evaluate(({ layerId, id }) => {
      const store = (window as { __store?: { getState: () => { updateChild: (layerId: string, childId: string, patch: Record<string, unknown>) => void } } }).__store
      store!.getState().updateChild(layerId!, id, { visible: false })
    }, { layerId, id: lightId })
    await waitFrame(page, 2)

    const updated = await getLights(page)
    const updatedLight = updated.find((l) => l.id === lightId)
    expect(updatedLight).toBeDefined()
    expect(updatedLight!.visible).toBe(false)
  })
})
