// src/store/presetRegistry.ts
// Static registries for dungeon style, path, and scatter presets.
// No store slice — pure data. Import from here wherever presets are needed.

import type { DungeonStyle, ScatterBrushSettings } from './types';

// ─── Shared Preset Shape ──────────────────────────────────

export interface MapStylePreset {
  id: string;
  label: string;
  category: string;
  /** Floor, wall, shadow, edge transition settings */
  dungeonStyle: Partial<DungeonStyle>;
}

export interface ScatterPreset {
  id: string;
  label: string;
  category: string;
  values: Partial<ScatterBrushSettings>;
}

// ─── S5: Texture-aware dungeon style presets ──────────────

export const DUNGEON_STYLE_PRESETS: MapStylePreset[] = [
  {
    id: 'fieldstone-keep',
    label: 'Fieldstone Keep',
    category: 'dungeon',
    dungeonStyle: {
      floorColor: '#b8ac92',
      wallColor: '#26221c',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#5c544a',
      shadowOffset: { x: 0.4, y: 0.3 },
      shadowIntensity: 0.5,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureSetId: 'GG_Fieldstone',
      wallTextureTint: '#b09878',
    },
  },
  {
    id: 'timber-palisade',
    label: 'Timber Palisade',
    category: 'dungeon',
    dungeonStyle: {
      floorColor: '#94875f',
      wallColor: '#221a12',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#4a3d2c',
      shadowOffset: { x: 0.4, y: 0.3 },
      shadowIntensity: 0.5,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureSetId: 'GG_Palisade',
      // grey master mid #A0 x this tint lands on the Ashen source's mean color
      wallTextureTint: '#b49366',
    },
  },
  {
    id: 'cave-natural',
    label: 'Cave / Natural',
    category: 'dungeon',
    dungeonStyle: {
      floorColor: '#7a6a58',
      wallColor: '#1a1410',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#2a2018',
      shadowOffset: { x: 0.5, y: 0.4 },
      shadowIntensity: 0.6,
      edgeTransitionWidth: 0.6,
      showEdgeTransitions: true,
      wallTextureSetId: undefined,
      wallTextureTint: '#ffffff',
    },
  },
  {
    id: 'classic-dungeon',
    label: 'Classic Dungeon',
    category: 'dungeon',
    dungeonStyle: {
      floorColor: '#F1ECDF',
      wallColor: '#000000',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#8C867D',
      shadowOffset: { x: 0.4, y: 0.3 },
      shadowIntensity: 0.4,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureTint: '#ffffff',
    },
  },
  {
    id: 'dark-stone',
    label: 'Dark Stone',
    category: 'dungeon',
    dungeonStyle: {
      floorColor: '#2A2A2A',
      wallColor: '#111111',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#000000',
      shadowOffset: { x: 0.3, y: 0.3 },
      shadowIntensity: 0.6,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureTint: '#ffffff',
    },
  },
];

// ─── S7: Scatter presets ──────────────────────────────────
// Empty until gg-demo ships object assets — presets get rebuilt around the new
// art's actual ids (forest, rubble, etc.).

export const SCATTER_PRESETS: ScatterPreset[] = [];

/**
 * The preset a layer's style currently matches, or `undefined`.
 *
 * Keys a preset leaves `undefined` are ignored — those are exactly the ones
 * `PresetApplyCommand` declines to write, so comparing them would stop such a
 * preset from ever reading back as the active one.
 */
export function matchPresetId(style: DungeonStyle): string | undefined {
  return DUNGEON_STYLE_PRESETS.find((p) =>
    Object.entries(p.dungeonStyle).every(
      ([k, v]) =>
        v === undefined ||
        JSON.stringify(v) === JSON.stringify(style[k as keyof DungeonStyle]),
    ),
  )?.id;
}
