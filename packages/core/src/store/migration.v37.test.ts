// 3.6 → 3.7: additive. A layer's water, material patches and paths. A 3.6 map loads as it
// was, the fields it lacks taking their defaults (dry, no patches, no paths), and a 3.7 map round-trips through
// migrateToLatest, the parser the table loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { DungeonLayer, PathwayChild, SerializedMapData } from './types';
import { emptyWaterGrid, encodeWater, paintWaterDisc } from '../shared/waterMask';
import type { MaterialPatch } from '../shared/materialPatch';

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;

/** The default map with `patch` applied to its dungeon layer, as a saved file. */
function saved(patch: (l: DungeonLayer) => void): SerializedMapData {
  useStore.setState((s) => {
    patch(s.layers.find((x) => x.type === 'dungeon') as DungeonLayer);
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

const patch: MaterialPatch = { id: 'p1', material: 'GG_Cave_Ink', rings: [[[0, 0], [4, 0], [4, 3], [0, 3]]], smooth: true, border: false };
const path: PathwayChild = {
  id: 'r1', name: 'Path', childType: 'pathway', visible: true, contours: [[[0, 0], [6, 0], [6, 4]]],
  pieceId: 'gg-forge:GG_Fieldstone_Straight_Path_8x1_wall_A', width: 1.5, smoothness: 0.4, curve: true,
  transitionIn: 'grow', transitionOut: 'fade', blocksLight: true,
};
const pool = encodeWater(paintWaterDisc(emptyWaterGrid(), 4, 4, 2, false), { shallow: '#9db7bd', deep: '#112233', blend: 1.5, border: true })!;

describe('map format 3.7', () => {
  it('is still read, as 3.6 is', () => {
    expect(CURRENT_VERSION).toBe('3.11');
    expect(SUPPORTED_VERSIONS).toContain('3.6');
    expect(SUPPORTED_VERSIONS).toContain('3.7');
  });

  it('loads a 3.6 map dry and bare', () => {
    const old = { ...saved(() => {}), version: '3.6' } as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(old));
    const l = dungeon(useStore.getState().getSerializableState());
    expect(l.water).toBeUndefined();
    expect(l.materials).toBeUndefined();
    expect(l.children.some((c) => c.childType === 'pathway')).toBe(false);
  });

  it('loads a layer of water, a material patch and a path: the path as it was, the water and the patch kept until they can become pieces', () => {
    const data = saved((l) => {
      l.water = structuredClone(pool);
      l.materials = [structuredClone(patch)];
      l.children.push(structuredClone(path));
    });
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    const l = dungeon(useStore.getState().getSerializableState());
    // The mask waits for Clipper and the pack's water texture (engine/legacyPaint.ts), and a
    // band set's patch for the catalog to name its fill: neither is lost meanwhile.
    expect(l.water).toEqual(pool);
    expect(l.materials).toEqual([patch]);
    // A path is not the retired Path tool's 'path' child, which a load drops.
    expect(l.children.find((c) => c.id === 'r1')).toEqual(path);
  });
});
