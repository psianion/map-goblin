import type { DungeonStyle } from './types.ts';

export type StylePreset = Omit<DungeonStyle, 'roughnessAmplitude' | 'lineWidth'>;

const STORAGE_KEY = 'map-builder:custom-presets';

export const BUILT_IN_PRESETS: Record<string, { label: string; style: StylePreset }> = {
  classic: {
    label: 'Classic Dungeon',
    style: {
      floorColor: '#F1ECDF',
      wallColor: '#000000',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#8C867D',
      shadowOffset: { x: 0.4, y: 0.3 },
      shadowIntensity: 0.4,
      hatchingStyle: 'none',
      hatchingBandWidth: 1.0,
      hatchingLineSpacing: 0.3,
      hatchingLineThickness: 0.02,
      hatchingAngle: 45,
      hatchingInverted: false,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureTint: '#ffffff',
    },
  },
  dark: {
    label: 'Dark Stone',
    style: {
      floorColor: '#2A2A2A',
      wallColor: '#111111',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#000000',
      shadowOffset: { x: 0.3, y: 0.3 },
      shadowIntensity: 0.6,
      hatchingStyle: 'crosshatch',
      hatchingBandWidth: 1.0,
      hatchingLineSpacing: 0.25,
      hatchingLineThickness: 0.02,
      hatchingAngle: 45,
      hatchingInverted: false,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureTint: '#ffffff',
    },
  },
};

export function loadCustomPresets(): Record<string, StylePreset> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StylePreset>;
  } catch {
    return {};
  }
}

export function saveCustomPresetsToStorage(presets: Record<string, StylePreset>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage may not be available in all environments
  }
}

export function deleteCustomPresetFromStorage(name: string): void {
  const presets = loadCustomPresets();
  delete presets[name];
  saveCustomPresetsToStorage(presets);
}
