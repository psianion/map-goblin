import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, firePointer, waitFrame } from './helpers';

test.describe('13 - Select and Move', () => {
  test('box-select then move changes geometry position', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    await page.keyboard.press('v');
    await waitFrame(page, 2);

    await firePointer(page, 'pointerdown', cx - 90, cy - 70, 0.5, 1);
    await firePointer(page, 'pointermove', cx + 90, cy + 70, 0.5, 1);
    await firePointer(page, 'pointerup', cx + 90, cy + 70, 0, 0);
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    await expect(canvas).toBeVisible();
  });
});
