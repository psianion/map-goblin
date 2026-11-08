import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitFrame } from './helpers'
import { openEditor, pickFromFlyout, pickTool, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Pt = { x: number; y: number }

const activeTool = (page: Page) => page.evaluate(() => (window as Any).__store.getState().tools.activeTool as string)

/** A key to the page, as the map hears it: nothing focused. */
async function press(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press(key)
  await waitFrame(page, 2)
}

// Step 9: the rail, family, tool and dock keys come from the registry.
test('keys from the registry: a family key, a tool key, Escape, Previous tool and the sheet', { tag: '@keys' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  const flyout = page.getByTestId('shell-flyout')

  // D opens Design's flyout, F picks Floor from it and closes it.
  await press(page, 'd')
  await expect(flyout).toBeVisible()
  await expect(flyout).toHaveAttribute('data-family', 'design')
  await press(page, 'f')
  await expect(flyout).toBeHidden()
  expect(await activeTool(page)).toMatch(/^(rectangle|polygon|regularPolygon)$/)
  await expect(page.getByTestId('shell-tool-panel')).toHaveAttribute('data-tool', 'floor')

  // A dock key: P is the polygon in Floor's shape row.
  await press(page, 'p')
  expect(await activeTool(page)).toBe('polygon')

  // With Design's tool in hand, its tool keys answer straight away: W is Wall.
  await press(page, 'w')
  expect(await activeTool(page)).toBe('wall')

  // Escape closes a flyout without picking anything.
  await press(page, 't')
  await expect(flyout).toHaveAttribute('data-family', 'terrain')
  await press(page, 'Escape')
  await expect(flyout).toBeHidden()
  expect(await activeTool(page)).toBe('wall')

  // V is Select; Q goes back to the last family tool.
  await press(page, 'v')
  expect(await activeTool(page)).toBe('select')
  await press(page, 'q')
  expect(await activeTool(page)).toBe('wall')

  // ? opens the shortcuts sheet, which lists the registry's keys and the global chords.
  await press(page, '?')
  const sheet = page.getByTestId('shell-shortcuts')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[data-key-row="family.design"]')).toContainText('D')
  await expect(sheet.locator('[data-key-row="tool.floor"]')).toContainText('F')
  await expect(sheet.locator('[data-key-row="tool.previous"]')).toContainText('Q')
  await expect(sheet.locator('[data-key-row="edit.undo"]')).toBeVisible()
  await shot(page, '09-shortcuts')
  await sheet.getByRole('button', { name: 'Close Keyboard shortcuts' }).click()
  await expect(sheet).toBeHidden()

  // The help button at the end of the status bar opens it too.
  await page.getByTestId('shell-help').click()
  await expect(sheet).toBeVisible()
  expect(errors).toEqual([])
})

// ─── The old editor's key and pointer rules, on the warren ─────────────────────

/** Run `fn` (source text) in the page with the store getter, the active layer and a world to screen mapping. */
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

/** The warren with its rooms measured and its first drawing layer active. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((x: Any) => x.type === 'dungeon').id)
  })
  await waitFrame(page, 4)
}

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const walls = (page: Page) => inPage<number>(page, `(s, layer) => layer().standaloneWalls.length`)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
const hallAnchor = (page: Page) =>
  inPage<Pt>(page, `(s, layer) => { const r = layer().rooms.find((x) => x.name === 'Warren Hall'); return { x: r.anchor[0], y: r.anchor[1] } }`)

/** A 2x2 crate at `at`, everything else that picks near it taken away, the crate selected. */
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

/** Whether the snap cross-hair has anything drawn. */
const crosshairDrawn = (page: Page) =>
  page.evaluate(() => {
    const find = (n: Any): Any => (n.label === 'snapIndicator' ? n : (n.children ?? []).map(find).find(Boolean))
    const g = find((window as Any).__pixiApp.stage)
    return (g?.context?.instructions?.length ?? 0) > 0
  })

test('arrows on a focused slider move the slider, not the selection', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  await crateAt(page, await hallAnchor(page))
  const before = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.id === 'crate')`)
  const slider = page.getByTestId('shell-card').getByRole('slider', { name: 'Opacity' })
  await slider.focus()
  const value = await slider.inputValue()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(slider).not.toHaveValue(value)
  const after = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.id === 'crate')`)
  expect(after.position).toEqual(before.position)
  expect(await sel(page)).toEqual(['crate'])
})

