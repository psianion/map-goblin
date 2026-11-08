// @map: the Fog and Map tabs (plan section 7). Unrun until step T.
import { expect, test } from './fixtures';

test.describe('@map fog and map', () => {
  test('Fog: reveal and hide a room, rect, the look picker', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('1');
    const rooms = page.getByTestId('fog-rooms');
    await expect(rooms).toBeVisible();
    const first = rooms.locator('[data-room-id]').first();
    const id = await first.getAttribute('data-room-id');
    const room = rooms.locator(`[data-room-id="${id}"]`);
    await room.getByTestId('room-reveal').click();
    await expect(room).toHaveAttribute('data-fog-status', 'revealed');
    await room.getByTestId('room-hide').click();
    await expect(room).not.toHaveAttribute('data-fog-status', 'revealed');

    await page.getByRole('button', { name: 'Vision' }).click();
    // The rectangle is a vision-mode tool: wait for the mode to come back from the server.
    await expect(page.getByTestId('fog-rect')).toBeEnabled();
    await page.keyboard.press('Shift+R');
    await expect(page.getByTestId('fog-rect')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    await page.getByText('Look').click();
    await page.getByTestId('fog-look-mist').click();
    await expect(page.getByTestId('fog-look-mist')).toHaveAttribute('data-pressed', '');
  });

  test('Map: doors open and lock, a secret is revealed', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('map-family-doors').click();
    // The first lockable door: an archway (Goblin Warren's first two) has no door to open or lock.
    const door = page.getByTestId('map-doors').locator('[data-door-id]').filter({ has: page.getByTestId('door-lock') }).first();
    await door.getByTestId('door-toggle').click();
    await expect(door).toHaveAttribute('data-open', 'true');
    await door.getByTestId('door-lock').click();
    await expect(door).toHaveAttribute('data-locked', 'true');
    const secret = page.getByTestId('door-reveal-secret').first();
    if (await secret.count()) {
      await secret.click();
      await expect(secret).toBeDisabled();
    }
  });

  test('Map: lights on and off, triggers fire', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('map-family-lights').click();
    const lights = page.getByTestId('map-lights');
    if (await lights.count()) {
      const toggle = lights.getByRole('switch').first();
      const before = await toggle.getAttribute('aria-checked');
      await toggle.click();
      await expect(toggle).not.toHaveAttribute('aria-checked', before ?? '');
    }
    await page.getByTestId('map-family-triggers').click();
    const fire = page.getByTestId('trigger-fire').first();
    if (await fire.count()) {
      await fire.click();
      await expect(fire).toBeDisabled();
      // Re-arm waits on a server command; the button says so rather than failing.
      await expect(page.getByTestId('trigger-rearm').first()).toBeDisabled();
    }
  });

  test('Map: a room key sheet opens and shares its read-aloud', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('room-key').first().click();
    const sheet = page.getByTestId('room-key-sheet');
    await expect(sheet).toBeVisible();
    const share = sheet.getByTestId('room-share');
    if (await share.count()) {
      await share.click();
      await expect(sheet).toContainText('Shared');
    }
  });
});
