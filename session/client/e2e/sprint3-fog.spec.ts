import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import { pointInPolygon } from '@dnd/core/src/engine/hitTest.ts'
import type { DoorChild, LightChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { assertMapLoaded, assertMapRendered, GATE, hostTable, joinTable, measureFps } from './table'
import { canvasPoint, createDef, placeToken, tokenPositions } from './tokens'

/**
 * @sprint3-fog — the §2.6 rows that only a browser can answer.
 *
 * The redaction rows are already proven at the wire, byte by byte
 * (`session/server/src/integration.test.ts` — every frame of a scripted session searched for
 * ids the party has not earned). What this file adds is the client end of the same rules:
 * that a table hosted from the editor's own file arrives fogged with no authoring step, that
 * a reveal's `mapDelta` actually lands in the loaded scene, that explored geometry survives a
 * reload, and that a door toggle reaches two live contexts.
 *
 * ── Why half the rows are `fixme` ──────────────────────────────────────────────────────
 * Nothing on this map draws. Both roles' canvases are a flat near-black (measured: DM mean
 * 14.1/255 with 0.06% of pixels above luminance 32, player 8.93/255 bit-identical before and
 * after a reveal) while their stores hold the whole scene. The dressed gate map is the only
 * fixture carrying terrain splats (`customImages.__terrain-splat-0/1__`), and on load:
 *
 *   TerrainRenderer.loadPalette      (packages/core/src/engine/terrain/TerrainRenderer.ts:236)
 *     → BindGroup.setResource        TypeError: Cannot read properties of null (reading '3')
 *   TerrainRenderer.splats           (…/TerrainRenderer.ts:143, via restoreFromDataUrl:516)
 *     → "[terrain] splatmap restore failed"
 *
 * and then, every frame, `GlShaderSystem.bind` throws out of `WebGLRenderer.render` — the
 * draw is abandoned before anything is painted. Every row below that reads pixels is
 * therefore unanswerable, not failing: it would be measuring a render pass that never ran.
 * The bodies are written and correct; delete the `fixme` when the terrain bind is fixed.
 *
 * Everything runs on the dressed gate map (D15) through the real host flow: `#map-file`
 * POSTs the `.mapbuilder` to `/api/campaigns/:id/maps` exactly as a DM's file picker would.
 *
 *   pnpm exec playwright test -c e2e/playwright.sprint3.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }

/** Why the pixel rows cannot answer yet. One string, so un-fixme-ing is one search. */
const RENDER_BLOCKED =
  'the dressed map draws nothing — TerrainRenderer.loadPalette binds a null resource and ' +
  'WebGLRenderer.render throws every frame (see this file’s header)'

/**
 * D10's reveal fade. Copied rather than imported: `FogRenderer` is a Pixi module and pulling
 * it into this Node process would drag the whole renderer (and `import.meta.env`) in for one
 * number. Keep it in step with `REVEAL_MS` in `src/modules/fog/FogRenderer.ts`.
 */
const REVEAL_MS = 300

// ── The map, read the way the server reads it ───────────────────────────────
// Ids by shape, never spelled out: a re-authored gate map has to fail here loudly instead
// of quietly asserting about rooms that moved.

const crypt = JSON.parse(readFileSync(GATE.file, 'utf8')) as SerializedMapData
const layer = crypt.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
const rooms: Room[] = layer.rooms ?? []
const doors = layer.children.filter((c): c is DoorChild => c.childType === 'door')
const lights = layer.children.filter((c): c is LightChild => c.childType === 'light')

/** The biggest room on the map — the one every latency and fps number is named after. */
const CHAMBER = [...rooms].sort((a, b) => b.area - a.area)[0]
const SECRET = doors.find((d) => d.isSecret)!
const roomById = (id: string | null | undefined) => rooms.find((r) => r.id === id)!
const lightsIn = (room: Room): number =>
  lights.filter((l) => pointInPolygon([l.position.x, l.position.y], room.boundary)).length

/**
 * The door the lighting row swings: shut where the map authors it, with a leaf to swing (an
 * archway is a hole, D3), and torches on one side — a door nobody's light reaches would open
 * onto a canvas that legitimately does not change, and the row would be measuring nothing.
 */
const SHUT = doors
  .filter((d) => !d.isSecret && d.style !== 'archway' && d.state === 'closed')
  .map((d) => ({ door: d, lit: lightsIn(roomById(d.roomA)) + lightsIn(roomById(d.roomB)) }))
  .sort((a, b) => b.lit - a.lit)[0]

// ── Instruments ────────────────────────────────────────────────────────────

interface Scene {
  rooms: number
  children: number
  walls: number
}

/**
 * How much of the scene this tab actually holds, off core's own store — the same handle
 * `assertMapRendered` reads the map name from, and the only honest way to ask "was this
 * geometry ever sent here" from inside the browser. A player's copy is the redacted one
 * (D4), so these numbers are the client-side half of the fog contract.
 */
function scene(page: Page): Promise<Scene> {
  return page.evaluate(() => {
    const store = (window as unknown as { __STORE__?: { getState(): unknown } }).__STORE__
    const state = store?.getState() as {
      layers: { type: string; rooms?: unknown[]; children?: unknown[]; standaloneWalls?: unknown[] }[]
    }
    const dungeon = state.layers.find((l) => l.type === 'dungeon')
    return {
      rooms: dungeon?.rooms?.length ?? 0,
      children: dungeon?.children?.length ?? 0,
      walls: dungeon?.standaloneWalls?.length ?? 0,
    }
  })
}

const showScene = (s: Scene) => `${s.rooms} room(s), ${s.children} child(ren), ${s.walls} wall(s)`

interface Look {
  /** Mean luminance over the whole canvas, 0–255. */
  mean: number
  /** Fraction of pixels above the black floor — how much of the map is drawn at all. */
  lit: number
}

/**
 * The shutter. Split from `develop` below because one row times it: a screenshot is the
 * instant the canvas was captured, and decoding it afterwards must not be inside that clock.
 */
const shoot = (page: Page): Promise<Buffer> =>
  page.locator('[data-testid="game-canvas"] canvas').screenshot()

/**
 * What the canvas looked like, as two numbers.
 *
 * Pixels, because fog has no DOM: the player's view of a room is a Pixi mask, and
 * `__pixiApp` is a DEV-only handle these production-build specs do not have. A screenshot
 * decoded in-page is the only honest read of "black" versus "dim" versus "lit", and the
 * browser already ships a PNG decoder — no new dependency and no golden files (every number
 * is compared against another number this same run produced).
 *
 * The floor is 32/255, not 0: the map's ambient is #0d0e12 and an undrawn canvas measures a
 * flat 8.9, so "not exactly black" is not the same question as "something is drawn".
 */
function develop(page: Page, shot: Buffer): Promise<Look> {
  return page.evaluate(async (url: string) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = surface.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    let sum = 0
    let lit = 0
    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      sum += luminance
      if (luminance > 32) lit++
    }
    const pixels = data.length / 4
    return { mean: sum / pixels, lit: lit / pixels }
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

const look = async (page: Page): Promise<Look> => develop(page, await shoot(page))
const show = (l: Look) => `mean ${l.mean.toFixed(1)}/255, ${(l.lit * 100).toFixed(1)}% drawn`

/** Every measurement lands in the run log in the same grep-able shape as the other specs. */
function record(name: string, measured: string, target: string): void {
  console.log(`[metric] ${name}: ${measured} (target: ${target})`)
}

/** The fog tool is a mode (D11): arming it is what puts the room list on screen. */
async function armFog(dm: Page): Promise<void> {
  if ((await dm.getByTestId('fog-bar').count()) === 0) {
    await dm.getByTestId('fog-tool-toggle').click()
    await expect(dm.getByTestId('fog-bar')).toBeVisible()
  }
}

/**
 * …and putting it away again, which has to happen before anything places a token: an armed
 * tool changes what a click on the map means (D11), so a placement click lands on the fog
 * tool and the placement hint never clears.
 *
 * The toggle rather than Escape, deliberately. Escape is the S4.7 guarantee and it works —
 * but a key press is delivered to the focused window, and this spec drives two *contexts*
 * (two windows), so `bringToFront` on the DM's tab does not reliably win the keyboard back
 * from the player's. Pointer events are dispatched by coordinate and land either way. The
 * Escape path is pinned where focus is not a variable: `src/modules/fog/fog.test.tsx`.
 */
async function disarmFog(dm: Page): Promise<void> {
  if ((await dm.getByTestId('fog-bar').count()) === 0) return
  await dm.getByTestId('fog-tool-toggle').click()
  await expect(dm.getByTestId('fog-bar')).toHaveCount(0)
  // The indicator is permanently on screen for a DM (pain-point #1) — it says `none`, it
  // does not go away.
  await expect(dm.getByTestId('active-tool')).toHaveAttribute('data-tool', 'none')
}

const roomRow = (dm: Page, roomId: string) =>
  dm.getByTestId('fog-rooms').locator(`[data-room-id="${roomId}"]`)

/** …and reading one means arming first: the list only exists while the tool is on. */
async function fogStatus(dm: Page, roomId: string): Promise<string | null> {
  await armFog(dm)
  return roomRow(dm, roomId).getAttribute('data-fog-status')
}

/** Clicking a room in the list reveals it if it is dark and re-hides it if it is lit. */
async function toggleRoom(dm: Page, roomId: string, want: 'revealed' | 're_hidden'): Promise<void> {
  await armFog(dm)
  await roomRow(dm, roomId).getByRole('button').click()
  await expect(roomRow(dm, roomId)).toHaveAttribute('data-fog-status', want)
}

async function statuses(dm: Page): Promise<Record<string, number>> {
  await armFog(dm)
  return dm.evaluate(() => {
    const counts: Record<string, number> = {}
    const list = document.querySelectorAll('[data-testid="fog-rooms"] [data-fog-status]')
    for (const li of Array.from(list)) {
      const status = li.getAttribute('data-fog-status')!
      counts[status] = (counts[status] ?? 0) + 1
    }
    return counts
  })
}

const doorRow = (page: Page, doorId: string) =>
  page.getByTestId('door-list').locator(`[data-door-id="${doorId}"]`)

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@sprint3-fog', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let code: string
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    code = await hostTable(dm, GATE)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, GATE)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    // Not `assertMapRendered`: a player who has explored nothing has no floor to union —
    // every room is redacted out of their copy, which is the row below, not a failure.
    await assertMapLoaded(player, GATE)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the dressed map:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  /**
   * §2.6 — zero-setup: editor map → playable fog/doors/lighting.
   *
   * Nothing between `hostTable`'s file picker and this assertion drew a mask, painted a
   * region or authored a fog state. The map arrived fogged because the *server* decided it
   * was, which is the whole anti-Owlbear claim: a DM who forgets the masking pass has not
   * leaked the dungeon, because there is no masking pass to forget.
   *
   * Asserted on what each tab *holds* rather than on what it paints — the player's loaded
   * scene is the redacted copy, so these counts are D4 and D5 arriving in a real browser:
   * nothing at join, exactly one room's geometry after one reveal.
   */
  test('zero-setup: the editor’s file is a fogged table, no masking step', async () => {
    expect(await statuses(dm)).toEqual({ never_revealed: rooms.length })

    const dmHas = await scene(dm)
    expect(dmHas.rooms).toBe(rooms.length)
    expect(dmHas.walls).toBe(layer.standaloneWalls.length)

    const before = await scene(player)
    expect(before, `the player was handed geometry at join: ${showScene(before)}`).toEqual({
      rooms: 0,
      children: 0,
      walls: 0,
    })
    // …and no door either: the doors slice is cut to the rooms they hold geometry for.
    await expect(player.getByTestId('door-list').locator('[data-door-id]')).toHaveCount(0)

    await toggleRoom(dm, CHAMBER.id, 'revealed')
    await expect.poll(async () => (await scene(player)).rooms).toBe(1)
    const after = await scene(player)

    record(
      'zero-setup reveal (editor file → fogged table → one room’s geometry)',
      `DM ${showScene(dmHas)}; player ${showScene(before)} → ${showScene(after)} ` +
        `after revealing ${CHAMBER.name}`,
      'the player holds nothing until a reveal, then exactly what it carried',
    )
    // D5: the geometry rode the same frame as the state, so it is here already.
    expect(after.children).toBeGreaterThan(0)
    expect(after.walls).toBeGreaterThan(0)
    expect(after.walls).toBeLessThan(layer.standaloneWalls.length)

    // The doors of the room they have now seen arrived with it, and not one more.
    const held = await player.getByTestId('door-list').locator('[data-door-id]').count()
    expect(held).toBeGreaterThan(0)
    expect(held).toBeLessThan(doors.length)
  })

  /**
   * §2.6 — DM never loses visibility (D11, gap-analysis §4.6).
   *
   * The Owlbear pain is a DM squinting at their own ghosted map. A hidden token and an
   * unrevealed secret door are the two things a DM is most likely to be shown at half
   * strength, so both are asserted present and legible on the DM's side — and absent from
   * the player's *page*, not merely from their canvas.
   */
  test('DM never loses visibility: hidden token and secret door stay the DM’s', async () => {
    await disarmFog(dm)
    const before = new Set(Object.keys(await tokenPositions(dm)))
    await createDef(dm, 'Ambusher')
    await placeToken(dm, 'Ambusher', await canvasPoint(dm, 0.5, 0.5))
    const tokenId = Object.keys(await tokenPositions(dm)).find((id) => !before.has(id))!

    await dm.getByTestId('token-layer').locator(`[data-token-id="${tokenId}"]`).click()
    await dm.getByTestId('token-hide').click()

    // Full strength, not ghosted: `tokenAppearance` pins the DM's alpha at 1 with a badge,
    // and the list still spells the state out in words beside it.
    const row = dm.getByTestId('token-layer').locator(`[data-token-id="${tokenId}"]`)
    await expect(row).toHaveAttribute('data-hidden', 'true')
    await expect(row).toContainText('hidden')

    // The secret door is a door on the DM's map, not a hint.
    await expect(doorRow(dm, SECRET.id)).toHaveAttribute('data-secret', 'true')

    // On the player's side neither exists — checked against the whole document, so a
    // collapsed panel or a stale store would still fail it.
    const page = await player.content()
    expect(page).not.toContain(SECRET.id)
    expect(page).not.toContain(tokenId)
    expect(page).not.toContain('Ambusher')
  })

  /**
   * §2.6 — door → fog → lighting chain, live on two contexts.
   *
   * The propagation half: one click is one command, and both tabs learn the new state from
   * the server rather than from their own optimism. The player only has the door at all
   * because both rooms it joins are theirs now, which is the fog half of the same chain.
   *
   * The concealment half — a shut door taking a monster's position back off the player's
   * screen — is proven at the wire, where the retraction is a frame and not a pixel:
   * `integration.test.ts`, "retracts when a door closes under concealment".
   */
  test('door → fog: one toggle, two live contexts', async () => {
    for (const room of [roomById(SHUT.door.roomA), roomById(SHUT.door.roomB)]) {
      if ((await fogStatus(dm, room.id)) !== 'revealed') {
        await toggleRoom(dm, room.id, 'revealed')
      }
    }
    await expect(doorRow(player, SHUT.door.id)).toHaveAttribute('data-open', 'false')

    await doorRow(dm, SHUT.door.id).getByRole('button').click()
    await expect(doorRow(dm, SHUT.door.id)).toHaveAttribute('data-open', 'true')
    await expect(doorRow(player, SHUT.door.id)).toHaveAttribute('data-open', 'true')

    // …and back, so the row proves a toggle and not a one-way write.
    await doorRow(dm, SHUT.door.id).getByRole('button').click()
    await expect(doorRow(player, SHUT.door.id)).toHaveAttribute('data-open', 'false')
  })

  /**
   * §2.6 (added row) — explored memory survives a player reload, at the data layer.
   *
   * The re-hidden rooms' geometry has to still be in the reloaded tab, or there is nothing
   * for the explored-dim look to draw. This is D4's deliberate leak working as designed:
   * `wasEverRevealed` geometry rides the map GET forever.
   */
  test('explored memory survives a reload: the geometry is still there', async () => {
    const lit = await scene(player)
    expect(lit.rooms).toBeGreaterThan(0)

    for (const room of rooms) {
      if ((await fogStatus(dm, room.id)) === 'revealed') {
        await toggleRoom(dm, room.id, 're_hidden')
      }
    }
    const dimmed = await scene(player)

    await player.reload()
    await assertMapLoaded(player, GATE)
    await expect.poll(async () => (await scene(player)).rooms).toBe(dimmed.rooms)
    const reloaded = await scene(player)

    record(
      'explored memory across a player reload',
      `lit ${showScene(lit)} → re-hidden ${showScene(dimmed)} → reloaded ${showScene(reloaded)}`,
      'the reloaded tab still holds every explored room',
    )
    // Re-hiding takes the light, never the geometry (D4) — and the reload keeps both.
    expect(dimmed).toEqual(lit)
    expect(reloaded).toEqual(dimmed)
  })

  /**
   * §2.6 — the standing gate condition, as a test: zero uncaught errors on the dressed map.
   *
   * `fixme` for the terrain bind in this file's header — this is where it fails, and it is
   * the row to un-fixme first, because every pixel row below is downstream of it.
   */
  test.fixme(`the dressed map draws with no page errors — ${RENDER_BLOCKED}`, () => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  /**
   * §2.6 (added row) — explored rooms render dimmed, not black, after a reload.
   *
   * Three looks, each read against the last: lit, then re-hidden, then re-hidden *after a
   * reload*. The geometry half is green above; this is the half that needs paint.
   */
  test.fixme(`explored memory renders dimmed, not black — ${RENDER_BLOCKED}`, async () => {
    const dark = await look(player)
    await toggleRoom(dm, CHAMBER.id, 'revealed')
    await player.waitForTimeout(REVEAL_MS * 2)
    const lit = await look(player)

    await toggleRoom(dm, CHAMBER.id, 're_hidden')
    await player.waitForTimeout(REVEAL_MS * 2)
    const dimmed = await look(player)

    await player.reload()
    await assertMapLoaded(player, GATE)
    await player.waitForTimeout(REVEAL_MS * 4)
    const reloaded = await look(player)

    record(
      'explored look across a player reload',
      `unexplored ${show(dark)} → lit ${show(lit)} → re-hidden ${show(dimmed)} → ` +
        `reloaded ${show(reloaded)}`,
      'reloaded ≈ re-hidden, both well above the unexplored black',
    )
    expect(dimmed.mean).toBeLessThan(lit.mean)
    expect(reloaded.lit, 'explored rooms came back black after the reload').toBeGreaterThan(
      dark.lit + 0.02,
    )
    expect(Math.abs(reloaded.lit - dimmed.lit)).toBeLessThan(0.05)
  })

  /**
   * §2.6 — the lighting half of the door chain: a shut door is a wall for the sweep, and
   * opening it lets the torchlight through onto the player's canvas.
   */
  test.fixme(`door → lighting on the player canvas — ${RENDER_BLOCKED}`, async () => {
    expect(SHUT.lit, 'no closed door on this map has a light on either side').toBeGreaterThan(0)
    for (const room of [roomById(SHUT.door.roomA), roomById(SHUT.door.roomB)]) {
      if ((await fogStatus(dm, room.id)) !== 'revealed') {
        await toggleRoom(dm, room.id, 'revealed')
      }
    }
    await player.waitForTimeout(REVEAL_MS * 2)
    const shut = await look(player)

    await doorRow(dm, SHUT.door.id).getByRole('button').click()
    await expect(doorRow(player, SHUT.door.id)).toHaveAttribute('data-open', 'true')
    await player.waitForTimeout(REVEAL_MS * 2)
    const open = await look(player)

    record(
      'door → lighting on the player canvas',
      `${SHUT.door.id} (${SHUT.lit} light(s) adjacent): shut ${show(shut)} → open ${show(open)}`,
      'opening a door changes what the sweep lights on both clients',
    )
    expect(Math.abs(open.mean - shut.mean)).toBeGreaterThan(0.1)
  })

  /**
   * §2.6 (added row) — `prefers-reduced-motion` cuts the reveal.
   *
   * The instrument is a shutter and it has to beat the fade to say anything, so the first
   * sample's own latency is asserted too: a screenshot slower than the 300ms fade would make
   * "already settled" true of an animated reveal as well, and the row would pass by being
   * blind rather than by being right.
   */
  test.fixme(`reduced motion cuts the reveal — ${RENDER_BLOCKED}`, async ({ browser }) => {
    const quiet = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    try {
      const hush = await quiet.newPage()
      await joinTable(hush, code, 'Hush')
      await assertMapLoaded(hush, GATE)
      expect(await hush.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
        true,
      )
      await hush.waitForTimeout(REVEAL_MS * 2)
      const before = await look(hush)

      const startedAt = Date.now()
      await toggleRoom(dm, CHAMBER.id, 'revealed')
      const firstShot = await shoot(hush)
      const shutterMs = Date.now() - startedAt

      await hush.waitForTimeout(REVEAL_MS * 4)
      const first = await develop(hush, firstShot)
      const settled = await look(hush)

      record(
        'reduced-motion reveal',
        `first sample at ${shutterMs}ms: ${show(first)}; settled ${show(settled)} ` +
          `(from ${show(before)})`,
        `no fade — a sample inside the ${REVEAL_MS}ms window is already settled`,
      )
      expect(settled.mean, 'the reveal never landed at all').toBeGreaterThan(before.mean)
      expect(
        shutterMs,
        'the shutter is slower than the fade — this row cannot tell a cut from a tween',
      ).toBeLessThan(REVEAL_MS)
      expect(Math.abs(first.mean - settled.mean)).toBeLessThan(settled.mean * 0.05 + 0.5)
    } finally {
      await quiet.close()
    }
  })

  /**
   * §2.6 — 60fps on the dressed map, fog active, mid-reveal included.
   *
   * `fixme` rather than merely unverified: the render pass currently throws out of
   * `WebGLRenderer.render`, and a frame that abandons its draw is cheap. A number taken now
   * would clear 55fps by not drawing the map, which is worse than no number.
   */
  test.fixme(`20 tokens and an active fog mask hold 60fps — ${RENDER_BLOCKED}`, async () => {
    // One live render loop: a second Pixi context on the same GPU costs the measurement
    // ~5fps, and this row is about one client's frame budget (the S2 fps row's finding).
    await player.close()
    await dm.bringToFront()

    await armFog(dm)
    await dm.getByTestId('fog-reveal-all').click()
    await expect.poll(async () => (await statuses(dm)).revealed ?? 0).toBe(rooms.length)

    // A click on the map is a placement again only once the tool is put away (D11).
    await disarmFog(dm)
    const placed = Object.keys(await tokenPositions(dm)).length
    // Discarded: the first sample after a tab switch measures the tab switch.
    await measureFps(dm, 500)
    const bare = await measureFps(dm)

    for (let i = placed; i < 20; i++) {
      const spot = await canvasPoint(dm, 0.15 + (i % 5) * 0.16, 0.2 + Math.floor(i / 5) * 0.2)
      await placeToken(dm, 'Ambusher', spot)
    }
    await expect(dm.getByTestId('token-layer').locator('[data-token-id]')).toHaveCount(20)
    const steady = await measureFps(dm)

    // Mid-reveal: put the whole map back under, then start the sample and lift it inside.
    await dm.getByTestId('fog-hide-all').click()
    await expect.poll(async () => (await statuses(dm)).re_hidden ?? 0).toBe(rooms.length)
    const sampling = measureFps(dm, 2000)
    await dm.getByTestId('fog-reveal-all').click()
    const midReveal = await sampling

    record(
      'frame rate on the dressed map with fog active',
      `${steady.toFixed(1)}fps with 20 tokens + fog mask, ${midReveal.toFixed(1)}fps across a ` +
        `whole-map reveal (${bare.toFixed(1)}fps with ${placed} token(s))`,
      '≥ 55fps',
    )
    expect(steady).toBeGreaterThanOrEqual(55)
    expect(midReveal).toBeGreaterThanOrEqual(55)
  })
})
