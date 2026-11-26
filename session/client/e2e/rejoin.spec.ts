// @rejoin: a returning player gets their seat and token back (plan section 6.2, decision i).
// Written, never run by the builders.
import type { Page } from '@playwright/test';
import { dmCommands, expect, joinTable, test } from './fixtures';

/** This seat's own identity, and who owns Bram on the live scene, as the page's store has them. */
function bramAndMe(page: Page): Promise<{ me: string | null; owner: string | null; bramId: string | null }> {
  return page.evaluate(() => {
    const st = (window as unknown as { __sessionStore?: { getState(): { you: { identityId: string } | null; session: { activeSceneId: string; modules: { tokens: { byScene: Record<string, Record<string, { id: string; name: string; ownerId: string | null }>> } } } | null } } }).__sessionStore?.getState();
    const scene = st?.session ? (st.session.modules.tokens.byScene[st.session.activeSceneId] ?? {}) : {};
    const bram = Object.values(scene).find((t) => t.name === 'Bram');
    return { me: st?.you?.identityId ?? null, owner: bram?.ownerId ?? null, bramId: bram?.id ?? null };
  });
}

/**
 * The seat picks Bram in the lobby, which stamps its name on him, and the DM starts the table,
 * which puts him on the map (table lobby pass).
 */
async function handBram(hostSession: { page: Page; token: string }, seat: Page): Promise<string> {
  const { me } = await bramAndMe(seat);
  expect(me, 'the seat has an identity').not.toBeNull();
  await seat.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
  await expect(seat.getByTestId('lobby-mine')).toHaveText('Bram');
  await dmCommands(hostSession.token, [{ module: 'table', action: 'start', payload: { on: true } }]);
  await expect.poll(async () => (await bramAndMe(seat)).owner).toBe(me);
  return me!;
}

test.describe('@rejoin a returning player', () => {
  test('picking a character stamps the name, and a new tab is offered "Continue as"', async ({ hostSession, newContext }) => {
    const context = await newContext();
    const pim = await context.newPage();
    await joinTable(pim, hostSession.inviteCode, 'Pim');
    await handBram(hostSession, pim);

    // Closed tab, same link: the browser remembers the seat for this campaign.
    await pim.close();
    const again = await context.newPage();
    await again.goto(`/join/${hostSession.inviteCode}?e2e=1`);
    await expect(again.getByTestId('join-continue')).toContainText('Pim');
    await again.getByTestId('join-continue').click();
    await expect(again.locator('[data-page="table"]')).toBeVisible({ timeout: 30_000 });
    // F2: Bram is this seat's again, not merely on screen.
    await expect
      .poll(async () => {
        const { me, owner } = await bramAndMe(again);
        return me !== null && owner === me;
      })
      .toBe(true);
  });

  test('a second person using the same name while Pim is here is not given the token', async ({ hostSession, joinAsPlayer, newContext }) => {
    const pim = await joinAsPlayer('Pim');
    const pimId = await handBram(hostSession, pim);
    const other = await (await newContext()).newPage();
    await joinTable(other, hostSession.inviteCode, 'Pim');
    // Bram stays with the first Pim, and the second seat is someone else.
    await expect.poll(async () => (await bramAndMe(other)).owner).toBe(pimId);
    expect((await bramAndMe(other)).me).not.toBe(pimId);
  });
});
