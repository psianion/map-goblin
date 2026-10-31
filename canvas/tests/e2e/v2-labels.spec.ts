import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Labels in /v2, end to end: the Labels tab's style tiles, place and type (the label lands
 * selected with its card's text field focused), bound labels following their room and door,
 * Esc taking back an untouched placeholder, halo and pill on the canvas, the players switch,
 * the export's Labels choice, the zone marks kept out of every export, one size range, and
 * no tiles for the Zone tool.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

/** Run `fn` (source text) in the page with the store getter and a world → screen mapping. */
async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = w.__pixiApp.stage.children[0]
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'w2s', 'arg', `return (${fn})(s, w2s, arg)`)(s, w2s, arg)
    },
    { fn, arg },
  )
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Any).__readCanvas = (read: (gl: WebGL2RenderingContext) => void) => {
      const canvas = (window as Any).__pixiApp.canvas
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      const draw = gl.getParameter(gl.FRAMEBUFFER_BINDING)
      const readFb = gl2 ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      try {
        read(gl)
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, draw)
        if (gl2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb)
      }
    }
  })
})

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

/** Into the /v2 editor on a fresh blank map: one level, one layer. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await inPage(page, `(s) => s().setActiveTool('select')`)
  await waitFrame(page, 6)
}

/** A copy of the goblin warren, framed, its rooms measured, the Select tool in hand. */
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
    const l = (window as Any).__store.getState().layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await inPage(page, `(s) => { const l = s().layers.find((x) => x.type === 'dungeon'); s().setActiveLayerId(l.id); s().setActiveTool('select') }`)
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
}

const toScreen = (page: Page, p: Pt) => inPage<Pt>(page, `(s, w2s, p) => w2s(p.x, p.y)`, p)

async function clickWorld(page: Page, p: Pt) {
  const at = await toScreen(page, p)
  await firePointer(page, 'pointermove', at.x, at.y)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
}

const room = (page: Page, name: string) =>
  inPage<Any>(page, `(s, w2s, n) => s().layers.find((l) => l.type === 'dungeon').rooms.find((r) => r.name === n)`, name)
const labels = (page: Page) =>
  inPage<Any[]>(page, `(s) => s().layers.flatMap((l) => l.type === 'dungeon' ? l.children.filter((c) => c.childType === 'text') : [])`)
const labelById = async (page: Page, id: string) => (await labels(page)).find((c) => c.id === id)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const textField = (page: Page) => page.getByTestId('v2-label-text')
const tiles = (page: Page) => page.getByRole('radiogroup', { name: 'Label styles' })

/** The Label tool in hand, with `style` picked on its tile. */
async function labelTool(page: Page, style?: string) {
  await key(page, 'n')
  await expect(tiles(page)).toBeVisible()
  if (style) await tiles(page).getByRole('radio', { name: style }).click()
}

/** Place a label at `p` with the Label tool; its id. */
async function place(page: Page, p: Pt): Promise<string> {
  const before = new Set((await labels(page)).map((c) => c.id))
  await clickWorld(page, p)
  const added = (await labels(page)).filter((c) => !before.has(c.id))
  expect(added).toHaveLength(1)
  return added[0].id
}

const addLabel = (page: Page, child: Record<string, unknown>) =>
  inPage<void>(page, `(s, w2s, c) => { const l = s().layers.find((x) => x.type === 'dungeon'); s().addChild(l.id, c) }`, child)

const label = (id: string, at: Pt, extra: Record<string, unknown> = {}) => ({
  id, name: id, childType: 'text', visible: true, text: 'MMMM', position: at, rotation: 0, scale: 1,
  fontSize: 1.5, color: '#1b1b1b', width: 3.3, height: 1.8, ...extra,
})

/** The pixels in a box around a world point, from the live drawing buffer. */
async function region(page: Page, world: Pt, half = 30): Promise<number[]> {
  return inPage<number[]>(
    page,
    `(s, w2s, a) => {
      const canvas = window.__pixiApp.canvas
      const r = canvas.getBoundingClientRect()
      const p = w2s(a.world.x, a.world.y)
      const d = devicePixelRatio
      const cx = Math.round((p.x - r.left) * d), cy = Math.round((p.y - r.top) * d), h = Math.round(a.half * d)
      const w = 2 * h, out = new Uint8Array(w * w * 4)
      window.__readCanvas((gl) => gl.readPixels(cx - h, canvas.height - (cy + h), w, w, gl.RGBA, gl.UNSIGNED_BYTE, out))
      return Array.from(out)
    }`,
    { world, half },
  )
}

