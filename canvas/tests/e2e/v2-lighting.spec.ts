import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Lighting in /v2, end to end, on a copy of the goblin warren, every run under `?freeze=`
 * (the clock, the flicker and the fades stand still): a torch placed from its preset tile,
 * its rings and handles, a cone, a darkness source over a torch, a room's mood, levels kept
 * apart, a glowing prop, a prop that blocks light, a prop's shadow switched off, a night-only
 * light at noon, a light through a wall, the Sky & mood sheet, export at two hours, sixty
 * lights at once, one undo per gesture, and no accent colour in the new CSS. The lighting
 * falls on drawn content only: bare sheet keeps the paper colour at night and under a torch,
 * and a floor at noon outdoors reads as drawn.
 *
 * Pixel checks read the mean brightness of a small box on the canvas (the lit preview on,
 * `?e2e=1` keeping the drawing buffer) and compare two states of the same box, never an
 * absolute value, so a palette tweak moves both sides.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

const NOON = 720
const NIGHT = 120

async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const world = () => w.__pixiApp.stage.children[0]
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = world()
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

/** Into /v2 under a freeze at `minutes`, the lit preview on, on a fresh copy of the warren. */
async function openWarren(page: Page, minutes = NOON, lit = true): Promise<void> {
  await page.addInitScript((lit) => localStorage.setItem('mapbuilder-lit-preview', lit ? '1' : '0'), lit)
  await page.goto(`/v2?e2e=1&freeze=${minutes}`)
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
  }, WARREN)
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.setActiveTool('select')
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
}

/** Every authored light off, and the map underground, so a test's own light is the only one. */
async function darkStage(page: Page, environment = 'underground'): Promise<void> {
  await page.evaluate((environment) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      if (l.type !== 'dungeon') continue
      for (const c of l.children) if (c.childType === 'light') st.updateChild(l.id, c.id, { visible: false })
    }
    st.setEnvironmentSettings({ environment, naturalLight: false })
  }, environment)
  await waitFrame(page, 4)
}

let seq = 0
/** A light on the active layer, as the Light tool would write it, by store. */
async function addLight(page: Page, at: { x: number; y: number }, patch: Record<string, unknown> = {}): Promise<string> {
  const id = `qa-light-${++seq}`
  await page.evaluate(
    ({ id, at, patch }) => {
      const st = (window as Any).__store.getState()
      st.addChild(st.ui.activeLayerId, {
        id,
        name: id,
        childType: 'light',
        visible: true,
        color: '#ffb561',
        radius: 8,
        featherRadius: 4,
        intensity: 0.9,
        falloff: 'quadratic',
        position: at,
        ...patch,
      })
    },
    { id, at, patch },
  )
  await waitFrame(page, 4)
  return id
}

const roomAnchor = (page: Page, name: string) =>
  inPage<{ x: number; y: number }>(page, `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return { x: r.anchor[0], y: r.anchor[1] } }`, name)

/** Bare floor just above a room's anchor: the anchor itself carries the room's label chip, drawn over the lighting. */
const floorNear = (anchor: { x: number; y: number }) => ({ x: anchor.x, y: anchor.y - 1.5 })

const lightOf = (page: Page, id: string) =>
  inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

const undo = async (page: Page) => {
  await blur(page)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 3)
}

/** Mean brightness (0..255) of a box `half` CSS px around world point `p`. */
async function lum(page: Page, p: { x: number; y: number }, half = 4): Promise<number> {
  await waitFrame(page, 3)
  return page.evaluate(
    ({ p, half }) => {
      const w = window as Any
      const gl = w.__pixiApp.canvas as HTMLCanvasElement
      const r = gl.getBoundingClientRect()
      const wd = w.__pixiApp.stage.children[0]
      const sx = p.x * wd.scale.x + wd.position.x
      const sy = p.y * wd.scale.x + wd.position.y
      const k = gl.width / r.width
      const size = Math.max(1, Math.round(2 * half * k))
      const c = document.createElement('canvas')
      c.width = size
      c.height = size
      const ctx = c.getContext('2d')!
      ctx.drawImage(gl, (sx - half) * k, (sy - half) * k, size, size, 0, 0, size, size)
      const d = ctx.getImageData(0, 0, size, size).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return sum / (d.length / 4)
    },
    { p, half },
  )
}

