import { test, expect, type Page } from '@playwright/test'
import { firePointer, gotoApp, pressShortcut, waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, pickTool, shot } from './shell'
import { NOON, addLight, floorNear, inPage, lightOf, litChip, lum, openWarren, roomAnchor, select, toggleLit, undo } from './lighting'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const lights = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const all = st.layers.flatMap((l: Any) => (l.type === 'dungeon' ? l.children : [])).filter((c: Any) => c.childType === 'light')
    return { count: all.length as number, last: all.at(-1) ?? null }
  })

const env = (page: Page) => page.evaluate(() => (window as Any).__store.getState().mapSettings.environment ?? 'indoor')

// The Light tool: Bright and Intensity in the dock and Effect in the panel set up
// the next light, which lands with them; the Sky and mood sheet changes the environment;
// undo takes both back.
test('environment: a light from the dock and panel, the sky sheet, undo', { tag: '@environment' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((l: Any) => l.type === 'dungeon' && !l.locked).id)
  })

  await pickFromFlyout(page, 'Environment', 'Light')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'Bright', 'Dim', 'Intensity', 'Colour', 'presets'])
  const dock = page.getByTestId('shell-dock')
  const panel = page.getByTestId('shell-tool-panel')

  // Bright steps up 5 ft; Intensity drops to its lowest.
  const ftPerCell = await page.evaluate(() => (window as Any).__store.getState().mapSettings.cellScale.value as number)
  const bright0 = await page.evaluate(() => (window as Any).__store.getState().tools.settings.lightDefaults.featherRadius as number)
  await dock.getByRole('button', { name: 'Increase Bright' }).click()
  const brightFt = Math.round(bright0 * ftPerCell) + 5
  await expect(dock.locator('[data-setting="light.bright"]')).toContainText(`${brightFt} ft`)
  await dock.getByRole('group', { name: 'Intensity' }).getByRole('slider').focus()
  await page.keyboard.press('Home')
  await expect(dock.locator('[data-setting="light.intensity"]')).toContainText('10%')

  // Effect in the panel: Pulse, and its Speed shows.
  await panel.getByRole('button', { name: 'None', exact: true }).click()
  await expect(panel.locator('[data-setting="light.speed"]')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Pulse' }).click()
  await expect(panel.locator('[data-setting="light.speed"]').first()).toBeVisible()
  await expect(panel.getByText(/falloff|night only|darkvision/i)).toHaveCount(0)

  const before = await lights(page)
  await page.mouse.click(560, 460)
  await waitFrame(page, 4)
  const after = await lights(page)
  expect(after.count).toBe(before.count + 1)
  expect(after.last).toMatchObject({ intensity: 0.1, animation: { kind: 'pulse' } })
  expect(Math.round(after.last.featherRadius * ftPerCell)).toBe(brightFt)
  await page.mouse.move(1390, 700)
  await shot(page, '13-light')

  // The Sky and mood sheet, from the Light panel.
  await pickFromFlyout(page, 'Environment', 'Light')
  await page.getByTestId('shell-tool-panel').getByRole('button', { name: /Sky and mood/ }).click()
  const sheet = page.getByTestId('shell-sky-sheet')
  await expect(sheet).toBeVisible()
  for (const gone of ['Climate', 'Weather', 'Night sky', 'Fixed hour']) await expect(sheet.getByText(gone)).toHaveCount(0)
  const was = await env(page)
  const to = was === 'outdoor' ? 'Underground' : 'Outdoor'
  await sheet.getByRole('button', { name: to, exact: true }).click()
  expect(await env(page)).toBe(to.toLowerCase())
  await shot(page, '13-sky')

  // Undo: the environment, then the light.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  expect(await env(page)).toBe(was)
  await undo.click()
  await expect.poll(async () => (await lights(page)).count).toBe(before.count)
  expect(errors).toEqual([])
})

const canvasCentre = (page: Page) =>
  page.evaluate(() => {
    const r = (document.querySelector('canvas') as HTMLCanvasElement).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })

test('the Light tool comes from the Environment family; a click places a light with sane defaults, and Ctrl+Z takes it back', { tag: '@environment' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'light')
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.activeTool)).toBe('light')
  const before = await lights(page)
  const c = await canvasCentre(page)
  await firePointer(page, 'pointerdown', c.x, c.y, 0.5, 1)
  await firePointer(page, 'pointerup', c.x, c.y)
  await waitFrame(page, 3)
  const after = await lights(page)
  expect(after.count).toBe(before.count + 1)
  expect(after.last.radius).toBeGreaterThan(0)
  expect(after.last.intensity).toBeGreaterThan(0)
  expect(after.last.intensity).toBeLessThanOrEqual(1)
  expect(['linear', 'quadratic']).toContain(after.last.falloff)
  expect(after.last.visible).toBe(true)
  await pressShortcut(page, 'z', { ctrl: true })
  await waitFrame(page, 2)
  expect((await lights(page)).count).toBe(before.count)
})

