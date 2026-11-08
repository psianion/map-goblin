// 3.8 → 3.9: additive. An imported picture carries its file name and its own pixel size
// (`imageSource`). A 3.8 map loads as it was, its pictures without one, and a 3.9 map
// round-trips through migrateToLatest, the parser the table loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { AssetChild, DungeonLayer, SerializedMapData } from './types';

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;

/** The default map with `child` on its dungeon layer, as a saved file. */
function saved(child: AssetChild): SerializedMapData {
  useStore.setState((s) => {
    (s.layers.find((x) => x.type === 'dungeon') as DungeonLayer).children.push(child);
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

const picture = (extra: Partial<AssetChild> = {}): AssetChild => ({
  id: 'img', name: 'Image 1a2b', childType: 'asset', visible: true, objectType: 'image', assetId: 'pic',
  position: { x: 18, y: 12 }, rotation: 0, scale: 1, width: 36, height: 24, tint: '#ffffff', flipX: false, flipY: false,
  ...extra,
});

describe('map format 3.9', () => {
  it('is the version saved, and 3.8 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.9');
    expect(SUPPORTED_VERSIONS).toContain('3.8');
    expect(useStore.getState().getSerializableState().version).toBe('3.9');
  });

  it('loads a 3.8 map with its picture as it was, no source size', () => {
    const old = { ...saved(picture()), version: '3.8' } as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(old));
    const child = dungeon(useStore.getState().getSerializableState()).children.find((c) => c.id === 'img') as AssetChild;
    expect(child).toEqual(picture());
    expect(child.imageSource).toBeUndefined();
  });

  it('round-trips a picture with its file name and source size', () => {
    const imageSource = { fileName: 'Crypt 36x24.jpg', width: 5040, height: 3360 };
    const data = saved(picture({ imageSource }));
    expect(data.version).toBe('3.9');
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    const child = dungeon(useStore.getState().getSerializableState()).children.find((c) => c.id === 'img');
    expect(child).toEqual(picture({ imageSource }));
  });
});
