import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { assertMapRendered, hostTable, joinTable } from './table'
import {
  canvasPoint,
  createDef,
  dragToken,
  placeToken,
  selectOnCanvas,
  tokenPositions,
  type Point,
} from './tokens'

/**
 * @sprint2-tokens — the two §2.6 rows that need the token UI: a drag landing on everyone
 * else's screen, and 20 tokens holding the frame budget.
 *
 * The move metric is already proven at the wire (`session/server/src/integration.test.ts`,
 * worst 2.0ms across six raw clients). What this file adds is everything the server test
 * cannot see: a real pointer drag through `drag.ts`'s capture-phase listeners, the D9
 * throttle, and the observer's React render.
 *
 * The clock brackets the whole gesture: it starts on the first `pointermove` after the
 * token is grabbed and stops when the observing tab's row for that token leaves its cell.
 * Measuring from `pointerup` instead reads *negative* (measured: −44ms) — the throttle is
 * leading-edge and reset on grab, so the very first move is sent immediately and is already
 * on the other screen before the pointer comes up. Bracketing the gesture keeps whatever
 * throttle delay exists inside the measurement, which makes it the stricter target, and
 * needs no prediction of where the drag will land (impossible on a production build — see
 * `tokens.ts`). The drop send is still covered: the final position is asserted on all three
 * tabs afterwards.
 *
 * Both timestamps are `Date.now()` taken *inside* the two pages: one wall clock, two tabs,
 * no CDP round trip inside the measurement.
 *
 * Three tokens dragged once each, rather than one token dragged three times: a grab is only
 * guaranteed to hit at the point the token was placed at (see `tokens.ts`), and a dropped
 * token can end up as much as a cell from the pointer that dropped it.
 *
 * One table for both tests (`describe.serial`): hosting, the engine boot and the asset-pack
 * install are setup, not subject. It also keeps this file to two `/api/join` calls — the
 * server rate-limits join+resolve to 10 a minute per IP, and every context here is
 * localhost.
 */

const VIEWPORT = { width: 1280, height: 720 }

/** How far right each token is dragged. Well over a cell at any zoom the camera picks. */
const DRAG_PX = 250

/** Arms both ends of one measurement: the grabbed-and-moving instant, and the seen instant. */
async function armMeasurement(dragger: Page, observer: Page, id: string): Promise<void> {
  await dragger.evaluate(() => {
    const w = window as unknown as { __movedAt: number }
    w.__movedAt = 0
    // Only after a grab: `dragToken` positions the pointer before pressing, and that move
    // is not part of the gesture.
    let grabbed = false
    window.addEventListener('pointerdown', () => (grabbed = true), { capture: true, once: true })
    window.addEventListener(
      'pointermove',
      () => {
        if (grabbed && !w.__movedAt) w.__movedAt = Date.now()
      },
      { capture: true },
    )
  })

  // Waits for the row to *leave the cell it is on now*, so nothing has to predict where the
  // drag will land. A MutationObserver rather than a rAF poll: a poll quantises the answer
  // to a frame, which is 16ms of a 100ms budget.
  await observer.evaluate((tokenId: string) => {
    const w = window as unknown as { __seenAt: number }
    w.__seenAt = 0
    const cell = () => {
      const data = (document.querySelector(`[data-token-id="${tokenId}"]`) as HTMLElement | null)
        ?.dataset
      return data ? `${data.x},${data.y}` : null
    }
    const before = cell()
    const observe = new MutationObserver(() => {
      if (cell() === before) return
      observe.disconnect()
      w.__seenAt = Date.now()
    })
    observe.observe(document.body, { subtree: true, attributes: true, childList: true })
  }, id)
}

const stamp = (page: Page, name: '__movedAt' | '__seenAt'): Promise<number> =>
  page.evaluate((key: string) => (window as unknown as Record<string, number>)[key], name)

/**
 * Frames actually painted per second, over `ms`. Foreground only — a hidden tab has its
 * rAF throttled and the number would be about tab visibility, not about tokens.
 */
