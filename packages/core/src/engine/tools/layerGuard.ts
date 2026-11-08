import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { isLayerEffectivelyVisible } from '../../store/selectors';
import { TERRAIN_PANEL_ID, type DungeonLayer } from '../../store/types';

/**
 * The "nothing to draw on" warning, worded for whichever pinned row is
 * actually active — the plain "Select a layer first" reads as a bug when the
 * Terrain row is visibly selected in the panel. Shared by every drawing-tool
 * entry point that can hit this state (ToolManager.canEditActiveLayer,
 * DoorTool.onPointerDown) instead of forking the string per call site.
 */
export function noEditableLayerMessage(): string {
  const { ui, layers } = useStore.getState();
  if (layers.some((l) => l.id === ui.activeLayerId && l.type === 'image')) return TRACE_LAYER_MESSAGE;
  return ui.activeLayerId === TERRAIN_PANEL_ID
    ? 'Terrain is selected — pick a layer to draw on'
    : 'Select a layer first';
}

/** The refusal when the layer in hand is a trace (a background image layer): nothing is drawn on one. */
export const TRACE_LAYER_MESSAGE = 'Trace layer · pick a dungeon layer to draw';

/**
 * Null when `layer` may be edited; otherwise the warning that belongs to why
 * not. Shared by every write path that already holds a resolved layer (a
 * delete, mostly) so a lock, hide, or solo applied after the layer was
 * picked up still gets caught right before the mutation. Reads solo off the
 * store rather than taking it as a parameter — every caller already has a
 * layer in hand and nothing else, and this keeps the rule in one place
 * instead of forking it per call site.
 */
export function blockedLayerReason(layer: DungeonLayer | null | undefined): string | null {
  if (!layer) return 'Layer was removed';
  if (layer.locked) return 'Layer is locked';
  if (!isLayerEffectivelyVisible(useStore.getState(), layer)) return 'Layer is hidden';
  return null;
}

/**
 * Resolves `layerId` to an editable dungeon layer — existing, type
 * 'dungeon', unlocked, visible — warning and returning null otherwise.
 *
 * For a chain tool (wall/polygon/path) this is called at *finalize*
 * against the layer id captured when the chain started, not the current
 * active layer: the active layer can be locked, hidden, or switched away
 * from mid-chain, and the commit has to answer for the layer the chain was
 * actually drawn on.
 */
export function resolveEditableLayer(
  layerId: string | null | undefined,
  missingMessage = 'Layer was removed',
): DungeonLayer | null {
  const found = useStore.getState().layers.find((l) => l.id === layerId);
  const layer = found?.type === 'dungeon' ? found : undefined;
  if (!layer) {
    notify.warning(found?.type === 'image' ? TRACE_LAYER_MESSAGE : missingMessage);
    return null;
  }
  const reason = blockedLayerReason(layer);
  if (reason) {
    notify.warning(reason);
    return null;
  }
  return layer;
}
