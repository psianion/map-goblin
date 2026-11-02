import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { getPixelColor, waitForBoot, waitFrame } from './helpers'
import { installStubs } from './publishStubs'

/**
 * Plateaus in the editor, on the authored test maps (session/testdata/plateau-test and
 * tower-test): plan §0 scenarios 2, 3, 4 and the editor half of 5 (bridge landings), the
 * hill's card readouts, and both maps opening, exporting a PNG and publishing. Waterfalls
 * are the next step and stand here as a `fixme` row with the scenario's words.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const read = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../session/testdata/${name}.mapbuilder`, import.meta.url)), 'utf8'))
const PLATEAU = read('plateau-test')
const TOWER = read('tower-test')

async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = w.__pixiApp.stage.children[0]
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const child = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

/** The labels under one band's container in the plateaus sublayer (`plateau-band-<height>`). */
const bandLabels = (page: Page, height: number) =>
  page.evaluate((h) => {
    const w = window as Any
    const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
    const band = find(w.__pixiApp.stage, `plateau-band-${h}`)
    const out: { label: string; children: number }[] = []
    const walk = (c: Any) => {
      for (const k of c.children ?? []) {
        if (k.label) out.push({ label: k.label, children: k.children?.length ?? 0 })
        walk(k)
      }
    }
    if (band) walk(band)
    return out
  }, height)

async function openMap(page: Page, doc: Any): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen?.(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
  }, doc)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon' && x.children.some((c: Any) => c.childType === 'shape'))
    st.setActiveLayerId(l.id)
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
  return errors
}

/** The canvas luminance at world `p`: the median of three reads a frame apart. */
async function lum(page: Page, p: Pt): Promise<number> {
  const at = await screenOf(page, p)
  const r = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  const reads: number[] = []
  for (let k = 0; k < 3; k++) {
    const c = await getPixelColor(page, at.x - r.left, at.y - r.top)
    reads.push(0.299 * c.r + 0.587 * c.g + 0.114 * c.b)
    await waitFrame(page, 1)
  }
  return reads.sort((a, b) => a - b)[1]
}

/** The sun at a fixed hour of the editor's preview clock. */
async function sunAt(page: Page, hour: number): Promise<void> {
  await page.evaluate((h) => {
    ;(window as Any).__store.setState((s: Any) => {
      s.mapSettings.environment = 'outdoor'
      s.mapSettings.naturalLight = true
      s.ui.previewClock = h * 60
    })
  }, hour)
  await waitFrame(page, 8)
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => (window as Any).__store.getState().setSelectedIds([i]), id)
  await waitFrame(page, 2)
}

