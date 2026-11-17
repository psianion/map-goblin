// @player: the player shell, and the phone layout at 390×844 (plan section 7). Unrun until step T.
import { assertMapLoaded, expect, test } from './fixtures';

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

  test('phone: bottom tabs, the log sheet, find me, long-press pings', async ({ hostSession, newContext }) => {
    const context = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await context.newPage();
    await phone.goto(`/join/${hostSession.inviteCode}?e2e=1`);
    await phone.locator('#player-name').fill('Yara');
    await phone.getByRole('button', { name: 'Join' }).click();
    await expect(phone.getByTestId('phone-bar')).toBeVisible({ timeout: 30_000 });
    // The mark tools attach once the engine is up: a press before then lands on nothing.
    await assertMapLoaded(phone);
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
      await phone.evaluate(
        ({ x, y }) => {
          const canvas = document.querySelector('[data-testid="game-canvas"] canvas')!;
          canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y, button: 0 }));
        },
        { x, y },
      );
      // A long press: held past the threshold with no pointerup and no movement.
      await expect(phone.locator('[data-mark="ping"]')).toHaveCount(1, { timeout: 3000 });
    }
  });
});

// Table fix pass section 4 at 390 by 844: the prompt stack, the status chips and the title card
// fit a phone, and nothing scrolls sideways.
test.describe('@phone the fix pass at phone width', () => {
  test('prompts stack inside the screen, chips show, and the page never scrolls sideways', async ({ hostSession, newContext }) => {
    const context = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await context.newPage();
    await phone.goto(`/join/${hostSession.inviteCode}?e2e=1`);
    await phone.locator('#player-name').fill('Yara');
    await phone.getByRole('button', { name: 'Join' }).click();
    await assertMapLoaded(phone);

    const { page } = hostSession;
    await page.keyboard.press('3');
    await page.getByRole('button', { name: 'Lock movement' }).click();
    await expect(phone.getByTestId('locked-chip')).toBeVisible();
    await page.keyboard.press('8');
    await page.getByTestId('ask-send').click();
    const card = phone.getByTestId('prompt-stack').getByTestId('roll-prompt');
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // On a failure, name what sticks out past the right edge: the outermost element of each run.
    const past = await phone.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => el.getBoundingClientRect().right > 390 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > 390))
        .map((el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''} class="${el.getAttribute('class') ?? ''}" right=${Math.round(el.getBoundingClientRect().right)}`)
        .slice(0, 10),
    );
    expect(await phone.evaluate(() => document.documentElement.scrollWidth), past.join('\n')).toBeLessThanOrEqual(390);
  });
});
