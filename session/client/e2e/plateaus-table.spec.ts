import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { assertMapLoaded, assertMapRendered, hostTable, joinTable, openPanel, type MapUnderTest } from './table'

/**
 * @plateaus — plan §0 scenario 6, at the table, two live seats.
 *
 * A ground token sees the cliff face and nothing on top; the top is fog. It climbs, the top
 * reveals. Dragging straight across a cliff shows the crossing rule the DM set, a kind the DM
 * switched to refuse snaps the token back, and the DM changes the rule live.
 *
 * The map (session/testdata/plateau-table.mapbuilder): one walled hall 20x14, a +3 cliff mesa
 * over x 8..14, y 4..10 with stairs mid way down its west edge (y 6..8), a torch on top, and a
 * Climb kind noted "DC 12 Athletics".
 *
 *   pnpm exec playwright test -c e2e/playwright.plateaus.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }
const PLATEAU: MapUnderTest = {
  file: join(import.meta.dirname, '../../testdata/plateau-table.mapbuilder'),
  name: 'Plateau Table',
}

interface Tab {
  __sessionStore?: {
    getState(): {
      you?: { identityId: string }
      session?: { activeSceneId: string | null; modules: Record<string, unknown> }
      sendCommand(module: string, action: string, payload: unknown): void
    }
  }
  __testProbe?: { camera(): { x: number; y: number; scale: number } | null }
}

interface HeldToken {
  id: string
  name: string
  x: number
  y: number
  elevation: number
}

const command = (page: Page, module: string, action: string, payload: unknown): Promise<void> =>
  page.evaluate(
    (sent) => (window as unknown as Tab).__sessionStore!.getState().sendCommand(sent.module, sent.action, sent.payload),
    { module, action, payload },
  )

/** The tokens this seat holds in the active scene — what the server let it see. */
const tokensHeld = (page: Page): Promise<HeldToken[]> =>
  page.evaluate(() => {
    const s = (window as unknown as Tab).__sessionStore!.getState()
    const scene = s.session?.activeSceneId
    const tokens = s.session?.modules.tokens as { byScene?: Record<string, Record<string, HeldToken>> } | undefined
    return Object.values((scene && tokens?.byScene?.[scene]) || {})
  })

const held = async (page: Page, name: string): Promise<HeldToken | undefined> =>
  (await tokensHeld(page)).find((t) => t.name === name)

/** A world point (cells) as a viewport point, through the camera the test probe reports. */
async function screenOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="game-canvas"] canvas').boundingBox()
  const cam = await page.evaluate(() => (window as unknown as Tab).__testProbe!.camera())
  if (!box || !cam) throw new Error('no canvas or camera')
  return { x: box.x + cam.x + x * cam.scale, y: box.y + cam.y + y * cam.scale }
}

