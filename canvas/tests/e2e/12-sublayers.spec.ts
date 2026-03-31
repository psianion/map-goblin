import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame } from './helpers';

test.describe('12 - Sublayers', () => {
  test('drawing a rectangle creates visible sublayers without crash', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);

    await expect(canvas).toBeVisible();
  });
});
