// What drawing cave rock costs, counted rather than timed so it never flakes: a rebuild with
// nothing changed works out no mesh, art landing late lays nothing again, a map opening while
// its art lands in fifteen batches is laid once and drawn at most twice, and a brush stroke on
// one of three caves lays that cave alone. One coarse time ceiling besides, which only a real
// regression breaks. The maps are the repo's own, drawn with a measured kit seeded here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (orig) => (await import('../testing/caveSpeed')).mockTextureLoader(await orig<object>()));

import {
  artState,
  drawnArtIds,
  frame,
  freshMods,
  land,
  MEASURED_SET,
  openMap,
  openWithLateArt,
  rockArt,
  seedMeasured,
  useFrames,
  withCaveKit,
  type SpeedMap,
  type SpeedMods,
} from '../testing/caveSpeed';
import type { DungeonLayer } from '../store/types';
import type { Polygon } from '../types/geometry';

const repoMap = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata', file), 'utf8'));
const TESTING: SpeedMap = { name: 'Testing', file: () => withCaveKit(repoMap('testing-cave.ggvtt'), MEASURED_SET), seed: seedMeasured, material: MEASURED_SET };
const WARREN: SpeedMap = { name: 'Goblin Warren', file: () => withCaveKit(repoMap('goblin-warren.mapbuilder'), MEASURED_SET), seed: seedMeasured, material: MEASURED_SET };

const work = (mods: SpeedMods) => ({ ...mods.band.bandWork });

describe('the work a cave rebuild does', () => {
  it('works out no mesh and lays nothing on a rebuild with nothing changed', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    open.drawAll();
    const before = work(mods);
    expect(before.meshes).toBeGreaterThan(0);
    open.drawAll();
    expect(work(mods)).toEqual(before);
    open.close();
  }, 60_000);

  it('lays nothing again when a piece’s art lands late: the piece takes it in place', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    open.drawAll();
    // A piece of the measured kit (a stone wall's art is drawn again: it is no band piece).
    const id = rockArt(drawnArtIds(open)).find((a) => a.startsWith('speed-pack:'));
    expect(id).toBeDefined();
    artState().withheld.add(id!);
    open.drawAll();
    const before = { ...work(mods), draws: open.draws() };
    land(mods, [id!]);
    for (let f = 0; f < 4; f++) open.frame();
    expect({ ...work(mods), draws: open.draws() }).toEqual(before);
    open.close();
  }, 60_000);

  it('lays a map once and draws it at most twice while its art lands in fifteen batches', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    let laidFirst = -1;
    const r = await openWithLateArt(open, 15, () => (laidFirst = mods.band.bandWork.layings));
    expect(r.frames).toBeGreaterThan(1);
    // The first draw laid it; nothing after laid anything again.
    expect(laidFirst).toBeGreaterThan(0);
    expect(mods.band.bandWork.layings).toBe(laidFirst);
    expect(open.draws()).toBeLessThanOrEqual(2 * open.ids.length);
    artState().withheld.clear();
    open.close();
  }, 60_000);

  it('lays the one cave a brush stroke touches, not the others on the layer', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    open.drawAll();
    const { useStore } = mods.store;
    const id = open.ids[0];
    const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.id === id)!;
    const circle = (c: [number, number], r: number): Polygon => Array.from({ length: 48 }, (_, k): [number, number] => [c[0] + r * Math.cos((2 * Math.PI * k) / 48), c[1] + r * Math.sin((2 * Math.PI * k) / 48)]);
    const settings = { ...useStore.getState().tools.settings.material, material: MEASURED_SET };
    for (const c of [[-60, -60], [-60, -40], [-40, -60]] as [number, number][]) mods.tool.paintCaveFloor(layer(), id, [circle(c, 3.6)], settings);
    const redraw = (): void => {
      useStore.setState((s) => {
        const l = s.layers.find((x) => x.id === id) as DungeonLayer;
        l.mergedFloor = mods.merged.computeMergedFloor(l as DungeonLayer);
      });
      open.drawAll();
    };
    redraw();
    const before = mods.band.bandWork.layings;
    mods.tool.paintCaveFloor(layer(), id, mods.patch.strokeArea([[-56.4, -60]], 1), settings);
    redraw();
    expect(mods.band.bandWork.layings - before).toBe(1);
    open.close();
  }, 60_000);

  // A ceiling at today's speed so nothing gets slower; lower it as laying afresh gets faster.
  it('lays the Goblin Warren afresh in under 350 ms', async () => {
    useFrames();
    const mods = await freshMods();
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      // Its packs read afresh: every ring, run, cliff, fit, rock line and mesh laid anew.
      const open = openMap(mods, WARREN);
      const t0 = performance.now();
      open.drawAll();
      times.push(performance.now() - t0);
      open.close();
    }
    expect(Math.min(...times.slice(1))).toBeLessThan(350);
    frame();
  }, 60_000);
});
