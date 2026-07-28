import { once } from 'node:events'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol'
import { assertMapRendered, hostTable, joinTable, loadedMapName, SERVER_URL } from './table'

/**
 * @sprint1-metrics — the Sprint 1 success-metric table, asserted with a stopwatch.
 *
 * Runs under `playwright.metrics.config.ts` ONLY, which serves a **production build** via
 * `vite preview`. I1's instrumented run measured 89.6s to a rendered player map on the Vite
 * dev server: that number is the dev module waterfall (hundreds of unbundled ESM requests,
 * plus an on-demand optimize pass), not the product. A metric taken against `pnpm dev` is
 * measuring the bundler.
 *
 * One table, one DM, one player, shared across the four tests (`describe.serial`) — the
 * expensive parts (upload, engine boot, asset-pack install) are setup for every metric
 * except the one that deliberately measures them cold.
 */

/** Every measurement lands in the run log in one grep-able shape. */
function record(name: string, measured: string, target: string): void {
  console.log(`[metric] ${name}: ${measured} (target: ${target})`)
}

const VIEWPORT = { width: 1280, height: 720 }

test.describe.serial('@sprint1-metrics', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let code: string

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => console.log('[dm pageerror]', e.message))

    code = await hostTable(dm)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
  })

  /**
   * Metric: player join (link → rendered map) < 5s.
   *
   * The clock starts on `goto('/join/CODE')` in a context that has never seen this app —
   * cold HTTP cache, cold IndexedDB — and stops on `assertMapRendered`. Everything a real
   * player waits through is inside the window: document + JS bundle download, React mount,
   * `GET /api/resolve/:code`, `POST /api/join`, WS upgrade + `join`, the `session-state`
   * snapshot, `GET /api/maps/:id`, Pixi/WebGL init, Clipper2 wasm fetch + instantiate,
   * first-boot install of the ~8MB bundled asset pack into a cold IndexedDB, `loadFromFile`
   * (Clipper2 union of the fixture's rooms) and the first drawn frame.
   *
   * Excluded, deliberately: the DM's setup, and any server cold start — the metric is
   * "a player follows a link to a table that is already running".
   */
  test('player join: link → rendered map', async ({ browser }) => {
    playerContext = await browser.newContext({ viewport: VIEWPORT })
    // Installed here because the socket it has to catch is opened during the join below,
    // long before the reconnect test runs. See that test for why a handle is needed at all.
    await playerContext.addInitScript(() => {
      const live: WebSocket[] = []
      ;(window as unknown as { __sockets: WebSocket[] }).__sockets = live
      const Native = window.WebSocket
      class Tracked extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          live.push(this)
        }
      }
      window.WebSocket = Tracked

      // D14d (Amendment B2 regression): the S2 pack-install parallelization put 94 fetches
      // and their texture uploads on the main thread at once, so what can regress is pacing,
      // not throughput — a tab frozen solid while the pack lands. Armed from the init script
      // because the install is over long before any test line could attach a listener.
      //
      // Sampled only while the overlay reads "Starting the renderer…", which is exactly the
      // phase the install owns: the map is already in hand (small JSON, localhost) and the
      // engine is not live yet. Consecutive samples are therefore consecutive frames inside
      // that window, and their deltas are the frame gaps. One subtree `textContent` read per
      // frame costs no layout and nothing next to an 8MB install.
      const installFrames: number[] = []
      ;(window as unknown as { __installFrames: number[] }).__installFrames = installFrames
      const sample = (at: number) => {
        const stage = document.querySelector('[data-testid="game-canvas"]')?.parentElement
        if (stage?.textContent?.includes('Starting the renderer')) installFrames.push(at)
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => console.log('[player pageerror]', e.message))

    const started = Date.now()
    await joinTable(player, code, 'Borin')
    await assertMapRendered(player)
    const joinMs = Date.now() - started

    record('player join (cold context → rendered map)', `${joinMs}ms`, '< 5000ms')
    expect(joinMs).toBeLessThan(5000)

    await expect(player.getByTestId('player-list').getByRole('listitem')).toHaveCount(2)
  })

  /**
   * Metric (D14d): frame pacing *during* the bundled pack install.
   *
   * Reads the samples the join above collected — the cold context is the only place the
   * install actually runs, and it runs once. The number that matters is the worst gap
   * between two painted frames while the pack is landing: throughput already has a metric
   * (join time), and a fast install that locks the tab still loses the roster, the log and
   * the reconnect banner for the duration.
   *
   * ponytail: the assert is a freeze guard, not a pacing target — a full second of dead tab
   * is unambiguously a regression, whatever the hardware. Tighten it toward the recorded
   * number once a gate run has published a baseline on the dressed map.
   */
  test('pack install: frame pacing while the bundled pack lands', async () => {
    const frames = await player.evaluate(
      () => (window as unknown as { __installFrames: number[] }).__installFrames,
    )
    expect(
      frames.length,
      'no frames sampled while the engine was starting — the install window was never observed',
    ).toBeGreaterThan(1)

    const gaps = frames.slice(1).map((at, i) => at - frames[i])
    const sorted = [...gaps].sort((a, b) => a - b)
    const worst = sorted[sorted.length - 1]
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]

    record(
      'pack install frame pacing',
      `worst ${worst.toFixed(0)}ms, p95 ${p95.toFixed(0)}ms over ${gaps.length} frames ` +
        `(window ${(frames[frames.length - 1] - frames[0]).toFixed(0)}ms)`,
      'no gap ≥ 1000ms',
    )
    expect(worst).toBeLessThan(1000)
  })

  /**
   * Metric: render parity DM vs player — pixel-identical.
   *
   * Both contexts run the same `GameRenderer` at the same viewport, so the sidebar is the
   * same width and `frameMap` computes the same camera from the same `computeMapWorldBounds`.
   * Only the canvas is captured, so the sidebar (which legitimately differs — the DM has an
   * invite-code chip) is out of frame and needs no mask.
   *
   * The diff runs in-page rather than through a golden-file comparator: there is no baseline
   * to store, the two images are both produced by this run, and a browser already has a PNG
   * decoder. Zero new dependencies.
   */
  test('render parity: DM canvas vs player canvas', async () => {
    const selector = '[data-testid="game-canvas"] canvas'
    const dmShot = await dm.locator(selector).screenshot()
    const playerShot = await player.locator(selector).screenshot()

    const result = await dm.evaluate(
      async ([a, b, tolerance]: [string, string, number]) => {
        const pixels = async (url: string) => {
          const bitmap = await createImageBitmap(await (await fetch(url)).blob())
          const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
          const ctx = surface.getContext('2d')!
          ctx.drawImage(bitmap, 0, 0)
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
        }
        const [x, y] = await Promise.all([pixels(a), pixels(b)])
        if (x.width !== y.width || x.height !== y.height) {
          return { differing: -1, total: 0, maxDelta: 255, size: `${x.width}x${x.height} vs ${y.width}x${y.height}` }
        }
        let differing = 0
        let maxDelta = 0
        for (let i = 0; i < x.data.length; i += 4) {
          const delta = Math.max(
            Math.abs(x.data[i] - y.data[i]),
            Math.abs(x.data[i + 1] - y.data[i + 1]),
            Math.abs(x.data[i + 2] - y.data[i + 2]),
          )
          if (delta > maxDelta) maxDelta = delta
          if (delta > tolerance) differing++
        }
        return { differing, total: x.width * x.height, maxDelta, size: `${x.width}x${x.height}` }
      },
      // > 8/255 per channel is not antialiasing or GPU dither, it is different content.
      [`data:image/png;base64,${dmShot.toString('base64')}`, `data:image/png;base64,${playerShot.toString('base64')}`, 8] as [string, string, number],
    )

    expect(result.total, `canvas dimensions differ: ${result.size}`).toBeGreaterThan(0)

    const ratio = result.differing / result.total
    record(
      'render parity DM vs player',
      `${(ratio * 100).toFixed(4)}% of ${result.total} px differ (${result.size}, max channel delta ${result.maxDelta}/255)`,
      '< 0.1% differing',
    )
    expect(ratio).toBeLessThan(0.001)
  })

  /**
   * Metric (C3's flagged gap): the renderer is container-relative (D9), so the Pixi canvas'
   * backing store must follow a viewport change through the ResizeObserver — not just its
   * CSS box. `bringToFront` because a background tab throttles layout and the observer with it.
   */
  test('ResizeObserver: canvas backing store follows the container', async () => {
    await dm.bringToFront()
    const canvas = dm.locator('[data-testid="game-canvas"] canvas')
    const backing = () => canvas.evaluate((el: HTMLCanvasElement) => `${el.width}x${el.height}`)

    const before = await backing()
    await dm.setViewportSize({ width: 900, height: 600 })

    // The sidebar is a fixed 256px column (`md:w-64`, border-box) beside the map.
    await expect.poll(backing, { timeout: 10_000, intervals: [50] }).not.toBe(before)
    const after = await backing()
    const [width, height] = after.split('x').map(Number)

    record(
      'ResizeObserver canvas backing store',
      `${before} → ${after} on a 1280x720 → 900x600 viewport change`,
      '~644x600 (viewport minus the 256px sidebar)',
    )
    expect(Math.abs(width - 644)).toBeLessThanOrEqual(4)
    expect(Math.abs(height - 600)).toBeLessThanOrEqual(4)

    await dm.setViewportSize(VIEWPORT)
    await expect.poll(backing, { timeout: 10_000, intervals: [50] }).toBe(before)
  })

  /**
   * Metric: reconnect — full snapshot resume, no data loss.
   *
   * Two steps, because one is not enough: CDP's offline emulation blocks *new* connections
   * but leaves an already-established WebSocket up (measured — the banner never appeared),
   * so going offline alone tests nothing. Offline first (every reconnect attempt now fails,
   * which is what keeps the player dark long enough to be overtaken), then the live socket
   * is closed from inside the page. What the client sees is exactly a dropped connection:
   * `onclose`, `reconnecting`, jittered backoff, retries that fail.
   *
   * While the player is dark a *third* client joins the table over raw HTTP + WS, so "the
   * snapshot resumed" is provable by something the player could not possibly have known
   * before it dropped — not merely by state it still had in memory.
   */
  test('reconnect: full snapshot resume, no data loss', async () => {
    const roster = player.getByTestId('player-list')
    await expect(roster.getByRole('listitem')).toHaveCount(2)

    await playerContext.setOffline(true)
    await player.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.at(-1)?.close())
    await expect(player.getByTestId('reconnecting-banner')).toBeVisible({ timeout: 20_000 })
    // The last drawn frame stays up behind the banner — the banner is a strip, not a modal.
    expect(await loadedMapName(player)).toBe('Demo Dungeon')

    const zeph = await joinOverWire(code, 'Zeph')
    try {
      const started = Date.now()
      await playerContext.setOffline(false)

      await expect(player.getByTestId('connection-status')).toContainText('Connected', {
        timeout: 30_000,
      })
      await expect(roster.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 })
      const resumeMs = Date.now() - started

      record(
        'reconnect (network restored → snapshot re-applied)',
        `${resumeMs}ms, roster resumed to 3 including the player who joined while dark`,
        'full snapshot resume, no data loss',
      )

      await expect(roster).toContainText('Borin')
      await expect(roster).toContainText('DM')
      await expect(roster).toContainText('Zeph')
      await expect(player.getByTestId('reconnecting-banner')).toHaveCount(0)

      // No data loss: the map was never refetched and never dropped.
      await assertMapRendered(player)
    } finally {
      zeph.close()
    }
  })
})

/** A player that is a socket and nothing else — no browser, no renderer. */
async function joinOverWire(code: string, name: string): Promise<WebSocket> {
  const res = await fetch(`${SERVER_URL}/api/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name }),
  })
  const { token } = (await res.json()) as { token: string }
  const socket = new WebSocket(`${SERVER_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`)
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION }))
  return socket
}
