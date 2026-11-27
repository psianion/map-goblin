// What drawing floors under rooms costs: a full floor rebuild of the owner's seven-room cave and
// of Goblin Warren, in Blend and in Sharp, as a first draw (cold), the same draw again (warm) and
// one floor's texture changed then drawn; and how many floor rebuilds one map open runs. Medians
// of 20, ms. The seven-room cave is drawn as built and with its first floor changed, the state
// the room fills are for.
//
//   pnpm --filter @dnd/core exec vitest run --mode bench src/engine/roomLooks.bench.ts
//
// Never part of `pnpm -r check`: the count that guards it there is roomFillRenderer.test.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (orig) => (await import('../testing/caveSpeed')).mockTextureLoader(await orig<object>()));

import { Container } from 'pixi.js';
import { artState, freshMods, frame, openMap, seedInk, useFrames, type SpeedMap, type SpeedMods } from '../testing/caveSpeed';
import { SEVEN_IDS, sevenRoomLayer } from '../testing/sevenRooms';
import type { DungeonLayer, ShapeChild } from '../store/types';

const repoMap = (file: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata', file), 'utf8'));

function seedSeven(mods: SpeedMods): void {
  seedInk(mods);
  const floor = (material: string) => ({ type: 'floor', material, gridSize: '1x1', tags: [] }) as never;
  mods.seed.seedPack('pack', { floor_cave: floor('floor_cave'), floor_stone: floor('floor_stone') });
  // The floors' art decoded, as after a load.
  const cache = (mods.packs.getAssetPackManager() as unknown as { textureCache: Map<string, unknown> }).textureCache;
  for (const id of [SEVEN_IDS.floor, SEVEN_IDS.other]) cache.set(id, artState().loaded);
  mods.seed.seedCaveBandPack('cave-kit', { set: SEVEN_IDS.cave, tags: ['cave'] });
  mods.seed.seedCaveBandPack('band-kit', { set: SEVEN_IDS.band, tags: ['cave'] });
  mods.seed.seedTestWallSets([SEVEN_IDS.stone], 'stone-kit');
}

function sevenFile(blend: boolean, changed: boolean): unknown {
  const warren = repoMap('goblin-warren.mapbuilder');
  const layers = warren.layers as unknown[];
  const layer = sevenRoomLayer({ blend, textures: changed ? [SEVEN_IDS.other] : [] });
  return { ...warren, mapSettings: { ...(warren.mapSettings as object), name: 'Seven rooms' }, layers: [layers[0], layer] };
}

function warrenFile(blend: boolean): unknown {
  const warren = repoMap('goblin-warren.mapbuilder');
  const layers = (warren.layers as DungeonLayer[]).map((l) => (l.type === 'dungeon' ? { ...l, style: { ...l.style, showEdgeTransitions: blend } } : l));
  return { ...warren, layers };
}

const MAPS: SpeedMap[] = [
  { name: 'Seven rooms, Blend', file: () => sevenFile(true, false), seed: seedSeven, material: 'GG_Cave_Ink' },
  { name: 'Seven rooms, Sharp', file: () => sevenFile(false, false), seed: seedSeven, material: 'GG_Cave_Ink' },
  { name: 'Seven, floor 1 changed, Blend', file: () => sevenFile(true, true), seed: seedSeven, material: 'GG_Cave_Ink' },
  { name: 'Seven, floor 1 changed, Sharp', file: () => sevenFile(false, true), seed: seedSeven, material: 'GG_Cave_Ink' },
  { name: 'Goblin Warren, Blend', file: () => warrenFile(true), seed: seedInk, material: 'GG_Cave_Ink' },
  { name: 'Goblin Warren, Sharp', file: () => warrenFile(false), seed: seedInk, material: 'GG_Cave_Ink' },
];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor(s.length / 2)];
};

/** The rooms given their faces, as the editor's room refresh does after a load. */
async function syncRooms(): Promise<void> {
  (await import('../store/roomRefresh')).refreshRooms();
}

/** The first walled floor's texture swapped for the other one. */
function editFloor(mods: SpeedMods, k: number): void {
  mods.store.useStore.setState((s) => {
    const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer | undefined;
    const f = l?.children.find((c): c is ShapeChild => c.childType === 'shape' && !c.ground);
    if (f) f.textureId = k % 2 === 0 ? SEVEN_IDS.other : SEVEN_IDS.floor;
  });
}

