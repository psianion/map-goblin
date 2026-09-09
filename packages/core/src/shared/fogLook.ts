// The shape of the living-fog cloud (docs/2026-09-09-living-fog-v2-plan.md D7) — one type
// shared by three runtimes: canvas authors `MapSettings.fogLook` as the map's default, the
// table's DM can override it live via `SceneFog.look` (packages/mechanics/src/fog), and the
// session client's shader (session/client/src/modules/fog/livingFog.ts) reads whichever one
// wins. Types, the runtime name lists a validator needs, the named presets and the shipped
// default all live here — the one place canvas (which never depends on session-client) and
// the client shader can both reach them from. The shader itself stays client-side; it
// re-exports `FOG_PRESETS`/`DEFAULT_FOG_LOOK` from here rather than declaring its own.

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

/** The named looks the mockup shipped (`FOG_PRESETS`, livingFog.ts) — a `FogLook.preset` of
 * `undefined` means a DM- or map-authored custom mix rather than one of these. */
export const FOG_LOOK_PRESETS = ['cumulus', 'mist', 'smoke', 'rolling'] as const;

/** The table-facing shape of the cloud — everything `LivingFog.setLook` can change at once. */
export interface FogLook {
  preset?: (typeof FOG_LOOK_PRESETS)[number];
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

/** Ported verbatim from docs/mockups/2026-09-09-fog-current-vs-living.html's `PRESETS`. */
export const FOG_PRESETS: Record<(typeof FOG_LOOK_PRESETS)[number], [FogLayer, FogLayer, FogLayer]> = {
  cumulus: presetLayers([
    [0, '#aab2ba', 1.0, 1.05, 0.009, 20],
    [0, '#d5dade', 0.6, 2.1, 0.017, 160],
    [0, '#f2f4f6', 0.4, 3.8, 0.028, 335],
  ]),
  mist: presetLayers([
    [2, '#b9c6d2', 1.0, 0.8, 0.006, 10],
    [2, '#dfe7ee', 0.7, 2.2, 0.012, 190],
    [1, '#eef2f5', 0.3, 4.0, 0.02, 30],
  ]),
  smoke: presetLayers([
    [1, '#6f7278', 1.0, 1.2, 0.02, 90],
    [1, '#9a9ea3', 0.6, 2.6, 0.035, 250],
    [3, '#c4c7cb', 0.35, 4.5, 0.05, 80],
  ]),
  rolling: presetLayers([
    [0, '#9fa8b0', 1.0, 0.6, 0.006, 0],
    [2, '#cfd6dc', 0.8, 1.8, 0.01, 180],
    [3, '#eef1f3', 0.35, 3.5, 0.03, 15],
  ]),
};

/**
 * The look the mockup was showing when it was signed off (2026-09-09): the ground-mist preset
 * as re-tuned by hand in the page — a white base, a near-black billow deck at strength 0.4, a
 * warm haze, and a white smoke top; every layer driven far faster than the presets above.
 * Provisional until the lock-the-defaults session the plan's WP1 leaves for after the settings
 * panel ships (docs/2026-09-09-living-fog-v2-plan.md §4).
 */
export const DEFAULT_FOG_LOOK: FogLook = {
  base: '#ffffff',
  layers: presetLayers([
    [0, '#05080b', 0.4, 6, 0.12, 345],
    [2, '#945f14', 0.25, 2.2, 0.155, 300],
    [1, '#ffffff', 0.6, 4, 0.145, 320],
  ]),
  wind: 4,
  fade: 4,
  veil: 0.22,
  glow: 1,
};
