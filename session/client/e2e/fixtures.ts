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
import { expect, test as base, type Browser, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../../../packages/core/src/shared/protocol';
import { GAME_SERVER } from './ports';

export { expect };

export const SERVER_URL = process.env.E2E_SERVER_URL ?? GAME_SERVER;
export const ADMIN_PASS = (): string => process.env.E2E_ADMIN_PASS ?? '';

/** The fixture map every spec hosts on unless it brings its own. */
export const DEMO_MAP = join(import.meta.dirname, '../../testdata/demo-dungeon.mapbuilder');
export const DEMO_NAME = 'Demo Dungeon';

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
    { module: 'tokens', action: 'library-upsert', payload: { name: 'Bram', kind: 'pc', size: 'medium', disposition: 'friendly' } },
    { module: 'tokens', action: 'library-upsert', payload: { name: 'Yara', kind: 'pc', size: 'medium', disposition: 'friendly' } },
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
});
