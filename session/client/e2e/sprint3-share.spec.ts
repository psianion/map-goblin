import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import type { Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { assertMapLoaded, assertMapRendered, hostTable, joinTable, type MapUnderTest } from './table'

/**
 * @sprint3-share — `visionShare: 'individual'` at the table (S3 P5), which is the one thing
 * no single-seat row can be honest about: it takes *two* players before "each viewer sees
 * through their own tokens" is a claim with two sides to check.
 *
 * The unit rows pin each half on its own — the per-seat record and the wire cut in
 * `session/server/src/fog/vision-mode.test.ts`, the redact mapping in
 * `packages/mechanics/src/fog/module.test.ts`, the eye predicate in
 * `src/modules/fog/visionSight.test.ts`. What only a browser can answer is whether two real
 * sockets carrying two real redactions land two different pictures on two canvases.
 *
 * The map is sprint3-vision's: two halls either side of one wall with a two-cell door in it
 * (`session/testdata/vision-two-rooms.mapbuilder`), small enough that every reading below is
 * about who is looking and not about a dressed dungeon's own texture.
 *
 * Both seats' tokens start in the *same* hall, which is what makes the divergence a statement
 * about sight rather than about geometry: the room record is shared by design (P5 §1), so
 * both seats hold the same map and only the mask and the token slice differ.
 *
 *   pnpm exec playwright test -c e2e/playwright.sprint3.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }

/** D10's reveal fade, copied for the reason the other sprint3 specs copy it: this is Node. */
const REVEAL_MS = 300

// ── The map, read the way the server reads it ───────────────────────────────

const FILE = join(import.meta.dirname, '../../testdata/vision-two-rooms.mapbuilder')
const doc = JSON.parse(readFileSync(FILE, 'utf8')) as SerializedMapData
const VISION: MapUnderTest = { file: FILE, name: doc.mapSettings.name }

const layer = doc.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
/** West first, east second — both seats start in the near one; the far one is the familiar's. */
const [NEAR, FAR] = [...(layer.rooms ?? [])].sort((a, b) => a.centroid[0] - b.centroid[0])

/** Three cells of sight: small enough that two tokens in one hall cannot see each other. */
const SHORT = { range: 3, angle: 360, visionMode: 'normal' }
const at = (room: Room, dx: number, dy: number) => ({
  x: room.centroid[0] + dx,
  y: room.centroid[1] + dy,
})
/** Opposite corners of the near hall — 8.5 cells apart, well past either one's reach. */
const ALDA = at(NEAR, -2.5, -2.5)
const BRAN = at(NEAR, 3.5, 3.5)
/** One thing standing in each seat's sight, and nowhere near the other's. */
const ALDA_SEES = at(NEAR, -3.5, -1.5)
const BRAN_SEES = at(NEAR, 4.5, 2.5)
/** The familiar, deep in the far hall behind the shut door, and what it is looking at. */
const HAWK = at(FAR, 0.5, 0.5)
const CULTIST = at(FAR, -0.5, 0.5)

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
}

/** `__fogProbe`'s vision half, the three fields these rows read. */
function probe(page: Page): Promise<ProbeRead | null> {
  return page.evaluate(() => {
    const p = (
      window as Window & {
        __fogProbe?: {
          mode: string
          sweepSources(): number
          memoryCells(): number
          rebuilds: number
        }
      }
    ).__fogProbe
    return p
      ? { mode: p.mode, sources: p.sweepSources(), cells: p.memoryCells(), rebuilds: p.rebuilds }
      : null
  })
}

const read = async (page: Page): Promise<ProbeRead> => {
  const now = await probe(page)
  expect(now, 'the fog probe is not mounted on this seat').not.toBeNull()
  return now as ProbeRead
}

/** Every token id on a seat's canvas — which is every token that seat was sent. */
const tokenIds = (page: Page): Promise<string[]> =>
  page
    .getByTestId('token-layer')
    .locator('[data-token-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-token-id') as string).sort())

/** Place a token from the DM's seat and hand back the id the server minted for it. */
async function place(dm: Page, payload: Record<string, unknown>): Promise<string> {
  const before = await tokenIds(dm)
  await command(dm, 'tokens', 'place', payload)
  await expect.poll(async () => (await tokenIds(dm)).length).toBe(before.length + 1)
  return (await tokenIds(dm)).find((id) => !before.includes(id)) as string
}

