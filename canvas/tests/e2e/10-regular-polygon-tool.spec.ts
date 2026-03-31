import { test, expect } from '@playwright/test';
import { gotoApp, firePointer, waitFrame, getPixelColor } from './helpers';

test.describe('10 - Regular Polygon Tool', () => {
  test('drag to draw a regular polygon', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('h');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1);
    await firePointer(page, 'pointermove', cx + 80, cy, 0.5, 1);
    await firePointer(page, 'pointerup', cx + 80, cy, 0, 0);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const pixel = await getPixelColor(page,
      Math.round((box!.width / 2) * dpr),
      Math.round((box!.height / 2) * dpr));
    expect(pixel.a).toBe(255);
  });
});
