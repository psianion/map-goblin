// @live: opening or publishing never ends a live table (plan section 1, settled; F1, F19).
// Written, never run by the builders.
import { SECOND_MAP, SECOND_NAME, SERVER_URL, assertMapLoaded, dmCommands, expect, mintHandoff, test } from './fixtures';
import { readFileSync } from 'node:fs';

test.describe('@live a running table carries on', () => {
  test('a second open from the canvas keeps the session, the code and the players', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Pim');
    const res = await fetch(`${SERVER_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${hostSession.token}` },
      body: JSON.stringify({ campaignId: hostSession.campaignId, sceneId: hostSession.sceneId }),
    });
    const body = (await res.json()) as { inviteCode: string; resumed?: boolean };
    expect(res.status).toBe(200);
    expect(body.resumed).toBe(true);
    expect(body.inviteCode).toBe(hostSession.inviteCode);
    await expect(player.getByText('The session has ended')).toHaveCount(0);
    await expect(player.locator('[data-page="table"]')).toBeVisible();
  });

  test('a handoff naming another scene switches the live table to it', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Pim');
    const up = await fetch(`${SERVER_URL}/api/campaigns/${hostSession.campaignId}/maps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${hostSession.token}` },
      body: readFileSync(SECOND_MAP, 'utf8'),
    });
    const { sceneId } = (await up.json()) as { sceneId: string };
    const code = await mintHandoff(hostSession, sceneId);
    const { page } = hostSession;
    await page.goto(`/host?e2e=1#handoff=${code}`);
    if (await page.getByTestId('host-open').isVisible()) await page.getByTestId('host-open').click();
    await page.getByTestId('enter-table').click();
    await assertMapLoaded(page, SECOND_NAME);
    await assertMapLoaded(player, SECOND_NAME);
  });

  test('switching to a hidden scene still reaches the players, and the DM is told', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Pim');
    const auth = { 'content-type': 'application/json', Authorization: `Bearer ${hostSession.token}` };
    const up = await fetch(`${SERVER_URL}/api/campaigns/${hostSession.campaignId}/maps`, { method: 'POST', headers: auth, body: readFileSync(SECOND_MAP, 'utf8') });
    const { sceneId } = (await up.json()) as { sceneId: string };
    await fetch(`${SERVER_URL}/api/scenes/${sceneId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ visibleToPlayers: false }) });
    await dmCommands(hostSession.token, [{ module: 'scenes', action: 'activate', payload: { sceneId } }]);
    await assertMapLoaded(player, SECOND_NAME);
    await expect(player.getByTestId('title-scene')).not.toHaveText('No scene yet');
    await expect(hostSession.page.getByText('This scene was hidden; players see it now')).toBeVisible({ timeout: 15_000 });
  });
});
