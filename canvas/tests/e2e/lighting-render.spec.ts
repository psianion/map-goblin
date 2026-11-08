import { test, expect } from '@playwright/test'
import { drawRect, firePointer, getPixelColor, gotoApp, waitFrame } from './helpers'
import { pickTool } from './shell'
import {
  type Any,
  NIGHT,
  NOON,
  addLight,
  bareSheet,
  darkStage,
  floorNear,
  inPage,
  lightOf,
  lum,
  openWarren,
  roomAnchor,
  select,
  toggleLit,
} from './lighting'

/**
 * The lit preview as it renders, on a copy of the goblin warren under `?freeze=` (the clock,
 * the flicker and the fades stand still): a light's footprint stays local, bare sheet keeps
 * the paper colour, a floor at noon outdoors reads as drawn, underground darkens, a cone, a
 * darkness source, levels kept apart, a prop that blocks light, a prop's shadow, a light
 * through a wall, export at two hours and sixty lights at once.
 */

test('a placed light visibly brightens its own footprint, not the far corner', { tag: '@lighting' }, async ({ page }) => {
  // The lit preview on from the start: the first light placed would turn it on, and that
  // changes the whole canvas, not the light's footprint.
  await page.addInitScript(() => localStorage.setItem('mapbuilder-lit-preview', '1'))
  await gotoApp(page)
  // The entry fit animates for 150 ms; the samples below are world points, read through the camera
  // as it stands at each read, so they stay on the same spot of the map either way.
  await waitFrame(page, 15)

  // The canvas the shell leaves free: right of the rail, under the title card and the top
  // actions, above the dock. The map is fitted there, not at the canvas centre.
  const free = await page.evaluate(() => {
    const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
    const canvas = (window as Any).__pixiApp.canvas.getBoundingClientRect()
    return {
      left: r('shell-rail').right,
      top: Math.max(r('shell-title-card').bottom, r('shell-top-actions').bottom),
      right: canvas.right,
      bottom: r('shell-dock').top,
    }
  })
  const mid = { x: (free.left + free.right) / 2, y: (free.top + free.bottom) / 2 }
  const toWorld = (p: { x: number; y: number }) =>
    page.evaluate((p) => {
      const app = (window as Any).__pixiApp
      const r = app.canvas.getBoundingClientRect()
      const w = app.stage.children[0]
      return { x: (p.x - r.left - w.position.x) / w.scale.x, y: (p.y - r.top - w.position.y) / w.scale.x }
    }, p)
  /** The drawing buffer's colour over world point `p`, in device pixels as getPixelColor wants. */
  const colourAt = async (p: { x: number; y: number }) => {
    const px = await page.evaluate((p) => {
      const app = (window as Any).__pixiApp
      const r = app.canvas.getBoundingClientRect()
      const w = app.stage.children[0]
      const k = app.canvas.width / r.width
      return { x: (p.x * w.scale.x + w.position.x) * k, y: (p.y * w.scale.x + w.position.y) * k }
    }, p)
    return getPixelColor(page, px.x, px.y)
  }
  // Select in hand and nothing picked for both reads, so the Light tool's ghost rings and a
  // picked light's rings, handles and distance chips are not in either picture.
  const putDown = async () => {
    await page.evaluate(() => {
      const st = (window as Any).__store.getState()
      st.setActiveTool('select')
      st.setSelectedIds([])
    })
    await waitFrame(page, 5)
  }

  // A floor under the light: a light over bare ground changes nothing by design.
  await pickTool(page, 'rectangle')
  await drawRect(page, mid.x - 120, mid.y - 90, mid.x + 120, mid.y + 90)
  await putDown()

  // A few pixels off the light, which stands on a grid crossing; the far corner is the free
  // canvas's top left, well outside a torch.
  const foot = await toWorld({ x: mid.x + 7, y: mid.y + 7 })
  const corner = await toWorld({ x: free.left + 10, y: free.top + 10 })
  const beforeCenter = await colourAt(foot)
  const beforeCorner = await colourAt(corner)

  await pickTool(page, 'light')
  await firePointer(page, 'pointerdown', mid.x, mid.y, 0.5, 1)
  await firePointer(page, 'pointerup', mid.x, mid.y)
  await waitFrame(page, 3)
  // Intensity and colour to the extreme so the change is unmistakable; the reach stays the tool's.
  const light = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.type === 'dungeon')
    const light = layer.children.find((c: Any) => c.childType === 'light')
    st.updateChild(layer.id, light.id, { color: '#ff2222', intensity: 1, featherRadius: 0, falloff: 'quadratic' })
    return { x: light.position.x as number, y: light.position.y as number, radius: light.radius as number }
  })
  await putDown()
  expect(Math.hypot(corner.x - light.x, corner.y - light.y), 'the far corner lies outside the light').toBeGreaterThan(light.radius)

  const afterCenter = await colourAt(foot)
  const afterCorner = await colourAt(corner)
  const diff = (a: typeof afterCenter, b: typeof afterCenter) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
  expect(afterCenter.a).toBe(255)
  expect(diff(afterCenter, beforeCenter)).toBeGreaterThan(15)
  expect(diff(afterCorner, beforeCorner)).toBeLessThan(diff(afterCenter, beforeCenter))
})

