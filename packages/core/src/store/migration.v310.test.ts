// 3.9 → 3.10: additive. A Material brush patch may carry `wall`: such a patch is a painted cave,
// and it loads as the floors the brush now paints (shared/caveFloor.ts). A 3.9 map loads as it
// was, and 3.10 stays the version saved.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { DungeonLayer, SerializedMapData, ShapeChild } from './types';
import type { MaterialPatch } from '../shared/materialPatch';
import { computeMergedFloor } from '../engine/mergedFloor';
import { resolveWalls } from '../shared/wallResolve';
import { setClipperModule } from '../geometry/Clipper2Engine';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;

const patch = (extra: Partial<MaterialPatch> & { wall?: boolean } = {}): MaterialPatch => ({
  id: 'p1', material: 'GG_Cave_Ink', rings: [[[0, 0], [6, 0], [6, 4], [0, 4]]], smooth: false, border: true, ...extra,
});

/** The default map with `materials` on its dungeon layer, as a saved file. */
function saved(materials: MaterialPatch[]): SerializedMapData {
  useStore.setState((s) => {
    (s.layers.find((x) => x.type === 'dungeon') as DungeonLayer).materials = materials;
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

const kit = { isBandSet: () => false, isCaveBandAsset: () => false, fillOf: (m: string) => (m === 'GG_Cave_Ink' ? 'p:cave_floor' : undefined) };

describe('map format 3.10', () => {
  it('is the version saved, and 3.9 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.10');
    expect(SUPPORTED_VERSIONS).toContain('3.9');
    expect(useStore.getState().getSerializableState().version).toBe('3.10');
  });

  it('loads a 3.9 map with its patches as they were', () => {
    const old = { ...saved([patch()]), version: '3.9' } as SerializedMapData;
    expect(dungeon(migrateToLatest(old, kit)).materials).toEqual([patch()]);
  });

  it('loads a patch whose edge was a wall as a cave floor, pinned to the fill and the band, and drops the patch', () => {
    const data = migrateToLatest(saved([patch({ wall: true }), patch({ id: 'p2', rings: [[[20, 0], [24, 0], [24, 4], [20, 4]]] })]), kit);
    const layer = dungeon(data);
    expect(layer.materials?.map((p) => p.id)).toEqual(['p2']);
    const floors = layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ name: 'Cave 1', textureId: 'p:cave_floor', styleOverrides: { wallTextureSetId: 'GG_Cave_Ink' } });
    expect(floors[0].contours).toHaveLength(1);
    // The union and the walls see the cave: one ring, four edges.
    const merged = computeMergedFloor(layer)!;
    expect(merged).toHaveLength(1);
    expect(resolveWalls({ ...layer, id: 'v310-cave', mergedFloor: merged }).filter((w) => w.kind === 'floor')).toHaveLength(4);
  });

  it('keeps a wall patch as it is while the fill cannot be named (packs not in yet), and with no lookup', () => {
    const data = saved([patch({ wall: true, material: 'GG_Unknown' })]);
    expect(dungeon(migrateToLatest(data, kit)).materials).toHaveLength(1);
    expect(dungeon(migrateToLatest(saved([patch({ wall: true })]))).materials).toHaveLength(1);
  });

  it('pins a wall patch with Border off to no stone', () => {
    const [floor] = dungeon(migrateToLatest(saved([patch({ wall: true, border: false })]), kit)).children.filter((c) => c.childType === 'shape');
    expect((floor as ShapeChild).styleOverrides).toEqual({ wallTextureSetId: '' });
  });
});
