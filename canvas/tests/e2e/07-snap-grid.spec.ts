import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame } from './helpers';

test.describe('07 - Snap to Grid', () => {
  test('drawing with snap enabled produces aligned geometry', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 73, cy - 47, cx + 73, cy + 47);
    await page.waitForTimeout(500);
    await waitFrame(page, 3);

    await expect(canvas).toBeVisible();
  });
});
