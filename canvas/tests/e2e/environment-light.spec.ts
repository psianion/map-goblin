import { test, expect, type Page } from '@playwright/test'
import { firePointer, gotoApp, pressShortcut, waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, pickTool, shot } from './shell'
import { NOON, addLight, inPage, lightOf, litChip, lum, openWarren, roomAnchor, select, toggleLit, undo } from './lighting'

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
// the next light, which lands with them; the Sky sheet, from its own entry, changes the place;
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

  // The Sky sheet, from the Sky entry of the Environment flyout.
  await pickFromFlyout(page, 'Environment', 'Sky')
  const sheet = page.getByTestId('shell-sky-sheet')
  await expect(sheet).toBeVisible()
  for (const gone of ['Climate', 'Weather', 'Night sky', 'Fixed hour', 'Lit preview']) await expect(sheet.getByText(gone)).toHaveCount(0)
  const was = await env(page)
  const to = was === 'outdoor' ? 'Underground' : 'Outdoor'
  await sheet.getByRole('group', { name: 'Place' }).getByRole('button', { name: to, exact: true }).click()
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

test('placing a light with the preview unlit lights it at Day: the chip reads Preview · Day, the canvas darkens, I turns it back off', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page, NOON, false)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'underground' }))
  await waitFrame(page, 4)
  await expect(litChip(page)).toHaveText('Unlit')
  // Plain floor up and to the right of the hall's anchor: at the fitted zoom the box just above
  // the anchor (floorNear) takes in a stool and the top of the room's number badge.
  const hall = await roomAnchor(page, 'Warren Hall')
  const floor = { x: hall.x + 3, y: hall.y - 3 }
  const unlit = await lum(page, floor, 6)
  await pickFromFlyout(page, 'Environment', 'Light')
  await page.getByTestId('shell-dock').getByRole('button', { name: /^Torch/ }).click()
  // The torch goes in another room, so its pool stays off the sample.
  const nook = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s) => { const r = layer().rooms.find((x) => x.name === 'Plunder Nook'); return w2s(r.anchor[0], r.anchor[1]) }`)
  await firePointer(page, 'pointerdown', nook.x, nook.y, 0.5, 1)
  await firePointer(page, 'pointerup', nook.x, nook.y)
  await waitFrame(page, 3)
  await expect(litChip(page)).toHaveText('Preview · Day')
  await expect(page.getByText('Preview lit · press I to toggle')).toBeVisible()
  expect(await lum(page, floor, 6)).toBeLessThan(unlit - 10)
  await toggleLit(page)
  await expect(litChip(page)).toHaveText('Unlit')
  expect(Math.abs((await lum(page, floor, 6)) - unlit)).toBeLessThan(1)
})

test('the Sky sheet says the map is shown unlit; picking a place leaves the preview alone, picking a time lights it', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page, NOON, false)
  await pickFromFlyout(page, 'Environment', 'Sky')
  const sheet = page.getByTestId('shell-sky-sheet')
  await expect(sheet).toContainText('Shown unlit. Pick a time under Preview as, on the status bar, to see these changes.')
  await sheet.getByRole('group', { name: 'Place' }).getByRole('button', { name: 'Underground' }).click()
  // Picking a place changes the map, not the preview: the sheet keeps saying so.
  await expect(litChip(page)).toHaveText('Unlit')
  await litChip(page).click()
  await page.getByTestId('shell-preview-popover').getByRole('group', { name: 'Preview as' }).getByRole('button', { name: 'Dusk' }).click()
  await expect(litChip(page)).toHaveText('Preview · Dusk')
  await expect(sheet.getByText('Shown unlit.', { exact: false })).toHaveCount(0)
})

test('the Sky entry opens its sheet on K and holds the tool in hand: no tool panel, the canvas only pans; closing the sheet gives the tool back', { tag: '@environment' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Environment', 'Light')
  const tool = () => page.evaluate(() => (window as Any).__store.getState().tools.activeTool)
  const selected = () => page.evaluate(() => (window as Any).__store.getState().selection.selectedIds.length as number)
  const railPressed = (name: string) => page.getByTestId('shell-rail').getByRole('button', { name }).getAttribute('aria-pressed')
  expect(await tool()).toBe('light')
  await expect(page.getByTestId('shell-slot')).toBeVisible()
  const lightColumns = await dockColumns(page)
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Environment' }).click()
  const row = page.getByTestId('shell-flyout').getByRole('button', { name: /^Sky/ })
  await expect(row).toContainText('K')
  await row.click()
  await expect(page.getByTestId('shell-sky-sheet')).toBeVisible()
  // Sky is in hand: the Light panel and dock sections are gone, Environment is lit on the rail,
  // and the canvas only pans.
  expect(await tool()).toBe('pan')
  await expect(page.getByTestId('shell-slot')).toHaveCount(0)
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family'])
  expect(await railPressed('Environment')).toBe('true')
  expect(await railPressed('Pan')).toBe('false')
  // The canvas fills the window; this point is clear of the chrome.
  const before = await lights(page)
  const vp = page.viewportSize()!
  await page.mouse.click(vp.width * 0.4, vp.height * 0.5)
  await page.mouse.click(vp.width * 0.4, vp.height * 0.5, { button: 'right' })
  expect((await lights(page)).count).toBe(before.count)
  expect(await selected()).toBe(0)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('shell-sky-sheet')).toHaveCount(0)
  expect(await tool()).toBe('light')
  await expect(page.getByTestId('shell-slot')).toBeVisible()
  expect(await dockColumns(page)).toEqual(lightColumns)
  // From the canvas K is the Environment family's key: open its flyout, then K.
  await pickTool(page, 'select')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('e')
  await expect(page.getByTestId('shell-flyout')).toBeVisible()
  await page.keyboard.press('k')
  await expect(page.getByTestId('shell-sky-sheet')).toBeVisible()
  expect(await tool()).toBe('pan')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('shell-sky-sheet')).toHaveCount(0)
  expect(await tool()).toBe('select')
})

test('Preview as: the status chip picks Unlit or one of four times, and I goes between unlit and the last pick', { tag: '@environment' }, async ({ page }) => {
  await openWarren(page, NOON, false)
  await expect(litChip(page)).toHaveText('Unlit')
  await litChip(page).click()
  const tiles = page.getByTestId('shell-preview-popover').getByRole('group', { name: 'Preview as' })
  await expect(tiles.getByRole('button')).toHaveText(['Unlit', 'Dawn', 'Day', 'Dusk', 'Night'])
  await tiles.getByRole('button', { name: 'Night' }).click()
  await expect(litChip(page)).toHaveText('Preview · Night')
  expect(await page.evaluate(() => (window as Any).__store.getState().ui.previewTime)).toBe('night')
  await page.keyboard.press('Escape')
  await toggleLit(page)
  await expect(litChip(page)).toHaveText('Unlit')
  await toggleLit(page)
  await expect(litChip(page)).toHaveText('Preview · Night')
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

// The sundial: a ring around the map while the Sky sheet is open and Cast shadows is on, with
// one handle. It follows the map through pan and zoom, and zoomed in it rests at the interface's
// borders with a shadow outside it. Pressing it jumps the handle, a drag snaps to the compass
// points and is one undo step, the map stays live inside the ring, and the sheet's readout
// turns the sun on Left and Right.
test('the sundial: a ring around the map, one handle, a drag turns the sun in one undo step, the sheet reads it out', { tag: '@environment' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // Large enough that the warren's whole circle fits the clear area at the editor's minimum
  // zoom, so the test sees both the ring around the whole map and the ring resting zoomed in.
  await page.setViewportSize({ width: 2400, height: 1600 })
  await openWarren(page)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ naturalLight: true, orientation: 0 }))
  const orientation = () => page.evaluate(() => ((window as Any).__store.getState().mapSettings.orientation ?? 0) as number)

  await expect(page.getByTestId('sundial')).toHaveCount(0)
  await pickFromFlyout(page, 'Environment', 'Sky')
  const sheet = page.getByTestId('shell-sky-sheet')
  await expect(sheet).toBeVisible()
  const dial = page.getByTestId('sundial')
  await expect(dial).toBeVisible()
  await expect(dial.getByText('Rises here')).toHaveCount(1)
  await expect(page.getByTestId('sundial-handle')).toHaveCount(1)
  // A sun at Day; the preview's Night puts a moon on the handle.
  await expect(page.getByTestId('sundial-handle')).toHaveAttribute('data-icon', 'sun')

  const ring = page.getByTestId('sundial-ring')
  const shadow = page.getByTestId('sundial-shadow')
  const geom = () => ring.evaluate((el) => ({ cx: +el.getAttribute('cx')!, cy: +el.getAttribute('cy')!, r: +el.getAttribute('r')! }))
  const zoom = () => page.evaluate(() => (window as Any).__pixiApp.stage.children[0].scale.x as number)
  const sheetBox = (await sheet.boundingBox())!

  // Zoomed out, the ring is the map's own circle: no shadow, and its radius in squares stays put
  // as the zoom changes.
  let g = await geom()
  for (let i = 0; i < 15 && (await shadow.count()) > 0; i++) {
    await page.mouse.move(g.cx, g.cy)
    await page.mouse.wheel(0, 120)
    await waitFrame(page, 2)
  }
  await expect(shadow).toHaveCount(0)
  g = await geom()
  expect(g.cx + g.r).toBeLessThanOrEqual(sheetBox.x)
  const squares = g.r / (await zoom())
  await page.mouse.move(g.cx, g.cy)
  await page.mouse.wheel(0, 120)
  await waitFrame(page, 2)
  if ((await shadow.count()) === 0) expect((await geom()).r / (await zoom())).toBeCloseTo(squares, 3)
  // Panning the map (Sky holds Pan in hand) carries the ring with it.
  g = await geom()
  await page.mouse.move(g.cx, g.cy)
  await page.mouse.down()
  await page.mouse.move(g.cx + 30, g.cy + 20, { steps: 4 })
  await page.mouse.up()
  await waitFrame(page, 2)
  const moved = await geom()
  expect(moved.cx - g.cx).toBeCloseTo(30, 0)
  expect(moved.cy - g.cy).toBeCloseTo(20, 0)
  expect(await orientation()).toBe(0)

  // Zoomed in, the ring rests at the interface's borders and keeps its size, with the shadow out.
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(moved.cx, moved.cy)
    await page.mouse.wheel(0, -120)
    await waitFrame(page, 1)
  }
  await waitFrame(page, 2)
  await expect(shadow).toHaveCount(1)
  g = await geom()
  expect(Number(await shadow.getAttribute('data-strength'))).toBeGreaterThan(0)
  expect(g.r).toBeGreaterThan(100)
  expect(g.cx + g.r).toBeLessThanOrEqual(sheetBox.x)
  await page.mouse.move(g.cx, g.cy)
  await page.mouse.wheel(0, -120)
  await waitFrame(page, 2)
  expect((await geom()).r).toBeCloseTo(g.r, 3)
  const onRing = (deg: number) => ({ x: g.cx + Math.cos((deg * Math.PI) / 180) * g.r, y: g.cy + Math.sin((deg * Math.PI) / 180) * g.r })

  // Inside the ring the pointer belongs to the map.
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="sundial"]'), { x: g.cx, y: g.cy })).toBe(false)

  // Press low on the ring: the handle jumps there. Drag past the left point, near it, and let go.
  const press = onRing(90)
  await page.mouse.move(press.x, press.y)
  await page.mouse.down()
  expect(await orientation()).toBe(90)
  const near = onRing(177)
  await page.mouse.move(onRing(130).x, onRing(130).y, { steps: 4 })
  await page.mouse.move(near.x, near.y, { steps: 4 })
  await page.mouse.up()
  // Within 6 degrees of the left point: snapped onto it.
  expect(await orientation()).toBe(180)
  await expect(sheet.getByTestId('sky-rise')).toHaveText('Rise at the left')

  // The whole drag was one undo step.
  await undo(page)
  expect(await orientation()).toBe(0)

  // The readout: focus it, Right turns the sun 45 degrees, Left takes it back; each press is its own step.
  await sheet.getByRole('slider', { name: 'Where the sun rises' }).focus()
  await page.keyboard.press('ArrowRight')
  expect(await orientation()).toBe(45)
  await expect(sheet.getByTestId('sky-rise')).toHaveText('Rise at the lower right')
  await page.keyboard.press('ArrowRight')
  expect(await orientation()).toBe(90)
  await page.keyboard.press('ArrowLeft')
  expect(await orientation()).toBe(45)

  // Cast shadows off, or the sheet closed, and the ring goes.
  await sheet.getByRole('switch', { name: 'Cast shadows' }).click()
  await expect(dial).toHaveCount(0)
  await sheet.getByRole('switch', { name: 'Cast shadows' }).click()
  await expect(page.getByTestId('sundial')).toBeVisible()
  // Previewing Night, the handle carries a moon.
  await litChip(page).click()
  await page.getByTestId('shell-preview-popover').getByRole('group', { name: 'Preview as' }).getByRole('button', { name: 'Night' }).click()
  await expect(page.getByTestId('sundial-handle')).toHaveAttribute('data-icon', 'moon')
  // Escape closes the popover alone (it was opened last); the next one closes the sheet.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('shell-preview-popover')).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sundial')).toHaveCount(0)
  expect(errors).toEqual([])
})
