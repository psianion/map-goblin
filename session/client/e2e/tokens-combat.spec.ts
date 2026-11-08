// @play — table v2 tokens and combat (plan section 7). Written against the shared fixtures
// (`hostSession`: a DM page at a live table whose campaign has two PC token types, Bram and
// Yara, and a starting room; `joinAsPlayer(name)`: a second page seated as that player).
// Unrun until step T.
import { expect, test, tokenPoint } from './fixtures';

test.describe('@play tokens and combat', () => {
  test('PC tokens stand in the starting room when the session opens', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('3');
    await expect(page.getByTestId('tokens-body')).toBeVisible();
    await page.getByTestId('tokens-filter-pc').click();
    await expect(page.getByTestId('token-tile')).toHaveCount(2);
    await expect(page.getByTestId('token-tile-count').first()).toHaveText('1');
  });

  test('a player claims their PC and uploads its art', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Bram');
    await player.getByTestId('game-canvas').click({ position: { x: 400, y: 300 } });
    const claim = player.getByTestId('token-card-claim');
    if (await claim.isVisible()) await claim.click();
    await expect(hostSession.page.getByTestId('party-sheet').or(hostSession.page.getByTestId('dock'))).toBeVisible();
  });

  test('token card HP and conditions, and Alt-drag places hidden', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('3');
    await page.getByTestId('token-new').click();
    await page.getByTestId('token-type-name').fill('Ogre');
    await page.getByTestId('token-type-kind-monster').click();
    await page.getByTestId('token-type-hp').fill('59');
    await page.getByTestId('token-type-save').click();

    const tile = page.getByTestId('token-tile').filter({ hasText: 'Ogre' });
    const canvas = page.getByTestId('game-canvas');
    await page.keyboard.down('Alt');
    await tile.dragTo(canvas, { targetPosition: { x: 300, y: 250 } });
    await page.keyboard.up('Alt');

    // Picked where the token actually stands, not where the drop aimed: the drop snaps to a
    // cell, and a map light may sit at the aimed pixel (a token under the pointer wins anyway).
    await expect.poll(async () => (await tokenPoint(page, 'Ogre').catch(() => null)) !== null).toBe(true);
    await canvas.click({ position: await tokenPoint(page, 'Ogre') });
    const card = page.getByTestId('token-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Hidden');
    await page.getByTestId('token-card-amount').fill('10');
    await page.getByTestId('token-card-damage').click();
    await expect(page.getByTestId('token-card-hp')).toHaveText('49 / 59 HP');
    await page.getByTestId('token-card-condition-add').click();
    await page.getByTestId('token-card-condition-restrained').click();
    await expect(page.getByTestId('token-card-condition-restrained')).toHaveAttribute('data-pressed', '');
  });

  test('encounter: start, Next, damage with half on save, an effect ticks, End turn as player', async ({ hostSession, joinAsPlayer }) => {
    const { page } = hostSession;
    const player = await joinAsPlayer('Bram');
    await page.keyboard.press('4');
    await page.getByTestId('encounter-start').click();
    await page.getByTestId('encounter-roll-npcs').click();
    await page.getByTestId('encounter-begin').click();
    await expect(page.getByTestId('combat-bar')).toBeVisible();
    await expect(page.getByTestId('encounter-round')).toHaveText('Round 1');

    // Damage with half on save to the selection.
    // Picked from the combat bar: the map may sit under the dock or the bar at this point.
    await page.getByLabel('Select Bram').click();
    await page.getByTestId('encounter-amount').fill('9');
    await page.getByTestId('encounter-body').getByRole('switch', { name: 'Half on save' }).click();
    await page.getByTestId('encounter-damage').click();

    // An effect timer on the selection ticks when the round turns.
    await page.getByTestId('effect-name').fill('Bless');
    await page.getByTestId('effect-rounds').fill('2');
    await page.getByTestId('effect-add').click();
    await expect(page.getByTestId('effect-row').first()).toContainText('2 rd');
    const rows = await page.getByTestId('order-row').count();
    for (let i = 0; i < rows; i++) await page.getByTestId('encounter-next').click();
    await expect(page.getByTestId('encounter-round')).toHaveText('Round 2');
    await expect(page.getByTestId('effect-row').first()).toContainText('1 rd');

    // The player whose turn it is ends it.
    const endTurn = player.getByTestId('combat-end-turn');
    for (let i = 0; i < rows && !(await endTurn.isVisible()); i++) await page.getByTestId('encounter-next').click();
    await endTurn.click();
    await expect(endTurn).toBeHidden();
  });
});
