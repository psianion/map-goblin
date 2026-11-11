// @play — the DM's pause freezes every player seat: the whole table grey and out of reach, one
// card with Leave table on top, and it lifts the moment the DM resumes.
import type { Page } from '@playwright/test';
import { assertMapLoaded, expect, test, tokenPoint } from './fixtures';

type Probe = {
  __sessionStore: {
    getState(): {
      you: { identityId: string } | null;
      session: { activeSceneId: string | null; players: { identityId: string; name: string; role: string }[]; modules: Record<string, unknown> };
      sendCommand(module: string, action: string, payload: unknown): void;
    };
  };
  __testProbe: { camera(): { x: number; y: number; scale: number } | null };
};

/** Bram's token on the live scene as this seat holds it. */
const bram = (page: Page) =>
  page.evaluate(() => {
    const session = (window as unknown as Probe).__sessionStore.getState().session;
    const tokens = (session.modules.tokens as { byScene: Record<string, Record<string, { id: string; name: string; x: number; y: number; ownerId?: string }>> }).byScene;
    return Object.values(tokens[session.activeSceneId ?? ''] ?? {}).find((t) => t.name === 'Bram') ?? null;
  });

/** How many lines the roll log holds on this seat. */
const rolls = (page: Page) =>
  page.evaluate(() => ((window as unknown as Probe).__sessionStore.getState().session.modules.rolls as { log?: unknown[] } | undefined)?.log?.length ?? 0);

const camera = (page: Page) => page.evaluate(() => (window as unknown as Probe).__testProbe.camera());

/** Drag Bram `cells` to the right with the mouse, the way a player moves a piece. */
async function dragBram(page: Page, cells: number): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const at = await tokenPoint(page, 'Bram');
  const scale = (await camera(page))!.scale;
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + (cells * scale) / 2, box.y + at.y, { steps: 5 });
  await page.mouse.move(box.x + at.x + cells * scale, box.y + at.y, { steps: 5 });
  await page.mouse.up();
}

/** A click where the d20 on the roll bar is, whatever lies over it. */
async function clickD20(page: Page): Promise<void> {
  const box = (await page.getByTestId('roll-bar-d20').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('@play pause', () => {
  test('a paused table freezes the player’s seat, and resuming frees it', async ({ hostSession, joinAsPlayer }) => {
    const dm = hostSession.page;
    const player = await joinAsPlayer('Bram');
    await assertMapLoaded(player);

    // Bram's piece is the player's to move.
    const seat = await player.evaluate(() => (window as unknown as Probe).__sessionStore.getState().you!.identityId);
    await dm.evaluate((identityId) => {
      const store = (window as unknown as Probe).__sessionStore.getState();
      const tokens = (store.session.modules.tokens as { byScene: Record<string, Record<string, { id: string; name: string }>> }).byScene;
      const token = Object.values(tokens[store.session.activeSceneId ?? ''] ?? {}).find((t) => t.name === 'Bram')!;
      store.sendCommand('tokens', 'assign', { id: token.id, identityId });
    }, seat);
    await expect.poll(async () => (await bram(player))?.ownerId).toBe(seat);

    // The DM pauses from the Session menu; a Paused chip sits by the title.
    await dm.getByTestId('session-menu').click();
    await dm.getByRole('switch', { name: 'Pause the table' }).click();
    await dm.keyboard.press('Escape');
    await expect(dm.getByTestId('paused-chip')).toBeVisible();
    await expect(dm.locator('[data-page="table"]')).not.toHaveAttribute('inert');

    // The player's shell is inert and grey, under one card.
    const shell = player.locator('[data-page="table"]');
    await expect(shell).toHaveAttribute('inert');
    await expect.poll(() => shell.evaluate((el) => getComputedStyle(el).filter)).toContain('grayscale');
    await expect(player.getByTestId('pause-card')).toContainText('The DM has paused the table');
    await expect(player.getByTestId('pause-leave')).toBeVisible();

    // A drag, a dice click and a wheel over the map all do nothing.
    const from = (await bram(player))!;
    const logBefore = await rolls(player);
    const cameraBefore = await camera(player);
    await dragBram(player, 2);
    await clickD20(player);
    const box = (await player.getByTestId('game-canvas').boundingBox())!;
    await player.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await player.mouse.wheel(0, -400);
    await player.waitForTimeout(600);
    expect(await bram(player)).toMatchObject({ x: from.x, y: from.y });
    expect(await bram(dm)).toMatchObject({ x: from.x, y: from.y });
    expect(await rolls(player)).toBe(logBefore);
    expect(await camera(player)).toEqual(cameraBefore);

    // The DM resumes from the chip: the card goes, and the same gestures work.
    await dm.getByTestId('paused-chip').click();
    await expect(player.getByTestId('pause-overlay')).toHaveCount(0);
    await expect(shell).not.toHaveAttribute('inert');
    await expect(dm.getByTestId('paused-chip')).toHaveCount(0);
    await clickD20(player);
    await expect.poll(() => rolls(player)).toBe(logBefore + 1);
    await dragBram(player, 2);
    await expect.poll(async () => (await bram(dm))?.x).toBeGreaterThan(from.x);
  });
});
