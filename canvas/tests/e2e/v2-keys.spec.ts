import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Keys and the pointer in /v2, on a copy of the goblin warren: arrows on a focused slider
 * move the slider, not the selection; with the title menu open a tool letter stays out of
 * the map; Enter on a focused rail button does not end a wall chain; one Escape closes one
 * thing; a middle-drag pans without a marquee; a right-click on a gizmo handle keeps the
 * selection and opens its menu; the snap cross-hair goes when the pointer leaves; ? opens
 * the shortcuts sheet, whose filter finds Duplicate and whose keys read the Mac way on a Mac.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

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

async function openWarren(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
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

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const tool = (page: Page) => inPage<string>(page, `(s) => s().tools.activeTool`)
const walls = (page: Page) => inPage<number>(page, `(s, layer) => layer().standaloneWalls.length`)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
const hallAnchor = (page: Page) =>
  inPage<Pt>(page, `(s, layer) => { const r = layer().rooms.find((x) => x.name === 'Warren Hall'); return { x: r.anchor[0], y: r.anchor[1] } }`)

/** A 2×2 crate at `at`, everything else that picks near it taken away, the crate selected. */
async function crateAt(page: Page, at: Pt): Promise<void> {
  await inPage<void>(
    page,
    `(s, layer, w2s, at) => {
      window.__store.setState((st) => {
        const l = st.layers.find((x) => x.id === st.ui.activeLayerId)
        l.children = l.children.filter((c) => !(c.childType === 'asset' || c.childType === 'light' || c.childType === 'zone') ||
          Math.hypot((c.position ?? c.shape?.position ?? { x: 1e9, y: 1e9 }).x - at.x, (c.position ?? c.shape?.position ?? { x: 1e9, y: 1e9 }).y - at.y) > 5)
      })
      s().addChild(layer().id, {
        id: 'crate', name: 'crate', childType: 'asset', visible: true, objectType: 'asset',
        assetId: 'gg-demo:storage_crates_1_dark_1x1_object_A', position: at, rotation: 0, scale: 1, width: 2, height: 2,
        tint: '#ffffff', flipX: false, flipY: false,
      })
      s().setSelectedIds(['crate'])
    }`,
    at,
  )
  await waitFrame(page, 4)
}

async function click(page: Page, at: Pt): Promise<void> {
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0)
  await waitFrame(page, 2)
}

/** The sheet's row whose label is exactly `label`. */
const row = (sheet: ReturnType<Page['getByTestId']>, label: string) =>
  sheet.getByTestId('v2-shortcut-row').filter({ has: sheet.page().locator('.v2-keys__label', { hasText: new RegExp(`^${label}$`) }) })

/** Whether the snap cross-hair has anything drawn. */
const crosshairDrawn = (page: Page) =>
  page.evaluate(() => {
    const find = (n: Any): Any => (n.label === 'snapIndicator' ? n : (n.children ?? []).map(find).find(Boolean))
    const g = find((window as Any).__pixiApp.stage)
    return (g?.context?.instructions?.length ?? 0) > 0
  })

test('arrows on a focused slider move the slider, not the selection', async ({ page }) => {
  await openWarren(page)
  await crateAt(page, await hallAnchor(page))
  const before = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.id === 'crate')`)
  const slider = page.getByTestId('v2-selection-card').getByLabel('Opacity')
  await slider.focus()
  const value = await slider.inputValue()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(slider).not.toHaveValue(value)
  const after = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.id === 'crate')`)
  expect(after.position).toEqual(before.position)
  expect(await sel(page)).toEqual(['crate'])
})

test('with the title menu open, a tool letter stays out of the map and Escape closes the menu', async ({ page }) => {
  await openWarren(page)
  await inPage(page, `(s) => s().setActiveTool('wall')`)
  await page.getByTestId('v2-more').click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('v')
  expect(await tool(page)).toBe('wall')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(await tool(page)).toBe('wall')
  // Closed, the button lets the letters through again.
  await page.keyboard.press('v')
  expect(await tool(page)).toBe('select')
})