/** A real pointer drag in world cells, through a few points so the hops are the hand's. */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await screenOf(page, ...from)
  const b = await screenOf(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (const k of [0.25, 0.5, 0.75, 1]) await page.mouse.move(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
  await page.mouse.up()
}

test.describe.serial('@plateaus', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    const code = await hostTable(dm, PLATEAU)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, PLATEAU)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    await joinTable(player, code, 'Borin')
    await assertMapLoaded(player, PLATEAU)

    // Vision mode: what a player holds is what their token's eyes reach.
    await command(dm, 'fog', 'set-mode', { mode: 'vision' })
    const sight = { range: 12, angle: 360, visionMode: 'normal' }
    await command(dm, 'tokens', 'place', { name: 'Borin', x: 3.5, y: 2.5, disposition: 'friendly', sight })
    await command(dm, 'tokens', 'place', { name: 'Lookout', x: 12.5, y: 7.5, disposition: 'hostile' })
    await expect.poll(async () => (await held(dm, 'Borin'))?.id).toBeTruthy()
    const borin = (await held(dm, 'Borin'))!
    const playerId = await player.evaluate(() => (window as unknown as Tab).__sessionStore!.getState().you!.identityId)
    await command(dm, 'tokens', 'assign', { id: borin.id, identityId: playerId })
    await expect.poll(async () => (await held(player, 'Borin'))?.id).toBe(borin.id)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
  })

  test('a token on the ground stands at 0 and the plateau top hides from it', async () => {
    expect((await held(dm, 'Borin'))!.elevation).toBe(0)
    expect((await held(dm, 'Lookout'))!.elevation).toBe(3)
    // The lookout stands lit on top, and the cliff (not the stairs) is between them: it is not
    // on this seat's wire at all.
    await player.waitForTimeout(1000)
    expect(await held(player, 'Lookout')).toBeUndefined()
  })

  test('climbing straight up the cliff names its rule, and the top reveals from up there', async () => {
    await drag(player, [3.5, 2.5], [10.5, 5.5])
    const chip = player.getByTestId('crossing-chip')
    await expect(chip).toContainText('Climb')
    await expect(chip).toContainText('DC 12 Athletics')
    await expect.poll(async () => (await held(dm, 'Borin'))?.x).toBe(10.5)
    expect((await held(dm, 'Borin'))!.elevation).toBe(3)
    await expect.poll(async () => (await held(player, 'Lookout'))?.name, { timeout: 10_000 }).toBe('Lookout')
  })

  test('a kind the DM switches to refuse snaps the token back, with the chip saying why', async () => {
    await openPanel(dm, 'crossings')
    await dm.getByTestId('crossing-blocks-climb').click()
    await expect(dm.getByTestId('crossing-blocks-climb')).toHaveAttribute('aria-checked', 'true')
    await expect
      .poll(() =>
        player.evaluate(() => {
          const s = (window as unknown as Tab).__sessionStore!.getState()
          const c = s.session?.modules.crossings as { byScene?: Record<string, { blocks: Record<string, boolean> }> } | undefined
          return c?.byScene?.[s.session!.activeSceneId!]?.blocks.climb ?? false
        }),
      )
      .toBe(true)

    await drag(player, [10.5, 5.5], [4.5, 5.5])
    await expect(player.locator('[data-testid="crossing-chip"][data-refused]')).toContainText("you can't cross here")
    await player.waitForTimeout(800)
    expect((await held(dm, 'Borin'))!.x).toBe(10.5)
  })

  test('the DM changes the cliff’s rule live, and the stairs are a free way down', async () => {
    await command(dm, 'crossings', 'set-edge', { targetId: 'floor-mesa', crossingId: 'free' })
    await player.waitForTimeout(500)
    await drag(player, [10.5, 5.5], [4.5, 5.5])
    await expect.poll(async () => (await held(dm, 'Borin'))?.x).toBe(4.5)
    expect((await held(dm, 'Borin'))!.elevation).toBe(0)

    // Back up by the stairs: no chip, since the stairs are Free, and on top again.
    await player.waitForTimeout(4500) // the earlier chips expire
    await drag(player, [4.5, 5.5], [4.5, 7.5])
    await drag(player, [4.5, 7.5], [10.5, 7.5])
    await expect.poll(async () => (await held(dm, 'Borin'))?.x).toBe(10.5)
    expect((await held(dm, 'Borin'))!.elevation).toBe(3)
    await expect(player.getByTestId('crossing-chip')).toHaveCount(0)
  })
})

/**
 * The same scenario on the authored test map (session/testdata/plateau-test.mapbuilder): a +2
 * rock outcrop with stairs mid way down its east edge (y 6.5..8.5), a torch on top. This time
 * the DM changes the rule from the map itself, with a right-click on the cliff.
 */
const PLATEAU_TEST: MapUnderTest = {
  file: join(import.meta.dirname, '../../testdata/plateau-test.mapbuilder'),
  name: 'Plateau Test',
}

