// 3.7 → 3.8: additive. A prop's below-water flag and trace layers. A 3.7 map loads as it
// was, its props drawn as they are (the flag absent, off), and a 3.8 map round-trips through
// migrateToLatest, the parser the table loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { AssetChild, DungeonLayer, SerializedMapData } from './types';
import { propField } from '../shared/propFields';
import { createImageLayer } from './factories';

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;

/** The default map with `patch` applied to its dungeon layer, as a saved file. */
function saved(patch: (l: DungeonLayer) => void): SerializedMapData {
  useStore.setState((s) => {
    patch(s.layers.find((x) => x.type === 'dungeon') as DungeonLayer);
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

const barrel = (extra: Partial<AssetChild> = {}): AssetChild => ({
  id: 'b1', name: 'Barrel', childType: 'asset', visible: true, objectType: 'asset', assetId: 'test:barrel',
  position: { x: 4, y: 4 }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
  ...extra,
});

describe('map format 3.8', () => {
  it('is the version saved, and 3.7 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.8');
    expect(SUPPORTED_VERSIONS).toContain('3.7');
    expect(useStore.getState().getSerializableState().version).toBe('3.8');
  });

  it('loads a 3.7 map with its props drawn as they are', () => {
    const old = { ...saved((l) => l.children.push(barrel())), version: '3.7' } as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(old));
    const prop = dungeon(useStore.getState().getSerializableState()).children.find((c) => c.id === 'b1') as AssetChild;
    expect(prop.belowWater).toBeUndefined();
    expect(propField(prop, 'belowWater')).toBe(false);
  });

  it('round-trips a prop below water through save and load', () => {
    const data = saved((l) => l.children.push(barrel({ belowWater: true })));
    expect(data.version).toBe('3.8');
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    const prop = dungeon(useStore.getState().getSerializableState()).children.find((c) => c.id === 'b1');
    expect(prop).toEqual(barrel({ belowWater: true }));
  });

  it('round-trips a trace layer and its picture', () => {
    const trace = { ...createImageLayer(useStore.getState().levels[0].id, 'sketch', 'cellars-sketch.png'), fit: 'original' as const };
    useStore.getState().addCustomImage('sketch', 'data:image/png;base64,AAAA');
    useStore.getState().addLayer(trace);
    const data = JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    const s = useStore.getState();
    expect(s.layers.find((l) => l.id === trace.id)).toEqual(trace);
    expect(s.assets.customImages.sketch).toBe('data:image/png;base64,AAAA');
  });
});
