// @publish: a canvas publish then republish reaches the live table (plan section 7). The canvas
// is a separate app, so the publish is driven with the same HTTP calls it makes: the first
// publish is `POST /api/campaigns/:id/maps` (the fixture does it), the republish is
// `PUT /api/scenes/:id/publish` with the DM pass. Unrun until step T.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DEMO_MAP, DEMO_NAME, SERVER_URL, expect, loadedMapName, test } from './fixtures';

const REVISED_NAME = `${DEMO_NAME} Revised`;

/** How many cells the shown level has cleared, off the DM's own fog layer. */
const clearedCells = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __fogProbe?: { clearedCells(): number } }).__fogProbe?.clearedCells() ?? 0);

// better-sqlite3 lives with the server package, not the client's.
const serverRequire = createRequire(join(import.meta.dirname, '../../server/package.json'));
type Db = { prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }; close(): void };

function queryDb<T>(run: (db: Db) => T): T {
  const Database = serverRequire('better-sqlite3') as new (path: string, opts: { readonly: boolean }) => Db;
  const db = new Database(join(process.env.E2E_DATA_DIR ?? '', 'game.db'), { readonly: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

test.describe('@publish canvas publish reaches the live table', () => {
  test('a republish swaps the map, keeps fog and tokens, leaves one mirror file and one map row', async ({ hostSession }) => {
    const { page, campaignId, sceneId, token } = hostSession;
    expect(process.env.E2E_DATA_DIR, 'global-setup exposes the server data dir').toBeTruthy();

    // Before: the DM turns fog on and clears some ground, and the PC types stand on the map.
    await page.keyboard.press('1');
    await page.getByTestId('fog-switch').click();
    await expect(page.getByTestId('fog-switch')).toHaveAttribute('aria-pressed', 'true');
    // Esc puts the brush the switch armed down; the dock stays open on Fog.
    await page.keyboard.press('Escape');
    await page.getByTestId('fog-clear-all').click();
    await expect.poll(() => clearedCells(page)).toBeGreaterThan(0);
    const cleared = await clearedCells(page);
    await page.keyboard.press('3');
    await page.getByTestId('tokens-filter-pc').click();
    await expect(page.getByTestId('token-tile')).toHaveCount(2);
    await expect(page.getByTestId('token-tile-count').first()).toHaveText('1');

    // The canvas publishes a revised file over the same scene.
    const revised = JSON.parse(readFileSync(DEMO_MAP, 'utf8')) as { mapSettings: { name: string } };
    revised.mapSettings.name = REVISED_NAME;
    const res = await fetch(`${SERVER_URL}/api/scenes/${sceneId}/publish`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(revised),
    });
    expect(res.status).toBe(200);
    // Then its picture, as the canvas sends it right after a publish (a 1x1 png here).
    const { mapId } = (await res.json()) as { mapId: string };
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const thumb = await fetch(`${SERVER_URL}/api/maps/${mapId}/thumbnail`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', Authorization: `Bearer ${token}` },
      body: png,
    });
    expect(thumb.status).toBe(204);

    // The live scene swaps to the new map, and says so.
    await expect(page.getByText('Map updated from the canvas')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => loadedMapName(page), { timeout: 30_000, intervals: [100] }).toBe(REVISED_NAME);

    // The scene switcher's row shows that picture.
    await page.getByTestId('title-switcher').click();
    await expect(page.getByTestId('scene-row').first().getByTestId('scene-thumb')).toHaveAttribute('data-image', 'true');
    await page.keyboard.press('Escape');
    // Closed, with focus back on its button: a digit typed while the search field still has it is
    // the field's, not the dock's.
    await expect(page.getByTestId('scene-search')).toBeHidden();
    await expect(page.getByTestId('title-switcher')).toBeFocused();

    // Fog, its cleared ground and the placed token survive the swap.
    await page.keyboard.press('1');
    await expect(page.getByTestId('fog-switch')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => clearedCells(page)).toBe(cleared);
    await page.keyboard.press('3');
    await page.getByTestId('tokens-filter-pc').click();
    await expect(page.getByTestId('token-tile-count').first()).toHaveText('1');

    // On disk: exactly one mirror file for the campaign, exactly one map row for the scene.
    const campaignDir = readdirSync(join(process.env.E2E_DATA_DIR!, 'maps')).filter((d) => d.endsWith(`--${campaignId.slice(0, 8)}`));
    expect(campaignDir).toHaveLength(1);
    const files = readdirSync(join(process.env.E2E_DATA_DIR!, 'maps', campaignDir[0]!)).filter((f) => f.endsWith('.ggvtt'));
    expect(files).toHaveLength(1);

    const { scenes, maps } = queryDb((db) => ({
      scenes: db.prepare('SELECT map_id FROM scenes WHERE id = ?').all(sceneId) as { map_id: string }[],
      maps: db.prepare('SELECT id, name FROM maps WHERE campaign_id = ?').all(campaignId) as { id: string; name: string }[],
    }));
    expect(scenes).toHaveLength(1);
    expect(maps).toHaveLength(1);
    expect(maps[0]!.id).toBe(scenes[0]!.map_id);
    expect(maps[0]!.name).toBe(REVISED_NAME);
    expect(DEMO_NAME).not.toBe(REVISED_NAME);
  });
});
