// @story — "Hide for me" keeps a handout hidden (table lobby pass, plan 4): after a reload, after
// a rejoin under the same name, and until the DM shows it again. Written, not run, in the
// builder step.
import type { Page } from '@playwright/test';
import { dmCommands, expect, test } from './fixtures';

/** The DM adds a handout and shows it to everyone as a card. */
async function showLetter(dm: Page): Promise<void> {
  await dm.keyboard.press('5');
  await dm.getByTestId('handout-add').click();
  await dm.getByLabel('Handout caption').fill('The letter');
  await dm.getByLabel('Handout text').fill('Meet me at the old mill.');
  await dm.getByTestId('handout-form').getByRole('button', { name: 'Add', exact: true }).click();
  await dm.getByTestId('handout-show').first().click();
}

test.describe('@story Hide for me', () => {
  test('stays hidden after a reload and a rejoin, and comes back when the DM shows it again', async ({ hostSession, joinAsPlayer }) => {
    const dm = hostSession.page;
    const player = await joinAsPlayer('Pia');
    await player.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await dmCommands(hostSession.token, [{ module: 'table', action: 'start', payload: { on: true } }]);
    await expect(player.getByTestId('lobby')).toBeHidden({ timeout: 30_000 });

    await showLetter(dm);
    await expect(player.getByTestId('story-handout')).toContainText('Meet me at the old mill.');
    await expect(dm.getByTestId('story-showing-count')).toHaveText('Still up for 1 of 1');

    await player.getByTestId('story-hide-for-me').click();
    await expect(player.getByTestId('story-handout')).toBeHidden();
    await expect(dm.getByTestId('story-showing-count')).toHaveText('Still up for 0 of 1');

    // A reload keeps the seat and asks the server again: still hidden.
    await player.reload();
    await expect(player.locator('[data-page="table"]')).toBeVisible({ timeout: 30_000 });
    await expect(player.getByTestId('title-card')).toBeVisible({ timeout: 30_000 });
    await expect(player.getByTestId('story-handout')).toHaveCount(0);
    // It stays in the journal.
    await player.getByRole('button', { name: 'Journal' }).click();
    await expect(player.getByTestId('journal-handout')).toContainText('The letter');

    // A rejoin under the same name, in a fresh tab: still hidden.
    await player.close();
    const again = await joinAsPlayer('Pia');
    await expect(again.getByTestId('title-card')).toBeVisible({ timeout: 30_000 });
    await expect(again.getByTestId('story-handout')).toHaveCount(0);

    // The DM shows it again: a new showing reaches the seat.
    await dm.getByTestId('handout-show').first().click();
    await expect(again.getByTestId('story-handout')).toContainText('Meet me at the old mill.');
  });
});
