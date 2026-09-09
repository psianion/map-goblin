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
  /** Fraction of pixels the fog is not covering, by whatever colour it currently paints. */
  clear: number
}

/**
 * Read `__fogProbe`'s visibility flag — this seat's real fog state right now, set by
 * `rebuild`'s own `scene.isPlayer || scene.preview`, never by a test.
 */
function fogVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const p = (window as Window & { __fogProbe?: { visible(): boolean } }).__fogProbe
    if (!p) throw new Error('no fog probe on this seat — rebuild')
    return p.visible()
  })
}

/** Force the fog layer on or off for one render. Always paired with a restore below it. */
function setFogVisible(page: Page, shown: boolean): Promise<void> {
  return page.evaluate((v: boolean) => {
    const p = (window as Window & { __fogProbe?: { setVisible(v: boolean): void } }).__fogProbe
    if (!p) throw new Error('no fog probe on this seat — rebuild')
    p.setVisible(v)
  }, shown)
}

/** One real paint before a screenshot reads it — a toggled `.visible` needs Pixi's ticker to
 *  actually draw the new tree, not just flip the flag. Two frames, not one: the first is the
 *  frame *in flight* when the flag changed. */
function nextFrame(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

/**
 * What the canvas looked like, as three numbers — and two questions, not one.
 *
 * This read a single 120/255 floor until #101, then a luminance band calibrated to the
 * cloud's own colour (measured 22.0–59.1/255 on a frame that was nothing but fog) once #101
 * made the fog the one thing on this canvas with a bounded colour. Both are gone now for the
 * same reason: the fog's palette is not a fixed thing to calibrate a band to any more — a
 * shader rewrite in flight on this same branch is repainting it pale, and whatever band this
 * file picked would be reading the wrong cloud by the time it landed.
 *
 * What survives any palette is simpler: the cloud draws something over a pixel it is
 * covering and nothing over one it is not. So `develop` is handed two shots of the *same*
 * still frame — one as the seat naturally renders it, one with the fog layer forced off by
 * `__fogProbe.setVisible` (`look`, below, is what takes the pair) — and reads a pixel `clear`
 * where the two agree, because that is a pixel the fog was never touching. `lit` narrows that
 * to ground bright enough for a light to be the reason, the same 64 gate as before — the lit
 * question was always about the ground under the cloud, never the cloud's own colour, and
 * forcing the cloud off for the second shot is what lets it stay one.
 *
 *   `clear` — the fog-off shot and the natural one agree within a few levels of noise — is
 *   "the fog is not covering this pixel": ground the seat has earned, whether a light reaches
 *   it or not. A seat that has swept nothing reads 0.000%; one swept hall reads ~15%.
 *   `lit` — clear, and over 64 on the natural shot — is "a light reaches this pixel", the
 *   question the §4 rows about the ambient dial, a torch and darkvision are actually asking.
 */
function develop(page: Page, shown: Buffer, hidden: Buffer): Promise<Look> {
  return page.evaluate(
    async ([shownUrl, hiddenUrl]: [string, string]) => {
      const pixelsOf = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob())
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [natural, unmasked] = await Promise.all([pixelsOf(shownUrl), pixelsOf(hiddenUrl)])
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      // Screenshot round-trip noise on an otherwise identical frame, measured on this map at
      // ~1-2 levels (PNG requantisation); 10 is 5x that, well under the cloud's own dimming
      // (`livingFog.ts`'s `uDense`/`uMist` are a much bigger step than encode noise on any
      // palette that fog paints).
      const COVER_EPSILON = 10
      let sum = 0
      let lit = 0
      let clear = 0
      for (let i = 0; i < natural.length; i += 4) {
        const naturalL = luminance(natural, i)
        const offL = luminance(unmasked, i)
        sum += naturalL
        if (Math.abs(naturalL - offL) > COVER_EPSILON) continue
        clear++
        // The fog-OFF frame's own luminance — a light reaching the ground — never the
        // fog-on one: the two are within COVER_EPSILON of each other here by construction,
        // but pale mist's veil is exactly the few points near 64 that land on the wrong
        // side of it if the natural frame is asked instead of the ground underneath it.
        if (offL > 64) lit++
      }
      const pixels = natural.length / 4
      return { mean: sum / pixels, lit: lit / pixels, clear: clear / pixels }
    },
    [
      `data:image/png;base64,${shown.toString('base64')}`,
      `data:image/png;base64,${hidden.toString('base64')}`,
    ] as [string, string],
  )
}