/** How many pixels differ by more than a little between two reads of the same box. */
function changed(a: number[], b: number[]): number {
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++
  }
  return n
}

/** Export a PNG through the dialog with `labels` picked, unlit, 64 px a square; the file's bytes, base64. */
async function exportPng(page: Page, labelsPick: 'None' | 'Players' | 'All'): Promise<string> {
  await key(page, 'Control+e')
  const modal = page.getByTestId('v2-export-modal')
  await expect(modal).toBeVisible()
  await modal.getByRole('radio', { name: 'PNG' }).click()
  await modal.getByRole('radio', { name: '64' }).click()
  const lit = modal.getByRole('switch', { name: 'Apply lighting' })
  if ((await lit.getAttribute('aria-checked')) === 'true') await lit.click()
  await modal.getByRole('radiogroup', { name: 'Labels' }).getByRole('radio', { name: labelsPick }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('v2-export-go').click()])
  const bytes = readFileSync(await download.path())
  await expect(modal).toBeHidden()
  return bytes.toString('base64')
}

/** Pixels that differ between two PNGs of the same size (-1 when the sizes differ). */
const pngDiff = (page: Page, a: string, b: string) =>
  page.evaluate(
    async ({ a, b }) => {
      const load = async (b64: string) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = c.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        return ctx.getImageData(0, 0, bmp.width, bmp.height)
      }
      const [x, y] = await Promise.all([load(a), load(b)])
      if (x.width !== y.width || x.height !== y.height) return -1
      let n = 0
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2])
        if (d > 30) n++
      }
      return n
    },
    { a, b },
  )

// ─── Place and type ──────────────────────────────────────────────────────────

test('a Room name placed in Warren Hall lands selected, its field focused, reading the room’s name', async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Room name')
  await expect(page.getByTestId('v2-settings').getByText('0.8')).toBeVisible()
  await expect(page.getByTestId('v2-status-hint')).toContainText('Click to place')
  const hall = await room(page, 'Warren Hall')
  const id = await place(page, { x: hall.anchor[0], y: hall.anchor[1] + 0.5 })
  expect(await sel(page)).toEqual([id])
  await expect(textField(page)).toBeFocused()
  await expect(textField(page)).toHaveValue('Warren Hall')
  const c = await labelById(page, id)
  expect(c).toMatchObject({ style: 'room-name', weight: 'bold', backdrop: 'halo', bound: { kind: 'room', id: hall.id } })
  expect(c.players).toBeUndefined()
  await textField(page).press('Enter')
  await expect(textField(page)).not.toBeFocused()
  // The tool stays in hand for the next label.
  expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('text')
})

test('renaming the room in its card carries the label with it, and undo brings both back', async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Room name')
  const hall = await room(page, 'Warren Hall')
  const id = await place(page, { x: hall.anchor[0], y: hall.anchor[1] + 0.5 })
  await key(page, 'v')
  await inPage(page, `(s, w2s, rid) => s().setSelectedIds([rid])`, hall.id)
  const name = page.getByTestId('v2-selection-card').getByRole('textbox', { name: 'Room name' })
  await name.fill('Great Hall')
  await name.press('Enter')
  await expect.poll(async () => (await labelById(page, id)).text).toBe('Great Hall')
  await key(page, 'Control+z')
  await expect.poll(async () => (await labelById(page, id)).text).toBe('Warren Hall')
})

test('a Number pin shows its room’s number; a Door tag by the Chief Door reads the door’s name', async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Number pin')
  const nook = await room(page, 'Plunder Nook')
  const pin = await place(page, { x: nook.anchor[0], y: nook.anchor[1] })
  expect((await labelById(page, pin)).text).toBe(String(nook.number))
  await tiles(page).getByRole('radio', { name: 'Door tag' }).click()
  const door = await inPage<Any>(page, `(s) => s().layers.find((l) => l.type === 'dungeon').children.find((c) => c.name === 'Chief Door')`)
  const tag = await place(page, { x: door.position[0] + 0.3, y: door.position[1] + 0.3 })
  expect(await labelById(page, tag)).toMatchObject({ text: 'Chief Door', backdrop: 'pill', bound: { kind: 'door', id: door.id } })
})

