import type { MapBuilderStore, DungeonLayer, AnyChild, LightChild, Layer } from './types';

export const selectLayers = (s: MapBuilderStore): Layer[] => s.layers;
export const selectActiveLayerId = (s: MapBuilderStore): string => s.ui.activeLayerId;
export const selectSelectedIds = (s: MapBuilderStore): string[] => s.selection.selectedIds;
export const selectHoveredId = (s: MapBuilderStore): string | null => s.selection.hoveredId;

export function selectActiveLayer(state: MapBuilderStore): Layer | undefined {
  const { activeLayerId } = state.ui;
  return state.layers.find((l) => l.id === activeLayerId);
}

export function selectAllLights(s: MapBuilderStore): LightChild[] {
  return s.layers
    .filter((l): l is DungeonLayer => l.type === 'dungeon')
    .flatMap((l) => l.children.filter((c): c is LightChild => c.childType === 'light'));
}

export function selectChildById(s: MapBuilderStore, childId: string): AnyChild | undefined {
  for (const layer of s.layers) {
    if (layer.type !== 'dungeon') continue;
    const child = layer.children.find((c) => c.id === childId);
    if (child) return child;
  }
  return undefined;
}

export function selectLayerForChild(s: MapBuilderStore, childId: string): DungeonLayer | undefined {
  for (const layer of s.layers) {
    if (layer.type !== 'dungeon') continue;
    if (layer.children.some((c) => c.id === childId)) return layer;
  }
  return undefined;
}