test('bare sheet inside the map frame reads the paper colour at 02:00, Lit preview on exactly as off', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const floorLit = await lum(page, floor)
  await toggleLit(page)
  const at = await bareSheet(page)
  const [off, floorOff] = [await lum(page, at), await lum(page, floor)]
  await toggleLit(page)
  expect(Math.abs((await lum(page, at)) - off)).toBeLessThan(0.5)
  // The night is on all the same: the floor beside it is darker lit than unlit.
  expect(floorLit).toBeLessThan(floorOff - 10)
})

test('bare sheet under a torch pool stays the paper colour', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  await toggleLit(page)
  const at = await bareSheet(page, 20)
  const off = await lum(page, at)
  await toggleLit(page)
  // The torch stands a little way off, so its bulb glyph is clear of the sample box.
  const dx = await page.evaluate(() => 40 / (window as Any).__pixiApp.stage.children[0].scale.x)
  await addLight(page, { x: at.x + dx, y: at.y }, { radius: 8, featherRadius: 4, intensity: 1 })
  expect(Math.abs((await lum(page, at)) - off)).toBeLessThan(0.5)
})

test('a floor cell at noon outdoors reads as drawn: within 3 luma of the unlit art', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NOON)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'outdoor' }))
  await waitFrame(page, 4)
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const lit = await lum(page, floor, 6)
  await toggleLit(page)
  const art = await lum(page, floor, 6)
  expect(Math.abs(lit - art)).toBeLessThan(3)
})

test('underground the lit preview darkens the floor; outdoor at noon it does not', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NOON, false)
  const setEnv = (environment: string) =>
    page.evaluate((environment) => (window as Any).__store.getState().setEnvironmentSettings({ environment }), environment)
  await setEnv('underground')
  await waitFrame(page, 4)
  const floor = floorNear(await roomAnchor(page, 'Warren Hall'))
  const unlit = await lum(page, floor, 6)
  await toggleLit(page)
  expect(await lum(page, floor, 6)).toBeLessThan(unlit - 10)
  await setEnv('outdoor')
  await waitFrame(page, 4)
  expect(await lum(page, floor, 6)).toBeGreaterThan(unlit - 3)
})

test('a marquee draws above a selected light’s rings', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  await select(page, [id])
  // From the void off the map's corner, so the press lands on nothing and starts a marquee.
  const from = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s) => w2s(-1.5, -1.5)`)
  const to = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, p) => w2s(p.x + 6, p.y + 6)`, hall)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  await firePointer(page, 'pointermove', to.x, to.y)
  await waitFrame(page, 3)
  const order = await page.evaluate(() => {
    const overlay = (window as Any).__pixiApp.stage.children[1]
    const labels: string[] = overlay.children.map((c: Any) => c.label)
    return { rings: labels.indexOf('lightOverlay'), rooms: labels.indexOf('roomOverlay'), marquee: labels.indexOf('toolPreview') }
  })
  await firePointer(page, 'pointerup', to.x, to.y)
  expect(order.rings).toBeGreaterThanOrEqual(0)
  expect(order.marquee).toBeGreaterThan(Math.max(order.rings, order.rooms))
})

