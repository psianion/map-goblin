import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { TIME_WEATHER_FIXTURE, timeWeatherDoc } from './library'
import { assertMapLoaded, hostTable, joinTable, type MapUnderTest } from './table'
import { canvasPoint, createDef, placeToken, tokenPositions } from './tokens'

/**
 * @triggers — M5's live world state: a DM's time/weather picks land on every seat's status
 * bar and are heard as narration, and a `light` trigger's relight is the table's own
 * `visible` flag moving, not a separate "lighting" concept a player could see disagree with
 * the map underneath it.
 *
 *   pnpm exec playwright test -c e2e/playwright.time-weather.config.ts
 *
 * Fixture is `library.ts`'s `timeWeatherDoc`, built in memory the same way the M4 flagship's
 * is — no `.mapbuilder` on disk needed for one zone and one light.
 */

const VIEWPORT = { width: 1280, height: 720 }
const F = TIME_WEATHER_FIXTURE
const MAP: MapUnderTest = { doc: timeWeatherDoc('Lamplight Cell'), name: 'Lamplight Cell' }

// ── Instruments ────────────────────────────────────────────────────────────

/** Dispatch a command straight through the store — the way doors/triggers-flagship do. */
const sendCommand = (page: Page, module: string, action: string, payload: unknown): Promise<void> =>
  page.evaluate(
    ([m, a, p]) => {
      interface Tab {
        __sessionStore?: {
          getState(): { sendCommand(module: string, action: string, payload: unknown): void }
        }
      }
      ;(window as unknown as Tab).__sessionStore!.getState().sendCommand(m as string, a as string, p)
    },
    [module, action, payload] as [string, string, unknown],
  )

const sendMove = (page: Page, id: string, at: { x: number; y: number }): Promise<void> =>
  sendCommand(page, 'tokens', 'move', { id, x: at.x, y: at.y })

/** This tab's copy of one light child's `visible` flag off the core store — the same flag
 *  `LightManager`/`subscribeToStore` react to, read the way `lightSync.ts` itself reads it. */
function lightVisible(page: Page, lightId: string): Promise<boolean | undefined> {
  return page.evaluate((id) => {
    interface Tab {
      __STORE__?: {
        getState(): {
          layers: { type: string; children: { id: string; childType: string; visible: boolean }[] }[]
        }
      }
    }
    const layers = (window as unknown as Tab).__STORE__!.getState().layers
    for (const layer of layers) {
      if (layer.type !== 'dungeon') continue
      const child = layer.children.find((c) => c.id === id)
      if (child) return child.visible
    }
    return undefined
  }, lightId)
}

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@time-weather flagship', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let tokenId: string
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, MAP)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapLoaded(dm, MAP)

    playerContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    await assertMapLoaded(player, MAP)

    // A token for the light-trigger flow, parked outside the lamp zone. Moved with an exact
    // dispatch rather than a canvas drag, same reasoning as triggers-flagship.spec.ts: this
    // spec cares about exact world coordinates against the zone's rect.
    await createDef(dm, 'Scout')
    await placeToken(dm, 'Scout', await canvasPoint(dm, 0.5, 0.5))
    tokenId = Object.keys(await tokenPositions(dm))[0]!
    await sendMove(dm, tokenId, F.spawn)
    await expect.poll(() => tokenPositions(dm).then((p) => p[tokenId])).toEqual(F.spawn)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the time-weather flow:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('DM sets time and weather from the real control: every seat sees the badge and hears it', async () => {
    await expect(dm.getByTestId('env-time')).toBeVisible()

    await dm.getByTestId('env-time').selectOption('dusk')
    await expect(player.getByTestId('env-badge')).toHaveText('Dusk', { timeout: 20_000 })
    await expect(player.getByTestId('toast')).toContainText('Dusk settles', { timeout: 20_000 })

    await dm.getByTestId('env-weather').selectOption('rain')
    await expect(player.getByTestId('env-badge')).toHaveText('Dusk, Rain', { timeout: 20_000 })
    await expect(player.getByTestId('toast')).toContainText('Rain begins to fall', { timeout: 20_000 })
  })

  test('a light trigger fires: the map relights and the player hears it by name, never by id', async () => {
    expect(await lightVisible(player, F.lightId)).toBe(false)

    await sendMove(dm, tokenId, F.lampPoint)
    await expect.poll(() => tokenPositions(dm).then((p) => p[tokenId])).toEqual(F.lampPoint)

    await expect.poll(() => lightVisible(player, F.lightId), { timeout: 20_000 }).toBe(true)

    const toast = player.getByTestId('toast')
    await expect(toast).toContainText(`${F.lightName} lights`, { timeout: 20_000 })
    const toastText = await toast.textContent()
    expect(toastText).not.toContain(F.lightId)
  })
})
