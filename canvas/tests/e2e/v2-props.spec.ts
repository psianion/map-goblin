import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Props in /v2, end to end, on a copy of the goblin warren: the Props tab and its second
 * B, stamping exactly the ghost, footprint snap, the dock's Scale, a scatter stroke that
 * stays on the floor and undoes in one step, an erase that spares rock and images, the
 * card's oriented W, align and distribute, z-order keys, sibling swap, lock, the group
 * card, an attached light following every edit, overhead with "See under overhead", and
 * favourites across a reload. Each map edit undoes.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

/**
 * An asset's art size in squares, read from its shipped manifest (atlas frames are the
 * natural size, 200 px a square; a "1x1" crate's art need not fill its cell).
 */
function naturalCells(assetId: string): { w: number; h: number } {
  const [packId, entryId] = assetId.split(':')
  const dir = fileURLToPath(new URL(`../../public/packs/${packId}/`, import.meta.url))
  const file = readdirSync(dir).find((n) => /^pack-.*[.]json$/.test(n))!
  const entry = JSON.parse(readFileSync(dir + file, 'utf8')).entries[entryId]
  return { w: entry.frame.w / 200, h: entry.frame.h / 200 }
}

const CRATE = 'gg-demo:storage_crates_1_dark_1x1_object_A'
const FIREWOOD = 'gg-demo:firewood_pile_2x1_object_A'
const RUBBLE_S = 'gg-demo:rubble_small_3x3_object_A'
const RUBBLE_M = 'gg-demo:rubble_medium_4x2_object_A'

/**
 * Run `fn` (source text) in the page with the store getter, the active dungeon layer and
 * a world → screen mapping. Source text, so the page needs nothing imported.
 */
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

interface PropRow {
  id: string
  assetId: string
  objectType: string
  x: number
  y: number
  rotation: number
  scale: number
  width: number
  height: number
  flipX: boolean
  flipY: boolean
  locked?: boolean
  overhead?: boolean
  groupId?: string
}

const props = (page: Page) =>
  inPage<PropRow[]>(
    page,
    `(s, layer) => layer().children.filter((c) => c.childType === 'asset').map((c) => ({
      id: c.id, assetId: c.assetId, objectType: c.objectType, x: c.position.x, y: c.position.y, rotation: c.rotation,
      scale: c.scale, width: c.width, height: c.height, flipX: c.flipX, flipY: c.flipY, locked: c.locked,
      overhead: c.overhead, groupId: c.groupId }))`,
  )

const childIds = (page: Page) => inPage<string[]>(page, `(s, layer) => layer().children.map((c) => c.id)`)

const brush = (page: Page) => inPage<Any>(page, `(s) => s().tools.settings.scatterBrush`)

const setBrush = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((patch) => (window as Any).__store.getState().updateScatterBrushSettings(patch), patch)

const select = (page: Page, ids: string[]) =>
  page.evaluate((ids) => (window as Any).__store.getState().setSelectedIds(ids), ids)

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

const undo = async (page: Page) => {
  await blur(page)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 2)
}

/** A world point on the screen. */
const screenOf = (page: Page, x: number, y: number) =>
  inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, { x, y })

/** The first prop of `assetId` on the layer. */
async function propOf(page: Page, assetId: string): Promise<PropRow> {
  const p = (await props(page)).find((c) => c.assetId === assetId)
  if (!p) throw new Error(`no ${assetId} on the map`)
  return p
}

/** A wheel notch on the canvas at a screen point. deltaY < 0 is "up". */
async function wheel(page: Page, at: { x: number; y: number }, deltaY: number, mods: { alt?: boolean; shift?: boolean; ctrl?: boolean } = {}) {
  await page.evaluate(
    ({ at, deltaY, mods }) => {
      const canvas = document.querySelector('canvas')!
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: at.x,
          clientY: at.y,
          deltaY,
          bubbles: true,
          cancelable: true,
          altKey: !!mods.alt,
          shiftKey: !!mods.shift,
          ctrlKey: !!mods.ctrl,
        }),
      )
    },
    { at, deltaY, mods },
  )
  await waitFrame(page, 1)
}

/** A right-click on the canvas at a screen point. */
async function rightClick(page: Page, at: { x: number; y: number }) {
  await page.evaluate((at) => {
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y, button: 2, bubbles: true, cancelable: true }))
  }, at)
  await waitFrame(page, 2)
}

async function click(page: Page, at: { x: number; y: number }, mods: { shift?: boolean; ctrl?: boolean } = {}) {
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
  await waitFrame(page, 2)
}

/** Into the /v2 editor on a fresh blank map. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
}

/** Open a copy of the goblin warren, framed, its rooms measured, the packs' catalogue in. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
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

/** A room's face centre (its anchor) in world units. */
const roomAnchor = (page: Page, name: string) =>
  inPage<{ x: number; y: number }>(
    page,
    `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return { x: r.anchor[0], y: r.anchor[1] } }`,
    name,
  )

