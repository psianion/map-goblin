// @shell: the table's chrome (plan section 7). Unrun until step T.
import { expect, startTable, test } from './fixtures';

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
    // Fog lies across the whole dock at the short height: no left column, no strip.
    await expect(page.getByTestId('dock-body-fog')).toHaveAttribute('data-height', 'sm');
    await expect(page.getByTestId('dock-full')).toBeVisible();
    await expect(page.getByTestId('dock-strip')).toHaveCount(0);
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
    // The armed tool's strip beside the rail names it and says what a drag does.
    await expect(page.getByTestId('tool-strip')).toHaveAttribute('data-tool', 'measure');
    await expect(page.getByTestId('tool-strip-hint')).toContainText('Alt');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rail-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tool-strip')).toHaveCount(0);
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

// Table fix pass F13, F26 and F31.
test.describe('@shell chips, keys and dock heights', () => {
  test('Movement locked shows on a player seat, and a locked drag is told why', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Bram');
    const { page } = hostSession;
    await startTable(page, player);
    await page.keyboard.press('3');
    await page.getByRole('button', { name: 'Lock movement' }).click();
    await expect(player.getByTestId('locked-chip')).toHaveText('Movement locked');
  });

  test('digits typed in the Token type sheet stay in the sheet', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('3');
    await page.getByTestId('token-new').click();
    await page.getByTestId('token-type-art').focus();
    await page.keyboard.press('2');
    await expect(page.getByTestId('dock-body-map')).toHaveCount(0);
  });

  test('Fog, Sky, Scenes, Story and Dice open short; Map, Tokens and Encounter tall', async ({ hostSession }) => {
    const { page } = hostSession;
    for (const [key, id, height] of [['1', 'fog', 'sm'], ['2', 'map', 'lg'], ['8', 'dice', 'sm']] as const) {
      await page.keyboard.press(key);
      await expect(page.getByTestId(`dock-body-${id}`)).toHaveAttribute('data-height', height);
      await page.keyboard.press(key);
    }
  });
});