/** Flip the Lit preview (key I). */
async function toggleLit(page: Page): Promise<void> {
  await blur(page)
  await page.keyboard.press('i')
  await waitFrame(page, 4)
}

/**
 * A point of bare sheet inside the map's frame: the centre of a box of plain paper between
 * the rooms (inside their bounding box, which the frame encloses), read with the Lit preview
 * off. `clear` is the CSS px the paper has to run on around the point. The grid's dots run on
 * across the sheet, so they are switched off first.
 */
async function bareSheet(page: Page, clear = 14): Promise<{ x: number; y: number }> {
  await page.evaluate(() => (window as Any).__store.getState().setGridVisible(false))
  await waitFrame(page, 4)
  const found = await page.evaluate((clear) => {
    const w = window as Any
    const s = w.__store.getState()
    const layer = s.layers.find((l: Any) => l.id === s.ui.activeLayerId)
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const r of layer.rooms) {
      for (const [x, y] of r.face) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    const css = getComputedStyle(document.documentElement).getPropertyValue('--v2-sheet').trim() || '#fbfbfb'
    const sheet = parseInt(css.replace('#', ''), 16)
    const paper = [(sheet >> 16) & 0xff, (sheet >> 8) & 0xff, sheet & 0xff]
    const gl = w.__pixiApp.canvas as HTMLCanvasElement
    const rect = gl.getBoundingClientRect()
    const k = gl.width / rect.width
    const c = document.createElement('canvas')
    c.width = gl.width
    c.height = gl.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(gl, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    const wd = w.__pixiApp.stage.children[0]
    const isPaper = (px: number, py: number): boolean => {
      const i = (Math.round(py) * c.width + Math.round(px)) * 4
      return Math.abs(data[i] - paper[0]) <= 1 && Math.abs(data[i + 1] - paper[1]) <= 1 && Math.abs(data[i + 2] - paper[2]) <= 1
    }
    for (let y = minY + 1; y <= maxY - 1; y += 0.5) {
      for (let x = minX + 1; x <= maxX - 1; x += 0.5) {
        const sx = (x * wd.scale.x + wd.position.x) * k
        const sy = (y * wd.scale.x + wd.position.y) * k
        const r = clear * k
        if (sx - r < 0 || sy - r < 0 || sx + r >= c.width || sy + r >= c.height) continue
        let ok = true
        for (let dy = -r; ok && dy <= r; dy += 1) for (let dx = -r; ok && dx <= r; dx += 1) ok = isPaper(sx + dx, sy + dy)
        if (ok) return { x, y }
      }
    }
    return null
  }, clear)
  expect(found, 'no bare sheet between the rooms').not.toBeNull()
  return found!
}

test('bare sheet inside the map frame reads the paper colour at 02:00, Lit preview on exactly as off', async ({ page }) => {
  await openWarren(page, NIGHT)
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const floorLit = await lum(page, floor)
  await toggleLit(page)
  const at = await bareSheet(page)
  const [off, floorOff] = [await lum(page, at), await lum(page, floor)]
  await toggleLit(page)
  expect(Math.abs((await lum(page, at)) - off)).toBeLessThan(0.5)
  // The night is on all the same: the floor beside it is darker lit than unlit.
  expect(floorLit).toBeLessThan(floorOff - 10)
})

test('bare sheet under a torch pool stays the paper colour', async ({ page }) => {
  await openWarren(page, NIGHT)
  await toggleLit(page)
  const at = await bareSheet(page, 20)
  const off = await lum(page, at)
  await toggleLit(page)
  // The torch stands a little way off, so its bulb glyph is clear of the sample box.
  const dx = await page.evaluate(() => 40 / (window as Any).__pixiApp.stage.children[0].scale.x)
  await addLight(page, { x: at.x + dx, y: at.y }, { radius: 8, featherRadius: 4, intensity: 1 })
  expect(Math.abs((await lum(page, at)) - off)).toBeLessThan(0.5)
})

test('a floor cell at noon outdoors reads as drawn: within 3 luma of the unlit art', async ({ page }) => {
  await openWarren(page, NOON)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'outdoor' }))
  await waitFrame(page, 4)
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const lit = await lum(page, floor, 6)
  await toggleLit(page)
  const art = await lum(page, floor, 6)
  expect(Math.abs(lit - art)).toBeLessThan(3)
})

