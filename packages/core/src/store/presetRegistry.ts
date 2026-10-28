// src/store/presetRegistry.ts
// Static registry of dungeon style presets.
// No store slice — pure data. Import from here wherever presets are needed.

import type { DungeonStyle } from './types';

// ─── Shared Preset Shape ──────────────────────────────────

export interface MapStylePreset {
  id: string;
  label: string;
  category: string;
  /** Floor, wall, edge transition settings */
  dungeonStyle: Partial<DungeonStyle>;
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
      edgeTransitionWidth: 0.6,
      showEdgeTransitions: true,
      // The forge's cave kit: rock the walk lays along the floor edge rather
      // than stones composed along it (caveBandRenderer.ts).
      wallTextureSetId: 'GG_Cave_Ink',
      wallTextureTint: '#ffffff',
      // The rock straddles the floor edge, so the edge is never the visible
      // boundary — the rock is. Run the paint on underneath it.
      floorBleed: 0.45,
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
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      wallTextureTint: '#ffffff',
    },
  },
];


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