test('a 90° cone facing east lights east of the light and not west of it', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const id = await addLight(page, hall)
  const east = { x: hall.x + 3, y: hall.y }
  const west = { x: hall.x - 3, y: hall.y }
  const westFull = await lum(page, west)
  await page.evaluate((id) => {
    const st = (window as Any).__store.getState()
    st.updateChild(st.ui.activeLayerId, id, { cone: { angle: 90, direction: 0 } })
  }, id)
  expect((await lightOf(page, id)).cone).toEqual({ angle: 90, direction: 0 })
  expect(await lum(page, east)).toBeGreaterThan((await lum(page, west)) + 10)
  expect(await lum(page, west)).toBeLessThan(westFull - 10)
})

test('a darkness source over a torch: the overlap goes darker than the torch alone', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const floor = floorNear(hall)
  await addLight(page, hall)
  const torchOnly = await lum(page, floor)
  await addLight(page, hall, { darkness: true, radius: 3, featherRadius: 3, intensity: 1 })
  expect(await lum(page, floor)).toBeLessThan(torchOnly - 15)
})

test('a light on level 2 does not light level 1', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const without = await lum(page, hall)
  await page.evaluate((at) => {
    const st = (window as Any).__store.getState()
    const ground = st.ui.activeLevelId ?? st.levels[0]?.id
    st.addLevel({ id: 'qa-level-2', name: 'Level 2' })
    const layerId = 'qa-l2-layer'
    const base = st.layers.find((l: Any) => l.type === 'dungeon')
    st.addLayer({ ...structuredClone(base), id: layerId, name: 'Upstairs', levelId: 'qa-level-2', children: [], rooms: [], areas: [], standaloneWalls: [] })
    st.addChild(layerId, {
      id: 'qa-l2-light', name: 'up', childType: 'light', visible: true, color: '#ffb561',
      radius: 8, featherRadius: 4, intensity: 1, falloff: 'quadratic', position: at,
    })
    if (ground) st.setActiveLevelId(ground)
  }, hall)
  await waitFrame(page, 4)
  expect(Math.abs((await lum(page, hall)) - without)).toBeLessThan(4)
})

test('a prop that blocks light, switched on in its card, shades the floor behind it', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  await addLight(page, hall, { radius: 10, featherRadius: 6 })
  const crate = { x: hall.x + 2, y: hall.y }
  const behind = { x: hall.x + 4, y: hall.y }
  await page.evaluate((at) => {
    const st = (window as Any).__store.getState()
    st.addChild(st.ui.activeLayerId, {
      id: 'qa-crate', name: 'crate', childType: 'asset', visible: true, objectType: 'asset',
      assetId: 'gg-demo:storage_crates_1_dark_1x1_object_A', position: at, rotation: 0, scale: 1,
      width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, blocksLight: false,
    })
  }, crate)
  await waitFrame(page, 4)
  const open = await lum(page, behind)
  await select(page, ['qa-crate'])
  await page.getByTestId('shell-card').getByRole('switch', { name: 'Blocks light and sight' }).click()
  await select(page, [])
  expect(await lum(page, behind)).toBeLessThan(open - 10)
})

