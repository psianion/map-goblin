// @play — the DM's undo and redo: a token move, a delete, a fog stroke and a door, each taken
// back by key and by the top-bar buttons, and put forward again.
import type { Page } from '@playwright/test';
import { dragToken, expect, test, tokenAt } from './fixtures';

type Probe = {
  __sessionStore: {
    getState(): {
      session: { activeSceneId: string | null; modules: Record<string, unknown> };
      history: { undo: { module: string; action: string } | null; redo: { module: string; action: string } | null };
      sendCommand(module: string, action: string, payload: unknown): void;
    };
  };
};

/** A command from the DM's own page, over its own socket: recorded like a click. */
const send = (page: Page, module: string, action: string, payload: unknown): Promise<void> =>
  page.evaluate(({ module, action, payload }) => (window as unknown as Probe).__sessionStore.getState().sendCommand(module, action, payload), {
    module,
    action,
    payload,
  });

/** What the DM's Undo would take back now, as `module.action`. */
const topUndo = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const step = (window as unknown as Probe).__sessionStore.getState().history.undo;
    return step ? `${step.module}.${step.action}` : null;
  });

/** Cleared cells on the live scene, every level counted. */
const clearedCells = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const session = (window as unknown as Probe).__sessionStore.getState().session;
    const fog = session.modules.fog as { byScene?: Record<string, { cleared?: Record<string, { cols: number; rows: number; bits: string }> }> } | undefined;
    let count = 0;
    for (const mask of Object.values(fog?.byScene?.[session.activeSceneId ?? '']?.cleared ?? {})) {
      const raw = atob(mask.bits);
      for (let bit = 0; bit < mask.cols * mask.rows; bit++) if (raw.charCodeAt(bit >>> 3) & (1 << (bit & 7))) count++;
    }
    return count;
  });

/** Past the lobby: its "Not started" strip floats over the map's corner, where a test token may sit. */
async function startTheTable(page: Page): Promise<void> {
  await page.getByTestId('lobby-start').click();
  await expect(page.getByTestId('lobby-strip')).toBeHidden();
}

const undoKey = (page: Page) => page.keyboard.press('Control+z');
const redoKey = (page: Page) => page.keyboard.press('Control+Shift+z');

test.describe('@play undo', () => {
  test('token move and delete, by key and by button, and redo', async ({ hostSession }) => {
    const { page } = hostSession;
    await startTheTable(page);
    await expect(page.getByTestId('history-undo')).toBeDisabled();
    await send(page, 'tokens', 'place', { name: 'Undo Rat', size: 'medium', disposition: 'hostile', x: 3.5, y: 3.5 });
    await expect.poll(() => tokenAt(page, 'Undo Rat')).not.toBeNull();
    const start = (await tokenAt(page, 'Undo Rat'))!;

    // A drag is one step, however many moves it streamed.
    await dragToken(page, 'Undo Rat', { x: start.x + 3, y: start.y });
    await expect.poll(() => tokenAt(page, 'Undo Rat')).toEqual({ x: start.x + 3, y: start.y });
    await expect.poll(() => topUndo(page)).toBe('tokens.move');
    await expect(page.getByTestId('history-undo')).toHaveAttribute('title', 'Undo token move');

    await undoKey(page);
    await expect.poll(() => tokenAt(page, 'Undo Rat')).toEqual(start);
    await expect(page.getByText('Undid token move')).toBeVisible();
    await expect.poll(() => topUndo(page)).toBe('tokens.place');
    await redoKey(page);
    await expect.poll(() => tokenAt(page, 'Undo Rat')).toEqual({ x: start.x + 3, y: start.y });
    await expect(page.getByText('Redid token move')).toBeVisible();

    // Delete, then the button brings it back and the other button removes it again.
    const id = await page.evaluate(() => {
      const session = (window as unknown as Probe).__sessionStore.getState().session;
      const tokens = (session.modules.tokens as { byScene: Record<string, Record<string, { id: string; name: string }>> }).byScene;
      return Object.values(tokens[session.activeSceneId ?? ''] ?? {}).find((t) => t.name === 'Undo Rat')!.id;
    });
    await send(page, 'tokens', 'delete', { id });
    await expect.poll(() => tokenAt(page, 'Undo Rat')).toBeNull();
    await page.getByTestId('history-undo').click();
    await expect.poll(() => tokenAt(page, 'Undo Rat')).toEqual({ x: start.x + 3, y: start.y });
    await page.getByTestId('history-redo').click();
    await expect.poll(() => tokenAt(page, 'Undo Rat')).toBeNull();
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('history-redo')).toBeDisabled();
  });

  test('a fog stroke is one step, by key, and redo', async ({ hostSession }) => {
    const { page } = hostSession;
    await startTheTable(page);
    // Everything cleared first, then a Fog stroke across the middle of the map: the Clear brush
    // only opens ground with floor on it, and this map's middle row may be rock.
    await send(page, 'fog', 'set-on', { on: true });
    await send(page, 'fog', 'clear-all', {});
    await expect.poll(() => clearedCells(page)).toBeGreaterThan(0);
    const all = await clearedCells(page);
    await page.keyboard.press('Shift+W');
    const box = (await page.getByTestId('game-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.45, { steps: 30 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect.poll(() => clearedCells(page)).toBeLessThan(all);
    const stroke = await clearedCells(page);
    await expect.poll(() => topUndo(page)).toBe('fog.region-set');

    await undoKey(page);
    await expect.poll(() => clearedCells(page)).toBe(all);
    await expect.poll(() => topUndo(page)).toBe('fog.clear-all');
    await redoKey(page);
    await expect.poll(() => clearedCells(page)).toBe(stroke);
  });

  test('a door, by button, and redo by key', async ({ hostSession }) => {
    const { page } = hostSession;
    await startTheTable(page);
    await page.keyboard.press('2');
    await page.getByTestId('map-family-doors').click();
    // The first lockable door: an archway has no leaf to open.
    const door = page.getByTestId('map-doors').locator('[data-door-id]').filter({ has: page.getByTestId('door-lock') }).first();
    const was = await door.getAttribute('data-open');
    await door.getByTestId('door-toggle').click();
    await expect(door).not.toHaveAttribute('data-open', was ?? '');
    await expect.poll(() => topUndo(page)).toBe('doors.toggle');

    await page.getByTestId('history-undo').click();
    await expect(door).toHaveAttribute('data-open', was ?? '');
    await redoKey(page);
    await expect(door).not.toHaveAttribute('data-open', was ?? '');
  });
});