/** sprint3-vision's shutter and its reasons — chrome hidden so it is not in frame. */
const OVERLAY_CHROME =
  '[data-testid="table-status-bar"],[aria-label="Fit to screen"],[data-testid="active-tool"],[data-testid="toast"],[data-testid="reconnecting-banner"]{display:none}'
const shoot = (page: Page): Promise<Buffer> =>
  page.locator('[data-testid="game-canvas"] canvas').screenshot({ style: OVERLAY_CHROME })

interface Look {
  /** Mean luminance over the whole canvas, 0–255. */
  mean: number
  /** Fraction of pixels above the black floor — how much of the map is drawn at all. */
  lit: number
}

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
      // This map's floor is the editor default (#F1ECDF, luminance ~236) and its void is the
      // background's own #2d2d2d at ~45, so the floor is the only thing that clears 120.
      if (luminance > 120) lit++
    }
    return { mean: sum / (data.length / 4), lit: lit / (data.length / 4) }
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

const look = async (page: Page): Promise<Look> => develop(page, await shoot(page))
const show = (l: Look) => `mean ${l.mean.toFixed(1)}/255, ${(l.lit * 100).toFixed(1)}% floor`

/** What fraction of the canvas differs between two shots. sprint3-fog's, for its reasons. */
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

/**
 * One camera for every reading in a segment.
 *
 * The renderer frames a scene exactly once — a reveal must never yank the camera — so a fit
 * taken while a seat held one room is a different transform from one taken with two. Both
 * seats hold the same rooms throughout (the room record is shared), so a fit on each puts the
 * two canvases on one transform and makes their means comparable.
 */
async function frameUp(page: Page): Promise<void> {
  await page.getByLabel('Fit to screen').click()
  await page.waitForTimeout(REVEAL_MS * 3)
}

/** Every measurement lands in the run log in the same grep-able shape as the other specs. */
function record(name: string, measured: string, target: string): void {
  console.log(`[metric] ${name}: ${measured} (target: ${target})`)
}

/**
 * Every websocket frame this seat has been sent, as one string.
 *
 * The literal wire, not the state the store settled on: a token retracted a moment later is
 * still a token that arrived, and D4c exists because the last known position sitting in
 * client memory is the leak. Attached before the seat joins, so nothing is missed, and it
 * survives a reload because the listener is on the page rather than on the socket.
 */
