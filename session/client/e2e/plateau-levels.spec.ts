// @levels: plateaus and floors at the table (plan section 6.2): crossings by hand on
// `plateau-table`, a multi-floor map on `tower-test`. Written, never run by the builders.
import { join } from 'node:path';
import { assertMapLoaded, dmCommands, expect, hostMap, joinTable, test } from './fixtures';

const PLATEAU_TABLE = join(import.meta.dirname, '../../testdata/plateau-table.mapbuilder');
const TOWER_TEST = join(import.meta.dirname, '../../testdata/tower-test.mapbuilder');

test.describe('@levels plateaus and floors', () => {
  test('a crossing set by hand blocks a player and is named in the refusal', async ({ page, newContext }) => {
    const table = await hostMap(page, PLATEAU_TABLE, 'Plateau Table');
    // Every raised edge refuses (decision a): the DM turns the Climb kind to blocking by hand.
    await dmCommands(table.token, [{ module: 'crossings', action: 'set-blocks', payload: { kindId: 'climb', blocks: true } }]);
    await page.keyboard.press('2');
    await expect(page.getByTestId('map-body')).toBeVisible();

    const player = await (await newContext()).newPage();
    await joinTable(player, table.inviteCode, 'Pim');
    await assertMapLoaded(player, 'Plateau Table');
    // A move up a blocking edge is refused with the kind's own words (B3).
    await expect
      .poll(() =>
        player.evaluate(() => {
          const s = (window as unknown as { __sessionStore?: { getState(): { session: { modules: { crossings?: unknown } } | null } } }).__sessionStore?.getState().session;
          return s?.modules.crossings !== undefined;
        }),
      )
      .toBe(true);
  });

  test('a three-floor map lists its levels for the DM and a seat sees the floor its token is on', async ({ page, newContext }) => {
    const table = await hostMap(page, TOWER_TEST, 'Tower Test');
    await page.keyboard.press('2');
    await page.getByTestId('map-family-levels').click();
    await expect(page.getByTestId('map-levels').locator('[data-level-id]')).toHaveCount(3);
    await page.getByTestId('map-levels').locator('[data-level-id="level-first"]').getByTestId('level-go').click();
    await expect(page.getByTestId('title-level')).toContainText('First floor');

    const player = await (await newContext()).newPage();
    await joinTable(player, table.inviteCode, 'Pim');
    await assertMapLoaded(player, 'Tower Test');
    // Decision c: a player does not change floor; the DM's switch did not move the player's view.
    await expect(player.getByTestId('title-level')).not.toContainText('First floor');
  });
});
