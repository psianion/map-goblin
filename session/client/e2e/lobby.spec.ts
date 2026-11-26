// @play — the lobby (table lobby pass, plan 3.6 and 3.7). A new table waits in the lobby: players
// pick or make a character, the DM sees who is ready and presses Start, the party appears in
// the start area, a late joiner picks and lands beside them, and Back to lobby sends everyone
// back. Written, not run, in the builder step.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

interface Seen {
  you?: { identityId: string };
  session: { activeSceneId: string | null; modules: Record<string, unknown> } | null;
}

/** Every token on the live scene as the page holds it, with the DM's party start area. */
async function liveTokens(page: Page): Promise<{ tokens: { name: string; x: number; y: number; ownerId: string | null }[]; area: { x0: number; y0: number; x1: number; y1: number } | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sessionStore?: { getState(): Seen } }).__sessionStore?.getState();
    const sceneId = s?.session?.activeSceneId ?? '';
    const slice = s?.session?.modules.tokens as
      | { byScene?: Record<string, Record<string, { name: string; x: number; y: number; ownerId: string | null }>>; partyStart?: Record<string, { x0: number; y0: number; x1: number; y1: number }> }
      | undefined;
    return { tokens: Object.values(slice?.byScene?.[sceneId] ?? {}), area: slice?.partyStart?.[sceneId] ?? null };
  });
}

const inArea = (t: { x: number; y: number }, a: { x0: number; y0: number; x1: number; y1: number }) =>
  Math.floor(t.x) >= Math.min(a.x0, a.x1) && Math.floor(t.x) <= Math.max(a.x0, a.x1) && Math.floor(t.y) >= Math.min(a.y0, a.y1) && Math.floor(t.y) <= Math.max(a.y0, a.y1);

test.describe('@play lobby', () => {
  test('join lands in the lobby; pick one, make one; the DM sees ready and starts; both stand in the area', async ({ hostSession, joinAsPlayer }) => {
    const dm = hostSession.page;
    await expect(dm.getByTestId('lobby-strip')).toContainText('Not started');

    const sam = await joinAsPlayer('Sam');
    await expect(sam.getByTestId('lobby')).toBeVisible();
    await expect(sam.getByTestId('game-canvas')).toHaveCount(0);
    await sam.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await expect(sam.getByTestId('lobby-mine')).toHaveText('Bram');

    const ola = await joinAsPlayer('Ola');
    await ola.getByTestId('lobby-make-own').click();
    await ola.getByTestId('lobby-pc-name').fill('Wren');
    await ola.getByTestId('lobby-pc-create').click();
    await expect(ola.getByTestId('lobby-mine')).toHaveText('Wren');

    // Both seats finish the download and say so; the DM's count follows.
    await expect(sam.getByTestId('lobby-loading')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await expect(ola.getByTestId('lobby-loading')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await expect(dm.getByTestId('lobby-ready-count')).toHaveText('2 of 2 ready');
    await expect(sam.getByTestId('lobby-seat').filter({ hasText: 'Ola' })).toHaveAttribute('data-ready', 'true');

    await dm.getByTestId('lobby-start').click();
    await expect(sam.getByTestId('lobby')).toBeHidden({ timeout: 30_000 });
    await expect(sam.getByTestId('game-canvas')).toBeVisible();
    await expect(dm.getByTestId('lobby-strip')).toBeHidden();

    await expect.poll(async () => (await liveTokens(dm)).tokens.filter((t) => t.name === 'Bram' || t.name === 'Wren').length).toBe(2);
    const { tokens, area } = await liveTokens(dm);
    expect(area).not.toBeNull();
    for (const name of ['Bram', 'Wren']) expect(inArea(tokens.find((t) => t.name === name)!, area!)).toBe(true);
    // Yara, picked by nobody, stays off the map.
    expect(tokens.find((t) => t.name === 'Yara')).toBeUndefined();
  });

  test('a late joiner picks a character and lands beside the party', async ({ hostSession, joinAsPlayer }) => {
    const dm = hostSession.page;
    const sam = await joinAsPlayer('Sam');
    await sam.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await dm.getByTestId('lobby-start').click();
    await expect(sam.getByTestId('lobby')).toBeHidden({ timeout: 30_000 });

    const kai = await joinAsPlayer('Kai');
    await expect(kai.getByTestId('lobby')).toHaveCount(0);
    await expect(kai.getByTestId('pick-character')).toBeVisible();
    await kai.getByTestId('lobby-pc').filter({ hasText: 'Yara' }).click();
    await expect(kai.getByTestId('pick-character')).toBeHidden();

    await expect.poll(async () => (await liveTokens(dm)).tokens.some((t) => t.name === 'Yara')).toBe(true);
    const { tokens } = await liveTokens(dm);
    const bram = tokens.find((t) => t.name === 'Bram')!;
    const yara = tokens.find((t) => t.name === 'Yara')!;
    expect(Math.hypot(bram.x - yara.x, bram.y - yara.y)).toBeLessThan(4);
  });

  test('Back to lobby sends the players back and keeps the tokens where they are', async ({ hostSession, joinAsPlayer }) => {
    const dm = hostSession.page;
    const sam = await joinAsPlayer('Sam');
    await sam.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await dm.getByTestId('lobby-start').click();
    await expect(sam.getByTestId('game-canvas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await liveTokens(dm)).tokens.some((t) => t.name === 'Bram')).toBe(true);
    const before = (await liveTokens(dm)).tokens.find((t) => t.name === 'Bram')!;

    await dm.getByTestId('session-menu').click();
    await dm.getByTestId('back-to-lobby').click();
    await expect(dm.getByTestId('session-popover')).toContainText('Players go back to the lobby. Tokens stay where they are.');
    await dm.getByTestId('back-to-lobby-confirm').click();

    await expect(sam.getByTestId('lobby')).toBeVisible();
    await expect(dm.getByTestId('lobby-strip')).toContainText('Not started');
    const after = (await liveTokens(dm)).tokens.find((t) => t.name === 'Bram')!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });
});
