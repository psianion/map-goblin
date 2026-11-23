// The shape of the living-fog cloud (docs/2026-09-09-living-fog-v2-plan.md D7) — one type
// shared by three runtimes: canvas authors `MapSettings.fogLook` as the map's default, the
// table's DM can override it live via `SceneFog.look` (packages/mechanics/src/fog), and the
// session client's shader (session/client/src/modules/fog/livingFog.ts) reads whichever one
// wins. Types, the runtime name lists a validator needs and the shipped default all live
// here — the one place canvas (which never depends on session-client) and the client shader
// can both reach them from. The shader itself stays client-side; it re-exports
// `DEFAULT_FOG_LOOK` from here rather than declaring its own.

/** The four cloud strata the shader knows how to draw — see `layerNoise` in livingFog.ts's
 * FRAGMENT for what each one looks like. */
export const FOG_LAYER_TYPES = ['billow', 'smoke', 'haze', 'streaks'] as const;
export type FogLayerType = (typeof FOG_LAYER_TYPES)[number];

/** One stratum of the cloud. */
export interface FogLayer {
  type: FogLayerType;
  tint: string;
  strength: number;
  scale: number;
  speed: number;
  /** Drift direction, degrees. */
  angle: number;
}

/**
 * The table-facing shape of the cloud — everything `LivingFog.setLook` can change at once. A map
 * saved while looks had named presets may still carry a `preset` key here; nothing reads it.
 */
export interface FogLook {
  /** The mist under the layers — what shows wherever every layer is thin, and the colour the
   * scene grade pulls before it ever reaches a layer tint. */
  base: string;
  layers: [FogLayer, FogLayer, FogLayer];
  /** Multiplies every layer's drift and the shared warp field (D6). */
  wind: number;
  /** How wide the coastline's fade and the mask's own blur run, in the same cells the mask
   * geometry is drawn in (D1). */
  fade: number;
  veil: number;
  glow: number;
  /** Lifts D6's layer cap from one 'smoke' layer to three. Off by default. */
  heavy?: boolean;
}

/**
 * The range every number in a `FogLook` lives in — one table for the three places that bound
 * them: the table's validator (packages/mechanics/src/fog/module.ts) refuses a value outside
 * it, and the table's FogLookPanel and canvas's EnvironmentSection stop their sliders at it.
 * Each slider keeps its own step.
 */
export const FOG_LOOK_RANGES = {
  strength: { min: 0, max: 1 },
  scale: { min: 0.2, max: 8 },
  speed: { min: 0, max: 0.3 },
  angle: { min: 0, max: 360 },
  wind: { min: 0.5, max: 12 },
  fade: { min: 1, max: 4 },
  veil: { min: 0, max: 0.5 },
  glow: { min: 0, max: 1 },
} as const;

/** [type, tint, strength, scale, speed, angle-in-degrees] — the mockup's own row shape. */
type PresetRow = readonly [number, string, number, number, number, number];
const presetLayers = (
  rows: readonly [PresetRow, PresetRow, PresetRow],
): [FogLayer, FogLayer, FogLayer] =>
  rows.map(([type, tint, strength, scale, speed, angle]) => ({
    type: FOG_LAYER_TYPES[type],
    tint,
    strength,
    scale,
    speed,
    angle,
  })) as [FogLayer, FogLayer, FogLayer];

/**
 * The one look the table ships (fog rework §2.8): cloud, not mist. Three billow layers — the
 * old `cumulus` rows — give rounded lobes with light
 * tops and shaded undersides, and a narrow fade (2 cells, against the old 4) lets those lobes
 * carry the edge instead of a soft blur. No veil. Base, wind and glow stay as they were. The
 * values are a starting point for the sign-off on screen, not a final answer.
 */
export const DEFAULT_FOG_LOOK: FogLook = {
  base: '#ffffff',
  layers: presetLayers([
    [0, '#aab2ba', 1.0, 1.05, 0.009, 20],
    [0, '#d5dade', 0.6, 2.1, 0.017, 160],
    [0, '#f2f4f6', 0.4, 3.8, 0.028, 335],
  ]),
  wind: 4,
  fade: 2,
  veil: 0,
  glow: 1,
};
