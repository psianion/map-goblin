import { test, expect } from '@playwright/test';
import { gotoApp, firePointer, waitFrame, shapeCount } from './helpers';

// 'a' is the path tool — 'd' is the door tool.
test.describe('09 - Path Tool', () => {
  test('click segments then Enter to finalize path', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('a');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await shapeCount(page);

    await firePointer(page, 'pointerdown', cx - 60, cy, 0.5, 1);
    await firePointer(page, 'pointerup', cx - 60, cy, 0, 0);
    await waitFrame(page, 1);

    await firePointer(page, 'pointerdown', cx + 60, cy, 0.5, 1);
    await firePointer(page, 'pointerup', cx + 60, cy, 0, 0);
    await waitFrame(page, 1);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await waitFrame(page, 5);

    expect(await shapeCount(page)).toBe(before + 1);
    await expect(canvas).toBeVisible();
  });

  test('Escape cancels path drawing', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('a');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await shapeCount(page);

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1);
    await firePointer(page, 'pointerup', cx, cy, 0, 0);
    await waitFrame(page, 1);

    await page.keyboard.press('Escape');
    await waitFrame(page, 2);
    expect(await shapeCount(page)).toBe(before);
    await expect(canvas).toBeVisible();
  });
});
