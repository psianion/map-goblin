import { describe, expect, it } from 'vitest';
import { createDefaultState } from '@dnd/core/src/store/factories';
import type { FogLook } from '@dnd/core/src/shared/fogLook';
import type { SceneFog } from '@dnd/mechanics/fog';
import { effectiveFogLook } from './effectiveFogLook';
import { DEFAULT_FOG_LOOK, FOG_PRESETS } from './livingFog';

const NO_OVERRIDE: SceneFog = { rooms: {}, concealBehindDoors: true };

const AUTHORED: FogLook = {
  base: '#112233',
  layers: FOG_PRESETS.mist,
  wind: 2,
  fade: 2,
  veil: 0.1,
  glow: 0.3,
};

describe('effectiveFogLook', () => {
  it('falls back to the shader default when neither the map nor the DM has set one', () => {
    const map = createDefaultState().mapSettings;
    expect(effectiveFogLook(map, NO_OVERRIDE)).toEqual(DEFAULT_FOG_LOOK);
  });

  it('reads the map-authored default over the shader default', () => {
    const map = { ...createDefaultState().mapSettings, fogLook: AUTHORED };
    expect(effectiveFogLook(map, NO_OVERRIDE)).toEqual(AUTHORED);
  });

  it('merges the DM live override over the authored default, field by field', () => {
    const map = { ...createDefaultState().mapSettings, fogLook: AUTHORED };
    const scene: SceneFog = { ...NO_OVERRIDE, look: { wind: 9, glow: 1 } };
    expect(effectiveFogLook(map, scene)).toEqual({ ...AUTHORED, wind: 9, glow: 1 });
  });

  it('merges the DM live override over the shader default when the map authored none', () => {
    const map = createDefaultState().mapSettings;
    const scene: SceneFog = { ...NO_OVERRIDE, look: { heavy: true } };
    expect(effectiveFogLook(map, scene)).toEqual({ ...DEFAULT_FOG_LOOK, heavy: true });
  });
});
