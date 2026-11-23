import { describe, it, expect } from 'vitest';
import { DEFAULT_FOG_LOOK, FOG_LOOK_RANGES } from './fogLook';
import { CURRENT_VERSION, migrateToLatest } from '../store/migration';
import type { SerializedMapData } from '../store/types';

const LAYER_FIELDS = ['strength', 'scale', 'speed', 'angle'] as const;
const LOOK_FIELDS = ['wind', 'fade', 'veil', 'glow'] as const;

const inRange = (field: keyof typeof FOG_LOOK_RANGES, value: number): boolean =>
  value >= FOG_LOOK_RANGES[field].min && value <= FOG_LOOK_RANGES[field].max;

describe('FOG_LOOK_RANGES', () => {
  it('bounds every number a fog look carries, each with room to move', () => {
    expect(Object.keys(FOG_LOOK_RANGES).sort()).toEqual([...LAYER_FIELDS, ...LOOK_FIELDS].sort());
    for (const { min, max } of Object.values(FOG_LOOK_RANGES)) expect(min).toBeLessThan(max);
  });

  it('holds the shipped default, so it is never refused', () => {
    for (const layer of DEFAULT_FOG_LOOK.layers) {
      for (const field of LAYER_FIELDS) expect(inRange(field, layer[field]), `${field} ${layer[field]}`).toBe(true);
    }
    for (const field of LOOK_FIELDS) expect(inRange(field, DEFAULT_FOG_LOOK[field]), field).toBe(true);
  });
});

describe('a map saved with a named look preset', () => {
  it('still loads, its look intact, the preset key carried along and read by nothing', () => {
    const fogLook = { ...DEFAULT_FOG_LOOK, preset: 'mist', wind: 6 };
    const saved = {
      version: CURRENT_VERSION,
      mapSettings: {
        name: 'Old look',
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#1a1a2e',
        fogLook,
      },
      grid: { visible: true, snapDivision: 2 },
      layers: [],
      customImages: {},
    } as unknown as SerializedMapData;
    const loaded = migrateToLatest(JSON.parse(JSON.stringify(saved)) as SerializedMapData);
    expect(loaded.mapSettings.fogLook).toMatchObject({ ...DEFAULT_FOG_LOOK, wind: 6 });
  });
});
