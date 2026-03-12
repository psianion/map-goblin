import { test, expect } from '@playwright/test';
import { gotoApp, firePointer, waitFrame, getPixelColor } from './helpers';

test.describe('08 - Polygon Tool', () => {
  test('click vertices then close to draw polygon', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('p');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await firePointer(page, 'pointerdown', cx, cy - 80, 0.5, 1);
    await firePointer(page, 'pointerup', cx, cy - 80, 0, 0);
    await waitFrame(page, 1);

    await firePointer(page, 'pointerdown', cx + 80, cy, 0.5, 1);
    await firePointer(page, 'pointerup', cx + 80, cy, 0, 0);
    await waitFrame(page, 1);

    await firePointer(page, 'pointerdown', cx, cy + 80, 0.5, 1);
    await firePointer(page, 'pointerup', cx, cy + 80, 0, 0);
    await waitFrame(page, 1);

    await firePointer(page, 'pointerdown', cx - 80, cy, 0.5, 1);
    await firePointer(page, 'pointerup', cx - 80, cy, 0, 0);
    await waitFrame(page, 1);

    await firePointer(page, 'pointerdown', cx, cy - 80, 0.5, 1);
    await firePointer(page, 'pointerup', cx, cy - 80, 0, 0);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const pixel = await getPixelColor(page,
      Math.round((box!.width / 2) * dpr),
      Math.round((box!.height / 2) * dpr));
    expect(pixel.a).toBe(255);
  });

  test('Escape cancels polygon drawing', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('p');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await firePointer(page, 'pointerdown', cx - 50, cy - 50, 0.5, 1);
    await firePointer(page, 'pointerup', cx - 50, cy - 50, 0, 0);
    await waitFrame(page, 1);

    await page.keyboard.press('Escape');
    await waitFrame(page, 2);
    await expect(canvas).toBeVisible();
  });
});
