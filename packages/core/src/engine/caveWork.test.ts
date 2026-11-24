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

/** A cliff plateau of the measured kit, clear of everything on the map, added to its first layer. */
const addPlateau = (mods: SpeedMods, id: string): void =>
  mods.store.useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === id) as DungeonLayer;
    l.children.push({ id: 'work-plateau', name: 'p', childType: 'plateau', visible: true, contours: [[[-80, -62], [-72, -62], [-72, -57], [-76, -57], [-76, -54], [-80, -54]]], height: 1, edge: 'cliff', edgeArt: MEASURED_SET } as never);
  });

const work = (mods: SpeedMods) => ({ ...mods.band.bandWork, slopes: mods.plateaus.slopeWork.faces, walls: mods.walls.wallWork.layouts });

describe('the work a cave rebuild does', () => {
  it('works out no mesh and lays nothing on a rebuild with nothing changed: no ring, cliff, slope face or wall', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    addPlateau(mods, open.ids[0]);
    open.drawAll();
    // Drawn twice: the first draw stores the rock lines the second is drawn along.
    open.drawAll();
    const before = work(mods);
    expect(before.meshes).toBeGreaterThan(0);
    expect(before.cliffs).toBeGreaterThan(0);
    expect(before.slopes).toBeGreaterThan(0);
    expect(before.walls).toBeGreaterThan(0);
    open.drawAll();
    expect(work(mods)).toEqual(before);
    open.close();
  }, 60_000);

  it('works nothing out again for step pieces, dead ends and painted endings on a rebuild with nothing changed', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    const id = open.ids[0];
    // A plateau with a jog, a slope off its long side (two free cliff ends) and a cave room with a rock spur and a passage.
    const spur: [number, number][] = [[-120, -62], [-115, -62], [-115, -57], [-114, -57], [-114, -62], [-108, -62], [-108, -54], [-111, -54], [-111, -48], [-113, -48], [-113, -54], [-120, -54]];
    mods.store.useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === id) as DungeonLayer;
      l.children.push(
        { id: 'work-jog', name: 'j', childType: 'plateau', visible: true, contours: [[[-100, -62], [-92, -62], [-92, -61], [-84, -61], [-84, -52], [-100, -52]]], height: 1, edge: 'cliff', edgeArt: MEASURED_SET } as never,
        { id: 'work-ramp', name: 'r', childType: 'plateau', visible: true, contours: [[[-96, -52], [-92, -52], [-92, -49], [-96, -49]]], height: 1, edge: 'slope', faceDir: 90 } as never,
        { id: 'work-spur', name: 's', childType: 'shape', visible: true, shapeType: 'polygon', contours: [spur], styleOverrides: { wallTextureSetId: MEASURED_SET } } as never,
      );
      l.mergedFloor = mods.merged.computeMergedFloor(l as DungeonLayer);
    });
    open.drawAll();
    open.drawAll();
    const before = work(mods);
    open.drawAll();
    expect(work(mods)).toEqual(before);
    // They were laid: each in its place.
    const { bandPiecesFor } = await import('../assets/caveWallKit');
    const pool = bandPiecesFor(MEASURED_SET);
    const room = mods.band.layBandRing(mods.band.orientRings([spur as Polygon])[0], [], pool, 1);
    expect(room.filter((p) => p.branch === 'dead-end').map((p) => p.piece.key).sort()).toEqual(['cap_4x1', 'spur_3x1']);
    const jog = mods.band.layBandRing(mods.band.orientRings([[[-100, -62], [-92, -62], [-92, -61], [-84, -61], [-84, -52], [-100, -52]] as Polygon])[0], [], pool, 1, true);
    expect(jog.some((p) => p.branch === 'step')).toBe(true);
    const free = mods.band.layBandChain([[0, 0], [10, 0]], [], pool, 1, true);
    expect([free[0].branch, free[free.length - 1].branch]).toEqual(['ending', 'ending']);
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

  it('walks no plateau’s cliff again for a brush stroke that leaves its outline as it was', async () => {
    useFrames();
    const mods = await freshMods();
    const open = openMap(mods, TESTING);
    const { useStore } = mods.store;
    const id = open.ids[0];
    const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.id === id)!;
    addPlateau(mods, id);
    const settings = { ...useStore.getState().tools.settings.material, material: MEASURED_SET };
    const redraw = (): void => {
      useStore.setState((s) => {
        const l = s.layers.find((x) => x.id === id) as DungeonLayer;
        l.mergedFloor = mods.merged.computeMergedFloor(l as DungeonLayer);
      });
      open.drawAll();
    };
    const circle = (c: [number, number], r: number): Polygon => Array.from({ length: 48 }, (_, k): [number, number] => [c[0] + r * Math.cos((2 * Math.PI * k) / 48), c[1] + r * Math.sin((2 * Math.PI * k) / 48)]);
    mods.tool.paintCaveFloor(layer(), id, [circle([-60, -60], 3.6)], settings);
    redraw();
    redraw();
    const before = work(mods);
    expect(before.cliffs).toBeGreaterThan(0);
    mods.tool.paintCaveFloor(layer(), id, mods.patch.strokeArea([[-56.4, -60]], 1), settings);
    redraw();
    const after = work(mods);
    // The brush cave is laid again; no cliff is.
    expect(after.layings - before.layings).toBe(1);
    expect(after.cliffs).toBe(before.cliffs);
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