test('B opens the Props tab, B again never folds the dock, and the dock row fits at 1366 px', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await openWarren(page)
  // A starred barrel leads the strip; a crate in hand gives the variant stepper a family.
  await page.evaluate((id) => (window as Any).__store.getState().toggleFavourite(id), 'gg-demo:storage_barrel_1_dark_1x1_object_A')
  await page.keyboard.press('b')
  await waitFrame(page, 2)
  await setBrush(page, { stampMode: true, assetIds: [CRATE], stampRotation: Math.PI / 6 })
  await expect(page.getByTestId('v2-dock-tab-props')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('v2-tool-scatterBrush')).toHaveAttribute('aria-label', 'Props (B)')
  await expect(page.getByTestId('v2-status-hint')).toContainText('rotate 15°')
  await expect(page.getByTestId('v2-props-variant')).toContainText('/')

  await page.keyboard.press('b')
  await waitFrame(page, 2)
  await expect(page.getByTestId('v2-dock-toggle')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('b')
  await waitFrame(page, 2)
  await expect(page.getByTestId('v2-dock-toggle')).toHaveAttribute('aria-expanded', 'true')

  // The row fits the dock: nothing in it is pushed past the dock's edge.
  const fit = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="v2-dock"]')!.getBoundingClientRect()
    const body = document.querySelector('.v2-dock__body')!
    const right = Math.max(...[...body.children].map((c) => c.getBoundingClientRect().right))
    return { dockRight: dock.right, contentRight: right, dockWidth: dock.width, overflow: body.scrollWidth - body.clientWidth }
  })
  expect(fit.contentRight).toBeLessThanOrEqual(fit.dockRight + 0.5)
  expect(fit.overflow).toBeLessThanOrEqual(0)
  const dockBox = (await page.getByTestId('v2-dock').boundingBox())!
  // Over the chrome, so the auto focus mode shows it at full strength.
  await page.mouse.move(dockBox.x + dockBox.width / 2, dockBox.y + 8)
  await waitFrame(page, 10)
  await page.screenshot({ path: test.info().outputPath('dock-stamp-1366.png'), clip: { x: dockBox.x - 8, y: dockBox.y - 8, width: dockBox.width + 16, height: dockBox.height + 40 } })
  await page.screenshot({ path: test.info().outputPath('stamp-1366.png') })

  // Scatter mode fits too, its "⋯" card open.
  await page.getByRole('button', { name: 'Scatter' }).click()
  await page.getByTestId('v2-props-more').click()
  await expect(page.getByRole('dialog', { name: 'Scatter settings' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('dock-scatter-1366.png') })
  // Tab is still the only key that folds it.
  await page.keyboard.press('Escape')
  await blur(page)
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('v2-dock-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('b')
  await expect(page.getByTestId('v2-dock-toggle')).toHaveAttribute('aria-expanded', 'true')
})

test('a stamp shaped by wheel, right-click, Alt+wheel, F and Shift+wheel lands exactly as the ghost', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('b')
  await setBrush(page, { stampMode: true, assetIds: [CRATE], stampRotation: 0, stampScale: 1, stampFlipX: false })
  const hall = await roomAnchor(page, 'Warren Hall')
  const at = await screenOf(page, hall.x + 2, hall.y + 2)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0)

  await wheel(page, at, 100)
  await wheel(page, at, 100)
  expect((await brush(page)).stampRotation).toBeCloseTo(Math.PI / 6)
  await rightClick(page, at)
  expect((await brush(page)).stampRotation).toBeCloseTo((2 * Math.PI) / 3)
  await expect(page.getByRole('button', { name: /^Angle 120°/ })).toBeVisible()
  await wheel(page, at, -100, { alt: true })
  expect((await brush(page)).stampScale).toBeCloseTo(1.1)
  await page.keyboard.press('f')
  expect((await brush(page)).stampFlipX).toBe(true)
  await wheel(page, at, 100, { shift: true })
  const shaped = await brush(page)
  expect(shaped.assetIds[0]).not.toBe(CRATE)

  // Ctrl+wheel still zooms while stamping, and leaves the stamp alone.
  const zoom = () => inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)
  const zoomBefore = await zoom()
  await wheel(page, at, -100, { ctrl: true })
  await waitFrame(page, 4)
  expect(Math.abs((await zoom()) - zoomBefore)).toBeGreaterThan(1e-4)
  expect((await brush(page)).stampRotation).toBeCloseTo((2 * Math.PI) / 3)

  const before = new Set((await props(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x + 2, hall.y + 2))
  const placed = (await props(page)).filter((p) => !before.has(p.id))
  expect(placed).toHaveLength(1)
  const p = placed[0]
  expect(p.assetId).toBe(shaped.assetIds[0])
  expect(p.rotation).toBeCloseTo(shaped.stampRotation)
  expect(p.flipX).toBe(true)
  expect(p.scale).toBe(1)
  // The art at 1.1 times its own size.
  const art = naturalCells(shaped.assetIds[0])
  expect(p.width).toBeCloseTo(art.w * 1.1, 3)
  expect(p.height).toBeCloseTo(art.h * 1.1, 3)
  await page.screenshot({ path: test.info().outputPath('stamp-landed.png') })

  await undo(page)
  expect((await props(page)).some((c) => c.id === p.id)).toBe(false)
})

test('a 2x1 prop snaps its footprint, not its centre, to the ½ grid', async ({ page }) => {
  await openWarren(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setSnapEnabled(true)
    st.setSnapDivision(2)
  })
  await page.keyboard.press('b')
  await setBrush(page, { stampMode: true, assetIds: [FIREWOOD], stampRotation: 0, stampScale: 1, stampFlipX: false })
  const hall = await roomAnchor(page, 'Warren Hall')
  const before = new Set((await props(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x + 1.37, hall.y + 1.21))
  const p = (await props(page)).find((c) => !before.has(c.id))!
  const art = naturalCells(FIREWOOD)
  expect(p.width).toBeCloseTo(art.w, 3)
  expect(p.height).toBeCloseTo(art.h, 3)
  const onHalf = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6
  expect(onHalf(p.x - p.width / 2)).toBe(true)
  expect(onHalf(p.y - p.height / 2)).toBe(true)
  await undo(page)
})

