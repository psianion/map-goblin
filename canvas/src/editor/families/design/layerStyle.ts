// The active dungeon layer, read and written the way the Design tools need it. Shared by
// the settings bound to the layer's style (Blend, wall Width) and the dock's Look columns.

import { LayerStyleChangeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, DungeonStyle } from '@/store/types';
import type { EditorState } from '@/editor/registry/types';

/** The layer new floors and walls go on, when it is a dungeon layer. */
export function activeDungeonLayer(state: Pick<EditorState, 'layers' | 'ui'>): DungeonLayer | null {
  const layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
  return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
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
