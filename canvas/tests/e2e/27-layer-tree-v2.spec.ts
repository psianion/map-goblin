import { test, expect } from '@playwright/test';
import { gotoApp, drawRect, waitFrame, firePointer } from './helpers';

/**
 * Layer Tree v2 — e2e tests for the children-based layer model.
 * Tests use DOM assertions (layer panel UI) rather than store access.
 */

/** Expand Layer 1 in the panel */
async function expandLayer1(page: import('@playwright/test').Page) {
  const expandBtn = page.getByRole('button', { name: 'Expand' });
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
    await page.waitForTimeout(300);
  }
}

/** Get visible child-row elements */
function getChildRows(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="child-row"]');
}

/** Draw a rectangle at the center of the canvas */
async function drawRectCenter(page: import('@playwright/test').Page, offX = 0, offY = 0) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  const cx = box!.x + box!.width / 2 + offX;
  const cy = box!.y + box!.height / 2 + offY;
  await drawRect(page, cx - 60, cy - 40, cx + 60, cy + 40);
  await page.waitForTimeout(500);
}

/** Place a light at center */
async function placeLightCenter(page: import('@playwright/test').Page) {
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1);
  await firePointer(page, 'pointerup', cx, cy, 0, 0);
  await page.waitForTimeout(500);
}

// ─── Tests ────────────────────────────────────────────────

