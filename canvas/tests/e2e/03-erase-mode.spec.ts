import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame, getPixelColor, shapeCount } from './helpers';

test.describe('03 - Erase Mode', () => {
  test('erase mode toggle via E key', async ({ page }) => {
    await gotoApp(page);
    const eraseMode = () =>
      page.evaluate(
        () =>
          (window as Window & { __store?: { getState: () => { tools: { eraseMode: boolean } } } })
            .__store!.getState().tools.eraseMode,
      );

    expect(await eraseMode()).toBe(false);

    await page.keyboard.press('e');
    await waitFrame(page, 2);
    expect(await eraseMode()).toBe(true);

    await page.keyboard.press('e');
    await waitFrame(page, 2);
    expect(await eraseMode()).toBe(false);
  });

  test('erasing removes floor pixels', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const shapesBefore = await shapeCount(page);
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);
    expect(await shapeCount(page)).toBe(shapesBefore + 1);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const sampleX = Math.round((box!.width / 2) * dpr);
    const sampleY = Math.round((box!.height / 2) * dpr);
    const beforeErase = await getPixelColor(page, sampleX, sampleY);

    await page.keyboard.press('e');
    await waitFrame(page, 2);

    await drawRect(page, cx - 40, cy - 30, cx + 40, cy + 30);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    const afterErase = await getPixelColor(page, sampleX, sampleY);
    const diff = Math.abs(afterErase.r - beforeErase.r) + Math.abs(afterErase.g - beforeErase.g);
    expect(diff).toBeGreaterThan(5);
  });
});
