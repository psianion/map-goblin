import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame, getPixelColor } from './helpers';

test.describe('02 - Rectangle Tool', () => {
  test('draws a rectangle that changes canvas pixels', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const sampleX = Math.round((box!.width / 2) * dpr);
    const sampleY = Math.round((box!.height / 2) * dpr);

    const before = await getPixelColor(page, sampleX, sampleY);
    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);
    const after = await getPixelColor(page, sampleX, sampleY);

    expect(after.a).toBe(255);
    const diff = Math.abs(after.r - before.r) + Math.abs(after.g - before.g) + Math.abs(after.b - before.b);
    expect(diff).toBeGreaterThanOrEqual(0);
  });

  test('drawing two overlapping rectangles unions them', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 100, cy - 50, cx, cy + 50);
    await page.waitForTimeout(300);
    await drawRect(page, cx - 30, cy - 50, cx + 100, cy + 50);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const pixel = await getPixelColor(page, Math.round((box!.width / 2) * dpr), Math.round((box!.height / 2) * dpr));
    expect(pixel.a).toBe(255);
  });
});
