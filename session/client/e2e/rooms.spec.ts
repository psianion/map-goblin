// @rooms: rooms made in the editor arrive at the table and work (rooms plan section 8, the table
// half). The map is `cave-chambers`: a brush-like cave with two chambers and a passage, its divide
// lines and rooms accepted, and one outlined room on open ground. Written, never run by the
// builders: the tester runs it once.
//
// The start list and the Map tab name the same rooms, every one with a shape; a token starts in
// the picked room, walks through the passage to the east chamber, and, set outside the closed
// cave by the DM, walks into the outlined camp.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { assertMapLoaded, dragToken, expect, holdDmPass, joinTable, mintHandoff, standUpOutdoorCave, test, tokenAt } from './fixtures';

const CAVE_CHAMBERS = join(import.meta.dirname, '../../testdata/cave-chambers.ggvtt');
const CAVE_CHAMBERS_NAME = 'Cave chambers';

interface FixtureRoom {
  id: string;
  name: string;
  number: number;
  anchor: [number, number];
}

/** The fixture's rooms in their numbered order. */
function fixtureRooms(): FixtureRoom[] {
  const doc = JSON.parse(readFileSync(CAVE_CHAMBERS, 'utf8')) as { layers: { type: string; rooms?: FixtureRoom[] }[] };
  return doc.layers.flatMap((l) => (l.type === 'dungeon' ? (l.rooms ?? []) : [])).sort((a, b) => a.number - b.number);
}

/** The centre of the cell a room's pin is in: where a token stands in that room. */
const cellOf = (room: FixtureRoom) => ({ x: Math.floor(room.anchor[0]) + 0.5, y: Math.floor(room.anchor[1]) + 0.5 });

/** A cell of open ground between the cave and the camp, in no room. */
const OPEN_GROUND = { x: 15.5, y: 16.5 };

type TablePage = {
  __sessionStore: {
    getState(): {
      session: { activeSceneId: string | null; modules: Record<string, unknown> } | null;
      mapData: unknown;
      sendCommand(module: string, action: string, payload: unknown): void;
    };
  };
};

/**
 * The room a token stands in, as the table reads it: the room whose face, in the document this
 * page's table loaded, holds the token. Asked of the DM's page, whose document has every room.
 */
