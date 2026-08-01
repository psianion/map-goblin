import { test, expect } from '@playwright/test';
import { gotoApp, waitFrame, getPixelColor } from './helpers';

test.describe('01 - Basic Rendering', () => {
  test('canvas element exists and is visible', async ({ page }) => {
    await gotoApp(page);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test('background renders with default color', async ({ page }) => {
    await gotoApp(page);
    await waitFrame(page, 3);
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const px = Math.round((box!.width / 2) * dpr);
    const py = Math.round((box!.height / 2) * dpr);
    const pixel = await getPixelColor(page, px, py);
    expect(pixel.a).toBe(255);
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(100);
  });

  test('Clipper2 WASM loads successfully', async ({ page }) => {
    await gotoApp(page);
    // The window flag, not the `data-clipper-ready` attribute: the attribute mirrors
    // `ui.clipperReady`, which a Strict Mode double-mount race clears again right after
    // boot, so reading it here asserted nothing about Clipper2 and hung instead.
    const ready = await page.evaluate(
      () => (window as Window & { __clipperReady?: boolean }).__clipperReady,
    );
    expect(ready).toBe(true);
  });
});
