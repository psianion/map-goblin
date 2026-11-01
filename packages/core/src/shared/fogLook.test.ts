import { describe, it, expect } from 'vitest';
import { DEFAULT_FOG_LOOK, FOG_LOOK_RANGES, FOG_PRESETS, type FogLayer } from './fogLook';

const LAYER_FIELDS = ['strength', 'scale', 'speed', 'angle'] as const;
const LOOK_FIELDS = ['wind', 'fade', 'veil', 'glow'] as const;

const inRange = (field: keyof typeof FOG_LOOK_RANGES, value: number): boolean =>
  value >= FOG_LOOK_RANGES[field].min && value <= FOG_LOOK_RANGES[field].max;

describe('FOG_LOOK_RANGES', () => {
  it('bounds every number a fog look carries, each with room to move', () => {
    expect(Object.keys(FOG_LOOK_RANGES).sort()).toEqual([...LAYER_FIELDS, ...LOOK_FIELDS].sort());
    for (const { min, max } of Object.values(FOG_LOOK_RANGES)) expect(min).toBeLessThan(max);
  });

  it('holds every preset layer and the shipped default, so none of them is refused', () => {
    const layers: FogLayer[] = [...Object.values(FOG_PRESETS).flat(), ...DEFAULT_FOG_LOOK.layers];
    for (const layer of layers) {
      for (const field of LAYER_FIELDS) expect(inRange(field, layer[field]), `${field} ${layer[field]}`).toBe(true);
    }
    for (const field of LOOK_FIELDS) expect(inRange(field, DEFAULT_FOG_LOOK[field]), field).toBe(true);
  });
});