test('Enter on a focused rail button does not end a wall chain', async ({ page }) => {
  await openWarren(page)
  const a = await hallAnchor(page)
  await inPage(page, `(s) => s().setActiveTool('wall')`)
  const count = await walls(page)
  await click(page, await screenOf(page, { x: a.x - 2, y: a.y }))
  await click(page, await screenOf(page, { x: a.x + 2, y: a.y }))
  const curve = page.getByRole('button', { name: /^Curve mode/ })
  const curveBefore = await inPage<boolean>(page, `(s) => s().tools.curveMode`)
  await curve.focus()
  await page.keyboard.press('Enter')
  // The button took its Enter (it toggled); the chain did not.
  expect(await inPage<boolean>(page, `(s) => s().tools.curveMode`)).toBe(!curveBefore)
  expect(await walls(page)).toBe(count)
  // From the page itself Enter still ends the chain.
  await blur(page)
  await page.keyboard.press('Enter')
  await expect.poll(() => walls(page)).toBe(count + 1)
})

test('one Escape closes one thing: the popover over the sheet first, then the sheet', async ({ page }) => {
  await openWarren(page)
  await page.getByTestId('v2-rail-prep').click()
  await expect(page.getByTestId('v2-prep-sheet')).toBeVisible()
  await page.getByTestId('v2-grid-chip').click()
  await expect(page.getByRole('dialog', { name: 'Grid' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Grid' })).toHaveCount(0)
  await expect(page.getByTestId('v2-prep-sheet')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('v2-prep-sheet')).toHaveCount(0)
})

test('a middle-drag pans the map and draws no marquee', async ({ page }) => {
  await openWarren(page)
  const from = await screenOf(page, await hallAnchor(page))
  const stage = () =>
    page.evaluate(() => {
      const p = (window as Any).__pixiApp.stage.children[0].position
      return { x: p.x as number, y: p.y as number }
    })
  const before = await stage()
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: 'middle' })
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + i * 30, from.y + i * 20)
  await page.mouse.up({ button: 'middle' })
  await waitFrame(page, 3)
  const after = await stage()
  expect(Math.round(after.x - before.x)).toBe(180)
  expect(Math.round(after.y - before.y)).toBe(120)
  expect(await sel(page)).toEqual([])
})

test('a right-click on a gizmo handle keeps the selection and opens its menu', async ({ page }) => {
  await openWarren(page)
  const c = await hallAnchor(page)
  const at = { x: c.x + 1, y: c.y + 1 }
  await crateAt(page, at)
  await inPage(page, `(s) => s().setSelectedIds([])`)
  await click(page, await screenOf(page, at))
  expect(await sel(page)).toEqual(['crate'])
  // The handle: probe around the crate's corners for the point the box shows a resize cursor.
  const corners = await Promise.all(
    [
      { x: at.x - 1, y: at.y - 1 },
      { x: at.x + 1, y: at.y + 1 },
      { x: at.x, y: at.y },
      { x: at.x + 2, y: at.y + 2 },
    ].map((p) => screenOf(page, p)),
  )
  const handle = await page.evaluate((corners) => {
    const canvas = document.querySelector('canvas')!
    for (const c of corners) {
      for (let dx = -8; dx <= 8; dx += 2) {
        for (let dy = -8; dy <= 8; dy += 2) {
          const x = c.x + dx
          const y = c.y + dy
          canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse' }))
          if (/resize/.test(canvas.style.cursor)) return { x, y }
        }
      }
    }
    return null
  }, corners)
  expect(handle).not.toBeNull()
  await page.evaluate((p) => {
    document.querySelector('canvas')!.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: p.x, clientY: p.y, button: 2, bubbles: true, cancelable: true }),
    )
  }, handle!)
  await waitFrame(page, 2)
  expect(await sel(page)).toEqual(['crate'])
  await expect(page.getByRole('menuitem', { name: /^Duplicate/ }).first()).toBeVisible()
})

