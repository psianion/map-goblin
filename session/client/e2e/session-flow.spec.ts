import { expect, test } from '@playwright/test'
import { assertMapRendered, hostTable, joinTable } from './table'

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
    const roster = page.getByTestId('player-list')
    await expect(roster.getByRole('listitem')).toHaveCount(2, { timeout: 10_000 })
    await expect(roster).toContainText('Borin')
    await expect(roster).toContainText('DM')
  }

  await dmContext.close()
  await playerContext.close()
})
