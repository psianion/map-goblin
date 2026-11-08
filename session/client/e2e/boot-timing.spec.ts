// @boot: what a cold player join costs, in seconds and bytes (asset loading plan, section 7).
// Unrun until step T. BOOT_BASELINE=1 is the run against `main`: the same timings, none of
// the branch's rules (main installs every pack before the first frame).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Response } from '@playwright/test';
import { DEMO_MAP, DEMO_NAME, expect, joinTable, loadedMapName, test } from './fixtures';

const baseline = !!process.env.BOOT_BASELINE;
const PACKS = join(import.meta.dirname, '../../../canvas/public/packs');

interface Entry {
  material?: string;
  gridSize?: string;
  variant?: string;
  atlas?: string;
  set?: string;
}
interface Manifest {
  entries: Record<string, Entry>;
  atlases: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** Each bundled pack's manifest, off the same files the dev server hands out. */
function manifests(): Map<string, Manifest> {
  const index = JSON.parse(readFileSync(join(PACKS, 'index.json'), 'utf8')) as { packs: Record<string, { manifest: string }> };
  return new Map(
    Object.entries(index.packs).map(([packId, p]) => [packId, JSON.parse(readFileSync(join(PACKS, p.manifest), 'utf8')) as Manifest]),
  );
}

/** Which set a pack file belongs to: its atlas entries, or the loose entries its name starts with. */
function setOfFile(m: Manifest, file: string): string | undefined {
  const stem = file.replace(/\.(webp|json)$/, '');
  for (const e of Object.values(m.entries)) {
    if (e.atlas && e.atlas.replace(/\.[a-z0-9]+$/i, '') === stem) return e.set;
    if (!e.atlas && file.startsWith(`${e.material}_${e.gridSize}_${e.variant}-`)) return e.set;
  }
  return undefined;
}

/**
 * Every set the map document names, generously: any string in it that is an entry id (bare
 * or `pack:id`), an entry's material, or a set name. A superset of what the renderer asks
 * for, so a file outside it is one the join had no reason to fetch.
 */
function setsTheMapNames(doc: unknown, packs: Map<string, Manifest>): Set<string> {
  const strings = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(doc);
  const out = new Set<string>();
  for (const [packId, m] of packs) {
    for (const [id, e] of Object.entries(m.entries)) {
      if (!e.set) continue;
      if (strings.has(id) || strings.has(`${packId}:${id}`) || (e.material && strings.has(e.material)) || strings.has(e.set)) {
        out.add(`${packId}/${e.set}`);
      }
    }
  }
  return out;
}

interface Fetched {
  url: string;
  bytes: number;
}

function recordFetches(page: Page): Fetched[] {
  const all: Fetched[] = [];
  page.on('response', (res: Response) => {
    res
      .request()
      .sizes()
      .then((s) => all.push({ url: res.url(), bytes: s.responseBodySize }))
      .catch(() => all.push({ url: res.url(), bytes: 0 }));
  });
  return all;
}

/** The player's table is drawn: the canvas, no loading screen, the warren in the core store. */
async function firstFrame(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="game-canvas"] canvas')).toBeVisible({ timeout: 60_000 });
  if (!baseline) await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(() => loadedMapName(page), { timeout: 120_000, intervals: [100] }).toBe(DEMO_NAME);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test.describe('@boot table boot timing', () => {
  test('a cold player join fetches only the sets the map uses, and only the DM has the library', async ({ hostSession, browser }) => {
    const context = await browser.newContext();
    const player = await context.newPage();
    const net = recordFetches(player);
    const metrics: Record<string, number> = {};

    const t = Date.now();
    await joinTable(player, hostSession.inviteCode, 'Pia');
    await firstFrame(player);
    metrics.coldJoinMs = Date.now() - t;
    await player.waitForTimeout(250);
    metrics.coldJoinBytes = net.reduce((n, f) => n + f.bytes, 0);
    const packFiles = net.filter((f) => /\/packs\/[^/]+\/[^?]+\.(webp|json)(\?|$)/.test(f.url) && !/\/pack-[0-9a-f]{8}\.json/.test(f.url));
    metrics.coldJoinPackFiles = packFiles.length;
    metrics.coldJoinPackBytes = packFiles.reduce((n, f) => n + f.bytes, 0);

    for (const [type, value] of Object.entries(metrics)) test.info().annotations.push({ type, description: String(value) });
    console.log(`[boot-timing] table ${baseline ? 'baseline' : 'branch'} ${JSON.stringify(metrics)}`);

    if (!baseline) {
      const packs = manifests();
      const allowed = setsTheMapNames(JSON.parse(readFileSync(DEMO_MAP, 'utf8')), packs);
      const strays = packFiles
        .map((f) => {
          const [, packId, file] = new URL(f.url).pathname.match(/\/packs\/([^/]+)\/(.+)$/) ?? [];
          if (!packId || file === 'index.json' || file.startsWith('preview-')) return null;
          const set = setOfFile(packs.get(packId)!, file);
          return set && allowed.has(`${packId}/${set}`) ? null : `${packId}/${file} (${set ?? 'no set'})`;
        })
        .filter((s): s is string => s !== null);
      expect(strays, 'pack files outside the sets the map uses').toEqual([]);

      // The library is the DM's command; the player's Session menu has no such row.
      await player.getByTestId('session-menu').click();
      await expect(player.getByTestId('session-popover')).toBeVisible();
      await expect(player.getByTestId('library-download')).toHaveCount(0);
      const dm = hostSession.page;
      await dm.getByTestId('session-menu').click();
      await expect(dm.getByTestId('library-download')).toBeVisible();
      await expect(dm.getByTestId('library-download')).toContainText('Download the full library');
    }
    await context.close();
  });
});
