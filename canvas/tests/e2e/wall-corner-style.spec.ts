import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitFrame } from './helpers'
import { floorArtLanded, lookAt, openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

type Pt = { x: number; y: number }

const sharp = createRequire(fileURLToPath(new URL('../../../packages/vault-engine/package.json', import.meta.url)))('sharp')

/** Open floor in Warren Hall: three cells clear of the cave's edge, two of every prop and light. */
const OPEN_FLOOR: Pt = { x: 21, y: 24.5 }

/** World `p` on the page (pointer events and page screenshots both count from the viewport). */
async function screenOf(page: Page, p: Pt): Promise<Pt> {
  return page.evaluate(([x, y]) => {
    const w = window as Any
    const r = w.__pixiApp.canvas.getBoundingClientRect()
    const wd = w.__pixiApp.stage.children[0]
    return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
  }, [p.x, p.y])
}

async function click(page: Page, world: Pt): Promise<void> {
  const at = await screenOf(page, world)
  await firePointer(page, 'pointermove', at.x, at.y)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
}

/** The luminance of every pixel in the world box `reach` cells round `c`, off one page screenshot. */
async function patch(page: Page, c: Pt, reach: number): Promise<number[]> {
  const a = await screenOf(page, { x: c.x - reach, y: c.y - reach })
  const b = await screenOf(page, { x: c.x + reach, y: c.y + reach })
  const png = await page.screenshot({ clip: { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(b.x - a.x), height: Math.round(b.y - a.y) } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const out: number[] = []
  for (let i = 0; i < info.width * info.height; i++) {
    const k = i * info.channels
    out.push(0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2])
  }
  return out
}

/** The share of pixels two patches of the same box disagree on by more than 8 of luminance. */
const changed = (p: number[], q: number[]) => p.filter((v, i) => Math.abs(v - q[i]) > 8).length / p.length

// Item 5: the dock's Corner style switches the pieces at a wall's turns; the corner is
// read both ways, and undo puts the first look back.
test('wall corner style: Rounded and Sharp lay different corner pieces, and undo restores', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
  })
  await pickFromFlyout(page, 'Design', 'Wall')

  // An L turning at `corner`; the box read is the turn and a stone's width round it, close up.
  const corner = { x: OPEN_FLOOR.x + 3, y: OPEN_FLOOR.y }
  const REACH = 0.6
  await lookAt(page, corner, 48)
  await expect.poll(() => floorArtLanded(page), { message: 'the floor texture lands' }).toBe(true)
  await page.mouse.move(2, 500)
  await waitFrame(page, 4)
  const floor = await patch(page, corner, REACH)
  await click(page, OPEN_FLOOR)
  await click(page, corner)
  await click(page, { x: corner.x, y: corner.y + 3 })
  await page.keyboard.press('Enter')
  await waitFrame(page, 4)

  // A stone set, so the turn is laid with authored corner pieces rather than a cave band.
  const id = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.id === st.ui.activeLayerId)
    const w = l.standaloneWalls.at(-1)
    st.updateWall(l.id, w.id, { textureSetId: 'GG_Fieldstone' })
    return w.id as string
  })
  await waitFrame(page, 6)

  const dock = page.getByTestId('shell-dock').locator('[data-setting="wall.cornerStyle"]')
  await expect(dock).toBeVisible()
  // Nothing picked, so no selection outline sits on the corner while it is read.
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  await page.mouse.move(2, 500)
  // The set's art decodes on first use: wait for the stones to cover a good part of the box.
  await expect.poll(async () => changed(await patch(page, corner, REACH), floor), { message: 'the sharp corner lays stone' }).toBeGreaterThan(0.3)
  await waitFrame(page, 4)
  const sharpCorner = await patch(page, corner, REACH)

  await page.evaluate((wallId) => (window as Any).__store.getState().setSelectedIds([wallId]), id)
  await dock.getByText('Rounded').click()
  const style = await page.evaluate((wallId) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      const w = l.type === 'dungeon' ? l.standaloneWalls.find((x: Any) => x.id === wallId) : null
      if (w) return w.cornerStyle
    }
    return null
  }, id)
  expect(style).toBe('rounded')
  // The selection outline would read as a change too: drop it before reading the corner again.
  await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
  await page.mouse.move(2, 500)
  await waitFrame(page, 6)
  const rounded = await patch(page, corner, REACH)
  console.log(`corner box: sharp vs floor ${changed(sharpCorner, floor).toFixed(3)}, rounded vs sharp ${changed(rounded, sharpCorner).toFixed(3)}`)
  expect(changed(rounded, sharpCorner), 'the turn reads differently rounded').toBeGreaterThan(0.1)

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await page.mouse.move(2, 500)
  await expect.poll(async () => changed(await patch(page, corner, REACH), sharpCorner), { message: 'undo lays the sharp corner again' }).toBeLessThan(0.01)
})