async function roomOfToken(page: Page, name: string): Promise<string | null> {
  return page.evaluate((wanted) => {
    const state = (window as unknown as TablePage).__sessionStore.getState();
    const session = state.session;
    const tokens = (session?.modules.tokens as { byScene?: Record<string, Record<string, { name: string; x: number; y: number }>> } | undefined)?.byScene?.[
      session?.activeSceneId ?? ''
    ];
    const token = tokens ? Object.values(tokens).find((t) => t.name === wanted) : undefined;
    if (!token) return null;
    const doc = state.mapData as { layers?: { type: string; rooms?: { id: string; boundary?: [number, number][] }[] }[] } | null;
    const inside = (ring: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > token.y !== yj > token.y && token.x < ((xj - xi) * (token.y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const rooms = (doc?.layers ?? []).flatMap((l) => (l.type === 'dungeon' ? (l.rooms ?? []) : []));
    return rooms.find((r) => (r.boundary?.length ?? 0) >= 3 && inside(r.boundary!))?.id ?? null;
  }, name);
}

/** The DM moves a token by name from their own page, over their own socket. */
async function dmMove(page: Page, name: string, to: { x: number; y: number }): Promise<void> {
  await page.evaluate(
    ({ wanted, to }) => {
      const state = (window as unknown as TablePage).__sessionStore.getState();
      const sceneId = state.session?.activeSceneId ?? '';
      const tokens = (state.session?.modules.tokens as { byScene?: Record<string, Record<string, { name: string }>> } | undefined)?.byScene?.[sceneId] ?? {};
      const id = Object.entries(tokens).find(([, t]) => t.name === wanted)?.[0];
      if (!id) throw new Error(`no token ${wanted} on the live scene`);
      state.sendCommand('tokens', 'move', { sceneId, id, x: to.x, y: to.y });
    },
    { wanted: name, to },
  );
}

/** The room ids the table's Map tab lists, in order. */
async function mapTabRooms(page: Page): Promise<string[]> {
  await page.keyboard.press('2');
  await expect(page.getByTestId('map-body')).toBeVisible();
  await page.getByTestId('map-family-rooms').click();
  const list = page.getByTestId('map-rooms').locator('[data-room-id]');
  await expect(list.first()).toBeVisible();
  return list.evaluateAll((items) => items.map((item) => item.getAttribute('data-room-id') ?? ''));
}

test.describe('@rooms rooms at the table', () => {
  test('the start list and the Map tab show the same rooms, and a token walks through all of them', async ({ page, newContext }) => {
    test.setTimeout(180_000);
    const rooms = fixtureRooms();
    expect(rooms.map((r) => r.name)).toEqual(['West chamber', 'Narrow way', 'East chamber', 'Camp']);

    // Publish (the fixture's upload) and open the Host wizard from a handoff, as the canvas does.
    const table = await standUpOutdoorCave(`Rooms ${Date.now().toString(36)}`, CAVE_CHAMBERS);
    await holdDmPass(page, table);
    await page.goto(`/host?e2e=1#handoff=${await mintHandoff(table, table.sceneId)}`);
    await expect(page.getByTestId('host-map')).toBeVisible();

    // The start list: every room, in number order, each with its outline.
    const tiles = page.getByTestId('host-starting-room').getByTestId('start-room');
    await expect(tiles).toHaveCount(rooms.length);
    expect(await tiles.evaluateAll((items) => items.map((item) => item.getAttribute('data-room-id')))).toEqual(rooms.map((r) => r.id));
    await expect(page.getByTestId('host-starting-room').getByTestId('start-room-outline')).toHaveCount(rooms.length);

    // Start in the west chamber and open the table.
    await tiles.filter({ hasText: 'West chamber' }).click();
    await page.getByTestId('host-open').click();
    await expect(page.getByTestId('host-invite')).toBeVisible();
    const invite = (await page.getByTestId('invite-code').textContent())!.trim();
    await page.getByTestId('enter-table').click();
    await expect(page.locator('[data-page="table"]')).toBeVisible();
    await assertMapLoaded(page, CAVE_CHAMBERS_NAME);

    // The Map tab lists the same rooms.
    expect(await mapTabRooms(page)).toEqual(rooms.map((r) => r.id));

    // A player joins, picks Bram, and the DM starts the table.
    const player = await (await newContext()).newPage();
    await joinTable(player, invite, 'Pim');
    await player.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await expect(player.getByTestId('lobby-mine')).toHaveText('Bram');
    await page.getByTestId('lobby-start').click();
    await expect(player.getByTestId('lobby')).toBeHidden({ timeout: 30_000 });
    await assertMapLoaded(player, CAVE_CHAMBERS_NAME);
    await expect.poll(() => tokenAt(player, 'Bram')).not.toBeNull();

    // Start puts Bram in the room picked in the wizard, on the cell of its pin.
    const [west, narrow, east, camp] = rooms as [FixtureRoom, FixtureRoom, FixtureRoom, FixtureRoom];
    await expect.poll(() => tokenAt(player, 'Bram'), { message: 'Bram starts in West chamber' }).toEqual(cellOf(west));
    await expect.poll(() => roomOfToken(page, 'Bram')).toBe(west.id);

    // Through the passage into the east chamber, one move a player may make at a time.
    for (const room of [narrow, east]) {
      const to = cellOf(room);
      await dragToken(player, 'Bram', to);
      await expect.poll(() => tokenAt(player, 'Bram'), { message: `Bram stands in ${room.name}` }).toEqual(to);
      await expect.poll(() => roomOfToken(page, 'Bram')).toBe(room.id);
    }

    // The cave has no mouth, so no player walks out of it: the DM sets Bram on the open ground
    // south of it, and from there he walks into the outlined camp.
    await dmMove(page, 'Bram', OPEN_GROUND);
    await expect.poll(() => tokenAt(player, 'Bram'), { message: 'Bram is outside the cave' }).toEqual(OPEN_GROUND);
    await expect.poll(() => roomOfToken(page, 'Bram')).toBeNull();
    await dragToken(player, 'Bram', cellOf(camp));
    await expect.poll(() => tokenAt(player, 'Bram'), { message: `Bram stands in ${camp.name}` }).toEqual(cellOf(camp));
    await expect.poll(() => roomOfToken(page, 'Bram')).toBe(camp.id);
  });
});
