// @scenes: the Sky and Scenes tabs, and the campaign export (plan section 7). Unrun until step T.
import { DEMO_NAME, SECOND_MAP, SECOND_NAME, expect, test } from './fixtures';

test.describe('@scenes world and scenes', () => {
  test('Sky: the time tiles set the time, and the title card chip follows for a second seat', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Pia');
    await page.keyboard.press('6');
    const sky = page.getByTestId('world-body');
    await expect(sky.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    await sky.getByRole('button', { name: 'Dusk' }).click();
    await expect(sky.getByRole('button', { name: 'Dusk' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('title-world')).toHaveText('Dusk');
    await expect(player.getByTestId('title-world')).toHaveText('Dusk');
    await sky.getByRole('button', { name: 'Night' }).click();
    await expect(player.getByTestId('title-world')).toHaveText('Night');
  });

  test('Sky: Auto darkness is the start, and no weather, moon or clock controls are left', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('6');
    const sky = page.getByTestId('world-body');
    await expect(sky.getByText('Darkness · Auto')).toBeVisible();
    await expect(sky.getByTestId('world-darkness-auto')).toBeDisabled();
    await expect(sky.getByText(/weather|moon|speed/i)).toHaveCount(0);
  });

  test('Map: a seat is pinned to a level from the Levels strip when the map has several', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    await joinAsPlayer('Pia');
    await page.keyboard.press('2');
    const seats = page.getByTestId('level-seats');
    if (await seats.count()) {
      const pin = seats.first().locator('[data-testid^="level-seat-"]').first();
      await pin.click();
      await expect(pin).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('Room key: a room is flipped to Outdoor for the scene and handed back to As built', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('room-key').first().click();
    const sheet = page.getByTestId('room-key-sheet');
    await expect(sheet).toBeVisible();
    const place = sheet.getByRole('group', { name: 'Room place' });
    await expect(place.getByRole('button', { name: 'As built' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('room-built-place')).toContainText('Built as');
    await place.getByRole('button', { name: 'Outdoor' }).click();
    await expect(place.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
    await place.getByRole('button', { name: 'As built' }).click();
    await expect(place.getByRole('button', { name: 'As built' })).toHaveAttribute('aria-pressed', 'true');
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