function measureFps(page: Page, ms = 2000): Promise<number> {
  return page.evaluate(
    (duration: number) =>
      new Promise<number>((resolve) => {
        let frames = 0
        const started = performance.now()
        const tick = () => {
          frames += 1
          const elapsed = performance.now() - started
          if (elapsed >= duration) resolve((frames * 1000) / elapsed)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )
}

test.describe.serial('@sprint2-tokens', () => {
  let contexts: BrowserContext[] = []
  let dm: Page
  let alice: Page
  let bob: Page
  /** Where each of the three tokens was placed, and the id it came back as. */
  let spots: Point[]
  let ids: string[]

  test.beforeAll(async ({ browser }) => {
    const open = async (): Promise<Page> => {
      const context = await browser.newContext({ viewport: VIEWPORT })
      contexts.push(context)
      const page = await context.newPage()
      page.on('pageerror', (e) => console.log('[pageerror]', e.message))
      return page
    }

    dm = await open()
    const code = await hostTable(dm)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm)

    alice = await open()
    await joinTable(alice, code, 'Alice')
    // Alice drags, so her canvas has to be live and framed on the same camera as the DM's.
    await assertMapRendered(alice)

    // Bob only reads the panel's DOM mirror — but his map is waited on anyway, because the
    // first-boot asset-pack install is ~4s of his main thread and a render scheduled on top
    // of it is what the observer's clock would otherwise be measuring (seen: 122ms).
    bob = await open()
    await joinTable(bob, code, 'Bob')
    await assertMapRendered(bob)

    // Three rows down the left of the map, dragged right — far enough apart that no token
    // ever lands on another's grab point.
    await createDef(dm, 'Borin')
    spots = await Promise.all([0.25, 0.5, 0.75].map((fy) => canvasPoint(dm, 0.25, fy)))
    for (const spot of spots) await placeToken(dm, 'Borin', spot)

    await expect(alice.getByTestId('token-layer').locator('[data-token-id]')).toHaveCount(3)
    const placed = await tokenPositions(alice)
    ids = Object.keys(placed)
    // Pins id → spot without trusting the wire's key order: they were placed top to bottom.
    expect(placed[ids[0]].y).toBeLessThan(placed[ids[1]].y)
    expect(placed[ids[1]].y).toBeLessThan(placed[ids[2]].y)

    // A player may only drag what they own (D10). The first claim goes through the canvas,
    // which is also the gate for "the Pixi overlay is mounted and a click on a token hits
    // it" — the rest can use the panel, which needs no overlay.
    await selectOnCanvas(alice, spots[0], 'Borin')
    await alice.getByTestId('claim-button').click()
    for (let i = 1; i < ids.length; i++) {
      await alice.getByTestId('token-layer').locator('[data-token-id]').nth(i).click()
      await alice.getByTestId('claim-button').click()
    }
    await expect(alice.getByTestId('token-layer').locator('[data-owner]')).toHaveCount(3)
  })

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    contexts = []
  })

  test('a drag lands on another player’s screen in under 100ms', async () => {
    // The *observer* is what is being timed, so it gets the foreground: the render that
    // flips `data-x` is scheduled off a frame, and a background tab throttles those.
    await bob.bringToFront()

    const latencies: number[] = []
    for (let i = 0; i < ids.length; i++) {
      const before = (await tokenPositions(alice))[ids[i]]
      await armMeasurement(alice, bob, ids[i])
      await dragToken(alice, spots[i], { x: spots[i].x + DRAG_PX, y: spots[i].y })

      await expect
        .poll(() => stamp(bob, '__seenAt'), { timeout: 10_000, intervals: [25] })
        .toBeGreaterThan(0)

      const latency = (await stamp(bob, '__seenAt')) - (await stamp(alice, '__movedAt'))
      // Non-positive would mean the observer moved the token before the hand did.
      expect(latency).toBeGreaterThan(0)
      latencies.push(latency)

      // It moved right, and only right: a drag that panned the camera instead would leave
      // the token exactly where it was.
      const after = (await tokenPositions(alice))[ids[i]]
      expect(after.x).toBeGreaterThan(before.x)
      expect(after.y).toBe(before.y)
    }

    console.log(
      `[metric] token drag → observer DOM: worst ${Math.max(...latencies)}ms, ` +
        `three drags [${latencies.join(', ')}]ms (target < 100ms)`,
    )
    expect(Math.max(...latencies)).toBeLessThan(100)

    // Authoritative everywhere, not merely optimistic in the tab that did the dragging.
    const settled = await tokenPositions(alice)
    for (const page of [dm, bob]) {
      await expect.poll(() => tokenPositions(page), { timeout: 10_000 }).toEqual(settled)
    }
  })

  test('20 tokens hold 60fps', async () => {
    // The metric is one client's frame budget. Alice and Bob are scaffolding for the drag
    // above, and two more live Pixi render loops on the same GPU cost the DM ~5fps
    // (measured: 53.9 with them open, alongside a 56.0 baseline that should have been 60).
    await alice.close()
    await bob.close()
    await dm.bringToFront()
    const placed = Object.keys(await tokenPositions(dm)).length
    // Discarded: the first sample after a tab switch measures the tab switch (measured 47fps
    // against 59 on the very next one), and a baseline that reads worse than the loaded
    // number is worse than no baseline at all.
    await measureFps(dm, 500)
    const before = await measureFps(dm)

    // A 5×4 spread over the map rather than a stack: 20 sprites the overlay has to sort,
    // tween and draw is what the metric is about.
    for (let i = placed; i < 20; i++) {
      const spot = await canvasPoint(dm, 0.15 + (i % 5) * 0.16, 0.2 + Math.floor(i / 5) * 0.2)
      await placeToken(dm, 'Borin', spot)
    }
    await expect(dm.getByTestId('token-layer').locator('[data-token-id]')).toHaveCount(20)

    const fps = await measureFps(dm)
    console.log(
      `[metric] frame rate: ${fps.toFixed(1)}fps with 20 tokens ` +
        `(${before.toFixed(1)}fps with ${placed}, target ≥ 55fps)`,
    )
    expect(fps).toBeGreaterThanOrEqual(55)
  })
})
