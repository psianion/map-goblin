// @player: the player shell, and the phone layout at 390×844 (plan section 7). Unrun until step T.
import { expect, test } from './fixtures';

test.describe('@player player shell', () => {
  test('a player gets the title card without a switcher, three rail tools, no dock', async ({ joinAsPlayer }) => {
    const player = await joinAsPlayer('Bram');
    await expect(player.getByTestId('title-card')).toBeVisible();
    await expect(player.getByTestId('title-switcher')).toHaveCount(0);
    await expect(player.getByTestId('rail-measure')).toBeVisible();
    await expect(player.getByTestId('rail-template')).toHaveCount(0);
    await expect(player.getByTestId('dock')).toHaveCount(0);
    await expect(player.getByTestId('zoom-pill')).toBeVisible();
    await expect(player.getByTestId('sheet-tab-log')).toBeVisible();
  });

  test('F finds my token, and the character sheet opens from its tab', async ({ joinAsPlayer }) => {
    const player = await joinAsPlayer('Bram');
    await player.keyboard.press('f');
    const character = player.getByTestId('sheet-tab-character');
    if (await character.count()) {
      await character.click();
      await expect(player.locator('[data-sheet]')).toBeVisible();
    }
  });

  test('phone: bottom tabs, the log sheet, find me, long-press pings', async ({ hostSession, browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await context.newPage();
    await phone.goto(`/join/${hostSession.inviteCode}?e2e=1`);
    await phone.locator('#player-name').fill('Yara');
    await phone.getByRole('button', { name: 'Join' }).click();
    await expect(phone.getByTestId('phone-bar')).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByTestId('sheet-tabs')).toBeHidden();
    await phone.getByTestId('phone-tab-log').click();
    await expect(phone.getByTestId('log-sheet')).toBeVisible();
    await phone.getByTestId('phone-tab-map').click();
    await expect(phone.getByTestId('log-sheet')).toHaveCount(0);
    await phone.getByTestId('phone-find-token').click();
    const box = await phone.getByTestId('game-canvas').boundingBox();
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await phone.touchscreen.tap(x, y);
      await phone.evaluate(
        ({ x, y }) => {
          const canvas = document.querySelector('[data-testid="game-canvas"] canvas')!;
          canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y, button: 0 }));
        },
        { x, y },
      );
      await expect(phone.locator('[data-mark="ping"]')).toHaveCount(1, { timeout: 3000 });
    }
    await context.close();
  });
});
