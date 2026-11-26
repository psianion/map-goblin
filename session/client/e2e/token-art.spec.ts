// @play — the token picture editor (table lobby pass, plan 3.4): a player uploads a picture,
// moves and zooms it inside the circle, picks a ring, and the token on the map and its
// portrait carry the same picture and ring. Written, not run, in the builder step.
import type { Page } from '@playwright/test';
import { dmCommands, expect, test } from './fixtures';

/** A 300 by 200 PNG drawn in the page, as an upload the file input takes. */
async function picture(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3a7';
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = '#fff';
    g.fillRect(120, 60, 60, 80);
    return c.toDataURL('image/png');
  });
  return { name: 'bram.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

/** The player's own token on the live scene, off the session store. */
async function myToken(page: Page): Promise<{ imageAssetId: string | null; ring?: string } | null> {
  return page.evaluate(() => {
    const store = (window as unknown as { __sessionStore?: { getState(): { you?: { identityId: string }; session: { activeSceneId: string | null; modules: Record<string, unknown> } | null } } }).__sessionStore;
    const s = store?.getState();
    const scene = (s?.session?.modules.tokens as { byScene?: Record<string, Record<string, { ownerId: string | null; imageAssetId: string | null; ring?: string }>> } | undefined)
      ?.byScene?.[s?.session?.activeSceneId ?? ''];
    return (scene && Object.values(scene).find((t) => t.ownerId === s?.you?.identityId)) ?? null;
  });
}

test.describe('@play token art', () => {
  test('upload, crop and ring in the lobby; the map token and the portrait match', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Sam');
    await expect(player.getByTestId('lobby')).toBeVisible();
    await player.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();

    const editor = player.getByTestId('token-art-editor');
    await expect(editor).toBeVisible();
    await player.getByTestId('token-art-file').setInputFiles(await picture(player));
    const view = player.getByTestId('token-art-view');
    const box = (await view.boundingBox())!;
    await player.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await player.mouse.down();
    await player.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
    await player.mouse.up();
    await view.hover();
    await player.mouse.wheel(0, -300);
    await player.getByTestId('token-art-ring-be185d').click();
    await player.getByTestId('token-art-save').click();
    await expect(editor.getByTestId('token-art-save')).toBeEnabled();

    await dmCommands(hostSession.token, [{ module: 'table', action: 'start', payload: { on: true } }]);
    await expect(player.getByTestId('lobby')).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => myToken(player)).toMatchObject({ ring: '#be185d' });
    const token = await myToken(player);
    expect(token?.imageAssetId).toBeTruthy();

    // The portrait in the party sheet wears the same ring.
    await player.getByTestId('sheet-tab-party').click();
    await expect(player.getByTestId('party-row').filter({ hasText: 'Bram' }).locator('[data-ring]')).toHaveAttribute('data-ring', '#be185d');
  });

  test('Edit my token on the map changes the ring mid-game', async ({ hostSession, joinAsPlayer }) => {
    const player = await joinAsPlayer('Sam');
    await player.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await player.getByTestId('token-art-save').click();
    await dmCommands(hostSession.token, [{ module: 'table', action: 'start', payload: { on: true } }]);
    await expect(player.getByTestId('lobby')).toBeHidden({ timeout: 30_000 });

    await player.keyboard.press('f');
    const canvas = player.getByTestId('game-canvas');
    const size = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
    await player.getByTestId('token-card-edit-mine').click();
    await player.getByTestId('token-art-ring-none').click();
    await player.getByTestId('token-art-save').click();
    await expect.poll(() => myToken(player)).toMatchObject({ ring: 'none' });
  });
});
