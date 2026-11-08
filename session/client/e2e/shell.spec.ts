// @shell: the table's chrome (plan section 7). Unrun until step T.
import { expect, test } from './fixtures';

test.describe('@shell chrome', () => {
  test('light by default, dark from the View menu, and the desk follows', async ({ hostSession }) => {
    const { page } = hostSession;
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByTestId('view-menu').click();
    await page.getByTestId('theme-dark').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByTestId('view-menu').click();
    await page.getByTestId('theme-light').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('the dock folds to its tab row, picks tabs by key, and B folds it', async ({ hostSession }) => {
    const { page } = hostSession;
    await expect(page.getByTestId('dock')).toBeVisible();
    await expect(page.getByTestId('dock-body-fog')).toHaveCount(0);
    await page.keyboard.press('1');
    await expect(page.getByTestId('dock-body-fog')).toBeVisible();
    await page.keyboard.press('6');
    await expect(page.getByTestId('dock-body-world')).toBeVisible();
    await page.keyboard.press('6');
    await expect(page.getByTestId('dock-body-world')).toHaveCount(0);
    await page.keyboard.press('b');
    await expect(page.getByTestId('dock-body-world')).toBeVisible();
    await page.getByTestId('dock-collapse').click();
    await expect(page.getByTestId('dock-body-world')).toHaveCount(0);
  });

  test('rail tools arm by key and Esc puts them down', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('m');
    await expect(page.getByTestId('rail-measure')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rail-select')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('rail-ping').click();
    await page.getByTestId('game-canvas').click({ position: { x: 400, y: 300 } });
    await expect(page.locator('[data-mark="ping"]')).toHaveCount(1);
  });

  test('the zoom controls move the camera and fit brings it back', async ({ hostSession }) => {
    const { page } = hostSession;
    const pct = page.getByTestId('zoom-percent');
    await expect(pct).toHaveText('100%');
    await page.getByTestId('zoom-in').click();
    await expect(pct).not.toHaveText('100%');
    await page.getByTestId('zoom-fit').click();
    await expect(pct).toHaveText('100%');
  });

  test('? opens the shortcuts sheet listed from the registries', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('?');
    const sheet = page.getByTestId('shortcuts-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-key-row="dock:dice"]')).toBeVisible();
    await expect(sheet.locator('[data-key-row="rail:pin"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });
});
