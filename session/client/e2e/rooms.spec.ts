// @rooms: rooms made in the editor arrive at the table and work (rooms plan section 8, the table
// half). The map is `cave-chambers`: a brush-like cave with two chambers and a passage, its divide
// lines and rooms accepted, and one outlined room on open ground. Written, never run by the
// builders: the tester runs it once.
//
// The start list and the Map tab name the same rooms, every one with a shape; a token walks
// through all four.
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

    // West chamber, the passage, the east chamber, and out round the cave to the camp: no room
    // stops a step, the outlined camp on open ground included.
    for (const room of rooms) {
      const to = cellOf(room);
      await dragToken(player, 'Bram', to);
      await expect.poll(() => tokenAt(player, 'Bram'), { message: `Bram stands in ${room.name}` }).toEqual(to);
    }
  });
});
