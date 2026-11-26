// @map: the Fog and Map tabs. Written, never run by the builders: the tester runs it once.
//
// The fog acceptance walk runs on the outdoor-cave fixture (fog rework plan section 5.3): a
// player sees the whole map until the DM turns fog on, then only the ground the DM's brush and
// the party's own sight clear, at night as by day, and the DM's own view of it as exact cells
// until "As players see it".
import type { Page } from '@playwright/test';
import {
  CAVE,
  OUTDOOR_CAVE_NAME,
  assertMapLoaded,
  dragToken,
  expect,
  holdDmPass,
  joinTable,
  mintHandoff,
  standUpOutdoorCave,
  test,
  tokenAt,
  worldPoint,
} from './fixtures';

/** What a seat's fog layer reports (`__fogProbe`, FogRenderer). */
interface FogProbe {
  visible(): boolean;
  solid(): boolean;
  cloud(): boolean;
  clearedCells(): number;
  shownAt(x: number, y: number): boolean | null;
}

interface StoreProbe {
  getState(): {
    you: { identityId: string } | null;
    mapData: { layers: { rooms?: { id: string }[]; children?: { id: string }[] }[] } | null;
    session: { activeSceneId: string; modules: { fog?: { byScene: Record<string, { look?: { base?: string } }> } } } | null;
  };
}

/** One reading off a seat's fog probe. */
const probe = <K extends keyof FogProbe>(page: Page, key: K, ...args: Parameters<FogProbe[K]>): Promise<ReturnType<FogProbe[K]>> =>
  page.evaluate(
    ({ key, args }) => (window as unknown as { __fogProbe: Record<string, (...a: unknown[]) => unknown> }).__fogProbe[key]!(...args),
    { key, args: args as unknown[] },
  ) as Promise<ReturnType<FogProbe[K]>>;

/** A command from the DM's own page, over its own socket. */
const send = (page: Page, module: string, action: string, payload: unknown): Promise<void> =>
  page.evaluate(
    ({ module, action, payload }) =>
      (window as unknown as { __sessionStore: { getState(): { sendCommand(m: string, a: string, p: unknown): void } } }).__sessionStore
        .getState()
        .sendCommand(module, action, payload),
    { module, action, payload },
  );

/** The room ids in a seat's map document. */
const roomsHeld = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const doc = (window as unknown as { __sessionStore: StoreProbe }).__sessionStore.getState().mapData;
    return (doc?.layers ?? []).flatMap((l) => (l.rooms ?? []).map((r) => r.id));
  });

/** The DM's table, opened the way the canvas opens it: a handoff, Party start, Open. */
async function openFromHandoff(page: Page, table: Awaited<ReturnType<typeof standUpOutdoorCave>>): Promise<string> {
  const code = await mintHandoff(table, table.sceneId);
  await page.goto(`/host?e2e=1#handoff=${code}`);
  await expect(page.getByTestId('host-map')).toBeVisible();
  await page.getByTestId('start-party').click();
  await page.getByTestId('host-open').click();
  await expect(page.getByTestId('host-invite')).toBeVisible();
  const invite = (await page.getByTestId('invite-code').textContent())!.trim();
  await page.getByTestId('enter-table').click();
  await expect(page.locator('[data-page="table"]')).toBeVisible();
  await assertMapLoaded(page, OUTDOOR_CAVE_NAME);
  return invite;
}

/** One brush stroke through world points, the way a hand drags it. */
async function stroke(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const first = await worldPoint(page, points[0]!.x, points[0]!.y);
  await page.mouse.move(box.x + first.x, box.y + first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const at = await worldPoint(page, p.x, p.y);
    await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 8 });
  }
  await page.mouse.up();
}

/** A stroke round the hall's inside, well clear of its walls, and one round its rim. */
const HALL = [
  { x: 5.5, y: 5.5 },
  { x: 10.5, y: 5.5 },
  { x: 10.5, y: 8.5 },
  { x: 5.5, y: 8.5 },
  { x: 5.5, y: 5.5 },
  { x: 8, y: 7 },
];
const HALL_RIM = [
  { x: 4.5, y: 4.5 },
  { x: 11.5, y: 4.5 },
  { x: 11.5, y: 9.5 },
  { x: 4.5, y: 9.5 },
  { x: 4.5, y: 4.5 },
];
/** Where the goblin waits, in the hall. */
const GOBLIN = { x: 8.5, y: 7.5 };
/** The cave mouth, open; a cell inside the cave; one past the inner door, in view from the mouth; fogged ground south of the start. */
const MOUTH = { x: 18.5, y: 9.5 };
const IN_CAVE = { x: 19.5, y: 9.5 };
const PAST_INNER_DOOR = { x: 22.5, y: 4.5 };
const SOUTH = { x: 15.5, y: 12.5 };

