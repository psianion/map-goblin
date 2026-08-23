import { expect, test } from '@playwright/test'
import { assertMapRendered, hostTable, joinTable, openSession } from './table'

/**
 * @sprint1-flow — the ⭐ demo as a test: create campaign → upload a lit dungeon → start
 * session → a second browser context joins by link → both see the same map and the same
 * two-person roster.
 *
 * The steps live in `./table.ts` because I2's timed metrics hang their stopwatches off
 * exactly these predicates (`hostTable` returns the invite code; `assertMapRendered` is
 * the "rendered" predicate). Same steps, two suites: this one on the dev server, the
 * metrics one on a production build (`playwright.metrics.config.ts`).
 */

test('@sprint1-flow DM hosts a lit dungeon and a player joins the same table', async ({
  browser,
}) => {
  const dmContext = await browser.newContext()
  const dm = await dmContext.newPage()
  dm.on('pageerror', (e) => console.log('[dm pageerror]', e.message))

  const code = await hostTable(dm)

  await dm.getByRole('button', { name: 'Enter table' }).click()
  await expect(dm.locator('[data-page="table"]')).toBeVisible()
  await assertMapRendered(dm)

  // A rail icon opens its panel when the press lands on a stroke of the glyph, not only on
  // the padding around it (8f3a7cd). `Icon` handed React a fresh `dangerouslySetInnerHTML`
  // object every render and the rail re-renders on focus, so the <path> under the finger was
  // replaced between mousedown and mouseup, the browser had no common ancestor to fire
  // `click` on, and the panel silently never opened. `icons.test.tsx` pins the object
  // identity; only a real browser can pin the gesture, which is this row.
  //
  // Initiative because its first path is the M5 5 → L19 19 diagonal: the centre of that
  // path's box is *on* the stroke, where every other rail glyph's centre is in a hole and
  // the press would land on the button instead — which never broke.
  const railIcon = dm.getByTestId('rail-initiative')
  const stroke = await railIcon.locator('path').first().boundingBox()
  const button = await railIcon.boundingBox()
  expect(stroke && button, 'the Initiative rail icon drew no glyph to press').toBeTruthy()
  await railIcon.click({
    position: {
      x: stroke!.x + stroke!.width / 2 - button!.x,
      y: stroke!.y + stroke!.height / 2 - button!.y,
    },
  })
  await expect(dm.locator('[data-testid="popover"][data-panel="initiative"]')).toBeVisible()
  await dm.keyboard.press('Escape')

  await openSession(dm)
  await expect(dm.getByTestId('player-list').getByRole('listitem')).toHaveCount(1)

  // Second context = a second browser as far as storage and sockets are concerned.
  const playerContext = await browser.newContext()
  const player = await playerContext.newPage()
  player.on('pageerror', (e) => console.log('[player pageerror]', e.message))

  await joinTable(player, code, 'Borin')
  await assertMapRendered(player)

  // Both rosters, both contexts: the player's from its own snapshot, the DM's from the
  // `player-joined` broadcast it received while sitting on the table.
  for (const page of [dm, player]) {
    await openSession(page)
    const roster = page.getByTestId('player-list')
    await expect(roster.getByRole('listitem')).toHaveCount(2, { timeout: 10_000 })
    await expect(roster).toContainText('Borin')
    await expect(roster).toContainText('DM')
  }

  await dmContext.close()
  await playerContext.close()
})
