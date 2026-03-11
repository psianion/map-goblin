import type { MapBuilderStore } from './types';
import type { Layer } from './types';

/**
 * Returns the currently active layer, or undefined if none is selected.
 */
export function selectActiveLayer(state: MapBuilderStore): Layer | undefined {
  const { activeLayerId } = state.ui;
  return state.layers.find((l) => l.id === activeLayerId);
}
