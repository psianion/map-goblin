// How fast cave rock is drawn, timed through the editor's own paths (testing/caveSpeed.ts) on
// the repo's maps: Testing and Goblin Warren, each with its Cave Ink and with a measured kit
// seeded in its place. Medians of 20, ms: a first draw with every piece laid afresh, a first
// draw in a fresh page, a real open (no art, then fifteen batches landing) and its longest
// frame, a rebuild with nothing changed, one piece's art landing late, and a Material brush
// stroke and erase on a brush cave.
//
//   pnpm --filter @dnd/core bench:caves        (CAVE_SPEED_RUNS, CAVE_SPEED_OUT to change)
//
// Never part of `pnpm -r check`: the counts that guard it there are caveWork.test.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (orig) => (await import('../testing/caveSpeed')).mockTextureLoader(await orig<object>()));

import { artState, freshMods, MEASURED_SET, openMap, openWithLateArt, seedInk, seedMeasured, speedTable, timeMap, useFrames, withCaveKit, type SpeedMap } from '../testing/caveSpeed';

const repoMap = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata', file), 'utf8'));

const MAPS: SpeedMap[] = [
  { name: 'Testing, Cave Ink', file: () => repoMap('testing-cave.ggvtt'), seed: seedInk, material: 'GG_Cave_Ink' },
  { name: 'Goblin Warren, Cave Ink', file: () => repoMap('goblin-warren.mapbuilder'), seed: seedInk, material: 'GG_Cave_Ink' },
  { name: 'Testing, measured', file: () => withCaveKit(repoMap('testing-cave.ggvtt'), MEASURED_SET), seed: seedMeasured, material: MEASURED_SET },
  { name: 'Goblin Warren, measured', file: () => withCaveKit(repoMap('goblin-warren.mapbuilder'), MEASURED_SET), seed: seedMeasured, material: MEASURED_SET },
];

it('cave speed', async () => {
  const runs = Number(process.env.CAVE_SPEED_RUNS ?? 20);
  const rows = [];
  for (const map of MAPS) rows.push(await timeMap(map, runs));
  const table = speedTable(`Cave speed (median of ${runs}, ms)`, rows);
  process.stdout.write(`\n${table}\n`);
  if (process.env.CAVE_SPEED_OUT) writeFileSync(process.env.CAVE_SPEED_OUT, table);
}, 3_600_000);

/** The longest task the first open after a pack update may take, ms. */
const FIRST_OPEN_MOST = 100;

// The first open after a pack update: the map open once, then its packs installed afresh (every
// manifest read again, every texture swapped), and the map opened again with none of the new art
// decoded, the art landing in fifteen batches. Its longest task, the median of five.
it('first open after a pack update', async () => {
  useFrames();
  const lines = ['First open after a pack update (longest task, median of 5, ms)'];
  const over: string[] = [];
  for (const map of MAPS) {
    const worsts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const mods = await freshMods();
      const before = openMap(mods, map);
      before.drawAll();
      before.close();
      artState().withheld.clear();
      mods.seed.resetAssetPackManager();
      const open = openMap(mods, map);
      const r = await openWithLateArt(open, 15);
      open.close();
      artState().withheld.clear();
      if (i > 0) worsts.push(r.worst);
    }
    const worst = worsts.sort((a, b) => a - b)[2];
    lines.push(`${map.name.padEnd(30)} ${worst.toFixed(1).padStart(7)}`);
    if (worst > FIRST_OPEN_MOST) over.push(`${map.name}: ${worst.toFixed(1)} ms`);
  }
  const table = lines.join('\n');
  process.stdout.write(`\n${table}\n`);
  if (process.env.CAVE_SPEED_OUT) writeFileSync(process.env.CAVE_SPEED_OUT.replace(/(\.\w+)?$/, '-first-open$1'), table);
  expect(over, `a task over ${FIRST_OPEN_MOST} ms on the first open after a pack update`).toEqual([]);
}, 3_600_000);