test('the dock Scale stamps the prop at that scale (the old dead Stamp Scale)', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('b')
  await setBrush(page, { stampMode: true, assetIds: [CRATE], stampRotation: 0, stampScale: 1, stampFlipX: false })
  await page.evaluate(() => (window as Any).__store.getState().updateToolSettings({ continuousPlacement: true }))
  const hall = await roomAnchor(page, 'Warren Hall')
  let before = new Set((await props(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x - 3, hall.y + 2))
  const one = (await props(page)).find((c) => !before.has(c.id))!

  await page.getByRole('slider', { name: 'Scale' }).fill('1.5')
  expect((await brush(page)).stampScale).toBe(1.5)
  before = new Set((await props(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x + 3, hall.y + 2))
  const big = (await props(page)).find((c) => !before.has(c.id))!
  expect(big.width / one.width).toBeCloseTo(1.5)
  expect(big.scale).toBe(1)
  await undo(page)
  await undo(page)
})

/** Whether a prop's drawn box (centre and corners) lies in one room face. Run in the page. */
const IN_ONE_FACE = `(c, faces) => {
  const inRing = (x, y, ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const w = (c.width * c.scale) / 2, h = (c.height * c.scale) / 2
  const cos = Math.cos(c.rotation), sin = Math.sin(c.rotation)
  const pts = [[0, 0], [-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [c.position.x + u * cos - v * sin, c.position.y + u * sin + v * cos])
  return faces.some((f) => pts.every(([x, y]) => inRing(x, y, f)))
}`

/** Whether two props' boxes, shrunk to 0.8, overlap (separating axes). Run in the page. */
const OVERLAP = `(a, b) => {
  const box = (c) => {
    const w = (c.width * c.scale * 0.8) / 2, h = (c.height * c.scale * 0.8) / 2
    const cos = Math.cos(c.rotation), sin = Math.sin(c.rotation)
    return { pts: [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [c.position.x + u * cos - v * sin, c.position.y + u * sin + v * cos]), axes: [[cos, sin], [-sin, cos]] }
  }
  const A = box(a), B = box(b)
  for (const [ax, ay] of [...A.axes, ...B.axes]) {
    const pa = A.pts.map(([x, y]) => x * ax + y * ay), pb = B.pts.map(([x, y]) => x * ax + y * ay)
    if (Math.max(...pa) < Math.min(...pb) - 1e-6 || Math.max(...pb) < Math.min(...pa) - 1e-6) return false
  }
  return true
}`

test('a scatter stroke across Warren Hall into its wall stays on the floor, overlaps nothing, and undoes in one step', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('b')
  await page.getByRole('button', { name: 'Scatter' }).click()
  await setBrush(page, {
    stampMode: false,
    assetIds: [RUBBLE_S, RUBBLE_M],
    brushRadius: 3,
    density: 0.6,
    avoidOverlap: true,
    stayOnFloor: true,
    tints: ['#a39a8c', '#8c968a'],
  })
  const hall = await roomAnchor(page, 'Warren Hall')
  const right = await inPage<number>(page, `(s, layer) => Math.max(...layer().rooms.find((r) => r.name === 'Warren Hall').face.map((p) => p[0]))`)
  const before = new Set(await childIds(page))

  const start = await screenOf(page, hall.x, hall.y)
  await firePointer(page, 'pointermove', start.x, start.y, 0, 0)
  await firePointer(page, 'pointerdown', start.x, start.y, 0.5, 1)
  for (let x = hall.x; x <= right + 3; x += 0.5) {
    const p = await screenOf(page, x, hall.y)
    await firePointer(page, 'pointermove', p.x, p.y, 0.5, 1)
  }
  await expect(page.getByTestId('v2-status-hint')).toContainText('placed')
  const end = await screenOf(page, right + 3, hall.y)
  await firePointer(page, 'pointerup', end.x, end.y, 0, 0)
  await waitFrame(page, 3)

  const result = await inPage<{ added: number; offFloor: number; overlaps: number; tinted: number }>(
    page,
    `(s, layer, w2s, arg) => {
      const inOne = (${IN_ONE_FACE}); const overlap = (${OVERLAP})
      const faces = layer().rooms.map((r) => r.face)
      const assets = layer().children.filter((c) => c.childType === 'asset' && c.visible !== false)
      const added = assets.filter((c) => !arg.before.includes(c.id))
      let overlaps = 0
      for (const a of added) for (const b of assets) if (a.id !== b.id && overlap(a, b)) overlaps++
      return { added: added.length, offFloor: added.filter((c) => !inOne(c, faces)).length, overlaps, tinted: added.filter((c) => c.tint !== '#ffffff').length }
    }`,
    { before: [...before] },
  )
  expect(result.added).toBeGreaterThan(3)
  expect(result.offFloor).toBe(0)
  expect(result.overlaps).toBe(0)
  expect(result.tinted).toBe(result.added)
  await page.screenshot({ path: test.info().outputPath('scatter-stroke.png') })

  // One Ctrl+Z takes the whole stroke.
  await undo(page)
  expect(new Set(await childIds(page))).toEqual(before)
})

test('an erase stroke takes rubble but spares cave rock and an imported image, and undoes in one step', async ({ page }) => {
  await openWarren(page)
  const rubble = await propOf(page, RUBBLE_S)
  // An imported image right beside the rubble, and a piece of the cave kit's rock placed as a
  // prop a little further on (the Warren's own walls are drawn live, so it has none placed).
  const rock = { id: 'e2e-rock', x: rubble.x + 1.5, y: rubble.y }
  await page.evaluate(
    ({ x, y, rock }) => {
      const st = (window as Any).__store.getState()
      const layer = st.layers.find((l: Any) => l.type === 'dungeon')
      st.addChild(layer.id, {
        id: 'e2e-image', name: 'map scrap', childType: 'asset', visible: true, objectType: 'image', assetId: 'e2e-missing-image',
        position: { x, y }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
      })
      st.addChild(layer.id, {
        id: rock.id, name: 'cave rock', childType: 'asset', visible: true, objectType: 'asset', assetId: 'gg-forge:wall_short_2x2_object_A',
        position: { x: rock.x, y: rock.y }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
      })
    },
    { x: rubble.x + 0.6, y: rubble.y, rock },
  )
  await page.keyboard.press('b')
  await setBrush(page, { stampMode: false, brushRadius: 1 })
  await page.keyboard.press('e')
  await expect(page.getByTestId('v2-status-hint')).toContainText('images and cave rock are kept')
  const before = new Set(await childIds(page))

  const a = await screenOf(page, rubble.x, rubble.y)
  await firePointer(page, 'pointermove', a.x, a.y, 0, 0)
  await firePointer(page, 'pointerdown', a.x, a.y, 0.5, 1)
  const b = await screenOf(page, rubble.x + 0.6, rubble.y)
  await firePointer(page, 'pointermove', b.x, b.y, 0.5, 1)
  const c = await screenOf(page, rock.x, rock.y)
  await firePointer(page, 'pointermove', c.x, c.y, 0.5, 1)
  await firePointer(page, 'pointerup', c.x, c.y, 0, 0)
  await waitFrame(page, 3)
  const after = new Set(await childIds(page))
  expect(after.has(rubble.id)).toBe(false)
  expect(after.has(rock.id)).toBe(true)
  expect(after.has('e2e-image')).toBe(true)

  await page.keyboard.press('e')
  await undo(page)
  expect(new Set(await childIds(page))).toEqual(before)
})

