// The table's shared e2e scaffolding: the game server comes from `global-setup.ts`, the dev
// client from the config's `webServer`. Specs import `test` and `expect` from here and ask for
// `hostSession` (a DM page at a live table) and `joinAsPlayer(name)` (a second page, seated).
//
// `hostSession` stands the campaign up over the server's own routes rather than clicking
// through the host flow every time: a campaign, the demo map with its first room lit, two PC
// token types (Bram, Yara) placed when the session opens, and the DM's pass stored the way the
// Host page stores it. The host flow itself is driven by `host-join.spec.ts`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../../../packages/core/src/shared/protocol';
import { GAME_SERVER } from './ports';

export { expect };

export const SERVER_URL = process.env.E2E_SERVER_URL ?? GAME_SERVER;
export const ADMIN_PASS = (): string => process.env.E2E_ADMIN_PASS ?? '';

/** The fixture map every spec hosts on unless it brings its own: seven rooms, doors and lights. */
export const DEMO_MAP = join(import.meta.dirname, '../../testdata/goblin-warren.mapbuilder');
export const DEMO_NAME = 'Goblin Warren';
/** A second, small map (West Hall, East Vault), for a scene that must not share the first one's name. */
export const SECOND_MAP = join(import.meta.dirname, '../../testdata/vision-two-rooms.mapbuilder');
export const SECOND_NAME = 'Two Rooms';

async function api<T>(path: string, init: RequestInit, credential?: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${body.error ?? ''}`);
  return body;
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** The first room of a map file, for the starting room. */
function firstRoomId(text: string): string | undefined {
  const doc = JSON.parse(text) as { layers?: { type: string; rooms?: { id: string }[] }[] };
  return doc.layers?.find((l) => l.type === 'dungeon' && (l.rooms?.length ?? 0) > 0)?.rooms?.[0]?.id;
}

/** Send module commands over a DM socket, waiting for the snapshot first. */
async function sendCommands(token: string, commands: { module: string; action: string; payload: unknown }[]): Promise<void> {
  const ws = new WebSocket(`${SERVER_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION })));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string };
      if (msg.type !== 'session-state') return;
      commands.forEach((c, i) => ws.send(JSON.stringify({ type: 'command', ...c, seq: i + 1 })));
      setTimeout(resolve, 500);
    });
  });
  ws.close();
}

export interface HostedTable {
  page: Page;
  campaignId: string;
  campaignName: string;
  sceneId: string;
  token: string;
  inviteCode: string;
}

/** A campaign with the demo map and two PC types, its session open, over the server's routes. */
export async function standUpTable(name = 'Cragmaw Hideout'): Promise<Omit<HostedTable, 'page'>> {
  const campaign = await api<{ campaignId: string; token: string }>('/api/campaigns', postJson({ name }), ADMIN_PASS());
  const text = readFileSync(DEMO_MAP, 'utf8');
  const map = await api<{ sceneId: string }>(
    `/api/campaigns/${campaign.campaignId}/maps`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: text },
    campaign.token,
  );
  const roomId = firstRoomId(text);
  const open = (): Promise<{ sessionId: string; inviteCode: string }> =>
    api('/api/sessions', postJson({ campaignId: campaign.campaignId, sceneId: map.sceneId, ...(roomId ? { startingRoom: { sceneId: map.sceneId, roomId } } : {}) }), campaign.token);
  // The PC types only stand in the room on a session that opens after they exist.
  const first = await open();
  await sendCommands(campaign.token, [
    { module: 'tokens', action: 'library-upsert', payload: { name: 'Bram', kind: 'pc', size: 'medium', disposition: 'friendly', hp: { max: 24 } } },
    { module: 'tokens', action: 'library-upsert', payload: { name: 'Yara', kind: 'pc', size: 'medium', disposition: 'friendly', hp: { max: 18 } } },
  ]);
  await api(`/api/sessions/${first.sessionId}/end`, { method: 'POST' }, campaign.token);
  const session = await open();
  return { campaignId: campaign.campaignId, campaignName: name, sceneId: map.sceneId, token: campaign.token, inviteCode: session.inviteCode };
}

/** Put a DM pass in this page's storage the way the Host page keeps one. */
export async function holdDmPass(page: Page, table: { campaignId: string; campaignName: string; token: string }): Promise<void> {
  await page.addInitScript(
    ({ campaignId, campaignName, token, server }) => {
      localStorage.setItem(`gg.table.dm.${campaignId}`, token);
      localStorage.setItem('gg.table.dm.campaigns', JSON.stringify([{ campaignId, name: campaignName, server }]));
    },
    { campaignId: table.campaignId, campaignName: table.campaignName, token: table.token, server: SERVER_URL },
  );
}