test('a Door tag 1.1 sq from the Chief Door binds to it; with no door in reach it places nothing and the status bar says why', async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Door tag')
  const door = await inPage<Any>(page, `(s) => s().layers.find((l) => l.type === 'dungeon').children.find((c) => c.name === 'Chief Door')`)
  const tag = await place(page, { x: door.position[0] + 1.1, y: door.position[1] })
  expect(await labelById(page, tag)).toMatchObject({ text: 'Chief Door', bound: { kind: 'door', id: door.id } })
  const before = (await labels(page)).length
  await clickWorld(page, { x: door.position[0] - 4, y: door.position[1] })
  expect(await labels(page)).toHaveLength(before)
  await expect(page.getByTestId('v2-status-hint')).toContainText('Click on a door to tag it')
  await expect(page.getByTestId('v2-status-hint')).not.toContainText('Click on a door to tag it', { timeout: 4000 })
})

test('a Door tag follows its door while the host wall is dragged, and stays with it after', async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Door tag')
  const door = await inPage<Any>(page, `(s) => s().layers.find((l) => l.type === 'dungeon').children.find((c) => c.name === 'Chief Door')`)
  const tag = await place(page, { x: door.position[0] + 0.3, y: door.position[1] })
  const start = (await labelById(page, tag)).position
  await key(page, 'v')
  const wall = await inPage<Any>(page, `(s, w2s, id) => s().layers.find((l) => l.type === 'dungeon').standaloneWalls.find((w) => w.id === id)`, door.wallId)
  const [a, b] = wall.points
  // Near one end of the wall, clear of the door in its middle.
  const grab = { x: a[0] + (b[0] - a[0]) * 0.15, y: a[1] + (b[1] - a[1]) * 0.15 }
  const from = await toScreen(page, grab)
  const z = await inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  await firePointer(page, 'pointerup', from.x, from.y)
  await waitFrame(page, 2)
  expect(await sel(page)).toEqual([door.wallId])
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 4; i++) await firePointer(page, 'pointermove', from.x - (2 * z * i) / 4, from.y, 0.5, 1)
  await waitFrame(page, 2)
  // Live, mid-drag: the tag has moved with the door as drawn already (the door slides to the
  // end of the moving wall until the drop re-hangs it, and the tag goes where it draws).
  expect((await labelById(page, tag)).position.x).toBeLessThan(start.x - 0.3)
  await firePointer(page, 'pointerup', from.x - 2 * z, from.y)
  await waitFrame(page, 3)
  // The drop re-hangs the door on the moved wall; the tag moved by what the door moved.
  const moved = await inPage<Any>(page, `(s, w2s, id) => s().layers.find((l) => l.type === 'dungeon').children.find((c) => c.id === id)`, door.id)
  const now = (await labelById(page, tag)).position
  expect(Math.hypot(moved.position[0] - door.position[0], moved.position[1] - door.position[1])).toBeGreaterThan(0.3)
  expect(now.x - start.x).toBeCloseTo(moved.position[0] - door.position[0], 1)
  expect(now.y - start.y).toBeCloseTo(moved.position[1] - door.position[1], 1)
})

test('a small Number pin dragged by its centre moves, its size unchanged', async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Number pin')
  const nook = await room(page, 'Plunder Nook')
  // Off the room's own anchor badge, which a press there would pick instead.
  const pin = await place(page, { x: nook.anchor[0] + 1.5, y: nook.anchor[1] + 1.5 })
  await key(page, 'v')
  const before = await labelById(page, pin)
  const z = await inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)
  // Small on screen: the case the handles used to cover.
  expect(Math.min(before.width, before.height) * z).toBeLessThan(28)
  const from = await toScreen(page, before.position)
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 6; i++) await firePointer(page, 'pointermove', from.x + (2 * z * i) / 6, from.y, 0.5, 1)
  await firePointer(page, 'pointerup', from.x + 2 * z, from.y)
  await waitFrame(page, 3)
  const after = await labelById(page, pin)
  expect(after.position.x - before.position.x).toBeGreaterThan(1.5)
  expect([after.width, after.height, after.fontSize]).toEqual([before.width, before.height, before.fontSize])
})

