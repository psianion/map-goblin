// 3.9 → 3.10: additive. A Material brush patch may carry `wall`, its edge blocking light and
// sight and taking doors. A 3.9 map loads as it was (no patch is a wall), and a 3.10 map
// round-trips through migrateToLatest, the parser the table loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { DungeonLayer, SerializedMapData } from './types';
import type { MaterialPatch } from '../shared/materialPatch';

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;

const patch = (extra: Partial<MaterialPatch> = {}): MaterialPatch => ({
  id: 'p1', material: 'GG_Cave_Ink', rings: [[[0, 0], [6, 0], [6, 4], [0, 4]]], smooth: false, border: true, ...extra,
});

/** The default map with `materials` on its dungeon layer, as a saved file. */
function saved(materials: MaterialPatch[]): SerializedMapData {
  useStore.setState((s) => {
    (s.layers.find((x) => x.type === 'dungeon') as DungeonLayer).materials = materials;
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

describe('map format 3.10', () => {
  it('is the version saved, and 3.9 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.10');
    expect(SUPPORTED_VERSIONS).toContain('3.9');
    expect(useStore.getState().getSerializableState().version).toBe('3.10');
  });

  it('loads a 3.9 map with its patches as they were, none a wall', () => {
    const old = { ...saved([patch()]), version: '3.9' } as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(old));
    const [p] = dungeon(useStore.getState().getSerializableState()).materials!;
    expect(p).toEqual(patch());
    expect(p.wall).toBeUndefined();
  });

  it('round-trips a patch whose edge is a wall', () => {
    const data = saved([patch({ wall: true })]);
    expect(data.version).toBe('3.10');
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    expect(dungeon(useStore.getState().getSerializableState()).materials).toEqual([patch({ wall: true })]);
  });
});
