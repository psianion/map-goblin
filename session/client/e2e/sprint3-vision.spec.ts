import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import type { DoorChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import {
  OVERLAY_CHROME,
  assertMapLoaded,
  assertMapRendered,
  hostTable,
  joinTable,
  measureFps,
  openPanel,
  type MapUnderTest,
} from './table'
import { openTokens } from './tokens'

/**
 * @sprint3-vision — token vision (S3 P2) at the table, which is the only place the two halves
 * of it meet: the referee's sweep decides what a player is *sent*, and this canvas decides
 * what they can *see* of what they hold. The unit rows pin each half on its own
 * (`session/server/src/fog/vision-mode.test.ts`, `src/modules/fog/visionSight.test.ts`); what
 * only a browser can answer is whether the two agree with a real socket between them.
 *
 * The map is two halls either side of one wall with a two-cell door in it
 * (`session/testdata/vision-two-rooms.mapbuilder`) — small enough that every reading below is
 * about the door being shut or open, and not about a dressed dungeon's own texture.
 *
 * No fog UI exists for any of this yet (that is P4), so the DM's commands go through the
 * session store the way the socket carries them. That is deliberate rather than a shortcut:
 * these rows are about the server's truth reaching a canvas, and a panel in between would
 * only add a second thing to be broken.
 *
 *   pnpm exec playwright test -c e2e/playwright.sprint3.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }

/** D10's reveal fade, copied for the reason sprint3-fog copies it: this is a Node process. */
const REVEAL_MS = 300

// ── The map, read the way the server reads it ───────────────────────────────
// By shape, never by spelled-out id: a re-authored fixture has to fail here loudly.

const FILE = join(import.meta.dirname, '../../testdata/vision-two-rooms.mapbuilder')
const doc = JSON.parse(readFileSync(FILE, 'utf8')) as SerializedMapData
const VISION: MapUnderTest = { file: FILE, name: doc.mapSettings.name }

const layer = doc.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
/** West first, east second — the party starts in the near one and the far one is the secret. */
const [NEAR, FAR] = [...(layer.rooms ?? [])].sort((a, b) => a.centroid[0] - b.centroid[0])
/** The ordinary door between them. The other one on this wall is secret and stays the DM's. */
const DOOR = layer.children.find(
  (child): child is DoorChild => child.childType === 'door' && !child.isSecret,
)!

/**
 * Where the scout stands to see through the doorway, and a corner of the same hall. Sight is
 * line of sight to the whole map, so there is no spot in this open hall that cannot see the
 * doorway — what takes the far hall out of sight is the door shutting (`lookAway`).
 */
const AT_DOOR = { x: NEAR.centroid[0] + 0.5, y: NEAR.centroid[1] + 0.5 }
const AWAY = { x: 1.5, y: 1.5 }
const SIGHT = { range: 8, angle: 360, visionMode: 'normal' }

// ── Instruments ────────────────────────────────────────────────────────────

interface SessionHandle {
  getState(): {
    sendCommand(module: string, action: string, payload: unknown): void
    mapData: unknown
  }
}

/** A DM (or player) command, straight down the socket the panels would use. */
function command(page: Page, module: string, action: string, payload: unknown): Promise<void> {
  return page.evaluate(
    (sent: { module: string; action: string; payload: unknown }) => {
      const store = (window as unknown as { __sessionStore?: SessionHandle }).__sessionStore
      if (!store) throw new Error('this build is not exposing the session store — rebuild')
      store.getState().sendCommand(sent.module, sent.action, sent.payload)
    },
    { module, action, payload },
  )
}

interface ProbeRead {
  mode: string
  sources: number
  cells: number
  rebuilds: number
  lastMs: number
}

/** `__fogProbe`'s vision half (§4). The four fields sprint3-fog reads are untouched. */
function probe(page: Page): Promise<ProbeRead | null> {
  return page.evaluate(() => {
    const p = (
      window as Window & {
        __fogProbe?: {
          mode: string
          sweepSources(): number
          memoryCells(): number
          rebuilds: number
          lastRebuildMs: number
        }
      }
    ).__fogProbe
    return p
      ? {
          mode: p.mode,
          sources: p.sweepSources(),
          cells: p.memoryCells(),
          rebuilds: p.rebuilds,
          lastMs: p.lastRebuildMs,
        }
      : null
  })
}

const read = async (page: Page): Promise<ProbeRead> => {
  const now = await probe(page)
  expect(now, 'the fog probe is not mounted on this seat').not.toBeNull()
  return now as ProbeRead
}

/**
 * Which rooms this tab was actually handed, off the referee's own document.
 *
 * Not off core's store, which is where `serverRooms` will not read either: core re-detects
 * rooms from the geometry *this tab* holds a beat after every load and overwrites
 * `layer.rooms` with ids of its own invention (measured here: the west hall came back as
 * `room-dk42s3`), so a row asserting on those is racing the backfill.
 */
function heldRooms(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as { __sessionStore?: SessionHandle }).__sessionStore
    const held = store?.getState().mapData as { layers?: { rooms?: { id: string }[] }[] } | null
    return (held?.layers ?? []).flatMap((l) => (l.rooms ?? []).map((r) => r.id)).sort()
  })
}

/**
 * What this tab's own fog slice says about a room — null for one it was never sent.
 *
 * The wire half of the cell tier: a room the party *swept* is latched (`re_hidden`), so its
 * geometry ships and the cells they reached are what shows; `revealed` is the DM's own act and
 * is the only thing that washes a room whole.
 */
function fogStatus(page: Page, roomId: string): Promise<string | null> {
  return page.evaluate((id: string) => {
    const store = (
      window as unknown as {
        __sessionStore?: {
          getState(): { session?: { activeSceneId?: string; modules?: Record<string, unknown> } }
        }
      }
    ).__sessionStore
    const state = store?.getState()
    const scene = state?.session?.activeSceneId
    const fog = state?.session?.modules?.fog as
      | { byScene?: Record<string, { rooms?: Record<string, { status?: string }> }> }
      | undefined
    return (scene ? fog?.byScene?.[scene]?.rooms?.[id]?.status : null) ?? null
  }, roomId)
}

/** The cells of one room, in the region record's own coordinates. */
async function cellsOf(page: Page, room: Room): Promise<[number, number][]> {
  const frame = await page.evaluate(() => {
    const store = (window as unknown as { __sessionStore?: SessionHandle }).__sessionStore
    return (store?.getState().mapData as { frame?: Record<string, number> } | null)?.frame ?? null
  })
  expect(frame, 'the document carries no frame to count cells against').not.toBeNull()
  const { minX, minY, maxX, maxY } = frame as Record<string, number>
  const [cols, rows] = [Math.round(maxX - minX), Math.round(maxY - minY)]
  const xs = room.boundary.map((p) => p[0])
  const ys = room.boundary.map((p) => p[1])
  const cells: [number, number][] = []
  for (let x = Math.floor(Math.min(...xs)); x < Math.ceil(Math.max(...xs)); x++) {
    for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++) {
      const [col, row] = [Math.round(x - minX), Math.round(y - minY)]
      if (col >= 0 && row >= 0 && col < cols && row < rows) cells.push([col, row])
    }
  }
  expect(cells.length).toBeGreaterThan(0)
  return cells
}

