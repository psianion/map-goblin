import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  ATTACK_ROLL,
  DAMAGE_ROLL,
  WHISPER_ROLL,
} from '../src/modules/rolls/beyond20.fixtures'
import { hostTable, joinTable } from './table'

/**
 * @sprint2-rolls — §2.6 "Roll sync + whisper privacy", three contexts: DM, player A,
 * player B.
 *
 * The roll arrives the way a real one does — a `Beyond20_RenderedRoll` CustomEvent
 * dispatched into player A's page, carrying the payload shapes from the extension's own
 * DOM/Message API (`../src/modules/rolls/beyond20.fixtures`, the same fixtures the
 * translation unit tests run on). What is *not* faked is everything after: the client's
 * capture-phase listener, `rolls:post`, the server's redaction, the broadcast, and three
 * separate GameLogs.
 *
 * The whisper assertion is deliberately two assertions. "Player B's log does not show it"
 * is what a UI bug would satisfy; "player B's socket never received the bytes" is the
 * property (the anti-Owlbear check, §2.6). Playwright taps the frames for the second.
 *
 * No `assertMapRendered` here: nothing in this file touches the renderer, and skipping the
 * asset-pack install saves ~4s per context. The scene spec covers the render path.
 */

const LOG = 'game-log'

/**
 * Beyond20 dispatches on `document` with `detail: [request]`; the client listens on
 * `window` in the capture phase, so this is the real delivery path, not a shortcut into
 * the handler.
 */
const dispatchRoll = (page: Page, detail: unknown): Promise<void> =>
  page.evaluate((payload) => {
    document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: payload }))
  }, detail)

test.describe.serial('@sprint2-rolls', () => {
  let contexts: BrowserContext[] = []
  let dm: Page
  let alice: Page
  let bob: Page
  /** Every WS frame Bob's page received, verbatim. */
  const bobFrames: string[] = []

  test.beforeAll(async ({ browser }) => {
    const open = async (): Promise<Page> => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
      contexts.push(context)
      const page = await context.newPage()
      page.on('pageerror', (e) => console.log('[pageerror]', e.message))
      return page
    }

    dm = await open()
    const code = await hostTable(dm)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()

    alice = await open()
    await joinTable(alice, code, 'Alice')

    bob = await open()
    // Installed before the join, because the socket to tap is opened during it.
    bob.on('websocket', (ws) =>
      ws.on('framereceived', ({ payload }) => {
        bobFrames.push(typeof payload === 'string' ? payload : payload.toString('utf8'))
      }),
    )
    await joinTable(bob, code, 'Bob')

    // All three are at the table before anything is rolled, so an absent line later is a
    // redaction and not a race with a join.
    for (const page of [dm, alice, bob]) {
      await expect(page.getByTestId('player-list').getByRole('listitem')).toHaveCount(3, {
        timeout: 15_000,
      })
    }
  })

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    contexts = []
  })

  test('a public DDB roll reaches every log at the table', async () => {
    await dispatchRoll(alice, ATTACK_ROLL)

    for (const page of [alice, dm, bob]) {
      const log = page.getByTestId(LOG)
      await expect(log).toContainText('Longsword: Attack', { timeout: 10_000 })
      // The kept d20, not the raw dice: the total is display data the server never recomputes.
      await expect(log).toContainText('24')
      // Attribution is the DDB character name riding along (D7), not the tab's login.
      await expect(log).toContainText('Thalia Brightwood')
    }
  })

  test('a whisper reaches the roller and the DM, and never reaches the other player', async () => {
    await dispatchRoll(alice, WHISPER_ROLL)

    for (const page of [alice, dm]) {
      const log = page.getByTestId(LOG)
      await expect(log).toContainText('Wisdom Saving Throw', { timeout: 10_000 })
      await expect(log.locator('[data-whisper]')).toHaveCount(1)
    }

    // A barrier, so "Bob has not got it" is not "Bob has not got it *yet*": a public roll
    // sent after the whisper, on the same socket. Frames are ordered, so once Bob's log
    // shows this one, whatever the server decided about the whisper has already arrived.
    await dispatchRoll(alice, DAMAGE_ROLL)
    await expect(bob.getByTestId(LOG)).toContainText('Fireball: Damage', { timeout: 10_000 })

    await expect(bob.getByTestId(LOG)).not.toContainText('Wisdom Saving Throw')
    await expect(bob.getByTestId(LOG)).not.toContainText('Grum the Unwise')
    await expect(bob.getByTestId(LOG).locator('[data-whisper]')).toHaveCount(0)

    // The property, not the presentation: it was never on the wire to this browser.
    expect(bobFrames.length).toBeGreaterThan(0)
    expect(bobFrames.filter((frame) => frame.includes('Fireball')).length).toBeGreaterThan(0)
    for (const frame of bobFrames) {
      expect(frame).not.toContain('Wisdom Saving Throw')
      expect(frame).not.toContain('Grum the Unwise')
    }
  })

  test('the manual input posts a line everyone sees', async () => {
    await bob.getByTestId('manual-roll').fill('stealth 17')
    await bob.getByTestId('manual-roll').press('Enter')

    for (const page of [bob, dm, alice]) {
      await expect(page.getByTestId(LOG)).toContainText('stealth 17', { timeout: 10_000 })
    }
    // Cleared on submit, so the next roll is not appended to the last one.
    await expect(bob.getByTestId('manual-roll')).toHaveValue('')
  })
})