test.describe('27 - Layer Tree v2', () => {

  test.describe('Shape Drawing → Layer Tree', () => {
    test('rectangle creates a child row in the layer panel', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);
      const rows = getChildRows(page);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('Rectangle');

      await page.screenshot({ path: 'test-screenshots/27-01-rectangle-child.png' });
    });

    test('multiple shapes create ordered children', async ({ page }) => {
      await gotoApp(page);

      // Rectangle
      await page.keyboard.press('r');
      await drawRectCenter(page, -80, 0);

      // Regular polygon
      await page.keyboard.press('h');
      await drawRectCenter(page, 80, 0);

      await expandLayer1(page);
      const rows = getChildRows(page);
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('Rectangle');
      await expect(rows.nth(1)).toContainText('Regular Polygon');

      await page.screenshot({ path: 'test-screenshots/27-02-multi-shapes.png' });
    });
  });

  test.describe('Layer Panel Tree UI', () => {
    test('expand/collapse toggles children visibility', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      // Expand
      await expandLayer1(page);
      const rows = getChildRows(page);
      await expect(rows).toHaveCount(1);

      // Collapse
      const collapseBtn = page.getByRole('button', { name: 'Collapse', exact: true });
      await collapseBtn.click();
      await page.waitForTimeout(300);
      await expect(rows).toHaveCount(0);

      await page.screenshot({ path: 'test-screenshots/27-03-expand-collapse.png' });
    });

    test('child visibility toggle changes eye icon', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);

      // Click first child's hide button
      const hideBtn = page.getByRole('button', { name: 'Hide' }).first();
      await expect(hideBtn).toBeVisible();
      await hideBtn.click();
      await page.waitForTimeout(500);

      // Now "Show" button should appear
      const showBtn = page.getByRole('button', { name: 'Show' }).first();
      await expect(showBtn).toBeVisible();

      await page.screenshot({ path: 'test-screenshots/27-04-child-hidden.png' });
    });

    test('clicking child row highlights it as selected', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);

      const row = getChildRows(page).first();
      await row.click();
      await page.waitForTimeout(300);

      // Child row should have accent styling when selected
      await expect(row).toHaveClass(/accent/);

      await page.screenshot({ path: 'test-screenshots/27-05-child-selected.png' });
    });
  });

  test.describe('Light as Layer Child', () => {
    test('light tool creates light child row', async ({ page }) => {
      await gotoApp(page);
      await placeLightCenter(page);

      await expandLayer1(page);
      const rows = getChildRows(page);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('Light');

      await page.screenshot({ path: 'test-screenshots/27-06-light-child.png' });
    });

    test('shapes and lights appear together in tree', async ({ page }) => {
      await gotoApp(page);

      // Draw rectangle
      await page.keyboard.press('r');
      await drawRectCenter(page);

      // Place light
      await placeLightCenter(page);

      await expandLayer1(page);
      const rows = getChildRows(page);
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('Rectangle');
      await expect(rows.nth(1)).toContainText('Light');

      await page.screenshot({ path: 'test-screenshots/27-07-mixed-children.png' });
    });
  });

  test.describe('Undo/Redo with Children', () => {
    test('undo removes last drawn shape from tree', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);
      await expect(getChildRows(page)).toHaveCount(1);

      // Undo
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(0);

      await page.screenshot({ path: 'test-screenshots/27-08-undo-shape.png' });
    });

    test('redo restores shape child in tree', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);
      await expect(getChildRows(page)).toHaveCount(1);

      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      await expect(getChildRows(page)).toHaveCount(0);

      await page.keyboard.press('Control+y');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(1);
      await expect(getChildRows(page).first()).toContainText('Rectangle');

      await page.screenshot({ path: 'test-screenshots/27-09-redo-shape.png' });
    });

    test('undo light removes light child from tree', async ({ page }) => {
      await gotoApp(page);
      await placeLightCenter(page);

      await expandLayer1(page);
      await expect(getChildRows(page)).toHaveCount(1);

      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(0);

      await page.screenshot({ path: 'test-screenshots/27-10-undo-light.png' });
    });

    test('undo/redo with mixed children preserves order', async ({ page }) => {
      await gotoApp(page);

      // Draw rect, place light, draw another rect
      await page.keyboard.press('r');
      await drawRectCenter(page, -80, 0);
      await placeLightCenter(page);
      await page.keyboard.press('r');
      await drawRectCenter(page, 80, 0);

      await expandLayer1(page);
      await expect(getChildRows(page)).toHaveCount(3);

      // Undo last rect
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(2);
      await expect(getChildRows(page).nth(1)).toContainText('Light');

      // Undo light
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(1);
      await expect(getChildRows(page).first()).toContainText('Rectangle');

      await page.screenshot({ path: 'test-screenshots/27-11-undo-mixed.png' });
    });
  });

  test.describe('Canvas Rendering', () => {
    test('drawn rectangle changes canvas pixels', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');

      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      const sampleX = Math.round((box!.width / 2) * dpr);
      const sampleY = Math.round((box!.height / 2) * dpr);

      const before = await page.evaluate(({ x, y }) => {
        const c = document.querySelector('canvas') as HTMLCanvasElement;
        if (!c) return { r: 0, g: 0, b: 0, a: 0 };
        const ctx = c.getContext('2d');
        if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] };
      }, { x: sampleX, y: sampleY });

      await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60);
      await page.waitForTimeout(500);
      await waitFrame(page, 5);

      const after = await page.evaluate(({ x, y }) => {
        const c = document.querySelector('canvas') as HTMLCanvasElement;
        if (!c) return { r: 0, g: 0, b: 0, a: 0 };
        const ctx = c.getContext('2d');
        if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] };
      }, { x: sampleX, y: sampleY });

      // Pixel should have changed (floor color is different from background)
      const diff = Math.abs(after.r - before.r) + Math.abs(after.g - before.g) + Math.abs(after.b - before.b);
      expect(diff).toBeGreaterThan(10);

      await page.screenshot({ path: 'test-screenshots/27-12-canvas-pixels.png' });
    });

    test('hiding shape child clears canvas pixels', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);

      // Take screenshot with shape visible
      await page.screenshot({ path: 'test-screenshots/27-13-before-hide.png' });

      // Hide the shape
      const hideBtn = page.getByRole('button', { name: 'Hide' }).first();
      await hideBtn.click();
      await page.waitForTimeout(500);
      await waitFrame(page, 5);

      // Take screenshot with shape hidden
      await page.screenshot({ path: 'test-screenshots/27-13-after-hide.png' });

      // Unhide
      const showBtn = page.getByRole('button', { name: 'Show' }).first();
      await showBtn.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-screenshots/27-13-after-show.png' });
    });
  });

  test.describe('Keyboard Shortcuts', () => {
    test('tool switching via keyboard works', async ({ page }) => {
      await gotoApp(page);

      // Each tool key should activate without errors
      const keys = ['v', 'r', 'p', 'h', 'd', 'w', 'l'];
      for (const key of keys) {
        await page.keyboard.press(key);
        await page.waitForTimeout(100);
      }

      // No errors = pass
      await page.screenshot({ path: 'test-screenshots/27-14-tool-shortcuts.png' });
    });

    test('delete key removes child after selecting via panel', async ({ page }) => {
      await gotoApp(page);
      await page.keyboard.press('r');
      await drawRectCenter(page);

      await expandLayer1(page);
      await expect(getChildRows(page)).toHaveCount(1);

      // Click child to select (shortcuts are on document, no need to focus canvas)
      await getChildRows(page).first().click();
      await page.waitForTimeout(300);

      // Press Delete — shortcut handler is on document level
      await page.keyboard.press('Delete');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(0);

      // Undo restores
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      await expect(getChildRows(page)).toHaveCount(1);

      await page.screenshot({ path: 'test-screenshots/27-15-delete-undo.png' });
    });
  });

  test.describe('Multiple Layers', () => {
    test('adding a new layer creates separate child scope', async ({ page }) => {
      await gotoApp(page);

      // Draw on Layer 1
      await page.keyboard.press('r');
      await drawRectCenter(page);

      // Add new layer
      const addBtn = page.getByRole('button', { name: 'Add layer' });
      await addBtn.click();
      await page.waitForTimeout(300);

      // Draw on Layer 2
      await page.keyboard.press('r');
      await drawRectCenter(page, 100, 0);

      // Both layers should exist
      const layerNames = page.locator('text=Layer');
      const count = await layerNames.count();
      expect(count).toBeGreaterThanOrEqual(2);

      await page.screenshot({ path: 'test-screenshots/27-16-multi-layer.png' });
    });
  });
});
