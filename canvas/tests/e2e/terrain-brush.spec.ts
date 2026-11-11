import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { dockColumns, floorArtLanded, lookAt, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

type Pt = { x: number; y: number }
type Rgb = { r: number; g: number; b: number }

const sharp = createRequire(fileURLToPath(new URL('../../../packages/vault-engine/package.json', import.meta.url)))('sharp')

const brush = (page: Page) =>
  page.evaluate(() => {
    const b = (window as Any).__store.getState().tools.settings.terrainBrush
    return { radius: b.radius as number, strength: b.strength as number, tint: b.tintColor as string, alpha: b.tintOpacity as number }
  })

/** World `p` on the page. */
async function screenOf(page: Page, p: Pt): Promise<Pt> {
  return page.evaluate(([x, y]) => {
    const app = (window as Any).__pixiApp
    const r = app.canvas.getBoundingClientRect()
    const w = app.stage.children[0]
    return { x: r.left + x * w.scale.x + w.position.x, y: r.top + y * w.scale.x + w.position.y }
  }, [p.x, p.y])
}

/** The mean colour of the world box half a cell round `p`: the middle of a stroke, not one texel of it. */
async function meanAt(page: Page, p: Pt): Promise<Rgb> {
  const a = await screenOf(page, { x: p.x - 0.5, y: p.y - 0.5 })
  const b = await screenOf(page, { x: p.x + 0.5, y: p.y + 0.5 })
  const png = await page.screenshot({ clip: { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(b.x - a.x), height: Math.round(b.y - a.y) } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const sum = { r: 0, g: 0, b: 0 }
  const n = info.width * info.height
  for (let i = 0; i < n; i++) {
    sum.r += data[i * info.channels]
    sum.g += data[i * info.channels + 1]
    sum.b += data[i * info.channels + 2]
  }
  return { r: sum.r / n, g: sum.g / n, b: sum.b / n }
}

const lum = (c: Rgb) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b

/** Hold the brush still on world `p` for `ms`, then take the pointer off the map. */
async function hold(page: Page, p: Pt, ms: number): Promise<void> {
  const at = await screenOf(page, p)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
  await page.mouse.move(1390, 700)
  await waitFrame(page, 8)
}

/** Intensity through its dock slider: Home is the lowest, End full. */
async function setIntensity(page: Page, key: 'Home' | 'End'): Promise<void> {
  const slider = page.getByTestId('shell-dock').getByRole('group', { name: 'Intensity' }).getByRole('slider')
  await slider.focus()
  await page.keyboard.press(key)
}

// The Terrain brush, Dungeondraft style: holding the brush still adds paint over time,
// Intensity setting how fast. Three seconds held at the lowest intensity lay a little, one
// second at full lays the texture solid; the colour tints a hold; undo takes all three back.
test('terrain brush: a held brush builds paint at the intensity set, and undo takes it back', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Terrain brush')
  // The floor's own art: the bare readings are of the painted floor, not its stand-in, and the
  // palette tile is one that has already landed.
  await expect.poll(() => floorArtLanded(page), { message: 'the floor texture lands' }).toBe(true)
  await page.evaluate(() =>
    (window as Any).__store.getState().setTerrainData({ palette: ['gg-demo:floor_small_8x8_floor_A', null, null, null, null, null] }),
  )
  await waitFrame(page, 10)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'Size', 'Intensity', 'slots'])
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel.locator('[data-setting="terrain.mode"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.smoothBlend"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.fill"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.colour"]')).toBeVisible()
  await expect(page.getByTestId('shell-status-hint')).toContainText('Hold to build up')

  // Size: ] and the wheel step it.
  const r0 = (await brush(page)).radius
  await page.mouse.move(900, 300)
  await page.keyboard.press(']')
  expect((await brush(page)).radius).toBe(r0 + 0.5)
  await page.mouse.wheel(0, 100)
  await waitFrame(page, 2)
  expect((await brush(page)).radius).toBe(r0)

  // A one-cell brush, Warren Hall close up, so three holds fit in its open floor apart.
  await page.evaluate(() => (window as Any).__store.getState().updateTerrainBrushSettings({ radius: 1 }))
  await lookAt(page, { x: 20, y: 26.5 }, 30)
  // Clear floor, two cells from every prop and light and three from the cave's edge.
  const spots: Pt[] = [
    { x: 22.5, y: 23.5 },
    { x: 24.5, y: 26.5 },
    { x: 15, y: 29 },
  ]
  const bare: Rgb[] = []
  for (const s of spots) bare.push(await meanAt(page, s))

  // Three seconds at the lowest intensity lay a little paint.
  await setIntensity(page, 'Home')
  expect((await brush(page)).strength).toBe(0.1)
  await hold(page, spots[0], 3000)
  const low = await meanAt(page, spots[0])

  // One second at full intensity lays the texture solid.
  await setIntensity(page, 'End')
  expect((await brush(page)).strength).toBe(1)
  await hold(page, spots[1], 1000)
  const full = await meanAt(page, spots[1])
  console.log(`terrain lum: bare ${bare.map((c) => lum(c).toFixed(1)).join('/')}, low ${lum(low).toFixed(1)}, full ${lum(full).toFixed(1)}`)
  expect(Math.abs(lum(low) - lum(bare[0])), 'three seconds at low intensity paint a little').toBeGreaterThan(3)
  expect(Math.abs(lum(full) - lum(bare[1])), 'a second at full intensity paints').toBeGreaterThan(30)
  expect(Math.abs(lum(full) - lum(bare[1])) - Math.abs(lum(low) - lum(bare[0])), 'intensity changes how fast paint builds').toBeGreaterThan(15)

  // One colour with alpha: red at 80% tints a hold.
  await panel.locator('[data-setting="terrain.colour"]').getByRole('button', { name: 'Colour' }).click()
  await page.getByRole('textbox', { name: 'Colour hex' }).fill('#ff0000cc')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Colour hex' })).toBeHidden()
  expect(await brush(page)).toMatchObject({ tint: '#ff0000', alpha: 0.8 })
  await hold(page, spots[2], 1000)
  const red = await meanAt(page, spots[2])
  expect(red.r - red.g, 'the hold is tinted').toBeGreaterThan(40)
  await shot(page, '11-terrain')

  // Undo takes the three holds back, last first.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  for (const i of [2, 1, 0]) {
    await undo.click()
    await expect.poll(async () => Math.abs(lum(await meanAt(page, spots[i])) - lum(bare[i]))).toBeLessThan(3)
  }
})
