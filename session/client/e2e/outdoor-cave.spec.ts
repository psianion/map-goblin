// @cave: the table fix pass acceptance test (plan section 6.2), on the 3.11 outdoor-cave fixture.
// Written, never run by the builders: the tester runs it once (section 6.3).
//
// Nine steps in order: publish, hand off, Party start, open; a player joins and gets Bram through
// the Owner picker; sees dirt, rock and the door from outside; walks on dirt, is refused by rock
// and told the door is closed; opens the door and walks in, the outdoor ground staying
// remembered; a republish toasts the player; "Open the table" again carries the session on; the
// player closes the tab and "Continue as" returns the token; a short repeat in By hand mode.
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
  republish,
  standUpOutdoorCave,
  test,
  tokenAt,
  worldPoint,
} from './fixtures';

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

/** The DM hands Bram to a player through the token card's Owner picker. */
async function handOver(dm: Page, player: string): Promise<void> {
  const canvas = dm.getByTestId('game-canvas');
  const box = (await canvas.boundingBox())!;
  const at = await worldPoint(dm, CAVE.partyStart.x, CAVE.partyStart.y);
  await dm.mouse.click(box.x + at.x, box.y + at.y);
  await expect(dm.getByTestId('token-card')).toBeVisible();
  await dm.getByLabel('Owner').click();
  await dm.getByRole('option', { name: player }).click();
}

test.describe('@cave outdoor ground, walls and a cave mouth', () => {
  test('the nine steps of the acceptance walk', async ({ page, newContext }) => {
    test.setTimeout(240_000);
    const table = await standUpOutdoorCave(`Cave ${Date.now().toString(36)}`);
    await holdDmPass(page, table);

    // 1. Publish (the fixture's upload), hand off, pick Party start, open the table. Steps 1 to
    // 8 run in By sight; step 9 is the By hand repeat.
    const invite = await openFromHandoff(page, table);
    await page.keyboard.press('1');
    await page.getByTestId('fog-mode-vision').click();
    await expect(page.getByTestId('fog-mode-vision')).toHaveAttribute('aria-pressed', 'true');

    // 2. A player joins and gets a token through the Owner picker.
    const context = await newContext();
    let player = await context.newPage();
    await joinTable(player, invite, 'Pim');
    await handOver(page, 'Pim');
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.partyStart);

    // 3. The player sees dirt, rock and the door from outside: the cave and the door ship.
    await expect
      .poll(() =>
        player.evaluate(() => {
          const doc = (window as unknown as { __sessionStore?: { getState(): { mapData: { openGround?: unknown[]; layers: { children?: { id: string }[] }[] } | null } } }).__sessionStore?.getState().mapData;
          const ids = new Set(doc?.layers.flatMap((l) => (l.children ?? []).map((c) => c.id)) ?? []);
          return { open: (doc?.openGround?.length ?? 0) > 0, cave: ids.has('cave-floor'), door: ids.has('door-hall') };
        }),
      )
      .toEqual({ open: true, cave: true, door: true });

    // 4. Walks on dirt; refused by rock; told the door is closed.
    await dragToken(player, 'Bram', CAVE.dirt);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.dirt);
    await dragToken(player, 'Bram', CAVE.rock);
    await expect(player.getByText("You can't stand inside a wall or rock.")).toBeVisible();
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.dirt);
    await dragToken(player, 'Bram', CAVE.inHall);
    // Nameless: the server blanks a door's name while the room behind it is unearned.
    await expect(player.getByText('The door is closed.')).toBeVisible();

    // 5. Opens the door (beside it, a double-click), walks in; the outdoor ground stays.
    await dragToken(player, 'Bram', CAVE.besideDoor);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.besideDoor);
    const box = (await player.getByTestId('game-canvas').boundingBox())!;
    const door = await worldPoint(player, CAVE.door.x, CAVE.door.y);
    await player.mouse.dblclick(box.x + door.x, box.y + door.y);
    await dragToken(player, 'Bram', CAVE.inHall);
    await expect.poll(() => tokenAt(player, 'Bram')).toEqual(CAVE.inHall);
    await expect
      .poll(() =>
        player.evaluate(() => {
          const doc = (window as unknown as { __sessionStore?: { getState(): { mapData: { openGround?: unknown[] } | null } } }).__sessionStore?.getState().mapData;
          return (doc?.openGround?.length ?? 0) > 0;
        }),
      )
      .toBe(true);

    // 6. The DM republishes and the player gets the toast.
    await republish(table, table.sceneId);
    await expect(player.getByText('Map updated from the canvas')).toBeVisible({ timeout: 15_000 });

    // 7. "Open the table" again: same session, same invite code.
    const again = await mintHandoff(table, table.sceneId);
    await page.goto(`/host?e2e=1#handoff=${again}`);
    await expect(page.getByTestId('host-invite').or(page.getByTestId('host-map'))).toBeVisible();
    if (await page.getByTestId('host-open').isVisible()) await page.getByTestId('host-open').click();
    await expect(page.getByTestId('invite-code')).toHaveText(invite);
    await expect(player.getByText('The session has ended')).toHaveCount(0);

    // 8. The player closes the tab, reopens the link, and "Continue as" returns the token.
    await player.close();
    player = await context.newPage();
    await player.goto(`/join/${invite}?e2e=1`);
    await player.getByTestId('join-continue').click();
    await expect(player.locator('[data-page="table"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => tokenAt(player, 'Bram')).not.toBeNull();

    // 9. A short repeat in By hand mode: the Outdoors row is revealed where the party stands.
    await page.getByTestId('enter-table').click();
    await page.keyboard.press('1');
    await page.getByTestId('fog-mode-rooms').click();
    await expect(page.locator('[data-room-id="@outdoors"]')).toBeVisible();
    await expect(page.locator('[data-room-id="room-hall"] [data-testid="fog-party-here"]')).toBeVisible();
    await dragToken(player, 'Bram', CAVE.besideDoor);
    await expect(page.locator('[data-room-id="@outdoors"]')).toHaveAttribute('data-fog-status', 'revealed');
  });
});
