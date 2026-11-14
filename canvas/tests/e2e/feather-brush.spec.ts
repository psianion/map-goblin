import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { lookAt, openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

type Pt = { x: number; y: number }

/** World `p` on the page. */
async function screenOf(page: Page, p: Pt): Promise<Pt> {
  return page.evaluate(([x, y]) => {
    const app = (window as Any).__pixiApp
    const r = app.canvas.getBoundingClientRect()
    const w = app.stage.children[0]
    return { x: r.left + x * w.scale.x + w.position.x, y: r.top + y * w.scale.x + w.position.y }
  }, [p.x, p.y])
}

/** A brush stroke from world `from` to world `to` (a dab when they are the same), then the pointer off the map. */
async function stroke(page: Page, from: Pt, to: Pt = from): Promise<void> {
  const a = await screenOf(page, from)
  const b = await screenOf(page, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 12 })
  await page.mouse.up()
  await page.mouse.move(1390, 700)
  await waitFrame(page, 8)
}

/** Writes brush settings straight to the store. */
async function brush(page: Page, patch: Record<string, unknown>, erase: boolean): Promise<void> {
  await page.evaluate(
    ({ patch, erase }) => {
      const store = (window as Any).__store
      store.setState((s: Any) => {
        Object.assign(s.tools.settings.material, patch)
      })
      store.getState().setEraseMode(erase)
    },
    { patch, erase },
  )
}

/** The ground pieces on the layer in hand: their outline's ring count and their fades. */
const pieces = (page: Page) =>
  page.evaluate(() => {
    const s = (window as Any).__store.getState()
    const layer = s.layers.find((l: Any) => l.id === s.ui.activeLayerId)
    return layer.children
      .filter((c: Any) => c.childType === 'shape' && c.ground)
      .map((c: Any) => ({ id: c.id as string, rings: c.contours.length as number, soft: c.soft as number | undefined, fades: (c.fades ?? []) as Any[] }))
  })

/** Whether the piece is drawn through its edge mask. */
const masked = (page: Page, id: string) =>
  page.evaluate((id) => {
    const find = (n: Any, label: string): Any => (n.label === label ? n : (n.children ?? []).map((c: Any) => find(c, label)).find(Boolean))
    const piece = find((window as Any).__pixiApp.stage, `piece-${id}`)
    return !!piece && !!find(piece, 'piece-soft')
  }, id)

// Feather on the brush: one control for painting and erasing. A feathered erase at full
// strength cuts only the stroke's core and fades the piece over the rest; at half strength it
// cuts nothing and leaves the piece half see-through; painting over the fade restores it; and
// undo takes each stroke back in one step.
test('feather brush: a soft erase fades a piece, paint restores it, undo takes each back', { tag: ['@terrain', '@feather'] }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Terrain brush')
  await expect(page.getByTestId('shell-dock').locator('[data-setting="material.feather"]')).toBeVisible()
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.settings.material.feather)).toBeUndefined()

  // One crisp ground piece over Warren Hall, rooms and all.
  await lookAt(page, { x: 20, y: 26.5 }, 30)
  const before = (await pieces(page)).map((p: Any) => p.id)
  await brush(page, { radius: 4, feather: 0, strength: undefined, overRooms: true }, false)
  await stroke(page, { x: 16, y: 26 }, { x: 24, y: 26 })
  const painted = (await pieces(page)).filter((p: Any) => !before.includes(p.id))
  expect(painted).toHaveLength(1)
  const id = painted[0].id
  expect(painted[0].soft).toBeUndefined()
  expect(painted[0].fades).toEqual([])

  // A feathered dab at full strength: the core comes out, the rim fades.
  await brush(page, { radius: 2, feather: 0.5 }, true)
  await stroke(page, { x: 20, y: 26 })
  let piece = (await pieces(page)).find((p: Any) => p.id === id)!
  expect(piece.rings, 'the core is cut out').toBe(2)
  expect(piece.fades).toHaveLength(1)
  expect(piece.fades[0].feather).toBe(1)
  expect(piece.fades[0].depth).toBeUndefined()
  await expect.poll(() => masked(page, id), { message: 'the faded piece draws through its mask' }).toBe(true)

  // Half strength, no feather: nothing cut, an even half fade.
  await brush(page, { feather: 0, strength: 0.5 }, true)
  await stroke(page, { x: 16.5, y: 26 })
  piece = (await pieces(page)).find((p: Any) => p.id === id)!
  expect(piece.rings).toBe(2)
  expect(piece.fades).toHaveLength(2)
  expect(piece.fades[1]).toMatchObject({ feather: 0, depth: 0.5 })

  // Undo takes the half pass back alone.
  await page.keyboard.press('Control+z')
  await waitFrame(page, 4)
  expect((await pieces(page)).find((p: Any) => p.id === id)!.fades).toHaveLength(1)

  // Paint over the first dab: it merges, fills the cut and clears the fade there.
  await brush(page, { radius: 3, feather: 0.5, strength: undefined }, false)
  await stroke(page, { x: 20, y: 26 })
  piece = (await pieces(page)).find((p: Any) => p.id === id)!
  expect(piece.rings).toBe(1)
  expect(piece.fades).toEqual([])
  expect(piece.soft).toBe(1.5)

  await page.keyboard.press('Control+z')
  await waitFrame(page, 4)
  piece = (await pieces(page)).find((p: Any) => p.id === id)!
  expect(piece.rings).toBe(2)
  expect(piece.fades).toHaveLength(1)
})