/** sprint3-fog's shutter and its reasons — chrome hidden so the status bar is not in frame. */
const shoot = (page: Page): Promise<Buffer> =>
  page.locator('[data-testid="game-canvas"] canvas').screenshot({ style: OVERLAY_CHROME })

interface Look {
  /** Mean luminance over the whole canvas, 0–255. */
  mean: number
  /** Fraction of pixels a light source reaches — brighter than the fog's brightest cloud. */
  lit: number
  /** Fraction of pixels the fog is not covering — outside its colour band on either side. */
  clear: number
}

/**
 * What the canvas looked like, as three numbers — and two questions, not one.
 *
 * This read a single 120/255 floor until #101, on the claim that the map's floor was the
 * editor default (#F1ECDF, ~236) and the void the background's own #2d2d2d at ~45, so nothing
 * but floor could clear 120. Both halves of that are gone. #100's ambient grade puts an unlit
 * hall's floor at ~36/255, so *nothing* on this map clears 120 any more — every reading below
 * came back at a flat 0.052%, the same token art and door furniture in every state, which is
 * how two frames a look-away apart measured bit-identical. And #101 replaced the void the
 * floor was being read against with an animated cloud.
 *
 * The cloud is what the readings are taken against instead, because it is the one thing on
 * this canvas with a *bounded* colour: measured 22.0–59.1/255 over a frame that is nothing
 * but fog (`dark`), and it cannot leave that band whatever the clock does — its darkest pixel
 * is `uDeep` mixed 30% toward `uMid` and its brightest one lobe of `uHigh` (`livingFog.ts`),
 * both palette constants the time uniform never touches.
 *
 *   `clear` — under 16 or over 64 — is "the fog is not covering this pixel": ground the seat
 *   has earned, whether a light reaches it or not. A seat that has swept nothing reads
 *   0.000%; one swept hall reads ~15%.
 *   `lit` — over 64 — is "a light reaches this pixel", which is the question the §4 rows
 *   about the ambient dial, a torch and darkvision are actually asking. The graded floor at
 *   ~36 is below it, so only a light source or a lit prop counts.
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
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      sum += luminance
      if (luminance > 64) lit++
      else if (luminance < 16) dark++
    }
    const pixels = data.length / 4
    return { mean: sum / pixels, lit: lit / pixels, clear: (lit + dark) / pixels }
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/** `clear`'s dark half on its own: the map's own black, below anything the fog can paint. */
const blackOf = (l: Look) => l.clear - l.lit

const look = async (page: Page): Promise<Look> => develop(page, await shoot(page))
const show = (l: Look) =>
  `mean ${l.mean.toFixed(1)}/255, ${(l.clear * 100).toFixed(1)}% clear of fog, ` +
  `${(l.lit * 100).toFixed(1)}% lit`

interface Patch {
  /** Mean luminance over the sampled pixels, 0–255. */
  mean: number
  /** Mean chroma — max channel minus min — over the same pixels, 0–255. */
  chroma: number
  /** How many pixels were in the sample, as a fraction of the frame. */
  covered: number
}

/**
 * What one state did to the pixels another state lit — sprint3-fog's instrument, for its
 * reasons: a mean over the whole frame is mostly a count of how much black is in it, and the
 * question §4 asks is about one patch of floor under three different treatments.
 *
 * Masked on the *floor* threshold rather than sprint3-fog's black floor: this map's memory
 * wash and its drained grade both clear 32, so a looser mask would fold the rest of the map
 * into a reading that is supposed to be about the torch pool alone.
 *
 * Chroma comes with it because dimming is only half the requirement. The art guide's night
 * is "desaturated, low contrast" with "glows doing all the colour work" — a treatment that is
 * merely darker has taken the light away without taking the colour.
 */
/**
 * Luminance at a grid of world points, read off a screenshot of the canvas — the map through
 * whatever the fog draws over it, at a *place* rather than over the frame. World coordinates
 * through the probe's own `screenOf`, so two shots with different cameras (a reload re-fits)
 * read the same ground. Quarter-cell steps: enough of the floor's texture to correlate on.
 */
async function patchRead(page: Page, box: [number, number, number, number]): Promise<number[]> {
  const shot = await shoot(page)
  return page.evaluate(
    async ([url, x0, y0, x1, y1]: [string, number, number, number, number]) => {
      const probe = (
        window as Window & { __fogProbe?: { screenOf(x: number, y: number): { x: number; y: number } } }
      ).__fogProbe
      if (!probe) throw new Error('no fog probe on this seat — rebuild')
      const canvas = document.querySelector('[data-testid="game-canvas"] canvas') as HTMLCanvasElement
      const bitmap = await createImageBitmap(await (await fetch(url)).blob())
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = surface.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      // The shot is of the canvas element alone, so its pixels are the canvas's CSS box.
      const sx = bitmap.width / canvas.clientWidth
      const sy = bitmap.height / canvas.clientHeight
      const out: number[] = []
      for (let y = y0; y < y1; y += 0.25) {
        for (let x = x0; x < x1; x += 0.25) {
          const at = probe.screenOf(x, y)
          const i = (Math.round(at.y * sy) * width + Math.round(at.x * sx)) * 4
          out.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
        }
      }
      return out
    },
    [`data:image/png;base64,${shot.toString('base64')}`, ...box] as [string, number, number, number, number],
  )
}

const meanOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
/** How much the reading varies across the strip — the floor's grain; hidden ground renders flat. */
const spreadOf = (xs: readonly number[]): number => {
  const m = meanOf(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

function sample(page: Page, shot: Buffer, mask: Buffer): Promise<Patch> {
  return page.evaluate(
    async ([a, b]: string[]) => {
      const pixels = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob())
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [target, reference] = await Promise.all([pixels(a), pixels(b)])
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      let sum = 0
      let chroma = 0
      let counted = 0
      for (let i = 0; i < target.length; i += 4) {
        if (luminance(reference, i) <= 120) continue
        counted++
        sum += luminance(target, i)
        chroma +=
          Math.max(target[i], target[i + 1], target[i + 2]) -
          Math.min(target[i], target[i + 1], target[i + 2])
      }
      return {
        mean: counted ? sum / counted : 0,
        chroma: counted ? chroma / counted : 0,
        covered: counted / (target.length / 4),
      }
    },
    [
      `data:image/png;base64,${shot.toString('base64')}`,
      `data:image/png;base64,${mask.toString('base64')}`,
    ],
  )
}

const showPatch = (p: Patch) =>
  `mean ${p.mean.toFixed(1)}/255, chroma ${p.chroma.toFixed(1)} over ${(p.covered * 100).toFixed(1)}% of the frame`

/** Every token id on a seat's canvas, which is how a freshly placed one is picked out.
 *  `token-layer` lives inside the Tokens popover's On Map tab now (M3); every placement in
 *  this file goes through `command()` (a direct dispatch), never the Library tab, so opening
 *  the popover is the whole fix. */
const tokenIds = async (page: Page): Promise<string[]> => {
  await openTokens(page)
  return page
    .getByTestId('token-layer')
    .locator('[data-token-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-token-id') as string))
}

/** Place a token and hand back the id the server minted for it. */
async function place(page: Page, payload: Record<string, unknown>): Promise<string> {
  const before = await tokenIds(page)
  await command(page, 'tokens', 'place', payload)
  await expect.poll(async () => (await tokenIds(page)).length).toBe(before.length + 1)
  return (await tokenIds(page)).find((id) => !before.includes(id)) as string
}