test('the card W on a prop turned 90° grows its own length, not its width on screen', async ({ page }) => {
  await openWarren(page)
  const cot = await propOf(page, 'gg-demo:bed_small_single_cot_1x2_object_A')
  await select(page, [cot.id])
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toHaveAttribute('data-prop-kind', 'prop')
  const angle = card.getByLabel('Angle (degrees)')
  await angle.fill('90')
  await angle.press('Enter')
  const turned = await propOf(page, 'gg-demo:bed_small_single_cot_1x2_object_A')
  expect(turned.rotation).toBeCloseTo(Math.PI / 2)
  const w0 = turned.width * turned.scale
  const h0 = turned.height * turned.scale
  const link = card.getByRole('button', { name: 'Keep W:H ratio' })
  if ((await link.getAttribute('aria-pressed')) === 'true') await link.click()
  const w = card.getByLabel('Width (squares)')
  await w.fill((w0 + 1).toFixed(2))
  await w.press('Enter')
  const grown = await propOf(page, 'gg-demo:bed_small_single_cot_1x2_object_A')
  expect(grown.width * grown.scale).toBeCloseTo(w0 + 1, 2)
  expect(grown.height * grown.scale).toBeCloseTo(h0, 2)
  expect(grown.rotation).toBeCloseTo(Math.PI / 2)
  await page.screenshot({ path: test.info().outputPath('prop-card.png') })
  await undo(page)
  await undo(page)
  expect((await propOf(page, 'gg-demo:bed_small_single_cot_1x2_object_A')).rotation).toBeCloseTo(cot.rotation)
})

/** The rotated world box of a prop. */
function aabb(p: PropRow) {
  const w = p.width * p.scale
  const h = p.height * p.scale
  const c = Math.abs(Math.cos(p.rotation))
  const s = Math.abs(Math.sin(p.rotation))
  const hw = (w * c + h * s) / 2
  const hh = (w * s + h * c) / 2
  return { left: p.x - hw, right: p.x + hw, top: p.y - hh, bottom: p.y + hh }
}

const THREE = ['gg-demo:storage_barrel_1_dark_1x1_object_A', CRATE, 'gg-demo:chest_1_steel_1x1_object_A']

test('three props: one box, Align left, Distribute horizontally, each one undo', async ({ page }) => {
  await openWarren(page)
  const ids = await Promise.all(THREE.map(async (a) => (await propOf(page, a)).id))
  const start = (await props(page)).filter((p) => ids.includes(p.id))
  await select(page, ids)
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toHaveAttribute('data-prop-kind', 'props')
  await expect(card.getByText('3 props')).toBeVisible()

  await card.getByRole('button', { name: /^Align/ }).click()
  await page.getByTestId('v2-align-left').click()
  const lefts = (await props(page)).filter((p) => ids.includes(p.id)).map((p) => aabb(p).left)
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(1e-6)
  await page.screenshot({ path: test.info().outputPath('multi-card.png') })
  await undo(page)

  await card.getByRole('button', { name: /^Distribute/ }).click()
  await page.getByTestId('v2-distribute-h').click()
  const spread = (await props(page)).filter((p) => ids.includes(p.id)).map(aabb).sort((a, b) => a.left - b.left)
  expect(spread[1].left - spread[0].right).toBeCloseTo(spread[2].left - spread[1].right, 4)
  await undo(page)
  for (const p of (await props(page)).filter((x) => ids.includes(x.id))) {
    const s = start.find((x) => x.id === p.id)!
    expect(p.x).toBeCloseTo(s.x)
    expect(p.y).toBeCloseTo(s.y)
  }
})

test('z-order keys move a prop in the layer order', async ({ page }) => {
  await openWarren(page)
  const crate = await propOf(page, CRATE)
  const order = async () => (await props(page)).map((p) => p.id)
  const start = await order()
  await select(page, [crate.id])
  await blur(page)
  await page.keyboard.press('Control+Shift+BracketLeft')
  await waitFrame(page, 2)
  expect((await order())[0]).toBe(crate.id)
  await page.keyboard.press('Control+BracketRight')
  await waitFrame(page, 2)
  expect((await order())[1]).toBe(crate.id)
  await undo(page)
  await undo(page)
  expect(await order()).toEqual(start)
})