test('underground at a fixed 12:00 the lit preview darkens the floor; outdoor at 12:00 it does not', async ({ page }) => {
  await openWarren(page, NOON, false)
  const setEnv = (environment: string) =>
    page.evaluate(
      (environment) => (window as Any).__store.getState().setEnvironmentSettings({ environment, timeMode: 'fixed', fixedTime: 720 }),
      environment,
    )
  await setEnv('underground')
  await waitFrame(page, 4)
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const unlit = await lum(page, floor, 6)
  await toggleLit(page)
  expect(await lum(page, floor, 6)).toBeLessThan(unlit - 10)
  await setEnv('outdoor')
  await waitFrame(page, 4)
  expect(await lum(page, floor, 6)).toBeGreaterThan(unlit - 3)
})

test('placing a light with the lit preview off turns it on: the chip reads on, the canvas darkens, I turns it back off', async ({ page }) => {
  await openWarren(page, NOON, false)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'underground' }))
  await waitFrame(page, 4)
  const chip = page.getByTestId('v2-lit-chip')
  await expect(chip).toHaveText('Lit· off')
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const unlit = await lum(page, floor, 6)
  await page.keyboard.press('l')
  await expect(page.getByTestId('v2-lights-unlit')).toBeVisible()
  await page.getByRole('button', { name: 'Torch' }).click()
  // The torch goes in another room, so its pool stays off the sample.
  const nook = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s) => { const r = layer().rooms.find((x) => x.name === 'Plunder Nook'); return w2s(r.anchor[0], r.anchor[1]) }`)
  await firePointer(page, 'pointerdown', nook.x, nook.y, 0.5, 1)
  await firePointer(page, 'pointerup', nook.x, nook.y)
  await waitFrame(page, 3)
  await expect(chip).toHaveText('Lit· on')
  await expect(page.getByText('Lit preview on · press I to toggle')).toBeVisible()
  await expect(page.getByTestId('v2-lights-unlit')).toHaveCount(0)
  expect(await lum(page, floor, 6)).toBeLessThan(unlit - 10)
  await toggleLit(page)
  await expect(chip).toHaveText('Lit· off')
  expect(Math.abs((await lum(page, floor, 6)) - unlit)).toBeLessThan(1)
})

test('the Sky sheet says the map is shown unlit, and an Environment pick turns the lit preview on', async ({ page }) => {
  await openWarren(page, NOON, false)
  await page.keyboard.press('l')
  await page.getByTestId('v2-sky-toggle').click()
  const sheet = page.getByTestId('v2-sky-sheet')
  await expect(sheet.getByTestId('v2-sky-unlit')).toContainText('Shown unlit. Turn on Lit preview to see these changes.')
  await sheet.getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'Underground' }).click()
  await expect(page.getByTestId('v2-lit-chip')).toHaveText('Lit· on')
  await expect(sheet.getByTestId('v2-sky-unlit')).toHaveCount(0)
})

test('a torch from its preset tile lands where clicked as 20/40 ft, its card reads the same, and one undo removes it', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('l')
  await expect(page.getByTestId('v2-dock-tab-lights')).toHaveAttribute('aria-selected', 'true')
  const tiles = page.getByRole('group', { name: 'Light presets' }).getByRole('button')
  expect(await tiles.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label')))).toEqual([
    'Torch', 'Lantern', 'Candle', 'Brazier', 'Magical', 'Darkness',
  ])
  await page.getByRole('button', { name: 'Torch' }).click()
  await expect(page.getByTestId('v2-status-hint')).toContainText('rotate cone')

  const hall = await roomAnchor(page, 'Warren Hall')
  const at = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, hall)
  const before = await inPage<number>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'light').length`)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
  const placed = await inPage<Any>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'light').at(-1)`)
  expect(await inPage<number>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'light').length`)).toBe(before + 1)
  expect([placed.featherRadius, placed.radius, placed.animation]).toEqual([4, 8, { kind: 'flicker', speed: 1 }])

  await page.evaluate((id) => {
    const st = (window as Any).__store.getState()
    st.setActiveTool('select')
    st.setSelectedIds([id])
  }, placed.id)
  const card = page.getByTestId('v2-selection-card')
  await expect(card.getByRole('textbox', { name: 'Bright' })).toHaveValue('20')
  await expect(card.getByRole('textbox', { name: 'Dim' })).toHaveValue('40')
  await undo(page)
  expect(await inPage<number>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'light').length`)).toBe(before)
})

test('with the Light tool out, Wheel sizes bright, Shift+Wheel dim, R turns the cone and stays on the tool', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('l')
  await page.getByRole('button', { name: 'Torch' }).click()
  const defaults = () => page.evaluate(() => (window as Any).__store.getState().tools.settings.lightDefaults)
  const wheel = (deltaY: number, shiftKey = false) =>
    page.evaluate(
      ({ deltaY, shiftKey }) => {
        const c = (window as Any).__pixiApp.canvas as HTMLCanvasElement
        const r = c.getBoundingClientRect()
        c.dispatchEvent(new WheelEvent('wheel', { deltaY, shiftKey, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
      },
      { deltaY, shiftKey },
    )
  const zoom = await page.evaluate(() => (window as Any).__pixiApp.stage.children[0].scale.x)
  await wheel(-100)
  await wheel(100, true)
  expect([(await defaults()).featherRadius, (await defaults()).radius]).toEqual([5, 7])
  expect(await page.evaluate(() => (window as Any).__pixiApp.stage.children[0].scale.x)).toBe(zoom)

  await page.evaluate(() => (window as Any).__store.getState().updateLightDefaults({ cone: { angle: 90, direction: 0 } }))
  await blur(page)
  await page.keyboard.press('r')
  expect((await defaults()).cone).toEqual({ angle: 90, direction: 45 })
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.activeTool)).toBe('light')
})

test('a marquee draws above a selected light’s rings', async ({ page }) => {
  await openWarren(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), id)
  await waitFrame(page, 3)
  // From the void off the map's corner, so the press lands on nothing and starts a marquee.
  const from = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s) => w2s(-1.5, -1.5)`)
  const to = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x + 6, p.y + 6)`, hall)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  await firePointer(page, 'pointermove', to.x, to.y)
  await waitFrame(page, 3)
  const order = await page.evaluate(() => {
    const overlay = (window as Any).__pixiApp.stage.children[1]
    const labels: string[] = overlay.children.map((c: Any) => c.label)
    return { rings: labels.indexOf('lightOverlay'), rooms: labels.indexOf('roomOverlay'), marquee: labels.indexOf('toolPreview') }
  })
  await firePointer(page, 'pointerup', to.x, to.y)
  expect(order.rings).toBeGreaterThanOrEqual(0)
  expect(order.marquee).toBeGreaterThan(Math.max(order.rings, order.rooms))
})

test('the selected light shows its rings; a pointer that moves changes nothing; the dim handle drags in one undo step', async ({ page }) => {
  await openWarren(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), id)
  await waitFrame(page, 4)
  const overlay = () => page.evaluate(() => (window as Any).__lightOverlay.stats().redraws as number)
  const start = await overlay()
  const c = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, hall)
  for (let i = 0; i < 15; i++) await firePointer(page, 'pointermove', c.x + 40 + i * 3, c.y + 60)
  await waitFrame(page, 3)
  expect(await overlay()).toBe(start)

  // The dim handle sits on the ring's east point.
  const handle = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x + 8, p.y)`, hall)
  const out = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x + 12, p.y)`, hall)
  await firePointer(page, 'pointerdown', handle.x, handle.y, 0.5, 1)
  await page.evaluate((p) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true })), out)
  await page.evaluate((p) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: p.x, clientY: p.y, bubbles: true })), out)
  await waitFrame(page, 3)
  expect((await lightOf(page, id)).radius).toBe(12)
  await expect(page.getByTestId('v2-selection-card').getByRole('textbox', { name: 'Dim' })).toHaveValue('60')
  await undo(page)
  expect((await lightOf(page, id)).radius).toBe(8)
})

test('a 90° cone facing east lights east of the light and not west of it', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  const east = { x: hall.x + 3, y: hall.y }
  const west = { x: hall.x - 3, y: hall.y }
  const westFull = await lum(page, west)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), id)
  const card = page.getByTestId('v2-selection-card')
  await card.getByRole('textbox', { name: 'Cone' }).fill('90')
  await card.getByRole('textbox', { name: 'Cone' }).press('Enter')
  expect((await lightOf(page, id)).cone).toEqual({ angle: 90, direction: 0 })
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  expect(await lum(page, east)).toBeGreaterThan((await lum(page, west)) + 10)
  expect(await lum(page, west)).toBeLessThan(westFull - 10)
})

test('a darkness source over a torch: the overlap goes darker than the torch alone', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const floor = floorNear(hall)
  await addLight(page, hall)
  const torchOnly = await lum(page, floor)
  await addLight(page, hall, { darkness: true, radius: 3, featherRadius: 3, intensity: 1 })
  expect(await lum(page, floor)).toBeLessThan(torchOnly - 15)
})

test('room mood Dark darkens its own face only', async ({ page }) => {
  await openWarren(page, NOON)
  await darkStage(page, 'outdoor')
  const hall = floorNear(await roomAnchor(page, 'Warren Hall'))
  const gallery = floorNear(await roomAnchor(page, 'Web Gallery'))
  const [hallBefore, galleryBefore] = [await lum(page, hall, 6), await lum(page, gallery, 6)]
  const roomId = await inPage<string>(page, `(s, layer) => layer().rooms.find((r) => r.name === 'Warren Hall').id`)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), roomId)
  const mood = page.getByTestId('v2-look-mood')
  await mood.getByRole('group', { name: 'Darkness' }).getByRole('button', { name: 'Dark' }).click()
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  // The warren's floor reads ~76 lit at noon outdoors, the art as drawn; Dark keeps 15% of the
  // grade plus the composite's 5% floor, ~0.19 of it.
  expect(await lum(page, hall, 6)).toBeLessThan(hallBefore * 0.3)
  expect(Math.abs((await lum(page, gallery, 6)) - galleryBefore)).toBeLessThan(6)
})

/** Select the room, press a button in its card's Mood section (a Darkness pick or Reset), deselect. */
async function moodPick(page: Page, roomName: string, button: string): Promise<void> {
  const roomId = await inPage<string>(page, `(s, layer, w2s, name) => layer().rooms.find((r) => r.name === name).id`, roomName)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), roomId)
  const mood = page.getByTestId('v2-look-mood')
  const target = button === 'Reset' ? mood.getByRole('button', { name: 'Reset' }) : mood.getByRole('group', { name: 'Darkness' }).getByRole('button', { name: button })
  await target.click()
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
}

test('room mood Lit pinned on an Outdoor map reads as Inherits', async ({ page }) => {
  await openWarren(page, NOON)
  await darkStage(page, 'outdoor')
  const hall = floorNear(await roomAnchor(page, 'Warren Hall'))
  const inherits = await lum(page, hall, 6)
  await moodPick(page, 'Warren Hall', 'Lit')
  expect(Math.abs((await lum(page, hall, 6)) - inherits)).toBeLessThan(2)
})

test('room mood Dim at 02:00 is no brighter than Inherits on an Outdoor map', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page, 'outdoor')
  const hall = floorNear(await roomAnchor(page, 'Warren Hall'))
  const inherits = await lum(page, hall, 6)
  await moodPick(page, 'Warren Hall', 'Dim')
  expect(await lum(page, hall, 6)).toBeLessThan(inherits)
})

test('room mood Dark then Reset puts the room back without a reload', async ({ page }) => {
  await openWarren(page, NOON)
  await darkStage(page, 'outdoor')
  const hall = floorNear(await roomAnchor(page, 'Warren Hall'))
  const before = await lum(page, hall, 6)
  await moodPick(page, 'Warren Hall', 'Dark')
  expect(await lum(page, hall, 6)).toBeLessThan(before * 0.3)
  await moodPick(page, 'Warren Hall', 'Reset')
  expect(Math.abs((await lum(page, hall, 6)) - before)).toBeLessThan(2)
})

test('a light on level 2 does not light level 1', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const without = await lum(page, hall)
  await page.evaluate((at) => {
    const st = (window as Any).__store.getState()
    const ground = st.ui.activeLevelId ?? st.levels[0]?.id
    st.addLevel({ id: 'qa-level-2', name: 'Level 2' })
    const layerId = 'qa-l2-layer'
    const base = st.layers.find((l: Any) => l.type === 'dungeon')
    st.addLayer({ ...structuredClone(base), id: layerId, name: 'Upstairs', levelId: 'qa-level-2', children: [], rooms: [], areas: [], standaloneWalls: [] })
    st.addChild(layerId, {
      id: 'qa-l2-light', name: 'up', childType: 'light', visible: true, color: '#ffb561',
      radius: 8, featherRadius: 4, intensity: 1, falloff: 'quadratic', position: at,
    })
    if (ground) st.setActiveLevelId(ground)
  }, hall)
  await waitFrame(page, 4)
  expect(Math.abs((await lum(page, hall)) - without)).toBeLessThan(4)
})

test('a glowing prop reads bright at night while the cell beside it stays dark', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const prop = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.childType === 'asset' && !/ledge|wall|bend/.test(c.assetId))`)
  const at = prop.position
  const beside = { x: at.x + Math.max(prop.width, prop.height) * prop.scale + 1.5, y: at.y }
  const [propOff, besideOff] = [await lum(page, at, 2), await lum(page, beside, 2)]
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), prop.id)
  await page.getByTestId('v2-prop-behaviour').getByRole('switch', { name: 'Glows' }).click()
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  expect(await lum(page, at, 2)).toBeGreaterThan(propOff + 15)
  expect(Math.abs((await lum(page, beside, 2)) - besideOff)).toBeLessThan(5)
})