test.describe('plateau-test in the editor', () => {
  test('opens with every named object and draws every band without an error', async ({ page }) => {
    const errors = await openMap(page, PLATEAU)
    for (const id of ['ground', 'outcrop', 'outcrop-stairs', 'hill', 'summit', 'pit', 'far-mesa', 'cobble-road', 'dirt-road', 'river', 'plank-bridge', 'torch-top', 'torch-ground']) {
      expect(await child(page, id), id).toBeTruthy()
    }
    await expect.poll(async () => (await bandLabels(page, 2)).length).toBeGreaterThan(0)
    for (const h of [-2, 1, 2, 3]) expect((await bandLabels(page, h)).length, `band ${h}`).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('scenario 2: the outcrop is laid with rock and throws a shadow the clock swings', async ({ page }) => {
    await openMap(page, PLATEAU)
    // The outcrop is the only +2 band: rock along its edge, and a top line.
    await expect
      .poll(async () => (await bandLabels(page, 2)).find((l) => l.label === 'plateau-cliff')?.children ?? 0)
      .toBeGreaterThan(4)
    // Morning: the shadow falls west, off the outcrop's west cliff; late afternoon, east.
    const west = { x: 3.5, y: 10 }
    const east = { x: 12.5, y: 9.75 }
    await sunAt(page, 9)
    const [w9, e9] = [await lum(page, west), await lum(page, east)]
    await sunAt(page, 17)
    const [w17, e17] = [await lum(page, west), await lum(page, east)]
    expect(w9, 'west of the cliff is darker in the morning').toBeLessThan(w17 - 2)
    expect(e17, 'east of the cliff is darker in the afternoon').toBeLessThan(e9 - 2)
  })

  test('scenario 3: the hill reads 1 and the summit 3, with contours on the slope and a 2-cell drop', async ({ page }) => {
    await openMap(page, PLATEAU)
    const hill = await bandLabels(page, 1)
    expect(hill.some((l) => l.label === 'plateau-slope')).toBe(true)
    expect(hill.some((l) => l.label === 'plateau-contours')).toBe(true)
    expect((await bandLabels(page, 3)).some((l) => l.label === 'plateau-cliff')).toBe(true)

    await select(page, 'hill')
    await expect(page.getByTestId('v2-plateau-height')).toContainText('+1')
    await expect(page.getByTestId('v2-plateau-standing')).toHaveText('+1 · drop 1')
    await select(page, 'summit')
    await expect(page.getByTestId('v2-plateau-height')).toContainText('+2')
    await expect(page.getByTestId('v2-plateau-standing')).toHaveText('+3 · drop 2')
    await expect(page.getByRole('button', { name: 'Auto (hides)' })).toBeVisible()
  })

  test('scenario 4: the stairs part the rock, and the Opening tool places more in one undo step', async ({ page }) => {
    await openMap(page, PLATEAU)
    const outcrop = await bandLabels(page, 2)
    expect(outcrop.some((l) => l.label === 'opening-outcrop-stairs')).toBe(true)
    // No rock sprite sits over the stairs' gap at (12, 7.5).
    const overGap = await page.evaluate(() => {
      const w = window as Any
      const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
      const rock = find(find(w.__pixiApp.stage, 'plateau-band-2'), 'plateau-cliff')
      return rock.children.filter((s: Any) => Math.hypot(s.position.x - 12, s.position.y - 7.5) < 0.6).length
    })
    expect(overGap).toBe(0)

    // S, then a click on the far mesa's north edge.
    await blur(page)
    await page.keyboard.press('s')
    const at = await screenOf(page, { x: 10, y: 26.1 })
    await page.mouse.move(at.x, at.y)
    await waitFrame(page, 2)
    await page.mouse.click(at.x, at.y)
    await waitFrame(page, 2)
    const openings = () => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'opening')`)
    await expect.poll(async () => (await openings()).length).toBe(2)
    expect((await openings()).find((o) => o.id !== 'outcrop-stairs').shapeId).toBe('far-mesa')
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await openings()).length).toBe(1)
  })

  test('scenario 5 (editor half): a bridge from the +2 outcrop to the +3 far mesa opens a landing in each cliff it rests on', async ({ page }) => {
    // "Draw a bridge from a +2 plateau to a +3 plateau across a pit." The plank bridge's ends
    // rest on the outcrop's south edge (7, 11) and the far mesa's north edge (7, 26): each
    // parts the rock there (landingGaps), and the bridge is planks, posts and rope.
    await openMap(page, PLATEAU)
    const rockNear = (height: number, x: number, y: number) =>
      page.evaluate(
        ({ height, x, y }) => {
          const w = window as Any
          const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
          const rock = find(find(w.__pixiApp.stage, `plateau-band-${height}`), 'plateau-cliff')
          return { all: rock.children.length, near: rock.children.filter((s: Any) => Math.hypot(s.position.x - x, s.position.y - y) < 0.6).length }
        },
        { height, x, y },
      )
    await expect.poll(async () => (await rockNear(2, 7, 11)).all).toBeGreaterThan(4)
    expect((await rockNear(2, 7, 11)).near, 'rock across the outcrop landing').toBe(0)
    expect((await rockNear(3, 7, 26)).all).toBeGreaterThan(4)
    expect((await rockNear(3, 7, 26)).near, 'rock across the mesa landing').toBe(0)
    // The bridge itself: planks across, posts down both edges with a rope drawn between them.
    const bridge = () =>
      page.evaluate(() => {
        const w = window as Any
        const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
        const pool = find(find(w.__pixiApp.stage, 'path-overhead-plank-bridge'), 'path-units')
        const kids = pool?.children ?? []
        return {
          sprites: kids.filter((k: Any) => k.anchor).length,
          ropes: kids.filter((k: Any) => !k.anchor).length,
          left: kids.filter((k: Any) => k.anchor && Math.abs(k.position.x - 6) < 0.05).length,
          right: kids.filter((k: Any) => k.anchor && Math.abs(k.position.x - 8) < 0.05).length,
        }
      })
    await expect.poll(async () => (await bridge()).sprites).toBeGreaterThan(30)
    const laid = await bridge()
    expect(laid.ropes).toBe(1)
    expect(laid.left).toBeGreaterThan(5)
    expect(laid.right).toBeGreaterThan(5)
  })

  test.fixme('scenario 7: the river shows a waterfall where it runs off the outcrop’s west cliff', async () => {
    // "Draw a river with banks; where it crosses a cliff downhill a waterfall shows." The
    // river leaves the +2 outcrop over its west edge (x = 4) near y = 6.8: cliffCrossings
    // finds that span and drawWaterfall hangs from it.
  })
})

test.describe('both test maps export and publish', () => {
  for (const [name, doc] of [['plateau-test', PLATEAU], ['tower-test', TOWER]] as const) {
    test(`${name} exports a PNG and publishes`, async ({ page }) => {
      const errors = await openMap(page, doc)
      if (name === 'tower-test') {
        expect(await page.evaluate(() => (window as Any).__store.getState().levels.map((l: Any) => l.name))).toEqual([
          'Cellar',
          'Ground',
          'First floor',
        ])
      }

      await blur(page)
      await page.keyboard.press('Control+e')
      const modal = page.getByTestId('v2-export-modal')
      await expect(modal).toBeVisible()
      const [png] = await Promise.all([page.waitForEvent('download'), modal.getByTestId('v2-export-go').click()])
      expect(png.suggestedFilename()).toMatch(/\.png$/)
      expect([...readFileSync(await png.path()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

      const calls = await installStubs(page, [
        { method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaigns: [] } }) },
        { method: 'POST', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaignId: 'camp-1', identityId: 'id-1', token: 'tok-1' } }) },
        {
          method: 'POST',
          path: /^\/api\/campaigns\/camp-1\/maps$/,
          respond: () => ({ json: { mapId: 'map-1', sceneId: 'scene-1', name: doc.mapSettings.name, sizeBytes: 1 } }),
        },
      ])
      await page.getByTestId('v2-publish').click()
      const dialog = page.getByTestId('v2-publish-dialog')
      await dialog.getByLabel('Admin pass').fill('adminpass')
      await dialog.getByLabel('Admin pass').press('Enter')
      await dialog.getByLabel('Create new campaign').fill('Plateaus')
      await dialog.getByRole('button', { name: 'Create' }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      const upload = calls.find((c) => c.method === 'POST' && /\/maps$/.test(c.path))
      expect(upload?.bodyBuffer?.length ?? 0).toBeGreaterThan(100)
      expect(errors).toEqual([])
    })
  }
})