test('the ambient light and a light’s visibility write to the map', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page)
  expect(await inPage<string>(page, `(s) => s().mapSettings.ambientLight`)).toBeTruthy()
  await page.evaluate(() => (window as Any).__store.getState().setAmbientLight('#ff0000'))
  expect(await inPage<string>(page, `(s) => s().mapSettings.ambientLight`)).toBe('#ff0000')
  const id = await addLight(page, await roomAnchor(page, 'Warren Hall'))
  await page.evaluate((id) => {
    const st = (window as Any).__store.getState()
    st.updateChild(st.ui.activeLayerId, id, { visible: false })
  }, id)
  expect((await lightOf(page, id)).visible).toBe(false)
})

test('placing a light with the lit preview off turns it on: the chip reads on, the canvas darkens, I turns it back off', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page, NOON, false)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'underground' }))
  await waitFrame(page, 4)
  await expect(litChip(page)).toHaveText('Lit · off')
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const unlit = await lum(page, floor, 6)
  await pickFromFlyout(page, 'Environment', 'Light')
  await page.getByTestId('shell-dock').getByRole('button', { name: /^Torch/ }).click()
  // The torch goes in another room, so its pool stays off the sample.
  const nook = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s) => { const r = layer().rooms.find((x) => x.name === 'Plunder Nook'); return w2s(r.anchor[0], r.anchor[1]) }`)
  await firePointer(page, 'pointerdown', nook.x, nook.y, 0.5, 1)
  await firePointer(page, 'pointerup', nook.x, nook.y)
  await waitFrame(page, 3)
  await expect(litChip(page)).toHaveText('Lit · on')
  await expect(page.getByText('Lit preview on · press I to toggle')).toBeVisible()
  expect(await lum(page, floor, 6)).toBeLessThan(unlit - 10)
  await toggleLit(page)
  await expect(litChip(page)).toHaveText('Lit · off')
  expect(Math.abs((await lum(page, floor, 6)) - unlit)).toBeLessThan(1)
})

test('the Sky and mood sheet says the map is shown unlit, and its Lit preview switch turns the preview on', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page, NOON, false)
  await pickFromFlyout(page, 'Environment', 'Light')
  await page.getByTestId('shell-tool-panel').getByRole('button', { name: /Sky and mood/ }).click()
  const sheet = page.getByTestId('shell-sky-sheet')
  await expect(sheet).toContainText('Shown unlit. Turn on Lit preview below to see these changes.')
  await sheet.getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'Underground' }).click()
  // Picking an environment changes the map, not the preview: the sheet keeps saying so.
  await expect(litChip(page)).toHaveText('Lit · off')
  await sheet.getByRole('switch', { name: 'Lit preview' }).click()
  await expect(litChip(page)).toHaveText('Lit · on')
  await expect(sheet.getByText('Shown unlit.', { exact: false })).toHaveCount(0)
})

test('a torch from its preset tile lands where clicked as 20/40 ft, its card reads the same, and one undo removes it', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page)
  await pickFromFlyout(page, 'Environment', 'Light')
  const dock = page.getByTestId('shell-dock')
  const tiles = dock.getByRole('button', { name: /^(Torch|Lantern|Candle|Brazier|Magical|Darkness),/ })
  expect(await tiles.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label')!.split(',')[0]))).toEqual([
    'Torch', 'Lantern', 'Candle', 'Brazier', 'Magical', 'Darkness',
  ])
  await dock.getByRole('button', { name: /^Torch/ }).click()

  const hall = await roomAnchor(page, 'Warren Hall')
  const at = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, hall)
  const before = await lights(page)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
  const after = await lights(page)
  expect(after.count).toBe(before.count + 1)
  expect([after.last.featherRadius, after.last.radius, after.last.animation]).toEqual([4, 8, { kind: 'flicker', speed: 1 }])

  await select(page, [after.last.id])
  const card = page.getByTestId('shell-card')
  await expect(card.locator('[data-setting="card.light.bright"]')).toContainText('20 ft')
  await expect(card.locator('[data-setting="card.light.dim"]')).toContainText('40 ft')
  await undo(page)
  expect((await lights(page)).count).toBe(before.count)
})

test('with the Light tool out, Wheel sizes bright and Shift+Wheel dim; the zoom and the tool stay', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page)
  await pickFromFlyout(page, 'Environment', 'Light')
  await page.getByTestId('shell-dock').getByRole('button', { name: /^Torch/ }).click()
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
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.activeTool)).toBe('light')
})

test('the selected light shows its rings; a pointer that moves changes nothing; the dim handle drags in one undo step', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  await select(page, [id])
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
  await expect(page.getByTestId('shell-card').locator('[data-setting="card.light.dim"]')).toContainText('60 ft')
  await undo(page)
  expect((await lightOf(page, id)).radius).toBe(8)
})
