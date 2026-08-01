import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import type { DoorChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { assertMapLoaded, assertMapRendered, hostTable, joinTable, type MapUnderTest } from './table'

/**
 * @doors — the door-overhaul §6 table rows, the half only two live seats can answer.
 *
 * What is new here is the *kind* of door. Every door on every fixture before this one was
 * anchored to a standalone wall, because that was the only kind that worked (§3, DR1–DR3):
 * a door on a floor-derived wall did not render, did not gap the stones and did not pass
 * light. This map is the dressed gate map plus three doors anchored to floor-ring edges —
 * one mid-hallway on the gallery corridor, one on the chamber's north wall, one secret in
 * the ossuary — and the rows below put a DM and a player either side of them.
 *
 *   pnpm exec playwright test -c e2e/playwright.doors.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }

const FLOOR_DOORS: MapUnderTest = {
  file: join(import.meta.dirname, '../../testdata/emberhold-crypt-floor-doors.mapbuilder'),
  name: 'Emberhold Crypt (floor doors)',
}

// ── What the map says, read the way the server reads it ────────────────────

const map = JSON.parse(readFileSync(FLOOR_DOORS.file, 'utf8')) as SerializedMapData
const layer = map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
const doors = layer.children.filter((c): c is DoorChild => c.childType === 'door')

/** The three doors this fixture adds: anchored to the floor outline, not to a wall. */
const floorAnchored = doors.filter((d) => d.wallId === '')
const HALLWAY = floorAnchored.find((d) => d.id === 'door-gallery-hatch')!
const FLOOR = floorAnchored.find((d) => d.id === 'door-chamber-north')!
const SECRET = floorAnchored.find((d) => d.id === 'door-ossuary-cache')!

// ── Instruments ────────────────────────────────────────────────────────────

const doorRow = (page: Page, id: string) =>
  page.getByTestId('door-list').locator(`[data-door-id="${id}"]`)

const shoot = (page: Page) => page.locator('[data-testid="game-canvas"] canvas').screenshot()

/**
 * What fraction of the canvas moved between two shots. Doors change a corner of a frame,
 * never the mean of one, so the rows that use this take their own no-op sample first and
 * measure against that floor rather than a guessed threshold. Same instrument as the fog
 * spec's lighting row.
 */
function changed(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]: string[]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [x, y] = await Promise.all([pixels(a), pixels(b)])
      let moved = 0
      for (let i = 0; i < x.length; i += 4) {
        const d =
          Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
        if (d > 8) moved++
      }
      return moved / (x.length / 4)
    },
    [before.toString('base64'), after.toString('base64')],
  )
}

/**
 * Whether an id is anywhere in this tab's copy of the map: core's store — the scene it
 * has loaded — and the session store's `mapData`, the redacted payload the server sent.
 * Two copies filled by two different code paths, one string. Searched inside the page:
 * the dressed map's terrain bitmaps are megabytes and none of it is worth the bridge.
 */
function holds(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const held = window as unknown as {
      __STORE__?: { getState(): unknown }
      __sessionStore?: { getState(): { mapData?: unknown } }
    }
    const seen = new WeakSet<object>()
    const once = (_key: string, value: unknown): unknown => {
      if (typeof value !== 'object' || value === null) return value
      if (seen.has(value)) return undefined
      seen.add(value)
      return value
    }
    const text = JSON.stringify(
      [held.__STORE__?.getState() ?? null, held.__sessionStore?.getState().mapData ?? null],
      once,
    )
    return text.includes(id)
  }, needle)
}

/** The fog tool is a mode: arming it is what puts the room list on screen. */
async function armFog(dm: Page): Promise<void> {
  if ((await dm.getByTestId('fog-bar').count()) === 0) {
    await dm.getByTestId('fog-tool-toggle').click()
    await expect(dm.getByTestId('fog-bar')).toBeVisible()
  }
}