/** The DM walks in through the Host page: pick the campaign, it resumes on Invite, Enter table. */
export async function enterAsDm(page: Page, table: { campaignName: string }): Promise<void> {
  await page.goto('/host?e2e=1');
  await page.getByRole('button', { name: table.campaignName }).click();
  await page.getByTestId('enter-table').click();
  await expect(page.locator('[data-page="table"]')).toBeVisible();
  await expect(page.getByTestId('title-card')).toBeVisible({ timeout: 30_000 });
}

/** `/join/CODE` with a name, to the table. */
export async function joinTable(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}?e2e=1`);
  await expect(page.getByText('Table found')).toBeVisible({ timeout: 30_000 });
  await page.locator('#player-name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.locator('[data-page="table"]')).toBeVisible({ timeout: 30_000 });
}

/** The map the core store loaded, once the engine has it. */
export async function loadedMapName(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as { __STORE__?: { getState(): { mapSettings: { name: string } } } }).__STORE__;
    return store?.getState().mapSettings.name;
  });
}

export async function assertMapLoaded(page: Page, name = DEMO_NAME): Promise<void> {
  await expect(page.locator('[data-testid="game-canvas"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => loadedMapName(page), { timeout: 60_000, intervals: [100] }).toBe(name);
}

interface Fixtures {
  hostSession: HostedTable;
  joinAsPlayer: (name: string) => Promise<Page>;
  /** A second browser context, closed after the test even when it fails, so none leaks into the next. */
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

export const test = base.extend<Fixtures>({
  hostSession: async ({ page }, provide) => {
    const table = await standUpTable(`Table ${Date.now().toString(36)}`);
    await holdDmPass(page, table);
    await enterAsDm(page, table);
    await assertMapLoaded(page);
    await provide({ page, ...table });
  },
  joinAsPlayer: async ({ browser, hostSession }, provide) => {
    const opened: Page[] = [];
    await provide(async (name) => {
      const player = await newPage(browser);
      opened.push(player);
      await joinTable(player, hostSession.inviteCode, name);
      return player;
    });
    for (const p of opened) await p.context().close();
  },
  newContext: async ({ browser }, provide) => {
    const opened: BrowserContext[] = [];
    await provide(async (options) => {
      const context = await browser.newContext(options);
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },
});

/**
 * Where a token on the live scene sits on the map element, by name: its world position through
 * the camera (`__testProbe.camera`), for a click that picks exactly that token.
 */
export async function tokenPoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((wanted) => {
    const w = window as unknown as {
      __sessionStore?: { getState(): { session: { activeSceneId: string | null; modules: Record<string, unknown> } | null } };
      __testProbe?: { camera(): { x: number; y: number; scale: number } | null };
    };
    const session = w.__sessionStore?.getState().session;
    const camera = w.__testProbe?.camera();
    const tokens = (session?.modules.tokens as { byScene?: Record<string, Record<string, { name: string; x: number; y: number }>> } | undefined)
      ?.byScene?.[session?.activeSceneId ?? ''];
    const token = tokens ? Object.values(tokens).find((t) => t.name === wanted) : undefined;
    if (!token || !camera) return null;
    return { x: camera.x + token.x * camera.scale, y: camera.y + token.y * camera.scale };
  }, name);
  expect(point, `token ${name} on the live scene`).not.toBeNull();
  return point!;
}

// ── Table fix pass (section 6.2) ─────────────────────────────────────────────

/** The 3.11 acceptance fixture: a hall with an outside door, a cave mouth, grass, a party start. */
export const OUTDOOR_CAVE = join(import.meta.dirname, '../../testdata/outdoor-cave.ggvtt');
export const OUTDOOR_CAVE_NAME = 'Outdoor Cave';
/** Fixture landmarks, in world cells (see `outdoorCave.fixture.test.ts`; the acceptance walk in `liveTable.test.ts` walks them). */
export const CAVE = {
  partyStart: { x: 15.5, y: 7.5 },
  dirt: { x: 15.5, y: 9.5 },
  rock: { x: 17.5, y: 5.5 },
  besideDoor: { x: 13.5, y: 7.5 },
  door: { x: 12, y: 7.5 },
  inHall: { x: 10.5, y: 7.5 },
} as const;

/** A campaign holding the outdoor-cave map and a Bram PC type, with no session open. */
export async function standUpOutdoorCave(name: string): Promise<{ campaignId: string; campaignName: string; sceneId: string; mapId: string; token: string }> {
  const campaign = await api<{ campaignId: string; token: string }>('/api/campaigns', postJson({ name }), ADMIN_PASS());
  const map = await api<{ sceneId: string; mapId: string }>(
    `/api/campaigns/${campaign.campaignId}/maps`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: readFileSync(OUTDOOR_CAVE, 'utf8') },
    campaign.token,
  );
  // The PC type has to exist before the session the wizard opens; a throwaway session adds it.
  const first = await api<{ sessionId: string }>('/api/sessions', postJson({ campaignId: campaign.campaignId, sceneId: map.sceneId }), campaign.token);
  await sendCommands(campaign.token, [
    { module: 'tokens', action: 'library-upsert', payload: { name: 'Bram', kind: 'pc', size: 'medium', disposition: 'friendly', hp: { max: 24 } } },
  ]);
  await api(`/api/sessions/${first.sessionId}/end`, { method: 'POST' }, campaign.token);
  return { campaignId: campaign.campaignId, campaignName: name, sceneId: map.sceneId, mapId: map.mapId, token: campaign.token };
}

/** `POST /api/campaigns/:id/handoff`, naming a scene: the canvas's "Open the table". */
export async function mintHandoff(table: { campaignId: string; token: string }, sceneId?: string): Promise<string> {
  const minted = await api<{ code: string }>(`/api/campaigns/${table.campaignId}/handoff`, postJson(sceneId ? { sceneId } : {}), table.token);
  return minted.code;
}

/** `PUT /api/scenes/:id/publish` with the fixture again: the canvas's republish. */
export async function republish(table: { token: string }, sceneId: string, file = OUTDOOR_CAVE): Promise<void> {
  await api(`/api/scenes/${sceneId}/publish`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: readFileSync(file, 'utf8') }, table.token);
}

/** Send module commands as the DM over a socket (the session must be open). */
export const dmCommands = sendCommands;

/** Where a world point sits on the map element, through the camera (`__testProbe.camera`). */
export async function worldPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const camera = await page.evaluate(() => (window as unknown as { __testProbe?: { camera(): { x: number; y: number; scale: number } | null } }).__testProbe?.camera() ?? null);
  expect(camera, 'camera probe').not.toBeNull();
  return { x: camera!.x + x * camera!.scale, y: camera!.y + y * camera!.scale };
}

/** Drag a token by name to a world point, in steps, the way a hand does. */
export async function dragToken(page: Page, name: string, to: { x: number; y: number }): Promise<void> {
  const canvas = page.getByTestId('game-canvas');
  const box = (await canvas.boundingBox())!;
  const from = await tokenPoint(page, name);
  const at = await worldPoint(page, to.x, to.y);
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 10 });
  await page.mouse.up();
}

/** A token's world position on the live scene, by name. */
export async function tokenAt(page: Page, name: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((wanted) => {
    const w = window as unknown as { __sessionStore?: { getState(): { session: { activeSceneId: string | null; modules: Record<string, unknown> } | null } } };
    const session = w.__sessionStore?.getState().session;
    const tokens = (session?.modules.tokens as { byScene?: Record<string, Record<string, { name: string; x: number; y: number }>> } | undefined)?.byScene?.[session?.activeSceneId ?? ''];
    const token = tokens ? Object.values(tokens).find((t) => t.name === wanted) : undefined;
    return token ? { x: token.x, y: token.y } : null;
  }, name);
}

/** A campaign holding one testdata map with its session open, the DM's pass held by `page`. */
export async function hostMap(page: Page, file: string, mapName: string): Promise<HostedTable> {
  const name = `${mapName} ${Date.now().toString(36)}`;
  const campaign = await api<{ campaignId: string; token: string }>('/api/campaigns', postJson({ name }), ADMIN_PASS());
  const map = await api<{ sceneId: string }>(
    `/api/campaigns/${campaign.campaignId}/maps`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: readFileSync(file, 'utf8') },
    campaign.token,
  );
  const session = await api<{ inviteCode: string }>('/api/sessions', postJson({ campaignId: campaign.campaignId, sceneId: map.sceneId }), campaign.token);
  const table = { campaignId: campaign.campaignId, campaignName: name, sceneId: map.sceneId, token: campaign.token, inviteCode: session.inviteCode };
  await holdDmPass(page, table);
  await enterAsDm(page, table);
  await assertMapLoaded(page, mapName);
  return { page, ...table };
}