/**
 * One frame, both ways: the seat's natural render, then the same frame with the fog forced
 * off and back — `setVisible` never decides which is natural, it is handed whatever
 * `fogVisible` read a moment before, so a DM seat that draws no fog at all gets two identical
 * shots (and reads ~100% clear, correctly) and a previewing DM's masked one gets a real pair.
 */
async function look(page: Page): Promise<Look> {
  const shown = await shoot(page)
  const natural = await fogVisible(page)
  await setFogVisible(page, false)
  await nextFrame(page)
  const hidden = await shoot(page)
  await setFogVisible(page, natural)
  await nextFrame(page)
  return develop(page, shown, hidden)
}

/**
 * `look`, restricted to one room's own screen box instead of the whole canvas — the box found
 * through the probe's `screenOf`, `patchRead`'s coordinate path, at the room's own world
 * bounding corners. Needed once a whole-frame `clear` share stops separating "a doorway's
 * sliver of swept cells" from "the DM's whole-room reveal": both are a few points of the
 * *frame*, so a wash next door or the cloud's own drift can swamp the gap between them. Scoped
 * to the room the row is actually asking about, the same two states read apart.
 */
async function regionLook(page: Page, box: [number, number, number, number]): Promise<Look> {
  const shownBuf = await shoot(page)
  const natural = await fogVisible(page)
  await setFogVisible(page, false)
  await nextFrame(page)
  const hiddenBuf = await shoot(page)
  await setFogVisible(page, natural)
  await nextFrame(page)
  return page.evaluate(
    async ([shownUrl, hiddenUrl, x0, y0, x1, y1]: [string, string, number, number, number, number]) => {
      const probe = (
        window as Window & { __fogProbe?: { screenOf(x: number, y: number): { x: number; y: number } } }
      ).__fogProbe
      if (!probe) throw new Error('no fog probe on this seat — rebuild')
      const canvas = document.querySelector('[data-testid="game-canvas"] canvas') as HTMLCanvasElement
      const pixelsOf = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob())
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [natural, unmasked] = await Promise.all([pixelsOf(shownUrl), pixelsOf(hiddenUrl)])
      const sx = natural.width / canvas.clientWidth
      const sy = natural.height / canvas.clientHeight
      const corners = [probe.screenOf(x0, y0), probe.screenOf(x1, y0), probe.screenOf(x0, y1), probe.screenOf(x1, y1)]
      const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) * sx))
      const right = Math.min(natural.width, Math.ceil(Math.max(...corners.map((c) => c.x)) * sx))
      const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) * sy))
      const bottom = Math.min(natural.height, Math.ceil(Math.max(...corners.map((c) => c.y)) * sy))
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      const COVER_EPSILON = 10
      let sum = 0
      let lit = 0
      let clear = 0
      let count = 0
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const i = (y * natural.width + x) * 4
          const naturalL = luminance(natural.data, i)
          const offL = luminance(unmasked.data, i)
          sum += naturalL
          count++
          if (Math.abs(naturalL - offL) > COVER_EPSILON) continue
          clear++
          if (offL > 64) lit++
        }
      }
      return { mean: count ? sum / count : 0, lit: count ? lit / count : 0, clear: count ? clear / count : 0 }
    },
    [
      `data:image/png;base64,${shownBuf.toString('base64')}`,
      `data:image/png;base64,${hiddenBuf.toString('base64')}`,
      ...box,
    ] as [string, string, number, number, number, number],
  )
}

/** `.mean` alone, off a shot already taken for another reason — no fog toggle, since mean
 *  never depended on the cloud's colour to begin with. */
function luminanceMean(page: Page, shot: Buffer): Promise<number> {
  return page.evaluate(async (url: string) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = surface.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    return sum / (data.length / 4)
  }, `data:image/png;base64,${shot.toString('base64')}`)
}
const show = (l: Look) =>
  `mean ${l.mean.toFixed(1)}/255, ${(l.clear * 100).toFixed(1)}% clear of fog, ` +
  `${(l.lit * 100).toFixed(1)}% lit`

