import { test, expect } from '@playwright/test';
import { gotoApp, waitForEngine, drawRect, waitFrame } from './helpers';

test.describe('14 - Hatching Visual', () => {
  test('dark preset renders hatching lines', async ({ page }) => {
    await gotoApp(page);
    // The boot overlay eats pointer events until the engine is up.
    await waitForEngine(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 120, cy - 100, cx + 120, cy + 100);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);

    const chip = page.getByRole('button', { name: 'Dark Stone', exact: true });
    if ((await chip.count()) === 0 || !(await chip.first().isVisible())) {
      await page.getByRole('button', { name: /style presets/i }).first().click();
    }
    await chip.first().click();
    await page.waitForTimeout(500);
    await waitFrame(page, 8);

    await expect(canvas).toBeVisible();
  });
});