async function timeOne(map: SpeedMap, runs: number): Promise<string> {
  useFrames();
  artState().withheld.clear();
  const t = (): number => performance.now();
  const mods = await freshMods();
  const cold: number[] = [];
  for (let i = 0; i < runs + 3; i++) {
    const open = openMap(mods, map);
    await syncRooms();
    const t0 = t();
    open.drawAll();
    const dt = t() - t0;
    open.close();
    if (i >= 3) cold.push(dt);
  }
  const open = openMap(mods, map);
  await syncRooms();
  // Fills built by one draw (a count the code before them did not keep reads as "-").
  const built = ((await import('./roomFillRenderer')) as { roomFillsBuilt?: () => number }).roomFillsBuilt;
  const fills0 = built?.() ?? 0;
  open.drawAll();
  const fills = built ? String(built() - fills0) : '-';
  const warm: number[] = [];
  for (let i = 0; i < runs + 3; i++) {
    const t0 = t();
    open.drawAll();
    if (i >= 3) warm.push(t() - t0);
  }
  const edit: number[] = [];
  for (let i = 0; i < runs + 3; i++) {
    editFloor(mods, i);
    const t0 = t();
    open.drawAll();
    if (i >= 3) edit.push(t() - t0);
  }
  open.close();
  const opens = await rebuildsPerOpen(map);
  return `${map.name.padEnd(32)} ${median(cold).toFixed(2).padStart(8)} ${median(warm).toFixed(2).padStart(8)} ${median(edit).toFixed(2).padStart(8)} ${String(opens).padStart(9)} ${fills.padStart(6)}`;
}

/** Floor rebuilds one open of `map` runs, through the editor's own store watch. */
async function rebuildsPerOpen(map: SpeedMap): Promise<number> {
  const mods = await freshMods();
  const { subscribeToStore, flushLayerDraws } = await import('./subscribeToStore');
  const { LightManager } = await import('./lighting/LightManager');
  const { useStore } = mods.store;
  useStore.getState().resetToDefault();
  map.seed(mods);
  // The terrain and grid renderers answer every call with nothing: no floor rebuild goes through them.
  const idle = new Proxy({}, { get: () => () => undefined });
  const sceneGraph = { layerContainer: new Container(), backgroundLayer: new Container(), terrainRenderer: idle, gridRenderer: idle } as never;
  const engine = { invalidate: () => {}, renderer: () => null } as never;
  const stop = subscribeToStore(engine, sceneGraph, new LightManager());
  flushLayerDraws();
  // A floor rebuild starts by clearing its floor sublayer's mask, and nothing else does: counted there.
  let n = 0;
  const trapped = new WeakSet<object>();
  const trap = (): void => {
    for (const l of useStore.getState().layers) {
      const floor = l.type === 'dungeon' ? mods.scene.getLayerEntry(l.id)?.sublayers?.floor : undefined;
      if (!floor || trapped.has(floor)) continue;
      trapped.add(floor);
      let mask = floor.mask;
      Object.defineProperty(floor, 'mask', {
        configurable: true,
        get: () => mask,
        set: (v) => {
          if (v === null) n++;
          mask = v;
        },
      });
    }
  };
  useStore.getState().loadFromFile(structuredClone(map.file()) as never);
  // The open settles: frames, the room refresh's debounce, and the frames after it.
  const settle = async (): Promise<void> => {
    for (let k = 0; k < 4; k++) {
      trap();
      frame();
      flushLayerDraws();
      for (let m = 0; m < 8; m++) await Promise.resolve();
    }
  };
  await settle();
  await new Promise((r) => setTimeout(r, 400));
  await settle();
  stop();
  return n;
}

it('room looks speed', async () => {
  const runs = Number(process.env.ROOM_SPEED_RUNS ?? 20);
  const lines = [`Room looks speed (median of ${runs}, ms)`, `${'map'.padEnd(32)} ${'cold'.padStart(8)} ${'warm'.padStart(8)} ${'edit'.padStart(8)} ${'rebuilds'.padStart(9)} ${'fills'.padStart(6)}`];
  for (const map of MAPS) lines.push(await timeOne(map, runs));
  process.stdout.write(`\n${lines.join('\n')}\n`);
}, 3_600_000);
