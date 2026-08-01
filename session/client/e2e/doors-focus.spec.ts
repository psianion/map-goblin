import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { assertMapLoaded, assertMapRendered, GATE, hostTable, joinTable } from './table'

/**
 * @doors — the seat stays quiet when nobody is touching it.
 *
 * The gate walk twice caught a burst of commands nobody issued, both times just after the
 * browser moved focus off the DM tab: rooms revealed and re-hidden (which latches them to
 * Explored forever, and hands their geometry to every player who joins after), a door swung
 * shut and open again, and the fog tool armed on a seat that never clicked it.
 *
 * A command must originate from a pointer or a key on the seat that sent it. Nothing about a
 * tab going to the background, coming back, or losing and regaining focus is a user action,
 * so this row hides the DM tab, wakes it, and asserts the socket said nothing at all — no
 * command frame, no new log line, no tool armed. It watches the player seat the same way,
 * because a tab coming *to* the front is the other half of the same transition.
 *
 *   pnpm exec playwright test -c e2e/playwright.doors.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }

/** The log lines a phantom fog or door command would put words to. */
const COMMAND_LINE = /revealed|hid |opened|closed|locked|unlocked/

/**
 * Every command frame this tab's socket sends, in order. Attached before `goto`, so the
 * session socket is watched from its upgrade — a listener added later would miss exactly the
 * frames a lifecycle burst emits while the page is still settling.
 */
function watchCommands(page: Page): string[] {
  const sent: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      const payload =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')
      if (payload.includes('"type":"command"')) sent.push(payload)
    })
  })
  return sent
}

/** What the table log says happened, filtered to the verbs a command writes. */
async function commandLines(page: Page): Promise<string[]> {
  const lines = await page.getByTestId('game-log').locator('li').allInnerTexts()
  return lines.filter((line) => COMMAND_LINE.test(line))
}

/**
 * Background the tab the way a browser does when focus moves to another one.
 *
 * `bringToFront` on the other page is the real transition; the events are dispatched too
 * because a headed Chromium under Playwright does not reliably flip `visibilityState` for a
 * context whose window is merely behind another, and what this row is about is the handlers,
 * not the window manager.
 */
async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
  })
}

async function show(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    window.dispatchEvent(new Event('focus'))
  })
}

test.describe.serial('@doors focus', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let dmSent: string[]
  let playerSent: string[]
  let invite: string

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dmSent = watchCommands(dm)

    invite = await hostTable(dm, GATE)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, GATE)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    playerSent = watchCommands(player)
    await joinTable(player, invite, 'Borin')
    // A player holds no room until the DM reveals one, so there is no floor to draw yet.
    await assertMapLoaded(player, GATE)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
  })

  // The instrument first: a row asserting silence is worthless if it cannot hear a command.
  // One real click, and the door is put back the way it was found.
  test('the watcher hears a command the DM actually issues', async () => {
    // Shut, unlocked and not a secret: the one kind of door on this map that a single click
    // is guaranteed to swing (an archway is authored open and stays open). Pinned to its id
    // before anything moves — a locator that filters on `data-open` slides to the next door
    // the moment this one opens.
    const id = await dm
      .getByTestId('door-list')
      .locator('[data-door-id][data-locked="false"][data-open="false"]:not([data-secret])')
      .first()
      .getAttribute('data-door-id')
    const row = dm.getByTestId('door-list').locator(`[data-door-id="${id}"]`)
    await row.getByRole('button').click()
    await expect(dm.getByTestId('door-actions')).toBeVisible()

    dmSent.length = 0
    await dm.getByTestId('door-toggle').click()
    await expect(row).toHaveAttribute('data-open', 'true')
    expect(dmSent.filter((f) => f.includes('"module":"doors"'))).toHaveLength(1)

    await dm.getByTestId('door-toggle').click()
    await expect(row).toHaveAttribute('data-open', 'false')
  })

  test('hiding and waking the DM tab issues nothing', async () => {
    const before = await commandLines(dm)
    dmSent.length = 0
    playerSent.length = 0

    await player.bringToFront()
    await hide(dm)
    // Long enough to cross the overlay mount poll (200ms, sixty times over) and a socket
    // ping period (10s) — the window a lifecycle burst would land in.
    await dm.waitForTimeout(12_000)

    await dm.bringToFront()
    await show(dm)
    await dm.waitForTimeout(3_000)

    expect(dmSent).toEqual([])
    expect(playerSent).toEqual([])
    expect(await commandLines(dm)).toEqual(before)

    // The fog tool is a mode with two destructive buttons behind it (Reveal all, Hide all),
    // so "not armed" is part of the same guarantee: nothing armed it, nothing pressed them.
    await expect(dm.getByTestId('fog-tool-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(dm.getByTestId('fog-bar')).toHaveCount(0)
  })

  test('a seat that joins afterwards is handed no room the DM never revealed', async ({
    browser,
  }) => {
    // The consequence the gate walk actually saw: rooms latched to Explored leak their
    // geometry and their doors to everybody who joins later. Nothing above revealed a room,
    // so a fresh seat must arrive holding none.
    const lateContext = await browser.newContext({ viewport: VIEWPORT })
    const late = await lateContext.newPage()
    const lateSent = watchCommands(late)
    try {
      await joinTable(late, invite, 'Nyx')
      await assertMapLoaded(late, GATE)

      await expect(late.getByTestId('door-list').locator('[data-door-id]')).toHaveCount(0)
      expect(await commandLines(late)).toEqual([])
      expect(lateSent).toEqual([])
    } finally {
      await lateContext.close()
    }
  })
})