test('a sibling swap from the card keeps the footprint; Replace opens the library on it', async ({ page }) => {
  await openWarren(page)
  const crate = await propOf(page, CRATE)
  await select(page, [crate.id])
  await expect(page.getByTestId('v2-prop-family-chip')).toContainText('/2')
  const variant = page.getByTestId('v2-prop-variant')
  await variant.getByRole('button', { name: 'storage crates 2 dark' }).click()
  const swapped = (await props(page)).find((p) => p.id === crate.id)!
  expect(swapped.assetId).toBe('gg-demo:storage_crates_2_dark_1x1_object_A')
  for (const k of ['x', 'y', 'rotation'] as const) expect(swapped[k]).toBeCloseTo(crate[k])
  expect(swapped.width * swapped.scale).toBeCloseTo(crate.width * crate.scale)
  expect(swapped.height * swapped.scale).toBeCloseTo(crate.height * crate.scale)
  await undo(page)

  await variant.getByTestId('v2-prop-replace').click()
  await expect(page.getByTestId('v2-props-sheet')).toBeVisible()
  await expect(page.getByTestId('v2-props-replace')).toContainText('Click a prop to replace')
  await page.screenshot({ path: test.info().outputPath('replace-mode.png') })
  await page.getByTestId('v2-props-replace').getByRole('button', { name: 'Cancel' }).click()
  expect(await inPage(page, `(s) => s().ui.propReplaceIds`)).toBeNull()
})

test('a locked prop selects on click but never moves, offers Unlock on right-click, and unlocks', async ({ page }) => {
  await openWarren(page)
  // The boulder: no light sits on it, so a click and a right-click reach the prop itself.
  const BOULDER = 'gg-demo:boulder_2x2_object_A'
  const boulder = await propOf(page, BOULDER)
  const at = await screenOf(page, boulder.x, boulder.y)
  // Unlocked, a click takes it.
  await click(page, at)
  expect(await inPage<string[]>(page, `(s) => s().selection.selectedIds`)).toEqual([boulder.id])
  await page.getByTestId('v2-selection-card').getByRole('switch', { name: 'Lock', exact: true }).click()
  expect((await propOf(page, BOULDER)).locked).toBe(true)
  // A locked selection's line is the Select tool's locked one, ahead of the prop's keys.
  await expect(page.getByTestId('v2-status-hint')).toContainText('Locked · Unlock in the card')
  await select(page, [])
  // Locked on its own: a click still selects it (its card can unlock it), a drag never moves it.
  await click(page, at)
  expect(await inPage<string[]>(page, `(s) => s().selection.selectedIds`)).toContain(boulder.id)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointermove', at.x + 60, at.y + 20, 0.5, 1)
  await firePointer(page, 'pointerup', at.x + 60, at.y + 20, 0, 0)
  await waitFrame(page, 2)
  expect((await propOf(page, BOULDER)).x).toBeCloseTo(boulder.x)

  await rightClick(page, at)
  const unlock = page.getByRole('menuitem', { name: 'Unlock' })
  await expect(unlock).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete Del' })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('locked-menu.png') })
  await unlock.click()
  expect((await propOf(page, BOULDER)).locked).toBeFalsy()
})

test('Ctrl+G makes a group with its own card; Ungroup gives the members back', async ({ page }) => {
  await openWarren(page)
  const ids = await Promise.all(THREE.map(async (a) => (await propOf(page, a)).id))
  await select(page, ids)
  await blur(page)
  await page.keyboard.press('Control+g')
  await waitFrame(page, 2)
  await select(page, ids)
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toHaveAttribute('data-prop-kind', 'prop-group')
  const name = card.getByLabel('Group name')
  await name.fill('Supply corner')
  await name.press('Enter')
  await expect(card.locator('.v2-sel__name')).toHaveText('Supply corner')
  await page.screenshot({ path: test.info().outputPath('group-card.png') })
  await card.getByRole('button', { name: 'Ungroup' }).click()
  expect((await props(page)).filter((p) => ids.includes(p.id)).every((p) => !p.groupId)).toBe(true)
  await undo(page)
  expect((await props(page)).filter((p) => ids.includes(p.id)).every((p) => !!p.groupId)).toBe(true)
})

