// @scenes: the World and Scenes tabs, and the campaign export (plan section 7). Unrun until step T.
import { DEMO_NAME, SECOND_MAP, SECOND_NAME, expect, test } from './fixtures';

test.describe('@scenes world and scenes', () => {
  test('World: clock jumps, weather, darkness, and the title card chip follows', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('6');
    await page.getByText('Dawn').click();
    await expect(page.getByTestId('title-world')).toContainText('Dawn');
    await page.getByTestId('world-plus-6h').click();
    await expect(page.getByTestId('title-world')).not.toContainText('Dawn');
    await page.getByTestId('weather-rain').click();
    await expect(page.getByTestId('title-world')).toContainText('Rain');
  });

  test('World: a seat is pinned to a level when the map has several', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    await joinAsPlayer('Pia');
    await page.keyboard.press('6');
    const seats = page.getByTestId('world-seats');
    if (await seats.count()) {
      const pick = seats.locator('select').first();
      const second = await pick.locator('option').nth(2).getAttribute('value');
      if (second) {
        await pick.selectOption(second);
        await expect(pick).toHaveValue(second);
      }
    }
  });

  test('Scenes: import, Prepare then Switch now, delete behind its confirm', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('7');
    await page.getByTestId('scene-import-input').setInputFiles(SECOND_MAP);
    await expect(page.getByTestId('scene-card')).toHaveCount(2);
    // Pinned by name: a filter on Live would stop matching the moment the card goes live.
    const other = page.getByTestId('scene-card').filter({ hasText: SECOND_NAME });
    await other.getByTestId('scene-prepare').click();
    await expect(other.getByTestId('scene-ready')).toBeVisible();
    await other.getByTestId('scene-switch').click();
    await expect(other.getByTestId('scene-live')).toBeVisible();

    const old = page.getByTestId('scene-card').filter({ hasText: DEMO_NAME });
    await old.locator('button').first().click();
    await page.getByTestId('scene-delete').click();
    await expect(page.getByTestId('scene-delete-confirm')).toContainText('Fog, tokens and notes go too.');
    await page.getByTestId('scene-delete-yes').click();
    await expect(page.getByTestId('scene-card')).toHaveCount(1);
  });

  test('Session: Export campaign downloads a zip', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.getByTestId('session-menu').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-campaign').click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  });
});
