// Floors and walls follow rooms (rooms plan, section 11.4): a chamber and a passage poking one
// cell into it past a short wall with its door. Change the chamber's floor and the overhang
// cell reads the chamber's floor in Blend and the passage's in Sharp; across the door the
// chamber's floor rises steadily, with no step; with the passage's room pinned to a wall set of
// its own, an Edge band picked on the passage's card clears that pin (the latest pick wins),
// changes the long side at once and leaves the chamber's walls as they were.

import { test, expect, type Locator, type Page } from '@playwright/test'
import { getPixelColor, pressShortcut, waitFrame } from './helpers'
import { floorArtLanded, lookAt, openEditor } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The chamber [0..9]², the passage [8..14] × [3..5] reaching one cell into it, the wall with its door at x = 9.16. */
const CAVE = {
  chamber: [[0, 0], [9, 0], [9, 9], [0, 9]],
  passage: [[8, 3], [14, 3], [14, 5], [8, 5]],
  wall: [[9.16, 4.48], [9.16, 3.53]],
  door: { position: [9.16, 4.005], angle: -Math.PI / 2, width: 0.95 },
  rooms: [
    { id: 'chamber', name: 'Chamber', anchor: [4, 4] },
    { id: 'passage', name: 'Passage', anchor: [11.5, 4] },
  ],
}
const OVERHANG = { x: 8.5, y: 4 }
const IN_CHAMBER = { x: 4, y: 6.5 }
const IN_PASSAGE = { x: 12, y: 4 }

/** Lays the cave on the active layer in place of what it held, Blend on, and waits for its two rooms' faces. */
async function layCave(page: Page): Promise<string> {
  const ids = await page.evaluate((cave) => {
    const w = window as Any
    const st = w.__store.getState()
    const layer = st.layers.find((l: Any) => l.id === st.ui.activeLayerId && l.type === 'dungeon') ?? st.layers.find((l: Any) => l.type === 'dungeon')
    const old = layer.children.find((c: Any) => c.childType === 'shape')
    const floor = (id: string, ring: number[][]) => ({
      ...old, id, name: id, ground: undefined, edgeBand: undefined, edgeMaterial: undefined, edgePaint: undefined, fades: undefined, opacity: undefined,
      shapeType: 'rectangle', contours: [ring], tangents: undefined, transform: undefined, textureTint: '#ffffff', styleOverrides: undefined,
    })
    w.__store.setState((d: Any) => {
      const l = d.layers.find((x: Any) => x.id === layer.id)
      l.children = [
        floor('chamber-floor', cave.chamber),
        floor('passage-floor', cave.passage),
        { id: 'door', name: 'Door', childType: 'door', visible: true, wallId: 'wall', ...cave.door, style: 'single', state: 'closed', isSecret: false, freestanding: true },
      ]
      l.standaloneWalls = [{ id: 'wall', points: cave.wall, wallType: 'normal', direction: 'both', color: '#000000', width: 0.5, roughness: 0 }]
      l.rooms = cave.rooms
      l.thresholds = []
      l.mergedFloor = null
      l.style.showEdgeTransitions = true
      l.style.edgeTransitionWidth = 0.5
      d.ui.activeLayerId = layer.id
    })
    return layer.id as string
  }, CAVE)
  await expect
    .poll(() => page.evaluate((id) => (window as Any).__store.getState().layers.find((l: Any) => l.id === id).rooms.filter((r: Any) => (r.face ?? []).length >= 3).length, ids), {
      message: 'both rooms take their faces',
    })
    .toBe(2)
  await expect.poll(() => floorArtLanded(page), { message: 'the floor texture lands' }).toBe(true)
  return ids
}

/** The canvas colour at a world point. */
async function rgbAt(page: Page, p: { x: number; y: number }): Promise<{ r: number; g: number; b: number }> {
  const at = await page.evaluate(([x, y]) => {
    const world = (window as Any).__pixiApp.stage.children[0]
    return { x: x * world.scale.x + world.position.x, y: y * world.scale.y + world.position.y }
  }, [p.x, p.y])
  const c = await getPixelColor(page, at.x, at.y)
  return { r: c.r, g: c.g, b: c.b }
}

