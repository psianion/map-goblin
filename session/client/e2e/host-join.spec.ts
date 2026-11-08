// @host: the host flow and joining (plan section 7). Unrun until step T.
import { ADMIN_PASS, DEMO_MAP, SERVER_URL, expect, holdDmPass, joinTable, standUpTable, test } from './fixtures';

test.describe('@host host and join', () => {
  test('three steps with Back, library cards, starting room, QR, and in', async ({ page }) => {
    await page.goto('/host?e2e=1');
    await expect(page.getByTestId('host-connect')).toBeVisible();
    await page.locator('#server-url').fill(SERVER_URL);
    await page.locator('#admin-pass').fill(ADMIN_PASS());
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('host-campaign')).toBeVisible();
    await page.locator('#campaign-name').fill('Host spec');
    await page.getByRole('button', { name: 'Create campaign' }).click();

    await expect(page.getByTestId('host-map')).toBeVisible();
    await page.locator('#map-file').setInputFiles(DEMO_MAP);
    await expect(page.getByTestId('library-card')).toHaveCount(1);
    await expect(page.getByTestId('library-card')).toContainText('Published');
    await expect(page.getByTestId('host-starting-room')).toBeVisible();
    await page.getByTestId('start-room').first().click();

    await page.getByTestId('host-back').click();
    await expect(page.getByTestId('host-campaign')).toBeVisible();
    await page.getByRole('button', { name: 'Host spec' }).click();
    await page.getByTestId('library-card').first().click();
    await page.getByTestId('start-room').first().click();
    await page.getByTestId('host-open').click();

    await expect(page.getByTestId('host-invite')).toBeVisible();
    await expect(page.getByTestId('invite-code')).toHaveText(/^[A-Z0-9]{6}$/);
    await expect(page.getByTestId('invite-qr')).toBeVisible();
    await page.getByTestId('enter-table').click();
    await expect(page.locator('[data-page="table"]')).toBeVisible();
  });

  test('"Different DM or new campaign" brings the pass step back', async ({ page }) => {
    const table = await standUpTable('Different DM spec');
    await holdDmPass(page, table);
    await page.goto('/host?e2e=1');
    await expect(page.getByTestId('host-campaign')).toBeVisible();
    await expect(page.getByTestId('host-connect')).toHaveCount(0);
    await page.getByTestId('host-different-dm').click();
    await expect(page.getByTestId('host-connect')).toBeVisible();
  });

  test('a handoff from the canvas lands on the Map step with the campaign chosen', async ({ page }) => {
    const table = await standUpTable('Handoff spec');
    const res = await fetch(`${SERVER_URL}/api/campaigns/${table.campaignId}/handoff`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${table.token}` },
    });
    const minted = (await res.json()) as { code?: string; error?: string };
    expect(res.status, `handoff mint: ${minted.error ?? ''}`).toBe(200);
    const code = minted.code!;
    await page.goto(`/host?e2e=1#handoff=${code}`);
    await expect(page.getByTestId('host-map')).toBeVisible();
    await expect(page.getByTestId('host-map')).toContainText('Handoff spec');
    expect(new URL(page.url()).hash).toBe('');
  });

  test('a player joins and waits while no scene is live, then sees the table', async ({ hostSession, browser }) => {
    const player = await (await browser.newContext()).newPage();
    await joinTable(player, hostSession.inviteCode, 'Pia');
    await expect(hostSession.page.getByTestId('presence-avatar')).toHaveCount(2);
    await expect(player.getByTestId('title-card')).toBeVisible();
    await player.context().close();
  });
});
