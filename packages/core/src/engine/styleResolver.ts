import type { DungeonStyle } from '../store/types';

/**
 * Merge layer defaults with per-shape overrides.
 * Per-field fallback: shape override ?? layer default.
 * Returns the layer style directly when no overrides (zero allocation).
 */
export function resolveStyle(
  layerStyle: DungeonStyle,
  shapeOverrides?: Partial<DungeonStyle>,
): DungeonStyle {
  if (!shapeOverrides) return layerStyle;
  // Check if overrides object is empty
  const keys = Object.keys(shapeOverrides);
  if (keys.length === 0) return layerStyle;
  return { ...layerStyle, ...shapeOverrides };
}
