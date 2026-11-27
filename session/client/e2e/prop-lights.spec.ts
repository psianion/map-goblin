// @lights: the prop lights pass at the table. The DM switches a light group from the Map tab's
// Lights family, and the player's screen shows both candles' lights off and their unlit
// pictures. Written by the builder and run once in P5 (`pnpm e2e prop-lights.spec.ts`).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DEMO_MAP, assertMapLoaded, expect, hostMap, joinTable, startTable, test } from './fixtures';

const MAP_NAME = 'Prop Lights';
const CANDLE = 'gg-demo:light_candle_large_lit_1x1_object_A';

/** The demo map, unzoned (so a player gets all of it), with two lit candles grouped "Hall". */
function propLightsMap(): string {
  const doc = JSON.parse(readFileSync(DEMO_MAP, 'utf8')) as {
    mapSettings: { name: string };
    layers: { type: string; rooms?: unknown[]; areas?: unknown[]; children: Record<string, unknown>[] }[];
  };
  doc.mapSettings.name = MAP_NAME;
  for (const layer of doc.layers) {
    if (layer.type !== 'dungeon') continue;
    layer.rooms = [];
    layer.areas = [];
  }
  const layer = doc.layers.find((l) => l.type === 'dungeon')!;
  const near = (layer.children.find((c) => c.childType === 'asset')?.position as { x: number; y: number } | undefined) ?? { x: 10, y: 10 };
  for (const [i, dx] of [0, 3].entries()) {
    const id = `candle-${i}`;
    const at = { x: near.x + dx, y: near.y };
    layer.children.push(
      { id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: CANDLE, position: at, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false },
      { id: `flame-${i}`, name: id, childType: 'light', visible: true, color: '#ffc98a', radius: 2, featherRadius: 1, intensity: 0.7, falloff: 'quadratic', position: at, attachedTo: id, group: 'Hall' },
    );
  }
  const file = join(mkdtempSync(join(tmpdir(), 'prop-lights-')), 'prop-lights.mapbuilder');
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

/** The two candle lights as this page's core store holds them, and each candle sprite's texture id. */
async function candles(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __STORE__?: { getState(): { layers: { type: string; children: { id: string; childType: string; visible: boolean }[] }[] } };
      __pixiApp?: { stage: unknown };
    };
    const lights = (w.__STORE__?.getState().layers ?? [])
      .flatMap((l) => (l.type === 'dungeon' ? l.children : []))
      .filter((c) => c.childType === 'light' && c.id.startsWith('flame-'))
      .map((c) => c.visible);
    const textures: (number | null)[] = [];
    const find = (node: unknown, label: string): { texture?: { uid?: number } } | null => {
      const n = node as { label?: string; children?: unknown[] };
      if (n.label === label) return n as { texture?: { uid?: number } };
      for (const c of n.children ?? []) {
        const hit = find(c, label);
        if (hit) return hit;
      }
      return null;
    };
    for (const id of ['candle-0', 'candle-1']) textures.push(find(w.__pixiApp?.stage, `placed-${id}`)?.texture?.uid ?? null);
    return { lights, textures };
  });
}

test.describe('@lights prop lights at the table', () => {
  test('the DM switches a group and the player sees the candles go out, pictures and all', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const table = await hostMap(page, propLightsMap(), MAP_NAME);
    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    try {
      await joinTable(player, table.inviteCode, 'Pim');
      await startTable(page, player);
      await assertMapLoaded(player, MAP_NAME);
      await expect.poll(async () => (await candles(player)).lights, { timeout: 30_000 }).toEqual([true, true]);
      await expect.poll(async () => (await candles(player)).textures.every((t) => t !== null), { timeout: 60_000 }).toBe(true);
      const lit = (await candles(player)).textures;

      await page.keyboard.press('2');
      await page.getByTestId('map-family-lights').click();
      const row = page.getByTestId('light-groups').locator('[data-switch-row="group:Hall"]');
      await expect(row).toContainText('2 lights');
      await row.getByRole('switch').click();

      // The DM's own screen first, then the player's: both lights off, both pictures swapped.
      await expect.poll(async () => (await candles(page)).lights, { timeout: 15_000 }).toEqual([false, false]);
      await expect.poll(async () => (await candles(player)).lights, { timeout: 15_000 }).toEqual([false, false]);
      await expect
        .poll(async () => (await candles(player)).textures.every((t, i) => t !== null && t !== lit[i]), { timeout: 30_000 })
        .toBe(true);
    } finally {
      await playerContext.close();
    }
  });
});
