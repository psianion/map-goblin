import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame, shapeCount } from './helpers';

test.describe('07 - Snap to Grid', () => {
  test('drawing with snap enabled produces aligned geometry', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await shapeCount(page);
    await drawRect(page, cx - 73, cy - 47, cx + 73, cy + 47);
    await page.waitForTimeout(500);
    await waitFrame(page, 3);

    expect(await shapeCount(page)).toBe(before + 1);

    // Off-grid drag coordinates, so every contour vertex proves the snap ran.
    const offGrid = await page.evaluate(() => {
      const store = (window as Window & {
        __store?: {
          getState: () => {
            grid: { snapDivision: number };
            layers: { type: string; children: { childType: string; contours?: [number, number][][] }[] }[];
          };
        };
      }).__store!;
      const state = store.getState();
      const layer = state.layers.find((l) => l.type === 'dungeon')!;
      const shape = layer.children.filter((c) => c.childType === 'shape').at(-1)!;
      const step = 1 / state.grid.snapDivision;
      return shape.contours![0].filter(([x, y]) =>
        Math.abs(x / step - Math.round(x / step)) > 1e-6 || Math.abs(y / step - Math.round(y / step)) > 1e-6,
      );
    });
    expect(offGrid).toEqual([]);

    await expect(canvas).toBeVisible();
  });
});
