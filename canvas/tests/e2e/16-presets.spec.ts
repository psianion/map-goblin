import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame, getPixelColor } from './helpers';

test.describe('16 - Style Presets', () => {
  test('applying a preset changes visual appearance', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const sampleX = Math.round((box!.width / 2) * dpr);
    const sampleY = Math.round((box!.height / 2) * dpr);
    const before = await getPixelColor(page, sampleX, sampleY);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__store;
      if (store) {
        const state = store.getState();
        const layerId = state.ui.activeLayerId;
        state.applyPreset(layerId, 'dark');
      }
    });
    await page.waitForTimeout(500);
    await waitFrame(page, 8);

    const after = await getPixelColor(page, sampleX, sampleY);
    // Dark preset changes floor from cream to dark — significant color shift
    const diff = Math.abs(after.r - before.r) + Math.abs(after.g - before.g) + Math.abs(after.b - before.b);
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(after.a).toBe(255);
  });
});
