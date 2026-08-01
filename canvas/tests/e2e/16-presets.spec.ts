import { test, expect, type Page } from '@playwright/test';
import { gotoApp, waitForEngine, drawRect, waitFrame, getPixelColor } from './helpers';

/** Floor colour of the 'Cave / Natural' preset in presetRegistry.ts. */
const CAVE_FLOOR_COLOR = '#7a6a58';

/** Clicks a style preset chip in the right panel, opening the section if collapsed. */
async function applyPreset(page: Page, label: string): Promise<void> {
  const chip = page.getByRole('button', { name: label, exact: true });
  if ((await chip.count()) === 0 || !(await chip.first().isVisible())) {
    await page.getByRole('button', { name: /style presets/i }).first().click();
  }
  await chip.first().click();
}

/**
 * Shapes on the dungeon layer and its current floor colour.
 *
 * Read-only, and the reason it exists: an earlier version of this file drew
 * nothing (the pointer landed on the boot overlay) and then asserted on two
 * background pixels, so it passed no matter what the code did.
 */
async function layerProbe(page: Page): Promise<{ shapes: number; floorColor: string }> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (window as any).__store.getState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = state.layers.find((l: any) => l.type === 'dungeon');
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      shapes: layer.children.filter((c: any) => c.childType === 'shape').length,
      floorColor: layer.style.floorColor as string,
    };
  });
}

test.describe('16 - Style Presets', () => {
  // A preset chooses the style for the NEXT shape. Anything already drawn has to
  // come through untouched — it used to repaint the whole map, which is how an
  // authored map lost all its walls to one click.
  test('applying a preset leaves an already-drawn shape looking the same', async ({ page }) => {
    await gotoApp(page);
    // The boot overlay eats pointer events until the engine is up.
    await waitForEngine(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);

    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const sampleX = Math.round((box!.width / 2) * dpr);
    const sampleY = Math.round((box!.height / 2) * dpr);
    const before = await getPixelColor(page, sampleX, sampleY);
    const probeBefore = await layerProbe(page);
    expect(probeBefore.shapes).toBe(1);

    await applyPreset(page, 'Cave / Natural');
    await page.waitForTimeout(500);
    await waitFrame(page, 8);

    // The preset really landed on the layer...
    const probeAfter = await layerProbe(page);
    expect(probeAfter.floorColor).not.toBe(probeBefore.floorColor);

    // ...the shape carries a pin holding its old look...
    const pinned = await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__store
        .getState()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .layers.find((l: any) => l.type === 'dungeon')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .children.find((c: any) => c.childType === 'shape').styleOverrides,
    );
    expect(pinned.floorColor).toBe(probeBefore.floorColor);

    // ...and it still renders as it did. Within a couple of levels, not bit for
    // bit: a pinned shape draws through the per-shape path (its own fill, masked
    // to the merged floor) rather than one merged fill, and that composite lands
    // a hair lighter. The regression this row exists for was the whole shape
    // repainting in the preset's colour, which is ~40 levels per channel away.
    const after = await getPixelColor(page, sampleX, sampleY);
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(Math.abs(after[ch] - before[ch])).toBeLessThanOrEqual(6);
    }
    expect(after.a).toBe(before.a);
  });

  test('the preset still becomes the style the next shape is drawn in', async ({ page }) => {
    await gotoApp(page);
    // The boot overlay eats pointer events until the engine is up.
    await waitForEngine(page);
    await page.keyboard.press('r');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // First shape in the default style, off to the left.
    await drawRect(page, cx - 220, cy - 60, cx - 80, cy + 60);
    await page.waitForTimeout(800);
    await waitFrame(page, 5);

    await applyPreset(page, 'Cave / Natural');
    await page.waitForTimeout(300);

    // Second shape, drawn after the preset, off to the right.
    await page.keyboard.press('r');
    await drawRect(page, cx + 80, cy - 60, cx + 220, cy + 60);
    await page.waitForTimeout(800);
    await waitFrame(page, 8);

    const probe = await layerProbe(page);
    expect(probe.shapes).toBe(2);
    expect(probe.floorColor).toBe(CAVE_FLOOR_COLOR);

    // The older shape carries a pinned copy of how it already looked; the one
    // drawn after the preset carries nothing, so it inherits the new layer
    // style. That split is what makes a preset forward-looking.
    const overrides = await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__store
        .getState()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .layers.find((l: any) => l.type === 'dungeon')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .children.filter((c: any) => c.childType === 'shape')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.styleOverrides?.floorColor ?? null),
    );
    expect(overrides[0]).not.toBeNull();
    expect(overrides[0]).not.toBe(CAVE_FLOOR_COLOR);
    expect(overrides[1]).toBeNull();
  });
});
