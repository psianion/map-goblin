// 3.6 → 3.7: additive. A layer's water and material patches. A 3.6 map loads as it was, the
// fields it lacks taking their defaults (dry, no patches), and a 3.7 map round-trips through
// migrateToLatest, the parser the table loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { DungeonLayer, SerializedMapData } from './types';
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
const pool = encodeWater(paintWaterDisc(emptyWaterGrid(), 4, 4, 2, false), { shallow: '#9db7bd', deep: '#112233', blend: 1.5, border: true })!;

describe('map format 3.7', () => {
  it('is the version saved, and 3.6 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.7');
    expect(SUPPORTED_VERSIONS).toContain('3.6');
    expect(useStore.getState().getSerializableState().version).toBe('3.7');
  });

  it('loads a 3.6 map dry and bare', () => {
    const old = { ...saved(() => {}), version: '3.6' } as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(old));
    const l = dungeon(useStore.getState().getSerializableState());
    expect(l.water).toBeUndefined();
    expect(l.materials).toBeUndefined();
  });

  it('round-trips a layer of water and a material patch through save and load', () => {
    const data = saved((l) => {
      l.water = structuredClone(pool);
      l.materials = [structuredClone(patch)];
    });
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    const l = dungeon(useStore.getState().getSerializableState());
    expect(l.water).toEqual(pool);
    expect(l.materials).toEqual([patch]);
  });
});
