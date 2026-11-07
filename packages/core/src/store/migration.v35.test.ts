// 3.4 → 3.5: additive. The terrain's smooth blending switch rides in mapSettings.terrain.
// A 3.4 map loads as it was, the fields it lacks taking their defaults, and a 3.5 map
// round-trips through migrateToLatest, the parser the table loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { SerializedMapData } from './types';

const map = (version: string, extra: { terrain?: Record<string, unknown> } = {}) =>
  ({
    version,
    mapSettings: {
      name: 'Cellars',
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#1a1a2e',
      ...(extra.terrain ? { terrain: extra.terrain } : {}),
    },
    grid: { visible: true, snapDivision: 2, style: 'clean' },
    layers: [],
    customImages: {},
  }) as unknown as SerializedMapData;

beforeEach(() => useStore.getState().resetToDefault());

describe('map format 3.5', () => {
  it('is the version saved, and 3.4 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.5');
    expect(SUPPORTED_VERSIONS).toContain('3.4');
    expect(useStore.getState().getSerializableState().version).toBe('3.5');
  });

  it('loads a 3.4 map with no smooth blending, the ragged default', () => {
    const data = migrateToLatest(map('3.4', { terrain: { palette: [], bounds: null } }));
    expect(data.mapSettings.terrain?.smoothBlend).toBeUndefined();
    useStore.getState().loadFromFile(data);
    expect(useStore.getState().mapSettings.terrain?.smoothBlend).toBeUndefined();
  });

  it('round-trips the smooth blending switch through save and load', () => {
    useStore.getState().setTerrainData({ smoothBlend: true });
    const saved = JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
    expect(saved.mapSettings.terrain?.smoothBlend).toBe(true);
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(saved));
    expect(useStore.getState().mapSettings.terrain?.smoothBlend).toBe(true);
    expect(migrateToLatest(map('3.5', { terrain: { palette: [], bounds: null, smoothBlend: true } })).mapSettings.terrain?.smoothBlend).toBe(true);
  });
});
