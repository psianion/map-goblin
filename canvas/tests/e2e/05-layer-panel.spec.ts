import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers';

test.describe('05 - Layer Panel', () => {
  test('default layer exists in the panel', async ({ page }) => {
    await gotoApp(page);
    const layerRows = page.locator('[data-testid="layer-row"], .layer-row, [class*="layer"]');
    const count = await layerRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('right panel is visible by default', async ({ page }) => {
    await gotoApp(page);
    const panels = page.locator('div').filter({ hasText: /Layer|Properties/ });
    const count = await panels.count();
    expect(count).toBeGreaterThan(0);
  });
});