test('with the "…" menu open, a tool letter stays out of the map and Escape closes the menu', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'wall')
  await page.getByTestId('shell-more').click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('v')
  expect(await activeTool(page)).toBe('wall')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(await activeTool(page)).toBe('wall')
  // Closed, the button lets the letters through again.
  await press(page, 'v')
  expect(await activeTool(page)).toBe('select')
})

test('Enter on a focused rail button does not end a wall chain', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  const a = await hallAnchor(page)
  await pickTool(page, 'wall')
  const count = await walls(page)
  await click(page, await screenOf(page, { x: a.x - 2, y: a.y }))
  await click(page, await screenOf(page, { x: a.x + 2, y: a.y }))
  const design = page.getByTestId('shell-rail').getByRole('button', { name: 'Design' })
  await design.focus()
  await page.keyboard.press('Enter')
  // The button took its Enter (it opened its flyout); the chain did not end.
  await expect(page.getByTestId('shell-flyout')).toBeVisible()
  expect(await walls(page)).toBe(count)
  // From the page itself Enter still ends the chain once the flyout is closed.
  await press(page, 'Escape')
  await expect(page.getByTestId('shell-flyout')).toBeHidden()
  await blur(page)
  await page.keyboard.press('Enter')
  await expect.poll(() => walls(page)).toBe(count + 1)
})

test('one Escape closes one thing: the popover over the sheet first, then the sheet', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  await page.getByTestId('shell-dock').getByTestId('shell-open-layers').click()
  const sheet = page.getByTestId('shell-layers-sheet')
  await expect(sheet).toBeVisible()
  await page.getByTestId('shell-grid-chip').click()
  const grid = page.getByTestId('shell-grid-popover')
  await expect(grid).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(grid).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('a middle-drag pans the map and draws no marquee', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  // A point on the canvas clear of every panel.
  const from = { x: 760, y: 520 }
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

test('a right-click on a gizmo handle keeps the selection and opens its menu', { tag: '@keys' }, async ({ page }) => {
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

test('the snap cross-hair goes when the pointer leaves the map, and never shows for Select', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  const p = await screenOf(page, await hallAnchor(page))
  await pickTool(page, 'wall')
  await firePointer(page, 'pointermove', p.x, p.y, 0, 0)
  await waitFrame(page, 1)
  expect(await crosshairDrawn(page)).toBe(true)
  await page.evaluate(() => {
    document.querySelector('canvas')!.parentElement!.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, pointerType: 'mouse' }))
  })
  expect(await crosshairDrawn(page)).toBe(false)
  await pickTool(page, 'select')
  await firePointer(page, 'pointermove', p.x + 10, p.y, 0, 0)
  expect(await crosshairDrawn(page)).toBe(false)
})

test('? opens the shortcuts sheet, which lists the keys by group, and the "…" menu opens it too', { tag: '@keys' }, async ({ page }) => {
  await openWarren(page)
  await blur(page)
  await page.keyboard.press('?')
  const sheet = page.getByTestId('shell-shortcuts')
  await expect(sheet).toBeVisible()
  expect(await sheet.locator('[data-key-row]').count()).toBeGreaterThan(40)
  for (const section of ['Rail', 'Design', 'Terrain', 'Objects', 'Environment', 'Text', 'Select', 'Edit', 'View', 'File']) {
    await expect(sheet.locator(`[data-section="${section}"]`)).toHaveCount(1)
  }
  await expect(sheet.locator('[data-key-row="edit.duplicate"] kbd')).toHaveText('Ctrl D')
  await expect(sheet.locator('[data-key-row="edit.dupDrag"] kbd')).toHaveText('Alt drag')
  await sheet.getByRole('button', { name: 'Close Keyboard shortcuts' }).click()
  await expect(sheet).toBeHidden()
  await page.getByTestId('shell-more').click()
  await page.getByRole('menuitem', { name: /^Keyboard shortcuts/ }).click()
  await expect(sheet).toBeVisible()
})