test.describe.serial('@plateaus on plateau-test', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    const code = await hostTable(dm, PLATEAU_TEST)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, PLATEAU_TEST)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    await joinTable(player, code, 'Borin')
    await assertMapLoaded(player, PLATEAU_TEST)

    await command(dm, 'fog', 'set-mode', { mode: 'vision' })
    const sight = { range: 12, angle: 360, visionMode: 'normal' }
    await command(dm, 'tokens', 'place', { name: 'Borin', x: 14.5, y: 2.5, disposition: 'friendly', sight })
    await command(dm, 'tokens', 'place', { name: 'Lookout', x: 8.5, y: 7.5, disposition: 'hostile' })
    await expect.poll(async () => (await held(dm, 'Borin'))?.id).toBeTruthy()
    const borin = (await held(dm, 'Borin'))!
    const playerId = await player.evaluate(() => (window as unknown as Tab).__sessionStore!.getState().you!.identityId)
    await command(dm, 'tokens', 'assign', { id: borin.id, identityId: playerId })
    await expect.poll(async () => (await held(player, 'Borin'))?.id).toBe(borin.id)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
  })

  test('from the ground the outcrop top is fog; up the stairs it reveals, freely', async () => {
    expect((await held(dm, 'Lookout'))!.elevation).toBe(2)
    await player.waitForTimeout(1000)
    expect(await held(player, 'Lookout')).toBeUndefined()

    await drag(player, [14.5, 2.5], [14.5, 7.5])
    await drag(player, [14.5, 7.5], [10.5, 7.5]) // through the stairs' gap
    await expect.poll(async () => (await held(dm, 'Borin'))?.x).toBe(10.5)
    expect((await held(dm, 'Borin'))!.elevation).toBe(2)
    await expect(player.getByTestId('crossing-chip')).toHaveCount(0)
    await expect.poll(async () => (await held(player, 'Lookout'))?.name, { timeout: 10_000 }).toBe('Lookout')
  })

  test('the DM makes the cliff Impassable with a right-click, and the player is snapped back', async () => {
    const at = await screenOf(dm, 12, 5)
    await dm.mouse.click(at.x, at.y, { button: 'right' })
    const menu = dm.getByTestId('crossing-menu')
    await expect(menu).toBeVisible()
    await menu.getByTestId('crossing-menu-kind').selectOption('impassable')
    await expect(menu).toBeHidden()

    await drag(player, [10.5, 7.5], [10.5, 5.5])
    await expect.poll(async () => (await held(dm, 'Borin'))?.y).toBe(5.5)
    await drag(player, [10.5, 5.5], [13.5, 5.5]) // straight over the east cliff
    await expect(player.locator('[data-testid="crossing-chip"][data-refused]')).toContainText('Impassable')
    await player.waitForTimeout(800)
    expect((await held(dm, 'Borin'))!.x).toBe(10.5)
  })

  test.fixme('scenario 5 (table half): a token beneath the plank bridge sees it fade, one on the bridge crosses the pit at its height', async () => {
    // "A token on the ground walks under it (planks fade), a token at +2 walks across." Needs
    // the bridge's landings in the outcrop and far mesa cliffs and the bridge's height in
    // elevationAt (builder A).
  })
})

/**
 * The tester's case: rooms mode, a fresh player, the DM lights the whole hall. The hall is
 * clear but the +3 mesa top stays under the fog until the party has an eye up there.
 */
test.describe.serial('@plateaus fog in rooms mode', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page

  interface FogProbe {
    hiddenTops(): number
    hiddenAt(x: number, y: number): boolean
  }
  const probe = (page: Page, fn: (p: FogProbe) => unknown) =>
    page.evaluate(
      (src) => {
        const fog = (window as unknown as { __fogProbe?: FogProbe }).__fogProbe
        return fog ? new Function('p', `return (${src})(p)`)(fog) : null
      },
      fn.toString(),
    )

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    const code = await hostTable(dm, PLATEAU)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, PLATEAU)
    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    await joinTable(player, code, 'Borin')
    await assertMapLoaded(player, PLATEAU)

    await command(dm, 'tokens', 'place', { name: 'Borin', x: 3.5, y: 2.5, disposition: 'friendly' })
    await command(dm, 'tokens', 'place', { name: 'Lookout', x: 12.5, y: 7.5, disposition: 'hostile' })
    await expect.poll(async () => (await held(dm, 'Borin'))?.id).toBeTruthy()
    const borin = (await held(dm, 'Borin'))!
    const playerId = await player.evaluate(() => (window as unknown as Tab).__sessionStore!.getState().you!.identityId)
    await command(dm, 'tokens', 'assign', { id: borin.id, identityId: playerId })
    await command(dm, 'fog', 'reveal', { roomId: 'mesa-hall' })
    await expect.poll(async () => (await held(player, 'Borin'))?.id).toBe(borin.id)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
  })

  test('a fresh ground token has the hall clear and the mesa top fogged, before any climb', async () => {
    await expect.poll(() => probe(player, (p) => p.hiddenTops()), { timeout: 15_000 }).toBe(1)
    expect(await probe(player, (p) => p.hiddenAt(11, 7))).toBe(true)
    expect(await probe(player, (p) => p.hiddenAt(3, 3))).toBe(false)
    // …and whoever stands up there is not on this seat's wire, lit hall or not.
    await player.waitForTimeout(500)
    expect(await held(player, 'Lookout')).toBeUndefined()
  })

  test('the top clears once the party has an eye on it, and fogs again when it leaves', async () => {
    const borin = (await held(dm, 'Borin'))!
    await command(dm, 'tokens', 'move', { id: borin.id, x: 11.5, y: 7.5 })
    await expect.poll(async () => (await held(player, 'Borin'))?.elevation).toBe(3)
    await expect.poll(() => probe(player, (p) => p.hiddenTops())).toBe(0)
    await expect.poll(async () => (await held(player, 'Lookout'))?.name).toBe('Lookout')
    await command(dm, 'tokens', 'move', { id: borin.id, x: 3.5, y: 2.5 })
    await expect.poll(() => probe(player, (p) => p.hiddenTops())).toBe(1)
  })
})
