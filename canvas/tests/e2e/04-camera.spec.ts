import { test, expect } from '@playwright/test';
import { gotoApp, waitFrame, getPixelColor } from './helpers';

/**
 * Camera state is the world container's transform, not store state — stage
 * child 0 is the world container, child 1 the overlay.
 */
function getCamera(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const app = (window as Window & {
      __pixiApp?: { stage: { children: { x: number; y: number; scale: { x: number } }[] } };
    }).__pixiApp;
    const world = app!.stage.children[0];
    return { x: world.x, y: world.y, zoom: world.scale.x };
  });
}

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
    const before = await getCamera(page);

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await waitFrame(page, 5);

    const after = await getPixelColor(page, px, py);
    expect(after.a).toBe(255);
    expect((await getCamera(page)).zoom).toBeGreaterThan(before.zoom);
  });

  test('middle-click pan works without crash', async ({ page }) => {
    await gotoApp(page);
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await getCamera(page);

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 50, cy + 30);
    await page.mouse.up({ button: 'middle' });
    await waitFrame(page, 3);

    const after = await getCamera(page);
    expect(after.x - before.x).toBeCloseTo(50, 0);
    expect(after.y - before.y).toBeCloseTo(30, 0);

    const canvas2 = page.locator('canvas');
    await expect(canvas2).toBeVisible();
  });
});