/** How red a colour is: what is left of green next to red, 1 for an untinted grey, near 0 for full red. */
const greenOverRed = (c: { r: number; g: number }) => c.g / Math.max(1, c.r)

/** The mean of `greenOverRed` over a small square round `p`, so the texture's own grain averages out. */
async function tintAt(page: Page, p: { x: number; y: number }): Promise<number> {
  let sum = 0
  let n = 0
  for (const dx of [-0.15, 0, 0.15]) for (const dy of [-0.15, 0, 0.15]) {
    sum += greenOverRed(await rgbAt(page, { x: p.x + dx, y: p.y + dy }))
    n++
  }
  return sum / n
}

/** Picks one floor, or nothing. */
const select = (page: Page, id: string | null) =>
  page.evaluate((id) => {
    const st = (window as Any).__store.getState()
    st.setSelectedIds(id ? [id] : [])
  }, id)

test('rooms looks: a changed chamber takes its overhang in Blend, not in Sharp, and blends across the door', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  const layerId = await layCave(page)
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()

  // Change the chamber's floor: a strong red tint on its own rectangle.
  await page.evaluate((id) => {
    const w = window as Any
    w.__store.setState((d: Any) => {
      const l = d.layers.find((x: Any) => x.id === id)
      l.children.find((c: Any) => c.id === 'chamber-floor').textureTint = '#ff3030'
    })
  }, layerId)
  await lookAt(page, OVERHANG, 80)
  await waitFrame(page, 6)

  const chamber = await tintAt(page, IN_CHAMBER)
  const passage = await tintAt(page, IN_PASSAGE)
  expect(passage - chamber, 'the chamber reads red, the passage does not').toBeGreaterThan(0.25)

  // Blend: the overhang cell is the chamber's floor.
  const blended = await tintAt(page, OVERHANG)
  expect(Math.abs(blended - chamber)).toBeLessThan(Math.abs(blended - passage))

  // Across the door, from the passage's side into the chamber, the red rises steadily.
  const samples: number[] = []
  // Along the passage's middle into the chamber, from x = 8.86: the door's marker and leaf cover
  // x of about 8.93 and up, so a sample there reads the door, not the floor.
  for (let x = 8.86; x >= 8.1; x -= 0.03) samples.push(greenOverRed(await rgbAt(page, { x, y: 4 })))
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i], `sample ${i}`).toBeLessThanOrEqual(samples[i - 1] + 0.06)
    expect(samples[i - 1] - samples[i], `no step at sample ${i}`).toBeLessThan(0.2)
  }
  expect(samples[0] - samples[samples.length - 1], 'the ramp runs from the passage to the chamber').toBeGreaterThan(0.15)

  // Sharp, from the chamber's own card: the overhang is the passage's again, as its rectangle draws it.
  await select(page, 'chamber-floor')
  const card = page.getByTestId('shell-card')
  const edges = card.locator('[data-setting="card.floor.edges"]')
  await expect(edges).toBeVisible()
  await edges.getByText('Sharp', { exact: true }).click()
  await expect.poll(() => page.evaluate((id) => (window as Any).__store.getState().layers.find((l: Any) => l.id === id).style.showEdgeTransitions, layerId)).toBe(false)
  await waitFrame(page, 6)
  const sharp = await tintAt(page, OVERHANG)
  expect(Math.abs(sharp - passage)).toBeLessThan(Math.abs(sharp - chamber))

  // One undo step puts Blend back.
  await page.mouse.move(2, 2)
  await pressShortcut(page, 'z', { ctrl: true })
  await expect.poll(() => page.evaluate((id) => (window as Any).__store.getState().layers.find((l: Any) => l.id === id).style.showEdgeTransitions, layerId)).toBe(true)
})