test.describe('@map the fog, on the outdoor cave', () => {
  test('the acceptance walk: off, on, brush, Auto-explore, a room fogged again, Fog all, the look', async ({ page, newContext }) => {
    test.setTimeout(240_000);
    const table = await standUpOutdoorCave(`Fog ${Date.now().toString(36)}`);
    await holdDmPass(page, table);

    // 1. Open the table. A player joins, gets Bram, and sees the whole map: fog is off.
    const invite = await openFromHandoff(page, table);
    await send(page, 'tokens', 'place', { name: 'Goblin', size: 'medium', disposition: 'hostile', x: GOBLIN.x, y: GOBLIN.y });
    const context = await newContext();
    const player = await context.newPage();
    await joinTable(player, invite, 'Pim');
    // The table waits in the lobby: Pim picks Bram there, and Start puts him in the party start area.
    await player.getByTestId('lobby-pc').filter({ hasText: 'Bram' }).click();
    await expect(player.getByTestId('lobby-mine')).toHaveText('Bram');
    await send(page, 'table', 'start', { on: true });
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.partyStart);
    await expect.poll(() => roomsHeld(player)).toContain('room-hall');
    await expect.poll(() => tokenAt(player, 'Goblin')).not.toBeNull();
    // The player's map mounted a moment ago, at Start: its fog layer may still be on its way.
    await expect.poll(() => probe(player, 'visible').catch(() => null)).toBe(false);

    // 2. The DM turns fog on from the Fog card, which arms the Clear brush. The player sees fog
    // everywhere, and their own token.
    await page.keyboard.press('1');
    await expect(page.getByTestId('fog-body')).toHaveAttribute('data-fog', 'off');
    await page.getByTestId('fog-switch').click();
    await expect(page.getByTestId('fog-switch')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('fog-brush-clear')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => probe(player, 'visible')).toBe(true);
    expect(await probe(player, 'solid')).toBe(true);
    expect(await probe(player, 'clearedCells')).toBe(0);
    await expect.poll(() => tokenAt(player, 'Goblin')).toBeNull();
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.partyStart);

    // 3. The DM brushes the ground from the start to the cave mouth clear (the dock folded out
    // of the way). The player sees that ground; the DM's map shows the exact cells, no cloud.
    await page.keyboard.press('b');
    await stroke(page, [CAVE.partyStart, CAVE.dirt, MOUTH]);
    await page.keyboard.press('Escape');
    await expect.poll(() => probe(player, 'clearedCells')).toBeGreaterThan(0);
    await expect.poll(() => probe(player, 'shownAt', CAVE.dirt.x, CAVE.dirt.y)).toBe(true);
    expect(await probe(page, 'visible')).toBe(true);
    expect(await probe(page, 'solid')).toBe(false);
    expect(await probe(page, 'cloud')).toBe(false);

    // 4. The DM turns Auto-explore off. The player walks inside the cleared ground and is
    // refused at its edge.
    await page.keyboard.press('1');
    await page.getByTestId('fog-auto-explore').click();
    await expect(page.getByTestId('fog-auto-explore')).toHaveAttribute('aria-pressed', 'false');
    await dragToken(player, 'Bram', CAVE.dirt);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.dirt);
    const cleared = await probe(player, 'clearedCells');
    await dragToken(player, 'Bram', SOUTH);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.dirt);
    expect(await probe(player, 'clearedCells')).toBe(cleared);

    // 5. Night falls (darkness 1, no light carried) and Auto-explore goes back on (its default).
    // The player walks into the cave mouth and the cave clears ahead in the dark, as it would by
    // day. The hall stays fogged: from the dirt and from the mouth, both within sight range of it,
    // its walls and its closed door stand in the way. (The inner cave door is a lone wall in an
    // open cave, so the ground past it is in view from the mouth.)
    await send(page, 'triggers', 'set-darkness', { value: 1 });
    await page.getByTestId('fog-auto-explore').click();
    await expect(page.getByTestId('fog-auto-explore')).toHaveAttribute('aria-pressed', 'true');
    await dragToken(player, 'Bram', MOUTH);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(MOUTH);
    await expect.poll(() => probe(player, 'clearedCells')).toBeGreaterThan(cleared);
    await expect.poll(() => probe(player, 'shownAt', IN_CAVE.x, IN_CAVE.y)).toBe(true);
    expect(await probe(player, 'shownAt', CAVE.inHall.x, CAVE.inHall.y)).toBe(false);
    // …and the ground that step cleared can be walked onto, still in the dark.
    await dragToken(player, 'Bram', IN_CAVE);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(IN_CAVE);

    // 6. The goblin appears when its room's ground clears: the DM brushes the hall with W.
    await page.keyboard.press('w');
    await expect(page.getByTestId('fog-brush-clear')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('b');
    await stroke(page, HALL);
    await expect.poll(() => tokenAt(player, 'Goblin')).not.toBeNull();
    await expect.poll(() => roomsHeld(player)).toContain('room-hall');

    // 7. The DM fogs the hall again with the Fog brush (Shift+W). The goblin and the room are
    // gone for the player.
    await page.keyboard.press('Shift+W');
    await stroke(page, HALL_RIM);
    await stroke(page, HALL);
    await page.keyboard.press('Escape');
    await expect.poll(() => tokenAt(player, 'Goblin')).toBeNull();
    await expect.poll(() => roomsHeld(player)).not.toContain('room-hall');

    // 8. Fog all, then Undo.
    await page.keyboard.press('1');
    const held = await probe(player, 'clearedCells');
    await page.getByTestId('fog-fog-all').click();
    await expect.poll(() => probe(player, 'clearedCells')).toBe(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => probe(player, 'clearedCells')).toBe(held);

    // 9. The DM opens the Look sheet and changes the colour. The player's fog changes.
    await page.getByTestId('fog-look-customise').click();
    const sheet = page.getByTestId('fog-look-sheet');
    await expect(sheet).toBeVisible();
    // While the sheet is open the DM's map is drawn as players see it.
    await expect.poll(() => probe(page, 'solid')).toBe(true);
    await sheet.getByRole('button', { name: 'Colour' }).click();
    await page.getByLabel('Colour hex').fill('#5f6d64');
    await expect
      .poll(() =>
        player.evaluate(() => {
          const st = (window as unknown as { __sessionStore: StoreProbe }).__sessionStore.getState();
          return st.session?.modules.fog?.byScene[st.session.activeSceneId]?.look?.base ?? null;
        }),
      )
      .toBe('#5f6d64');
    await expect(page.getByTestId('fog-look-name')).toHaveText('Your mix');
    await sheet.getByRole('button', { name: 'Close Fog look' }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => probe(page, 'solid')).toBe(false);

    // 10. "As players see it" on the DM's screen matches the player's: solid, and the same
    // ground shown, away from the player's own token.
    await page.getByTestId('as-players').click();
    await expect.poll(() => probe(page, 'solid')).toBe(true);
    expect(await probe(page, 'cloud')).toBe(true);
    for (const at of [CAVE.dirt, GOBLIN, SOUTH, PAST_INNER_DOOR]) {
      expect(await probe(page, 'shownAt', at.x, at.y), `shown at ${at.x},${at.y}`).toBe(await probe(player, 'shownAt', at.x, at.y));
    }
  });
});

