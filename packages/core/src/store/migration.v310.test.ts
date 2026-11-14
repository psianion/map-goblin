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
  it('is still read, as 3.9 is', () => {
    expect(CURRENT_VERSION).toBe('3.11');
    expect(SUPPORTED_VERSIONS).toContain('3.9');
    expect(SUPPORTED_VERSIONS).toContain('3.10');
  });

  it('loads a 3.9 map with its paint-only patch as a ground piece with its rock rim (3.11), and as it was while its fill cannot be named', () => {
    const old = { ...saved([patch()]), version: '3.9' } as SerializedMapData;
    const layer = dungeon(migrateToLatest(old, kit));
    expect(layer.materials).toBeUndefined();
    expect(layer.children.find((c) => c.id === 'p1')).toMatchObject({ childType: 'shape', ground: true, textureId: 'p:cave_floor', edgeMaterial: 'GG_Cave_Ink' });
    expect(computeMergedFloor(layer)).toBeNull();
    expect(dungeon(migrateToLatest(old)).materials).toEqual([patch()]);
  });

  it('loads a patch whose edge was a wall as a cave floor, pinned to the fill and marked with the band, and drops the patch', () => {
    const data = migrateToLatest(saved([patch({ wall: true }), patch({ id: 'p2', rings: [[[20, 0], [24, 0], [24, 4], [20, 4]]] })]), kit);
    const layer = dungeon(data);
    // The other patch is paint only: a ground piece, in no union and no wall.
    expect(layer.materials).toBeUndefined();
    const floors = layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && !c.ground);
    expect(layer.children.find((c) => c.id === 'p2')).toMatchObject({ ground: true });
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ name: 'Cave 1', textureId: 'p:cave_floor', edgeMaterial: 'GG_Cave_Ink', styleOverrides: { wallTextureSetId: '' } });
    expect(floors[0].contours).toHaveLength(1);
    // The union and the walls see the cave: one ring, and the cave's own wall along it in place of its edges.
    const merged = computeMergedFloor(layer)!;
    expect(merged).toHaveLength(1);
    const walls = resolveWalls({ ...layer, id: 'v310-cave', mergedFloor: merged });
    expect(walls.filter((w) => w.kind === 'floor')).toHaveLength(0);
    expect(walls.filter((w) => w.kind === 'cave')).toHaveLength(1);
  });

  it('keeps a wall patch as it is while the fill cannot be named (packs not in yet), and with no lookup', () => {
    const data = saved([patch({ wall: true, material: 'GG_Unknown' })]);
    expect(dungeon(migrateToLatest(data, kit)).materials).toHaveLength(1);
    expect(dungeon(migrateToLatest(saved([patch({ wall: true })]))).materials).toHaveLength(1);
  });

  it('pins a wall patch with Border off to no stone', () => {
    const [floor] = dungeon(migrateToLatest(saved([patch({ wall: true, border: false })]), kit)).children.filter((c) => c.childType === 'shape');
    expect((floor as ShapeChild).styleOverrides).toEqual({ wallTextureSetId: '' });
    expect(floor).not.toHaveProperty('edgeMaterial');
  });
});
