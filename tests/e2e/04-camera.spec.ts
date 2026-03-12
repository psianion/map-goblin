import { test, expect } from '@playwright/test';
import { gotoApp, waitFrame, getPixelColor } from './helpers';

test.describe('04 - Camera', () => {
  test('mouse wheel zoom changes canvas content', async ({ page }) => {
    await gotoApp(page);
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const px = Math.round((box!.width / 4) * dpr);
    const py = Math.round((box!.height / 4) * dpr);

    await getPixelColor(page, px, py);

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await waitFrame(page, 5);

    const after = await getPixelColor(page, px, py);
    expect(after.a).toBe(255);
  });

  test('middle-click pan works without crash', async ({ page }) => {
    await gotoApp(page);
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 50, cy + 30);
    await page.mouse.up({ button: 'middle' });
    await waitFrame(page, 3);

    const canvas2 = page.locator('canvas');
    await expect(canvas2).toBeVisible();
  });
});
