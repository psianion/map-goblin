// The active dungeon layer, read and written the way the Design tools need it. Shared by
// the settings bound to the layer's style (Blend, wall Width) and the dock's Look columns.

import { CompositeCommand, LayerStyleChangeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, DungeonStyle } from '@/store/types';
import type { EditorState } from '@/editor/registry/types';

/** The layer new floors and walls go on, when it is a dungeon layer. */
export function activeDungeonLayer(state: Pick<EditorState, 'layers' | 'ui'>): DungeonLayer | null {
  const layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
  return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
}

/** The two floor edges a layer draws with: Sharp (each floor to its own outline) or Blend (each room one floor, soft seams). */
export const FLOOR_EDGE_OPTIONS = [
  { value: false, label: 'Sharp' },
  { value: true, label: 'Blend' },
] as const;

/** Whether `layer` blends its floor edges (`showEdgeTransitions`, on by default). */
export const blendsFloorEdges = (layer: Pick<DungeonLayer, 'style'> | null | undefined): boolean => layer?.style.showEdgeTransitions !== false;

/** Floor edges set on each of the dungeon layers `layerIds` names, as one undo step. Nothing when none changes. */
export function setFloorEdges(state: Pick<EditorState, 'layers'>, layerIds: readonly string[], blend: boolean): void {
  const label = blend ? 'Blend floor edges' : 'Hard floor edges';
  const steps = [...new Set(layerIds)]
    .map((id) => state.layers.find((l) => l.id === id))
    .filter((l): l is DungeonLayer => !!l && l.type === 'dungeon' && blendsFloorEdges(l as DungeonLayer) !== blend)
    .map((l) => new LayerStyleChangeCommand(label, l.id, 'showEdgeTransitions', l.style.showEdgeTransitions, blend));
  if (steps.length === 1) undoManager.execute(steps[0]);
  else if (steps.length > 1) undoManager.execute(new CompositeCommand(label, steps));
}

/** One field of the active layer's style, as one undo step. Nothing when there is no layer or no change. */
export function setActiveStyle<K extends keyof DungeonStyle>(
  state: Pick<EditorState, 'layers' | 'ui'>,
  field: K,
  value: DungeonStyle[K],
  label: string,
): void {
  const layer = activeDungeonLayer(state);
  if (!layer || Object.is(layer.style[field], value)) return;
  undoManager.execute(new LayerStyleChangeCommand(label, layer.id, field, layer.style[field], value));
}
