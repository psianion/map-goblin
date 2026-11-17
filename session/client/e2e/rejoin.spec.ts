// @rejoin: a returning player gets their seat and token back (plan section 6.2, decision i).
// Written, never run by the builders.
import { dmCommands, expect, joinTable, test, tokenAt } from './fixtures';

test.describe('@rejoin a returning player', () => {
  test('the Owner picker stamps the name, and a new tab is offered "Continue as"', async ({ hostSession, browser }) => {
    const context = await browser.newContext();
    const pim = await context.newPage();
    await joinTable(pim, hostSession.inviteCode, 'Pim');
    const pimId = await pim.evaluate(() => (window as unknown as { __sessionStore?: { getState(): { you: { identityId: string } | null } } }).__sessionStore?.getState().you?.identityId);
    const bramId = await hostSession.page.evaluate(() => {
      const s = (window as unknown as { __sessionStore?: { getState(): { session: { activeSceneId: string; modules: { tokens: { byScene: Record<string, Record<string, { id: string; name: string }>> } } } } } }).__sessionStore?.getState().session;
      return Object.values(s?.modules.tokens.byScene[s.activeSceneId] ?? {}).find((t) => t.name === 'Bram')?.id;
    });
    await dmCommands(hostSession.token, [{ module: 'tokens', action: 'assign', payload: { id: bramId, ownerId: pimId } }]);
    await expect.poll(() => tokenAt(pim, 'Bram')).not.toBeNull();

    // Closed tab, same link: the browser remembers the seat for this campaign.
    await pim.close();
    const again = await context.newPage();
    await again.goto(`/join/${hostSession.inviteCode}?e2e=1`);
    await expect(again.getByTestId('join-continue')).toContainText('Pim');
    await again.getByTestId('join-continue').click();
    await expect(again.locator('[data-page="table"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => tokenAt(again, 'Bram')).not.toBeNull();
    await context.close();
  });

  test('a second person using the same name while Pim is here is not given the token', async ({ hostSession, joinAsPlayer, browser }) => {
    const pim = await joinAsPlayer('Pim');
    await pim.getByTestId('game-canvas').click({ position: { x: 400, y: 300 } });
    const claim = pim.getByTestId('token-card-claim');
    if (await claim.isVisible()) await claim.click();
    const other = await (await browser.newContext()).newPage();
    await joinTable(other, hostSession.inviteCode, 'Pim');
    const mine = await other.evaluate(() => {
      const st = (window as unknown as { __sessionStore?: { getState(): { you: { identityId: string } | null; session: { activeSceneId: string; modules: { tokens: { byScene: Record<string, Record<string, { ownerId: string | null }>> } } } | null } } }).__sessionStore?.getState();
      const scene = st?.session?.modules.tokens.byScene[st.session.activeSceneId] ?? {};
      return Object.values(scene).filter((t) => t.ownerId === st?.you?.identityId).length;
    });
    expect(mine).toBe(0);
    await other.context().close();
  });
});