test('Casts shadow off, from the card, drops the prop shadow under a low sun', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, 450)
  await darkStage(page, 'outdoor')
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ naturalLight: true, orientation: 0 }))
  // A rubble pile on open floor in the Web Gallery.
  const prop = await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.id === 'asset-155-rubble')`)
  // At 07:30 with sunrise east, a prop's shadow is a short smear west along its foot. The band
  // is under half a cell tall, so the camera closes in until the sample box fits inside it.
  const shade = { x: prop.position.x - 0.35 * prop.width * prop.scale, y: prop.position.y + 0.39 * prop.height * prop.scale }
  const frame = () =>
    page.evaluate((at) => {
      const app = (window as Any).__pixiApp
      const world = app.stage.children[0]
      const r = app.canvas.getBoundingClientRect()
      world.scale.set(48)
      world.position.set(r.width / 2 - at.x * 48, r.height / 2 - at.y * 48)
    }, shade)
  await frame()
  const withShadow = await lum(page, shade, 3)
  await select(page, [prop.id])
  await page.getByTestId('shell-card').getByRole('switch', { name: 'Casts shadow' }).click()
  await select(page, [])
  await frame()
  expect(await lum(page, shade, 3)).toBeGreaterThan(withShadow + 4)
})

test('Through walls, from the card, lights the far side of a wall; a plain light does not', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page, NIGHT)
  await darkStage(page)
  // A short wall right of the hall's anchor, and a sample just past it.
  const hall = await roomAnchor(page, 'Warren Hall')
  await page.evaluate((p) => {
    const st = (window as Any).__store.getState()
    st.addWall(st.ui.activeLayerId, {
      id: 'qa-wall', points: [[p.x + 1.5, p.y - 3], [p.x + 1.5, p.y + 3]], wallType: 'normal', direction: 'both',
      color: '#222222', roughness: 0,
    })
  }, hall)
  const id = await addLight(page, hall, { radius: 6, featherRadius: 4, intensity: 1 })
  const behind = { x: hall.x + 3, y: hall.y }
  const blocked = await lum(page, behind)
  await select(page, [id])
  await page.getByTestId('shell-card').getByRole('switch', { name: 'Through walls' }).click()
  await select(page, [])
  expect(await lum(page, behind)).toBeGreaterThan(blocked + 10)
})

test('export at 02:00 is darker than at 12:00', { tag: '@lighting' }, async ({ page }) => {
  await openWarren(page)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'outdoor' }))
  await page.keyboard.press('Control+e')
  const modal = page.getByTestId('v2-export-modal')
  await expect(modal).toBeVisible()
  const lit = modal.getByRole('switch', { name: 'Apply lighting' })
  if ((await lit.getAttribute('aria-checked')) !== 'true') await lit.click()
  const mean = async () => {
    await page.waitForTimeout(300)
    await expect(modal.getByRole('img', { name: 'Export preview' })).toBeVisible()
    return modal.getByRole('img', { name: 'Export preview' }).evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return sum / (d.length / 4)
    })
  }
  // The Hour slider steps a quarter hour a key: Home is 00:00, then up to noon and back to 02:00.
  const hour = modal.getByTestId('v2-export-lighting').getByRole('slider')
  await hour.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 48; i++) await page.keyboard.press('ArrowRight')
  await expect(modal.getByTestId('v2-export-lighting')).toContainText('12:00')
  const noon = await mean()
  await page.keyboard.press('Home')
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
  await expect(modal.getByTestId('v2-export-lighting')).toContainText('02:00')
  const night = await mean()
  expect(night).toBeLessThan(noon - 10)
})

test('sixty lights on screen: no console error, and the farthest one still lights its floor', { tag: '@lighting' }, async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await openWarren(page, NIGHT)
  await darkStage(page)
  const hall = await roomAnchor(page, 'Warren Hall')
  const far = { x: hall.x + 5, y: hall.y + 5 }
  const bare = await lum(page, far)
  await page.evaluate(({ hall }) => {
    const st = (window as Any).__store.getState()
    for (let i = 0; i < 60; i++) {
      st.addChild(st.ui.activeLayerId, {
        id: `qa-many-${i}`, name: `m${i}`, childType: 'light', visible: true, color: '#ffd27a',
        radius: 1.5, featherRadius: 0.8, intensity: 1, falloff: 'quadratic',
        position: { x: hall.x - 5 + (i % 10), y: hall.y - 1 + Math.floor(i / 10) },
      })
    }
    st.addChild(st.ui.activeLayerId, {
      id: 'qa-far', name: 'far', childType: 'light', visible: true, color: '#ffd27a',
      radius: 1.5, featherRadius: 0.8, intensity: 1, falloff: 'quadratic', position: { x: hall.x + 5, y: hall.y + 5 },
    })
  }, { hall })
  await waitFrame(page, 8)
  expect(await lum(page, far)).toBeGreaterThan(bare + 10)
  expect(errors).toEqual([])
})
