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
import { it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (orig) => (await import('../testing/caveSpeed')).mockTextureLoader(await orig<object>()));

import { MEASURED_SET, seedInk, seedMeasured, speedTable, timeMap, withCaveKit, type SpeedMap } from '../testing/caveSpeed';

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
