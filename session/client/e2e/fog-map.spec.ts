// @map: the Fog and Map tabs (plan section 7). Unrun until step T.
import { dmCommands, expect, test } from './fixtures';

test.describe('@map fog and map', () => {
  test('Fog: reveal and hide a room, rect, the look picker', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('1');
    const rooms = page.getByTestId('fog-rooms');
    await expect(rooms).toBeVisible();
    const first = rooms.locator('[data-room-id]:not([data-room-id^="@outdoors"])').first();
    const id = await first.getAttribute('data-room-id');
    const room = rooms.locator(`[data-room-id="${id}"]`);
    await room.getByTestId('room-reveal').click();
    await expect(room).toHaveAttribute('data-fog-status', 'revealed');
    await room.getByTestId('room-hide').click();
    await expect(room).not.toHaveAttribute('data-fog-status', 'revealed');

    await page.getByTestId('fog-mode-vision').click();
    // The rectangle is a vision-mode tool: wait for the mode to come back from the server.
    await expect(page.getByTestId('fog-rect')).toBeEnabled();
    await page.keyboard.press('Shift+R');
    // F21: an armed fog tool folds the dock and names itself in the chip above the tab row.
    await expect(page.getByTestId('armed-chip')).toContainText('Fog');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('armed-chip')).toHaveCount(0);
    await page.keyboard.press('1');

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
      const rearm = page.getByTestId('trigger-rearm').first();
      await expect(rearm).toBeDisabled();
      await fire.click();
      await expect(fire).toBeDisabled();
      await expect(rearm).toBeEnabled();
      await rearm.click();
      await expect(fire).toBeEnabled();
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

// Table fix pass section 4.5 (F8, F9): the mode as two tiles, Outdoors first, the party badge,
// and a warning when nobody can see.
test.describe('@map the Fog tab after the fix pass', () => {
  test('mode tiles, Outdoors first, a party badge and the no-party warning', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('1');
    await expect(page.getByTestId('fog-mode-vision')).toBeVisible();
    await expect(page.getByTestId('fog-mode-rooms')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('fog-mode-chip')).toHaveText('Fog: by hand');
    await expect(page.getByTestId('fog-rooms').locator('[data-room-id]').first()).toHaveAttribute('data-room-id', '@outdoors');
    // The fixture's PC tokens stand in the starting room: it carries the party badge.
    await expect(page.getByTestId('fog-party-here').first()).toBeVisible();
    await page.getByTestId('fog-mode-vision').click();
    await expect(page.getByTestId('fog-mode-chip')).toHaveText('Fog: by sight');
  });
});

// T11 (I1): Hide all, then Reveal all, in By sight. A party token always sees its surroundings,
// so the player is still sent, and still shown, the ground the token stands on.
test.describe('@map By sight after Hide all and Reveal all', () => {
  test('a player still sees the ground they stand on', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Pim');
    type Probe = {
      __sessionStore: {
        getState(): {
          you: { identityId: string } | null;
          mapData: { openGround?: unknown[] } | null;
          session: { activeSceneId: string; modules: { tokens: { byScene: Record<string, Record<string, { id: string; name: string; ownerId: string | null }>> } } } | null;
        };
      };
    };
    const me = await player.evaluate(() => (window as unknown as Probe).__sessionStore.getState().you!.identityId);
    const bram = await page.evaluate(() => {
      const st = (window as unknown as Probe).__sessionStore.getState();
      return Object.values(st.session!.modules.tokens.byScene[st.session!.activeSceneId]).find((t) => t.name === 'Bram')!.id;
    });
    await dmCommands(hostSession.token, [{ module: 'tokens', action: 'assign', payload: { id: bram, identityId: me } }]);

    await page.keyboard.press('1');
    await page.getByTestId('fog-mode-vision').click();
    await expect(page.getByTestId('fog-mode-vision')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('fog-hide-all').click();
    await page.getByTestId('fog-reveal-all').click();
    // Reveal all reveals the Outdoors row with the rooms (I2).
    await expect(page.getByTestId('fog-rooms').locator('[data-room-id="@outdoors"]')).toHaveAttribute('data-fog-status', 'revealed');

    // The player still holds the open ground under Bram, so the fog leaves it clear.
    await expect
      .poll(() => player.evaluate(() => ((window as unknown as Probe).__sessionStore.getState().mapData?.openGround?.length ?? 0) > 0))
      .toBe(true);
  });
});
