import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

/**
 * The prop lights pass in the editor: stamping a lit large candle brings its light, attached;
 * a double-click on the candle switches the light off and the candle to its unlit picture;
 * undo puts both back. Written by the builder and run once in P5.
 */

const CANDLE = 'gg-demo:light_candle_large_lit_1x1_object_A'

type Child = { id: string; childType: string; assetId?: string; attachedTo?: string; visible?: boolean; position?: { x: number; y: number } }

const children = (page: Page) =>
  page.evaluate(() => {
    const store = (window as Window & { __store?: { getState: () => { layers: { type: string; children: Child[] }[] } } }).__store!
    return store.getState().layers.flatMap((l) => (l.type === 'dungeon' ? l.children : []))
  }) as Promise<Child[]>

/** A world point as page px on the canvas: through the world container's own transform. */
const toPage = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) => {
      const app = (window as Window & {
        __pixiApp?: { canvas: HTMLCanvasElement; stage: { children: { toGlobal: (p: { x: number; y: number }) => { x: number; y: number } }[] } }
      }).__pixiApp!
      const p = app.stage.children[0]!.toGlobal({ x, y })
      const rect = app.canvas.getBoundingClientRect()
      return { x: rect.left + p.x, y: rect.top + p.y }
    },
    { x, y },
  )

/** The texture a placed prop's sprite shows, by identity. */
const textureOf = (page: Page, propId: string) =>
  page.evaluate((id) => {
    const app = (window as Window & { __pixiApp?: { stage: unknown } }).__pixiApp!
    const find = (node: unknown): { texture?: { uid?: number } } | null => {
      const n = node as { label?: string; children?: unknown[] }
      if (n.label === `placed-${id}`) return n as { texture?: { uid?: number } }
      for (const c of n.children ?? []) {
        const hit = find(c)
        if (hit) return hit
      }
      return null
    }
    return find(app.stage)?.texture?.uid ?? null
  }, propId)

test('a stamped lit candle brings its light, a double-click puts both out, undo lights them again', async ({ page }) => {
  test.setTimeout(180_000)
  await gotoApp(page)
  await page.evaluate((asset) => {
    const store = (window as Window & {
      __store?: { getState: () => { updateScatterBrushSettings: (p: unknown) => void; setActiveTool: (t: string) => void } }
    }).__store!
    store.getState().updateScatterBrushSettings({ assetIds: [asset], stampMode: true, stampVary: false })
    store.getState().setActiveTool('scatterBrush')
  }, CANDLE)
  // Picking the candle fetches its texture behind the loading screen, which takes clicks until it goes.
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 120_000 })
  await waitFrame(page, 2)

  // Stamp it in the middle of the map's own canvas (the engine's element: the editor gives it no test id).
  const box = await page.evaluate(() => {
    const r = (window as Window & { __pixiApp?: { canvas: HTMLCanvasElement } }).__pixiApp!.canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(async () => (await children(page)).filter((c) => c.childType === 'asset').length).toBe(1)
  const placed = await children(page)
  const candle = placed.find((c) => c.childType === 'asset')!
  const light = placed.find((c) => c.childType === 'light')
  expect(candle.assetId).toBe(CANDLE)
  expect(light, 'the candle brought a light').toBeDefined()
  expect(light!.attachedTo).toBe(candle.id)
  expect(light!.visible).toBe(true)
  await expect.poll(() => textureOf(page, candle.id)).not.toBeNull()
  const lit = await textureOf(page, candle.id)

  // Double-click the candle off its centre, clear of the light's bulb, with Select in hand.
  await page.evaluate(() => {
    const store = (window as Window & { __store?: { getState: () => { setActiveTool: (t: string) => void } } }).__store!
    store.getState().setActiveTool('select')
  })
  await waitFrame(page, 2)
  const at = await toPage(page, candle.position!.x + 0.38, candle.position!.y + 0.38)
  await page.mouse.dblclick(at.x, at.y)
  await expect.poll(async () => (await children(page)).find((c) => c.id === light!.id)?.visible).toBe(false)
  await expect.poll(() => textureOf(page, candle.id)).not.toBe(lit)
  // Nothing is written on the prop: it still names its lit picture.
  expect((await children(page)).find((c) => c.id === candle.id)?.assetId).toBe(CANDLE)

  // One undo puts the light and the picture back.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await children(page)).find((c) => c.id === light!.id)?.visible).toBe(true)
  await expect.poll(() => textureOf(page, candle.id)).toBe(lit)
})
