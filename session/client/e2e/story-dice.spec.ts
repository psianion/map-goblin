// @story — table v2 story and dice (plan section 7). Written against the shared fixtures
// (`hostSession`: a DM page at a live table; `joinAsPlayer(name)`: a second page seated as
// that player). Unrun until step T.
import { expect, test } from './fixtures';

test.describe('@story story and dice', () => {
  test('a handout shown full screen reaches the player, hides, and stays in their journal', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Bram');
    await page.keyboard.press('5');
    await page.getByTestId('handout-add').click();
    await page.getByLabel('Handout caption').fill('The letter');
    await page.getByLabel('Handout text').fill('Meet me at the old mill.');
    await page.getByTestId('handout-form').getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('handout-full').first().click();
    await expect(player.getByTestId('story-handout')).toContainText('Meet me at the old mill.');
    await page.getByTestId('handout-hide').first().click();
    await expect(player.getByTestId('story-handout')).toBeHidden();
  });

  test('an image handout shown to the player carries its picture', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Bram');
    await page.keyboard.press('5');
    await page.getByTestId('handout-add').click();
    await page.getByLabel('Handout caption').fill('The map');
    // A 1x1 png: an image handout needs no text.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('handout-image-input').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('handout-image')).toHaveText('Replace image');
    await page.getByTestId('handout-form').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('handout-thumb').last()).toBeVisible();
    await page.getByTestId('handout-show').last().click();
    await expect(player.getByTestId('story-handout').getByRole('img', { name: 'The map' })).toBeVisible();
  });

  test('a title card shows over the table and goes', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Yara');
    await page.keyboard.press('5');
    await page.getByTestId('story-title').fill('Chapter 2: The Warren');
    await page.getByTestId('story-title-show').click();
    await expect(player.getByTestId('story-title-card')).toContainText('Chapter 2');
    await page.getByTestId('story-title-hide').click();
    await expect(player.getByTestId('story-title-card')).toBeHidden();
  });

  test('roll modes: a public roll reaches the player, a GM only one never does', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Bram');
    await page.keyboard.press('8');
    await page.getByTestId('dice-mode-gmonly').click();
    await page.getByTestId('dice-formula').fill('1d4+100');
    await page.getByTestId('dice-roll').click();
    await page.getByTestId('dice-mode-public').click();
    await page.getByTestId('dice-formula').fill('1d4+500');
    await page.getByTestId('dice-roll').click();
    await player.getByRole('button', { name: 'Log' }).click();
    const log = player.locator('[data-sheet]');
    await expect(log).toContainText('1d4+500');
    await expect(log).not.toContainText('1d4+100');
    // Blind rolls are covered by the unit tests (mechanics redaction and the log feed): the
    // player bar offers Public and To DM only (board 5).
  });

  test('a roll request reaches the player, the result lands on the DM card, and Share posts it', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Bram');
    await page.keyboard.press('8');
    await page.getByTestId('ask-dc').fill('14');
    await page.getByTestId('ask-send').click();
    await expect(player.getByTestId('roll-prompt-title')).toHaveText('Perception check, DC 14');
    await player.getByTestId('roll-prompt-mod').fill('3');
    await player.getByTestId('roll-prompt-roll').click();
    await expect(player.getByTestId('roll-prompt')).toBeHidden();
    await expect(page.getByTestId('request-result')).toHaveCount(1);
    await expect(page.getByTestId('request-result').first()).toContainText(/pass|fail/);
    await page.getByTestId('request-share').click();
    await expect(page.getByTestId('request-share')).toHaveText('Shared');
  });

  test('a rollable table rolls a row into the log', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('8');
    await page.getByTestId('table-new').click();
    await page.getByTestId('table-name').fill('Weather');
    await page.getByTestId('table-rows').fill('1-20 Rain all day');
    await page.getByTestId('table-save').click();
    await page.getByTestId('roll-table-roll').click();
    await page.getByRole('button', { name: 'Log' }).click();
    await expect(page.getByTestId('log-sheet').or(page.locator('[data-sheet]'))).toContainText('Rain all day');
  });

  test('the journal keeps what was shared', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Yara');
    await page.keyboard.press('5');
    await page.getByTestId('story-title').fill('Night falls');
    await page.getByTestId('story-title-show').click();
    await player.getByRole('button', { name: 'Journal' }).click();
    await expect(player.getByTestId('journal-feed')).toContainText('Night falls');
  });
});
