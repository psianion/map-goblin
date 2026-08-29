import { test, expect, type Page } from '@playwright/test';
import { gotoApp, drawRect } from './helpers';

/**
 * Child groups — e2e for the named-folder / merged-group layer rows.
 * DOM assertions on the panel, like 27-layer-tree-v2; the store is only read
 * where the contract is a selection set rather than something rendered.
 */

/** Expand Layer 1 in the panel */
async function expandLayer1(page: Page) {
  const expandBtn = page.getByRole('button', { name: 'Expand' });
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
    await page.waitForTimeout(300);
  }
}

/** Type-bucket headers (Shapes, Lights, …) */
function getBucketHeaders(page: Page) {
  return page.locator('[data-testid="child-group-header"]');
}

/** Named folder / merged rows */
function getGroupRows(page: Page) {
  return page.locator('[data-testid="named-group-header"]');
}

function getChildRows(page: Page) {
  return page.locator('[data-testid="child-row"]');
}

/** Draw a rectangle at the canvas centre, offset by (offX, offY) */
async function drawRectCenter(page: Page, offX = 0, offY = 0) {
  const box = await page.locator('canvas').boundingBox();
  const cx = box!.x + box!.width / 2 + offX;
  const cy = box!.y + box!.height / 2 + offY;
  await drawRect(page, cx - 50, cy - 40, cx + 50, cy + 40);
  await page.waitForTimeout(500);
}

/** Two rectangles on Layer 1, panel expanded, both child rows selected. */
async function twoSelectedChildren(page: Page) {
  await gotoApp(page);
  await page.keyboard.press('r');
  await drawRectCenter(page, -90, 0);
  await drawRectCenter(page, 90, 0);

  await expandLayer1(page);
  const rows = getChildRows(page);
  await expect(rows).toHaveCount(2);

  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Control'] });
  await page.waitForTimeout(300);
  expect(await selectedCount(page)).toBe(2);
  return rows;
}

/** Right-click a row and wait for its context menu */
async function openMenu(page: Page, row: ReturnType<typeof getChildRows>) {
  await row.click({ button: 'right' });
  await page.waitForTimeout(200);
}

/** Empty the selection through the store — no canvas gesture to go wrong. */
async function clearSelection(page: Page) {
  await page.evaluate(() =>
    (
      window as Window & {
        __store?: { getState: () => { setSelectedIds: (ids: string[]) => void } };
      }
    ).__store!.getState().setSelectedIds([]),
  );
  await page.waitForTimeout(200);
}

async function selectedCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __store?: { getState: () => { selection: { selectedIds: string[] } } };
        }
      ).__store!.getState().selection.selectedIds.length,
  );
}

// ─── Tests ────────────────────────────────────────────────

test.describe('28 - Child groups', () => {
  test('Group selection creates a collapsed folder row with a count badge', async ({ page }) => {
    const rows = await twoSelectedChildren(page);

    await openMenu(page, rows.nth(1));
    await page.getByRole('menuitem', { name: 'Group selection' }).click();
    await page.waitForTimeout(400);

    const folder = getGroupRows(page);
    await expect(folder).toHaveCount(1);
    await expect(folder).toHaveAttribute('aria-label', 'Group 1');
    // Folders default collapsed — the point of a folder is that it puts its
    // contents away.
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    await expect(folder).toContainText('(2)');
    await expect(getChildRows(page)).toHaveCount(0);
  });

  test('expanding the folder shows members, and their type bucket is gone', async ({ page }) => {
    const rows = await twoSelectedChildren(page);
    await openMenu(page, rows.nth(1));
    await page.getByRole('menuitem', { name: 'Group selection' }).click();
    await page.waitForTimeout(400);

    // Members left the Shapes bucket entirely, so the bucket has nothing left
    // to render.
    await expect(getBucketHeaders(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand Group 1' }).click();
    await page.waitForTimeout(300);

    await expect(getGroupRows(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(getChildRows(page)).toHaveCount(2);
    await expect(getBucketHeaders(page)).toHaveCount(0);
  });

  test('rename the folder, then Ungroup returns members to their bucket', async ({ page }) => {
    const rows = await twoSelectedChildren(page);
    await openMenu(page, rows.nth(1));
    await page.getByRole('menuitem', { name: 'Group selection' }).click();
    await page.waitForTimeout(400);

    const folder = getGroupRows(page);
    await openMenu(page, folder);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const nameInput = page.getByRole('textbox', { name: 'Rename Group 1' });
    await nameInput.fill('Ambush');
    await nameInput.press('Enter');
    await page.waitForTimeout(300);
    await expect(folder).toHaveAttribute('aria-label', 'Ambush');

    await openMenu(page, folder);
    await page.getByRole('menuitem', { name: 'Ungroup' }).click();
    await page.waitForTimeout(400);

    await expect(getGroupRows(page)).toHaveCount(0);
    await expect(getBucketHeaders(page)).toHaveCount(1);
    await expect(getChildRows(page)).toHaveCount(2);
  });

  test('Merge selection makes one atomic row that selects every member', async ({ page }) => {
    const rows = await twoSelectedChildren(page);
    await openMenu(page, rows.nth(1));
    await page.getByRole('menuitem', { name: 'Merge selection' }).click();
    await page.waitForTimeout(400);

    const merged = getGroupRows(page);
    await expect(merged).toHaveCount(1);
    await expect(merged).toHaveAttribute('data-merged', 'true');
    // No disclosure control: a merged group has no member rows to reveal.
    expect(await merged.getAttribute('aria-expanded')).toBeNull();
    await expect(page.getByRole('button', { name: /^Expand Merged/ })).toHaveCount(0);
    await expect(getChildRows(page)).toHaveCount(0);

    // Clicking the row picks up the whole group, not one member.
    await clearSelection(page);
    await merged.click();
    await page.waitForTimeout(300);
    await expect(merged).toHaveAttribute('aria-selected', 'true');
    expect(await selectedCount(page)).toBe(2);
  });

  test('Ctrl+G groups the current selection', async ({ page }) => {
    await twoSelectedChildren(page);

    await page.keyboard.press('Control+g');
    await page.waitForTimeout(400);

    await expect(getGroupRows(page)).toHaveCount(1);
    await expect(getGroupRows(page)).toHaveAttribute('aria-label', 'Group 1');
    await expect(getChildRows(page)).toHaveCount(0);
  });

  test('undo after grouping restores the ungrouped panel', async ({ page }) => {
    const rows = await twoSelectedChildren(page);
    await openMenu(page, rows.nth(1));
    await page.getByRole('menuitem', { name: 'Group selection' }).click();
    await page.waitForTimeout(400);
    await expect(getGroupRows(page)).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    await expect(getGroupRows(page)).toHaveCount(0);
    await expect(getBucketHeaders(page)).toHaveCount(1);
    await expect(getChildRows(page)).toHaveCount(2);
  });
});
