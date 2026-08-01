import { test, expect } from '@playwright/test';
import { gotoApp, waitForEngine, drawRect, waitFrame, shapeCount } from './helpers';

test.describe('14 - Hatching Visual', () => {
  test('dark preset renders hatching lines', async ({ page }) => {
    await gotoApp(page);
    // The boot overlay eats pointer events until the engine is up.
    await waitForEngine(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await shapeCount(page);
    await drawRect(page, cx - 120, cy - 100, cx + 120, cy + 100);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);
    expect(await shapeCount(page)).toBe(before + 1);

    const chip = page.getByRole('button', { name: 'Dark Stone', exact: true });
    if ((await chip.count()) === 0 || !(await chip.first().isVisible())) {
      await page.getByRole('button', { name: /style presets/i }).first().click();
    }
    await chip.first().click();
    await page.waitForTimeout(500);
    await waitFrame(page, 8);

    const style = await page.evaluate(() => {
      const store = (window as Window & {
        __store?: {
          getState: () => {
            layers: { type: string; style?: { hatchingStyle: string; floorColor: string } }[];
          };
        };
      }).__store!;
      return store.getState().layers.find((l) => l.type === 'dungeon')!.style!;
    });
    expect(style.hatchingStyle).toBe('crosshatch');
    expect(style.floorColor.toLowerCase()).toBe('#2a2a2a');

    await expect(canvas).toBeVisible();
  });
});