async function revealRoom(dm: Page, roomId: string): Promise<void> {
  await armFog(dm)
  const row = dm.getByTestId('fog-rooms').locator(`[data-room-id="${roomId}"]`)
  if ((await row.getAttribute('data-fog-status')) !== 'revealed') {
    await row.getByRole('button').click()
  }
  await expect(row).toHaveAttribute('data-fog-status', 'revealed')
}

/**
 * Selects a door row, then swings it with the explicit open/close control beside it —
 * the row itself only selects (D10: select and toggle are separate gestures).
 */
async function toggleDoor(page: Page, id: string): Promise<void> {
  await doorRow(page, id).getByRole('button').click()
  await page.getByTestId('door-toggle').click()
}

/** Selecting a door is what puts the DM's lock / reveal affordances beside it. */
async function selectDoorAsDm(dm: Page, id: string): Promise<void> {
  await doorRow(dm, id).getByRole('button').click()
  await expect(dm.getByTestId('door-actions')).toBeVisible()
}

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@doors', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    // The fixture has to be what this spec claims it is, or every row below is about a
    // map nobody authored.
    expect(floorAnchored.map((d) => d.id).sort()).toEqual(
      ['door-chamber-north', 'door-gallery-hatch', 'door-ossuary-cache'].sort(),
    )

    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, FLOOR_DOORS)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, FLOOR_DOORS)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    // A player holds no room of this map until the DM reveals one, so there is no floor for
    // them to draw — `assertMapRendered` would be asking fog to have failed.
    await assertMapLoaded(player, FLOOR_DOORS)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the door map:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('a floor-anchored door reaches both seats, and a secret one reaches neither', async () => {
    // The DM holds the whole map, so every authored door is in their list.
    await expect(doorRow(dm, HALLWAY.id)).toHaveCount(1)
    await expect(doorRow(dm, FLOOR.id)).toHaveCount(1)
    await expect(doorRow(dm, SECRET.id)).toHaveCount(1)

    // A player is handed nothing until the DM reveals something, so their list starts empty
    // — a door is bound to a room and they hold none.
    await expect(player.getByTestId('door-list').locator('[data-door-id]')).toHaveCount(0)

    // The chamber is both of these doors' room, so revealing it hands both over — and a door
    // with no wall id is a door at the table like any other.
    await revealRoom(dm, FLOOR.roomA!)
    await expect(doorRow(player, HALLWAY.id)).toHaveCount(1)
    await expect(doorRow(player, FLOOR.id)).toHaveCount(1)

    // …and the secret one is not in their copy of the map at all, not merely hidden:
    // asked of both stores, so a collapsed panel would not pass this by accident.
    expect(await holds(player, SECRET.id)).toBe(false)
  })

  test('selecting a door row only highlights it, and never swings the door', async () => {
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'false')

    await doorRow(dm, FLOOR.id).getByRole('button').click()
    await expect(dm.getByTestId('door-actions')).toBeVisible()
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'false')
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-open', 'false')
  })

  test('the DM opens a floor-ring door and both seats agree', async () => {
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'false')
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-open', 'false')

    await toggleDoor(dm, FLOOR.id)
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'true')
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-open', 'true')

    await toggleDoor(dm, FLOOR.id)
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-open', 'false')
  })

  test('a player opens the hallway door from their own seat', async () => {
    await expect(doorRow(player, HALLWAY.id)).toHaveAttribute('data-open', 'false')

    await toggleDoor(player, HALLWAY.id)
    await expect(doorRow(player, HALLWAY.id)).toHaveAttribute('data-open', 'true')
    await expect(doorRow(dm, HALLWAY.id)).toHaveAttribute('data-open', 'true')

    await toggleDoor(player, HALLWAY.id)
    await expect(doorRow(dm, HALLWAY.id)).toHaveAttribute('data-open', 'false')
  })

  test('a locked floor door refuses the player and says why', async () => {
    await selectDoorAsDm(dm, FLOOR.id)
    await dm.getByTestId('door-lock').click()
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-locked', 'true')
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-locked', 'true')

    await toggleDoor(player, FLOOR.id)
    // By name: the player is standing in the room this door is in, holds its name in the
    // list beside the toast, and "The door is locked." leaves them matching one to the other.
    await expect(player.getByTestId('toast')).toContainText(`${FLOOR.name} is locked.`)
    // The refusal is the server's: the door did not move on either seat.
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-open', 'false')
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'false')

    // The DM's key still works, and unlocking hands the door back.
    await dm.getByTestId('door-lock').click()
    await expect(doorRow(player, FLOOR.id)).toHaveAttribute('data-locked', 'false')
    await toggleDoor(player, FLOOR.id)
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'true')
    await toggleDoor(player, FLOOR.id)
    await expect(doorRow(dm, FLOOR.id)).toHaveAttribute('data-open', 'false')
  })

  test('a secret floor door does not exist for the player while it is still secret', async () => {
    // Give the party the room it is in — the room alone must not hand over the door.
    await revealRoom(dm, SECRET.roomA!)
    await expect.poll(() => holds(player, SECRET.roomA!), { timeout: 20_000 }).toBe(true)
    expect(await holds(player, SECRET.id)).toBe(false)
  })

  /**
   * Revealing a secret is the one reveal that hands over a door child and no floor geometry
   * at all, and the player's map is folded and reloaded whole on every delta. That made it
   * the one delta whose floor key came back byte-identical while the document it arrived in
   * carried `mergedFloor: null` — so the engine skipped the union, and the player's floors,
   * walls and every door glued to a floor-ring wall came off the canvas mid-session. The DM
   * saw none of it, and a reload put it all back, which is how it survived a gate walk.
   */
  test('revealing a secret leaves the player their floors and walls', async () => {
    const rings = (page: Page) =>
      page.evaluate(() => {
        const store = (
          window as unknown as {
            __STORE__?: { getState(): { layers: { type: string; mergedFloor?: unknown[] | null }[] } }
          }
        ).__STORE__
        const dungeon = store?.getState().layers.find((l) => l.type === 'dungeon')
        return dungeon?.mergedFloor?.length ?? 0
      })

    // The player is holding drawn geometry going in, or this row proves nothing.
    await expect.poll(() => rings(player), { timeout: 20_000 }).toBeGreaterThan(0)
    await player.waitForTimeout(1500)
    const before = await shoot(player)
    const settled = await shoot(player)
    const noise = await changed(player, before, settled)

    await selectDoorAsDm(dm, SECRET.id)
    await dm.getByTestId('door-reveal-secret').click()
    await expect(doorRow(player, SECRET.id)).toHaveCount(1, { timeout: 20_000 })
    await player.waitForTimeout(1500)

    // The union survived the merge — this is the store value the whole wipe came out of.
    expect(await rings(player), 'the floor the renderer draws from is still there').toBeGreaterThan(0)

    // …and the door the DM just handed over is in the map, not only in the panel. The two
    // halves of a reveal travel in different frames — the doors slice names the door, the
    // fog re-send carries its child (`RETRACTS`, D2/D5) — and the canvas draws from the map
    // alone, so a door that arrives as a row with no child is a row pointing at nothing.
    //
    // Asserted on the document rather than on pixels: the mark lands wherever the seat's
    // camera happens to be, and this is the one door the player could not hold a moment ago,
    // so there is no row to frame it with before the reveal and no honest baseline to
    // measure against. The document is the thing the renderer is a function of.
    const inMap = await player.evaluate(
      (id: string) =>
        (
          (window as unknown as {
            __sessionStore?: { getState(): { mapData?: { layers?: { children?: { id: string }[] }[] } | null } }
          }).__sessionStore?.getState().mapData?.layers ?? []
        ).some((l) => (l.children ?? []).some((c) => c.id === id)),
      SECRET.id,
    )
    expect(inMap, 'the revealed door reached the map the canvas draws from').toBe(true)

    // The pixels are bounded above only: a wipe took every floor and wall sprite off the
    // canvas at once and measured tens of percent.
    const moved = await changed(player, settled, await shoot(player))
    console.log(
      `[metric] secret revealed: player canvas moved ${(moved * 100).toFixed(3)}% ` +
        `(noise ${(noise * 100).toFixed(3)}%)`,
    )
    expect(moved, 'the map did not come off the canvas').toBeLessThan(0.05)
  })

  test('a revealed secret door works for the player it was revealed to', async () => {
    // Framed first, on this seat's own "take me to it" (D8, `DoorPanel.pick`) — the row above
    // could not do this, because the door it is about is one the player did not hold yet. Now
    // that they do, the mark is on screen and the swing below is measurable, which is what
    // turns "the child reached the map" into "the art reached the canvas".
    await doorRow(player, SECRET.id).getByRole('button').click()
    await player.waitForTimeout(1500)
    const shut = await shoot(player)
    const shutAgain = await shoot(player)
    const noise = await changed(player, shut, shutAgain)

    await toggleDoor(player, SECRET.id)
    await expect(doorRow(dm, SECRET.id)).toHaveAttribute('data-open', 'true')
    await player.waitForTimeout(1500)

    const moved = await changed(player, shutAgain, await shoot(player))
    console.log(
      `[metric] revealed secret swung: player canvas moved ${(moved * 100).toFixed(3)}% ` +
        `(noise ${(noise * 100).toFixed(3)}%)`,
    )
    // Same reading and the same floor as the two floor-ring doors below: a mark drawn above
    // the player's mask is the whole of what moves. Zero here is the door's art missing from
    // the canvas, which is what a reveal that handed over a row and no child would look like.
    expect(moved, 'the revealed door is drawn on the player canvas').toBeGreaterThan(
      Math.max(noise * 4, 0.00002),
    )

    await toggleDoor(player, SECRET.id)
    await expect(doorRow(dm, SECRET.id)).toHaveAttribute('data-open', 'false')
  })

  test('both canvases redraw when a floor-ring door opens', async () => {
    // Both rooms the hallway door joins, so the change is on screen for the player
    // rather than behind their fog.
    await revealRoom(dm, HALLWAY.roomA!)
    await revealRoom(dm, HALLWAY.roomB!)
    await dm.waitForTimeout(1500)
    await player.waitForTimeout(1500)

    // The DM's noise floor. The player's is taken per door below, because their baseline
    // has to be shot from the framing the measurement is taken in.
    const dmShut = await shoot(dm)
    const dmShutAgain = await shoot(dm)
    const dmNoise = await changed(dm, dmShut, dmShutAgain)

    for (const door of [HALLWAY, FLOOR]) {
      // Frame the door on the player's seat before measuring anything on it.
      //
      // A mark parked outside their viewport cannot move their canvas whatever it is drawn
      // over, and the player's camera is wherever their last reveal left it — which depends
      // on how many rooms the rows above this one handed over, so without this the
      // measurement is a function of the suite's order. Selecting the row is the product's
      // own "take me to it" (D8, `DoorPanel.pick`) and moves this seat's stage alone; the
      // row only selects, never swings (D10), so the door is still shut here.
      await doorRow(player, door.id).getByRole('button').click()
      await player.waitForTimeout(1500)
      const playerShut = await shoot(player)
      const playerShutAgain = await shoot(player)
      const playerNoise = await changed(player, playerShut, playerShutAgain)

      await toggleDoor(dm, door.id)
      await expect(doorRow(player, door.id)).toHaveAttribute('data-open', 'true')
      await dm.waitForTimeout(1500)
      await player.waitForTimeout(1500)
      const dmMoved = await changed(dm, dmShutAgain, await shoot(dm))
      const playerMoved = await changed(player, playerShutAgain, await shoot(player))
      console.log(
        `[metric] ${door.id} opened: DM canvas moved ${(dmMoved * 100).toFixed(3)}% ` +
          `(noise ${(dmNoise * 100).toFixed(3)}%), player canvas moved ` +
          `${(playerMoved * 100).toFixed(3)}% (noise ${(playerNoise * 100).toFixed(3)}%)`,
      )
      // The DM's canvas draws the light through the doorway either way.
      expect(dmMoved).toBeGreaterThan(Math.max(dmNoise * 4, 0.0002))
      // The player's redraws too, for the door's own mark. Both of these doors open onto
      // the map's exterior — a floor-ring door always does, since the union gives it a room
      // on one side only — so the light itself lands where their fog covers it and the mark
      // is the whole of what moves: an order of magnitude smaller, against a renderer whose
      // noise floor is zero. It is only readable at all because the mark draws *above* the
      // player's mask (`OVERLAY_STACK`); under it, a door on a room boundary is ~95% scrim.
      expect(playerMoved).toBeGreaterThan(Math.max(playerNoise * 4, 0.00002))
      await toggleDoor(dm, door.id)
      await expect(doorRow(player, door.id)).toHaveAttribute('data-open', 'false')
      await dm.waitForTimeout(1000)
      await player.waitForTimeout(1000)
    }
  })

  /**
   * §2.4.3 — the log is a per-seat feed, not a broadcast with a filter painted on at the
   * far end. The row that matters is the negative one: a door in a wing the party has never
   * walked into moves, and the player's log does not merely decline to name it — it does not
   * grow. The name and the *count* both stay on the DM's side of the wire.
   */
  test('the log names what the table did, and only what a seat could see', async () => {
    const held = await player
      .getByTestId('door-list')
      .locator('[data-door-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-door-id')))

    // An archway refuses every command by design (D2) and a locked door refuses the swing,
    // so the unseen door is picked from what the fixture will actually let move.
    let unseen: DoorChild | undefined
    for (const door of doors) {
      if (door.style === 'archway' || door.isSecret || held.includes(door.id)) continue
      if ((await doorRow(dm, door.id).getAttribute('data-locked')) === 'false') {
        unseen = door
        break
      }
    }
    expect(unseen, 'the fixture holds a door the party has not been given').toBeTruthy()

    const playerLog = () => player.getByTestId('game-log').innerText()
    const before = await playerLog()

    await toggleDoor(dm, unseen!.id)
    await expect(dm.getByTestId('game-log')).toContainText(`opened ${unseen!.name}`)
    // Long enough for the frame that would have carried it, had one been sent.
    await player.waitForTimeout(1000)
    expect(await playerLog()).toBe(before)
    expect(await playerLog()).not.toContain(unseen!.name!)
    await toggleDoor(dm, unseen!.id)

    // A door they do hold reaches both logs, named, with the seat that moved it in front.
    await toggleDoor(dm, HALLWAY.id)
    await expect(dm.getByTestId('game-log')).toContainText(`opened ${HALLWAY.name}`)
    await expect(player.getByTestId('game-log')).toContainText(`opened ${HALLWAY.name}`)
    await toggleDoor(dm, HALLWAY.id)
    await expect(player.getByTestId('game-log')).toContainText(`closed ${HALLWAY.name}`)

    // …and the fog moves write lines of their own, named from the same map.
    const room = layer.rooms!.find((r) => r.id === HALLWAY.roomA)!
    await armFog(dm)
    const row = dm.getByTestId('fog-rooms').locator(`[data-room-id="${room.id}"]`)
    await row.getByRole('button').click()
    await expect(dm.getByTestId('game-log')).toContainText(`hid ${room.name}`)
    await row.getByRole('button').click()
    await expect(dm.getByTestId('game-log')).toContainText(`revealed ${room.name}`)
  })
})