test('on a Mac the keys read the Mac way, in the sheet and the "…" menu', { tag: '@keys' }, async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) })
  })
  await openWarren(page)
  await page.getByTestId('shell-more').click()
  await expect(page.getByRole('menuitem', { name: /^Export/ })).toContainText('⌘E')
  await page.keyboard.press('Escape')
  await blur(page)
  await page.keyboard.press('?')
  const sheet = page.getByTestId('shell-shortcuts')
  await expect(sheet.locator('[data-key-row="edit.dupDrag"] kbd')).toHaveText('⌥ drag')
  await expect(sheet.locator('[data-key-row="edit.duplicate"] kbd')).toHaveText('⌘D')
})

test('Ctrl+Shift+N opens New map at once after Escape closed a dialog or the sheet', { tag: '@keys' }, async ({ page }) => {
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
  await expect(page.getByTestId('shell-shortcuts')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+N')
  await expect(newMap).toBeVisible()
})

// The rail and family keys on the shortcuts sheet: each one, pressed from the page, takes
// its tool into hand, the same tool a click on its flyout row takes. The table comes from
// the sheet itself, so a key added to the registry is tried without anyone listing it here.
test('every rail and family key on the shortcuts sheet picks its tool', { tag: '@keys' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  await press(page, '?')
  const sheet = page.getByTestId('shell-shortcuts')
  await expect(sheet).toBeVisible()
  const rows = await sheet.locator('[data-key-row]').evaluateAll((els) =>
    els.map((el) => {
      const key = el.querySelector('kbd')?.textContent ?? ''
      return {
        id: el.getAttribute('data-key-row') ?? '',
        key,
        label: (el.textContent ?? '').slice(0, (el.textContent ?? '').length - key.length),
        section: el.closest('[data-section]')?.getAttribute('data-section') ?? '',
      }
    }),
  )
  await sheet.getByRole('button', { name: 'Close Keyboard shortcuts' }).click()
  await expect(sheet).toBeHidden()
  const rail = rows.filter((r) => r.id.startsWith('rail.'))
  const families = rows.filter((r) => r.id.startsWith('family.'))
  const tools = rows.filter((r) => r.id.startsWith('tool.') && r.id !== 'tool.previous' && r.section !== 'Select')
  expect(rail.map((r) => r.id)).toEqual(['rail.select', 'rail.pan', 'rail.ruler'])
  expect(families.map((r) => r.id)).toEqual(['family.design', 'family.terrain', 'family.objects', 'family.environment', 'family.text'])
  expect(tools).toHaveLength(13)

  // What is in hand: the core tool, and for Stamp against Scatter the brush's mode (which
  // means nothing to any other tool).
  const inHand = () =>
    page.evaluate(() => {
      const s = (window as Any).__store.getState()
      return s.tools.activeTool === 'scatterBrush' ? `scatterBrush|${s.tools.settings.scatterBrush.stampMode}` : s.tools.activeTool
    })
  const flyout = page.getByTestId('shell-flyout')

  // Each tool taken by a click on its flyout row, to know what its key must give.
  const byClick = new Map<string, string>()
  for (const t of tools) {
    await press(page, 'v')
    await pickFromFlyout(page, t.section, t.label)
    byClick.set(t.id, await inHand())
  }
  for (const r of rail) {
    await page.getByTestId('shell-rail').getByRole('button', { name: new RegExp(`^${r.label}`) }).click()
    byClick.set(r.id, await inHand())
  }

  // The rail's own keys, Measure and Pan before Select.
  for (const r of [...rail].reverse()) {
    await press(page, 'v')
    await press(page, r.key.toLowerCase())
    expect(await inHand(), r.id).toBe(byClick.get(r.id))
  }
  // A family key opens its flyout; a tool key in it picks the tool and closes the flyout.
  for (const f of families) {
    const own = tools.filter((r) => r.section === f.label)
    expect(own.length, f.id).toBeGreaterThan(0)
    for (const t of own) {
      await press(page, 'v')
      await press(page, f.key.toLowerCase())
      await expect(flyout).toHaveAttribute('data-family', f.id.slice('family.'.length))
      await expect(flyout.getByRole('button')).toHaveCount(own.length)
      await press(page, t.key.toLowerCase())
      await expect(flyout).toBeHidden()
      expect(await inHand(), t.id).toBe(byClick.get(t.id))
    }
  }
  expect(errors).toEqual([])
})