test('the snap cross-hair goes when the pointer leaves the map, and never shows for Select', async ({ page }) => {
  await openWarren(page)
  const p = await screenOf(page, await hallAnchor(page))
  await inPage(page, `(s) => s().setActiveTool('wall')`)
  await firePointer(page, 'pointermove', p.x, p.y, 0, 0)
  await waitFrame(page, 1)
  expect(await crosshairDrawn(page)).toBe(true)
  await page.evaluate(() => {
    document.querySelector('canvas')!.parentElement!.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, pointerType: 'mouse' }))
  })
  expect(await crosshairDrawn(page)).toBe(false)
  await inPage(page, `(s) => s().setActiveTool('select')`)
  await firePointer(page, 'pointermove', p.x + 10, p.y, 0, 0)
  expect(await crosshairDrawn(page)).toBe(false)
})

test('? opens the shortcuts sheet, and its filter finds Duplicate', async ({ page }) => {
  await openWarren(page)
  await blur(page)
  await page.keyboard.press('?')
  const sheet = page.getByTestId('v2-shortcuts-sheet')
  await expect(sheet).toBeVisible()
  expect(await sheet.getByTestId('v2-shortcut-row').count()).toBeGreaterThan(40)
  await sheet.getByLabel('Filter shortcuts').fill('Duplicate')
  const rows = sheet.getByTestId('v2-shortcut-row')
  await expect(row(sheet, 'Duplicate').locator('kbd')).toHaveText('Ctrl D')
  await expect(row(sheet, 'Duplicate and move').locator('kbd')).toHaveText('Alt Drag')
  await expect(rows).toHaveCount(2)
  // The title menu has a row for it too.
  await sheet.getByRole('button', { name: 'Close Keyboard shortcuts' }).click()
  await page.getByTestId('v2-more').click()
  await page.getByRole('menuitem', { name: /^Keyboard shortcuts/ }).click()
  await expect(sheet).toBeVisible()
})

test('on a Mac the keys read ⌘ and ⌥, in the sheet and the title menu', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) })
  })
  await openWarren(page)
  await page.getByTestId('v2-more').click()
  await expect(page.getByRole('menuitem', { name: /^Export/ }).locator('kbd')).toHaveText('⌘E')
  await page.keyboard.press('Escape')
  await blur(page)
  await page.keyboard.press('?')
  const sheet = page.getByTestId('v2-shortcuts-sheet')
  await sheet.getByLabel('Filter shortcuts').fill('Duplicate')
  await expect(row(sheet, 'Duplicate and move').locator('kbd')).toHaveText('⌥ Drag')
  await expect(row(sheet, 'Duplicate').locator('kbd')).toHaveText('⌘D')
})

test('Ctrl+Shift+N opens New map at once after Escape closed a dialog or the sheet', async ({ page }) => {
  await openWarren(page)
  const newMap = page.getByTestId('v2-new-map-modal')
  // The Export dialog, opened by its key and closed with Escape while the focus is in it.
  // The next key lands during the dialog's fade, when it is still on the page.
  await blur(page)
  await page.keyboard.press('Control+e')
  await expect(page.getByTestId('v2-export-modal').getByRole('button', { name: 'Close' })).toBeFocused()
  await page.waitForFunction(() => {
    const d = document.querySelector('[role="dialog"]')
    return !!d && !d.hasAttribute('data-starting-style') && d.getAnimations().length === 0
  })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+N')
  await expect(newMap).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(newMap).toHaveCount(0)
  // The shortcuts sheet, the same way.
  await blur(page)
  await page.keyboard.press('?')
  await expect(page.getByTestId('v2-shortcuts-sheet').getByLabel('Filter shortcuts')).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+N')
  await expect(newMap).toBeVisible()
})