test.describe('@map the Map tab', () => {
  test('Map: doors open and lock, a secret is revealed', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('map-family-doors').click();
    // The first lockable door: an archway (Goblin Warren's first two) has no door to open or lock.
    const door = page.getByTestId('map-doors').locator('[data-door-id]').filter({ has: page.getByTestId('door-lock') }).first();
    await door.getByTestId('door-toggle').click();
    await expect(door).toHaveAttribute('data-open', 'true');
    await door.getByTestId('door-lock').click();
    await expect(door).toHaveAttribute('data-locked', 'true');
    const secret = page.getByTestId('door-reveal-secret').first();
    if (await secret.count()) {
      await secret.click();
      await expect(secret).toBeDisabled();
    }
  });

  test('Map: lights on and off, triggers fire', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('map-family-lights').click();
    const lights = page.getByTestId('map-lights');
    if (await lights.count()) {
      const toggle = lights.getByRole('switch').first();
      const before = await toggle.getAttribute('aria-checked');
      await toggle.click();
      await expect(toggle).not.toHaveAttribute('aria-checked', before ?? '');
    }
    await page.getByTestId('map-family-triggers').click();
    const fire = page.getByTestId('trigger-fire').first();
    if (await fire.count()) {
      const rearm = page.getByTestId('trigger-rearm').first();
      await expect(rearm).toBeDisabled();
      await fire.click();
      await expect(fire).toBeDisabled();
      await expect(rearm).toBeEnabled();
      await rearm.click();
      await expect(fire).toBeEnabled();
    }
  });

  test('Map: a room key sheet opens and shares its read-aloud', async ({ hostSession }) => {
    const { page } = hostSession;
    await page.keyboard.press('2');
    await page.getByTestId('room-key').first().click();
    const sheet = page.getByTestId('room-key-sheet');
    await expect(sheet).toBeVisible();
    const share = sheet.getByTestId('room-share');
    if (await share.count()) {
      await share.click();
      await expect(sheet).toContainText('Shared');
    }
  });
});