test('an attached light follows nudge, rotate 90, flip, duplicate and move to layer', async ({ page }) => {
  await openWarren(page)
  const BRAZIER = 'gg-demo:light_brazier_1_a_1x1_object_A'
  const brazier = await propOf(page, BRAZIER)
  // Attach the den's light two squares east of the brazier, clear of its art.
  await page.evaluate(
    ({ id, x, y }) => {
      const st = (window as Any).__store.getState()
      const layer = st.layers.find((l: Any) => l.type === 'dungeon')
      st.updateChild(layer.id, 'light-den-brazier', { attachedTo: id, position: { x: x + 2, y } })
    },
    { id: brazier.id, x: brazier.x, y: brazier.y },
  )
  const light = () =>
    inPage<{ x: number; y: number; layerId: string }>(
      page,
      `(s) => { for (const l of s().layers) { const c = (l.children ?? []).find((x) => x.id === 'light-den-brazier'); if (c) return { x: c.position.x, y: c.position.y, layerId: l.id } } return null }`,
    )
  const offset = async () => {
    const b = await propOf(page, BRAZIER)
    const l = await light()
    return { dx: l.x - b.x, dy: l.y - b.y }
  }
  await select(page, [brazier.id])
  await blur(page)

  await page.keyboard.press('ArrowRight')
  await waitFrame(page, 2)
  expect((await propOf(page, BRAZIER)).x).toBeGreaterThan(brazier.x)
  expect((await offset()).dx).toBeCloseTo(2)

  const here = async () => {
    const b = await propOf(page, BRAZIER)
    return screenOf(page, b.x, b.y)
  }
  await rightClick(page, await here())
  await page.getByRole('menuitem', { name: 'Rotate 90°' }).click()
  await waitFrame(page, 2)
  const turned = await offset()
  expect(Math.hypot(turned.dx, turned.dy)).toBeCloseTo(2)
  expect(Math.abs(turned.dx)).toBeLessThan(1e-6)

  await select(page, [brazier.id])
  await blur(page)
  const flipFrom = (await propOf(page, BRAZIER)).flipX
  await page.keyboard.press('Shift+h')
  await waitFrame(page, 2)
  expect((await propOf(page, BRAZIER)).flipX).toBe(!flipFrom)
  const flipped = await offset()
  expect(Math.hypot(flipped.dx, flipped.dy)).toBeCloseTo(2)

  const lightsBefore = await inPage<number>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'light').length`)
  await page.keyboard.press('Control+d')
  await waitFrame(page, 2)
  const copied = await inPage<{ lights: number; attached: boolean }>(
    page,
    `(s, layer, w2s, arg) => {
      const kids = layer().children
      const copy = kids.find((c) => c.childType === 'asset' && c.assetId === arg.asset && c.id !== arg.id)
      const lights = kids.filter((c) => c.childType === 'light')
      return { lights: lights.length, attached: !!copy && lights.some((l) => l.attachedTo === copy.id) }
    }`,
    { asset: BRAZIER, id: brazier.id },
  )
  expect(copied.lights).toBe(lightsBefore + 1)
  expect(copied.attached).toBe(true)
  await undo(page)

  // A second map layer to move to.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const src = st.layers.find((l: Any) => l.type === 'dungeon')
    const copy = structuredClone(src)
    Object.assign(copy, { id: 'e2e-upper', name: 'Upper', children: [], rooms: [], areas: [], groups: [], standaloneWalls: [], mergedFloor: null })
    st.addLayer(copy)
  })
  await select(page, [brazier.id])
  await rightClick(page, await here())
  await page.getByRole('menuitem', { name: 'Move to layer' }).click()
  await page.getByRole('menuitem', { name: 'Upper' }).click()
  await waitFrame(page, 2)
  expect((await light()).layerId).toBe('e2e-upper')
})

test('overhead draws the web above everything; See under overhead fades it', async ({ page }) => {
  await openWarren(page)
  const web = await propOf(page, 'gg-demo:spider_web_3x2_object_A')
  await select(page, [web.id])
  await page.getByTestId('v2-selection-card').getByRole('switch', { name: 'Overhead', exact: true }).click()
  expect((await propOf(page, 'gg-demo:spider_web_3x2_object_A')).overhead).toBe(true)
  await waitFrame(page, 3)
  const overhead = () =>
    inPage<{ count: number; alpha: number }>(
      page,
      `() => {
        const find = (c) => c.label === 'overheadContainer' ? c : (c.children ?? []).map(find).find(Boolean)
        const box = find(window.__pixiApp.stage)
        const kids = box ? box.children : []
        return { count: kids.length, alpha: kids.length ? Math.min(...kids.map((k) => k.alpha)) : 1 }
      }`,
    )
  expect((await overhead()).count).toBeGreaterThan(0)
  expect((await overhead()).alpha).toBeGreaterThan(0.9)

  await page.getByTestId('v2-dock-tab-props').click()
  await page.getByTestId('v2-see-under-overhead').click()
  expect(await inPage(page, `(s) => s().ui.seeUnderOverhead`)).toBe(true)
  await waitFrame(page, 3)
  expect((await overhead()).alpha).toBeLessThan(0.5)
  await page.screenshot({ path: test.info().outputPath('see-under-overhead.png') })
  await page.getByTestId('v2-see-under-overhead').click()
  await undo(page)
  expect((await propOf(page, 'gg-demo:spider_web_3x2_object_A')).overhead).toBeFalsy()
})

test('the library: categories, "barel" finds barrels first, and a star survives a reload', async ({ page }) => {
  await openWarren(page)
  await page.getByTestId('v2-dock-tab-assets').click()
  const sheet = page.getByTestId('v2-props-sheet')
  await expect(sheet).toBeVisible()
  const cats = await sheet.getByRole('list', { name: 'Categories' }).getByRole('button').allTextContents()
  expect(cats.slice(0, 4)).toEqual(['All825', 'Furniture142', 'Clutter119', 'Storage106'])
  expect(cats.some((c) => /Cave Ink/.test(c))).toBe(false)
  await expect(sheet.getByRole('button', { name: /^Used on this map \(\d+\)$/ })).toBeVisible()

  await sheet.getByLabel('Search props').fill('barel')
  const first = sheet.getByTestId('v2-prop-tile').first()
  await expect(first.locator('.v2-ptile__nm')).toContainText('barrel')
  await page.screenshot({ path: test.info().outputPath('library.png') })
  await first.hover()
  await first.getByRole('button', { name: 'Add to favourites' }).click()
  const stars = await inPage<string[]>(page, `(s) => s().assets.favourites`)
  expect(stars).toHaveLength(1)

  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  expect(await inPage<string[]>(page, `(s) => s().assets.favourites`)).toEqual(stars)
  await page.getByTestId('v2-dock-tab-assets').click()
  await page.getByTestId('v2-props-sheet').getByRole('button', { name: 'Favourites', exact: true }).click()
  await expect(page.getByTestId('v2-props-sheet').getByTestId('v2-prop-tile')).toHaveCount(1)
})

/** The first Pixi node labelled `label` under the stage, its bounds in canvas pixels, or null. */
const pixiNode = (page: Page, label: string) =>
  inPage<{ visible: boolean; x: number; y: number; w: number; h: number } | null>(
    page,
    `(s, layer, w2s, label) => {
      const find = (c) => c.label === label ? c : (c.children ?? []).map(find).find(Boolean)
      const n = find(window.__pixiApp.stage)
      if (!n) return null
      const b = n.getBounds()
      return { visible: n.visible, x: b.x, y: b.y, w: b.width, h: b.height }
    }`,
    label,
  )

test('the Props dock at 1920: eight strip tiles, a typed Scale, two tints that differ, and erase left behind with the tool', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 })
  await openWarren(page)
  await page.evaluate((id) => (window as Any).__store.getState().toggleFavourite(id), 'gg-demo:storage_barrel_1_dark_1x1_object_A')
  await page.keyboard.press('b')
  await waitFrame(page, 2)
  await setBrush(page, { stampMode: true, assetIds: [CRATE] })
  await waitFrame(page, 3)
  const strip = await page.evaluate(() => {
    const tiles = document.querySelector('[data-testid="v2-strip-props"] .v2-strip__tiles')!
    const box = tiles.getBoundingClientRect()
    const all = [...tiles.querySelectorAll('.v2-swatch')]
    const shown = all.filter((t) => {
      const r = t.getBoundingClientRect()
      return r.top < box.bottom - 2 && r.right <= box.right + 1
    })
    return { total: all.length, shown: shown.length, first: all[0]?.getAttribute('aria-label') }
  })
  expect(strip).toEqual({ total: 8, shown: 8, first: 'storage barrel 1 dark' })

  // Scale: a track wide enough to set by hand, and the number typed beside it.
  expect((await page.getByRole('slider', { name: 'Scale' }).boundingBox())!.width).toBeGreaterThanOrEqual(120)
  const scale = page.getByRole('textbox', { name: /^Scale/ })
  await scale.fill('2.4')
  await scale.press('Enter')
  expect((await brush(page)).stampScale).toBeCloseTo(2.4)
  const dockBox = (await page.getByTestId('v2-dock').boundingBox())!
  await page.mouse.move(dockBox.x + dockBox.width / 2, dockBox.y + 8)
  await waitFrame(page, 6)
  await page.screenshot({ path: test.info().outputPath('dock-stamp-1920.png'), clip: { x: dockBox.x - 8, y: dockBox.y - 8, width: dockBox.width + 16, height: dockBox.height + 16 } })

  // Scatter: the board's defaults, and each added tint its own colour.
  await page.getByRole('button', { name: 'Scatter' }).click()
  await page.getByTestId('v2-props-more').click()
  const card = page.getByRole('dialog', { name: 'Scatter settings' })
  await expect(card.getByRole('switch', { name: 'Random variant' })).toHaveAttribute('aria-checked', 'true')
  expect(await card.getByRole('slider', { name: 'Spacing' }).inputValue()).toBe('0.5')
  await card.getByRole('button', { name: 'Add a tint' }).click()
  await card.getByRole('button', { name: 'Add a tint' }).click()
  const tints: string[] = (await brush(page)).tints
  expect(tints).toHaveLength(2)
  expect(tints[0]).not.toBe(tints[1])
  await page.keyboard.press('Escape')

  // Erase is a moment: E, then Select, then B comes back painting, not erasing.
  await blur(page)
  await page.keyboard.press('e')
  expect(await inPage(page, `(s) => s().tools.eraseMode`)).toBe(true)
  await page.getByTestId('v2-rail').getByRole('button', { name: /^Select/ }).click()
  await blur(page)
  await page.keyboard.press('b')
  await waitFrame(page, 2)
  expect(await inPage(page, `(s) => s().tools.eraseMode`)).toBe(false)
  expect((await brush(page)).stampMode).toBe(false)
  await expect(page.getByTestId('v2-status-hint')).not.toContainText('drag over props to erase')
})

test('selection fixes: the outline follows card edits, the box survives lock and Ungroup, a locked prop’s bar is Unlock only', async ({ page }) => {
  await openWarren(page)
  const barrel = await propOf(page, THREE[0])
  await page.evaluate(({ id }) => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.type === 'dungeon')
    st.updateChild(layer.id, id, { rotation: Math.PI / 4 })
  }, { id: barrel.id })
  await select(page, [barrel.id])
  // Hover the barrel: its outline is drawn where it is.
  const at = await screenOf(page, barrel.x, barrel.y)
  await firePointer(page, 'pointermove', at.x, at.y)
  await waitFrame(page, 2)
  const before = (await pixiNode(page, 'selectHover'))!
  expect(before.w).toBeGreaterThan(0)
  // Move it from the card: the outline goes along, none is left at the old spot.
  const x = page.getByTestId('v2-selection-card').getByRole('textbox', { name: 'X (centre, squares)' })
  await x.fill(String(barrel.x + 3))
  await x.press('Enter')
  await waitFrame(page, 3)
  const after = (await pixiNode(page, 'selectHover'))!
  const moved = await screenOf(page, barrel.x + 3, barrel.y)
  const canvasLeft = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect().left)
  expect(Math.abs(after.x + after.w / 2 + canvasLeft - moved.x)).toBeLessThan(2)
  expect(after.x).toBeGreaterThan(before.x + 1)

  // Ctrl+G: a merged group, as the Group board shows it.
  const ids = await Promise.all(THREE.map(async (a) => (await propOf(page, a)).id))
  await select(page, ids)
  await blur(page)
  await page.keyboard.press('Control+g')
  await waitFrame(page, 2)
  await select(page, ids)
  const groupCard = page.getByTestId('v2-selection-card')
  await expect(groupCard.getByRole('switch', { name: 'Merged' })).toHaveAttribute('aria-checked', 'true')
  // Lock all, unlock all, Ungroup: still three props selected, boxed, with the multi card.
  await groupCard.getByRole('switch', { name: 'Lock all members' }).click()
  await waitFrame(page, 2)
  await groupCard.getByRole('switch', { name: 'Lock all members' }).click()
  await groupCard.getByRole('button', { name: 'Ungroup' }).click()
  await waitFrame(page, 3)
  expect(await inPage<string[]>(page, `(s) => s().selection.selectedIds`)).toEqual(ids)
  await expect(page.getByTestId('v2-selection-card')).toHaveAttribute('data-prop-kind', 'props')
  const gizmo = await pixiNode(page, 'transformGizmo')
  expect(gizmo?.visible).toBe(true)
  expect(gizmo!.w).toBeGreaterThan(10)
  // The Align menu wears its icons.
  await page.getByTestId('v2-selection-card').getByRole('button', { name: /^Align/ }).click()
  for (const edge of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']) {
    await expect(page.getByTestId(`v2-align-${edge}`).locator('svg')).toHaveCount(1)
  }
  await page.screenshot({ path: test.info().outputPath('align-menu.png') })
  await page.keyboard.press('Escape')

  // A locked prop: the card's action row offers Unlock and the menu, nothing else (the
  // floating bar is gone on v2; its verbs live in the card header).
  await select(page, [barrel.id])
  await page.getByTestId('v2-selection-card').getByRole('switch', { name: 'Lock', exact: true }).click()
  const bar = page.getByRole('toolbar', { name: 'Selection actions' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button')).toHaveCount(2)
  await expect(bar.getByRole('button', { name: 'More' })).toBeVisible()
  await bar.getByRole('button', { name: 'Unlock' }).click()
  expect((await propOf(page, THREE[0])).locked).toBeFalsy()
  await expect(bar.getByRole('button', { name: 'Lock', exact: true })).toBeVisible()
})

test('the prop menu: Move to layer stays on the level, Overhead is an empty check, a swap closes the menu', async ({ page }) => {
  await openWarren(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const src = st.layers.find((l: Any) => l.type === 'dungeon')
    st.addLevel({ id: 'e2e-level-2', name: 'Level 2' })
    const blank = { children: [], rooms: [], areas: [], groups: [], standaloneWalls: [], mergedFloor: null }
    st.addLayer(Object.assign(structuredClone(src), blank, { id: 'e2e-same', name: 'Same level' }))
    st.addLayer(Object.assign(structuredClone(src), blank, { id: 'e2e-other', name: 'Other level', levelId: 'e2e-level-2' }))
    st.setActiveLayerId(src.id)
  })
  const levelBefore = await inPage<string>(page, `(s) => s().ui.activeLevelId`)
  const crate = await propOf(page, CRATE)
  const at = await screenOf(page, crate.x, crate.y)
  await select(page, [crate.id])
  await rightClick(page, at)
  const overhead = page.getByRole('menuitemcheckbox', { name: 'Overhead' })
  await expect(overhead).toHaveAttribute('aria-checked', 'false')
  await expect(overhead.locator('[data-look="check"]')).toHaveCount(1)
  await expect(overhead.locator('[data-look="check"] svg')).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Move to layer' }).click()
  await expect(page.getByRole('menuitem', { name: 'Same level' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Other level' })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('move-to-layer.png') })
  await page.getByRole('menuitem', { name: 'Same level' }).click()
  await waitFrame(page, 2)
  expect(await inPage<string>(page, `(s) => s().ui.activeLevelId`)).toBe(levelBefore)
  await undo(page)

  await select(page, [crate.id])
  await rightClick(page, at)
  await page.getByRole('menuitemradio', { name: 'storage crates 2 dark' }).click()
  await waitFrame(page, 2)
  expect((await props(page)).find((p) => p.id === crate.id)!.assetId).toBe('gg-demo:storage_crates_2_dark_1x1_object_A')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('no fade while a prop is selected; the library pool keeps its height; a starred family is its tile; Ctrl+E previews', async ({ page }) => {
  await openWarren(page)
  const crate = await propOf(page, CRATE)
  await select(page, [crate.id])
  const at = await screenOf(page, crate.x + 2, crate.y + 2)
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(5600)
  await expect(page.getByTestId('v2-editor')).not.toHaveAttribute('data-faded', /.*/)
  await select(page, [])
  await expect(page.getByTestId('v2-editor')).toHaveAttribute('data-faded', /.*/)

  // The pool row: the same height empty and with its first prop, so the sheet does not jump.
  await blur(page)
  await page.keyboard.press('b')
  await setBrush(page, { stampMode: false, assetIds: [] })
  await page.getByTestId('v2-dock-tab-assets').click()
  const sheet = page.getByTestId('v2-props-sheet')
  await expect(sheet.getByTestId('v2-props-pool')).toBeVisible()
  const measure = () =>
    page.evaluate(() => [
      document.querySelector('[data-testid="v2-props-pool"]')!.getBoundingClientRect().height,
      document.querySelector('.v2-pbrowse__top')!.getBoundingClientRect().top,
    ])
  const empty = await measure()
  await sheet.getByLabel('Search props').fill('rubble small')
  await sheet.getByTestId('v2-prop-tile').first().locator('.v2-ptile__pk').click()
  expect((await brush(page)).assetIds).toHaveLength(1)
  expect(await measure()).toEqual(empty)

  // A star on a family tile keeps the family; Favourites shows it with its ×N.
  await sheet.getByLabel('Search props').fill('barrel')
  const family = sheet.getByTestId('v2-prop-tile').filter({ has: page.getByRole('button', { name: /^Open .* family/ }) }).first()
  await family.hover()
  await family.getByRole('button', { name: 'Add to favourites' }).click()
  const stars = await inPage<string[]>(page, `(s) => s().assets.favourites`)
  expect(stars[0].split(':')).toHaveLength(3)
  await sheet.getByLabel('Search props').fill('')
  await sheet.getByRole('button', { name: 'Favourites', exact: true }).click()
  await expect(sheet.getByTestId('v2-prop-tile')).toHaveCount(1)
  await expect(sheet.getByRole('button', { name: /^Open .* family, \d+ variants/ })).toBeVisible()
  await page.getByRole('button', { name: 'Close Props' }).click()

  // Ctrl+E: the dialog shows the file in small, rendered by the export pipeline.
  await blur(page)
  await page.keyboard.press('Control+e')
  const preview = page.getByTestId('v2-export-preview')
  await expect(preview).toBeVisible()
  const img = preview.getByRole('img', { name: 'Export preview' })
  await expect(img).toBeVisible({ timeout: 15_000 })
  const size = await img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }))
  expect(Math.max(size.w, size.h)).toBeGreaterThan(300)
  expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(480)
  await page.getByRole('switch', { name: 'Apply lighting' }).click()
  await expect(img).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: test.info().outputPath('export-preview.png') })
})
