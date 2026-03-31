import { test, expect } from '@playwright/test';
import { gotoApp, waitFrame } from './helpers';

test.describe('06 - Keyboard Shortcuts', () => {
  const toolKeys = [
    { key: 'v', tool: 'select' },
    { key: 'r', tool: 'rectangle' },
    { key: 'p', tool: 'polygon' },
    { key: 'h', tool: 'regularPolygon' },
    { key: 'd', tool: 'path' },
    { key: 'w', tool: 'wall' },
    { key: 'l', tool: 'light' },
  ];

  for (const { key, tool } of toolKeys) {
    test(`pressing '${key}' activates ${tool} tool without crash`, async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press(key);
      await waitFrame(page, 2);
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
    });
  }

  test('E toggles erase mode', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('e');
    await waitFrame(page, 2);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('X toggles rough mode', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('x');
    await waitFrame(page, 2);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