test('a prop that blocks light shades the floor behind it', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  await addLight(page, hall, { radius: 10, featherRadius: 6 })
  const crate = { x: hall.x + 2, y: hall.y }
  const behind = { x: hall.x + 4, y: hall.y }
  await page.evaluate((at) => {
    const st = (window as Any).__store.getState()
    st.addChild(st.ui.activeLayerId, {
      id: 'qa-crate', name: 'crate', childType: 'asset', visible: true, objectType: 'asset',
      assetId: 'gg-demo:storage_crates_1_dark_1x1_object_A', position: at, rotation: 0, scale: 1,
      width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
    })
  }, crate)
  await waitFrame(page, 4)
  const open = await lum(page, behind)
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds(['qa-crate']))
  await page.getByTestId('v2-prop-behaviour').getByRole('switch', { name: 'Blocks light and sight' }).click()
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  expect(await lum(page, behind)).toBeLessThan(open - 10)
})

test('Casts shadow off drops the prop shadow under a low sun', async ({ page }) => {
  await openWarren(page, 450)
  await darkStage(page, 'outdoor')
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ naturalLight: true, orientation: 0 }))
  // A rubble pile on open floor in the Web Gallery.
  const prop = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.id === 'asset-155-rubble')`)
  // At 07:30 with sunrise east, a prop's shadow is a short smear west along its foot. The
  // band is under half a cell tall, so the camera closes in until the sample box fits inside it.
  const shade = { x: prop.position.x - 0.35 * prop.width * prop.scale, y: prop.position.y + 0.39 * prop.height * prop.scale }
  await page.evaluate((at) => {
    const app = (window as Any).__pixiApp
    const world = app.stage.children[0]
    const r = app.canvas.getBoundingClientRect()
    world.scale.set(48)
    world.position.set(r.width / 2 - at.x * 48, r.height / 2 - at.y * 48)
  }, shade)
  const withShadow = await lum(page, shade, 3)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), prop.id)
  await page.getByTestId('v2-prop-behaviour').getByRole('switch', { name: 'Casts shadow' }).click()
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  expect(await lum(page, shade, 3)).toBeGreaterThan(withShadow + 4)
})

test('a night-only light stays off at noon', async ({ page }) => {
  await openWarren(page, NOON)
  await darkStage(page, 'outdoor')
  const hall = await roomAnchor(page, 'Warren Hall')
  const bare = await lum(page, hall)
  await addLight(page, hall, { nightOnly: { min: 0.5, max: 1 }, color: '#ff4000', intensity: 1 })
  expect(Math.abs((await lum(page, hall)) - bare)).toBeLessThan(4)
})

test('a night-only light burns at 02:00', async ({ page }) => {
  // Underground, so the light is all that brightens the floor; the night gate reads the sky.
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const floor = floorNear(hall)
  const bare = await lum(page, floor)
  await addLight(page, hall, { nightOnly: { min: 0.5, max: 1 }, intensity: 1 })
  expect(await lum(page, floor)).toBeGreaterThan(bare + 15)
})

test('Through walls lights the far side of a wall; a plain light does not', async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  // A short wall right of the hall's anchor, and a sample just past it.
  const hall = await roomAnchor(page, 'Warren Hall')
  await page.evaluate((p) => {
    const st = (window as Any).__store.getState()
    st.addWall(st.ui.activeLayerId, {
      id: 'qa-wall', points: [[p.x + 1.5, p.y - 3], [p.x + 1.5, p.y + 3]], wallType: 'normal', direction: 'both',
      color: '#222222', roughness: 0,
    })
  }, hall)
  const id = await addLight(page, hall, { radius: 6, featherRadius: 4, intensity: 1 })
  const behind = { x: hall.x + 3, y: hall.y }
  const blocked = await lum(page, behind)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), id)
  await page.getByTestId('v2-selection-card').getByRole('switch', { name: 'Through walls' }).click()
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  expect(await lum(page, behind)).toBeGreaterThan(blocked + 10)
})

test('the Sky & mood sheet saves the environment and a fixed hour to the map, one undo step each', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('l')
  await page.getByTestId('v2-sky-toggle').click()
  const sheet = page.getByTestId('v2-sky-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('v2-status-hint')).toContainText('changes save to the map; preview rows do not')
  await expect(sheet.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-expanded', 'false')
  await sheet.getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'Underground' }).click()
  await sheet.getByRole('group', { name: 'Time' }).getByRole('button', { name: 'Fixed hour' }).click()
  const hour = sheet.getByRole('slider', { name: 'Fixed hour' })
  // One key press is one gesture: a quarter hour on, one undo step.
  await hour.focus()
  await page.keyboard.press('ArrowRight')
  const env = () => inPage<Any>(page, `(s) => ({ environment: s().mapSettings.environment, timeMode: s().mapSettings.timeMode, fixedTime: s().mapSettings.fixedTime })`)
  expect(await env()).toEqual({ environment: 'underground', timeMode: 'fixed', fixedTime: NOON + 15 })
  await undo(page)
  expect((await env()).fixedTime).toBeUndefined()
  await undo(page)
  expect((await env()).timeMode).toBeUndefined()
  await undo(page)
  expect((await env()).environment).toBeUndefined()
})

test('export at 02:00 is darker than at 12:00', async ({ page }) => {
  await openWarren(page)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'outdoor' }))
  await page.keyboard.press('Control+e')
  const modal = page.getByTestId('v2-export-modal')
  await expect(modal).toBeVisible()
  if ((await modal.getByRole('switch', { name: 'Apply lighting' }).getAttribute('aria-checked')) !== 'true') {
    await modal.getByRole('switch', { name: 'Apply lighting' }).click()
  }
  const mean = async () => {
    await page.waitForTimeout(300)
    await expect(modal.getByRole('img', { name: 'Export preview' })).toBeVisible()
    return modal.getByRole('img', { name: 'Export preview' }).evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return sum / (d.length / 4)
    })
  }
  const hour = modal.getByRole('slider', { name: 'Hour' })
  await hour.fill(String(NOON))
  const noon = await mean()
  await hour.fill(String(NIGHT))
  await expect(modal.getByTestId('v2-export-lighting')).toContainText('02:00')
  const night = await mean()
  expect(night).toBeLessThan(noon - 10)
})

test('sixty lights on screen: no console error, and the farthest one still lights its floor', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const far = { x: hall.x + 5, y: hall.y + 5 }
  const bare = await lum(page, far)
  await page.evaluate(({ hall }) => {
    const st = (window as Any).__store.getState()
    for (let i = 0; i < 60; i++) {
      st.addChild(st.ui.activeLayerId, {
        id: `qa-many-${i}`, name: `m${i}`, childType: 'light', visible: true, color: '#ffd27a',
        radius: 1.5, featherRadius: 0.8, intensity: 1, falloff: 'quadratic',
        position: { x: hall.x - 5 + (i % 10), y: hall.y - 1 + Math.floor(i / 10) },
      })
    }
    st.addChild(st.ui.activeLayerId, {
      id: 'qa-far', name: 'far', childType: 'light', visible: true, color: '#ffd27a',
      radius: 1.5, featherRadius: 0.8, intensity: 1, falloff: 'quadratic', position: { x: hall.x + 5, y: hall.y + 5 },
    })
  }, { hall })
  await waitFrame(page, 8)
  expect(await lum(page, far)).toBeGreaterThan(bare + 10)
  expect(errors).toEqual([])
})

test('every gesture is one undo step: a card drag, a darkness toggle, a mood pick, a glow switch, a sky pick', async ({ page }) => {
  await openWarren(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), id)
  const card = page.getByTestId('v2-selection-card')
  const dim = card.getByRole('slider', { name: 'Dim' })
  const box = (await dim.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 })
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  expect((await lightOf(page, id)).radius).toBeGreaterThan(8)
  await undo(page)
  expect((await lightOf(page, id)).radius).toBe(8)

  await card.getByRole('switch', { name: 'Darkness source' }).click()
  expect((await lightOf(page, id)).darkness).toBe(true)
  await undo(page)
  expect((await lightOf(page, id)).darkness).toBeFalsy()

  const roomId = await inPage<string>(page, `(s, layer) => layer().rooms.find((r) => r.name === 'Warren Hall').id`)
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), roomId)
  await page.getByTestId('v2-look-mood').getByRole('group', { name: 'Darkness' }).getByRole('button', { name: 'Dim' }).click()
  const mood = () => inPage<Any>(page, `(s, layer, w2s, id) => layer().rooms.find((r) => r.id === id).look?.mood`, roomId)
  expect(await mood()).toBe('dim')
  await undo(page)
  expect(await mood()).toBeUndefined()

  await page.keyboard.press('l')
  await page.getByTestId('v2-sky-toggle').click()
  await page.getByTestId('v2-sky-sheet').getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'Outdoor' }).click()
  expect(await inPage<string>(page, `(s) => s().mapSettings.environment`)).toBe('outdoor')
  await undo(page)
  expect(await inPage<unknown>(page, `(s) => s().mapSettings.environment`)).toBeUndefined()
})

test('no accent colour in the lighting CSS: every colour it names is a grey', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/v2/editor/lighting.css', import.meta.url)), 'utf8')
  for (const hex of css.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
    const h = hex.slice(1)
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
    expect(full.slice(0, 2) === full.slice(2, 4) && full.slice(2, 4) === full.slice(4, 6), `${hex} is not a grey`).toBe(true)
  }
  for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
    expect(m[1] === m[2] && m[2] === m[3], `${m[0]} is not a grey`).toBe(true)
  }
  expect(css).not.toMatch(/hsla?\(|oklch\(/)
})
