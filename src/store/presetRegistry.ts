// src/store/presetRegistry.ts
// Static registries for dungeon style, path, and scatter presets.
// No store slice — pure data. Import from here wherever presets are needed.

import type { DungeonStyle, ScatterBrushSettings } from './types.ts';

// ─── Shared Preset Shape ──────────────────────────────────

export interface DungeonStylePreset {
  id: string;
  label: string;
  category: string;
  values: Partial<DungeonStyle>;
}

export interface ScatterPreset {
  id: string;
  label: string;
  category: string;
  values: Partial<ScatterBrushSettings>;
}

// ─── S5: Texture-aware dungeon style presets ──────────────

export const DUNGEON_STYLE_PRESETS: DungeonStylePreset[] = [
  {
    id: 'stone-dungeon',
    label: 'Stone Dungeon',
    category: 'dungeon',
    values: {
      floorColor: '#c8b89a',
      wallColor: '#222222',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#6b6060',
      shadowOffset: { x: 0.4, y: 0.3 },
      shadowIntensity: 0.5,
      hatchingStyle: 'none',
      hatchingInverted: false,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      defaultTextureId: 'large-flagstone-a-01',
      wallTextureSetId: 'stone-slate',
      wallTextureTint: '#ffffff',
    },
  },
  {
    id: 'wood-tavern',
    label: 'Wood Tavern',
    category: 'dungeon',
    values: {
      floorColor: '#c8a06a',
      wallColor: '#3a2010',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#5a3820',
      shadowOffset: { x: 0.3, y: 0.3 },
      shadowIntensity: 0.4,
      hatchingStyle: 'none',
      hatchingInverted: false,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      defaultTextureId: 'wood-flooring-ashen',
      wallTextureSetId: 'wood-ashen',
      wallTextureTint: '#ffffff',
    },
  },
  {
    id: 'cave-natural',
    label: 'Cave / Natural',
    category: 'dungeon',
    values: {
      floorColor: '#7a6a58',
      wallColor: '#1a1410',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#2a2018',
      shadowOffset: { x: 0.5, y: 0.4 },
      shadowIntensity: 0.6,
      hatchingStyle: 'lines',
      hatchingBandWidth: 1.0,
      hatchingLineSpacing: 0.4,
      hatchingLineThickness: 0.025,
      hatchingAngle: 30,
      hatchingInverted: true,
      edgeTransitionWidth: 0.6,
      showEdgeTransitions: true,
      defaultTextureId: 'cave-floor-06-a',
      wallTextureSetId: undefined,
      wallTextureTint: '#ffffff',
    },
  },
  {
    id: 'sewer',
    label: 'Sewer',
    category: 'dungeon',
    values: {
      floorColor: '#5a7060',
      wallColor: '#1a2820',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#1a3028',
      shadowOffset: { x: 0.4, y: 0.3 },
      shadowIntensity: 0.55,
      hatchingStyle: 'crosshatch',
      hatchingBandWidth: 1.0,
      hatchingLineSpacing: 0.35,
      hatchingLineThickness: 0.02,
      hatchingAngle: 45,
      hatchingInverted: false,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: true,
      defaultTextureId: 'cobblestone-a-01',
      wallTextureSetId: 'stone-slate',
      wallTextureTint: '#88bb88',
    },
  },
  {
    id: 'crypt',
    label: 'Crypt',
    category: 'dungeon',
    values: {
      floorColor: '#2a2830',
      wallColor: '#0a0810',
      wallWidth: 0.5,
      shadowEnabled: true,
      shadowColor: '#050408',
      shadowOffset: { x: 0.3, y: 0.3 },
      shadowIntensity: 0.7,
      hatchingStyle: 'crosshatch',
      hatchingBandWidth: 1.0,
      hatchingLineSpacing: 0.3,
      hatchingLineThickness: 0.02,
      hatchingAngle: 45,
      hatchingInverted: false,
      edgeTransitionWidth: 0.4,
      showEdgeTransitions: true,
      defaultTextureId: 'smooth-stone-floor-a-10',
      wallTextureSetId: 'stone-slate',
      wallTextureTint: '#ddccaa',
    },
  },
];

// ─── S7: Scatter presets ──────────────────────────────────

export const SCATTER_PRESETS: ScatterPreset[] = [
  {
    id: 'forest',
    label: 'Forest',
    category: 'nature',
    values: {
      assetIds: ['tree-green-a1', 'stump-ashen-a1', 'fallen-leaves-green1-a1'],
      brushRadius: 3,
      density: 1.2,
      spacing: 1.5,
      rotationRange: [0, Math.PI * 2],
      scaleRange: [0.7, 1.3],
    },
  },
  {
    id: 'rubble',
    label: 'Rubble',
    category: 'dungeon',
    values: {
      assetIds: ['rock-stone-mossy-c11', 'log-ashen-a1'],
      brushRadius: 2,
      density: 0.8,
      spacing: 0.8,
      rotationRange: [0, Math.PI * 2],
      scaleRange: [0.5, 1.1],
    },
  },
  {
    id: 'grass-patch',
    label: 'Grass Patch',
    category: 'nature',
    values: {
      assetIds: ['grass-patch-green1-a1', 'fallen-leaves-green1-a1'],
      brushRadius: 2.5,
      density: 0.6,
      spacing: 0.5,
      rotationRange: [0, Math.PI * 2],
      scaleRange: [0.8, 1.2],
    },
  },
  {
    id: 'mushroom-cluster',
    label: 'Mushroom Cluster',
    category: 'nature',
    values: {
      assetIds: ['fallen-leaves-green1-a1', 'rock-stone-mossy-c11', 'grass-patch-green1-a1'],
      brushRadius: 1.5,
      density: 0.5,
      spacing: 0.6,
      rotationRange: [0, Math.PI * 2],
      scaleRange: [0.4, 0.9],
    },
  },
];