test('a Custom label typed into and committed with Enter shows its text on the canvas', async ({ page }) => {
  await openEditor(page)
  await labelTool(page)
  await expect(tiles(page).getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
  const at = { x: 0, y: 0 }
  const bare = await region(page, at)
  const id = await place(page, at)
  await expect(textField(page)).toBeFocused()
  await page.keyboard.type('BEWARE')
  await page.keyboard.press('Enter')
  expect((await labelById(page, id)).text).toBe('BEWARE')
  await inPage(page, `(s) => s().setSelectedIds([])`)
  await waitFrame(page, 6)
  expect(changed(bare, await region(page, at))).toBeGreaterThan(30)
})

test('Esc on a fresh placeholder takes the label back', async ({ page }) => {
  await openEditor(page)
  await labelTool(page)
  await place(page, { x: 0, y: 0 })
  await expect(textField(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
  expect(await labels(page)).toHaveLength(0)
  await expect(page.getByTestId('v2-selection-card')).toHaveCount(0)
})

test('a Custom label placed by a real click takes the typing at once; Esc on a fresh one removes it', async ({ page }) => {
  await openEditor(page)
  await labelTool(page, 'Custom')
  await expect(page.getByTestId('v2-dock-tab-labels')).toHaveAttribute('aria-selected', 'true')
  // A real press (mousedown and its focus move included), then keys straight after it.
  const at = await toScreen(page, { x: 0, y: 0 })
  await page.mouse.click(at.x, at.y)
  await page.keyboard.type('Beware')
  await expect(textField(page)).toBeFocused()
  await expect(textField(page)).toHaveValue('Beware')
  await page.keyboard.press('Enter')
  expect((await labels(page)).map((c) => c.text)).toEqual(['Beware'])
  await expect(page.getByTestId('v2-dock-tab-labels')).toHaveAttribute('aria-selected', 'true')

  const next = await toScreen(page, { x: 4, y: 0 })
  await page.mouse.click(next.x, next.y)
  await expect(textField(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
  expect((await labels(page)).map((c) => c.text)).toEqual(['Beware'])
})

test('the Layers sheet names a label row by its text', async ({ page }) => {
  await openEditor(page)
  await labelTool(page)
  const id = await place(page, { x: 0, y: 0 })
  await page.keyboard.type('Beware the pit')
  await page.keyboard.press('Enter')
  expect((await labelById(page, id)).name).toBe('Label 1')
  await page.getByTestId('v2-open-layers').click()
  const sheet = page.getByTestId('v2-layers-sheet')
  const expand = sheet.getByTestId('v2-layers-layer').first().getByRole('button', { name: 'Expand' })
  if (await expand.count()) await expand.click()
  const row = sheet.locator(`[data-object-id="${id}"]`)
  await expect(row).toContainText('Beware the pit')
  await expect(row).not.toContainText('Label 1')
})

// ─── Look ────────────────────────────────────────────────────────────────────

test('a halo and a pill draw on the canvas around the letters', async ({ page }) => {
  await openEditor(page)
  // Light letters, so the halo's and the plate's dark shows on the paper.
  const light = { color: '#f2f2f2' }
  await addLabel(page, label('plain', { x: -6, y: 0 }, light))
  await addLabel(page, label('halo', { x: 0, y: 0 }, { ...light, backdrop: 'halo' }))
  await addLabel(page, label('pill', { x: 6, y: 0 }, { ...light, backdrop: 'pill', width: 4.35, height: 2.1 }))
  await waitFrame(page, 8)
  const ink = (px: number[]) => {
    let n = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 300) n++
    return n
  }
  const plain = ink(await region(page, { x: -6, y: 0 }))
  const halo = ink(await region(page, { x: 0, y: 0 }))
  const pill = ink(await region(page, { x: 6, y: 0 }))
  expect(halo).toBeGreaterThan(plain + 50)
  expect(pill).toBeGreaterThan(halo)
})

test('the card’s Visible to players switch writes `players`', async ({ page }) => {
  await openEditor(page)
  await addLabel(page, label('t', { x: 0, y: 0 }))
  await inPage(page, `(s) => s().setSelectedIds(['t'])`)
  const sw = page.getByTestId('v2-selection-card').getByRole('switch', { name: 'Visible to players' })
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await sw.click()
  expect((await labelById(page, 't')).players).toBe(true)
  await key(page, 'Control+z')
  expect((await labelById(page, 't')).players).toBeUndefined()
})

// ─── Export ──────────────────────────────────────────────────────────────────

test('export with Labels = Players leaves out exactly the DM-only labels', async ({ page }) => {
  await openEditor(page)
  await addLabel(page, label('secret', { x: 0, y: 0 }))
  await waitFrame(page, 4)
  const all = await exportPng(page, 'All')
  const players = await exportPng(page, 'Players')
  expect(await pngDiff(page, all, players)).toBeGreaterThan(100)
  // Marked for players, it is in the Players file too: nothing else differs.
  await inPage(page, `(s) => { const l = s().layers.find((x) => x.type === 'dungeon'); s().updateChild(l.id, 'secret', { players: true }) }`)
  await waitFrame(page, 4)
  expect(await pngDiff(page, all, await exportPng(page, 'Players'))).toBe(0)
  const none = await exportPng(page, 'None')
  expect(await pngDiff(page, all, none)).toBeGreaterThan(100)
})

test('the zone marks never reach an export (and did, before they were held back)', async ({ page }) => {
  await openEditor(page)
  const bare = await exportPng(page, 'All')
  await inPage(page, `(s) => {
    const l = s().layers.find((x) => x.type === 'dungeon')
    s().addChild(l.id, { id: 'z1', name: 'Trap', childType: 'zone', visible: true, shape: { kind: 'rect', x: -3, y: -3, width: 6, height: 6 } })
    s().setSelectedIds(['z1'])
  }`)
  await waitFrame(page, 6)
  // The marks are drawn, in the very container the file is rendered from.
  expect(
    await page.evaluate(() => {
      const world = (window as Any).__pixiApp.stage.children[0]
      const marks = world.children.find((c: Any) => c.label === 'zoneOverlay')
      return !!marks && marks.visible
    }),
  ).toBe(true)
  expect(await pngDiff(page, bare, await exportPng(page, 'All'))).toBe(0)
  // Unrecognised (the pipeline as it was), the same marks land in the file.
  await page.evaluate(() => {
    const world = (window as Any).__pixiApp.stage.children[0]
    world.children.find((c: Any) => c.label === 'zoneOverlay').label = 'zoneOverlay-unheld'
  })
  const leaked = await exportPng(page, 'All')
  await page.evaluate(() => {
    const world = (window as Any).__pixiApp.stage.children[0]
    world.children.find((c: Any) => c.label === 'zoneOverlay-unheld').label = 'zoneOverlay'
  })
  expect(await pngDiff(page, bare, leaked)).toBeGreaterThan(50)
})

// ─── Dock ────────────────────────────────────────────────────────────────────

test('the dock’s Size runs 0.2 to 6, the card’s the same', async ({ page }) => {
  await openEditor(page)
  await labelTool(page)
  const dock = page.getByTestId('v2-settings').getByRole('slider', { name: 'Size' })
  await expect(dock).toHaveAttribute('min', '0.2')
  await expect(dock).toHaveAttribute('max', '6')
  await place(page, { x: 0, y: 0 })
  const card = page.getByTestId('v2-selection-card').getByRole('slider', { name: 'Size' })
  await expect(card).toHaveAttribute('min', '0.2')
  await expect(card).toHaveAttribute('max', '6')
})

test('the Zone tool shows no style tiles', async ({ page }) => {
  await openEditor(page)
  await labelTool(page)
  await key(page, 'z')
  expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('zone')
  await expect(tiles(page)).toHaveCount(0)
  await expect(page.getByText(/soon/)).toHaveCount(0)
})

test('no accent colour in the new CSS: every colour it names is a grey', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/v2/editor/labels.css', import.meta.url)), 'utf8')
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