/**
 * One camera for every reading in a segment.
 *
 * The renderer frames a scene exactly once — a reveal must never yank the camera — so a fit
 * taken while the party held one room is a different transform from one taken after a reload
 * with two. Every shot below is taken through a fit performed with the same geometry held,
 * which is what makes two means comparable at all.
 */
async function frameUp(page: Page): Promise<void> {
  await page.getByLabel('Fit to screen').click()
  await page.waitForTimeout(REVEAL_MS * 3)
}

/** What fraction of the canvas moved between two shots. sprint3-fog's, for its reasons. */
function changed(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]: string[]) => {
      const pixels = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob())
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
    [
      `data:image/png;base64,${before.toString('base64')}`,
      `data:image/png;base64,${after.toString('base64')}`,
    ],
  )
}

/** Every measurement lands in the run log in the same grep-able shape as the other specs. */
function record(name: string, measured: string, target: string): void {
  console.log(`[metric] ${name}: ${measured} (target: ${target})`)
}

const doorRow = (page: Page, doorId: string) =>
  page.getByTestId('door-list').locator(`[data-door-id="${doorId}"]`)

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@sprint3-vision', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let scout: string
  /** The torch and the darkvision eye the P3 rows below light the map with. */
  let torchId: string
  let owlId: string
  /** The honest "nothing earned" reading, taken before any token is claimed. */
  let dark: Look
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, VISION)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, VISION)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    // Not `assertMapRendered`: this player holds no room of the map until their own token
    // earns one, so there is no floor for them to union.
    await assertMapLoaded(player, VISION)

    await command(dm, 'fog', 'set-mode', { mode: 'vision' })
    await expect.poll(async () => (await probe(player))?.mode).toBe('vision')
    await player.waitForTimeout(REVEAL_MS * 4)
    dark = await look(player)

    // A sighted scout in the near hall, and the seat that claims it is the one being masked.
    await command(dm, 'tokens', 'place', { name: 'Scout', ...AT_DOOR, sight: SIGHT })
    await openTokens(dm)
    await expect
      .poll(() => dm.getByTestId('token-layer').locator('[data-token-id]').count())
      .toBe(1)
    scout = (await dm
      .getByTestId('token-layer')
      .locator('[data-token-id]')
      .first()
      .getAttribute('data-token-id')) as string
    await command(player, 'tokens', 'claim', { id: scout })
    await expect.poll(async () => (await read(player)).sources).toBe(1)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the vision map:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  /**
   * §1 — the first frame a claimed pair of eyes buys.
   *
   * Nothing was revealed by hand: the party's own sweep auto-explored the hall it is standing
   * in, and that is the only room the referee has sent. The far hall is not dark on this
   * canvas because a mask covers it — it is dark because the tab does not have it (principle
   * 2), which is what the memory half of the row asks about.
   */
  test('a claimed token’s sweep is the first thing on the player’s canvas', async () => {
    const now = await read(player)
    expect(now.mode).toBe('vision')
    expect(now.sources, 'the mask was drawn through no eyes at all').toBe(1)
    expect(now.cells, 'the party swept nothing into the region record').toBeGreaterThan(0)

    // Exactly the hall they are standing in, and not the one through the shut door.
    await expect.poll(() => heldRooms(player)).toEqual([NEAR.id])
    const page = await player.content()
    expect(page, 'the far hall reached a tab that never saw into it').not.toContain(FAR.name)

    const lit = await look(player)
    record(
      'sweep-gated first frame (claim → auto-explore → mask)',
      `${NEAR.name} drawn through ${now.sources} token('s) sight over ${now.cells} swept ` +
        `cell(s): ${show(dark)} at join → ${show(lit)} once claimed`,
      'the hall the party can see, and nothing through the shut door',
    )
    // One hall is now on a canvas the fog covered edge to edge a moment ago. Read as `clear`
    // and not `lit`: #100's grade puts this hall's unlit floor at ~36/255, which is inside the
    // fog's own 22–59 band, so no brightness floor can tell the two apart — what the sweep
    // actually did is cut a hole in the cover, and a hole is the one thing a cloud cannot
    // draw. Measured 0.000% before the claim (the frame is nothing but fog) and 15.0% after.
    expect(
      dark.clear,
      `the player's canvas drew ${show(dark)} before anyone claimed a token`,
    ).toBeLessThan(0.002)
    expect(lit.clear, `the sweep drew ${show(lit)}`).toBeGreaterThan(0.02)
  })

  /**
   * §1 — a door is a wall until it is not, on both seats at once.
   *
   * One toggle is one command: the DM's tab and the player's both learn the new state from
   * the server, and the player's *mask* learns it too — the sweep runs through the gap, the
   * far hall auto-explores through it, and its geometry arrives in the same beat (D5).
   */
  test('opening the door grows the clear area, live on two contexts', async () => {
    await openPanel(player, 'doors')
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'false')
    const shut = await shoot(player)
    const shutAgain = await shoot(player)
    const noise = await changed(player, shut, shutAgain)

    await command(dm, 'doors', 'toggle', { id: DOOR.id })
    await openPanel(dm, 'doors')
    await expect(doorRow(dm, DOOR.id)).toHaveAttribute('data-open', 'true')
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'true')

    // The sweep reached through the gap, so the far hall is the party's now — geometry and
    // all, off the same fog write the sweep earned.
    await expect.poll(() => heldRooms(player)).toEqual([FAR.id, NEAR.id].sort())
    await player.waitForTimeout(REVEAL_MS * 4)

    const open = await shoot(player)
    const moved = await changed(player, shutAgain, open)
    const [before, after] = [await develop(player, shutAgain), await develop(player, open)]

    record(
      'door → sweep on the player canvas',
      `${DOOR.id}: ${(moved * 100).toFixed(2)}% of the canvas moved on opening (still frame ` +
        `to still frame: ${(noise * 100).toFixed(2)}%), shut ${show(before)} → open ${show(after)}`,
      'the clear area grows through the doorway on both seats',
    )
    // Area, not motion. `changed` counts pixels that differ, and since #101 the clouds differ
    // on their own — a canvas left alone for six seconds moves ~21% of itself — so a bound of
    // "more than a still-frame sample" is a bound the weather clears without a door in it.
    // What the row claims is that the clear area *grew*, and that is what is asserted.
    expect(after.clear, `shut ${show(before)} → open ${show(after)}`).toBeGreaterThan(before.clear)
  })

  /**
   * §1 — the memory tier: what the party swept stays legible when they stop looking at it,
   * survives a reload, and is still not the same thing as ground they have earned.
   *
   * Four readings through one camera, which is the whole reason `frameUp` exists. The DM's
   * last act is the P4 pairing the spec names — a room re-hidden *and* its cells rubbed out
   * — because it is the only thing that takes memory away, and it is what makes "wash" a
   * measurable claim instead of a hopeful one.
   */
  /**
   * A strip of the far hall just inside the doorway — inside the sightline the scout has
   * through it from `AT_DOOR` (a 2-cell gap 5.5 cells away opens to ±1.4 cells by x = 13),
   * so every point of it is live when the door is open, memory when it shuts, and void once
   * the cells are rubbed out.
   */
  const FAR_STRIP: [number, number, number, number] = [12.5, 4.5, 15.5, 6.5]
  /** A patch of the near hall's floor beside where the scout stands at `AT_DOOR`. */
  const NEAR_PATCH: [number, number, number, number] = [2.5, 2.5, 5.5, 4.5]

  test('what the party swept is a memory: the same floor, dimmed — and void is not', async () => {
    // In front, so the canvas actually repaints between the four shots below: a background
    // page's ticker is paused, and a screenshot of a paused canvas is the last frame it drew.
    await player.bringToFront()
    await frameUp(player)
    const lookingShot = await shoot(player)
    const looking = await develop(player, lookingShot)
    const live = await patchRead(player, FAR_STRIP)

    // The door shuts behind them — the far hall is remembered now, not seen.
    const before = await read(player)
    await command(dm, 'doors', 'toggle', { id: DOOR.id })
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'false')
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    await player.waitForTimeout(REVEAL_MS * 4)
    const awayShot = await shoot(player)
    const away = await develop(player, awayShot)
    const memory = await patchRead(player, FAR_STRIP)
    const remembered = await read(player)

    await player.reload()
    await assertMapLoaded(player, VISION)
    await expect.poll(async () => (await probe(player))?.mode).toBe('vision')
    await frameUp(player)
    const reloaded = await look(player)
    const back = await patchRead(player, FAR_STRIP)

    // The one thing that takes a memory back (P4's brush, driven here as commands): the room
    // goes under *and* the cells the party earned are rubbed out. Only then is it void again.
    //
    // Both halls, not just the far one. A swept room is latched rather than lit (the sweep
    // never says `revealed`), so what is actually on the canvas is cells — and taking one
    // room's back while the party's own memory of the room they walked through still covers
    // a fifth of the frame would leave this reading measuring almost nothing.
    for (const room of [NEAR, FAR]) {
      await command(dm, 'fog', 'hide', { roomId: room.id })
      await command(dm, 'fog', 'region-set', { op: 'hide', cells: await cellsOf(player, room) })
    }
    await expect.poll(async () => (await read(player)).cells).toBeLessThan(remembered.cells)
    await player.waitForTimeout(REVEAL_MS * 4)
    const blanked = await look(player)
    const gone = await patchRead(player, FAR_STRIP)

    const sd = (xs: number[]) => spreadOf(xs).toFixed(1)
    record(
      'the memory tier across a look-away, a reload and a region-hide',
      `looking ${show(looking)} → door shut ${show(away)} → reloaded ${show(reloaded)} → ` +
        `room hidden and cells rubbed out ${show(blanked)} (${remembered.cells} swept cell(s)); ` +
        `the strip inside the doorway: live ${meanOf(live).toFixed(1)} ±${sd(live)} → memory ` +
        `${meanOf(memory).toFixed(1)} ±${sd(memory)} → reloaded ${meanOf(back).toFixed(1)} → void ` +
        `${meanOf(gone).toFixed(1)} ±${sd(gone)}`,
      'memory is the live floor, a step dimmer; void is the flat cover, not the floor',
    )

    // Read at a place, not over the frame: whole-frame shares could not tell these states
    // apart once the memory tier stopped being near-black (it is the map under a thin haze
    // now) and the dense cloud started being the darkest thing on the canvas. A memory is the
    // live floor a step dimmer — the same flat floor this fixture draws, under a 30% wash —
    // and the void is the cover, which renders flat (`livingFog.ts`: hidden ground at exactly
    // uDense, so nothing beneath it telegraphs through) where the floor keeps its grain. (The
    // cover's *mean* is no use here: on this map it lands within a point of the floor.)
    expect(meanOf(memory), 'the memory is not dimmer than live').toBeLessThan(meanOf(live))
    expect(meanOf(memory), 'the memory is not the floor any more').toBeGreaterThan(meanOf(live) * 0.6)
    expect(spreadOf(memory), 'the memory lost the floor’s grain').toBeGreaterThan(spreadOf(live) * 0.5)
    expect(spreadOf(gone), 'the void still shows the floor’s grain').toBeLessThan(spreadOf(memory) * 0.5)
    // The reload keeps it — the record is the server's and the mask rebuilds from it.
    expect(Math.abs(meanOf(back) - meanOf(memory))).toBeLessThan(meanOf(memory) * 0.15)
    // Region memory only ever ORs: the door shutting takes no ground back.
    expect(remembered.cells).toBeGreaterThan(0)
  })

  /**
   * §1 — what walking earns is *cells*, not rooms, and this is the row that can tell.
   *
   * The far hall is entered through a two-cell doorway from most of a room away, so the party's
   * sightline reaches a sliver of it and no more. A mask that washed every explored room whole
   * would put the entire hall under the memory tint on that sliver's strength — which is
   * exactly what the two readings below separate: the same room, same camera, remembered from
   * a partial sweep and then revealed by the DM's own hand, which is the one act that *is* a
   * whole-room wash.
   */
  test('a swept room remembers the cells it swept; only a DM reveal washes it whole', async () => {
    const farRoomCells = await cellsOf(player, FAR)
    const before = await read(player)

    // Open the door again — the row above rubbed both halls' cells out, so what comes back
    // now is exactly what this one sightline through the doorway reaches.
    await command(dm, 'doors', 'toggle', { id: DOOR.id })
    await expect.poll(async () => (await read(player)).cells).toBeGreaterThan(before.cells)

    // …then shut it, so the far hall is memory alone with nothing live in it.
    await command(dm, 'doors', 'toggle', { id: DOOR.id })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    await player.waitForTimeout(REVEAL_MS * 4)
    await frameUp(player)
    const partial = await look(player)

    // The wire says what the canvas says: a sweep latches a room, it does not light it.
    expect(await fogStatus(player, FAR.id)).toBe('re_hidden')

    // The DM's own reveal — the whole-room wash, and the only thing that is one.
    await command(dm, 'fog', 'reveal', { roomId: FAR.id })
    await expect.poll(() => fogStatus(player, FAR.id)).toBe('revealed')
    await player.waitForTimeout(REVEAL_MS * 4)
    const washed = await look(player)

    // How much of the far hall that sightline actually earned, counted the only way the probe
    // can: rub exactly its cells out and read what the total dropped by.
    const held = (await read(player)).cells
    await command(dm, 'fog', 'region-set', { op: 'hide', cells: farRoomCells })
    await expect.poll(async () => (await read(player)).cells).toBeLessThan(held)
    const swept = held - (await read(player)).cells

    record(
      'cell-granular memory against a whole-room wash',
      `${FAR.name}: ${swept} of ${farRoomCells.length} cell(s) swept through the doorway reads ` +
        `${show(partial)}; the DM's reveal of the same room reads ${show(washed)}`,
      'a sweep shows its cells; only the DM’s reveal washes the room whole',
    )

    // The sightline earned a sliver, never the room — the sweep is what the record holds.
    expect(
      swept,
      `the doorway sweep recorded ${swept} of the hall’s ${farRoomCells.length} cells`,
    ).toBeLessThan(farRoomCells.length / 2)
    // …and the canvas agrees: revealing the room by hand is visibly more map than the sliver.
    // On `clear`, and not on the mean it used to read, for the reason the row above gives —
    // #101's cloud is brighter than this map's graded floor, so taking the fog off a whole
    // room LOWERS the frame mean (23.8 washed against the sliver's 31.1) and the old reading
    // had the sign backwards. The hole in the cover is the thing: 10.1% → 40.0%.
    expect(
      washed.clear,
      `the swept sliver read ${show(partial)} and the DM's whole-room reveal ${show(washed)} — ` +
        'a mask washing every explored room whole reads them the same',
    ).toBeGreaterThan(partial.clear + 0.01)
  })

  /** §2.6's standing gate condition, on this map too: zero uncaught errors. */
  test('the vision map draws with no page errors', () => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  /**
   * §4 — the mask is built on mutation and then only drawn, and this is the number that says
   * so: one token move, one rebuild, and the sweep plus the whole Clipper pass inside it.
   *
   * The bound is a frame, not the phase's real budget. P6 pins the eight-token number on the
   * dressed gate map (`sprint3-vision-gate.spec.ts`, at the floor it measured rather than at
   * the plan's 2ms, which Clipper cannot reach); what this row defends is the
   * discipline — a build that ever crept into the draw loop would blow a 16ms bound on a map
   * this size long before a dressed one.
   *
   * The fps half is sprint3-fog's ratio, for its reasons: four runs of that row on identical
   * code read 26.6 through 12.3fps as the box's load moved, so the guard is the player's seat
   * against the DM's unmasked canvas at the same moment, never an absolute floor.
   */
  test('a sweep-driven rebuild costs less than a frame, and the seat keeps up', async () => {
    await player.bringToFront()
    const before = await read(player)

    await command(dm, 'tokens', 'move', { id: scout, ...AT_DOOR })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    const built = await read(player)

    // Discarded: the first sample after a tab switch measures the tab switch.
    await measureFps(player, 500)
    const seat = await measureFps(player)
    const dmSeat = await measureFps(dm)

    record(
      'vision mask rebuild after a token move',
      `${built.lastMs.toFixed(2)}ms to build (${built.rebuilds - before.rebuilds} rebuild(s), ` +
        `${built.sources} sight source(s), ${built.cells} swept cell(s)); ${seat.toFixed(1)}fps ` +
        `on the masked player seat against ${dmSeat.toFixed(1)}fps on the DM's unmasked canvas`,
      '< 16ms per build (the gate map’s eight-token budget is sprint3-vision-gate’s own) and ' +
        'no gap against the DM control',
    )

    expect(built.lastMs, 'the mask took longer than a frame to build').toBeLessThan(16)
    expect(built.lastMs, 'the probe never timed a build at all').toBeGreaterThan(0)
    expect(
      seat / dmSeat,
      'the vision mask opened a gap against the unmasked DM control',
    ).toBeGreaterThanOrEqual(0.6)
  })

  // ── S3 P3 — the light model at the table ──────────────────────────────────
  // Everything above is a party that can see by the scene itself. These four rows are the
  // same table with the light taken away: the DM turns the ambient dial to `darkness`, and
  // what the player can see becomes a statement about torches and darkvision instead of
  // about walls. The unit rows pin the rule either side of the socket
  // (`vision-mode.test.ts`'s light gate, `FogRenderer.test.ts`'s `visionRegion in the dark`);
  // what only a browser can answer is what the canvas actually looks like.

  /** A carried torch: bright to 2 cells, dim to 4 — the outer radius is the reach. */
  const TORCH = { dim: 4, bright: 2, color: '#ffbb66', angle: 360 }

  test('in the dark a normal eye sees by a torch, and by nothing else', async () => {
    await command(dm, 'tokens', 'move', { id: scout, ...AT_DOOR })
    await expect.poll(async () => (await read(player)).sources).toBe(1)
    await frameUp(player)
    const seeing = await look(player)
    const dmSeeing = await look(dm)

    // One dial, no token moved, no door touched.
    await command(dm, 'triggers', 'set-environment', { ambient: 'darkness' })
    // The badge is the settle signal, not a pixel poll: this dial does not move `lit` at all
    // (see below), so polling on it waited for something that was never going to happen.
    await expect(player.getByTestId('env-badge')).toHaveText(/^Darkness/)
    await player.waitForTimeout(REVEAL_MS * 2)
    const blind = await look(player)

    torchId = await place(dm, { name: 'Torchbearer', ...AT_DOOR, sight: null, light: TORCH })
    await expect.poll(async () => (await look(player)).lit).toBeGreaterThan(blind.lit + 0.005)
    await player.waitForTimeout(REVEAL_MS * 2)
    const pool = await look(player)
    const dmDark = await look(dm)

    record(
      'the ambient dial and the torch under it',
      `sweep-lit ${show(seeing)} → darkness ${show(blind)} → one torch ${show(pool)}; the DM's ` +
        `own canvas ${show(dmSeeing)} → ${show(dmDark)}`,
      'the pool is what they see, and the DM stages the dark rather than sitting in it',
    )

    // The dial took the ground the party can see away from them: 2.5% → 1.4% of the frame
    // clear of fog. On `clear` now, and no longer on the mean — since the mask became a raster
    // tier the frame mean on this map is the cloud's and not the floor's, and the ambient dial
    // does not move the cloud: 28.8 → 28.9 measured, which is noise with the sign backwards.
    // Not on `lit` either, because after #100 this hall was never *lit* to begin with — an
    // unlit floor grades to ~36/255 with or without a sweep over it, so `lit` reads an
    // identical 0.0% either side of the dial. A hole in the cover is the one thing a cloud
    // cannot draw, which is why it is the reading that still separates a party who can see
    // this hall from one standing in the dark. The 0.005 margin is half the measured 1.1-point
    // drop and five times the frame-to-frame drift this map's clouds show.
    expect(blind.clear, `the dark still drew ${show(blind)}`).toBeLessThan(seeing.clear - 0.005)
    // Pitch dark is pitch dark: nothing on the frame is at light-source brightness. 0.1%
    // measured, which is the scout's own disc and the door's furniture.
    expect(blind.lit, `the dark still drew ${show(blind)}`).toBeLessThan(0.005)
    // The torch opens a pool — and only a pool: 10.6% of the frame at light-source brightness
    // inside the 46.7% the party can see at all (the sweep reaches eight cells, the torch
    // four). Against 0.1% in the dark a moment earlier.
    expect(pool.lit).toBeGreaterThan(blind.lit + 0.01)
    expect(pool.lit, `the torch lit ${show(pool)} against the sweep's ${show(seeing)}`)
      .toBeLessThan(pool.clear)
    // …while the DM never loses the map (principle 3): darkness is something they stage.
    // Asserted as a direction now, not as a tolerance on the mean. The tolerance was ±10% and
    // the measurement is 16.9 → 22.7 — but that 5.8 is the torch, which is a real light on a
    // real map the DM is looking straight at, and a bound wide enough to allow it says
    // nothing. What the claim actually is: the dial did not take the DM's map away (their
    // canvas got *brighter* over a step that blacked the player's out) and the pool is on it
    // (8.0% of their frame at light-source brightness, against 0.1% before the torch).
    expect(
      dmDark.mean,
      `the DM's canvas went dark with the room: ${show(dmSeeing)} → ${show(dmDark)}`,
    ).toBeGreaterThan(dmSeeing.mean)
    expect(dmDark.lit, `the DM lost the torch pool: ${show(dmDark)}`).toBeGreaterThan(0.01)
  })

  /**
   * §4 — the drained grade, measured the way sprint3-fog measures the explored one: the same
   * pixels, three times over. The mask is the torchlit frame, so every reading below is about
   * one patch of floor and not about how much black is in the frame.
   */
  test('darkvision reads shape without colour — above the void, under the torchlight', async () => {
    const litShot = await shoot(player)
    const lit = await sample(player, litShot, litShot)
    // The sample-size floor, not a claim: `sample` reads the pixels the torchlit frame put
    // over 120, and a mean and a chroma need enough of them to mean anything. 0.56% of a
    // 1280×720 canvas is ~5,100 pixels, measured identically on two runs — the pool is a tenth
    // of the frame share it covered before the mask became a raster tier (the old floor of 1%
    // was derived against that), and 5,100 pixels is still an ample sample.
    expect(lit.covered, 'the torch pool is too small to measure').toBeGreaterThan(0.003)

    // The same ground with the torch gone: the party is blind and it is void.
    await command(dm, 'tokens', 'delete', { id: torchId })
    await expect.poll(async () => (await look(player)).lit).toBeLessThan(0.005)
    await player.waitForTimeout(REVEAL_MS * 2)
    const darkShot = await shoot(player)
    const dark = await sample(player, darkShot, litShot)
    const unlit = await develop(player, darkShot)

    // …and again, seen by an owl's eyes alone. Nothing is burning anywhere on this map.
    owlId = await place(dm, {
      name: 'Owl',
      ...AT_DOOR,
      sight: { range: 8, angle: 360, visionMode: 'darkvision' },
    })
    await command(player, 'tokens', 'claim', { id: owlId })
    await expect.poll(async () => (await read(player)).sources).toBe(2)
    await player.waitForTimeout(REVEAL_MS * 2)
    const drainedShot = await shoot(player)
    const drained = await sample(player, drainedShot, litShot)
    const owled = await develop(player, drainedShot)

    record(
      'the darkvision grade against torchlight and void, on one patch of floor',
      `torchlit ${showPatch(lit)} → unlit ${showPatch(dark)} → darkvision ${showPatch(drained)}; ` +
        `the map's own black over the frame: ${(blackOf(unlit) * 100).toFixed(1)}% → ` +
        `${(blackOf(owled) * 100).toFixed(1)}%`,
      'above the void, below the pool, and drained of the pool’s colour',
    )

    // Shape: the party can see this ground, so it is not void. Read on the patch — the same
    // pixels under the two treatments — which is where the claim actually lives: nobody
    // looking reads 27.5, the owl's eyes read 40.2, a 46% lift with nothing else on the table
    // moved.
    //
    // This used to be read as the near-black the owl's arc takes *off* the frame, because
    // pre-raster the patch could not separate the two states (18.4 against 19.1) while the
    // frame's black could (44.0% → 33.7%). Both halves of that inverted once the mask became a
    // raster tier: the memory tier no longer renders near-black, so `blackOf` is now 1.4%
    // unlit against 2.5% with the owl looking — the darkvision grade is itself the darkest
    // thing on this frame, and the old reading has the sign backwards. The patch is the
    // reading that survived, and it is the more direct one.
    expect(
      drained.mean,
      `darkvision read ${drained.mean.toFixed(1)} on the ground that reads ` +
        `${dark.mean.toFixed(1)} with no eyes on it`,
    ).toBeGreaterThan(dark.mean * 1.2)
    // …but not as light: a lit room still reads as the brighter thing (131.4 torchlit).
    expect(drained.mean).toBeLessThan(lit.mean)
    // …and not as colour, which is the half a dimming alone would fail (art guide: night is
    // desaturated, and the glows do the colour work). 16.9 against torchlight's 62.9.
    expect(
      drained.chroma,
      `darkvision chroma ${drained.chroma.toFixed(1)} against torchlight's ${lit.chroma.toFixed(1)}`,
    ).toBeLessThan(lit.chroma / 2)

    // The frame the treatment was judged on: a torch pool and a darkvision area at once.
    torchId = await place(dm, { name: 'Torchbearer', x: 3.5, y: 3.5, sight: null, light: TORCH })
    await expect.poll(async () => (await look(player)).lit).toBeGreaterThan(0.005)
    await player.waitForTimeout(REVEAL_MS * 2)
    writeFileSync(join(import.meta.dirname, '../test-results/p3-darkvision.png'), await shoot(player))
  })

  test('the ambient dial moves the canvas live, with nothing on the board moving', async () => {
    const before = await read(player)
    const night = await shoot(player)
    const nightAgain = await shoot(player)
    const noise = await changed(player, night, nightAgain)
    await expect(player.getByTestId('env-badge')).toHaveText(/^Darkness/)

    await command(dm, 'triggers', 'set-environment', { ambient: 'daylight' })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    await player.waitForTimeout(REVEAL_MS * 2)
    const day = await shoot(player)
    const moved = await changed(player, nightAgain, day)

    record(
      'a live ambient flip on the player canvas',
      `${(moved * 100).toFixed(2)}% of the canvas moved on the dial alone (still frame to ` +
        `still frame: ${(noise * 100).toFixed(2)}%), ${show(await develop(player, day))}`,
      'no reload, no token moved, no door touched',
    )

    expect(moved, 'the dial changed nothing on the player canvas').toBeGreaterThan(noise + 0.01)
    // Daylight *dialled by the DM* is not the same state as a table nobody has touched, and
    // since the world clock (#100) the badge says which: an explicit ambient is an override
    // and reads as one, while only a scene running on the clock alone goes quiet
    // (`world.ts`'s `mirrorOf`, and both halves are pinned in TableStatusBar.test.tsx).
    await expect(player.getByTestId('env-badge')).toHaveText(/^Daylight \(override\)/)

    await command(dm, 'triggers', 'set-environment', { ambient: 'darkness' })
    await expect(player.getByTestId('env-badge')).toHaveText(/^Darkness/)
    await player.waitForTimeout(REVEAL_MS * 2)
    // …and the dial that put it back reads on the canvas: 29.2 against daylight's 34.0 mean.
    // On the mean, not on `lit`: the torch pool this scene is carrying is the only thing above
    // the fog's ceiling either side of the dial, and a torch burns the same in both (10.4%).
    expect((await look(player)).mean).toBeLessThan((await develop(player, day)).mean)
  })

  test('a carried light moves with the token carrying it', async () => {
    const before = await shoot(player)
    const beforeAgain = await shoot(player)
    const noise = await changed(player, before, beforeAgain)

    // Four cells east, which is a whole pool away from where it was standing.
    await command(dm, 'tokens', 'move', { id: torchId, x: 7.5, y: 3.5 })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(0)
    await player.waitForTimeout(REVEAL_MS * 2)
    const after = await shoot(player)
    const moved = await changed(player, beforeAgain, after)
    // The floor the torch *was* standing on, measured after it left: the owl still sees it,
    // so what has to drop is the light on it, not the mask over it.
    const abandoned = await sample(player, after, beforeAgain)

    record(
      'a torch walking away from the ground it lit',
      `${(moved * 100).toFixed(2)}% of the canvas moved (still frame to still frame: ` +
        `${(noise * 100).toFixed(2)}%); the old pool fell to ${showPatch(abandoned)}`,
      'the pool travels with the token, and the ground it leaves goes dark',
    )

    expect(moved, 'the carried light did not move with its token').toBeGreaterThan(noise + 0.005)
    expect(abandoned.mean, 'the ground the torch left behind stayed lit').toBeLessThan(120)
    // The standing gate condition, on the rows this phase added too.
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  // ── S3 P4 — the DM controls, driven as a DM drives them ───────────────────
  // Every row above puts its commands on the wire through the session store, which pins the
  // referee. These two pin the *chrome*: the panel, the segmented control, the armed tool and
  // a real pointer dragged across the canvas. A panel that dispatched the wrong payload, or a
  // brush whose cell arithmetic disagreed with the server's frame, would pass every row above
  // and fail here — which is exactly the seam P4 adds.

  /** Where a world point is on the DM's canvas right now, in page coordinates. */
  function pointAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
    return page.evaluate(
      ([wx, wy]: number[]) => {
        const probe = (
          window as Window & { __fogProbe?: { screenOf(x: number, y: number): { x: number; y: number } } }
        ).__fogProbe
        if (!probe) throw new Error('no fog probe on this seat — rebuild')
        const canvas = document.querySelector('[data-testid="game-canvas"] canvas')
        if (!canvas) throw new Error('no canvas to brush on')
        const rect = canvas.getBoundingClientRect()
        const at = probe.screenOf(wx, wy)
        return { x: rect.left + at.x, y: rect.top + at.y }
      },
      [x, y],
    )
  }

  /** One brush stroke along a row of cell centres, as a pointer actually makes it. */
  async function brush(page: Page, from: [number, number], to: [number, number]): Promise<void> {
    const a = await pointAt(page, ...from)
    const b = await pointAt(page, ...to)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.mouse.up()
  }

  test('the DM drives the panel: mode, the armed tool, and a brush stroke the player sees', async () => {
    // Back to daylight and to one pair of eyes far from the far hall, so what this row reads
    // is the brush and nothing else. The torch and the owl are the previous rows' props.
    await command(dm, 'triggers', 'set-environment', { ambient: 'daylight' })
    await command(dm, 'tokens', 'hide', { id: torchId, hidden: true })
    await command(dm, 'tokens', 'hide', { id: owlId, hidden: true })
    await command(dm, 'tokens', 'move', { id: scout, ...AWAY })
    await expect.poll(async () => (await read(player)).sources).toBe(1)

    // The mode, off the segmented control — both ways, so the control is not write-once.
    await openPanel(dm, 'fog')
    const mode = dm.getByTestId('fog-mode')
    await mode.getByRole('radio', { name: 'Rooms' }).click()
    await expect.poll(async () => (await probe(player))?.mode).toBe('rooms')
    await mode.getByRole('radio', { name: 'Vision' }).click()
    await expect.poll(async () => (await probe(player))?.mode).toBe('vision')

    // Arm the tool, then the brush — a sub-mode of it, which the indicator has to say.
    // `fog-tool-toggle` (the Reveal button) arms the tool by itself now; `fog-bar` is simply
    // visible whenever the popover is, with no separate "arm" step in front of it.
    await dm.getByTestId('fog-tool-toggle').click()
    await dm.getByTestId('fog-brush').click()
    await expect(dm.getByTestId('active-tool')).toContainText('Fog · Brush')

    // Rub the map back to void, so what the brush paints is the only thing on it. The rooms
    // go under as well as the cells: an earlier row revealed the far hall by hand, and a
    // room the DM has lit is washed whole — four more cells inside it would change nothing.
    for (const room of [NEAR, FAR]) {
      await command(dm, 'fog', 'hide', { roomId: room.id })
      await command(dm, 'fog', 'region-set', { op: 'hide', cells: await cellsOf(player, room) })
    }
    await player.waitForTimeout(REVEAL_MS * 3)
    const before = await read(player)
    const dark = await shoot(player)

    // Four cell centres along one row of the far hall, which nobody is looking at. In its LEFT
    // half, not across its centre: the Fog popover this stroke is armed from is an overlay on
    // the map since M3 and measures 320×333 at x=894, and the old row's last two cell centres
    // (918 and 965 on this camera) landed under it — the pointer moved onto the panel mid-drag
    // and the stroke painted 2 of its 4 cells. These four sit at 682–824, clear of it.
    const [row, first] = [FAR.centroid[1] + 0.5, Math.floor(FAR.centroid[0]) - 4.5]
    await brush(dm, [first, row], [first + 3, row])

    // Exactly four cells: the panel's op, the overlay's arithmetic and the server's frame all
    // agreeing about which squares those were. One off in any of them and this is not 4.
    await expect
      .poll(async () => (await read(player)).cells - before.cells, { timeout: 5000 })
      .toBe(4)
    await player.waitForTimeout(REVEAL_MS * 4)
    const painted = await shoot(player)
    const moved = await changed(player, dark, painted)

    record(
      'a real brush stroke on the DM canvas, read off the player seat',
      `4 cell(s) painted through the panel; ${(moved * 100).toFixed(2)}% of the player canvas ` +
        `moved (${show(await develop(player, dark))} → ${show(await develop(player, painted))})`,
      'the cells the DM painted, and no room around them',
    )

    // The player sees them, and sees them as memory — the far hall is latched, never lit.
    expect(moved, 'the brushed cells never reached the player canvas').toBeGreaterThan(0.0005)
    expect(await fogStatus(player, FAR.id)).toBe('re_hidden')

    // Esc leaves the tool, and the brush with it — but the shell's own Esc order (M3 review
    // finding 12) closes an open popover first, so the first press only does that; the
    // second is the one that actually disarms the brush.
    await dm.keyboard.press('Escape')
    await expect(dm.getByTestId('popover')).toHaveCount(0)
    await dm.keyboard.press('Escape')
    await expect(dm.getByTestId('active-tool')).toHaveCount(0)
  })

  /**
   * The row the browser gate was missing: every other row here claims by id down the socket,
   * which is exactly the path a real player cannot take. Claiming is a click on a token in
   * your own list, and in vision mode a seat with no token is sent no tokens at all — so the
   * list is empty and the seat is stranded. The DM's Owner select is the way out, and this
   * row drives it from the DM's panel and reads the answer on the player's.
   */
  test('a seat with no token is not stranded: the DM hands one over from the panel', async () => {
    await command(dm, 'tokens', 'move', { id: scout, ...AT_DOOR })
    await openTokens(dm)
    await dm.getByTestId('token-layer').locator(`[data-token-id="${scout}"] button`).click()
    const owner = dm.getByLabel('Owner')
    await expect(owner).not.toHaveValue('')
    await frameUp(player)

    // Take it away and the player is the seat that joins late: no eyes, so no tokens, so
    // nothing to claim. This is the deadlock, reproduced through the real UI.
    await owner.selectOption('')
    await openTokens(player)
    await expect(player.getByTestId('token-layer').locator('[data-token-id]')).toHaveCount(0)
    await expect(player.getByText('No tokens on this scene.')).toBeVisible()
    await expect.poll(async () => (await read(player)).sources).toBe(0)
    await player.waitForTimeout(REVEAL_MS * 4)
    const stranded = await look(player)
    const strandedFloor = await patchRead(player, NEAR_PATCH)

    // One select on the DM's panel, and the seat has a token and a pair of eyes again.
    await owner.selectOption({ label: 'Borin' })
    await expect(
      player.getByTestId('token-layer').locator(`[data-token-id="${scout}"]`),
    ).toHaveCount(1)
    await expect.poll(async () => (await read(player)).sources).toBe(1)
    await player.waitForTimeout(REVEAL_MS * 4)
    const handed = await look(player)
    const handedFloor = await patchRead(player, NEAR_PATCH)

    record(
      'the DM assignment (Owner select → the player’s panel and mask)',
      `unassigned: no tokens listed, 0 sight source(s), ${show(stranded)}, the hall's floor at ` +
        `${meanOf(strandedFloor).toFixed(1)} → assigned: 1 token, 1 sight source, ${show(handed)}, ` +
        `the floor at ${meanOf(handedFloor).toFixed(1)}`,
      'a player with no token can be handed one, and it lights their mask',
    )
    // A new mask arrived with the token: with no eyes on it the hall is a memory — the floor
    // under the explored wash — and with one pair it is live, the floor as rendered. Read on
    // the floor around the token rather than over the frame: since the memory tier became the
    // map under a thin haze, whole-frame shares no longer tell the two masks apart (the old
    // reading counted a memory's near-black floor; it is not near-black any more). Nothing
    // else on this table moved.
    expect(
      meanOf(handedFloor),
      `the handed token lit the floor to ${meanOf(handedFloor).toFixed(1)} against ` +
        `${meanOf(strandedFloor).toFixed(1)} with no eyes on it`,
    ).toBeGreaterThan(meanOf(strandedFloor) * 1.1)
  })

  test('the DM edits Sight & light on the panel and the player’s mask follows', async () => {
    await command(dm, 'tokens', 'move', { id: scout, ...AT_DOOR })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(0)
    // In the dark: sight is line of sight to the whole map, so the one number on the panel
    // that still shapes the mask is a darkvision eye's range, and only with the lights out.
    await command(dm, 'triggers', 'set-environment', { ambient: 'darkness' })
    await expect(player.getByTestId('env-badge')).toHaveText(/^Darkness/)

    // The panel, on the scout: the authored 40 ft (8 cells) of sight.
    await openTokens(dm)
    await dm.getByTestId('token-layer').locator(`[data-token-id="${scout}"] button`).click()
    await expect(dm.getByTestId('token-sight')).toBeVisible()
    await expect(dm.getByLabel('Sight range')).toHaveValue('40')
    await dm.getByLabel('Vision mode').selectOption('darkvision')
    await expect
      .poll(() =>
        dm.evaluate((id: string) => {
          const store = (
            window as unknown as {
              __sessionStore?: {
                getState(): { session?: { activeSceneId?: string; modules?: Record<string, unknown> } }
              }
            }
          ).__sessionStore
          const state = store?.getState()
          const scene = state?.session?.activeSceneId
          const tokens = state?.session?.modules?.tokens as
            | { byScene?: Record<string, Record<string, { sight?: { visionMode?: string } }>> }
            | undefined
          return (scene ? tokens?.byScene?.[scene]?.[id]?.sight?.visionMode : null) ?? null
        }, scout),
      )
      .toBe('darkvision')

    // The hall's far corner, three to six cells from the scout: inside an 8-cell ring, past
    // the end of a 2-cell one — where it is a memory (the floor, a step dimmer), since the
    // party has stood here.
    const CORNER: [number, number, number, number] = [0.5, 0.5, 2.5, 2.5]
    await frameUp(player)
    await player.bringToFront()
    await expect.poll(async () => meanOf(await patchRead(player, CORNER))).toBeGreaterThan(20)
    const wide = await patchRead(player, CORNER)

    // 10 ft, typed on the panel and committed on blur.
    await dm.getByLabel('Sight range').fill('10')
    await dm.getByLabel('Sight range').blur()
    await expect
      .poll(async () => meanOf(await patchRead(player, CORNER)))
      .toBeLessThan(meanOf(wide) * 0.9)
    const narrow = await patchRead(player, CORNER)

    record(
      'a sight range edited on the panel, measured on the player canvas',
      `the hall's corner read ${meanOf(wide).toFixed(1)} under 40 ft of darkvision and ` +
        `${meanOf(narrow).toFixed(1)} under 10 ft`,
      'a smaller eye is a smaller mask, off the panel alone',
    )
    // Dimmer — and still the floor: what the ring no longer reaches is remembered, not void.
    expect(meanOf(narrow), `40 ft read ${meanOf(wide).toFixed(1)}, 10 ft ${meanOf(narrow).toFixed(1)}`).toBeLessThan(
      meanOf(wide) * 0.9,
    )
    expect(meanOf(narrow)).toBeGreaterThan(meanOf(wide) * 0.5)

    // Put the table back the way the rows below expect it: a normal 40 ft eye by daylight.
    await dm.getByLabel('Sight range').fill('40')
    await dm.getByLabel('Sight range').blur()
    await dm.getByLabel('Vision mode').selectOption('normal')
    await command(dm, 'triggers', 'set-environment', { ambient: 'daylight' })
    await expect(player.getByTestId('env-badge')).toHaveText(/^Daylight/)

    // The standing gate condition, on the rows this phase added too.
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
  /**
   * The DM's sight preview: one token's eyes drawn on the DM's own canvas, and nothing else.
   * The DM's seat draws no mask at all (principle 3), so the whole frame starts "clear"; with
   * the preview on, only what the scout can see is. The player's canvas is the other half of
   * the claim — the flag is local to the DM's tab, so their frame reads the same before and
   * after, to the living fog's own drift.
   */
  test('the DM previews one token’s sight on their own canvas and the player’s does not move', async () => {
    await openTokens(dm)
    await dm.getByTestId('token-layer').locator(`[data-token-id="${scout}"] button`).click()
    const toggle = dm.getByTestId('token-preview-sight')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await frameUp(player)
    const playerBefore = await look(player)
    await frameUp(dm)
    const dmBefore = await look(dm)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // The DM's mask is a rebuild like any other: wait for its frame, then read both seats.
    await dm.waitForTimeout(REVEAL_MS * 3)
    const dmAfter = await look(dm)
    const playerAfter = await look(player)

    record(
      'the DM’s sight preview, measured on both canvases',
      `DM ${show(dmBefore)} → ${show(dmAfter)} with the scout’s sight previewed; ` +
        `player ${show(playerBefore)} → ${show(playerAfter)} over the same beat`,
      'the DM sees what one token sees; the player sees what they saw',
    )
    // The DM's frame goes from the whole map clear to the scout's sweep — a drop of several
    // percent of the frame at least, against a whole-frame drift well under one.
    expect(dmAfter.clear, `DM ${show(dmBefore)} → ${show(dmAfter)}`).toBeLessThan(
      dmBefore.clear - 0.05,
    )
    // …and the player's does not move beyond the clouds' own drift between two reads.
    expect(
      Math.abs(playerAfter.clear - playerBefore.clear),
      `player ${show(playerBefore)} → ${show(playerAfter)}`,
    ).toBeLessThan(0.01)

    // Off again: the DM's canvas is the DM's again.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await dm.waitForTimeout(REVEAL_MS * 3)
    expect((await look(dm)).clear).toBeGreaterThan(dmAfter.clear + 0.05)

    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})