test("rooms looks: an Edge band picked on the passage wins over its room's own set and changes its long side at once, the chamber's walls stay", { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  const layerId = await layCave(page)
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()
  await lookAt(page, { x: 9, y: 4 }, 40)
  await waitFrame(page, 10)

  const region = async (p: { x: number; y: number }) => {
    const at = await page.evaluate(([x, y]) => {
      const app = (window as Any).__pixiApp
      const world = app.stage.children[0]
      const r = app.canvas.getBoundingClientRect()
      return { x: r.left + x * world.scale.x + world.position.x, y: r.top + y * world.scale.y + world.position.y }
    }, [p.x, p.y])
    return (await page.screenshot({ clip: { x: at.x - 30, y: at.y - 12, width: 60, height: 24 } })).toString('base64')
  }
  const LONG_SIDE = { x: 11.5, y: 3 }
  const CHAMBER_WALL = { x: 4.5, y: 0 }
  await page.mouse.move(2, 2)
  const sideBefore = await region(LONG_SIDE)
  const chamberBefore = await region(CHAMBER_WALL)

  await select(page, 'passage-floor')
  const card = page.getByTestId('shell-card')
  const bandField = card.locator('[data-setting="card.floor.edgeBand"]')
  await expect(bandField).toBeVisible()
  const bands = await swatchValues(bandField)
  // The passage's room pins a stone set of the packs' own, which draws over the floor's edges.
  const walls = await swatchValues(card.locator('[data-setting="card.floor.walls"]'))
  const stone = walls.values.find((v) => !bands.values.includes(v) && v !== '__nowalls__' && v !== '__plain__')
  expect(stone, 'a stone wall set in the packs').toBeTruthy()
  await page.evaluate(
    ({ id, set }) => {
      ;(window as Any).__store.setState((d: Any) => {
        const room = d.layers.find((l: Any) => l.id === id).rooms.find((r: Any) => r.id === 'passage')
        room.look = { ...(room.look ?? {}), wallTextureSetId: set }
      })
    },
    { id: layerId, set: stone },
  )
  await select(page, null)
  await page.mouse.move(2, 2)
  await expect.poll(async () => (await region(LONG_SIDE)) !== sideBefore, { message: "the room's own set draws on the long side", timeout: 15_000 }).toBe(true)
  const sideUnderRoom = await region(LONG_SIDE)

  // The pick: another band when the packs have one, else the band it draws anyway. Either way the latest pick wins.
  await select(page, 'passage-floor')
  const now = await swatchValues(bandField)
  const band = now.values.find((v) => v !== now.picked && v !== '__none__' && v !== '__paint__') ?? now.picked
  expect(band, 'a band to pick').toBeTruthy()
  await bandField.locator(`[data-swatch="${band}"]`).click()
  const passageRoomSet = () =>
    page.evaluate((id) => (window as Any).__store.getState().layers.find((l: Any) => l.id === id).rooms.find((r: Any) => r.id === 'passage').look?.wallTextureSetId ?? null, layerId)
  await expect.poll(passageRoomSet, { message: "the room's own set goes with the pick" }).toBeNull()

  // No other edit: the long side redraws in the floor's band, the chamber's wall does not move.
  await select(page, null)
  await page.mouse.move(2, 2)
  await expect.poll(async () => (await region(LONG_SIDE)) !== sideUnderRoom, { message: "the passage's long side redraws", timeout: 15_000 }).toBe(true)
  expect(await region(CHAMBER_WALL)).toBe(chamberBefore)
})

/**
 * A swatch field's choices and the one picked, read without waiting on either form: a compact
 * picker shows only its picked tile until opened, an open one every tile with the picked one pressed.
 */
async function swatchValues(field: Locator): Promise<{ values: string[]; picked: string | null }> {
  const collapsed = field.locator('[data-swatch-picked]')
  const picked = (await collapsed.count()) > 0 ? await collapsed.first().getAttribute('data-swatch-picked') : null
  // Opened only when no tile is shown: a compact picker's tiles open in a popover of their own.
  const inline = (await field.locator('[data-swatch]').count()) > 0
  if (!inline && (await collapsed.count()) > 0) await collapsed.first().click()
  const tiles = inline ? field.locator('[data-swatch]') : field.page().locator('[data-composite="swatches"] [data-swatch]')
  const values = (await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('data-swatch')))).filter((v): v is string => !!v)
  const pressed = await tiles.evaluateAll((els) => els.find((e) => e.getAttribute('aria-pressed') === 'true')?.getAttribute('data-swatch') ?? null)
  return { values, picked: picked ?? pressed }
}