function tapWire(page: Page): string[] {
  const frames: string[] = []
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      frames.push(typeof payload === 'string' ? payload : payload.toString('utf8'))
    }),
  )
  return frames
}

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@sprint3-share', () => {
  let dmContext: BrowserContext
  let aldaContext: BrowserContext
  let branContext: BrowserContext
  let dm: Page
  /** Two players, two claims — Alda west-north, Bran east-south, in one hall. */
  let alda: Page
  let bran: Page
  let aldaWire: string[]
  let branWire: string[]
  const ids: Record<string, string> = {}
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, VISION)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, VISION)

    aldaContext = await browser.newContext({ viewport: VIEWPORT })
    alda = await aldaContext.newPage()
    alda.on('pageerror', (e) => pageErrors.push(`[alda] ${e.message}`))
    aldaWire = tapWire(alda)
    await joinTable(alda, code, 'Alda')
    await assertMapLoaded(alda, VISION)

    branContext = await browser.newContext({ viewport: VIEWPORT })
    bran = await branContext.newPage()
    bran.on('pageerror', (e) => pageErrors.push(`[bran] ${e.message}`))
    branWire = tapWire(bran)
    await joinTable(bran, code, 'Bran')
    await assertMapLoaded(bran, VISION)

    // Token vision, and each seat looking through its own eyes alone.
    await command(dm, 'fog', 'set-mode', { mode: 'vision' })
    await command(dm, 'fog', 'set-share', { visionShare: 'individual' })
    await expect.poll(async () => (await probe(alda))?.mode).toBe('vision')
    await expect.poll(async () => (await probe(bran))?.mode).toBe('vision')

    ids.alda = await place(dm, { name: 'Alda', ...ALDA, sight: SHORT })
    ids.bran = await place(dm, { name: 'Bran', ...BRAN, sight: SHORT })
    ids.rat = await place(dm, { name: 'Rat', ...ALDA_SEES, sight: null })
    ids.spider = await place(dm, { name: 'Spider', ...BRAN_SEES, sight: null })

    await command(alda, 'tokens', 'claim', { id: ids.alda })
    await command(bran, 'tokens', 'claim', { id: ids.bran })
    await expect.poll(async () => (await read(alda)).sources).toBe(1)
    await expect.poll(async () => (await read(bran)).sources).toBe(1)
  })

  test.afterAll(async () => {
    await branContext?.close()
    await aldaContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the two-seat table:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  /**
   * §1 — two seats in one hall, two masks, two entitlements.
   *
   * Every token below is in a room both seats hold, and the DM revealed nothing by hand: the
   * only thing that can separate the two canvases is whose eyes each one is drawn through.
   */
  test('two seats in one hall draw two masks and hold two entitlements', async () => {
    await frameUp(alda)
    await frameUp(bran)
    const [aldaShot, branShot] = [await shoot(alda), await shoot(bran)]
    const [aldaLook, branLook] = [await develop(alda, aldaShot), await develop(alda, branShot)]

    // Both seats swept something of their own…
    expect((await read(alda)).cells, 'Alda swept nothing into her own record').toBeGreaterThan(0)
    expect((await read(bran)).cells, 'Bran swept nothing into his own record').toBeGreaterThan(0)
    expect(aldaLook.lit).toBeGreaterThan(0.005)
    expect(branLook.lit).toBeGreaterThan(0.005)

    // …and the two pictures are not one picture. Same map, same camera, same moment.
    const noise = await changed(alda, aldaShot, await shoot(alda))
    const apart = await changed(alda, aldaShot, branShot)

    // The entitlement, on the canvas each seat actually holds: your own token, whatever your
    // own eyes reach, and nothing the other seat earned.
    expect(await tokenIds(alda)).toEqual([ids.alda, ids.rat].sort())
    expect(await tokenIds(bran)).toEqual([ids.bran, ids.spider].sort())
    expect(await tokenIds(dm)).toEqual([ids.alda, ids.bran, ids.rat, ids.spider].sort())

    record(
      'two seats, one hall, one moment',
      `Alda ${show(aldaLook)} against Bran ${show(branLook)}; ${(apart * 100).toFixed(2)}% of the ` +
        `canvas differs between the seats (still frame to still frame: ${(noise * 100).toFixed(2)}%)`,
      'two masks, two token slices, one shared map',
    )
    expect(apart, 'the two seats drew the same picture').toBeGreaterThan(noise + 0.005)
  })

  /**
   * §1 — and the wire itself, both directions. The store is not the claim: a frame that
   * arrived and was retracted a beat later is still a frame that arrived (D4c).
   */
  test('neither seat’s wire ever carries the token the other one earned', async () => {
    const aldaSaid = aldaWire.join('')
    const branSaid = branWire.join('')

    // What each seat is entitled to did arrive — otherwise "not present" proves nothing.
    expect(aldaSaid).toContain(ids.rat)
    expect(branSaid).toContain(ids.spider)
    // …and what it is not entitled to is in no frame it has ever been sent.
    expect(aldaSaid, 'Bran’s ambusher reached Alda’s socket').not.toContain(ids.spider)
    expect(aldaSaid, 'Bran’s own token reached Alda’s socket').not.toContain(ids.bran)
    expect(branSaid, 'Alda’s ambusher reached Bran’s socket').not.toContain(ids.rat)
    expect(branSaid, 'Alda’s own token reached Bran’s socket').not.toContain(ids.alda)

    record(
      'the wire, byte-searched both directions',
      `${aldaWire.length} frame(s) to Alda and ${branWire.length} to Bran, ` +
        'neither naming the other’s tokens',
      'a player never receives a token beyond their own entitlement',
    )
  })

  /**
   * §1 — a familiar the DM lends one seat, looking into a hall the other has never lit.
   *
   * The far hall's *geometry* ships to the table the moment the hawk sweeps it — the room
   * record is shared by design — so both seats hold the same document here and the reading is
   * purely about the mask over it.
   */
  test('a linked familiar lights a hall for one seat that the other has never seen', async () => {
    ids.hawk = await place(dm, { name: 'Hawk', ...HAWK, sight: { ...SHORT, range: 6 } })
    ids.cultist = await place(dm, { name: 'Cultist', ...CULTIST, sight: null })
    await command(dm, 'tokens', 'set-sight-link', { id: ids.bran, otherId: ids.hawk, linked: true })

    // Bran is looking through two pairs of eyes now; Alda through one.
    await expect.poll(async () => (await read(bran)).sources).toBe(2)
    expect((await read(alda)).sources).toBe(1)

    await frameUp(alda)
    await frameUp(bran)
    const [aldaLook, branLook] = [await look(alda), await develop(alda, await shoot(bran))]

    record(
      'a familiar’s hall, seen from one seat and not the other',
      `Alda ${show(aldaLook)} against Bran ${show(branLook)} on the same document`,
      'the linked seat sees the far hall; the other sees void where it stands',
    )

    // Bran can see a hall Alda cannot, so there is measurably more map on his canvas.
    expect(branLook.lit, `Bran ${show(branLook)} against Alda ${show(aldaLook)}`).toBeGreaterThan(
      aldaLook.lit + 0.005,
    )
    // …and the cultist the hawk is looking at is Bran's alone, on the canvas and on the wire.
    expect(await tokenIds(bran)).toEqual([ids.bran, ids.spider, ids.hawk, ids.cultist].sort())
    expect(await tokenIds(alda)).toEqual([ids.alda, ids.rat].sort())
    expect(aldaWire.join(''), 'the familiar’s hall leaked onto Alda’s socket').not.toContain(
      ids.cultist,
    )
  })

  /** §1 — the record is the server's, and it is per seat, so a reload is not a reset. */
  test('each seat’s own memory comes back after a reload, and is still its own', async () => {
    const before = await read(alda)

    await alda.reload()
    await assertMapLoaded(alda, VISION)
    await expect.poll(async () => (await probe(alda))?.mode).toBe('vision')
    await frameUp(alda)
    const after = await read(alda)

    record(
      'a per-seat record across a reload',
      `Alda held ${before.cells} swept cell(s) before the reload and ${after.cells} after; ` +
        `Bran holds ${(await read(bran)).cells}`,
      'the seat’s own memory, restored from the server, not the party’s',
    )

    expect(after.cells, 'Alda came back from a reload with a different record').toBe(before.cells)
    // Still hers alone: the far hall her seat never lit is still absent from her wire.
    expect(after.cells).toBeLessThan((await read(bran)).cells)
    expect(aldaWire.join('')).not.toContain(ids.cultist)
  })

  /**
   * §1 — the flip, driven the way a DM drives it: the panel's own segmented control. Both
   * records merge into the table's, both seats are handed it, and nothing is destroyed.
   */
  test('flipping the share to party merges both masks, live on both seats', async () => {
    const [aldaBefore, branBefore] = [await read(alda), await read(bran)]
    expect(aldaBefore.cells).not.toBe(branBefore.cells)

    await dm.getByTestId('fog-tool-toggle').click()
    await expect(dm.getByTestId('fog-bar')).toBeVisible()
    await dm.getByTestId('fog-share').getByRole('radio', { name: 'Party' }).click()

    // One record now, and both seats read it: the union of everything either of them swept.
    await expect.poll(async () => (await read(alda)).cells).toBeGreaterThan(aldaBefore.cells)
    await expect.poll(async () => (await read(bran)).cells).toBe((await read(alda)).cells)
    // …and the party's eyes with it — Alda is drawn through three pairs now (hers, Bran's
    // and the hawk he is linked to), where a moment ago she had one.
    await expect.poll(async () => (await read(alda)).sources).toBe(3)

    await dm.keyboard.press('Escape')
    await frameUp(alda)
    await frameUp(bran)
    const merged = await look(alda)

    record(
      'a live share flip, read off both seats',
      `Alda ${aldaBefore.cells} → ${(await read(alda)).cells} cell(s), Bran ${branBefore.cells} → ` +
        `${(await read(bran)).cells}; Alda's canvas ${show(merged)}`,
      'one record, both seats, nothing lost in either direction',
    )

    // Both seats hold every token again, which is party share's own rule.
    const all = [ids.alda, ids.bran, ids.rat, ids.spider, ids.hawk, ids.cultist].sort()
    await expect.poll(() => tokenIds(alda)).toEqual(all)
    await expect.poll(() => tokenIds(bran)).toEqual(all)
    // Nothing was destroyed on the way in either direction: the merged record is bigger than
    // either seat's own was, which only an OR of the two can be.
    expect((await read(alda)).cells).toBeGreaterThan(Math.max(aldaBefore.cells, branBefore.cells))
  })

  /** §2.6's standing gate condition, on this table too: zero uncaught errors. */
  test('the two-seat table draws with no page errors', () => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})
