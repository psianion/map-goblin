// The six light presets the Lights dock offers, and the one radius range every light control
// uses (the card, the dock, the context menu and the table popover).

import type { LightAnimation, LightChild } from '../shared/types';

/** Bright and dim distances, in feet, as every light control shows them. */
export const LIGHT_RADIUS_FT = { min: 5, max: 300, step: 5 } as const;

export type LightPresetId = 'torch' | 'lantern' | 'candle' | 'brazier' | 'magical' | 'darkness';

/** The fields a preset writes onto a new light. Radii in cells (5 ft per cell at the default scale). */
export interface LightPreset {
  id: LightPresetId;
  label: string;
  /** Bright edge, cells (`featherRadius`). */
  bright: number;
  /** Dim edge, cells (`radius`). */
  dim: number;
  /** The tile colour too. A darkness source has none to burn, so its tile shows ink. */
  color: string;
  intensity: number;
  animation?: LightAnimation;
  darkness?: boolean;
}

/** Torch 20/40 ft matches 5e. */
export const LIGHT_PRESETS: readonly LightPreset[] = [
  { id: 'torch', label: 'Torch', bright: 4, dim: 8, color: '#ffb561', intensity: 0.9, animation: { kind: 'flicker', speed: 1 } },
  { id: 'lantern', label: 'Lantern', bright: 6, dim: 12, color: '#ffd27a', intensity: 0.85 },
  { id: 'candle', label: 'Candle', bright: 1, dim: 2, color: '#ffc98a', intensity: 0.7, animation: { kind: 'flicker', speed: 1.6 } },
  { id: 'brazier', label: 'Brazier', bright: 5, dim: 10, color: '#ff8e3c', intensity: 1, animation: { kind: 'flicker', speed: 0.8 } },
  { id: 'magical', label: 'Magical', bright: 6, dim: 6, color: '#9ec8ff', intensity: 0.8, animation: { kind: 'pulse', speed: 0.6 } },
  { id: 'darkness', label: 'Darkness', bright: 3, dim: 3, color: '#000000', intensity: 1, darkness: true },
];

export function lightPreset(id: LightPresetId): LightPreset {
  return LIGHT_PRESETS.find((p) => p.id === id) ?? LIGHT_PRESETS[0]!;
}

/**
 * The light fields a preset stands for, shaped like `tools.settings.lightDefaults`: what the
 * dock writes when a tile is picked and what the Light tool copies onto the next light.
 * Keys a preset does not use are written as `undefined`, so picking Lantern after Torch drops
 * the flicker.
 */
export function presetDefaults(preset: LightPreset): Pick<
  LightChild,
  'color' | 'radius' | 'featherRadius' | 'intensity' | 'falloff' | 'animation' | 'darkness'
> & { presetId: LightPresetId } {
  return {
    presetId: preset.id,
    color: preset.color,
    radius: preset.dim,
    featherRadius: preset.bright,
    intensity: preset.intensity,
    falloff: 'quadratic',
    animation: preset.animation ? { ...preset.animation } : undefined,
    darkness: preset.darkness ? true : undefined,
  };
}