/**
 * The cover at a grid of world points, read off two shots of the canvas — the seat's natural
 * render and the same frame with the fog forced off, `look`'s own pair — through the probe's
 * `screenOf`, so two shots with different cameras (a reload re-fits) still read the same
 * ground. Quarter-cell steps: enough of the floor's texture to correlate on. At every grid
 * point, `delta` is |natural − fog-off| — the same pair `develop` reads over the whole frame —
 * and `floor` is the fog-off half alone, the map's own paint with no fog on it. `delta` is what
 * "how covered is this patch" means once the palette is not fixed: it reads near-zero over live
 * ground (at most `uVeil`'s thin wash), a clear step up over remembered ground (the mist tier),
 * and larger still over ground the client draws no geometry for at all. `floor` is what "the
 * same floor" means when two patches' `delta` reads apart — the ground underneath is identical;
 * only what is painted over it differs.
 */
async function patchCover(
  page: Page,
  box: [number, number, number, number],
): Promise<{ delta: number[]; floor: number[] }> {
  const natural = await fogVisible(page)
  const shownBuf = await shoot(page)
  await setFogVisible(page, false)
  await nextFrame(page)
  const hiddenBuf = await shoot(page)
  await setFogVisible(page, natural)
  await nextFrame(page)
  return page.evaluate(
    async ([shownUrl, hiddenUrl, x0, y0, x1, y1]: [string, string, number, number, number, number]) => {
      const probe = (
        window as Window & { __fogProbe?: { screenOf(x: number, y: number): { x: number; y: number } } }
      ).__fogProbe
      if (!probe) throw new Error('no fog probe on this seat — rebuild')
      const canvas = document.querySelector('[data-testid="game-canvas"] canvas') as HTMLCanvasElement
      const pixelsOf = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob())
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [shown, hidden] = await Promise.all([pixelsOf(shownUrl), pixelsOf(hiddenUrl)])
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      const sx = shown.width / canvas.clientWidth
      const sy = shown.height / canvas.clientHeight
      const delta: number[] = []
      const floor: number[] = []
      for (let y = y0; y < y1; y += 0.25) {
        for (let x = x0; x < x1; x += 0.25) {
          const at = probe.screenOf(x, y)
          const i = (Math.round(at.y * sy) * shown.width + Math.round(at.x * sx)) * 4
          const shownL = luminance(shown.data, i)
          const hiddenL = luminance(hidden.data, i)
          delta.push(Math.abs(shownL - hiddenL))
          floor.push(hiddenL)
        }
      }
      return { delta, floor }
    },
    [
      `data:image/png;base64,${shownBuf.toString('base64')}`,
      `data:image/png;base64,${hiddenBuf.toString('base64')}`,
      ...box,
    ] as [string, string, number, number, number, number],
  )
}

const meanOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

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
    const before = await look(player)

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
    const after = await look(player)

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
  /** A room's own world-space bounding box, for `regionLook`'s scoped read. */
  const boxOf = (room: Room): [number, number, number, number] => {
    const xs = room.boundary.map((p) => p[0])
    const ys = room.boundary.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  /** The far hall's own bounding box, in world coordinates — `regionLook`'s scoped read. */
  const FAR_BOX: [number, number, number, number] = boxOf(FAR)
  /** …and the near hall's, for the seat-handoff row: a whole-seat question ("is this player
   *  seeing anything at all") belongs on a whole-room read, not a per-point patch — a patch
   *  beside one token answers a narrower question than the row is actually asking, and reads
   *  a smaller, noisier gap for it (measured 6.6 → 1.3 shrinking across four builds). */
  const NEAR_BOX: [number, number, number, number] = boxOf(NEAR)

  test('what the party swept is a memory: the same floor, dimmed — and void is not', async () => {
    // In front, so the canvas actually repaints between the four shots below: a background
    // page's ticker is paused, and a screenshot of a paused canvas is the last frame it drew.
    await player.bringToFront()
    await frameUp(player)
    const looking = await look(player)
    const live = await patchCover(player, FAR_STRIP)

    // The door shuts behind them — the far hall is remembered now, not seen.
    const before = await read(player)
    await command(dm, 'doors', 'toggle', { id: DOOR.id })
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'false')
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    await player.waitForTimeout(REVEAL_MS * 4)
    const away = await look(player)
    const memory = await patchCover(player, FAR_STRIP)
    const remembered = await read(player)

    await player.reload()
    await assertMapLoaded(player, VISION)
    await expect.poll(async () => (await probe(player))?.mode).toBe('vision')
    await frameUp(player)
    const reloaded = await look(player)
    const back = await patchCover(player, FAR_STRIP)

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
    const gone = await patchCover(player, FAR_STRIP)

    record(
      'the memory tier across a look-away, a reload and a region-hide',
      `looking ${show(looking)} → door shut ${show(away)} → reloaded ${show(reloaded)} → ` +
        `room hidden and cells rubbed out ${show(blanked)} (${remembered.cells} swept cell(s)); ` +
        `the strip inside the doorway, cover (natural vs fog-off luminance delta): live ` +
        `${meanOf(live.delta).toFixed(1)} → memory ${meanOf(memory.delta).toFixed(1)} → reloaded ` +
        `${meanOf(back.delta).toFixed(1)} → void ${meanOf(gone.delta).toFixed(1)}; the floor ` +
        `underneath: live ${meanOf(live.floor).toFixed(1)}, memory ${meanOf(memory.floor).toFixed(1)}`,
      'void covered more than memory, memory covered more than live, live and memory share one floor',
    )

    // Cover, not colour, once a bright memory tier stopped reading darker than live ground —
    // pale mist over unlit floor is *brighter*, so the old "memory dimmer than live" luminance
    // claim inverted by design (docs/mockups/2026-09-09-fog-current-vs-living.html, accepted).
    // What survives any palette is how much the fog-on frame disagrees with the fog-off one:
    // live carries at most the thin veil (uVeil 0.22), memory a heavier mist tier, void the
    // opaque hidden tier (alpha exactly 1) or no geometry at all. Measured on this strip
    // 2026-09-09: live delta 11.3, memory 117.3, void 144.0 — margins are under half of both
    // gaps (106.0 and 26.7), well clear of the ~1-2 level PNG round-trip noise `develop`
    // documents for the same instrument.
    expect(
      meanOf(memory.delta),
      `memory delta ${meanOf(memory.delta).toFixed(1)} against live's ${meanOf(live.delta).toFixed(1)}`,
    ).toBeGreaterThan(meanOf(live.delta) + 15)
    expect(
      meanOf(gone.delta),
      `void delta ${meanOf(gone.delta).toFixed(1)} against memory's ${meanOf(memory.delta).toFixed(1)}`,
    ).toBeGreaterThan(meanOf(memory.delta) + 10)
    // "The same floor": live and memory are one location read twice, fog subtracted — so the
    // ground underneath has to agree regardless of what the fog painted over it. The tolerance
    // is the same 10-level `COVER_EPSILON` `develop` already treats as one frame's round-trip
    // noise.
    expect(
      Math.abs(meanOf(memory.floor) - meanOf(live.floor)),
      `memory floor ${meanOf(memory.floor).toFixed(1)} against live's ${meanOf(live.floor).toFixed(1)}`,
    ).toBeLessThan(10)
    // The reload keeps it — the record is the server's and the mask rebuilds from it.
    expect(Math.abs(meanOf(back.delta) - meanOf(memory.delta))).toBeLessThan(meanOf(memory.delta) * 0.15)
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
    const partial = await regionLook(player, FAR_BOX)

    // The wire says what the canvas says: a sweep latches a room, it does not light it.
    expect(await fogStatus(player, FAR.id)).toBe('re_hidden')

    // The DM's own reveal — the whole-room wash, and the only thing that is one.
    await command(dm, 'fog', 'reveal', { roomId: FAR.id })
    await expect.poll(() => fogStatus(player, FAR.id)).toBe('revealed')
    await player.waitForTimeout(REVEAL_MS * 4)
    const washed = await regionLook(player, FAR_BOX)

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
    // On `clear`, still, but read over FAR's own screen box now rather than the whole 1280×720
    // frame: the sliver and the wash are both a few points of the *frame*, so a wash next
    // door or the cloud's own drift can swamp a whole-frame reading (the fixed test read
    // 7.92% before and after a reveal that plainly changed the room — the rest of the frame,
    // not this room, was moving the whole-frame share). Scoped to the room, the two separate:
    // measured 2026-09-09, partial 0.7% clear against washed 32.4% — the margin is under a
    // third of that gap.
    expect(
      washed.clear,
      `the swept sliver read ${show(partial)} and the DM's whole-room reveal ${show(washed)} — ` +
        'a mask washing every explored room whole reads them the same',
    ).toBeGreaterThan(partial.clear + 0.1)
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
   * Re-measured 2026-09-01 for containment (default-on) and the doubled `FOG_FEATHER`
   * (`FogRenderer.ts`'s PENDING note): three runs on this two-hall map, one token move, one
   * eye — 4.50ms, 2.50ms, 2.60ms to build. The bound stays 16ms unchanged: even the worst of
   * the three is a third of it, so a small map under both changes is nowhere near a frame and
   * the discipline check still means what it says.
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
    // Pitch dark is pitch dark: nothing on the frame is at light-source brightness. 0.02%
    // measured (152px), which is the scout's own disc and the door's furniture.
    expect(blind.lit, `the dark still drew ${show(blind)}`).toBeLessThan(0.005)
    // The torch opens a pool — and only a pool: 1.1% of the frame at light-source brightness
    // (10,046px of 1224×720), against 0.02% in the dark a moment earlier. The old reading was
    // 10.6%, and the drop is the fade, not a lost pool: the vector pipeline left the torch's
    // whole *dim* skirt unattenuated, so all four cells of it cleared the 64 gate, while the
    // raster tier composites the cloud back over the skirt and only the two-cell *bright*
    // radius survives — which is what "at light-source brightness" was always meant to read.
    // The frame agrees: placing the torch moves 5.5% of the canvas (the dim reach), and
    // (2/4)² of that is 1.4%, the bright disc this now measures. It is not the 64 gate
    // clipping a pool that is still there — the 48–64 band barely moves (0.46% → 0.58%)
    // while the pool's own falloff runs 64 up to 144 with its mass in the core, and the row
    // below reads the same pool over 120 at an ample 5,100 pixels.
    //
    // What this bound catches: a torch that lights nothing on the player's seat — the light
    // gate refusing a source inside the vision mask, or the raster tier compositing the pool
    // away — which drops `lit` back to the dark frame's 0.02%. Measured delta 1.12 points on
    // two runs that agreed to a single pixel; the bound is 0.8, so ~30× the frame-to-frame
    // drift this map's clouds show, and still above the settle poll's 0.005 above.
    expect(pool.lit, `the torch lit nothing: ${show(blind)} → ${show(pool)}`).toBeGreaterThan(
      blind.lit + 0.008,
    )
    expect(pool.lit, `the torch lit ${show(pool)} against the sweep's ${show(seeing)}`)
      .toBeLessThan(pool.clear)
    // …while the DM never loses the map (principle 3): darkness is something they stage.
    // Asserted as a direction now, not as a tolerance on the mean. The tolerance was ±10% and
    // the measurement is 16.9 → 22.7 — but that 5.8 is the torch, which is a real light on a
    // real map the DM is looking straight at, and a bound wide enough to allow it says
    // nothing. What the claim actually is: the dial did not take the DM's map away (their
    // canvas got *brighter* over a step that blacked the player's out) and the pool is on it
    // (1.2% of their frame at light-source brightness, against 0.04% before the torch — the
    // old 8.0% was the dim skirt the vector pipeline left unattenuated, for the reason the
    // player's own reading above gives).
    expect(
      dmDark.mean,
      `the DM's canvas went dark with the room: ${show(dmSeeing)} → ${show(dmDark)}`,
    ).toBeGreaterThan(dmSeeing.mean)
    // What this bound catches: the torch pool reaching the player's masked tier but never the
    // DM's own canvas — the dial blacking the DM out with the room, against principle 3. That
    // failure reads the pre-torch 0.04%. Measured 1.17%, bit-identical on two runs, so the
    // 0.8 bound sits at 1.5× under the reading and 20× over the failure it separates from.
    expect(dmDark.lit, `the DM lost the torch pool: ${show(dmDark)}`).toBeGreaterThan(0.008)
  })

  /** The torch's own bright radius (2 cells) around `AT_DOOR`, where it stood for this row. */
  const TORCH_PATCH: [number, number, number, number] = [
    AT_DOOR.x - 1,
    AT_DOOR.y - 1,
    AT_DOOR.x + 1,
    AT_DOOR.y + 1,
  ]

  /**
   * §4 — the drained grade, read as cover now: `sample`'s raw luminance (masked at >120 on the
   * torchlit frame) is the same doctrine the memory-tier rows above broke pale mist against —
   * it just never ran before, because those two failed first and left every row below them
   * skipped in this serial block.
   *
   * Cover survives the palette: darkvision is sight without a light, so the patch drops to a
   * live-tier delta the moment the owl claims it — well under the no-light tier it sat at with
   * only a normal eye nearby and no torch (the ambient dial's own rule, pinned two rows up: a
   * normal eye needs a light, so with none this patch falls back to whatever it was before,
   * never all the way to true void since the party swept it in `beforeAll`). "No torch warmth"
   * is a claim about the ground itself, not the fog on top of it, so it is read off the fog-off
   * floor — a real light's glow renders into the floor's own luminance whether or not fog sits
   * over it, and darkvision adds no such glow.
   */
  test('darkvision reads shape without colour — above the void, under the torchlight', async () => {
    const lit = await patchCover(player, TORCH_PATCH)

    // The same ground with the torch gone: no light, and only a normal eye nearby (darkness is
    // still dialled from the row above) — the no-light tier this row's floor is over.
    await command(dm, 'tokens', 'delete', { id: torchId })
    await expect.poll(async () => (await look(player)).lit).toBeLessThan(0.005)
    await player.waitForTimeout(REVEAL_MS * 2)
    const dark = await patchCover(player, TORCH_PATCH)

    // …and again, seen by an owl's eyes alone. Nothing is burning anywhere on this map.
    owlId = await place(dm, {
      name: 'Owl',
      ...AT_DOOR,
      sight: { range: 8, angle: 360, visionMode: 'darkvision' },
    })
    await command(player, 'tokens', 'claim', { id: owlId })
    await expect.poll(async () => (await read(player)).sources).toBe(2)
    await player.waitForTimeout(REVEAL_MS * 2)
    const drained = await patchCover(player, TORCH_PATCH)

    record(
      'the darkvision grade against torchlight and the no-light tier, as cover and floor',
      `cover (natural vs fog-off delta): torchlit ${meanOf(lit.delta).toFixed(1)} → no light ` +
        `${meanOf(dark.delta).toFixed(1)} → darkvision ${meanOf(drained.delta).toFixed(1)}; the floor ` +
        `underneath: torchlit ${meanOf(lit.floor).toFixed(1)}, darkvision ${meanOf(drained.floor).toFixed(1)}`,
      'darkvision covers far less than the no-light tier, and its floor carries none of the torch’s glow',
    )

    // Shape: darkvision is sight, not memory. The gap moves with the light-pool shader (6.2
    // to 17.2 measured across two builds this session, both a real "no light" tier over
    // darkvision's near-zero) so the margin is pinned to the smaller of the two rather than
    // to one run: measured 2026-09-1x no light 6.5, darkvision 0.3.
    expect(
      meanOf(drained.delta),
      `darkvision delta ${meanOf(drained.delta).toFixed(1)} against no light's ${meanOf(dark.delta).toFixed(1)}`,
    ).toBeLessThan(meanOf(dark.delta) - 3)
    // …but carries none of a real light's glow: the ground's own luminance with no fog on it is
    // the fact of whether a light lands there. Measured torchlit floor 121.8 against
    // darkvision's 51.3, a gap of 70.5; the margin is under half of it.
    expect(
      meanOf(drained.floor),
      `darkvision floor ${meanOf(drained.floor).toFixed(1)} against torchlit's ${meanOf(lit.floor).toFixed(1)}`,
    ).toBeLessThan(meanOf(lit.floor) - 30)

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
    const dayLook = await look(player)

    record(
      'a live ambient flip on the player canvas',
      `${(moved * 100).toFixed(2)}% of the canvas moved on the dial alone (still frame to ` +
        `still frame: ${(noise * 100).toFixed(2)}%), ${show(dayLook)}`,
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
    expect((await look(player)).mean).toBeLessThan(await luminanceMean(player, day))
  })

  /** The torch's starting position for this row — `darkvision`'s own placement, `x:3.5,y:3.5`. */
  const OLD_POOL: [number, number, number, number] = [2.5, 2.5, 4.5, 4.5]

  test('a carried light moves with the token carrying it', async () => {
    const before = await shoot(player)
    const beforeAgain = await shoot(player)
    const noise = await changed(player, before, beforeAgain)
    // The ground under the torch's starting position, before it moves — the owl still sees
    // it (darkvision needs no light), so this is the same patch `darkvision`'s own "no torch
    // warmth" claim reads, read the same way: off the fog-off floor, not raw luminance.
    const lit = await patchCover(player, OLD_POOL)

    // Four cells east, which is a whole pool away from where it was standing.
    await command(dm, 'tokens', 'move', { id: torchId, x: 7.5, y: 3.5 })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(0)
    await player.waitForTimeout(REVEAL_MS * 2)
    const after = await shoot(player)
    const moved = await changed(player, beforeAgain, after)
    // The floor the torch *was* standing on, measured after it left.
    const abandoned = await patchCover(player, OLD_POOL)

    record(
      'a torch walking away from the ground it lit',
      `${(moved * 100).toFixed(2)}% of the canvas moved (still frame to still frame: ` +
        `${(noise * 100).toFixed(2)}%); the old pool's floor fell from ${meanOf(lit.floor).toFixed(1)} ` +
        `to ${meanOf(abandoned.floor).toFixed(1)}`,
      'the pool travels with the token, and the ground it leaves goes dark',
    )

    expect(moved, 'the carried light did not move with its token').toBeGreaterThan(noise + 0.005)
    // The ground the torch left behind lost the light's glow — read off the fog-off floor, the
    // same instrument `darkvision`'s "no torch warmth" claim uses. Measured 123.2 lit → 50.1
    // abandoned, a gap of 73.1; the margin is under half of it.
    expect(
      meanOf(abandoned.floor),
      `the old pool's floor read ${meanOf(abandoned.floor).toFixed(1)} against ${meanOf(lit.floor).toFixed(1)} lit`,
    ).toBeLessThan(meanOf(lit.floor) - 30)
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
    const darkLook = await look(player)

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
    const paintedLook = await look(player)

    record(
      'a real brush stroke on the DM canvas, read off the player seat',
      `4 cell(s) painted through the panel; ${(moved * 100).toFixed(2)}% of the player canvas ` +
        `moved (${show(darkLook)} → ${show(paintedLook)})`,
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
    const strandedNear = await regionLook(player, NEAR_BOX)

    // One select on the DM's panel, and the seat has a token and a pair of eyes again.
    await owner.selectOption({ label: 'Borin' })
    await expect(
      player.getByTestId('token-layer').locator(`[data-token-id="${scout}"]`),
    ).toHaveCount(1)
    await expect.poll(async () => (await read(player)).sources).toBe(1)
    await player.waitForTimeout(REVEAL_MS * 4)
    const handed = await look(player)
    const handedNear = await regionLook(player, NEAR_BOX)

    record(
      'the DM assignment (Owner select → the player’s panel and mask)',
      `unassigned: no tokens listed, 0 sight source(s), ${show(stranded)}, the near hall ` +
        `${(strandedNear.clear * 100).toFixed(1)}% clear → assigned: 1 token, 1 sight source, ` +
        `${show(handed)}, the near hall ${(handedNear.clear * 100).toFixed(1)}% clear`,
      'a player with no token can be handed one, and it lights their mask',
    )
    // A whole-seat question ("is this player seeing anything") belongs on a whole-room read,
    // the way `sweep-gated first frame` (this file's own test 1) answers the identical question
    // at join: `clear` — the natural/fog-off agreement `develop`/`regionLook` read — over the
    // near hall's own box, not a per-point patch beside one token. A patch answered a narrower
    // question than this row asks and read a small, shrinking gap for it (6.6 → 1.3 across four
    // builds, `patchCover` on `NEAR_PATCH`, since removed).
    //
    // Stranded is not near 0% the way test 1's virgin table is, and measuring it caught why: a
    // room's *bounding box* is not the room — `NEAR`'s polygon is not a rectangle, so `NEAR_BOX`
    // includes some off-polygon ground the party's own earlier sweeps left in the memory tier
    // regardless of who currently holds the scout, and that ground clears the `COVER_EPSILON`
    // gate on its own. That is a real, stable base rate, not noise, so the row measures the gap
    // against it rather than asserting an absolute floor that would not be true. Measured
    // 2026-09-1x across three runs: stranded 36.1–41.7% clear, handed 77.5–77.7%, a gap of
    // 35.8–41.6 percentage points every time; the margin (3, i.e. 0.03) is at least a twelfth
    // of the smallest of those — comfortably an order of magnitude down.
    expect(
      handedNear.clear,
      `handed ${(handedNear.clear * 100).toFixed(1)}% clear against stranded's ${(strandedNear.clear * 100).toFixed(1)}%`,
    ).toBeGreaterThan(strandedNear.clear + 0.03)
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

    // 5.5 cells out — comfortably past the 2-cell narrow radius (2.75x it, clear of any
    // feather the ring's edge carries) and comfortably inside the 8-cell wide one (2.5 cells
    // of headroom before that edge). Not "3 to 6 cells": the old box's nearest corner (3
    // cells) sat close enough to the narrow ring's own feather edge to bleed a little of the
    // wide state into the narrow read (measured 2.7 → 6.1, a bound this row could only just
    // clear); a first retry at a single fixed 4 cells still timed out waiting for the narrow
    // read to separate, so 5.5 is the point this row settled on. Same direction as both: the
    // old box's own (already proven wall-free out to 6 cells by every earlier run of this row).
    const towardCorner = { x: 1.5 - AT_DOOR.x, y: 1.5 - AT_DOOR.y }
    const towardLen = Math.hypot(towardCorner.x, towardCorner.y)
    const unit = { x: towardCorner.x / towardLen, y: towardCorner.y / towardLen }
    const farPoint = { x: AT_DOOR.x + unit.x * 5.5, y: AT_DOOR.y + unit.y * 5.5 }
    const CORNER: [number, number, number, number] = [
      farPoint.x - 0.5,
      farPoint.y - 0.5,
      farPoint.x + 0.5,
      farPoint.y + 0.5,
    ]
    await frameUp(player)
    await player.bringToFront()
    // Settle signal: the point is live (low cover) once the wide ring actually reaches it —
    // read as cover, not raw luminance, for the same reason every row below does.
    await expect
      .poll(async () => meanOf((await patchCover(player, CORNER)).delta), { timeout: 10_000 })
      .toBeLessThan(20)
    const wide = await patchCover(player, CORNER)

    // 10 ft, typed on the panel and committed on blur.
    await dm.getByLabel('Sight range').fill('10')
    await dm.getByLabel('Sight range').blur()
    // Polled against a fixed absolute floor, not against `wide.delta + margin`: stopping once
    // the read clears the *assertion's own* threshold lets the margin decide how long the mask
    // gets to converge before the read is taken — a smaller margin stops earlier, catches the
    // rise still in flight, and reads a smaller gap for it (measured 23.2 stopping at a margin
    // of 15, 6.5 at a margin of 4, on the same point — and a fixed 3s wait with no poll at all
    // caught it before it had even started, 2.3 → 2.4). 15 is comfortably inside the no-light
    // tier every other row in this file reads once truly settled, and unrelated to whatever
    // margin the assertion below uses.
    await expect
      .poll(async () => meanOf((await patchCover(player, CORNER)).delta), { timeout: 20_000 })
      .toBeGreaterThan(15)
    const narrow = await patchCover(player, CORNER)

    record(
      'a sight range edited on the panel, measured on the player canvas',
      `5.5 cells out (2.75x the narrowed radius) cover delta ${meanOf(wide.delta).toFixed(1)} under ` +
        `40 ft of darkvision and ${meanOf(narrow.delta).toFixed(1)} under 10 ft; the floor ` +
        `underneath: ${meanOf(wide.floor).toFixed(1)} and ${meanOf(narrow.floor).toFixed(1)}`,
      'a smaller eye is a more covered patch, off the panel alone — the same floor either way',
    )
    // More covered, not dimmer: pale mist made the memory tier brighter than live, so the old
    // "narrower reads dimmer" claim had the sign backwards the moment it ran (it never had —
    // this row was skipped behind the two memory-tier failures above it). Read as cover
    // (`patchCover`'s delta) at a point comfortably clear of both rings' feather edges, polled
    // to the fixed absolute floor above rather than to this margin (see that comment for why
    // the two must stay decoupled). The gap itself still varies real run to real run on this
    // build — 20.0, 8.4, 7.3 across three runs once the self-reference was gone, one direction
    // every time but not one fixed size — so the margin (1) is pinned to 5x under the smallest
    // of those three, not to any single run.
    expect(
      meanOf(narrow.delta),
      `40 ft delta ${meanOf(wide.delta).toFixed(1)}, 10 ft delta ${meanOf(narrow.delta).toFixed(1)}`,
    ).toBeGreaterThan(meanOf(wide.delta) + 1)
    // …and still the same floor underneath — the ring shrinking doesn't move the map, only
    // what covers it.
    expect(
      Math.abs(meanOf(narrow.floor) - meanOf(wide.floor)),
      `narrow floor ${meanOf(narrow.floor).toFixed(1)} against wide's ${meanOf(wide.floor).toFixed(1)}`,
    ).toBeLessThan(10)

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
