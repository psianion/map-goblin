// @marks: the table's mark tools (table lobby pass, section 6). Unrun until the pass's one run.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Press at `from`, drag to `to` (canvas pixels), and let go unless asked to hold. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = false): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  if (!hold) await page.mouse.up();
}

test.describe('@marks mark tools', () => {
  test('a ping ripples in and leaves on its own', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.getByTestId('rail-ping').click();
    await expect(page.getByTestId('tool-strip')).toHaveAttribute('data-tool', 'ping');
    await expect(page.getByTestId('strip-pull')).toBeVisible();
    await page.getByTestId('game-canvas').click({ position: { x: 400, y: 300 } });
    await expect(page.locator('[data-mark="ping"]')).toHaveCount(1);
    await expect(page.locator('[data-mark="ping"]')).toHaveCount(0, { timeout: 6000 });
  });

  test('the ruler snaps to cells and labels whole steps, fades after release, and Esc calls a drag off', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('m');
    await expect(page.getByTestId('tool-strip')).toHaveAttribute('data-tool', 'measure');
    await drag(page, { x: 300, y: 300 }, { x: 517, y: 391 }, true);
    const ruler = page.locator('[data-mark="ruler"]');
    await expect(ruler).toHaveCount(1);
    const label = (await ruler.textContent())!;
    expect(label).toMatch(/^\d+ ft$/);
    expect(parseInt(label, 10) % 5).toBe(0);
    await page.mouse.up();
    // Stays where it was let go, then fades.
    await expect(ruler).toHaveCount(1);
    await expect(ruler).toHaveCount(0, { timeout: 4000 });

    await drag(page, { x: 300, y: 300 }, { x: 450, y: 300 }, true);
    await expect(ruler).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(ruler).toHaveCount(0, { timeout: 2000 });
    // The tool is still in hand: a second Esc puts it down.
    await expect(page.getByTestId('rail-measure')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rail-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tool-strip')).toHaveCount(0);
  });

  test('each template shape stands with its label, and Clear templates takes them all', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.getByTestId('rail-template').click();
    const templates = page.locator('[data-mark="template"]');
    const shapes = ['circle', 'cone', 'line', 'square'] as const;
    for (const [i, shape] of shapes.entries()) {
      await page.getByTestId(`template-shape-${shape}`).click();
      await drag(page, { x: 200 + i * 160, y: 250 }, { x: 290 + i * 160, y: 320 });
      await expect(templates).toHaveCount(i + 1);
      const last = templates.nth(i);
      await expect(last).toContainText(shape === 'circle' ? 'radius' : shape);
      await expect(last.locator(shape === 'circle' ? 'circle' : 'polygon').first()).toBeAttached();
    }
    await page.getByTestId('strip-clear-templates').click();
    await expect(templates).toHaveCount(0, { timeout: 2000 });
    await expect(page.getByTestId('strip-clear-templates')).toBeDisabled();
  });

  test('a drawing is one smooth stroke, and Clear drawings takes it away', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.getByTestId('rail-draw').click();
    await drag(page, { x: 250, y: 250 }, { x: 520, y: 380 });
    const drawing = page.locator('[data-mark="draw"]');
    await expect(drawing).toHaveCount(1);
    await expect(drawing.locator('path').first()).toHaveAttribute('d', /^M/);
    await page.getByTestId('strip-clear-drawings').click();
    await expect(drawing).toHaveCount(0, { timeout: 2000 });
  });
});
