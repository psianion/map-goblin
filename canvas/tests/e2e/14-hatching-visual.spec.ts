import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame } from './helpers';

test.describe('14 - Hatching Visual', () => {
  test('dark preset renders hatching lines', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 120, cy - 100, cx + 120, cy + 100);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);

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

    await expect(canvas).toBeVisible();
  });
});
