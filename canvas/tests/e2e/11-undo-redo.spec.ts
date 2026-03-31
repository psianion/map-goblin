import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame, getPixelColor, pressShortcut } from './helpers';

test.describe('11 - Undo/Redo', () => {
  test('Ctrl+Z undoes a rectangle draw', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const sampleX = Math.round((box!.width / 2 + 15) * dpr);
    const sampleY = Math.round((box!.height / 2 + 15) * dpr);

    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    const afterDraw = await getPixelColor(page, sampleX, sampleY);

    await pressShortcut(page, 'z', { ctrl: true });
    await page.waitForTimeout(500);
    await waitFrame(page, 8);

    const afterUndo = await getPixelColor(page, sampleX, sampleY);
    // Undo should change the pixel (floor removed, back to background)
    const diff = Math.abs(afterUndo.r - afterDraw.r) + Math.abs(afterUndo.g - afterDraw.g) + Math.abs(afterUndo.b - afterDraw.b);
    expect(diff).toBeGreaterThan(5);
  });

  test('Ctrl+Shift+Z redoes an undone draw', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const sampleX = Math.round((box!.width / 2) * dpr);
    const sampleY = Math.round((box!.height / 2) * dpr);
    const afterDraw = await getPixelColor(page, sampleX, sampleY);

    await pressShortcut(page, 'z', { ctrl: true });
    await page.waitForTimeout(300);
    await waitFrame(page, 5);

    await pressShortcut(page, 'z', { ctrl: true, shift: true });
    await page.waitForTimeout(300);
    await waitFrame(page, 5);

    const afterRedo = await getPixelColor(page, sampleX, sampleY);
    const diff = Math.abs(afterRedo.r - afterDraw.r) + Math.abs(afterRedo.g - afterDraw.g) + Math.abs(afterRedo.b - afterDraw.b);
    expect(diff).toBeLessThan(30);
  });
});
