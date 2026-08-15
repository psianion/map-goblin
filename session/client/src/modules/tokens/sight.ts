// P4 §3 — the arithmetic and the defaults behind the Sight & light controls, kept out of both
// panels that draw them (the placed instance's, in TokenPanel, and the library def's).
//
// Ranges are stored in *cells* — one world unit is one grid cell (D13), which is what the
// sweep, the light pool and the region record all measure in. A DM does not think in cells:
// they think in the unit printed on the map (`mapSettings.cellScale`, "5 ft" by default), and
// every other tool at the table quotes them that. So the field is in map units and the
// conversion happens here, once, in both directions.

import type { SerializedMapData } from '@dnd/core/src/store/types';
import type { TokenDef } from '@dnd/mechanics/tokens';

export type Sight = NonNullable<TokenDef['sight']>;
export type Light = NonNullable<TokenDef['light']>;

export interface MapScale {
  /** How many units one cell is worth. */
  value: number;
  unit: string;
}

/** A map with no scale is measured in cells, which is honest rather than a guessed 5 ft. */
const CELLS: MapScale = { value: 1, unit: 'cells' };

export function mapScale(mapData: unknown): MapScale {
  const scale = (mapData as SerializedMapData | null)?.mapSettings?.cellScale;
  return scale && scale.value > 0 ? scale : CELLS;
}

export const toUnits = (cells: number, scale: MapScale): number =>
  // Two decimals, then the trailing zeros dropped: 6 cells at 5 ft is 30, not 30.00, and an
  // odd 1.5-cell radius is 7.5 rather than 7.500000000000001.
  Number((cells * scale.value).toFixed(2));

export const toCells = (units: number, scale: MapScale): number =>
  Number((units / scale.value).toFixed(4));

/**
 * What a token gets the moment the DM gives it sight or a torch: 30 ft of normal vision, and
 * a torch's own 20/40. Real numbers rather than zeros — a control that starts at nothing looks
 * broken, and these are the values the table reaches for anyway.
 *
 * `angle` is 360 and there is no control for it: cones are a v1 non-goal, and the sweep
 * ignores the field. It is written because the schema requires it.
 */
export const DEFAULT_SIGHT: Sight = { range: 6, angle: 360, visionMode: 'normal' };
export const DEFAULT_LIGHT: Light = { dim: 8, bright: 4, color: '#ffbb66', angle: 360 };

export const VISION_MODES: readonly { value: Sight['visionMode']; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'darkvision', label: 'Darkvision' },
];
